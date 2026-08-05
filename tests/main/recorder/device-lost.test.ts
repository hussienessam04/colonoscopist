// Device-lost detection + partial-mp4 rename + sidecar JSON + audit + 'lost'
// status emit + finalize-as-partial on subsequent stop() (per D-03 + RESEARCH §3).
// All tests run on an in-memory fs/procFs — no real ffmpeg, no real fs I/O.

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
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-device-lost-'));
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
  DEVICE_LOST_RE,
  parseLastKnownTimestampMs,
  rewritePartial,
  MAX_LAST_KNOWN_MS,
} from '../../../src/main/recorder/device-lost';
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
import { __resetProceduresRepoCache } from '../../../src/main/db/procedures-repo';
import type { PresetSummary } from '@shared/ipc-contract';

function makeFakeChild(): {
  writes: string[];
  stderrListeners: Array<(chunk: Buffer) => void>;
  triggerExit: (code: number | null, signal: NodeJS.Signals | null) => void;
} & RecorderChild {
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
      on: (_event: 'exit', cb: (code: number | null, signal: NodeJS.Signals | null) => void) => {
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
    triggerExit(code, signal) {
      exitHandler?.(code, signal);
    },
  };
  return child as unknown as ReturnType<typeof makeFakeChild> & RecorderChild;
}

function makeFakeProcFs(opts: { statSize?: number; exists?: boolean } = {}): {
  opens: string[];
  fsyncs: number[];
  closes: number[];
  renames: Array<{ from: string; to: string }>;
  unlinks: string[];
  writes: Array<{ path: string; content: string }>;
  statSize: number;
} & ProcFs {
  const opens: string[] = [];
  const fsyncs: number[] = [];
  const closes: number[] = [];
  const renames: Array<{ from: string; to: string }> = [];
  const unlinks: string[] = [];
  const writes: Array<{ path: string; content: string }> = [];
  const statSize = opts.statSize ?? 1024;
  return {
    opens,
    fsyncs,
    closes,
    renames,
    unlinks,
    writes,
    statSize,
    openSync: (p: string) => {
      opens.push(p);
      return opens.length;
    },
    fsyncSync: (fd: number) => {
      fsyncs.push(fd);
    },
    closeSync: (fd: number) => {
      closes.push(fd);
    },
    statSync: (p: string) => {
      return { size: statSize };
    },
    renameSync: (from: string, to: string) => {
      renames.push({ from, to });
    },
    unlinkSync: (p: string) => {
      unlinks.push(p);
    },
    existsSync: (p: string) => opts.exists ?? true,
    // ponytail: writeFileSync spy — device-lost.ts uses procFs.writeFileSync
    // to write the sidecar JSON so unit tests can capture it without real fs.
    writeFileSync: (p: string, c: string) => {
      writes.push({ path: p, content: c });
    },
  } as unknown as ProcFs & {
    writes: Array<{ path: string; content: string }>;
    statSize: number;
  };
}

