// Supervisor transition tests for the Recorder class (per RESEARCH.md §6).
// Plan 04-01 covers start/stop/fsync happy paths + registry busy error +
// pause/resume stubs. Plan 03 fills pause/resume behavior; Plan 04 fills
// device-lost + scanForOrphans + crash recovery.

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
import type { PresetSummary, QualityPreset } from '@shared/ipc-contract';

function makeFakeChild(opts: { exitOn?: 'sync' | 'next-tick' } = {}): RecorderChild & {
  triggerExit: (code: number | null, signal: NodeJS.Signals | null) => void;
  writes: string[];
  stderrListeners: Array<(chunk: Buffer) => void>;
} {
  const writes: string[] = [];
  const stderrListeners: Array<(chunk: Buffer) => void> = [];
  let exitHandler: ((code: number | null, signal: NodeJS.Signals | null) => void) | null = null;
  const child = {
    writes,
    stderrListeners,
    proc: {
      stdin: {
        write: (s: string) => {
          writes.push(s);
          return true;
        },
      },
      on: (_event: string, cb: (code: number | null, signal: NodeJS.Signals | null) => void) => {
        exitHandler = cb;
      },
      kill: vi.fn(),
    },
    stderr: {
      on: (_event: 'data', cb: (chunk: Buffer) => void) => {
        stderrListeners.push(cb);
        return undefined;
      },
    },
    triggerExit(code: number | null, signal: NodeJS.Signals | null) {
      exitHandler?.(code, signal);
    },
  };
  if (opts.exitOn === 'sync') {
    // caller triggers manually via triggerExit
  }
  return child;
}

function makeFakeProcFs(): ProcFs & {
  opens: string[];
  fsyncs: number[];
  closes: number[];
} {
  const opens: string[] = [];
  const fsyncs: number[] = [];
  const closes: number[] = [];
  let nextFd = 1;
  return {
    opens,
    fsyncs,
    closes,
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
    renameSync: () => undefined,
    unlinkSync: () => undefined,
    existsSync: () => true,
  };
}

function makeDeps(opts: {
  child: ReturnType<typeof makeFakeChild>;
  procFs: ReturnType<typeof makeFakeProcFs>;
  clock: () => number;
  emit: (status: unknown) => void;
}): RecorderDeps {
  return {
    spawn: () => opts.child as unknown as RecorderChild,
    clock: { now: opts.clock },
    procFs: opts.procFs,
    procedures: {
      insert: vi.fn(),
      updateStartedAt: vi.fn(),
      updateFinalized: vi.fn(),
    },
    audit: vi.fn() as unknown as RecorderDeps['audit'],
    ffmpegPath: () => 'ffmpeg-test',
    canonicalDevice: (id: string) => id,
    emit: opts.emit as RecorderDeps['emit'],
    resolveDeviceName: (id: string) => id,
  };
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
    const procFs = makeFakeProcFs();
    let now = 1_000;
    const clock = () => now;
    const emits: unknown[] = [];
    const deps = makeDeps({ child, procFs, clock, emit: (s) => emits.push(s) });
    const r = new Recorder(deps);

    const start = await r.start({
      procedureId: 'p1',
      deviceId: 'Cam',
      patientId: 'pat1',
      doctorId: 'doc1',
      preset: { preset: 'hd' },
      presetSummary: { kind: 'hd', resolution: '1920x1080', framerate: 30, bitrate: '10M' } as PresetSummary,
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
    const procFs = makeFakeProcFs();
    let now = 2_000;
    const clock = () => now;
    const emits: unknown[] = [];
    const deps = makeDeps({ child, procFs, clock, emit: (s) => emits.push(s) });
    const r = new Recorder(deps);

    await r.start({
      procedureId: 'p2',
      deviceId: 'Cam',
      patientId: 'pat2',
      doctorId: 'doc1',
      preset: { preset: 'sd' },
      presetSummary: { kind: 'sd', resolution: '720x480', framerate: 30, bitrate: '4M' } as PresetSummary,
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

    expect(procFs.opens).toHaveLength(1);
    expect(procFs.fsyncs).toHaveLength(1);
    expect(procFs.closes).toHaveLength(1);
    // ponytail: fsync against the open fd (1st openSync returns fd=1 by the fake's nextFd counter).
    expect(procFs.opens[0]).toMatch(/video\.mp4$/);
    expect(procFs.fsyncs[0]).toBe(1);

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
    const procFs = makeFakeProcFs();
    const deps1 = makeDeps({
      child: child1,
      procFs,
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
      presetSummary: { kind: 'hd', resolution: '1920x1080', framerate: 30, bitrate: '10M' } as PresetSummary,
    });

    // Second recorder instance tries the same id; the registry throws.
    const child2 = makeFakeChild();
    const deps2 = makeDeps({
      child: child2,
      procFs,
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
        presetSummary: { kind: 'sd', resolution: '720x480', framerate: 30, bitrate: '4M' } as PresetSummary,
      }),
    ).rejects.toThrow(/Recorder already active|already active|busy/i);
  });

  it('pause/resume throw "not implemented in plan 01" — surface reserved', async () => {
    const deps = makeDeps({
      child: makeFakeChild(),
      procFs: makeFakeProcFs(),
      clock: () => 0,
      emit: () => {},
    });
    const r = new Recorder(deps);
    await expect(r.pause()).rejects.toThrow(/plan 03/);
    await expect(r.resume()).rejects.toThrow(/plan 03/);
  });
});