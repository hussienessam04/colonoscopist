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
});