function makeDeps(opts: {
  child: ReturnType<typeof makeFakeChild>;
  procFs?: ReturnType<typeof makeFakeProcFs>;
  clock: () => number;
  emit: (status: unknown) => void;
}): { deps: RecorderDeps; spawned: Array<{ args: readonly string[] }> } {
  const spawned: Array<{ args: readonly string[] }> = [];
  const procFs = opts.procFs ?? makeFakeProcFs();
  const spawnFn: RecorderDeps['spawn'] = (_cmd, args, _opts) => {
    spawned.push({ args });
    return opts.child as unknown as RecorderChild;
  };
  const deps: RecorderDeps = {
    spawn: spawnFn,
    spawnConcat: () => {
      throw new Error('not used in device-lost tests');
    },
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
  return { deps, spawned };
}

const SAMPLE_PRESET_SUMMARY: PresetSummary = {
  kind: 'sd',
  resolution: '720x480',
  framerate: 30,
  bitrate: '4M',
};

describe('DEVICE_LOST_RE', () => {
  it('matches the six substrings from RESEARCH §3 case-insensitively', () => {
    // ponytail: case-insensitive flag covers all six variants.
    expect(DEVICE_LOST_RE.test('ffmpeg: ... I/O error ...')).toBe(true);
    expect(DEVICE_LOST_RE.test('ffmpeg: ... DeviceLost ...')).toBe(true);
    expect(DEVICE_LOST_RE.test('ffmpeg: ... device disconnected ...')).toBe(true);
    expect(DEVICE_LOST_RE.test('ffmpeg: ... EOF on input ...')).toBe(true);
    expect(DEVICE_LOST_RE.test('ffmpeg: ... Immediate exit requested ...')).toBe(true);
    expect(DEVICE_LOST_RE.test('ffmpeg: ... av_interleaved_write_frame ...')).toBe(true);
    expect(DEVICE_LOST_RE.test('I/O ERROR')).toBe(true);
    expect(DEVICE_LOST_RE.test('all good')).toBe(false);
  });
});

describe('parseLastKnownTimestampMs', () => {
  it('throws on size 0', () => {
    expect(() => parseLastKnownTimestampMs(0, '4M')).toThrow(/empty statSizeBytes/);
  });
  it('throws on empty bitrate', () => {
    expect(() => parseLastKnownTimestampMs(1024, '')).toThrow(/empty bitrate/);
  });
  it('returns byte-derived ms for 4M bitrate', () => {
    // 1_000_000 bytes * 8 * 1000 / 4_000_000 bps = 2000 ms
    expect(parseLastKnownTimestampMs(1_000_000, '4M')).toBe(2000);
    // 500_000_000 bytes * 8 * 1000 / 4_000_000 = 1_000_000 ms = 1000 s (under 30 min cap)
    expect(parseLastKnownTimestampMs(500_000_000, '4M')).toBe(1_000_000);
  });
  it('returns byte-derived ms for 10M bitrate', () => {
    // 500_000_000 bytes * 8 * 1000 / 10_000_000 = 400_000 ms = 400 s
    expect(parseLastKnownTimestampMs(500_000_000, '10M')).toBe(400_000);
  });
  it('caps at MAX_LAST_KNOWN_MS = 30 minutes', () => {
    expect(parseLastKnownTimestampMs(100_000_000_000, '4M')).toBe(MAX_LAST_KNOWN_MS);
  });
});

describe('rewritePartial', () => {
  it('renames segment to <seg>.partial.mp4 + writes sidecar JSON', () => {
    const procFs = makeFakeProcFs();
    const result = rewritePartial(
      '/x/video-seg0.mp4',
      'video-seg0',
      {
        procedureId: 'p1',
        lastKnownTimestampMs: 5000,
        deviceLostAt: 6000,
        deviceName: 'Cam',
      },
      { procFs },
    );
    expect(result.partialPath).toBe('/x/video-seg0.mp4.partial.mp4');
    expect(result.partialJsonPath).toBe('/x/video-seg0.mp4.partial.mp4.json');
    expect(procFs.renames).toEqual([
      { from: '/x/video-seg0.mp4', to: '/x/video-seg0.mp4.partial.mp4' },
    ]);
    expect(procFs.writes).toHaveLength(1);
    expect(JSON.parse(procFs.writes[0]!.content)).toEqual({
      procedureId: 'p1',
      lastKnownTimestampMs: 5000,
      deviceLostAt: 6000,
      deviceName: 'Cam',
    });
  });
  it('throws when the source segment does not exist', () => {
    const procFs = makeFakeProcFs({ exists: false });
    expect(() =>
      rewritePartial(
        '/x/missing.mp4',
        'missing',
        { procedureId: 'p', lastKnownTimestampMs: 0, deviceLostAt: 0, deviceName: 'x' },
        { procFs },
      ),
    ).toThrow(/EmptyPartialFile/);
  });
});

describe('Recorder device-lost branch', () => {
  beforeEach(() => {
    __resetRecorderRegistry();
    __resetProceduresRepoCache();
  });
  afterEach(() => {
    __resetRecorderRegistry();
  });

  it('on stderr chunk containing "I/O error" AFTER frame=, writes q\\n, renames segment, writes sidecar JSON, emits lost + audit', async () => {
    const child = makeFakeChild();
    const procFs = makeFakeProcFs({ statSize: 1_000_000 });
    let now = 2_000;
    const emits: unknown[] = [];
    const { deps } = makeDeps({
      child,
      procFs,
      clock: () => now,
      emit: (s) => emits.push(s),
    });
    const r = new Recorder(deps);

    await r.start({
      procedureId: 'p1',
      deviceId: 'Cam',
      patientId: 'pat1',
      doctorId: 'doc1',
      preset: { preset: 'sd' },
      presetSummary: SAMPLE_PRESET_SUMMARY,
    });

    // ffmpeg becomes ready
    child.stderrListeners[0](Buffer.from('frame= 100\n'));
    now = 2_500;

    // device-lost: stderr chunk contains 'I/O error'
    child.stderrListeners[0](Buffer.from('av_interleaved_write_frame: I/O error\n'));

    // State machine should now be 'stopping'; q\n should be in writes
    expect(r.getState()).toBe('stopping');
    expect(child.writes).toContain('q\n');

    // Simulate ffmpeg exit
    now = 3_000;
    child.triggerExit(0, null);

    // Allow microtasks to drain (the device-lost exit handler resolves sync
    // but state mutation may run via Promise microtasks).
    await new Promise((res) => setTimeout(res, 10));

    // Rename + sidecar JSON content
    expect(procFs.renames).toEqual([
      { from: expect.stringMatching(/video-seg0\.mp4$/), to: expect.stringMatching(/\.partial\.mp4$/) },
    ]);
    expect(procFs.writes).toHaveLength(1);
    const sidecar = JSON.parse(procFs.writes[0]!.content);
    expect(sidecar.procedureId).toBe('p1');
    expect(sidecar.deviceName).toBe('Cam');
    expect(sidecar.deviceLostAt).toBe(3_000);
    expect(typeof sidecar.lastKnownTimestampMs).toBe('number');

    // Emit 'lost' with lastKnownTimestampMs derived from 1_000_000 bytes @ 4M
    expect(emits).toContainEqual(
      expect.objectContaining({
        status: 'lost',
        deviceName: 'Cam',
        lastKnownTimestampMs: expect.any(Number),
      }),
    );

    // Audit row carries the right shape
    expect(deps.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'recording.lost',
        outcome: 'failed',
        entityId: 'p1',
        metadata: expect.objectContaining({
          segmentIndex: 0,
          lastKnownTimestampMs: expect.any(Number),
          deviceName: 'Cam',
          partialJsonPath: expect.stringMatching(/\.partial\.mp4\.json$/),
        }),
      }),
    );
  });

  it('after device-lost, stop() finalizes the row with status=partial + videoPath=<segment>.partial.mp4', async () => {
    const child = makeFakeChild();
    const procFs = makeFakeProcFs({ statSize: 1_000_000 });
    let now = 5_000;
    const emits: unknown[] = [];
    const { deps } = makeDeps({
      child,
      procFs,
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
    child.stderrListeners[0](Buffer.from('frame= 100\n'));
    now = 5_500;
    child.stderrListeners[0](Buffer.from('I/O error\n'));
    now = 6_000;
    child.triggerExit(0, null);
    await new Promise((res) => setTimeout(res, 10));

    // State after device-lost: 'stopping'
    expect(r.getState()).toBe('stopping');

    // Doctor clicks Stop
    await r.stop();

    // updateFinalized called with status='partial' + the partial video path
    expect(deps.procedures.updateFinalized).toHaveBeenCalledWith(
      'p2',
      expect.objectContaining({
        status: 'partial',
        videoPath: 'video-seg0.mp4.partial.mp4',
      }),
    );

    // recording.stopped audit row carries metadata.partial = true
    expect(deps.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'recording.stopped',
        metadata: expect.objectContaining({ partial: true }),
      }),
    );

    // Status: 'stopped' emitted
    expect(emits).toContainEqual(
      expect.objectContaining({
        status: 'stopped',
        procedureId: 'p2',
      }),
    );

    // Registry released
    expect(recorderRegistry.has('p2')).toBe(false);
  });

  it('double-click stop() after device-lost is idempotent — updateFinalized called exactly once', async () => {
    const child = makeFakeChild();
    const procFs = makeFakeProcFs({ statSize: 1_000_000 });
    let now = 7_000;
    const { deps } = makeDeps({
      child,
      procFs,
      clock: () => now,
      emit: () => {},
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
    now = 7_500;
    child.stderrListeners[0](Buffer.from('I/O error\n'));
    now = 8_000;
    child.triggerExit(0, null);
    await new Promise((res) => setTimeout(res, 10));

    const beforeCount = (deps.procedures.updateFinalized as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(beforeCount).toBe(0);

    // First stop click
    await r.stop();
    const afterFirst = (deps.procedures.updateFinalized as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(afterFirst).toBe(1);

    // Second stop click (double-click scenario)
    await r.stop();
    const afterSecond = (deps.procedures.updateFinalized as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(afterSecond).toBe(1);
  });
});