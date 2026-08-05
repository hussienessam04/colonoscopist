// Supervisor transition tests for the Recorder class (per RESEARCH.md §6).
// Plan 04-01 covers start/stop/fsync happy paths + registry busy error.
// Plan 04-03 fills pause/resume transitions + segment-and-concat finalize path
// (D-11) + re-encode fallback on concat failure.
// Plan 04 fills device-lost + scanForOrphans + crash recovery.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let tmpDir: string;

vi.mock('electron', () => ({
  app: {
    getPath: () => tmpDir,
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b,
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  },
  ipcMain: {
    handle: () => {},
    on: () => {},
  },
  contextBridge: {
    exposeInMainWorld: () => {},
  },
  ipcRenderer: {
    invoke: async () => null,
    on: () => {},
    removeListener: () => {},
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-recorder-'));
});

afterEach(() => {
  vi.resetModules();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});
import {
  Recorder,
  type RecorderDeps,
  type RecorderChild,
  type ConcatSpawnFn,
  type ProcFs,
} from '../../../src/main/recorder/recorder';
import {
  recorderRegistry,
  __resetRecorderRegistry,
} from '../../../src/main/recorder/registry';
import {
  __resetProceduresRepoCache,
  proceduresRepo,
} from '../../../src/main/db/procedures-repo';
import { audit } from '../../../src/main/db/audit';
import type { PresetSummary } from '@shared/ipc-contract';

type FakeChild = ReturnType<typeof makeFakeChild>;
type FakeProcFs = ReturnType<typeof makeFakeProcFs>;

function makeFakeChild(opts: { exitOn?: 'sync' | 'next-tick' } = {}): {
  writes: string[];
  stderrListeners: Array<(chunk: Buffer) => void>;
  triggerExit: (code: number | null, signal: NodeJS.Signals | null) => void;
} & RecorderChild {
  const writes: string[] = [];
  const stderrListeners: Array<(chunk: Buffer) => void> = [];
  let exitHandler: ((code: number | null, signal: NodeJS.Signals | null) => void) | null = null;
  const child: FakeChild & RecorderChild = {
    writes,
    stderrListeners,
    proc: {
      stdin: {
        write: (s: string) => {
          writes.push(s);
          return true;
        },
      },
      on: (_event, cb) => {
        exitHandler = cb;
      },
      kill: vi.fn(),
    },
    stderr: {
      on: (_event, cb) => {
        stderrListeners.push(cb);
        return undefined;
      },
    },
    triggerExit(code, signal) {
      exitHandler?.(code, signal);
    },
  };
  if (opts.exitOn === 'sync') {
    // caller triggers manually via triggerExit
  }
  return child;
}

function makeFakeProcFs(): {
  opens: string[];
  fsyncs: number[];
  closes: number[];
  renames: Array<{ from: string; to: string }>;
  unlinks: string[];
} & ProcFs {
  const opens: string[] = [];
  const fsyncs: number[] = [];
  const closes: number[] = [];
  const renames: Array<{ from: string; to: string }> = [];
  const unlinks: string[] = [];
  let nextFd = 1;
  return {
    opens,
    fsyncs,
    closes,
    renames,
    unlinks,
    openSync: (p: string) => {
      opens.push(p);
      return nextFd++;
    },
    fsyncSync: (fd: number) => {
      fsyncs.push(fd);
    },
    closeSync: (fd: number) => {
      closes.push(fd);
    },
    statSync: () => ({ size: 1024 }),
    renameSync: (from, to) => {
      renames.push({ from, to });
    },
    unlinkSync: (p: string) => {
      unlinks.push(p);
    },
    existsSync: () => true,
    writeFileSync: () => undefined,
  };
}

type MakeDepsOpts = {
  children?: Array<ReturnType<typeof makeFakeChild>>;
  procFs?: FakeProcFs;
  clock: () => number;
  emit: (status: unknown) => void;
  spawnConcat?: ConcatSpawnFn;
};

function makeDeps(opts: MakeDepsOpts): {
  deps: RecorderDeps;
  spawned: Array<{ args: readonly string[] }>;
  concatSpawns: Array<{ args: readonly string[]; exitCode: number }>;
  procFs: FakeProcFs;
} {
  const spawned: Array<{ args: readonly string[] }> = [];
  const concatSpawns: Array<{ args: readonly string[]; exitCode: number }> = [];
  const procFs = opts.procFs ?? makeFakeProcFs();
  const childQueue = opts.children ?? [makeFakeChild()];
  let spawnIdx = 0;
  const spawnFn: RecorderDeps['spawn'] = (_cmd, args, _opts) => {
    spawned.push({ args });
    const child = childQueue[spawnIdx] ?? makeFakeChild();
    spawnIdx++;
    return child as unknown as RecorderChild;
  };
  const spawnConcatFn: ConcatSpawnFn = (_cmd, args, _opts) => {
    const idx = concatSpawns.length;
    // Default behavior: succeed (exitCode 0). Tests can override via spawnConcat.
    concatSpawns.push({ args, exitCode: 0 });
    return {
      proc: {
        on: (event, cb) => {
          if (event === 'exit') {
            const exitCode = opts.spawnConcat
              ? // We use the index to decide; tests pass a custom spawnConcat
                // that re-runs and emits based on idx.
                0
              : 0;
            void idx;
            setTimeout(
              () => (cb as (c: number | null, s: NodeJS.Signals | null) => void)(exitCode, null),
              0,
            );
          }
          return undefined;
        },
      },
    };
  };
  const deps: RecorderDeps = {
    spawn: spawnFn,
    spawnConcat: opts.spawnConcat ?? spawnConcatFn,
    clock: { now: opts.clock },
    procFs,
    procedures: {
      insert: vi.fn(),
      updateStartedAt: vi.fn(),
      updateFinalized: vi.fn(),
      insertSegment: vi.fn(),
    },
    audit: vi.fn() as unknown as RecorderDeps['audit'],
    ffmpegPath: () => 'ffmpeg-test',
    canonicalDevice: (id: string) => id,
    emit: opts.emit as RecorderDeps['emit'],
    resolveDeviceName: (id: string) => id,
  };
  return { deps, spawned, concatSpawns, procFs };
}

const SAMPLE_PRESET_SUMMARY: PresetSummary = {
  kind: 'sd',
  resolution: '720x480',
  framerate: 30,
  bitrate: '4M',
};

const SAMPLE_PRESET = { preset: 'sd' as const };

async function startRecording(
  deps: RecorderDeps,
  recorder: Recorder,
  opts: { procedureId: string; patientId: string },
): Promise<FakeChild> {
  await recorder.start({
    procedureId: opts.procedureId,
    deviceId: 'Cam',
    patientId: opts.patientId,
    doctorId: 'doc1',
    preset: SAMPLE_PRESET,
    presetSummary: SAMPLE_PRESET_SUMMARY,
  });
  // After start, the child that was spawned is exposed via the (deps.spawn)
  // closure. We need access to it for stderr pushes. We assume single-child
  // case — caller passes children[0] if more control is needed.
  return undefined as unknown as FakeChild;
}

describe('Recorder supervisor', () => {
  beforeEach(() => {
    __resetRecorderRegistry();
    __resetProceduresRepoCache();
  });
  afterEach(() => {
    __resetRecorderRegistry();
  });

  it('start: writes recording.started audit on first frame= stderr + emits RecordingStatus', async () => {
    const child = makeFakeChild();
    let now = 1_000;
    const emits: unknown[] = [];
    const { deps } = makeDeps({
      children: [child],
      clock: () => now,
      emit: (s) => emits.push(s),
    });
    const r = new Recorder(deps);

    const start = await r.start({
      procedureId: 'p1',
      deviceId: 'Cam',
      patientId: 'pat1',
      doctorId: 'doc1',
      preset: { preset: 'hd' },
      presetSummary: { kind: 'hd', resolution: '1920x1080', framerate: 30, bitrate: '10M' },
    });
    expect(start.procedureId).toBe('p1');

    // emit first frame= chunk
    child.stderrListeners[0](Buffer.from('frame=  120 fps=30 q=23.0\n'));
    now = 1_500;
    child.stderrListeners[0](Buffer.from('frame=  150 fps=30 q=23.0\n'));

    expect(deps.procedures.updateStartedAt).toHaveBeenCalledWith('p1', 1_000);
    expect(deps.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'recording.started' }),
    );
    expect(emits).toContainEqual({
      status: 'started',
      startedAt: 1_000,
      currentSegmentIndex: 0,
    });

    // registry holds the recorder
    expect(recorderRegistry.has('p1')).toBe(true);
  });

  it('stop: writes q\\n to stdin within 50 ms, fsyncs the open fd, updates the row, emits stopped', async () => {
    const child = makeFakeChild();
    let now = 2_000;
    const emits: unknown[] = [];
    const { deps, procFs } = makeDeps({
      children: [child],
      clock: () => now,
      emit: (s) => emits.push(s),
    });
    const r = new Recorder(deps);

    await r.start({
      procedureId: 'p2',
      deviceId: 'Cam',
      patientId: 'pat2',
      doctorId: 'doc1',
      preset: { preset: 'sd' },
      presetSummary: SAMPLE_PRESET_SUMMARY,
    });

    // simulate ffmpeg becoming ready
    child.stderrListeners[0](Buffer.from('frame= 100\n'));
    now = 2_500;
    const stopStart = Date.now();
    const stopPromise = r.stop();
    expect(Date.now() - stopStart).toBeLessThan(50);
    expect(child.writes).toContain('q\n');

    // simulate exit
    now = 3_000;
    child.triggerExit(0, null);

    await stopPromise;
    // Allow the concat subprocess setTimeout(0) to flush (no concat here, but
    // the finalizeCurrentSegment microtask still drains).
    await new Promise((res) => setTimeout(res, 5));

    expect(procFs.opens).toHaveLength(1);
    expect(procFs.fsyncs).toHaveLength(1);
    expect(procFs.closes).toHaveLength(1);
    // ponytail: first segment is `video-seg0.mp4` (D-11); the canonical
    // `video.mp4` is written by finalizeCurrentSegment via rename (no pauses).
    expect(procFs.opens[0]).toMatch(/video-seg0\.mp4$/);
    expect(procFs.fsyncs[0]).toBe(1);
    // No pauses → no concat → segment renamed to video.mp4.
    expect(procFs.renames).toHaveLength(1);
    expect(procFs.renames[0].from).toMatch(/video-seg0\.mp4$/);
    expect(procFs.renames[0].to).toMatch(/video\.mp4$/);

    expect(deps.procedures.updateFinalized).toHaveBeenCalledWith(
      'p2',
      expect.objectContaining({
        status: 'completed',
        durationSeconds: expect.any(Number),
      }),
    );
    expect(deps.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'recording.stopped' }),
    );
    expect(emits).toContainEqual({
      status: 'stopped',
      startedAt: 2_000,
      procedureId: 'p2',
    });
    expect(recorderRegistry.has('p2')).toBe(false);
  });

  it('rejects a second start() for the same procedureId via the registry', async () => {
    const child1 = makeFakeChild();
    const { deps: deps1 } = makeDeps({
      children: [child1],
      clock: () => 1_000,
      emit: () => {},
    });
    const r1 = new Recorder(deps1);

    await r1.start({
      procedureId: 'pX',
      deviceId: 'Cam',
      patientId: 'pat1',
      doctorId: 'doc1',
      preset: { preset: 'hd' },
      presetSummary: { kind: 'hd', resolution: '1920x1080', framerate: 30, bitrate: '10M' },
    });

    // Second recorder instance tries the same id; the registry throws.
    const child2 = makeFakeChild();
    const { deps: deps2 } = makeDeps({
      children: [child2],
      clock: () => 1_500,
      emit: () => {},
    });
    const r2 = new Recorder(deps2);

    await expect(
      r2.start({
        procedureId: 'pX',
        deviceId: 'Cam',
        patientId: 'pat2',
        doctorId: 'doc1',
        preset: { preset: 'sd' },
        presetSummary: SAMPLE_PRESET_SUMMARY,
      }),
    ).rejects.toThrow(/Recorder already active|already active|busy/i);
  });

  it('pause: writes q\\n, closes segment, inserts procedure_segments row, emits paused', async () => {
    const child = makeFakeChild();
    let now = 4_000;
    const emits: unknown[] = [];
    const { deps } = makeDeps({
      children: [child],
      clock: () => now,
      emit: (s) => emits.push(s),
    });
    const r = new Recorder(deps);

    await r.start({
      procedureId: 'p3',
      deviceId: 'Cam',
      patientId: 'pat3',
      doctorId: 'doc1',
      preset: { preset: 'sd' },
      presetSummary: SAMPLE_PRESET_SUMMARY,
    });
    child.stderrListeners[0](Buffer.from('frame= 100\n'));
    now = 4_500;
    const pausePromise = r.pause();
    expect(child.writes).toContain('q\n');
    now = 5_000;
    child.triggerExit(0, null);
    await pausePromise;

    expect(deps.procedures.insertSegment).toHaveBeenCalledWith(
      expect.objectContaining({
        procedureId: 'p3',
        segmentIndex: 0,
        filePath: 'video-seg0.mp4',
        startedAt: 4_000,
        endedAt: 5_000,
      }),
    );
    expect(deps.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'recording.paused',
        metadata: expect.objectContaining({ segmentIndex: 0 }),
      }),
    );
    // ponytail: paused event carries the wall-clock time at pause so the
    // renderer-side `pausedAt - originalStartedAt` derivation shows the
    // elapsed time at the pause moment.
    expect(emits).toContainEqual({
      status: 'paused',
      startedAt: 5_000,
      currentSegmentIndex: 0,
    });
    // ponytail: registry still holds the recorder — pause does NOT release it.
    expect(recorderRegistry.has('p3')).toBe(true);
  });

  it('resume: spawns a SECOND ffmpeg child with outputPath video-seg1.mp4 + emits resumed', async () => {
    const child1 = makeFakeChild();
    const child2 = makeFakeChild();
    let now = 6_000;
    const emits: unknown[] = [];
    const { deps, spawned } = makeDeps({
      children: [child1, child2],
      clock: () => now,
      emit: (s) => emits.push(s),
    });
    const r = new Recorder(deps);

    await r.start({
      procedureId: 'p4',
      deviceId: 'Cam',
      patientId: 'pat4',
      doctorId: 'doc1',
      preset: { preset: 'sd' },
      presetSummary: SAMPLE_PRESET_SUMMARY,
    });
    child1.stderrListeners[0](Buffer.from('frame= 100\n'));
    now = 6_500;
    const pausePromise = r.pause();
    child1.triggerExit(0, null);
    await pausePromise;

    // Resume — the next spawn() is the new ffmpeg child.
    await r.resume();
    expect(spawned).toHaveLength(2);
    // The outputPath (-y flag value) is the absolute path to video-seg1.mp4.
    const yIdx = spawned[1].args.indexOf('-y');
    expect(spawned[1].args[yIdx + 1]).toMatch(/video-seg1\.mp4$/);

    // Simulate first frame on the new child — emits 'resumed'.
    now = 7_000;
    child2.stderrListeners[0](Buffer.from('frame= 100\n'));
    expect(emits).toContainEqual({
      status: 'resumed',
      startedAt: 7_000,
      currentSegmentIndex: 1,
    });
    expect(deps.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'recording.resumed',
        metadata: expect.objectContaining({ segmentIndex: 1 }),
      }),
    );
  });

  it('stop after pause: spawns concat subprocess with -c copy, deletes segment files', async () => {
    const child1 = makeFakeChild();
    const child2 = makeFakeChild();
    let now = 8_000;
    const emits: unknown[] = [];
    const { deps, concatSpawns, procFs } = makeDeps({
      children: [child1, child2],
      clock: () => now,
      emit: (s) => emits.push(s),
    });
    const r = new Recorder(deps);

    await r.start({
      procedureId: 'p5',
      deviceId: 'Cam',
      patientId: 'pat5',
      doctorId: 'doc1',
      preset: { preset: 'sd' },
      presetSummary: SAMPLE_PRESET_SUMMARY,
    });
    child1.stderrListeners[0](Buffer.from('frame= 100\n'));
    now = 8_500;
    const pausePromise = r.pause();
    child1.triggerExit(0, null);
    await pausePromise;
    await r.resume();
    child2.stderrListeners[0](Buffer.from('frame= 100\n'));
    now = 9_000;
    const stopPromise = r.stop();
    child2.triggerExit(0, null);
    await stopPromise;
    // Drain the concat subprocess setTimeout(0) exit.
    await new Promise((res) => setTimeout(res, 10));

    expect(concatSpawns).toHaveLength(1);
    // -c copy args.
    expect(concatSpawns[0].args).toContain('-c');
    expect(concatSpawns[0].args[concatSpawns[0].args.indexOf('-c') + 1]).toBe('copy');
    expect(concatSpawns[0].args).toContain('-movflags');
    expect(concatSpawns[0].args[concatSpawns[0].args.indexOf('-movflags') + 1]).toBe('+faststart');
    expect(emits).toContainEqual(expect.objectContaining({ status: 'stopped', procedureId: 'p5' }));
    // The audit row carries segmentCount === 2 (pause→resume→stop produced
    // two segments: the first paused segment + the resumed segment that was
    // active when stop was pressed).
    expect(deps.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'recording.stopped',
        metadata: expect.objectContaining({ segmentCount: 2 }),
      }),
    );
    // Both segment files unlinked after successful concat.
    expect(procFs.unlinks.length).toBeGreaterThanOrEqual(2);
    expect(procFs.unlinks.some((p) => /video-seg0\.mp4$/.test(p))).toBe(true);
    expect(procFs.unlinks.some((p) => /video-seg1\.mp4$/.test(p))).toBe(true);
  });

  it('stop with no pauses: skips concat subprocess, renames single segment to video.mp4', async () => {
    const child = makeFakeChild();
    let now = 10_000;
    const emits: unknown[] = [];
    const { deps, concatSpawns, procFs } = makeDeps({
      children: [child],
      clock: () => now,
      emit: (s) => emits.push(s),
    });
    const r = new Recorder(deps);

    await r.start({
      procedureId: 'p6',
      deviceId: 'Cam',
      patientId: 'pat6',
      doctorId: 'doc1',
      preset: { preset: 'sd' },
      presetSummary: SAMPLE_PRESET_SUMMARY,
    });
    child.stderrListeners[0](Buffer.from('frame= 100\n'));
    now = 10_500;
    const stopPromise = r.stop();
    child.triggerExit(0, null);
    await stopPromise;
    await new Promise((res) => setTimeout(res, 10));

    expect(concatSpawns).toHaveLength(0);
    expect(procFs.renames).toHaveLength(1);
    expect(procFs.renames[0].from).toMatch(/video-seg0\.mp4$/);
    expect(procFs.renames[0].to).toMatch(/video\.mp4$/);
    expect(emits).toContainEqual(expect.objectContaining({ status: 'stopped', procedureId: 'p6' }));
  });

  it('stop with concat non-zero exit: retries with reencode args; second success finalizes completed', async () => {
    const child1 = makeFakeChild();
    const child2 = makeFakeChild();
    let now = 12_000;
    const emits: unknown[] = [];
    // Custom concat spawn: first call fails (-c copy), second call (reencode) succeeds.
    const concatSpawns: Array<{ args: readonly string[]; exitCode: number }> = [];
    const spawnConcat: ConcatSpawnFn = (_cmd, args, _opts) => {
      const idx = concatSpawns.length;
      const exitCode = idx === 0 ? 1 : 0;
      concatSpawns.push({ args, exitCode });
      return {
        proc: {
          on: (event, cb) => {
            if (event === 'exit') {
              setTimeout(
                () => (cb as (c: number | null, s: NodeJS.Signals | null) => void)(exitCode, null),
                0,
              );
            }
            return undefined;
          },
        },
      };
    };
    const { deps } = makeDeps({
      children: [child1, child2],
      clock: () => now,
      emit: (s) => emits.push(s),
      spawnConcat,
    });
    const r = new Recorder(deps);

    await r.start({
      procedureId: 'p7',
      deviceId: 'Cam',
      patientId: 'pat7',
      doctorId: 'doc1',
      preset: { preset: 'sd' },
      presetSummary: SAMPLE_PRESET_SUMMARY,
    });
    child1.stderrListeners[0](Buffer.from('frame= 100\n'));
    now = 12_500;
    const pausePromise = r.pause();
    child1.triggerExit(0, null);
    await pausePromise;
    await r.resume();
    child2.stderrListeners[0](Buffer.from('frame= 100\n'));
    now = 13_000;
    const stopPromise = r.stop();
    child2.triggerExit(0, null);
    await stopPromise;
    await new Promise((res) => setTimeout(res, 10));

    expect(concatSpawns).toHaveLength(2);
    // First call: -c copy.
    expect(concatSpawns[0].args).toContain('copy');
    // Second call: -c:v libx264.
    expect(concatSpawns[1].args).toContain('libx264');
    expect(concatSpawns[1].args).toContain('veryfast');
    expect(concatSpawns[1].args).toContain('23');
    expect(emits).toContainEqual(expect.objectContaining({ status: 'stopped', procedureId: 'p7' }));
  });

  it('stop with concat AND reencode both failing: writes recording.concat_failed audit, finalizes partial, emits lost', async () => {
    const child1 = makeFakeChild();
    const child2 = makeFakeChild();
    let now = 14_000;
    const emits: unknown[] = [];
    const concatSpawns: Array<{ args: readonly string[]; exitCode: number }> = [];
    const spawnConcat: ConcatSpawnFn = (_cmd, args, _opts) => {
      const idx = concatSpawns.length;
      // Both calls fail.
      const exitCode = 1;
      concatSpawns.push({ args, exitCode });
      void idx;
      return {
        proc: {
          on: (event, cb) => {
            if (event === 'exit') {
              setTimeout(
                () => (cb as (c: number | null, s: NodeJS.Signals | null) => void)(exitCode, null),
                0,
              );
            }
            return undefined;
          },
        },
      };
    };
    const { deps } = makeDeps({
      children: [child1, child2],
      clock: () => now,
      emit: (s) => emits.push(s),
      spawnConcat,
    });
    const r = new Recorder(deps);

    await r.start({
      procedureId: 'p8',
      deviceId: 'Cam',
      patientId: 'pat8',
      doctorId: 'doc1',
      preset: { preset: 'sd' },
      presetSummary: SAMPLE_PRESET_SUMMARY,
    });
    child1.stderrListeners[0](Buffer.from('frame= 100\n'));
    now = 14_500;
    const pausePromise = r.pause();
    child1.triggerExit(0, null);
    await pausePromise;
    await r.resume();
    child2.stderrListeners[0](Buffer.from('frame= 100\n'));
    now = 15_000;
    const stopPromise = r.stop();
    child2.triggerExit(0, null);
    await stopPromise;
    await new Promise((res) => setTimeout(res, 10));

    expect(concatSpawns).toHaveLength(2);
    expect(deps.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'recording.concat_failed',
        outcome: 'failed',
      }),
    );
    expect(deps.procedures.updateFinalized).toHaveBeenCalledWith(
      'p8',
      expect.objectContaining({ status: 'partial' }),
    );
    expect(emits).toContainEqual(
      expect.objectContaining({
        status: 'lost',
        deviceName: 'Cam',
      }),
    );
  });
});

// silence unused-import warnings in strict environments.
void startRecording;
void audit;
void proceduresRepo;
