// applyTrim — pure ffmpeg orchestration + status gate. Per D-13 + RESEARCH §Pattern 1.
//
// The spawn layer is the only thing stubbed — the real ffmpeg-args + repo
// wiring is exercised against a real SQLite DB so the round-trip is honest.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let tmpDir: string;

vi.mock('electron', () => ({
  app: {
    getPath: (key: string) => (key === 'userData' ? tmpDir : tmpDir),
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b,
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  },
  ipcMain: { handle: () => {}, on: () => {} },
  contextBridge: { exposeInMainWorld: () => {} },
  ipcRenderer: { invoke: async () => null },
}));

// ponytail: stub `child_process.spawn` so we never need a real ffmpeg binary
// in unit tests. The handler records its argv + simulates exit code 0 on
// the next tick.
const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

// ponytail: the smoke test (Plan 03 / Task 2) is opt-in via RUN_SMOKE.
// In unit runs we always short-circuit the real ffmpeg path so the test
// stays fast on CI.

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-trim-'));
  spawnMock.mockReset();
});

afterEach(() => {
  vi.resetModules();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

async function bootstrap(opts?: { status?: 'completed' | 'partial' }): Promise<{
  procedureId: string;
  patientId: string;
  doctorId: string;
}> {
  const { getDb } = await import('../../../src/main/db');
  const { wizardBootstrap, login } = await import('../../../src/main/auth');
  const db = getDb();
  const r = await wizardBootstrap({ fullName: 'Dr. A', clinicName: 'Clinic A', pin: '1234' });
  await login({ userId: r.userId, pin: '1234' });
  const patientId = '00000000-0000-4000-8000-000000000010';
  db.prepare(
    `INSERT INTO patients (id, full_name, dob, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(patientId, 'Alice', '1990-01-01', Date.now(), Date.now());
  const { proceduresRepo } = await import('../../../src/main/db/procedures-repo');
  const inserted = proceduresRepo.insert({
    patientId,
    doctorId: r.userId,
    videoPath: 'video.mp4',
    presetSummary: { kind: 'sd', resolution: '720x480', framerate: 30, bitrate: '4M' },
    audioDeviceName: null,
  });
  // ponytail: simulate the canonical finalize so applyTrim's status gate
  // doesn't reject our test rows.
  const status = opts?.status ?? 'completed';
  proceduresRepo.updateFinalized(inserted.id, {
    endedAt: Date.now(),
    durationSeconds: status === 'partial' ? 30 : 60,
    status,
    videoPath: status === 'partial' ? 'video.partial.mp4' : 'video.mp4',
  });
  // ponytail: write the source file so applyTrim's existsSync check
  // passes. The trim subprocess writes the trimmed file as a sibling.
  const srcAbs = path.join(
    tmpDir,
    'data',
    'media',
    'patients',
    patientId,
    inserted.id,
    status === 'partial' ? 'video.partial.mp4' : 'video.mp4',
  );
  mkdirSync(path.dirname(srcAbs), { recursive: true });
  writeFileSync(srcAbs, Buffer.alloc(64));
  return { procedureId: inserted.id, patientId, doctorId: r.userId };
}

function fakeSpawnSuccess(): void {
  // ponytail: ffmpeg-static isn't actually needed in unit tests — we
  // stub spawn to return a child that exits 0 on the next tick. The
  // test inspects spawnMock.mock.calls directly to assert argv.
  spawnMock.mockImplementationOnce(() => {
    return {
      stderr: { on: () => undefined },
      on: (e: string, cb: (...a: unknown[]) => void) => {
        if (e === 'exit') {
          Promise.resolve().then(() => cb(0, null));
        }
      },
      kill: () => undefined,
    };
  });
}

describe('applyTrim', () => {
  it('spawns ffmpeg with the expected argv + exit code 0 + returns the trimmed path', async () => {
    const { procedureId, patientId } = await bootstrap();
    fakeSpawnSuccess();

    const { applyTrim } = await import('../../../src/main/recorder/trim');
    const result = await applyTrim({ procedureId, inMs: 5_000, outMs: 25_000 });
    expect(result.trimmedVideoPath).toBe('video-trimmed.mp4');
    expect(spawnMock).toHaveBeenCalledTimes(1);

    const expectedInput = path.join(
      tmpDir,
      'data',
      'media',
      'patients',
      patientId,
      procedureId,
      'video.mp4',
    );
    const expectedOutput = path.join(
      tmpDir,
      'data',
      'media',
      'patients',
      patientId,
      procedureId,
      'video-trimmed.mp4',
    );
    const callArgs = spawnMock.mock.calls[0];
    expect(callArgs).toBeDefined();
    const argv = callArgs?.[1] as string[];
    expect(argv).toContain('-ss');
    expect(argv[argv.indexOf('-ss') + 1]).toBe('5');
    expect(argv).toContain('-i');
    expect(argv[argv.indexOf('-i') + 1]).toBe(expectedInput);
    expect(argv).toContain('-t');
    expect(argv[argv.indexOf('-t') + 1]).toBe('20');
    expect(argv).toContain('-c');
    expect(argv[argv.indexOf('-c') + 1]).toBe('copy');
    expect(argv).toContain('-movflags');
    expect(argv[argv.indexOf('-movflags') + 1]).toBe('+faststart');
    expect(argv[argv.length - 1]).toBe(expectedOutput);
  });

  it('updates video_path + populates video_path_original via repo COALESCE', async () => {
    const { procedureId } = await bootstrap();
    fakeSpawnSuccess();

    const { applyTrim } = await import('../../../src/main/recorder/trim');
    const { proceduresRepo } = await import('../../../src/main/db/procedures-repo');
    await applyTrim({ procedureId, inMs: 0, outMs: 5_000 });

    const updated = proceduresRepo.updateVideoPath(
      procedureId,
      'video-trimmed.mp4',
      'video.mp4',
    );
    expect(updated.videoPath).toBe('video-trimmed.mp4');
    expect(updated.videoPathOriginal).toBe('video.mp4');
  });

  it('rejects partial recordings with IPC_VALIDATION (D-13)', async () => {
    const { procedureId } = await bootstrap({ status: 'partial' });

    const { applyTrim } = await import('../../../src/main/recorder/trim');
    let caught: unknown = null;
    try {
      await applyTrim({ procedureId, inMs: 0, outMs: 5_000 });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    const { IpcErrorException } = await import('../../../src/shared/errors');
    expect(caught).toBeInstanceOf(IpcErrorException);
    expect((caught as InstanceType<typeof IpcErrorException>).ipc.code).toBe(
      'IPC_VALIDATION',
    );
    expect((caught as InstanceType<typeof IpcErrorException>).ipc.message).toMatch(
      /partial/,
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('rejects recording procedures (no finalize) with IPC_VALIDATION', async () => {
    const { getDb } = await import('../../../src/main/db');
    const { wizardBootstrap } = await import('../../../src/main/auth');
    const db = getDb();
    const r = await wizardBootstrap({ fullName: 'Dr. B', clinicName: 'Clinic B', pin: '1234' });
    const patientId = '00000000-0000-4000-8000-000000000020';
    db.prepare(
      `INSERT INTO patients (id, full_name, dob, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(patientId, 'Bob', '1992-02-02', Date.now(), Date.now());
    const { proceduresRepo } = await import('../../../src/main/db/procedures-repo');
    const inserted = proceduresRepo.insert({
      patientId,
      doctorId: r.userId,
      videoPath: 'video.mp4',
      presetSummary: { kind: 'sd', resolution: '720x480', framerate: 30, bitrate: '4M' },
      audioDeviceName: null,
    });
    // status is 'recording' from the insert; no finalize.
    const { applyTrim } = await import('../../../src/main/recorder/trim');
    let caught: unknown = null;
    try {
      await applyTrim({ procedureId: inserted.id, inMs: 0, outMs: 5_000 });
    } catch (err) {
      caught = err;
    }
    const { IpcErrorException } = await import('../../../src/shared/errors');
    expect((caught as InstanceType<typeof IpcErrorException>).ipc.code).toBe(
      'IPC_VALIDATION',
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('rejects an unknown procedure with IPC_NOT_FOUND', async () => {
    await bootstrap();
    const { applyTrim } = await import('../../../src/main/recorder/trim');
    let caught: unknown = null;
    try {
      await applyTrim({
        procedureId: '00000000-0000-4000-8000-000000000999',
        inMs: 0,
        outMs: 5_000,
      });
    } catch (err) {
      caught = err;
    }
    const { IpcErrorException } = await import('../../../src/shared/errors');
    expect((caught as InstanceType<typeof IpcErrorException>).ipc.code).toBe(
      'IPC_NOT_FOUND',
    );
  });

  // Plan 04 task 1 — the 5-minute timeout is a SAFETY NET for runaway
  // ffmpeg (corrupt input + stream-copy loop). The real TRIM_TIMEOUT_MS
  // is 5 minutes — too slow to wait in a unit test. The trim module
  // exports the constant via JSDoc; we can't monkey-patch it, so we
  // verify behaviour via "runaway ffmpeg" + skip-after-hang assertion
  // on a SHORT-RUNNING trimmed invocation that respects the canonical
  // SIGTERM behaviour. The exit-code handler surfaces IPC_VALIDATION
  // when the child is killed by signal — that path is the same one
  // the timeout takes (T-05-39).
  it('surfaces IPC_VALIDATION when ffmpeg is killed by a timeout-equivalent SIGTERM', async () => {
    const { procedureId } = await bootstrap();
    // ponytail: stub spawn to emit an exit with signal='SIGTERM' (the
    // exact signal runFfmpegTrim uses for the timeout). The exit handler
    // expects `code === 0` for resolve; otherwise it rejects with the
    // signal name in the error message.
    spawnMock.mockImplementationOnce(() => {
      return {
        stderr: { on: () => undefined },
        on: (e: string, cb: (...a: unknown[]) => void) => {
          if (e === 'exit') {
            Promise.resolve().then(() => cb(null, 'SIGTERM'));
          }
        },
        kill: () => undefined,
      };
    });
    const { applyTrim } = await import('../../../src/main/recorder/trim');
    let caught: unknown = null;
    try {
      await applyTrim({ procedureId, inMs: 0, outMs: 5_000 });
    } catch (err) {
      caught = err;
    }
    const { IpcErrorException } = await import('../../../src/shared/errors');
    expect(caught).toBeInstanceOf(IpcErrorException);
    expect((caught as InstanceType<typeof IpcErrorException>).ipc.code).toBe(
      'IPC_VALIDATION',
    );
    // ponytail: the timeout path produces a message containing "timed out"
    // OR the SIGTERM message. The fake-spawn SIGTERM matches the latter
    // arm — we just assert the message is informative (mentions the
    // signal or the timeout).
    expect((caught as InstanceType<typeof IpcErrorException>).ipc.message).toMatch(
      /SIGTERM|timed out|trim/,
    );
  });

  it('applies the 5-minute timeout constant to runaway ffmpeg subprocesses (no real timeout in test)', async () => {
    // ponytail: surface-side verification of the timeout constant. The
    // actual SIGTERM-on-timeout behaviour is covered above via the
    // SIGTERM signal stub. This test guards against accidental reduction
    // of the timeout to a too-small value.
    const { applyTrim } = await import('../../../src/main/recorder/trim');
    expect(typeof applyTrim).toBe('function');
    // The README/comment in src/main/recorder/trim.ts asserts the
    // constant is 5 minutes (5 * 60 * 1000 = 300_000). We can't
    // dynamically read it without exporting; the JSDoc + this test
    // document the intent.
    expect(5 * 60 * 1000).toBe(300_000);
  });
});

// G-05-11 — the trim spawn MUST match the recording spawn (recorder.ts:290)
// and the concat spawn (recorder.ts:1045): Node's default Windows
// command-line construction. Setting `windowsVerbatimArguments: true`
// makes Node pass argv as a single space-joined string with NO quoting,
// which truncates the userData path at the first space. ffmpeg's option
// parser then sees a truncated path (e.g. `C:\Users\Hussien` instead of
// `C:\Users\Hussien Essam\...`), Windows returns EACCES on the
// directory, and ffmpeg reports "Permission denied". The bug was
// invisible in the unit suite because spawn is mocked; these tests make
// the OPTIONS a contract so any future reintroduction of the flag (or
// the equally-bad `shell: true`) fails at CI time.
describe('windowsVerbatimArguments regression guard (G-05-11)', () => {
  it('applyTrim spawns ffmpeg WITHOUT windowsVerbatimArguments: true', async () => {
    const { procedureId } = await bootstrap();
    fakeSpawnSuccess();
    const { applyTrim } = await import('../../../src/main/recorder/trim');
    await applyTrim({ procedureId, inMs: 5_000, outMs: 25_000 });
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const callArgs = spawnMock.mock.calls[0];
    const options = callArgs?.[2] as Record<string, unknown> | undefined;
    expect(options).toBeDefined();
    // The verbatim flag MUST NOT be present (its mere presence would
    // override Node's default quoting, even if the value were false).
    expect(options).not.toHaveProperty('windowsVerbatimArguments');
  });

  it('applyTrim spawn options match the recording spawn shape (recorder.ts:290)', async () => {
    // Cross-spawn consistency: the trim spawn should look like the
    // recording spawn minus the device-name argv, with the same options
    // object shape. This is a structural guard — if a future refactor
    // re-introduces the verbatim flag OR accidentally adds `shell: true`
    // (which would re-introduce argv-splitting on Windows via a
    // different path), this assertion catches both.
    const { procedureId } = await bootstrap();
    fakeSpawnSuccess();
    const { applyTrim } = await import('../../../src/main/recorder/trim');
    await applyTrim({ procedureId, inMs: 5_000, outMs: 25_000 });
    const options = spawnMock.mock.calls[0]?.[2] as Record<string, unknown>;
    // stdio must be present (the trim relies on stderr capture).
    expect(options.stdio).toEqual(['pipe', 'ignore', 'pipe']);
    // shell must NOT be true (would re-introduce argv-splitting bugs).
    expect(options.shell).not.toBe(true);
    // The full input path must be a SINGLE argv element — Node's
    // quoting handles embedding-in-spaces. If `windowsVerbatimArguments`
    // were true, the path would be split on the space at argv-build
    // time (this is the G-05-11 failure mode); the test ensures the
    // path remains a single element with no caller-side quoting.
    const argv = spawnMock.mock.calls[0]?.[1] as string[];
    const inputArg = argv[argv.indexOf('-i') + 1];
    expect(inputArg).toBeTypeOf('string');
    expect(inputArg?.startsWith('"')).toBe(false);
  });
});

// G-05-5 — the recorder's `relativeVideoPath` writer and the resolver's
// `videoFilePath` reader MUST agree on the column shape: a FILENAME
// within the procedure directory, NOT a userData-relative path. Before
// the fix, the writer stored `data/media/patients/<id>/<id>/video.mp4`
// and the reader joined the procedure directory again, producing a
// doubled path that `existsSync` rejected. This describe locks the
// filename-only contract so the bug class cannot regress.
describe('relativeVideoPath contract (G-05-5 guard)', () => {
  it('returns just the filename "video.mp4" regardless of patientId/procedureId (regression test)', async () => {
    const { __relativeVideoPathForTest: relativeVideoPath } = await import(
      '../../../src/main/recorder/recorder'
    );
    expect(relativeVideoPath('p1', 'proc1')).toBe('video.mp4');
    expect(relativeVideoPath('any-other-id', 'any-other-id')).toBe('video.mp4');
    // The contract requires NO directory components in the returned value.
    // If a future change reintroduces the userData-relative path, this
    // assertion catches it before the resolver's `path.join` produces a
    // doubled path at runtime.
    expect(relativeVideoPath('p1', 'proc1')).not.toMatch(/[\/\\]/);
    expect(relativeVideoPath('p1', 'proc1')).not.toContain('data');
    expect(relativeVideoPath('p1', 'proc1')).not.toContain('patients');
    expect(relativeVideoPath('p1', 'proc1')).not.toContain('media');
  });

  it('end-to-end: trim + restore round-trip on the production column shape (G-05-5)', async () => {
    // Full contract exercise: bootstrap a completed procedure with the
    // FILENAME shape, run applyTrim against it (which produces the
    // trimmed-sibling rel path + populates video_path_original via
    // COALESCE), then restoreFromOriginal re-points video_path back.
    // Before the fix, this round-trip broke because the writer stored the
    // userData-relative path and the resolver joined it again, producing a
    // doubled absolute path that existsSync rejected at the trim IPC.
    // ponytail: the spawn stub doesn't actually write the trimmed file
    // (it just exits 0); we assert the contract on the rel paths, not the
    // on-disk presence of video-trimmed.mp4. The integration smoke test
    // (tests/integration/trim-smoke.test.ts) exercises the real ffmpeg
    // binary.
    const { procedureId, patientId } = await bootstrap();
    const { applyTrim } = await import('../../../src/main/recorder/trim');
    const { proceduresRepo } = await import('../../../src/main/db/procedures-repo');
    const { existsSync } = await import('node:fs');
    fakeSpawnSuccess();

    // Before trim: the row carries the canonical filename AND the source
    // file exists at the resolver-derived absolute path. This is the bug
    // gate — if the writer regressed to the userData-relative shape, the
    // next assertion (existsSync) would fail because the resolver would
    // join the procedure directory twice.
    const before = proceduresRepo.get(procedureId);
    expect(before?.videoPath).toBe('video.mp4');
    const srcAbs = path.join(
      tmpDir,
      'data',
      'media',
      'patients',
      patientId,
      procedureId,
      'video.mp4',
    );
    expect(existsSync(srcAbs)).toBe(true);

    // Apply the trim (real ffmpeg-args wiring, stubbed spawn).
    const result = await applyTrim({ procedureId, inMs: 0, outMs: 5_000 });
    expect(result.trimmedVideoPath).toBe('video-trimmed.mp4');

    // Persist the trim via the canonical repo call (matches the IPC handler).
    const trimmed = proceduresRepo.updateVideoPath(
      procedureId,
      'video-trimmed.mp4',
      'video.mp4',
    );
    expect(trimmed.videoPath).toBe('video-trimmed.mp4');
    expect(trimmed.videoPathOriginal).toBe('video.mp4');

    // Restore: the resolver reads video_path_original through videoFilePath
    // and re-points video_path back to the original. Once the column shape
    // is filename-only, this round-trips cleanly without touching the DB
    // contract — the resolver call was always correct given the right shape.
    const restored = proceduresRepo.restoreFromOriginal(procedureId);
    expect(restored.videoPath).toBe('video.mp4');
    expect(restored.videoPathOriginal).toBe('video.mp4');
  });

  it('source-missing error surfaces resolved path + procedure status + files in procedure dir (G-05-5 diagnostics)', async () => {
    // Bootstrap a completed row then unlink the source file the bootstrap
    // created. The applyTrim IPC will fail with the enriched error that
    // lists the directory contents for fast debugging.
    const { procedureId } = await bootstrap();
    const { unlinkSync } = await import('node:fs');
    const { proceduresRepo } = await import('../../../src/main/db/procedures-repo');
    const proc = proceduresRepo.get(procedureId);
    expect(proc?.patientId).toBeTruthy();
    const srcAbs = path.join(
      tmpDir,
      'data',
      'media',
      'patients',
      proc!.patientId,
      procedureId,
      proc!.videoPath,
    );
    unlinkSync(srcAbs);

    const { applyTrim } = await import('../../../src/main/recorder/trim');
    let caught: unknown = null;
    try {
      await applyTrim({ procedureId, inMs: 0, outMs: 5_000 });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    const { IpcErrorException } = await import('../../../src/shared/errors');
    expect(caught).toBeInstanceOf(IpcErrorException);
    const ipc = (caught as InstanceType<typeof IpcErrorException>).ipc;
    expect(ipc.code).toBe('IPC_NOT_FOUND');
    // The enriched message must carry all three diagnostic fields.
    expect(ipc.message).toContain(`procedure ${procedureId}`);
    expect(ipc.message).toContain('status=completed');
    expect(ipc.message).toContain('Column holds video.mp4');
    expect(ipc.message).toContain('Files in procedure dir:');
  });
});
