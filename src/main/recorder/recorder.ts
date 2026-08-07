// Recorder supervisor — one ffmpeg child per procedureId.
// Per CAPT-04/05/06/07 + D-01 + D-03 + D-10 + D-11 + RESEARCH §6.
//
// State machine:
//   idle → starting → recording ⇄ paused → stopping → idle
//
// Plan 04 (device-lost) adds the stderr regex branch that transitions
// recording → stopping → partial-finalize (per D-03). The doctor can click
// Stop after device-lost; that runs the existing stop() with
// finalizeStatusOnStop === 'partial', which rewrites video_path to the
// `.partial.mp4` relative form.
//
// All dependencies are injectable (RecorderDeps) so unit tests can replace
// spawn, clock, procFs, proceduresRepo, audit, ffmpegPath, canonicalDevice,
// emit, and concatSpawn without booting Electron or ffmpeg.

import type { ChildProcess } from 'node:child_process';
import { canonicalizeOrThrow } from '../capture/canonicalize';
import { procedureMediaDir } from '../paths';
import { recorderRegistry } from './registry';
import { buildFfmpegArgs } from './ffmpeg-args';
import { buildConcatArgs, writeConcatList } from './concat';
import { DEVICE_LOST_RE, parseLastKnownTimestampMs, rewritePartial } from './device-lost';
import { defaultFfmpegPath } from './ffmpeg-path';
import { PreviewServer } from './preview-server';
import { proceduresRepo } from '../db/procedures-repo';
import { audit } from '../db/audit';
import type { PresetSummary, QualityPreset, RecordingStatus } from '@shared/ipc-contract';

export type ProceduresSubRepo = {
  insert: (input: {
    id: string;
    patientId: string;
    doctorId: string;
    videoPath: string;
    presetSummary: PresetSummary;
    audioDeviceName?: string | null;
  }) => unknown;
  updateStartedAt: (id: string, startedAt: number) => void;
  updateFinalized: (
    id: string,
    patch: {
      endedAt: number;
      durationSeconds: number;
      status: 'completed' | 'partial' | 'crashed';
      videoPath: string;
    },
  ) => unknown;
  insertSegment?: (input: {
    procedureId: string;
    segmentIndex: number;
    filePath: string;
    startedAt: number;
    endedAt: number;
  }) => unknown;
  get?: (id: string) => unknown;
};

export type AuditFn = (opts: {
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
  outcome?: 'ok' | 'failed' | 'rate_limited';
}) => void;

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: { stdio: ['pipe', 'ignore', 'pipe'] },
) => RecorderChild;

export type RecorderChild = {
  proc: {
    stdin: { write: (s: string) => boolean };
    on: (event: 'exit', cb: (code: number | null, signal: NodeJS.Signals | null) => void) => unknown;
    kill: (signal?: NodeJS.Signals) => void;
  };
  stderr: { on: (event: 'data', cb: (chunk: Buffer) => void) => unknown };
};

// ponytail: concat subprocess signature matches SpawnFn minus stdio (concat
// doesn't need stdin — it's a one-shot encode from a list file).
export type ConcatChild = {
  proc: {
    on: (event: 'exit', cb: (code: number | null, signal: NodeJS.Signals | null) => void) => unknown;
  };
};

export type ConcatSpawnFn = (
  command: string,
  args: readonly string[],
  options: { stdio: ['pipe', 'ignore', 'pipe'] },
) => ConcatChild;

export type ProcFs = {
  openSync: (path: string, flags: string) => number;
  fsyncSync: (fd: number) => void;
  closeSync: (fd: number) => void;
  statSync: (path: string) => { size: number };
  renameSync: (oldPath: string, newPath: string) => void;
  unlinkSync: (path: string) => void;
  existsSync: (path: string) => boolean;
  writeFileSync: (path: string, content: string) => void;
};

export type RecorderDeps = {
  spawn: SpawnFn;
  spawnConcat?: ConcatSpawnFn;
  clock: { now: () => number };
  procFs: ProcFs;
  procedures: ProceduresSubRepo;
  audit: AuditFn;
  ffmpegPath: () => string;
  canonicalDevice: (deviceId: string) => string;
  emit: (status: RecordingStatus) => void;
  // Test hook: capture the deviceName for the audit row.
  resolveDeviceName: (deviceId: string) => string;
  // Optional preview server factory. Production wires the real PreviewServer;
  // tests can inject a stub that returns deterministic ports + URLs.
  createPreviewServer?: () => PreviewServer;
};

type RecorderState = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping';

const SIGTERM_GRACE_MS = 5_000;
const SIGKILL_FALLBACK_MS = 5_500;
// If ffmpeg hasn't emitted 'frame=' AND hasn't exited within this window,
// force-kill it. Prevents the supervisor from getting stuck in
// 'starting' state forever when the OS never delivers an 'exit' event
// (rare but observed with Windows + MFT resource failures).
const START_WATCHDOG_MS = 10_000;

type FinalizeContext = {
  procedureId: string;
  patientId: string | null;
  mediaDir: string | null;
  outputRelPath: string | null;
  currentSegmentRelPath: string | null;
  segments: Array<{ segmentIndex: number; relPath: string; startedAt: number; endedAt: number }>;
  startedAt: number;
  endedAt: number;
  durationSeconds: number;
  finalStatus: 'completed' | 'partial' | 'crashed';
};

