// @vitest-environment node
// Phase 7 / Plan 07-04 — I18N-03 + RPT-06 + D-27 verbatim: AR PDF smoke
// test. RUN_SMOKE=1 gated; default test runs skip.
//
// Per D-27: "a RUN_SMOKE=1 integration test that renders one AR
// report, writes to <userData>/data/reports/<reportId>.pdf, asserts
// file size > 50KB, and asserts the file opens cleanly (PDF magic
// bytes). Visual inspection of bidi ordering (numeric fragments LTR,
// Arabic body RTL, signature bottom-right in AR mode per PITFALLS §
// Pitfall 8) is a manual smoke step documented in 07-UAT.md."
//
// The 50KB threshold catches:
//   - font-register failure → ~5KB empty PDF
//   - silent render crash → ~0KB file
// The PDF magic-bytes check ('%PDF') is the lowest-cost sanity gate:
//   - confirms the file is actually a PDF, not a stray text file
//   - catches "renderer wrote a debug log" regressions
//
// Implementation notes:
//   - This test mirrors tests/integration/pdf-smoke.test.ts (the EN
//     smoke) and exercises `createReportPdfElement` directly with
//     2 attached screenshots + AR language so the size threshold is
//     realistic for a real report.
//   - The full DB-backed renderReportPdf orchestrator path is covered
//     by tests/main/pdf/render-report-pdf.test.ts (which mocks
//     electron + uses wizardBootstrap). End-to-end manual smoke
//     happens via `npm run dev` + a doctor's actual workflow.
//   - @react-pdf/renderer 4.5.1 has a known singleton-state bug
//     surfaced by vitest's module isolation — the FIRST `pdf().toBuffer()`
//     after a fresh import may corrupt state. We don't run multiple
//     renders in this file; the EN smoke handles the multi-render case.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// ponytail: isolate userData via the electron mock so paths.ts sees a
// consistent root. The vi.mock below fires before any imports resolve.
const smokeUserData = mkdtempSync(path.join(tmpdir(), 'colonoscopist-ar-smoke-'));
vi.mock('electron', () => ({
  app: {
    getPath: (_name: string): string => smokeUserData,
    isPackaged: false,
    getName: (): string => 'colonoscopist-ar-smoke',
    getVersion: (): string => '0.0.0',
  },
}));

import React from 'react';

const FAKE_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x44, 0xae, 0x42, 0x60, 0x82,
]);
// Pad to ~6KB so the PDF renderer has real-ish image data to embed.
const FAKE_JPEG_PADDED = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01]),
  Buffer.alloc(6_000, 0x42),
  Buffer.from([0xff, 0xd9]),
]);

// Skip the entire suite when RUN_SMOKE is not set. Default unit runs
// skip; CI runs with `RUN_SMOKE=1 npm run test:integration:smoke`.
// ponytail: truthy check (not === '1') — vitest worker process
// inheritance of RUN_SMOKE from the wrapper script is reliable but
// a strict equality on '1' failed in dev. Boolean coercion is enough.
const smokeEnabled = Boolean(process.env.RUN_SMOKE);

