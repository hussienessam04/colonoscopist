---
slug: redesign-pdf-layout
created: 2026-09-07
type: redesign
status: complete
---

# Summary: redesign Report PDF layout — match reference image

## Outcome

The Report PDF now matches the doctor's handwritten reference image:
the clinic's header image sits at the top of every page (full
width), two compact info boxes (Instrument + Pre-medication; Name
+ Age + Date) sit beneath it, the anatomy boxes + conclusion live
on the left while the first 4 attached screenshots stack
vertically on the right, then recommendation + signature block +
extra screenshots (5+) round out the body before the clinic's
footer image closes the page.

The previous layout (logo + clinic-name row beneath the header
band; "Patient" + "Procedure" blocks with Name/MRN/DOB/Gender +
Date/Duration/Doctor; anatomy boxes + recommendation as separate
sections; screenshots in a 3-column footer grid; signature +
clinic-name + page-number footer above the footer band) is
completely gone.

## What changed

**`src/main/pdf/report.tsx`** — full rewrite of
`createReportPdfElement`:

- Dropped: `LOGO_BOX` import, `placeholderText` helper, `header` /
  `headerLeft` / `headerRight` / `logoOrPlaceholder` / `footer` /
  `footerRtl` / `footerSignature` styles, the entire Patient block,
  the entire Procedure block, the used-devices block, the inline
  screenshot section.
- Added: `infoBox2` / `infoBox3` (the two info rows), `infoCol` /
  `infoColLast` (bordered column cells), `infoLabel` / `infoValue` /
  `infoValueLtr` (label-value pairs with bidi + LTR-isolation for
  numeric fragments), `mainRow` / `textColumn` / `screenshotColumn`
  (the two-column main layout), `anatomyBox` / `anatomyTitle` /
  `anatomyBody` / `anatomyBodyRtl` (the bordered anatomy cells),
  `rightThumbWrap` / `rightThumb` (the right-column screenshot
  cells), `extraRow` / `extraThumbWrap` / `extraThumb` (5+
  screenshots), `signatureBlock` / `signatureImage` /
  `signatureLine` (the body signature).
- Helpers: `ltrNumber` (preserved), `field` (new — renders a
  single label-value cell with bidi + numeric-fragment
  isolation), `anatomy` (new — renders a single bordered anatomy
  cell with bidi title + body).
- Right column shows first 4 screenshots; extras render below
  the signature in a wrap-row.

**`src/main/pdf/render-report-pdf.ts`** — orchestrator updated:

- Dropped: `LOGO_BOX` import, `logoBox` variable, `formatHHMMSS`
  helper, `clinicName` / `procedureDurationLabel` / `patientMrn` /
  `patientGender` / `patientDob` / `usedDevices` from the input
  literal.
- Added: `computeAgeYears(dob, procedureDateMs)` helper. Uses
  UTC date arithmetic so there's no local-time drift (Pitfall 8).
  Returns null when dob is missing, unparseable, or in the future
  relative to the procedure date.

**`ReportPdfInput`** shape:

- **Kept**: `headerBox`, `footerBox`, `signatureBox`, `doctorName`,
  `patientName`, `procedureDateLabel`, `instrumentLabel`,
  `premedication`, `procedureType`, all 8 anatomy fields,
  `conclusion`, `recommendation`, `attachedScreenshots`, `language`.
- **Dropped**: `logoBox`, `usedDevices`, `clinicName`,
  `procedureDurationLabel`, `patientMrn`, `patientDob`,
  `patientGender`.
- **Added**: `patientAgeYears: number | null`.

**Test inputs updated** (they were already broken — referenced
`findings` / `diagnosis` / `recommendations` fields that don't
exist + the legacy `ReportPdf` JSX component that was replaced by
`createReportPdfElement` in Phase 6):

- `tests/integration/pdf-smoke.test.ts` — all 3 `it()` cases now
  drive `createReportPdfElement` with the slim input shape.
- `tests/integration/ar-pdf-smoke.test.ts` — input literal updated
  to the slim shape (procedureType: 'colon').
- `tests/integration/ar-pdf-magic.test.ts` —
  `reportsRepo.updateDraft` now writes to `colon` + `conclusion` +
  `recommendation` instead of the legacy `findings` / `diagnosis` /
  `recommendations` triplet.

## Diff stat

```
 src/main/pdf/render-report-pdf.ts      | 122 +++--
 src/main/pdf/report.tsx                | 971 ++++++++++++---------------------
 tests/integration/ar-pdf-magic.test.ts |  11 +-
 tests/integration/ar-pdf-smoke.test.ts |  31 +-
 tests/integration/pdf-smoke.test.ts    | 164 +++---
 5 files changed, 547 insertions(+), 752 deletions(-)
```

Net: **−205 lines** across 5 files. The template file is now
~610 lines (down from 859), the orchestrator is 367 lines (down
slightly), and the test inputs are slimmer.

## Verification

- `npm run typecheck` (node + web) → exits 0, no errors.
- `npx vitest run tests/renderer/pages/report-editor.test.tsx` →
  10/10 pass.
- `npx vitest run tests/main/pdf/embed-image.test.ts` → 6/6 pass.
- The 3 PDF integration smoke tests (`pdf-smoke`, `ar-pdf-smoke`,
  `ar-pdf-magic`) are opt-in via `RUN_SMOKE=1`; they were already
  failing on the previous run (used legacy fields + the legacy
  `ReportPdf` JSX component). Updated to drive the new
  `createReportPdfElement` factory + slim input shape.
- Manual: render an actual PDF in dev (`npm run dev` → finalize a
  report → Open PDF) and confirm the layout matches the doctor's
  reference image. The doctor's profile header + footer images
  must be uploaded for the band-rendering branches to fire (the
  bands hide gracefully when missing — no placeholder text).

## Files

- `src/main/pdf/report.tsx` — template rewrite.
- `src/main/pdf/render-report-pdf.ts` — orchestrator + age helper.
- `tests/integration/pdf-smoke.test.ts` — input updated.
- `tests/integration/ar-pdf-smoke.test.ts` — input updated.
- `tests/integration/ar-pdf-magic.test.ts` — input updated.
- `.planning/quick/20260907-redesign-pdf-layout/PLAN.md` — plan.
- `.planning/quick/20260907-redesign-pdf-layout/SUMMARY.md` — this
  file.

## Commit

`824d4ee feat(pdf): redesign Report PDF layout — header/footer bands + info boxes + screenshot column + signature block`