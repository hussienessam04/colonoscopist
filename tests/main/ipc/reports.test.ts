// @vitest-environment node
// Plan 06-03 Task 4 — Reports IPC: REPORTS_OPEN_PDF with reveal flag + REPORTS_REGEN_PDF.
//
// Per CONTEXT.md D-09 (PDF cached on disk at finalize, re-rendered on
// every edit) + the plan: REPORTS_REGEN_PDF triggers the render via
// renderReportPdf; REPORTS_OPEN_PDF accepts an optional `reveal` flag
// that swaps `shell.openPath` (default viewer) for
// `shell.showItemInFolder` (highlight in OS file manager).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let tmpDir: string;
const handlers = new Map<string, (...args: unknown[]) => unknown>();
const shellCalls: { method: string; args: unknown[] }[] = [];

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
  ipcMain: {
    handle: (channel: string, cb: (...args: unknown[]) => unknown) => {
      handlers.set(channel, cb);
    },
    on: () => {},
  },
  contextBridge: { exposeInMainWorld: () => {} },
  ipcRenderer: { invoke: async () => null },
  shell: {
    openPath: async (filePath: string) => {
      shellCalls.push({ method: 'openPath', args: [filePath] });
      return ''; // empty string = success per Electron docs
    },
    showItemInFolder: (filePath: string) => {
      shellCalls.push({ method: 'showItemInFolder', args: [filePath] });
    },
  },
  BrowserWindow: { getAllWindows: () => [] },
}));

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-reports-ipc-'));
  handlers.clear();
  shellCalls.length = 0;
});

afterEach(() => {
  vi.resetModules();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

async function bootstrap(): Promise<{ userId: string; procedureId: string }> {
  const { getDb } = await import('../../../src/main/db');
  const { wizardBootstrap, login } = await import('../../../src/main/auth');
  getDb();
  const r = await wizardBootstrap({ fullName: 'Dr. A', clinicName: 'Clinic A', pin: '1234' });
  await login({ userId: r.userId, pin: '1234' });
  const db = getDb();
  const patientId = '00000000-0000-4000-8000-000000000010';
  // Quick task 20260812 — mrn NOT NULL after migration 0008.
  db.prepare(
    `INSERT INTO patients (id, full_name, dob, mrn, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(patientId, 'Alice', '1990-01-01', `MRN-T-${patientId.slice(-8)}`, Date.now(), Date.now());
  const { proceduresRepo } = await import('../../../src/main/db/procedures-repo');
  const procedure = proceduresRepo.insert({
    patientId,
    doctorId: r.userId,
    videoPath: 'video.mp4',
    presetSummary: { kind: 'sd', resolution: '720x480', framerate: 30, bitrate: '4M' },
    audioDeviceName: null,
  });
  return { userId: r.userId, procedureId: procedure.id };
}

async function makeReportWithFakePdf(procedureId: string, userId: string): Promise<string> {
  const { reportsRepo } = await import('../../../src/main/db/reports-repo');
  const report = reportsRepo.getOrCreate(procedureId, userId);
  // Write a placeholder file at the canonical PDF path so existsSync
  // passes AND update the report row's pdfPath + pdf_generated_at so
  // the IPC handler sees a fully-rendered report.
  const { reportPdfPath, reportsDir } = await import('../../../src/main/paths');
  void reportsDir;
  writeFileSync(reportPdfPath(report.id), '%PDF-1.4\n%fake\n');
  reportsRepo.setPdfPath(
    report.id,
    `data/reports/${report.id}.pdf`.replace(/\\/g, '/'),
  );
  return report.id;
}

describe('REPORTS_OPEN_PDF (Plan 06-03 Task 4)', () => {
  it('without `reveal` flag — calls shell.openPath for default-viewer behavior', async () => {
    const { userId, procedureId } = await bootstrap();
    const reportId = await makeReportWithFakePdf(procedureId, userId);

    const { registerReportsIpc } = await import('../../../src/main/ipc/reports');
    registerReportsIpc();
    const openPdf = handlers.get('reports:open-pdf');
    expect(openPdf).toBeDefined();

    const result = (await openPdf!({}, { id: reportId })) as { opened: true };
    expect(result).toEqual({ opened: true });
    expect(shellCalls).toHaveLength(1);
    expect(shellCalls[0].method).toBe('openPath');
    expect(shellCalls[0].args[0]).toContain(`${reportId}.pdf`);
  });

  it('with `reveal: true` — calls shell.showItemInFolder (no default viewer)', async () => {
    const { userId, procedureId } = await bootstrap();
    const reportId = await makeReportWithFakePdf(procedureId, userId);

    const { registerReportsIpc } = await import('../../../src/main/ipc/reports');
    registerReportsIpc();
    const openPdf = handlers.get('reports:open-pdf');
    expect(openPdf).toBeDefined();

    const result = (await openPdf!({}, { id: reportId, reveal: true })) as { opened: true };
    expect(result).toEqual({ opened: true });
    expect(shellCalls).toHaveLength(1);
    expect(shellCalls[0].method).toBe('showItemInFolder');
    expect(shellCalls[0].args[0]).toContain(`${reportId}.pdf`);
  });

  it('with `reveal: false` — same as omitting (calls shell.openPath)', async () => {
    const { userId, procedureId } = await bootstrap();
    const reportId = await makeReportWithFakePdf(procedureId, userId);

    const { registerReportsIpc } = await import('../../../src/main/ipc/reports');
    registerReportsIpc();
    const openPdf = handlers.get('reports:open-pdf');
    expect(openPdf).toBeDefined();

    await openPdf!({}, { id: reportId, reveal: false });
    expect(shellCalls).toHaveLength(1);
    expect(shellCalls[0].method).toBe('openPath');
  });

  it('rejects IPC_NOT_FOUND when the PDF file is missing on disk', async () => {
    const { userId, procedureId } = await bootstrap();
    const reportId = await makeReportWithFakePdf(procedureId, userId);
    // Remove the file after the reports row has been written.
    const { reportPdfPath } = await import('../../../src/main/paths');
    rmSync(reportPdfPath(reportId));
    expect(existsSync(reportPdfPath(reportId))).toBe(false);

    const { registerReportsIpc } = await import('../../../src/main/ipc/reports');
    registerReportsIpc();
    const openPdf = handlers.get('reports:open-pdf');
    expect(openPdf).toBeDefined();

    let caught: unknown = null;
    try {
      await openPdf!({}, { id: reportId });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    const wrapped = caught as Error & { ipcError?: { code: string; message: string } };
    expect(wrapped.ipcError?.code).toBe('IPC_NOT_FOUND');
    expect(wrapped.ipcError?.message).toMatch(/pdf file missing on disk/);
  });
});

describe('REPORTS_REGEN_PDF (Plan 06-03 Task 4)', () => {
  it('the handler exists and is registered', async () => {
    await bootstrap();
    const { registerReportsIpc } = await import('../../../src/main/ipc/reports');
    registerReportsIpc();
    // The render itself is gated by @react-pdf/renderer 4.5.1's
    // singleton-state bug under vitest module isolation — that is
    // exercised by tests/integration/pdf-smoke.test.ts (RUN_SMOKE=1)
    // which runs in a fresh Node process. Here we only assert the
    // handler is registered so a future refactor cannot silently
    // remove it.
    expect(handlers.get('reports:regen-pdf')).toBeDefined();
  });
});
