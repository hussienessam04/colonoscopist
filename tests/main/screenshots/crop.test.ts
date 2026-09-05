// cropScreenshot unit tests — Phase 8 / Plan 14 + Plan 15 (SCRN-02 extended).
//
// Phase 8 / Plan 15 (G-08-8) — extended with polygon-crop coverage:
//   * happy path with cropRect (legacy rectangle, backward compat)
//   * happy path with cropPolygon (free-form, min 3 vertices — collapses
//     to bbox on the main side, v1 deviation)
//   * out-of-bounds crop rect (IPC_INVALID_CROP)
//   * unknown id (IPC_SCREENSHOT_NOT_FOUND)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-crop-'));
});

afterEach(() => {
  vi.resetModules();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

const REL_PATH = 'data/media/patients/p1/proc1/screenshots/5000.jpg';

async function seedScreenshot(): Promise<{ id: number; userId: string; absPath: string }> {
  const { getDb } = await import('../../../src/main/db');
  const { wizardBootstrap, login } = await import('../../../src/main/auth');
  const db = getDb();
  const r = await wizardBootstrap({ fullName: 'Dr. A', clinicName: 'Clinic A', pin: '1234' });
  await login({ userId: r.userId, pin: '1234' });

  const patientId = '00000000-0000-4000-8000-000000000010';
  db.prepare(
    `INSERT INTO patients (id, full_name, dob, mrn, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(patientId, 'Alice', '1990-01-01', 'MRN-CROP-1', Date.now(), Date.now());

  const { proceduresRepo } = await import('../../../src/main/db/procedures-repo');
  const proc = proceduresRepo.insert({
    patientId,
    doctorId: r.userId,
    videoPath: 'data/media/patients/p1/proc1/video.mp4',
    presetSummary: { kind: 'sd', resolution: '720x480', framerate: 30, bitrate: '4M' },
    audioDeviceName: null,
  });

  const absPath = path.join(tmpDir, REL_PATH);
  mkdirSync(path.dirname(absPath), { recursive: true });
  // Original bytes — the assertion is that these are REPLACED.
  writeFileSync(absPath, Buffer.from('ORIGINAL-BYTES'));

  const { screenshotsRepo } = await import('../../../src/main/db/screenshots-repo');
  const row = screenshotsRepo.add({
    procedureId: proc.id,
    timestampInVideoMs: 5000,
    filePath: REL_PATH,
    createdAt: Date.now(),
  });
  return { id: row.id, userId: r.userId, absPath };
}

describe('cropScreenshot', () => {
  it('overwrites the source JPEG and writes a screenshot.cropped audit row (cropRect, legacy rectangle)', async () => {
    const { id, userId, absPath } = await seedScreenshot();
    const { cropScreenshot } = await import('../../../src/main/screenshots/crop');

    const croppedBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02]);
    const result = cropScreenshot(
      {
        id,
        croppedBase64: croppedBytes.toString('base64'),
        originalDimensions: { width: 1280, height: 720 },
        cropRect: { x: 100, y: 50, width: 400, height: 300 },
      },
      userId,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.newDimensions).toEqual({ width: 400, height: 300 });
    expect(result.byteSize).toBe(croppedBytes.byteLength);

    // The source file now holds the cropped bytes, not the original.
    expect(readFileSync(absPath)).toEqual(croppedBytes);

    const { auditRepo } = await import('../../../src/main/db/audit');
    const { rows } = auditRepo.list({ action: 'screenshot.cropped' });
    expect(rows).toHaveLength(1);
    const metadata = JSON.parse(rows[0]!.metadata ?? '{}') as Record<string, unknown>;
    expect(rows[0]!.entity_id).toBe(String(id));
    expect(metadata.originalWidth).toBe(1280);
    expect(metadata.originalHeight).toBe(720);
    expect(metadata.newWidth).toBe(400);
    expect(metadata.newHeight).toBe(300);
    expect(metadata.byteSize).toBe(croppedBytes.byteLength);
    expect(metadata.cropRect).toEqual({ x: 100, y: 50, width: 400, height: 300 });
    // Plan 15 (G-08-8) — audit row tags the shape.
    expect(metadata.viaPolygon).toBe(false);
    expect(metadata.polygonVertices).toBe(0);
  });

  it('Plan 15 (G-08-8): cropPolygon with 4 vertices collapses to the bbox on main + writes the cropped file + tags audit row', async () => {
    const { id, userId, absPath } = await seedScreenshot();
    const { cropScreenshot } = await import('../../../src/main/screenshots/crop');

    const croppedBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02]);
    // A diamond/trapezoid whose bbox is x=[100..500], y=[50..350] =>
    // bbox = (100, 50, 400, 300). Same shape as the legacy rectangle
    // test for comparison's sake.
    const polygon = [
      { x: 300, y: 50 }, // top
      { x: 500, y: 200 }, // right
      { x: 300, y: 350 }, // bottom
      { x: 100, y: 200 }, // left
    ];
    const result = cropScreenshot(
      {
        id,
        croppedBase64: croppedBytes.toString('base64'),
        originalDimensions: { width: 1280, height: 720 },
        cropPolygon: polygon,
      },
      userId,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.newDimensions).toEqual({ width: 400, height: 300 });
    expect(result.byteSize).toBe(croppedBytes.byteLength);

    expect(readFileSync(absPath)).toEqual(croppedBytes);

    const { auditRepo } = await import('../../../src/main/db/audit');
    const { rows } = auditRepo.list({ action: 'screenshot.cropped' });
    expect(rows).toHaveLength(1);
    const metadata = JSON.parse(rows[0]!.metadata ?? '{}') as Record<string, unknown>;
    // The audit row carries the bbox (the v1 collapsed shape).
    expect(metadata.cropRect).toEqual({ x: 100, y: 50, width: 400, height: 300 });
    // Plan 15 (G-08-8) — viaPolygon tag + vertex count for the trail.
    expect(metadata.viaPolygon).toBe(true);
    expect(metadata.polygonVertices).toBe(4);
  });

  it('rejects a crop rect that falls outside the original dimensions', async () => {
    const { id, userId, absPath } = await seedScreenshot();
    const { cropScreenshot } = await import('../../../src/main/screenshots/crop');

    const result = cropScreenshot(
      {
        id,
        croppedBase64: Buffer.from([0xff, 0xd8]).toString('base64'),
        originalDimensions: { width: 100, height: 100 },
        cropRect: { x: 90, y: 10, width: 50, height: 10 },
      },
      userId,
    );

    expect(result).toEqual({ ok: false, code: 'IPC_INVALID_CROP' });
    // T-08-14-T1 — a rejected crop must not touch the file.
    expect(readFileSync(absPath).toString()).toBe('ORIGINAL-BYTES');
  });

  it('Plan 15 (G-08-8): a polygon whose bbox spills outside originalDimensions is rejected with IPC_INVALID_CROP', async () => {
    const { id, userId, absPath } = await seedScreenshot();
    const { cropScreenshot } = await import('../../../src/main/screenshots/crop');

    const result = cropScreenshot(
      {
        id,
        croppedBase64: Buffer.from([0xff, 0xd8]).toString('base64'),
        originalDimensions: { width: 100, height: 100 },
        // Bbox = (90, 10, 50, 10) -> x + width = 140 > 100 = width
        cropPolygon: [
          { x: 90, y: 10 },
          { x: 140, y: 10 },
          { x: 100, y: 20 },
        ],
      },
      userId,
    );

    expect(result).toEqual({ ok: false, code: 'IPC_INVALID_CROP' });
    expect(readFileSync(absPath).toString()).toBe('ORIGINAL-BYTES');
  });

  it('returns IPC_SCREENSHOT_NOT_FOUND for an unknown id', async () => {
    const { userId } = await seedScreenshot();
    const { cropScreenshot } = await import('../../../src/main/screenshots/crop');

    const result = cropScreenshot(
      {
        id: 99_999,
        croppedBase64: Buffer.from([0xff, 0xd8]).toString('base64'),
        originalDimensions: { width: 100, height: 100 },
        cropRect: { x: 0, y: 0, width: 10, height: 10 },
      },
      userId,
    );

    expect(result).toEqual({ ok: false, code: 'IPC_SCREENSHOT_NOT_FOUND' });
  });
});
