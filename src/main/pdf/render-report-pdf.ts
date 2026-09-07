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
//
// Phase 7 / Plan 07-04 — I18N-03 + RPT-06: AR PDF rendering per
// D-25..D-27 + Pitfall 8. The signature accepts an `opts.language` arg
// ('en' | 'ar'). When 'ar', main calls
// `Font.register({family: 'NotoSansArabic', src: <ttf path>})` exactly
// once per process (module-scope guard). Language resolution per D-26
// verbatim: doctor_profile.language → users.language → 'en'.

import { createWriteStream, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

import { reportsRepo } from '../db/reports-repo';
import { doctorProfileRepo } from '../db/doctor-profile-repo';
// Quick task 260812-ns0 — used-devices repo (1:N with doctor_profile)
// for the procedure defaults block on the report.
import { usedDevicesRepo } from '../db/used-devices-repo';
import { userRepo } from '../db/users';
import { audit } from '../db/audit';
import { session } from '../auth/session';
import { patientRepo } from '../db/patients';
import { reportScreenshotsRepo } from '../db/report-screenshots-repo';
import { screenshotsRepo } from '../db/screenshots-repo';
import { reportPdfPath, reportsDir, screenshotAbsPath } from '../paths';
import { ipcError } from '@shared/errors';

import {
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

// ponytail: minimum size sanity check threshold per Plan 06-03 Task 3
// step 7. A report with at least one attached screenshot renders well
// above this; a render under this size indicates a silent PDF failure
// (e.g. empty template, image embed error).
// Quick task 20260906-pdf-min-bytes-print-preview-reveal-explorer —
// lowered from 5_000 to 1_000. A minimal report (no screenshots
// attached, empty boxes, short text) legitimately produces a
// ~2-3 KB PDF — the 5 KB threshold was tuned for typical reports
// with embedded screenshots. 1 KB still catches a true truncated
// write (0 bytes) while letting minimal reports through.
const MIN_PDF_BYTES = 1_000;

// Phase 7 / Plan 07-04 — I18N-03 + RPT-06 + D-25: register the bundled
// Noto Sans Arabic TTF exactly once per process. The Font.register API
// is idempotent on the same family+src but the file read + parse is
// not free, so a module-scope guard prevents redundant work. If the
// TTF is missing (user_setup skipped in dev), the register call throws
// and the AR render degrades to Helvetica (the fallback renders as
// 'tofu' boxes for Arabic glyphs — manual smoke step per D-27).
let _notoArabicRegistered = false;
let _notoArabicAvailable: boolean | null = null;
function registerNotoArabicIfNeeded(reactPdf: typeof import('@react-pdf/renderer')): boolean {
  if (_notoArabicRegistered) return _notoArabicAvailable ?? false;
  _notoArabicRegistered = true;
  // Resolve relative to this compiled module's location. electron-vite
  // emits main/* into out/main/, and we copy the fonts/ subdir alongside
  // via electron-builder's `extraResources`. In dev (electron-vite dev)
  // __dirname is the source-tree src/main/pdf/, so the same relative
  // path resolves either way.
  const ttfPath = path.join(__dirname, 'fonts', 'NotoSansArabic-Regular.ttf');
  try {
    reactPdf.Font.register({
      family: 'NotoSansArabic',
      src: ttfPath,
    });
    _notoArabicAvailable = true;
  } catch (err) {
    // ponytail: degrade gracefully. The AR report will render with
    // Helvetica (no Arabic glyphs) but the IPC contract holds — the
    // renderer still receives a pdfPath + size sanity check.
    _notoArabicAvailable = false;
    // eslint-disable-next-line no-console
    console.warn('[render-report-pdf] NotoSansArabic TTF registration failed:', err);
  }
  return _notoArabicAvailable;
}

// Quick task 20260907-redesign-pdf-layout — age computation for the
// "Age: <n> years" field in the patient info box. patient.dob is a
// yyyy-mm-dd string (ISO date, no timezone); procedure.startedAt is
// ms epoch (UTC). We compute floor((nowMs - dobMs) / year) using the
// standard "completed years" rule (same calendar day counts as a full
// year only when reached). Returns null when dob is empty, malformed,
// or in the future relative to procedureDateMs.
function computeAgeYears(dob: string, procedureDateMs: number): number | null {
  if (!dob) return null;
  // Parse yyyy-mm-dd directly — `new Date('1980-01-01')` interprets as
  // UTC midnight per ISO 8601. Subtract ms-epoch via .getTime().
  const dobMs = Date.parse(`${dob}T00:00:00Z`);
  if (Number.isNaN(dobMs)) return null;
  if (dobMs > procedureDateMs) return null;
  const dobDate = new Date(dobMs);
  const procDate = new Date(procedureDateMs);
  let age = procDate.getUTCFullYear() - dobDate.getUTCFullYear();
  // ponytail: subtract one year if the procedure date hasn't yet
  // reached the birthday in the current year. UTC accessors avoid
  // local-time drift (Pitfall 8).
  const procMonth = procDate.getUTCMonth();
  const procDay = procDate.getUTCDate();
  const dobMonth = dobDate.getUTCMonth();
  const dobDay = dobDate.getUTCDate();
  if (procMonth < dobMonth || (procMonth === dobMonth && procDay < dobDay)) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

export type ReportLanguage = 'en' | 'ar';

export interface RenderReportPdfOptions {
  language?: ReportLanguage;
}

export async function renderReportPdf(
  reportId: string,
  opts: RenderReportPdfOptions = {},
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

  // Phase 7 / Plan 07-04 — I18N-03 + D-26 verbatim: resolve language
  // doctor_profile.language → users.language → 'en'. The renderer never
  // supplies language to this orchestrator (the IPC handler forwards
  // its own resolved value via opts); this is the safety-net when the
  // IPC handler didn't pass a language.
  const language: ReportLanguage =
    opts.language ??
    profile?.language ??
    doctor.language ??
    'en';

  // Quick task 260812-ns0 — header + footer image boxes (top/bottom
  // band on every PDF page). The same `readImageBox` helper handles
  // header/footer — natural aspect ratio + buffer; the template
  // computes the actual on-page size from the report page width.
  //
  // Quick task 20260907-redesign-pdf-layout — signature image moves
  // into the body (between the recommendation and the extra
  // screenshots). LOGO_BOX is gone — the header band IS the page
  // header now, no logo + clinic-name row beneath it.
  //
  // Quick task 20260907-pdf-report-editor-fixes — the DB columns
  // store the FULL userData-relative path (e.g.
  // `data/profiles/<userId>/signature.png`), not just a filename.
  // `profileAssetPath` expects a filename, so using it here
  // produced a nested path that never resolved. Match the
  // resolution pattern from `PROFILE_GET_ASSET_DATA_URL`:
  // `path.join(userData, relPath.split('/').join(path.sep))`.
  // `userData` is declared further down (just before the pdfPath
  // writeback); function-scoped `const` allows the closure to
  // capture it once declared. To keep call ordering simple,
  // declare it up-front here and reuse.
  const userData = app.getPath('userData');
  const resolveAsset = (rel: string): string =>
    path.join(userData, rel.split('/').join(path.sep));
  const signatureBox = profile?.signaturePath
    ? readImageBox(resolveAsset(profile.signaturePath), SIGNATURE_BOX)
    : null;
  const headerBox = profile?.headerImagePath
    ? readImageBox(resolveAsset(profile.headerImagePath), { widthPx: 0, heightPx: 0 })
    : null;
  const footerBox = profile?.footerImagePath
    ? readImageBox(resolveAsset(profile.footerImagePath), { widthPx: 0, heightPx: 0 })
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

// Quick task 260812-ns0 — load used-devices for the report (sorted
  // by sort_order ASC, then created_at ASC per the repo's listByProfile).
  // Empty array when the doctor hasn't added any devices; the template
  // hides the section in that case.
  //
  // Quick task 20260907-redesign-pdf-layout — usedDevices is no longer
  // rendered in the PDF body. We still resolve the instrument name
  // from the list (per-report override → used_devices.id → name),
  // so the device lookup stays.
  const usedDevicesRows = profile
    ? usedDevicesRepo.listByProfile(profile.id)
    : [];

  // Quick task 20260812-redesign-report — resolve the instrument label
  // from used_devices.id. Empty string when the doctor hasn't picked
  // one; the template omits the field in that case (matching the
  // premedication pattern).
  const instrumentLabel =
    report.instrument !== null
      ? (usedDevicesRows.find((d) => d.id === report.instrument)?.name ?? '')
      : '';
  const premedicationText =
    report.premedicationOverride !== null && report.premedicationOverride !== ''
      ? report.premedicationOverride
      : (profile?.premedication ?? null);

  // Quick task 20260907-redesign-pdf-layout — compute patient age
  // (whole years) from dob + procedure.startedAt. patient.dob is a
  // yyyy-mm-dd string; procedure.startedAt is ms epoch (UTC). Returns
  // null when dob is missing or unparseable so the template hides the
  // age column gracefully.
  const patientAgeYears: number | null = computeAgeYears(
    patient.dob,
    procedure.startedAt,
  );

  const input: ReportPdfInput = {
    // Quick task 260812-ns0 — header / footer image bands. Each is
    // null when the source is unset; the template handles the null
    // case by hiding the band entirely (no placeholder).
    //
    // Quick task 20260907-redesign-pdf-layout — logoBox dropped
    // (header band alone IS the page header). signatureBox moves
    // into the body (between the recommendation and the extra
    // screenshots).
    headerBox,
    footerBox,
    signatureBox,
    // Info box 1 — instrument + pre-medication.
    instrumentLabel,
    premedication: premedicationText,
    // Info box 2 — name + age + date.
    patientName: patient.fullName,
    patientAgeYears,
    procedureDateLabel: new Date(procedure.startedAt).toISOString().slice(0, 10),
    // Signature block — printed doctor name (signature image is above).
    doctorName: `Dr. ${doctor.full_name}`,
    // Procedure-type toggle + 8 box columns. The template renders
    // anatomy boxes conditional on procedureType + always-on
    // conclusion + recommendation.
    procedureType: report.procedureType,
    esophagus: report.esophagus,
    stomach: report.stomach,
    pylorus: report.pylorus,
    duodenum: report.duodenum,
    colon: report.colon,
    ileum: report.ileum,
    conclusion: report.conclusion,
    recommendation: report.recommendation,
    attachedScreenshots,
    language,
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

  // Phase 7 / Plan 07-04 — I18N-03 + RPT-06 + D-25: register the
  // Noto Sans Arabic TTF once per process when language === 'ar'.
  // The orchestrator doesn't pass the font into the factory — the
  // factory references it by family name ('NotoSansArabic') and
  // @react-pdf/renderer resolves it via the registered map.
  if (language === 'ar') {
    registerNotoArabicIfNeeded(reactPdf);
  }

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
  // (`userData` was declared earlier in this function for
  // `resolveAsset`.)
  const relPdfPath = path.relative(userData, pdfPath).split(path.sep).join('/');
  reportsRepo.setPdfPath(reportId, relPdfPath);

  audit({
    action: 'report.pdf_generated',
    entityType: 'report',
    entityId: reportId,
    userId: session.currentUserId,
    metadata: { pdfPath: relPdfPath, language },
  });

  return { pdfPath };
}
