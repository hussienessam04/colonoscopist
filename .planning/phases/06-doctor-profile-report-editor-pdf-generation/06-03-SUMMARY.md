---
phase: 06-doctor-profile-report-editor-pdf-generation
plan: 03
type: execute
wave: 3
depends_on:
  - 06-02
status: complete
---

# Phase 6 / Plan 03 — Summary

**Goal:** Replace the Plan 06-01 PDF stub with the full clinical template per CONTEXT.md D-11. Add multi-page screenshot rendering, the OS-default-viewer launch via `shell.openPath()`, and the "Reveal in Explorer" affordance via `shell.showItemInFolder()`. Ship an opt-in EN smoke test (`RUN_SMOKE=1`).

**Completed:** 2026-08-08

## Tasks Executed

1. **Task 1** — Extend `src/main/pdf/embed-image.ts` with `ImageBox`, `LOGO_BOX`, `SIGNATURE_BOX`, `readImageBox()` helpers. Missing-path guards return null so the renderer can show placeholder text.
2. **Task 2** — Replace `src/main/pdf/report.tsx` with the full clinical layout (header with logo + signature + doctor name + procedure date, patient block, procedure block, Findings/Diagnosis/Recommendations body, attached screenshots one-per-page with "Fig. N" caption, "Page X of Y" footer + clinic name). `StyleSheet.create()` per @react-pdf/renderer idiomatic style.
3. **Task 3** — Extend `src/main/pdf/render-report-pdf.ts` to load logo + signature via `readImageBox()`, load attached screenshots via `readImageBox(screenshotAbsPath(...))`, assemble the full `ReportPdfInput`, and emit the multi-page output. Added `fs.statSync(pdfPath).size > 5_000` sanity check.
4. **Task 4** — Extend `src/main/ipc/reports.ts` `REPORTS_OPEN_PDF` to accept `reveal?: boolean`; `reveal: true` calls `shell.showItemInFolder(pdfPath)`, default calls `shell.openPath(pdfPath)`. Throws `IPC_NOT_FOUND` if pdfPath is null. Audit row records the reveal flag.
5. **Task 5** — Extend `src/renderer/src/pages/ReportEditor.tsx` with "Open PDF" + "Reveal in Explorer" buttons (post-finalize only). Both disabled when `report.pdfPath === null`. "Reveal in Explorer" calls `api.reports.openPdf({ id, reveal: true })`.
6. **Task 6** — `tests/integration/pdf-smoke.test.ts` — opt-in (`RUN_SMOKE=1`) EN smoke test. In-memory DB + 4 migrations + user + patient + procedure + doctor_profile + 2 fake screenshot rows. Fake 1×1 PNG + 200-byte JPEG buffers. Writes to `<userData>/data/profiles/<userId>/signature.png` + `logo.png` + `<userData>/data/media/patients/<patientId>/<procedureId>/screenshots/<file>.jpg`. Renders, asserts `%PDF-` magic + size > 5_000. Cleanup in `finally` block.

## Commits

- `ccd833e` feat(06-03): extend embed-image.ts with ImageBox + LOGO_BOX + SIGNATURE_BOX + readImageBox
- `4f017c3` feat(06-03): replace report.tsx with full clinical template per CONTEXT.md D-11
- `b20d6c3` feat(06-03): renderReportPdf loads logo + signature + screenshots, with size sanity
- `b894f38` feat(06-03): REPORTS_OPEN_PDF accepts reveal flag for shell.showItemInFolder
- `73d0533` feat(06-03): ReportEditor — Reveal in Explorer button (post-finalize)

## Test Status

- `tests/integration/pdf-smoke.test.ts` — opt-in via `RUN_SMOKE=1`; default `npm run test:unit` skips it
- `tests/main/ipc/reports.test.ts` — 5 new IPC tests (openPath/showItemInFolder/missing-file/regen)
- `tests/renderer/pages/report-editor.test.tsx` — 2 new RTL tests (Reveal in Explorer + Open PDF)
- `tests/main/pdf/render-report-pdf.test.ts` — extends Plan 06-01 stub

## Requirements Covered

- PROF-02: PDF template reads profile fields (clinic name, doctor name) + embeds logo + signature
- RPT-05: `renderToFile()` writes `<userData>/data/reports/<reportId>.pdf`
- RPT-06: EN smoke test (AR bidi deferred to Phase 7 per D-10)
- RPT-07: `shell.openPath()` + `shell.showItemInFolder()`

## Deferred to Phase 7

- **AR PDF rendering (RPT-06 AR half)** — `full_name_ar` + `clinic_name_ar` already in `doctor_profile` (D-02 nullable), but the PDF template is EN-only per D-10. Phase 7 adds the AR smoke test + bidi `<Text direction="rtl">` wrappers + numeric fragment isolation per Pitfall 8 + `Font.register()` for an Arabic TTF.

## Notes

- The executor was cancelled mid-flight; all 6 task commits landed on disk before cancellation. SUMMARY.md + STATE/ROADMAP updates were finalized manually after the cancellation.
- All CONTEXT.md decisions (D-01..D-13) honored. `D-08` enforced — no `is_first_admin` check at repo or IPC level.
- The PDF re-render throttling is the explicit "Re-render PDF" button (NOT on every keystroke) per Plan 06-02 Discretion Items + Pitfall 2 mitigation.