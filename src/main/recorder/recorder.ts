// Recorder supervisor — one ffmpeg child per procedureId.
// Per CAPT-04/05/06/07 + D-01 + D-03 + D-10 + RESEARCH §6.
//
// State machine:
//   idle → starting → recording → stopping → idle
//                       ↓
//                    paused (Plan 03 fills body)
//
// All dependencies are injectable (RecorderDeps) so unit tests can replace
// spawn, clock, procFs, proceduresRepo, audit, ffmpegPath, canonicalDevice,
// emit, and concurrentlySpawn without booting Electron or ffmpeg.

import type { ChildProcess } from 'node:child_process';
import { canonicalizeOrThrow } from '../capture/canonicalize';
import { procedureMediaDir } from '../paths';
import { recorderRegistry } from './registry';
import { buildFfmpegArgs } from './ffmpeg-args';
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

export class Recorder {
  private state: RecorderState = 'idle';
  private child: RecorderChild | null = null;
  private procedureId: string | null = null;
  private startedAt: number | null = null;
  private outputPath: string | null = null;
  private outputRelPath: string | null = null;
  private currentSegmentIndex = 0;
  private stderrBuffer = '';
  private frameSeen = false;
  private exitHandler: ((code: number | null, signal: NodeJS.Signals | null) => void) | null = null;
  private pendingStop: { resolve: () => void; reject: (err: unknown) => void } | null = null;
  private sigtermTimer: ReturnType<typeof setTimeout> | null = null;
  private sigkillTimer: ReturnType<typeof setTimeout> | null = null;
  private deviceName = '';

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
    this.deviceName = this.deps.canonicalDevice(args.deviceId);

    const mediaDir = procedureMediaDir(args.patientId, args.procedureId);
    this.outputPath = `${mediaDir}${separator()}video.mp4`;
    this.outputRelPath = relativeVideoPath(args.patientId, args.procedureId);

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
      this.state = 'idle';
      return;
    }
    return new Promise<void>((resolve, reject) => {
      this.pendingStop = { resolve, reject };
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

  async pause(): Promise<void> {
    throw new Error('pause/resume ships in plan 03');
  }

  async resume(): Promise<void> {
    throw new Error('pause/resume ships in plan 03');
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
    if (this.procedureId) {
      this.deps.procedures.updateStartedAt(this.procedureId, now);
    }
    this.startedAt = now;
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
  }

  private onExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.clearTimers();
    const procedureId = this.procedureId;
    const outputPath = this.outputPath;
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
      },
    });
    this.deps.emit({
      status: 'stopped',
      startedAt,
      procedureId,
    });
    recorderRegistry.delete(procedureId);
    this.resetInternalState();
    this.resolvePendingStop();
    this.state = 'idle';
    // signal/code are reserved for Plan 04 device-lost detection.
    void code;
    void signal;
  }

  private presetSummaryForAudit(): PresetSummary {
    return {
      kind: 'sd',
      resolution: '720x480',
      framerate: 30,
      bitrate: '4M',
    };
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

  private resetInternalState(): void {
    this.child = null;
    this.startedAt = null;
    this.outputPath = null;
    this.outputRelPath = null;
    this.procedureId = null;
    this.stderrBuffer = '';
    this.frameSeen = false;
    this.exitHandler = null;
  }
}

function separator(): string {
  // ponytail: derive from outputPath format instead of hard-coding '/' — works on Windows too.
  return require('node:path').sep;
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