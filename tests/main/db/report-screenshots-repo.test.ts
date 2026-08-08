// report-screenshots-repo unit tests — Wave 0 of Plan 06-01.
// Per RPT-03 (attach / detach / reorder with single-transaction writes) +
// D-07 (FK ON DELETE CASCADE on both report_id and screenshot_id).

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
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  ipcMain: { handle: () => {}, on: () => {} },
  contextBridge: { exposeInMainWorld: () => {} },
  ipcRenderer: { invoke: async () => null },
}));

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-report-shots-'));
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
  reportId: string;
  procedureId: string;
  screenshotIds: number[];
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
  const { reportsRepo } = await import('../../../src/main/db/reports-repo');
  const report = reportsRepo.getOrCreate(inserted.id, r.userId);
  // Create three screenshots with fake files.
  const { screenshotsRepo } = await import('../../../src/main/db/screenshots-repo');
  const ids: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    const rel = `data/media/patients/${patientId}/${inserted.id}/screenshots/${1000 + i}.jpg`;
    const abs = path.join(tmpDir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, Buffer.alloc(64));
    const row = screenshotsRepo.add({
      procedureId: inserted.id,
      timestampInVideoMs: 1000 + i,
      filePath: rel,
      createdAt: Date.now(),
    });
    ids.push(row.id);
  }
  return { reportId: report.id, procedureId: inserted.id, screenshotIds: ids };
}

describe('reportScreenshotsRepo', () => {
  it('attach + listByReport returns rows sorted by sort_order ASC', async () => {
    const { reportId, screenshotIds } = await bootstrap();
    const { reportScreenshotsRepo } = await import('../../../src/main/db/report-screenshots-repo');
    reportScreenshotsRepo.attach(reportId, screenshotIds[0], 2);
    reportScreenshotsRepo.attach(reportId, screenshotIds[1], 0);
    reportScreenshotsRepo.attach(reportId, screenshotIds[2], 1);
    const rows = reportScreenshotsRepo.listByReport(reportId);
    expect(rows.map((r) => r.screenshot_id)).toEqual([screenshotIds[1], screenshotIds[2], screenshotIds[0]]);
    expect(rows.map((r) => r.sort_order)).toEqual([0, 1, 2]);
  });

  it('detach removes the row', async () => {
    const { reportId, screenshotIds } = await bootstrap();
    const { reportScreenshotsRepo } = await import('../../../src/main/db/report-screenshots-repo');
    reportScreenshotsRepo.attach(reportId, screenshotIds[0], 0);
    reportScreenshotsRepo.attach(reportId, screenshotIds[1], 1);
    reportScreenshotsRepo.detach(reportId, screenshotIds[0]);
    const rows = reportScreenshotsRepo.listByReport(reportId);
    expect(rows).toHaveLength(1);
    expect(rows[0].screenshot_id).toBe(screenshotIds[1]);
  });

  it('reorder rewrites sort_order atomically (single transaction)', async () => {
    const { reportId, screenshotIds } = await bootstrap();
    const { reportScreenshotsRepo } = await import('../../../src/main/db/report-screenshots-repo');
    // Attach in original order: 0, 1, 2.
    screenshotIds.forEach((id, i) => reportScreenshotsRepo.attach(reportId, id, i));
    // Reverse the order.
    reportScreenshotsRepo.reorder(reportId, [screenshotIds[2], screenshotIds[1], screenshotIds[0]]);
    const rows = reportScreenshotsRepo.listByReport(reportId);
    expect(rows.map((r) => r.screenshot_id)).toEqual([screenshotIds[2], screenshotIds[1], screenshotIds[0]]);
    expect(rows.map((r) => r.sort_order)).toEqual([0, 1, 2]);
  });

  it('attach with INSERT OR REPLACE updates sort_order in place', async () => {
    const { reportId, screenshotIds } = await bootstrap();
    const { reportScreenshotsRepo } = await import('../../../src/main/db/report-screenshots-repo');
    reportScreenshotsRepo.attach(reportId, screenshotIds[0], 0);
    reportScreenshotsRepo.attach(reportId, screenshotIds[0], 5); // re-attach at new order
    const rows = reportScreenshotsRepo.listByReport(reportId);
    expect(rows).toHaveLength(1);
    expect(rows[0].sort_order).toBe(5);
  });

  it('FK ON DELETE CASCADE: deleting the parent reports row cascades to report_screenshots', async () => {
    const { reportId, screenshotIds } = await bootstrap();
    const { reportScreenshotsRepo } = await import('../../../src/main/db/report-screenshots-repo');
    const { reportsRepo } = await import('../../../src/main/db/reports-repo');
    const { getDb } = await import('../../../src/main/db');
    reportScreenshotsRepo.attach(reportId, screenshotIds[0], 0);
    expect(reportScreenshotsRepo.listByReport(reportId)).toHaveLength(1);
    // Delete the parent report row directly via SQL (cascade ON DELETE).
    getDb().prepare(`DELETE FROM reports WHERE id = ?`).run(reportId);
    expect(reportScreenshotsRepo.listByReport(reportId)).toHaveLength(0);
    expect(reportsRepo.getById(reportId)).toBeNull();
  });

  it('FK ON DELETE CASCADE: deleting the parent screenshots row cascades to report_screenshots', async () => {
    const { reportId, screenshotIds } = await bootstrap();
    const { reportScreenshotsRepo } = await import('../../../src/main/db/report-screenshots-repo');
    const { screenshotsRepo } = await import('../../../src/main/db/screenshots-repo');
    const { getDb } = await import('../../../src/main/db');
    reportScreenshotsRepo.attach(reportId, screenshotIds[0], 0);
    expect(reportScreenshotsRepo.listByReport(reportId)).toHaveLength(1);
    // Delete the screenshot row directly via SQL (cascade ON DELETE).
    getDb().prepare(`DELETE FROM screenshots WHERE id = ?`).run(screenshotIds[0]);
    expect(reportScreenshotsRepo.listByReport(reportId)).toHaveLength(0);
    expect(screenshotsRepo.get(screenshotIds[0])).toBeUndefined();
  });
});
