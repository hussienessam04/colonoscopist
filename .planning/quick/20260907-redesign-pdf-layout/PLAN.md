---
slug: redesign-pdf-layout
created: 2026-09-07
type: redesign
source: ad-hoc user request — match reference image
---

# Quick Task: redesign Report PDF layout — match reference image

## Reference (doctor's reference image)

The doctor wants the PDF to match the layout of their current
printed clinic report (handwritten sample they want digital PDFs
to follow). The new layout:

1. **Header band** = profile `headerImagePath` (full width, ~80px
   tall). Drop the existing logo + signature + doctor name +
   procedure-date line that sat below the header band.
2. **Info Box 1** (bordered, full width) — `Instrument: <name>` on
   the left, `Pre-medication: <text>` on the right. One row, 2
   columns. Omit the instrument or pre-medication line when empty.
3. **Info Box 2** (bordered, full width) — `Name: <name>` on the
   left, `Age: <n> years` in the middle, `Date: <yyyy-mm-dd>` on
   the right. One row, 3 columns. Compute age from patient.dob +
   procedure.startedAt.
4. **Main content row** (bordered containers):
   - **Left column (~65%)**: stacked anatomy boxes — Esophagus,
     Stomach, Pylorus, Duodenum (upper_gi) OR Colon, Ileum
     (colon), plus the always-on Conclusion. Each is a bordered
     box with the title in bold + the body text below.
   - **Right column (~35%)**: stacked thumbnails of the first 4
     attached screenshots, one per "row" of the main content.
     Sized to fit a US Letter page; each thumbnail preserves its
     aspect ratio with `objectFit: 'contain'`.
5. **Recommendation** (bordered, full width) — sits below the
   main row. Same treatment as anatomy boxes (title + body).
6. **Signature block** (full width) — signature image (left) +
   printed doctor name (right). Sits between the recommendation
   and any extra screenshots.
7. **Additional screenshots** (5+) — if more than 4 screenshots
   are attached, the overflow thumbnails render in a wrap-row
   below the signature block (full width, 3 per row).
8. **Footer band** = profile `footerImagePath` (full width, ~80px
   tall). Drop the existing signature/doctor-name/Page-X-of-Y
   footer line that sat above the footer band.

## What goes (dropped from the current template)

- The "Patient" section block (Name + MRN + DOB + Gender).
- The "Procedure" section block (Date + Duration + Doctor +
  Instrument + Pre-medication).
- The "Used devices" block.
- The "Attached screenshots" section as a footer block.
- The fixed header row (logo + clinic name + signature + doctor
  name + procedure date).
- The fixed footer row (signature + clinic name + page number).
- The Page X of Y indicator (the doctor doesn't need it for the
  clinic's printed-PDF workflow).

## Input shape changes (`ReportPdfInput`)

- **Keep**: `headerBox`, `footerBox`, `signatureBox`, `doctorName`,
  `patientName`, `procedureDateLabel`, `instrumentLabel`,
  `premedication`, `procedureType`, all 8 anatomy fields,
  `conclusion`, `recommendation`, `attachedScreenshots`, `language`.
- **Drop**: `logoBox`, `usedDevices`, `clinicName`,
  `procedureDurationLabel`, `patientMrn`, `patientGender`.
- **Replace**: `patientDob` (string) → `patientAgeYears`
  (number | null). Orchestrator computes age = floor((procedureDate -
  dob) / year). Null when dob is missing or unparseable.
- **Drop**: `placeholderText('logo' | 'signature')` helper +
  `LOGO_BOX` + `SIGNATURE_BOX` constants (no longer consumed).

## Style additions

- `infoBox` — bordered row container.
- `infoBoxHalf` + `infoBoxThird` — equal-share columns.
- `infoBoxField` — a single field cell (label + value).
- `infoBoxLabel` — bold label.
- `infoBoxValue` — value text.
- `mainRow` — flex row holding the two columns.
- `textColumn` + `screenshotColumn` — the two columns.
- `anatomyBox` — single-bordered anatomy box.
- `screenshotStack` — flex column for the right column.
- `screenshotThumb` — single thumbnail (right column gets a
  ~110×88 box, fits 4 in US Letter with the header/footer bands
  + info boxes).
- `recommendationBox` — same treatment as anatomy boxes.
- `signatureBlock` — flex row, signature image on the left + name
  on the right.
- `signatureLine` — a horizontal line above the printed name (the
  doctor signs on this line).
- `extraScreenshotsRow` — flex row wrap.
- `extraScreenshotThumb` — single thumbnail (~120×100).
- Drop styles: `header`, `headerLeft`, `headerRight`,
  `logoOrPlaceholder`, `usedDevicesBlock`, `usedDevicesLabel`,
  `usedDevicesRow`, `usedDevicesNotes`, `screenshotsSection`,
  `screenshotGrid`, `screenshotCaption`, `footer`, `footerRtl`,
  `footerSignature`, `numericFragment` (the AR LTR-isolation
  helper stays — moved into `infoBoxValue`).

## RTL (Arabic) support

- Page padding flips (already done — `pageRtl`).
- Each bilingual field (Name, Instrument, Pre-medication) wraps
  in `<Text direction='rtl'>` in AR mode.
- Numeric fragments (Age, Date) stay LTR via the existing
  `ltrNumber` helper.
- Box titles (Esophagus, Stomach, Conclusion, etc.) wrap in
  `<Text direction='rtl'>` in AR mode.

## Files changed

- `src/main/pdf/report.tsx` — rewrite the layout. Drop unused
  imports (`LOGO_BOX`, `SIGNATURE_BOX`).
- `src/main/pdf/render-report-pdf.ts` — drop the fields that no
  longer exist in the input (`logoBox`, `usedDevices`,
  `clinicName`, `procedureDurationLabel`, `patientMrn`,
  `patientGender`); compute `patientAgeYears`; update the input
  object literal.
- `tests/integration/pdf-smoke.test.ts` + `ar-pdf-smoke.test.ts` +
  `ar-pdf-magic.test.ts` — update the stale `input` object
  literals to match the new shape (the tests are already broken
  with the current shape — they reference `findings` /
  `diagnosis` / `recommendations` fields and the old
  `ReportPdf` component, neither of which exists in
  `report.tsx`).

## Verification

- `npm run typecheck` (node + web) → exits 0.
- Manual: finalize a report in the Report Editor → click Open
  PDF → confirm the new layout matches the reference image.
- `tests/integration/pdf-smoke.test.ts` smoke updated to use the
  new input shape (the assertion stays: %PDF- magic + size
  > 5 KB).

## Out of scope

- Updating the ReportEditor UI to match (the editor already
  shows the same fields; the user only asked to change the PDF).
- Adding a "preview before printing" pane inside the editor.
- Multi-page pagination tuning (the new layout fits on one
  Letter page for typical reports; pagination is automatic).
- Localizing the new box titles (EN/AR parity is preserved
  via the existing `isAr` branches).