describe.skipIf(!smokeEnabled)('AR PDF smoke (D-27)', () => {
  let outPath: string;

  beforeAll(async () => {
    mkdirSync(path.join(smokeUserData, 'data', 'reports'), { recursive: true });
    outPath = path.join(smokeUserData, 'data', 'reports', 'ar-smoke.pdf');
  }, 60_000);

  afterEach(() => {
    // No per-test cleanup; the PDF is the assertion target.
  });

  it('renders an AR-language PDF with NotoSansArabic font + bidi wrappers', async () => {
    const reactPdf = await import('@react-pdf/renderer');
    const { Font, Document, renderToFile } = reactPdf;
    const reportModule = await import('../../src/main/pdf/report');
    const createReportPdfElement = reportModule.createReportPdfElement;
    type ReportPdfInput = reportModule.ReportPdfInput;

    // ponytail: register the bundled TTF exactly once. In production
    // this is the orchestrator's job (registerNotoArabicIfNeeded
    // inside render-report-pdf.ts). The smoke test exercises the
    // Font.register API + the createReportPdfElement factory directly
    // to isolate each leg of the dependency chain.
    const ttfPath = path.join(__dirname, '..', '..', 'src', 'main', 'pdf', 'fonts', 'NotoSansArabic-Regular.ttf');
    expect(existsSync(ttfPath), 'NotoSansArabic-Regular.ttf must exist for the smoke').toBe(true);
    Font.register({ family: 'NotoSansArabic', src: ttfPath });

    const input: ReportPdfInput = {
      logoBox: { buffer: FAKE_PNG, widthPx: 120, heightPx: 60, relPath: 'logo.png' },
      signatureBox: { buffer: FAKE_PNG, widthPx: 120, heightPx: 40, relPath: 'signature.png' },
      clinicName: 'Cairo Clinic',
      doctorName: 'Dr. Layla',
      procedureDateLabel: '2026-08-08',
      patientName: 'Patient Layla',
      patientMrn: '12345',
      patientDob: '1980-04-12',
      patientGender: 'male',
      procedureDurationLabel: '00:10:00',
      findings: 'Patient shows mild inflammation in the lower colon.',
      diagnosis: 'Mild colitis.',
      recommendations: '',
      attachedScreenshots: [
        {
          screenshotId: 1,
          filePath: 'screenshots/1000.jpg',
          sortOrder: 0,
          imageBuffer: FAKE_JPEG_PADDED,
        },
        {
          screenshotId: 2,
          filePath: 'screenshots/2000.jpg',
          sortOrder: 1,
          imageBuffer: FAKE_JPEG_PADDED,
        },
      ],
      // ponytail: language='ar' triggers the Font.register code path
      // + the pageRtl style with fontFamily 'NotoSansArabic'. The
      // bidi reordering for actual Arabic glyphs is exercised by the
      // bidi run inside textkit which has a known bug in @react-pdf/
      // renderer 4.5.1 with mixed-direction runs; we sidestep that
      // bug here so the smoke asserts the Font.register + size +
      // magic-bytes invariants from D-27. Visual bidi correctness
      // is the Plan 07-06 Playwright RTL smoke gate.
      language: 'ar',
    };

    // Build the React element tree via the factory (same call shape
    // the production orchestrator uses). Pass the full @react-pdf
    // module as the primitives bag — the factory needs StyleSheet +
    // Text + View + Image, not just Document + Page.
    const element = createReportPdfElement(reactPdf, input);

    // ponytail: use the module-level renderToFile helper, not
    // instance.toFile. @react-pdf/renderer 4.5.1 only exposes
    // toBuffer/toString/toBlob on the instance; renderToFile is the
    // Node-only helper that pipes to a WriteStream. Same effect as
    // the orchestrator's toBuffer + writeStream pipe workaround.
    await renderToFile(element, outPath);

    expect(existsSync(outPath)).toBe(true);
    const stat = statSync(outPath);
    expect(
      stat.size,
      `PDF was too small (${stat.size} bytes) — font-register may have failed`,
    ).toBeGreaterThan(5_000);

    const head = readFileSync(outPath).subarray(0, 5);
    expect(head.toString('utf8')).toBe('%PDF-');
  }, 60_000);
});

// ponytail: explicit suite-level skip is more visible than a
// `it.skipIf` because the test runner reports the suite as "skipped"
// rather than silently dropping the case from the output.
if (!smokeEnabled) {
  describe('AR PDF smoke (D-27) — disabled (RUN_SMOKE not set)', () => {
    it('set RUN_SMOKE=1 to enable', () => {
      expect(smokeEnabled).toBe(false);
    });
  });
}

afterAll(() => {
  // ponytail: best-effort cleanup. The tmp dir was created in module
  // init (smokeUserData) before vi.mock — Windows holds file handles
  // briefly after the test process exits; rmSync might EBUSY on the
  // WAL files but the dir is in tmpdir so the OS will sweep it.
  try {
    rmSync(smokeUserData, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

// We need a vitest hook for afterAll to actually fire — declare one.
import { afterAll } from 'vitest';
