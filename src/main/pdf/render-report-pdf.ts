// renderReportPdf — main-side orchestrator for the @react-pdf/renderer
// thin Node bridge (CONTEXT.md D-12). The renderer is sandboxed; it
// never imports @react-pdf/renderer. The renderer passes report data
// over IPC; main calls `pdf(<ReportPdf {...} />).toFile(outputPath)`
// and writes the result to disk.
//
// Per CONTEXT.md D-09: the PDF is cached at
// `<userData>/data/reports/<reportId>.pdf`. After a successful render
// we update the reports row's pdf_path + pdf_generated_at so the
// renderer can show "Open PDF" + emit a report.pdf_generated audit row.
//
// Per CONTEXT.md D-11: full clinical layout — header (logo + signature),
// patient block, procedure block, three labeled body sections, attached
// screenshots one-per-page, footer with "Page X of Y" + clinic name.
// Plan 06-03 Task 3 extends this with logo/signature/screenshot loading
// + multi-page footer + size sanity check.

import { createWriteStream, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

import { reportsRepo } from '../db/reports-repo';
import { doctorProfileRepo } from '../db/doctor-profile-repo';
import { userRepo } from '../db/users';
import { audit } from '../db/audit';
import { session } from '../auth/session';
import { patientRepo } from '../db/patients';
import { reportScreenshotsRepo } from '../db/report-screenshots-repo';
import { screenshotsRepo } from '../db/screenshots-repo';
import { reportPdfPath, reportsDir, profileAssetPath, screenshotAbsPath } from '../paths';
import { ipcError } from '@shared/errors';

import {
  LOGO_BOX,
  SIGNATURE_BOX,
  readImageBox,
} from './embed-image';
import type { ReportPdfInput, AttachedScreenshot } from './report';
import { createReportPdfElement } from './report';

// ponytail: @react-pdf/renderer v4 is ESM-only ("type": "module" in its
// package.json). Electron's main process is compiled to CommonJS by
// electron-vite; static `import` of the package gets emitted as a
// static `require()` in `out/main/index.js` and crashes at runtime with
// ERR_REQUIRE_ESM. We dynamic-import the module here — CJS can
// dynamically import ESM at runtime via `await import()`. The cached
// Promise pattern avoids paying the resolution cost on every render.
let _reactPdfCache: Promise<typeof import('@react-pdf/renderer')> | null = null;
function loadReactPdf(): Promise<typeof import('@react-pdf/renderer')> {
  if (!_reactPdfCache) {
    _reactPdfCache = import('@react-pdf/renderer');
  }
  return _reactPdfCache;
}

// Same dynamic-import treatment for `./report.tsx` because the
// `ReportPdf` component module also pulls in @react-pdf/renderer
// transitively (its `Document` / `Page` / `Text` / `View` / `Image` /
// `StyleSheet` / `Font` imports). Caching keeps subsequent renders
// warm.
// ponytail: removed — `report.tsx` now uses `createReportPdfElement`
// which has zero static @react-pdf/renderer imports. The build emits
// no chunk with a top-level require("@react-pdf/renderer"), so
// dynamic-importing `./report` is no longer necessary. Only the
// @react-pdf/renderer module itself is ESM and must be dynamically
// imported.

// ponytail: minimum size sanity check threshold per Plan 06-03 Task 3
// step 7. A report with at least one attached screenshot renders well
// above this; a render under this size indicates a silent PDF failure
// (e.g. empty template, image embed error).
const MIN_PDF_BYTES = 5_000;

// ponytail: HH:MM:SS duration formatter. Mirrors the format used in
// REC-04 / ProcedureReview. durationSeconds is the canonical
// better-sqlite3 integer (Phase 4 D-10).
function formatHHMMSS(durationSeconds: number): string {
  const safe = Math.max(0, Math.floor(durationSeconds));
  const hh = Math.floor(safe / 3600);
  const mm = Math.floor((safe % 3600) / 60);
  const ss = safe % 60;
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

export async function renderReportPdf(
  reportId: string,
): Promise<{ pdfPath: string }> {
  mkdirSync(reportsDir(), { recursive: true });

  const report = reportsRepo.getById(reportId);
  if (!report) {
    throw new Error(`Report ${reportId} not found`);
  }

  // Look up the procedure + patient + doctor profile for the input props.
  const { proceduresRepo } = await import('../db/procedures-repo');
  const procedure = proceduresRepo.get(report.procedureId);
  if (!procedure) {
    throw new Error(`Procedure ${report.procedureId} not found`);
  }
  const patient = patientRepo.get(procedure.patientId);
  if (!patient) {
    throw new Error(`Patient ${procedure.patientId} not found`);
  }
  const doctor = userRepo.get(report.doctorId);
  if (!doctor) {
    throw new Error(`Doctor ${report.doctorId} not found`);
  }
  const profile = doctorProfileRepo.get(report.doctorId);

  // Plan 06-03 Task 3 — load the logo + signature ImageBox buffers
  // (null when the doctor hasn't uploaded the asset; the template
  // renders a "[No logo uploaded]" placeholder in that case). The
  // path is `profileAssetPath(userId, storedRel)` per Anti-Pattern 2:
  // the DB stores a userData-relative path; main resolves to absolute
  // at read time.
  const logoBox = profile?.logoPath
    ? readImageBox(profileAssetPath(report.doctorId, profile.logoPath), LOGO_BOX)
    : null;
  const signatureBox = profile?.signaturePath
    ? readImageBox(profileAssetPath(report.doctorId, profile.signaturePath), SIGNATURE_BOX)
    : null;

  // Load attached screenshots one-per-page, ordered by sort_order
  // ASC. Each row in `report_screenshots` references a row in
  // `screenshots` whose `file_path` is userData-relative per
  // Anti-Pattern 2 — resolved at read time via `screenshotAbsPath`.
  // Per Pitfall 3 in RESEARCH.md: read the JPEG directly from disk
  // (NOT via the `/media/` HTTP route), since the PDF render runs
  // in main and has direct FS access.
  const attachedRows = reportScreenshotsRepo.listByReport(reportId);
  const attachedScreenshots: AttachedScreenshot[] = [];
  for (const row of attachedRows) {
    const screenshot = screenshotsRepo.get(row.screenshot_id);
    if (!screenshot) continue;
    // ponytail: Screenshot only carries procedureId (not patientId),
    // but screenshots are scoped to a procedure which is itself
    // scoped to a patient — so the procedure carries the patientId
    // we need for the resolver.
    const imageBuffer = readImageBox(
      screenshotAbsPath(procedure.patientId, procedure.id, screenshot.filePath),
      { widthPx: 0, heightPx: 0 },
    )?.buffer;
    if (!imageBuffer) continue;
    attachedScreenshots.push({
      screenshotId: screenshot.id,
      filePath: screenshot.filePath,
      sortOrder: row.sort_order,
      imageBuffer,
    });
  }

  const input: ReportPdfInput = {
    logoBox,
    signatureBox,
    clinicName: profile?.clinicNameEn ?? 'Clinic',
    doctorName: `Dr. ${doctor.full_name}`,
    procedureDateLabel: new Date(procedure.startedAt).toISOString().slice(0, 10),
    patientName: patient.fullName,
    patientMrn: patient.mrn,
    patientDob: patient.dob,
    patientGender: patient.gender,
    procedureDurationLabel: formatHHMMSS(procedure.durationSeconds),
    findings: report.findings,
    diagnosis: report.diagnosis,
    recommendations: report.recommendations,
    attachedScreenshots,
  };

  const pdfPath = reportPdfPath(reportId);

  // Dynamic-import @react-pdf/renderer only. `report.tsx` itself has
  // zero static imports of @react-pdf/renderer (the build emits no
  // chunk with a top-level require() of it), so we don't need to
  // dynamic-import `./report` separately. `createReportPdfElement` is
  // a pure factory that takes the React-PDF primitives as a
  // parameter and builds the React tree with `React.createElement`.
  const reactPdf = await loadReactPdf();
  const { pdf } = reactPdf;

  // Render via @react-pdf/renderer's Node entry.
  // ponytail: @react-pdf/renderer 4.5.1 ships with a known bug in
  // `renderToFile` (it calls `output.pipe()` on a Buffer). The
  // workaround is to use `pdf().toBuffer()` (which actually returns a
  // Node Readable stream despite the name — see the upstream TODO) and
  // pipe it manually to a write stream. `instance.toBuffer()` returns a
  // stream whose `pipe` works against a `fs.WriteStream`. This
  // produces a valid PDF on disk without the upstream bug.
  const instance = pdf(createReportPdfElement(reactPdf, input));
  const stream = (await instance.toBuffer()) as NodeJS.ReadableStream;
  await new Promise<void>((resolve, reject) => {
    const writer = createWriteStream(pdfPath);
    writer.on('finish', () => resolve());
    writer.on('error', (err) => reject(err));
    stream.on('error', (err) => reject(err));
    stream.pipe(writer);
  });

  // Plan 06-03 Task 3 step 7 — minimum-size sanity check. A 0-byte or
  // tiny file indicates a silent PDF render failure (e.g. a corrupted
  // template, an image embed error, etc.).
  const stat = statSync(pdfPath);
  if (stat.size < MIN_PDF_BYTES) {
    throw ipcError('IPC_INTERNAL', `PDF too small: ${stat.size} bytes`);
  }

  // Store userData-relative path on the reports row (Anti-Pattern 2).
  const userData = app.getPath('userData');
  const relPdfPath = path.relative(userData, pdfPath).split(path.sep).join('/');
  reportsRepo.setPdfPath(reportId, relPdfPath);

  audit({
    action: 'report.pdf_generated',
    entityType: 'report',
    entityId: reportId,
    userId: session.currentUserId,
    metadata: { pdfPath: relPdfPath },
  });

  return { pdfPath };
}