export class Recorder {
  private state: RecorderState = 'idle';
  private child: RecorderChild | null = null;
  private procedureId: string | null = null;
  private patientId: string | null = null;
  private startedAt: number | null = null;
  private outputPath: string | null = null;
  private outputRelPath: string | null = null;
  private mediaDir: string | null = null;
  private currentSegmentIndex = 0;
  private stderrBuffer = '';
  private frameSeen = false;
  private exitHandler: ((code: number | null, signal: NodeJS.Signals | null) => void) | null = null;
  private pendingStop: {
    resolve: (ctx?: FinalizeContext) => void;
    reject: (err: unknown) => void;
  } | null = null;
  private sigtermTimer: ReturnType<typeof setTimeout> | null = null;
  private sigkillTimer: ReturnType<typeof setTimeout> | null = null;
  private startWatchdog: ReturnType<typeof setTimeout> | null = null;
  private deviceName = '';
  private currentSegmentStartedAt: number | null = null;
  private currentSegmentRelPath: string | null = null;
  // Closed segments for concat (D-11): closed segments are appended to this
  // array; on stop() the supervisor concatenates them with the live one into
  // the canonical mp4. When segments.length === 0 (never paused), the live
  // file is the canonical mp4 — no concat subprocess runs.
  private closedSegments: Array<{ segmentIndex: number; relPath: string; startedAt: number; endedAt: number }> = [];
  private presetSummary: PresetSummary | null = null;
  // Plan 04 (device-lost): flag the device-lost branch so onExit takes the
  // rename + sidecar JSON + audit + 'lost' path instead of the normal
  // stop/pause finalize.
  private deviceLostInProgress = false;
  // Track the device-lost wall-clock time so the subsequent stop() can
  // finalize as 'partial' with the right endedAt timestamp.
  private lostAt: number | null = null;
  // stop() finalize flag — flips to 'partial' after device-lost so the
  // pending stop() rewrites video_path to <segment>.partial.mp4.
  private finalizeStatusOnStop: 'completed' | 'partial' = 'completed';
  // Shared stopPromise so a stop() call mid-device-lost awaits the rename +
  // sidecar before doing its own finalize (no race).
  private stopPromise: Promise<void> | null = null;
  private resolveStopPromiseFn: (() => void) | null = null;
  // Live-preview server — bridges ffmpeg's tee'd MJPEG TCP output to a
  // localhost HTTP multipart/x-mixed-replace stream. Created on start(),
  // destroyed on the same lifecycle boundary as the recording row.
  private previewServer: PreviewServer | null = null;
  private previewUrl: string | null = null;
  // ponytail: tcpPort is allocated once in start() and reused by every
  // resumed ffmpeg child. Without this, pause→resume would spawn a new
  // ffmpeg WITHOUT the MJPEG-tee preview output, leaving the renderer's
  // <img> frozen on the pre-pause frame. The PreviewServer TCP listener
  // stays bound across pause/resume; the new ffmpeg reconnects to the
  // same port on resume.
  private previewTcpPort: number | null = null;

  constructor(private readonly deps: RecorderDeps) {}

  getState(): RecorderState {
    return this.state;
  }

