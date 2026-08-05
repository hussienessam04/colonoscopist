// Recorder supervisor — one ffmpeg child per procedureId.
// Per CAPT-04/05/06/07 + D-01 + D-03 + D-10 + D-11 + RESEARCH §6.
//
// State machine:
//   idle → starting → recording ⇄ paused → stopping → idle
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
  options: { windowsVerbatimArguments: boolean; stdio: ['pipe', 'ignore', 'pipe'] },
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
  options: { windowsVerbatimArguments: boolean },
) => ConcatChild;

export type ProcFs = {
  openSync: (path: string, flags: string) => number;
  fsyncSync: (fd: number) => void;
  closeSync: (fd: number) => void;
  statSync: (path: string) => { size: number };
  renameSync: (oldPath: string, newPath: string) => void;
  unlinkSync: (path: string) => void;
  existsSync: (path: string) => boolean;
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
};

type RecorderState = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping';

const SIGTERM_GRACE_MS = 5_000;
const SIGKILL_FALLBACK_MS = 5_500;

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
  private deviceName = '';
  private currentSegmentStartedAt: number | null = null;
  private currentSegmentRelPath: string | null = null;
  // Closed segments for concat (D-11): closed segments are appended to this
  // array; on stop() the supervisor concatenates them with the live one into
  // the canonical mp4. When segments.length === 0 (never paused), the live
  // file is the canonical mp4 — no concat subprocess runs.
  private closedSegments: Array<{ segmentIndex: number; relPath: string; startedAt: number; endedAt: number }> = [];
  private presetSummary: PresetSummary | null = null;

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
  }): Promise<{ procedureId: string; startedAt: number }> {
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

    const args2 = buildFfmpegArgs({
      deviceName: this.deviceName,
      preset: args.preset,
      outputPath: this.outputPath,
    });

    const child = this.deps.spawn(this.deps.ffmpegPath(), args2, {
      windowsVerbatimArguments: true,
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    this.child = child;

    child.stderr.on('data', (chunk: Buffer) => {
      this.onStderr(chunk.toString());
    });

    this.exitHandler = (code, signal) => this.onExit(code, signal);
    child.proc.on('exit', this.exitHandler);

    // startedAt will be set when ffmpeg emits the first 'frame=' line (D-10).
    return { procedureId: args.procedureId, startedAt: this.deps.clock.now() };
  }

  async stop(): Promise<void> {
    if (this.state !== 'recording' && this.state !== 'paused') {
      throw new Error(`Cannot stop recorder in state=${this.state}`);
    }
    this.state = 'stopping';
    const child = this.child;
    if (!child) {
      // No live child — already finalized (or never started). Nothing to do.
      return;
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
    });
    const child = this.deps.spawn(this.deps.ffmpegPath(), args2, {
      windowsVerbatimArguments: true,
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
    if (this.frameSeen) return;
    if (!this.stderrBuffer.includes('frame=')) return;
    this.frameSeen = true;
    const now = this.deps.clock.now();
    if (this.state === 'starting' && this.procedureId) {
      this.deps.procedures.updateStartedAt(this.procedureId, now);
    }
    this.startedAt = now;
    this.currentSegmentStartedAt = now;
    if (this.state === 'starting') {
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
      // can rebuild the segment timeline from the audit log alone.
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
        startedAt: now,
        currentSegmentIndex: segmentIndex,
      });
    }
  }

  private onExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.clearTimers();
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
    let finalStatus: 'completed' | 'partial' | 'crashed' = 'completed';
    if (signal === 'SIGKILL' || (code !== null && code !== 0 && signal !== 'SIGTERM')) {
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
      this.deps.audit({
        action: 'recording.stop_no_exit',
        entityType: 'procedure',
        entityId: procedureId,
        metadata: { outcome: 'failed', error: (err as Error).message },
        outcome: 'failed',
      });
      finalStatus = 'partial';
    }
    const isStop = this.state === 'stopping';
    // Pause path: append the just-closed segment to closedSegments and emit
    // paused. The supervisor stays alive (registry holds it); resume() will
    // spawn a fresh child for the next segment.
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
    // signal/code are reserved for Plan 04 device-lost detection.
    void code;
    void signal;
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
      windowsVerbatimArguments: true,
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

function relativeVideoPath(patientId: string, procedureId: string): string {
  // Stored relative to userData per Anti-Pattern 2.
  return `data/media/patients/${patientId}/${procedureId}/video.mp4`;
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
  };
  return cachedProcFs;
}

export function buildDefaultDeps(overrides: Partial<RecorderDeps> = {}): RecorderDeps {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { proceduresRepo } = require('../db/procedures-repo') as typeof import('../db/procedures-repo');
  return {
    spawn: defaultSpawn(),
    spawnConcat: defaultConcatSpawn(),
    clock: { now: () => Date.now() },
    procFs: defaultProcFs(),
    procedures: proceduresRepo as unknown as ProceduresSubRepo,
    audit: (opts) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { audit } = require('../db/audit') as typeof import('../db/audit');
      audit({
        action: opts.action,
        entityType: opts.entityType ?? null,
        entityId: opts.entityId ?? null,
        metadata: opts.metadata ?? null,
        outcome: opts.outcome ?? 'ok',
      });
    },
    ffmpegPath: () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { defaultFfmpegPath } = require('./ffmpeg-path') as typeof import('./ffmpeg-path');
      return defaultFfmpegPath();
    },
    canonicalDevice: (deviceId) => canonicalizeOrThrow(deviceId),
    emit: () => {
      // Default emit is a no-op; main/index.ts wires the real push-event forwarder.
    },
    resolveDeviceName: (deviceId) => canonicalizeOrThrow(deviceId),
    ...overrides,
  };
}

// (reserved marker — no additional imports needed)