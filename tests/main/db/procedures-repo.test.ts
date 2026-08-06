// proceduresRepo — Plan 03 extension tests for updateVideoPath + restoreFromOriginal.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-procrepo-'));
});

afterEach(() => {
  vi.resetModules();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

async function bootstrap(): Promise<{
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
  proceduresRepo.updateFinalized(inserted.id, {
    endedAt: Date.now(),
    durationSeconds: 60,
    status: 'completed',
    videoPath: 'video.mp4',
  });
  return { procedureId: inserted.id, patientId, doctorId: r.userId };
}

function writeFakeFile(patientId: string, procedureId: string, fileName: string): void {
  const abs = path.join(tmpDir, 'data', 'media', 'patients', patientId, procedureId, fileName);
  require('node:fs').mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, Buffer.alloc(64));
}

describe('proceduresRepo.updateVideoPath + restoreFromOriginal', () => {
  it('first trim populates video_path_original via COALESCE', async () => {
    const { procedureId } = await bootstrap();
    const { proceduresRepo } = await import('../../../src/main/db/procedures-repo');
    const updated = proceduresRepo.updateVideoPath(
      procedureId,
      'video-trimmed.mp4',
      'video.mp4',
    );
    expect(updated.videoPath).toBe('video-trimmed.mp4');
    expect(updated.videoPathOriginal).toBe('video.mp4');
  });

  it('second trim leaves video_path_original UNCHANGED (D-07 COALESCE guard)', async () => {
    const { procedureId } = await bootstrap();
    const { proceduresRepo } = await import('../../../src/main/db/procedures-repo');
    proceduresRepo.updateVideoPath(procedureId, 'video-trimmed.mp4', 'video.mp4');
    // Second trim re-points video_path to a new trimmed file but the
    // originalRel passed in is the CURRENT video_path, not the original.
    // COALESCE keeps the first-trim original.
    const second = proceduresRepo.updateVideoPath(
      procedureId,
      'video-trimmed-2.mp4',
      'video-trimmed.mp4',
    );
    expect(second.videoPath).toBe('video-trimmed-2.mp4');
    expect(second.videoPathOriginal).toBe('video.mp4'); // first-trim original is LOCKED
  });

  it('restoreFromOriginal re-points video_path to video_path_original', async () => {
    const { procedureId, patientId } = await bootstrap();
    writeFakeFile(patientId, procedureId, 'video.mp4');
    const { proceduresRepo } = await import('../../../src/main/db/procedures-repo');
    proceduresRepo.updateVideoPath(procedureId, 'video-trimmed.mp4', 'video.mp4');
    const restored = proceduresRepo.restoreFromOriginal(procedureId);
    expect(restored.videoPath).toBe('video.mp4');
    expect(restored.videoPathOriginal).toBe('video.mp4');
  });

  it('restoreFromOriginal rejects when video_path_original is null (IPC_VALIDATION)', async () => {
    const { procedureId } = await bootstrap();
    const { proceduresRepo } = await import('../../../src/main/db/procedures-repo');
    let caught: unknown = null;
    try {
      proceduresRepo.restoreFromOriginal(procedureId);
    } catch (err) {
      caught = err;
    }
    const { IpcErrorException } = await import('../../../src/shared/errors');
    expect(caught).toBeInstanceOf(IpcErrorException);
    expect((caught as InstanceType<typeof IpcErrorException>).ipc.code).toBe(
      'IPC_VALIDATION',
    );
  });

  it('restoreFromOriginal rejects when the original file is missing on disk (IPC_NOT_FOUND)', async () => {
    const { procedureId } = await bootstrap();
    const { proceduresRepo } = await import('../../../src/main/db/procedures-repo');
    proceduresRepo.updateVideoPath(procedureId, 'video-trimmed.mp4', 'video.mp4');
    // Don't write the original file — restoreFromOriginal must detect the
    // missing file via fs.existsSync and throw IPC_NOT_FOUND.
    let caught: unknown = null;
    try {
      proceduresRepo.restoreFromOriginal(procedureId);
    } catch (err) {
      caught = err;
    }
    const { IpcErrorException } = await import('../../../src/shared/errors');
    expect(caught).toBeInstanceOf(IpcErrorException);
    expect((caught as InstanceType<typeof IpcErrorException>).ipc.code).toBe(
      'IPC_NOT_FOUND',
    );
  });

  it('restoreFromOriginal succeeds when the original file exists on disk', async () => {
    const { procedureId, patientId } = await bootstrap();
    writeFakeFile(patientId, procedureId, 'video.mp4');
    const { proceduresRepo } = await import('../../../src/main/db/procedures-repo');
    proceduresRepo.updateVideoPath(procedureId, 'video-trimmed.mp4', 'video.mp4');
    const restored = proceduresRepo.restoreFromOriginal(procedureId);
    expect(restored.videoPath).toBe('video.mp4');
  });
});
