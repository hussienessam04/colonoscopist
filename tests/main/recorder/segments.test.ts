// procedure_segments repo + UNIQUE enforcement (D-11).

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
  ipcMain: { handle: () => {}, on: () => {} },
  contextBridge: { exposeInMainWorld: () => {} },
  ipcRenderer: { invoke: async () => null, on: () => {}, removeListener: () => {} },
  BrowserWindow: { getAllWindows: () => [] },
}));

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-segments-'));
});

afterEach(() => {
  vi.resetModules();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

const PATIENT_ID = '00000000-0000-4000-8000-000000000222';
const DOCTOR_ID = '00000000-0000-4000-8000-000000000333';

async function bootstrapAndSeed(): Promise<{
  proceduresRepo: typeof import('../../../src/main/db/procedures-repo').proceduresRepo;
  procedureId: string;
}> {
  // ponytail: dynamic import so each test gets a fresh `proceduresRepo` after
  // vi.resetModules() — the top-level import would otherwise point at the
  // previous test's module instance.
  const { proceduresRepo } = await import('../../../src/main/db/procedures-repo');
  const { getDb } = await import('../../../src/main/db');
  const db = getDb();
  // Seed FK parents (patient + doctor) so proceduresRepo.insert can satisfy
  // the FK constraints.
  db.prepare(
    `INSERT INTO patients (id, full_name, dob, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(PATIENT_ID, 'Alice', '1990-01-01', Date.now(), Date.now());
  db.prepare(
    `INSERT INTO users (id, full_name, is_first_admin, pin_hash, created_at)
     VALUES (?, ?, 1, 'h', ?)`,
  ).run(DOCTOR_ID, 'Dr. A', Date.now());
  const procedure = proceduresRepo.insert({
    patientId: PATIENT_ID,
    doctorId: DOCTOR_ID,
    videoPath: `data/media/patients/${PATIENT_ID}/<proc>/video.mp4`,
    presetSummary: { kind: 'sd', resolution: '720x480', framerate: 30, bitrate: '4M' },
    audioDeviceName: null,
  });
  return { proceduresRepo, procedureId: procedure.id };
}

describe('proceduresRepo.insertSegment / listSegments', () => {
  it('insertSegment writes a row; listSegments returns it', async () => {
    const { proceduresRepo, procedureId } = await bootstrapAndSeed();
    const startedAt = 1_000;
    const endedAt = 2_000;
    const seg = proceduresRepo.insertSegment({
      procedureId,
      segmentIndex: 0,
      filePath: 'video-seg0.mp4',
      startedAt,
      endedAt,
    });
    expect(seg.id).toBeGreaterThan(0);
    expect(seg.procedureId).toBe(procedureId);
    expect(seg.segmentIndex).toBe(0);
    expect(seg.filePath).toBe('video-seg0.mp4');
    expect(seg.startedAt).toBe(startedAt);
    expect(seg.endedAt).toBe(endedAt);

    const rows = proceduresRepo.listSegments(procedureId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(seg);
  });

  it('two inserts with the same (procedureId, segmentIndex) are idempotent (INSERT OR IGNORE)', async () => {
    // The supervisor treats insertSegment as best-effort — onExit may
    // fire more than once for the same segment during pause/resume
    // races and recovery paths. INSERT OR IGNORE keeps the first row.
    const { proceduresRepo, procedureId } = await bootstrapAndSeed();
    proceduresRepo.insertSegment({
      procedureId,
      segmentIndex: 0,
      filePath: 'video-seg0.mp4',
      startedAt: 1_000,
      endedAt: 2_000,
    });
    expect(() =>
      proceduresRepo.insertSegment({
        procedureId,
        segmentIndex: 0,
        filePath: 'video-seg0.mp4',
        startedAt: 1_500,
        endedAt: 2_500,
      }),
    ).not.toThrow();
    const rows = proceduresRepo.listSegments(procedureId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.endedAt).toBe(2_000); // first row wins
  });

  it('listSegments returns rows ordered by segment_index ASC', async () => {
    const { proceduresRepo, procedureId } = await bootstrapAndSeed();
    // Insert out of order; expect list to return ASC.
    proceduresRepo.insertSegment({
      procedureId,
      segmentIndex: 2,
      filePath: 'video-seg2.mp4',
      startedAt: 5_000,
      endedAt: 6_000,
    });
    proceduresRepo.insertSegment({
      procedureId,
      segmentIndex: 0,
      filePath: 'video-seg0.mp4',
      startedAt: 1_000,
      endedAt: 2_000,
    });
    proceduresRepo.insertSegment({
      procedureId,
      segmentIndex: 1,
      filePath: 'video-seg1.mp4',
      startedAt: 3_000,
      endedAt: 4_000,
    });
    const rows = proceduresRepo.listSegments(procedureId);
    expect(rows.map((r) => r.segmentIndex)).toEqual([0, 1, 2]);
  });

  it('listSegments returns an empty array for an unknown procedureId', async () => {
    const { proceduresRepo } = await bootstrapAndSeed();
    expect(proceduresRepo.listSegments('does-not-exist')).toEqual([]);
  });
});