  async start(args: {
    procedureId: string;
    deviceId: string;
    patientId: string;
    doctorId: string;
    preset: QualityPreset;
    presetSummary: PresetSummary;
  }): Promise<{ procedureId: string; startedAt: number; previewUrl: string }> {
    if (this.state !== 'idle') {
      throw new Error(`Recorder busy (state=${this.state})`);
    }
    // Reserve the procedureId in the registry BEFORE any other work — a
    // second concurrent start() for the same id must throw RecorderBusyError
    // before we touch the DB or spawn ffmpeg (D-01 + Anti-Pattern 5).
    recorderRegistry.set(args.procedureId, this);
    this.state = 'starting';
    this.procedureId = args.procedureId;
    this.patientId = args.patientId;
    this.deviceName = this.deps.canonicalDevice(args.deviceId);
    this.presetSummary = args.presetSummary;

    const mediaDir = procedureMediaDir(args.patientId, args.procedureId);
    this.mediaDir = mediaDir;
    // The first segment is `video-seg0.mp4` so the concat list always has a
    // consistent pattern. The canonical `video.mp4` is written by the
    // finalize path — either by rename (never paused) or by the concat
    // subprocess output (one or more pauses).
    this.outputPath = `${mediaDir}${separator()}video-seg0.mp4`;
    this.outputRelPath = relativeVideoPath(args.patientId, args.procedureId);
    this.currentSegmentIndex = 0;
    this.currentSegmentRelPath = 'video-seg0.mp4';
    this.closedSegments = [];

    // Insert the procedure row first so the supervisor owns the row lifecycle
    // (started_at finalized on ffmpeg spawn, ended_at on stop).
    this.deps.procedures.insert({
      id: args.procedureId,
      patientId: args.patientId,
      doctorId: args.doctorId,
      videoPath: this.outputRelPath,
      presetSummary: args.presetSummary,
      audioDeviceName: null,
    });

    // ponytail: start the preview server BEFORE ffmpeg spawns so the TCP
    // listener is bound by the time ffmpeg tries to connect. If start()
    // throws (port bind failure), we abort before spawning ffmpeg so we
    // don't leak a child without a preview path.
    const previewServer = (this.deps.createPreviewServer ?? defaultCreatePreviewServer)();
    this.previewServer = previewServer;
    let previewHandle: { tcpPort: number; httpUrl: string };
    try {
      previewHandle = await previewServer.start();
    } catch (err) {
      // ponytail: clean up the half-initialized server and reset state so
      // a retry can start fresh. Without this, the registry entry would
      // remain pointing at a zombie recorder instance.
      this.previewServer = null;
      try {
        await previewServer.stop();
      } catch {
        // ignore — start() already failed; stop() may also fail
      }
      // ponytail: undo the registry reservation + DB insert so the caller
      // can retry. proceduresRepo.insert was already called above; the
      // procedures row stays (it's the recording's identity) but the
      // supervisor releases the slot so a fresh start() can succeed.
      recorderRegistry.delete(args.procedureId);
      this.state = 'idle';
      throw err;
    }
    this.previewUrl = previewHandle.httpUrl;
    this.previewTcpPort = previewHandle.tcpPort;

    const args2 = buildFfmpegArgs({
      deviceName: this.deviceName,
      preset: args.preset,
      outputPath: this.outputPath,
      previewTcpPort: previewHandle.tcpPort,
    });

    const child = this.deps.spawn(this.deps.ffmpegPath(), args2, {
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    this.child = child;

    child.stderr.on('data', (chunk: Buffer) => {
      this.onStderr(chunk.toString());
    });

    this.exitHandler = (code, signal) => this.onExit(code, signal);
    child.proc.on('exit', this.exitHandler);

    // Watchdog: if ffmpeg neither emits 'frame=' nor exits within
    // START_WATCHDOG_MS, force-kill it and run onExit. This guarantees
    // the registry entry gets cleared even when the process wedges (e.g.
    // spawn() returns but the child never actually launches, or the OS
    // never delivers the 'exit' event). Without this, a wedged spawn
    // leaves the recorder stuck in 'starting' state and every
    // subsequent start() throws RecorderBusyError.
    this.startWatchdog = setTimeout(() => {
      try {
        child.proc.kill('SIGKILL');
      } catch {
        // ignore — process may already be dead
      }
    }, START_WATCHDOG_MS);

    // startedAt will be set when ffmpeg emits the first 'frame=' line (D-10).
    return {
      procedureId: args.procedureId,
      startedAt: this.deps.clock.now(),
      previewUrl: this.previewUrl,
    };
  }

  async stop(): Promise<void> {
    // ponytail: device-lost path may be mid-flight (5s grace + sigterm/sigkill
    // before onExit's rename + sidecar + emit 'lost' runs). Await it so the
    // stop()'s own finalize runs AFTER device-lost's finalize — no race.
    if (this.stopPromise) {
      await this.stopPromise;
    }
    // Idempotent: a "double-click" Stop after a successful finalize returns
    // silently — never throws, never calls updateFinalized twice.
    if (this.state === 'idle') return;
    if (
      this.state === 'stopping' &&
      this.finalizeStatusOnStop === 'partial' &&
      this.procedureId
    ) {
      // Device-lost path: the supervisor is mid-stop with the partial file
      // already on disk; finalize the row with status='partial' + the
      // <segment>.partial.mp4 video path.
      const partialVideoRelPath = this.currentSegmentRelPath
        ? `${this.currentSegmentRelPath}.partial.mp4`
        : this.outputRelPath ?? '';
      const endedAt = this.lostAt ?? this.deps.clock.now();
      const startedAt = this.startedAt ?? endedAt;
      const durationSeconds = Math.max(0, Math.floor((endedAt - startedAt) / 1000));
      this.deps.procedures.updateFinalized(this.procedureId, {
        endedAt,
        durationSeconds,
        status: 'partial',
        videoPath: partialVideoRelPath,
      });
      this.deps.audit({
        action: 'recording.stopped',
        entityType: 'procedure',
        entityId: this.procedureId,
        metadata: {
          deviceName: this.deviceName,
          preset: this.presetSummaryForAudit(),
          durationSeconds,
          partial: true,
        },
      });
    this.deps.emit({
      status: 'stopped',
      startedAt,
      procedureId: this.procedureId,
    });
    recorderRegistry.delete(this.procedureId);
    // ponytail: tear down the preview server BEFORE resetInternalState
    // nulls the reference. stopPreviewServer swallows errors so the
    // finalize path is never blocked by a hung socket close.
    void this.stopPreviewServer();
    this.resetInternalState();
    this.state = 'idle';
      return;
    }
    if (this.state !== 'recording' && this.state !== 'paused') {
      throw new Error(`Cannot stop recorder in state=${this.state}`);
    }
    this.state = 'stopping';
    const child = this.child;
    if (!child) {
      // ponytail: enter-via-paused path — the pause exit branch already
      // pushed the just-closed segment into closedSegments and cleared the
      // child ref. Synthesize the same finalize bookkeeping onExit's stop
      // path runs, but synchronously — no q\n/timers/pendingStop, since
      // the underlying Node ChildProcess already fired 'exit'. Without
      // this branch, pause→stop would schedule timers against the stale
      // ref and the stop() promise would hang forever.
      return this.finalizeStopFromPaused();
    }
    return new Promise<void>((resolve, reject) => {
      this.pendingStop = {
        resolve: (ctx) => {
          if (ctx) {
            this.finalizeCurrentSegment(ctx).then(resolve, reject);
          } else {
            resolve();
          }
        },
        reject,
      };
      // 'q\n' writes 'q' + newline to ffmpeg's stdin, triggering a graceful
      // encoder finalisation. ffmpeg also accepts 'q' alone, but the newline
      // makes the write atomic and matches D-01 / PITFALLS §1 guidance.
      child.proc.stdin.write('q\n');
      this.sigtermTimer = setTimeout(() => {
        try {
          child.proc.kill('SIGTERM');
        } catch {
          // already exited
        }
      }, SIGTERM_GRACE_MS);
      this.sigkillTimer = setTimeout(() => {
        try {
          child.proc.kill('SIGKILL');
        } catch {
          // already exited
        }
      }, SIGKILL_FALLBACK_MS);
    });
  }

  // ponytail: pause / resume share the q\n + grace + SIGTERM/SIGKILL pattern
  // with stop(). The helpers below keep the bodies small.
  async pause(): Promise<void> {
    if (this.state !== 'recording') {
      throw new Error(`Cannot pause recorder in state=${this.state}`);
    }
    const child = this.child;
    if (!child) {
      this.state = 'paused';
      return;
    }
    return new Promise<void>((resolve, reject) => {
      this.pendingStop = {
        resolve: () => resolve(),
        reject,
      };
      child.proc.stdin.write('q\n');
      this.sigtermTimer = setTimeout(() => {
        try {
          child.proc.kill('SIGTERM');
        } catch {
          // already exited
        }
      }, SIGTERM_GRACE_MS);
      this.sigkillTimer = setTimeout(() => {
        try {
          child.proc.kill('SIGKILL');
        } catch {
          // already exited
        }
      }, SIGKILL_FALLBACK_MS);
    });
  }

  async resume(): Promise<void> {
    if (this.state !== 'paused') {
      throw new Error(`Cannot resume recorder in state=${this.state}`);
    }
    const nextIndex = this.currentSegmentIndex + 1;
    const nextRel = `video-seg${nextIndex}.mp4`;
    const mediaDir = this.mediaDir;
    const patientId = this.patientId;
    const procedureId = this.procedureId;
    const presetSummary = this.presetSummary;
    if (!mediaDir || !patientId || !procedureId || !presetSummary) {
      throw new Error('Cannot resume: missing context from previous segment');
    }
    const outputPath = `${mediaDir}${separator()}${nextRel}`;
    const args2 = buildFfmpegArgs({
      deviceName: this.deviceName,
      // ponytail: resume reuses the same preset as start; we don't keep the
      // QualityPreset around (only PresetSummary), but buildFfmpegArgs
      // accepts QualityPreset so the supervisor maps presetSummary back.
      preset: this.presetToQuality(),
      outputPath,
      // ponytail: resume must re-emit the MJPEG tee to the SAME tcp port
      // allocated in start(). The PreviewServer TCP listener stays bound
      // across pause/resume (only finalize paths call .stop() on it), so
      // the new ffmpeg reconnects on resume. Without this, the renderer's
      // <img> stays frozen on the pre-pause frame because no producer
      // reconnects to the TCP socket.
      previewTcpPort: this.previewTcpPort ?? undefined,
    });
    const child = this.deps.spawn(this.deps.ffmpegPath(), args2, {
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    this.child = child;
    this.outputPath = outputPath;
    this.currentSegmentIndex = nextIndex;
    this.currentSegmentRelPath = nextRel;
    // Resume state will be flipped to 'recording' on the first 'frame=' chunk.
    this.stderrBuffer = '';
    this.frameSeen = false;
    child.stderr.on('data', (chunk: Buffer) => {
      this.onStderr(chunk.toString());
    });
    this.exitHandler = (code, signal) => this.onExit(code, signal);
    child.proc.on('exit', this.exitHandler);
  }

  getStatus(): RecordingStatus | null {
    if (this.state === 'idle') return null;
    if (this.startedAt === null) return null;
    return {
      status: 'started',
      startedAt: this.startedAt,
      currentSegmentIndex: this.currentSegmentIndex,
    };
  }

  private onStderr(chunk: string): void {
    this.stderrBuffer += chunk;
    // ponytail: device-lost takes precedence over frame-detection — when
    // ffmpeg emits an I/O error or DeviceLost we MUST drop the segment to
    // disk before any further frame accounting. The regex is case-insensitive
    // and covers the six substrings from RESEARCH §3 verbatim. State guard
    // ensures only ONE device-lost event fires per recording.
    if (this.state === 'recording' && !this.deviceLostInProgress && DEVICE_LOST_RE.test(chunk)) {
      this.enterDeviceLost();
    }
    if (this.frameSeen) return;
    if (!this.stderrBuffer.includes('frame=')) return;
    this.frameSeen = true;
    const now = this.deps.clock.now();
    // ponytail: startedAt is the ORIGINAL procedure wall-clock start time.
    // It is captured ONCE on the starting→recording transition. Resuming
    // a paused recording must NOT overwrite it — the renderer derives the
    // visible HH:MM:SS from Date.now() - startedAt and resets to 0 if
    // startedAt flips, which would look like "video restarts from the
    // beginning" to the doctor.
    if (this.state === 'starting') {
      this.startedAt = now;
      if (this.procedureId) {
        this.deps.procedures.updateStartedAt(this.procedureId, now);
      }
    }
    this.currentSegmentStartedAt = now;
    if (this.state === 'starting') {
      // ponytail: clear the startup watchdog once ffmpeg has emitted its
      // first frame — the watchdog's job was to SIGKILL a stuck spawn that
      // never produced any frames. Once we see `frame=`, the spawn is
      // healthy and the watchdog must NOT fire mid-recording. Without this,
      // the watchdog (START_WATCHDOG_MS = 10_000, set ~1s before this line
      // runs) ticks another ~9s into active recording and SIGKILLs the
      // live ffmpeg, triggering an auto-pause the doctor never requested.
      if (this.startWatchdog) {
        clearTimeout(this.startWatchdog);
        this.startWatchdog = null;
      }
      this.deps.audit({
        action: 'recording.started',
        entityType: 'procedure',
        entityId: this.procedureId,
        metadata: { deviceName: this.deviceName, preset: this.presetSummaryForAudit() },
      });
      this.state = 'recording';
      this.deps.emit({
        status: 'started',
        startedAt: now,
        currentSegmentIndex: this.currentSegmentIndex,
      });
    } else if (this.state === 'paused' || this.state === 'stopping') {
      // ponytail: the pause→resume transition flips state back to 'recording'
      // on first 'frame='. Audit row carries the segmentIndex so consumers
      // can rebuild the segment timeline from the audit log alone. The emit
      // carries the ORIGINAL `this.startedAt` — NOT `now` — so the renderer's
      // timer derivation stays continuous across pause/resume.
      const segmentIndex = this.currentSegmentIndex;
      this.state = 'recording';
      this.deps.audit({
        action: 'recording.resumed',
        entityType: 'procedure',
        entityId: this.procedureId,
        metadata: { segmentIndex },
      });
      this.deps.emit({
        status: 'resumed',
        startedAt: this.startedAt ?? now,
        currentSegmentIndex: segmentIndex,
      });
    }
  }

  // ponytail: device-lost branch — mirrors stop()'s q\n + grace + sigkill
  // pattern. On 'exit' the onExit handler takes the rename + sidecar JSON +
  // audit + 'lost' path. State stays 'stopping' so a subsequent stop() call
  // finalizes as 'partial' (D-03 + Plan 04).
  private enterDeviceLost(): void {
    this.deviceLostInProgress = true;
    this.finalizeStatusOnStop = 'partial';
    this.state = 'stopping';
    const child = this.child;
    if (!child) {
      // No live child — invoke the stopPromise resolver immediately so a
      // concurrent stop() call doesn't deadlock.
      this.stopPromise = Promise.resolve();
      return;
    }
    // Set up the shared stopPromise BEFORE writing q\n so a stop() call mid-
    // grace observes a non-null promise and awaits the rename + sidecar.
    this.stopPromise = new Promise<void>((resolve) => {
      this.resolveStopPromiseFn = resolve;
    });
    try {
      child.proc.stdin.write('q\n');
    } catch {
      // ignore — child may already be torn down
    }
    this.sigtermTimer = setTimeout(() => {
      try {
        child.proc.kill('SIGTERM');
      } catch {
        // already exited
      }
    }, SIGTERM_GRACE_MS);
    this.sigkillTimer = setTimeout(() => {
      try {
        child.proc.kill('SIGKILL');
      } catch {
        // already exited
      }
    }, SIGKILL_FALLBACK_MS);
  }

  // Called by onExit when deviceLostInProgress is true. Reads the segment
  // file size, computes lastKnownTimestampMs, renames to .partial.mp4, writes
  // the sidecar JSON, writes the audit row, emits the 'lost' status.
  private handleDeviceLostExit(): void {
    const procedureId = this.procedureId;
    const outputPath = this.outputPath;
    const segmentRelPath = this.currentSegmentRelPath;
    const startedAt = this.startedAt ?? this.deps.clock.now();
    const deviceLostAt = this.deps.clock.now();
    this.lostAt = deviceLostAt;
    if (!procedureId || !outputPath || !segmentRelPath) {
      this.deviceLostInProgress = false;
      if (this.resolveStopPromiseFn) {
        this.resolveStopPromiseFn();
        this.resolveStopPromiseFn = null;
      }
      this.stopPromise = null;
      return;
    }
    let statSize = 0;
    try {
      statSize = this.deps.procFs.statSync(outputPath).size;
    } catch {
      // Segment file missing — ffmpeg died before opening it. Use 0; the
      // parseLastKnownTimestampMs will throw, so guard it.
    }
    let lastKnownTimestampMs = 0;
    try {
      lastKnownTimestampMs = parseLastKnownTimestampMs(statSize, this.presetSummaryForAudit().bitrate);
    } catch {
      lastKnownTimestampMs = 0;
    }
    const partialJsonRelPath = `${segmentRelPath}.partial.mp4.json`;
    try {
      rewritePartial(
        outputPath,
        segmentRelPath,
        {
          procedureId,
          lastKnownTimestampMs,
          deviceLostAt,
          deviceName: this.deviceName,
        },
        { procFs: this.deps.procFs },
      );
    } catch (err) {
      this.deps.audit({
        action: 'recording.lost_rename_failed',
        entityType: 'procedure',
        entityId: procedureId,
        metadata: { error: (err as Error).message },
        outcome: 'failed',
      });
    }
    this.deps.audit({
      action: 'recording.lost',
      entityType: 'procedure',
      entityId: procedureId,
      metadata: {
        segmentIndex: this.currentSegmentIndex,
        lastKnownTimestampMs,
        deviceName: this.deviceName,
        partialJsonPath: partialJsonRelPath,
      },
      outcome: 'failed',
    });
    this.deps.emit({
      status: 'lost',
      startedAt,
      lastKnownTimestampMs,
      deviceName: this.deviceName,
    });
    // Resolve the shared stopPromise so any awaiting stop() runs its
    // partial-finalize branch in order (no race).
    if (this.resolveStopPromiseFn) {
      this.resolveStopPromiseFn();
      this.resolveStopPromiseFn = null;
    }
    this.stopPromise = null;
    this.deviceLostInProgress = false;
    // state stays 'stopping' — the doctor's subsequent stop() call will
    // finalize as 'partial' and reset to 'idle'.
  }

  private onExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.clearTimers();
    // ponytail: device-lost exit — run the rename + sidecar + audit + 'lost'
    // branch. State stays 'stopping' so the doctor can still click Stop to
    // finalize as 'partial'.
    if (this.deviceLostInProgress) {
      this.handleDeviceLostExit();
      return;
    }
    const procedureId = this.procedureId;
    const outputPath = this.outputPath;
    // ponytail: if we never saw a 'frame=' line, the encoder died before it
    // could flush any frames; treat as partial (PITFALLS §1).
    const startedAt = this.startedAt ?? this.deps.clock.now();
    const endedAt = this.deps.clock.now();
    const durationSeconds = Math.max(
      0,
      Math.floor((endedAt - startedAt) / 1000),
    );
    // Capture the user-intent state BEFORE the partial heuristic — when the
    // user clicked Stop (state='stopping'), the shutdown was intentional even
    // if ffmpeg returned a non-zero exit code or had to be SIGKILL'd after the
    // 5.5s grace period. ffmpeg can still exit non-zero on q\n for benign
    // reasons (e.g. muxer finalization quirks with +faststart), and Node's
    // TerminateProcess on Windows reports signal='SIGKILL' even when the
    // fallback timer fires because the parent asked for a clean shutdown.
    // In all "user-initiated Stop" cases, mark the row as 'completed' so the
    // review page doesn't show a misleading "Recording ended unexpectedly"
    // banner. Non-stop exits (recording died unexpectedly, encoder failed
    // before user clicked Stop, etc.) still fall through to 'partial'.
    const isStop = this.state === 'stopping';
    // ponytail: also gate on 'paused' so a subsequent ffmpeg exit during a
    // paused-state finalize (e.g. the auto-pause SIGKILL leaves the
    // supervisor in 'paused' state) doesn't double-count as partial. Any
    // ffmpeg exit while the user has already moved the supervisor into a
    // terminal-ish state (stopping OR paused) was either user-initiated
    // (the pause/stop click) or a downstream effect of a prior user action,
    // not a fresh mid-recording crash. Unintentional exits only fire the
    // partial heuristic when state is 'recording' or 'starting'.
    const isPausedTerminal = this.state === 'paused';
    const userInitiatedTerminal = isStop || isPausedTerminal;
    let finalStatus: 'completed' | 'partial' | 'crashed' = 'completed';
    if (!userInitiatedTerminal && (signal === 'SIGKILL' || (code !== null && code !== 0 && signal !== 'SIGTERM'))) {
      finalStatus = 'partial';
    }
    if (!outputPath || !procedureId) {
      this.resolvePendingStop();
      this.state = 'idle';
      return;
    }
    try {
      const fd = this.deps.procFs.openSync(outputPath, 'r');
      this.deps.procFs.fsyncSync(fd);
      this.deps.procFs.closeSync(fd);
    } catch (err) {
      // ponytail: only downgrade to 'partial' when the segment file is
      // actually missing (ENOENT). On Windows, fsync on a read-only handle
      // returns EPERM ("operation not permitted") — a known Node/Windows
      // quirk for FlushFileBuffers on an 'r' handle. That doesn't mean the
      // recording failed: ffmpeg already wrote the file cleanly (we know
      // this because ffmpeg exited with code=0 and the rename below
      // succeeds). Logging the audit row is enough — don't downgrade the
      // status to 'partial' for a Windows fsync quirk.
      const errorCode = (err as NodeJS.ErrnoException).code;
      const fileMissing = errorCode === 'ENOENT';
      this.deps.audit({
        action: 'recording.stop_no_exit',
        entityType: 'procedure',
        entityId: procedureId,
        metadata: { outcome: fileMissing ? 'failed' : 'warned', error: (err as Error).message, code: errorCode },
        outcome: fileMissing ? 'failed' : 'ok',
      });
      if (fileMissing) finalStatus = 'partial';
    }
    // Pause path: append the just-closed segment to closedSegments and emit
    // paused. The supervisor stays alive (registry holds it); resume() will
    // spawn a fresh child for the next segment. Clear the child ref +
    // currentSegmentStartedAt so a subsequent stop() (without an intervening
    // resume) takes the paused-finalize branch instead of scheduling timers
    // against a dead RecorderChild whose 'exit' already fired — without
    // this, pause→stop leaves the recording.pendinɡStop unresolved forever.
    if (
      !isStop &&
      this.currentSegmentRelPath &&
      this.currentSegmentStartedAt !== null
    ) {
      this.closedSegments.push({
        segmentIndex: this.currentSegmentIndex,
        relPath: this.currentSegmentRelPath,
        startedAt: this.currentSegmentStartedAt,
        endedAt,
      });
      if (this.deps.procedures.insertSegment) {
        this.deps.procedures.insertSegment({
          procedureId,
          segmentIndex: this.currentSegmentIndex,
          filePath: this.currentSegmentRelPath,
          startedAt: this.currentSegmentStartedAt,
          endedAt,
        });
      }
      this.deps.audit({
        action: 'recording.paused',
        entityType: 'procedure',
        entityId: procedureId,
        metadata: {
          segmentIndex: this.currentSegmentIndex,
          deviceName: this.deviceName,
          preset: this.presetSummaryForAudit(),
        },
      });
      this.state = 'paused';
      // ponytail: clear the live state so a follow-up stop() detects the
      // pause-exit by child===null and routes to finalizeStopFromPaused
      // rather than scheduling timers against the dead child.
      this.child = null;
      this.currentSegmentStartedAt = null;
      // ponytail: emit `startedAt` = wall-clock time at pause so the
      // renderer-side `Date.now() - startedAt` derivation freezes when
      // pausedAt is set (the renderer replaces Date.now() with pausedAt).
      this.deps.emit({
        status: 'paused',
        startedAt: endedAt,
        currentSegmentIndex: this.currentSegmentIndex,
      });
      this.resolvePendingStop();
      return;
    }
    // Stop path: capture the live segment into closedSegments (only if there
    // were prior pauses — otherwise rename keeps the segment count at 0).
    const hadPriorPauses = this.closedSegments.length > 0;
    if (
      isStop &&
      this.currentSegmentRelPath &&
      this.currentSegmentStartedAt !== null &&
      hadPriorPauses
    ) {
      this.closedSegments.push({
        segmentIndex: this.currentSegmentIndex,
        relPath: this.currentSegmentRelPath,
        startedAt: this.currentSegmentStartedAt,
        endedAt,
      });
      if (this.deps.procedures.insertSegment) {
        this.deps.procedures.insertSegment({
          procedureId,
          segmentIndex: this.currentSegmentIndex,
          filePath: this.currentSegmentRelPath,
          startedAt: this.currentSegmentStartedAt,
          endedAt,
        });
      }
    }
    // ponytail: pendingStop.resolve is the wrapper that awaits
    // finalizeCurrentSegment — but finalizeCurrentSegment needs the segment
    // context (mediaDir / currentSegmentRelPath) which we wipe in
    // resetInternalState. Capture them first.
    const finalizeContext = {
      procedureId,
      patientId: this.patientId,
      mediaDir: this.mediaDir,
      outputRelPath: this.outputRelPath,
      currentSegmentRelPath: this.currentSegmentRelPath,
      segments: this.closedSegments,
      startedAt,
      endedAt,
      durationSeconds,
      finalStatus,
    };
    // Audit the recording.stopped BEFORE reset so audit metadata carries
    // segmentCount. updateFinalized uses the canonical rel path; the canonical
    // mp4 may be written by finalizeCurrentSegment (concat) or a rename
    // happens below.
    if (this.outputRelPath) {
      this.deps.procedures.updateFinalized(procedureId, {
        endedAt,
        durationSeconds,
        status: finalStatus,
        videoPath: this.outputRelPath,
      });
    }
    this.deps.audit({
      action: 'recording.stopped',
      entityType: 'procedure',
      entityId: procedureId,
      metadata: {
        deviceName: this.deviceName,
        preset: this.presetSummaryForAudit(),
        durationSeconds,
        segmentCount: this.closedSegments.length,
        // Recording debug visibility — the supervisor's finalStatus decision
        // depends on ffmpeg's exit code + signal + the state at the time of
        // exit. Without these fields the audit log can't distinguish a
        // user-initiated Stop that ffmpeg handled cleanly (code=0, signal=null,
        // isStop=true) from a ffmpeg-side failure mid-recording (code!=0 or
        // signal=SIGKILL, isStop=false). Logged here so the procedure-review
        // "Recording ended unexpectedly" banner can be cross-checked against
        // the actual cause.
        exitCode: code,
        exitSignal: signal,
        finalStatus,
        userInitiatedStop: isStop,
      },
    });
    this.deps.emit({
      status: 'stopped',
      startedAt,
      procedureId,
    });
    recorderRegistry.delete(procedureId);
    this.resetInternalState();
    this.state = 'idle';
    // ponytail: pendingStop was the wrapper that awaited
    // finalizeCurrentSegment. Trigger it now via resolvePendingStop.
    this.resolvePendingStopWithContext(finalizeContext);
  }

  private presetSummaryForAudit(): PresetSummary {
    return (
      this.presetSummary ?? {
        kind: 'sd',
        resolution: '720x480',
        framerate: 30,
        bitrate: '4M',
      }
    );
  }

  // ponytail: buildFfmpegArgs takes QualityPreset but we only stored PresetSummary
  // at the recorder level (audit / list summaries). Map back to the shape the
  // ffmpeg arg builder needs.
  private presetToQuality(): QualityPreset {
    const summary = this.presetSummary;
    if (!summary) return { preset: 'sd' };
    if (summary.kind === 'sd') return { preset: 'sd' };
    if (summary.kind === 'hd') return { preset: 'hd' };
    return { preset: 'custom', resolution: summary.resolution, framerate: summary.framerate };
  }

  // Called after onExit has finalized the current segment. For stop, this
  // is where concat happens; for pause, the segment is appended to
  // closedSegments and no concat is needed (the resume path spawns a fresh
  // child). For never-paused, the lone segment is renamed to video.mp4.
  // ponytail: takes a context snapshot so the rename/concat can run after
  // resetInternalState has wiped the live fields.
  private async finalizeCurrentSegment(ctx: FinalizeContext): Promise<void> {
    if (!ctx.mediaDir || !ctx.currentSegmentRelPath) {
      // Defensive: start() always sets these; if they're null here, the
      // supervisor was never properly started.
      return;
    }
    const canonicalAbs = joinPath(ctx.mediaDir, 'video.mp4');
    if (ctx.segments.length === 0) {
      // Never paused: the lone segment IS the canonical mp4.
      const segmentAbs = joinPath(ctx.mediaDir, ctx.currentSegmentRelPath);
      try {
        this.deps.procFs.renameSync(segmentAbs, canonicalAbs);
      } catch (err) {
        this.deps.audit({
          action: 'recording.concat_failed',
          entityType: 'procedure',
          entityId: ctx.procedureId,
          metadata: { segmentCount: 0, reason: 'rename-failed', error: (err as Error).message },
          outcome: 'failed',
        });
      }
      return;
    }
    // Concat the segments into the canonical mp4 (D-11 + RESEARCH §2).
    const relPaths = ctx.segments.map((s) => s.relPath);
    const list = writeConcatList(ctx.mediaDir, relPaths);
    let success = false;
    try {
      success = await this.runConcat(list.listPath, canonicalAbs, false);
      if (!success) {
        success = await this.runConcat(list.listPath, canonicalAbs, true);
      }
    } finally {
      list.cleanup();
    }
    if (!success) {
      // ponytail: double-failure path — finalize the row as 'partial' so the
      // partial-mp4 recovery (D-03) picks up. We keep the segment files in
      // place so the doctor can recover manually if needed.
      this.deps.audit({
        action: 'recording.concat_failed',
        entityType: 'procedure',
        entityId: ctx.procedureId,
        metadata: { segmentCount: ctx.segments.length, reason: 'reencode-failed' },
        outcome: 'failed',
      });
      if (ctx.outputRelPath) {
        const endedAt = this.deps.clock.now();
        this.deps.procedures.updateFinalized(ctx.procedureId, {
          endedAt,
          durationSeconds: 0,
          status: 'partial',
          videoPath: ctx.outputRelPath,
        });
        this.deps.emit({
          status: 'lost',
          startedAt: ctx.startedAt,
          lastKnownTimestampMs: ctx.startedAt,
          deviceName: this.deviceName,
        });
      }
      return;
    }
    // On success: fsync the canonical mp4 + delete segment files.
    try {
      const fd = this.deps.procFs.openSync(canonicalAbs, 'r');
      this.deps.procFs.fsyncSync(fd);
      this.deps.procFs.closeSync(fd);
    } catch {
      // ignore — concat subprocess already wrote the file
    }
    for (const seg of ctx.segments) {
      const segAbs = joinPath(ctx.mediaDir, seg.relPath);
      try {
        this.deps.procFs.unlinkSync(segAbs);
      } catch {
        // swallow ENOENT — the segment may have been renamed above or
        // never created if the encoder died before opening.
      }
    }
  }

  private async runConcat(listPath: string, outputPath: string, fallbackReencode: boolean): Promise<boolean> {
    const spawnConcat = this.deps.spawnConcat ?? defaultConcatSpawn();
    const args = buildConcatArgs({ listPath, outputPath, fallbackReencode });
    const child = spawnConcat(this.deps.ffmpegPath(), args, {
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    return new Promise<boolean>((resolve) => {
      child.proc.on('exit', (code) => {
        resolve(code === 0);
      });
    });
  }

  private clearTimers(): void {
    if (this.sigtermTimer) {
      clearTimeout(this.sigtermTimer);
      this.sigtermTimer = null;
    }
    if (this.sigkillTimer) {
      clearTimeout(this.sigkillTimer);
      this.sigkillTimer = null;
    }
    if (this.startWatchdog) {
      clearTimeout(this.startWatchdog);
      this.startWatchdog = null;
    }
  }

  private resolvePendingStop(): void {
    const pending = this.pendingStop;
    this.pendingStop = null;
    if (pending) pending.resolve();
  }

  // ponytail: stop path needs finalizeCurrentSegment to await the concat
  // subprocess, but the supervisor's resetInternalState wipes the live
  // fields before finalizeCurrentSegment runs. Capture a context snapshot
  // in onExit so the rename/concat can read it after the reset.
  private resolvePendingStopWithContext(ctx: FinalizeContext): void {
    const pending = this.pendingStop;
    this.pendingStop = null;
    if (!pending) return;
    pending.resolve(ctx);
  }

  // ponytail: stop() runs this when entered from the 'paused' state and the
  // child ref is null. Mirrors the bookkeeping onExit's stop-path performs
  // (updateFinalized + audit + emit 'stopped' + reset), then runs
  // finalizeCurrentSegment for the concat/rename step. Replaces the older
  // single-line `if (!child) return;` early return, which left pendingStop
  // unresolved and caused the renderer button to stay "Stop Recording"
  // indefinitely after a pause.
  private async finalizeStopFromPaused(): Promise<void> {
    const procedureId = this.procedureId;
    const startedAt = this.startedAt ?? this.deps.clock.now();
    const endedAt = this.deps.clock.now();
    const durationSeconds = Math.max(
      0,
      Math.floor((endedAt - startedAt) / 1000),
    );
    if (!procedureId || !this.outputRelPath || !this.mediaDir) {
      this.state = 'idle';
      return;
    }
    // closedSegments already has the paused segment pushed by the pause
    // exit branch. The currentSegmentRelPath / currentSegmentStartedAt
    // were nulled there too, so the duplicate-push guard in onExit's
    // stop-append branch was never reachable anyway — we synthesize
    // the same finalize context directly.
    const finalizeContext = {
      procedureId,
      patientId: this.patientId,
      mediaDir: this.mediaDir,
      outputRelPath: this.outputRelPath,
      currentSegmentRelPath: this.currentSegmentRelPath,
      segments: this.closedSegments,
      startedAt,
      endedAt,
      durationSeconds,
      finalStatus: 'completed' as const,
    };
    this.deps.procedures.updateFinalized(procedureId, {
      endedAt,
      durationSeconds,
      status: 'completed',
      videoPath: this.outputRelPath,
    });
    this.deps.audit({
      action: 'recording.stopped',
      entityType: 'procedure',
      entityId: procedureId,
      metadata: {
        deviceName: this.deviceName,
        preset: this.presetSummaryForAudit(),
        durationSeconds,
        segmentCount: this.closedSegments.length,
      },
    });
    this.deps.emit({
      status: 'stopped',
      startedAt,
      procedureId,
    });
    recorderRegistry.delete(procedureId);
    // ponytail: same teardown order as onExit's stop path — preview server
    // first, then internal state wipe.
    await this.stopPreviewServer();
    this.resetInternalState();
    this.state = 'idle';
    await this.finalizeCurrentSegment(finalizeContext);
  }

  private resetInternalState(): void {
    this.child = null;
    this.startedAt = null;
    this.outputPath = null;
    this.outputRelPath = null;
    this.procedureId = null;
    this.patientId = null;
    this.mediaDir = null;
    this.stderrBuffer = '';
    this.frameSeen = false;
    this.exitHandler = null;
    this.currentSegmentIndex = 0;
    this.currentSegmentStartedAt = null;
    this.currentSegmentRelPath = null;
    this.closedSegments = [];
    this.presetSummary = null;
    this.deviceLostInProgress = false;
    this.lostAt = null;
    this.finalizeStatusOnStop = 'completed';
    this.stopPromise = null;
    this.resolveStopPromiseFn = null;
    // ponytail: drop the preview server reference; stop() / forceCleanup()
    // already called .stop() on it. We only null the field here so the
    // next start() can allocate a fresh one without a stale dangling
    // reference.
    this.previewServer = null;
    this.previewUrl = null;
    this.previewTcpPort = null;
  }

  /**
   * Stop the live preview server (idempotent, swallow errors). Called from
   * every finalize path — normal stop, pause→stop, device-lost stop, and
   * forceCleanup. After this returns, no HTTP clients can connect and
   * ffmpeg's TCP socket is gone.
   */
  private async stopPreviewServer(): Promise<void> {
    const server = this.previewServer;
    if (!server) return;
    try {
      await server.stop();
    } catch (err) {
      // ponytail: cleanup path — never throw out of stop()/forceCleanup.
      // A leaked socket is the worst case; the recorder still finalizes
      // correctly and the next start() allocates fresh ports.
      this.deps.audit({
        action: 'recording.preview_server_stop_failed',
        entityType: 'procedure',
        entityId: this.procedureId,
        metadata: { error: (err as Error).message },
        outcome: 'failed',
      });
    }
  }

  /**
   * Force-kill the live child and drop the registry entry without going
   * through the normal stop() finalization path. Used by the renderer
   * when it unmounts ProcedureRoom mid-recording (e.g. doctor clicks
   * "Back to Preview"). The recording row is NOT updated — the doctor's
   * intent here is "abandon this session". State goes to 'idle' so a
   * subsequent start() can register cleanly.
   */
  forceCleanup(): void {
    this.clearTimers();
    const procedureId = this.procedureId;
    try {
      if (this.child) {
        try {
          this.child.proc.kill('SIGKILL');
        } catch {
          // ignore — process may already be dead
        }
      }
    } finally {
      // Drop the entry even if kill() throws — the doctor's session
      // is over either way.
      recorderRegistry.delete(procedureId ?? '');
      // ponytail: preview server stop is async but forceCleanup is sync.
      // Fire-and-forget — the server's close() cleans up sockets in the
      // background; even if it never resolves the OS reclaims the ports
      // when the main process exits.
      void this.stopPreviewServer();
      this.resetInternalState();
      this.state = 'idle';
      this.exitHandler = null;
    }
  }
}

function separator(): string {
  // ponytail: derive from outputPath format instead of hard-coding '/' — works on Windows too.
  return require('node:path').sep;
}

function joinPath(...parts: string[]): string {
  // ponytail: use node:path.join so Windows + POSIX both work without
  // duplicating the separator logic in callers.
  return require('node:path').join(...parts);
}

function relativeVideoPath(_patientId: string, _procedureId: string): string {
  // G-05-5 — `procedures.video_path` is a FILENAME within the procedure
  // directory (e.g. `video.mp4`). NOT a userData-relative path. The
  // resolver `paths.ts::videoFilePath` joins the userData root at READ
  // time; the writer side stores just the filename. Args retained for
  // API symmetry but unused — see D-07.
  void _patientId;
  void _procedureId;
  return 'video.mp4';
}

// ponytail: child_process import is lazy-loaded so tests can mock it via deps.
let cachedSpawn: SpawnFn | null = null;
export function defaultSpawn(): SpawnFn {
  if (cachedSpawn) return cachedSpawn;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cp: typeof import('node:child_process') = require('node:child_process');
  cachedSpawn = (command, args, options) => {
    const proc = cp.spawn(command, args as string[], options) as unknown as ChildProcess;
    return {
      proc: {
        stdin: proc.stdin as unknown as { write: (s: string) => boolean },
        on: (event, cb) =>
          proc.on(event as 'exit', cb as (...args: unknown[]) => void),
        kill: (signal) => proc.kill(signal),
      },
      stderr: {
        on: (event, cb) =>
          (proc.stderr as unknown as { on: (e: string, c: (chunk: Buffer) => void) => unknown }).on(
            event,
            cb,
          ),
      },
    };
  };
  return cachedSpawn;
}

let cachedConcatSpawn: ConcatSpawnFn | null = null;
export function defaultConcatSpawn(): ConcatSpawnFn {
  if (cachedConcatSpawn) return cachedConcatSpawn;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cp: typeof import('node:child_process') = require('node:child_process');
  cachedConcatSpawn = (command, args, options) => {
    const proc = cp.spawn(command, args as string[], options) as unknown as ChildProcess;
    return {
      proc: {
        on: (event, cb) =>
          proc.on(event as 'exit', cb as (...args: unknown[]) => void),
      },
    };
  };
  return cachedConcatSpawn;
}

// ponytail: real fs injection for production; tests can stub via deps.procFs.
let cachedProcFs: ProcFs | null = null;
export function defaultProcFs(): ProcFs {
  if (cachedProcFs) return cachedProcFs;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs: typeof import('node:fs') = require('node:fs');
  cachedProcFs = {
    openSync: (p, f) => fs.openSync(p, f),
    fsyncSync: (fd) => fs.fsyncSync(fd),
    closeSync: (fd) => fs.closeSync(fd),
    statSync: (p) => fs.statSync(p),
    renameSync: fs.renameSync,
    unlinkSync: fs.unlinkSync,
    existsSync: fs.existsSync,
    writeFileSync: (p, c) => fs.writeFileSync(p, c),
  };
  return cachedProcFs;
}

// ponytail: PreviewServer factory for production. Tests inject their own
// via deps.createPreviewServer so they don't bind real ports during
// recorder.test.ts runs.
export function defaultCreatePreviewServer(): PreviewServer {
  return new PreviewServer();
}

export function buildDefaultDeps(overrides: Partial<RecorderDeps> = {}): RecorderDeps {
  return {
    spawn: defaultSpawn(),
    spawnConcat: defaultConcatSpawn(),
    clock: { now: () => Date.now() },
    procFs: defaultProcFs(),
    procedures: proceduresRepo as unknown as ProceduresSubRepo,
    audit: (opts) => {
      audit({
        action: opts.action,
        entityType: opts.entityType ?? null,
        entityId: opts.entityId ?? null,
        metadata: opts.metadata ?? null,
        outcome: opts.outcome ?? 'ok',
      });
    },
    ffmpegPath: () => defaultFfmpegPath(),
    canonicalDevice: (deviceId) => canonicalizeOrThrow(deviceId),
    emit: () => {
      // Default emit is a no-op; main/index.ts wires the real push-event forwarder.
    },
    resolveDeviceName: (deviceId) => canonicalizeOrThrow(deviceId),
    createPreviewServer: defaultCreatePreviewServer,
    ...overrides,
  };
}

// (reserved marker — no additional imports needed)