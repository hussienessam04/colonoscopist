// @vitest-environment node
// Phase 7 / Plan 07-06 + quick task 260913-3sj — RPT-06 ship-gate:
// PDF magic-bytes integration test. RUN_SMOKE=1 gated; default unit
// runs skip.
//
// Quick task 260913-3sj: PDF reports now ALWAYS render in English
// regardless of UI language (doctor's explicit preference). The test
// is now an EN-only smoke that exercises the FULL DB-backed
// orchestrator path (renderReportPdf) — distinct from
// tests/integration/ar-pdf-smoke.test.ts which exercises the
// lower-level createReportPdfElement factory. The orchestrator path
// is what the production IPC handler runs.
//
// ponytail: 1KB threshold (matches `MIN_PDF_BYTES` in
// `render-report-pdf.ts:75`) — 5KB fails the always-English post-toggle path
// since the PDF no longer embeds Arabic glyphs. The 1KB floor still catches
// all three failure modes (0KB crash / font-register-fail empty PDF /
// wrong format).
//
// Verify locally with:
//   RUN_SMOKE=1 npm run test:integration:smoke:phase7

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const tmpDir = mkdtempSync(path.join(tmpdir(), 'phase7-ar-pdf-magic-'));

vi.mock('electron', () => ({
  app: {
    getPath: (_name: string): string => tmpDir,
    isPackaged: false,
    getName: (): string => 'colonoscopist-phase7-ar-pdf',
    getVersion: (): string => '0.0.0',
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
  shell: { showItemInFolder: () => {} },
}));

// ponytail: truthy check (not === '1') — vitest worker process inheritance
// of RUN_SMOKE from the wrapper script is reliable but a strict equality
// on '1' failed in dev. Boolean coercion is enough.
const smokeEnabled = Boolean(process.env.RUN_SMOKE);

describe.skipIf(!smokeEnabled)('PDF ship-gate (RPT-06) — always-English post-toggle', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('renders an EN-only PDF via the full orchestrator path', async () => {
    // 1. Bootstrap the live DB at the mocked userData via wizardBootstrap.
    //    This creates the first admin user + doctor_profile row in one txn.
    const { wizardBootstrap } = await import('../../src/main/auth');
    const { userId } = await wizardBootstrap({
      fullName: 'Dr. EN Smoke',
      clinicName: 'EN Smoke Clinic',
      pin: '1234',
      language: 'en',
    });

    // 2. Seed a patient + procedure + finalized report.
    const { patientRepo } = await import('../../src/main/db/patients');
    const { proceduresRepo } = await import('../../src/main/db/procedures-repo');
    const { reportsRepo } = await import('../../src/main/db/reports-repo');
    const { screenshotsRepo } = await import('../../src/main/db/screenshots-repo');
    const { reportScreenshotsRepo } = await import('../../src/main/db/report-screenshots-repo');

    const patient = patientRepo.create({
      fullName: 'John Doe',
      dob: '1980-04-12',
      gender: 'male',
      mrn: '12345',
      phone: null,
      notes: null,
    });

    const procedure = proceduresRepo.insert({
      patientId: patient.id,
      doctorId: userId,
      videoPath: 'video.mp4',
      presetSummary: { kind: 'sd', resolution: '720x480', framerate: 30, bitrate: '4M' },
      audioDeviceName: null,
    });
    proceduresRepo.updateFinalized(procedure.id, {
      endedAt: Date.now(),
      durationSeconds: 600,
      status: 'completed',
      videoPath: 'video.mp4',
    });

    const report = reportsRepo.getOrCreate(procedure.id, userId);
    // Populate the editable fields so the PDF has real body content.
    reportsRepo.updateDraft(report.id, {
      colon: 'Patient shows mild inflammation in the lower colon.',
      conclusion: 'Mild colitis.',
      recommendation: 'Repeat exam in one month.',
    });

    // 3. Attach a real (padded) JPEG screenshot to the report. The
    //    screenshot file MUST exist on disk at the path returned by
    //    screenshotAbsPath(userData, filePath). Mirror the production
    //    layout: data/media/patients/<patientId>/<procedureId>/screenshots/<ts>.jpg
    const relScreenshotPath = `data/media/patients/${patient.id}/${procedure.id}/screenshots/en-smoke.jpg`;
    const absScreenshotPath = path.join(tmpDir, relScreenshotPath);
    mkdirSync(path.dirname(absScreenshotPath), { recursive: true });
    // Minimal valid JPEG header (SOI + APP0 + payload + EOI). The body
    // bytes are arbitrary — @react-pdf/renderer doesn't re-validate
    // the JPEG stream, it just embeds the bytes into the PDF.
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01]),
      Buffer.alloc(6_000, 0x42), // 6KB padding matches the smoke pattern in tests/integration/ar-pdf-smoke.test.ts
      Buffer.from([0xff, 0xd9]),
    ]);
    writeFileSync(absScreenshotPath, jpeg);

    const screenshot = screenshotsRepo.add({
      procedureId: procedure.id,
      timestampInVideoMs: 5_000,
      filePath: relScreenshotPath,
      annotation: null,
      createdAt: Date.now(),
    });
    reportScreenshotsRepo.attach(report.id, screenshot.id, 0);

    // 4. Render the EN PDF via the full orchestrator path. language='en'
    //    is explicit so the test contract reads "EN-only PDF".
    const { renderReportPdf } = await import('../../src/main/pdf/render-report-pdf');
    const result = await renderReportPdf(report.id, { language: 'en' });

    // 5. Assertions: file size > 1KB (matches MIN_PDF_BYTES in production)
    //    + PDF magic bytes.
    expect(existsSync(result.pdfPath), `PDF not written at ${result.pdfPath}`).toBe(true);
    const stat = statSync(result.pdfPath);
    expect(
      stat.size,
      `PDF too small (${stat.size} bytes) — render may have crashed`,
    ).toBeGreaterThan(1_000);

    const head = readFileSync(result.pdfPath).subarray(0, 4);
    expect(head.toString('utf8')).toBe('%PDF');
  }, 90_000); // 90s timeout for PDF render (Font.register + render + JPEG embed)
});

if (!smokeEnabled) {
  describe('PDF ship-gate (RPT-06) — disabled (RUN_SMOKE not set)', () => {
    it('set RUN_SMOKE=1 to enable the PDF magic smoke', () => {
      expect(smokeEnabled).toBe(false);
    });
  });
}

afterAll(() => {
  // ponytail: best-effort cleanup. Windows holds file handles briefly
  // after the test process exits; rmSync might EBUSY on the WAL files
  // but the dir is in tmpdir so the OS will sweep it.
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});
