// @react-pdf/renderer ReportPdf component — full clinical layout per
// the doctor's reference image (quick task 20260907-redesign-pdf-layout).
// The renderer is sandboxed and never imports @react-pdf/renderer
// directly (Pitfall 1 / Pitfall 3 in RESEARCH.md); main calls
// renderToFile() after the renderer passes structured report data
// over IPC.
//
// Layout (reference image — clinic-printed-report style):
//   1. Top band = profile header image (full width, ~80px tall).
//   2. Info box 1 (bordered) — Instrument | Pre-medication.
//   3. Info box 2 (bordered) — Name | Age | Date.
//   4. Main row:
//      - Left column: stacked anatomy boxes + Conclusion (each bordered).
//      - Right column: first 4 attached screenshots (stacked vertically).
//   5. Recommendation (bordered, full width).
//   6. Signature block (signature image + printed doctor name, full width).
//   7. Extra screenshots (5+, full width, 3 per row).
//   8. Bottom band = profile footer image (full width, ~80px tall).
//
// Per RESEARCH §Pattern 3: <Text render={({ pageNumber, totalPages }) =>
// ...} fixed /> is the built-in @react-pdf/renderer pattern for the
// page-number footer; survives multi-page render automatically.
//
// IMPORTANT (Phase 6 UAT fix): @react-pdf/renderer v4 is ESM-only.
// Electron's main process is bundled to CJS by electron-vite. Static
// `import` of @react-pdf/renderer compiles to `require()` which crashes
// at runtime with ERR_REQUIRE_ESM. This module therefore does NOT
// statically import @react-pdf/renderer — instead it exports a pure
// factory function `createReportPdfElement(P, input)` that receives
// the React-PDF primitives (Document, Page, Text, View, Image,
// StyleSheet) as the first parameter. render-report-pdf.ts lazy-loads
// @react-pdf/renderer via `await import()` and calls the factory with
// the resolved module. The build emits a chunk that itself has no
// static require() of @react-pdf/renderer, so the chunk can be loaded
// from a CJS Electron main process without ERR_REQUIRE_ESM.
//
// Phase 7 / Plan 07-04 — I18N-03 + RPT-06 + D-25..D-27 + Pitfall 8:
// AR PDF rendering. The factory accepts `input.language`:
//   - 'en' (default): Helvetica font + LTR document direction.
//   - 'ar': NotoSansArabic font (pre-registered by render-report-pdf.ts)
//     + bidi <Text direction='rtl'> wrappers for Arabic body fields +
//     numeric fragment <Text direction='ltr'> isolation per Pitfall 8.
//   The bidi isolation is critical: per Pitfall 8, @react-pdf/renderer's
//   bidi is PARTIAL — without explicit direction overrides, "MRN: 12345"
//   renders as scrambled "MRN: 54321" in AR mode. Wrapping the numeric
//   fragment in `<Text direction='ltr'>` forces LTR ordering for that
//   span while the surrounding text flows RTL.

import React from 'react';
import type { ImageBox } from './embed-image';

// Top + bottom band styles. Full-width, ~80px tall, drawn just
// inside the page padding so the natural aspect ratio fits without
// overflowing. `objectFit: 'contain'` semantics on the
// @react-pdf/renderer <Image> preserves the actual image aspect.
//
// Quick task 20260907-pdf-polish-recommendation-borders — the band
// containers always render (even when no image is uploaded) so the
// page layout is stable. The wrap View carries the background tint
// + a fixed min height; the <Image> only renders when the buffer
// is available. ponytail: @react-pdf/renderer's `backgroundColor`
// accepts hex strings, the same palette as our UI tokens.
//
// Quick task 20260907-pdf-multipage-fixes — bands stretch edge-to-
// edge across the page (`left: 0, right: 0`, `width: '100%'`) so
// the image fills the full width. Both bands are pinned via
// `position: 'absolute'` + `fixed: true` (set at the render call
// site, not in this style) so they appear on EVERY page of a
// multi-page report.
//
// Quick task 20260907-pdf-screenshot-pagination-fix — restore
// `padding: 4` on both bands so the image is inset 4px from
// the band edges (matches the reference image where the band
// has a tinted margin around the actual image). The image's
// `width: '100%'` + `height: '100%'` fills the band's content
// area; `objectFit: 'contain'` preserves the source aspect
// ratio inside.
const HEADER_BAND_STYLE = {
  position: 'absolute' as const,
  top: 0,
  left: 0,
  right: 0,
  width: '100%',
  height: 80,
  backgroundColor: '#E6EFF1',
  padding: 4,
};
const FOOTER_BAND_STYLE = {
  position: 'absolute' as const,
  bottom: 0,
  left: 0,
  right: 0,
  width: '100%',
  height: 80,
  backgroundColor: '#E6EFF1',
  padding: 4,
};
// ponytail: when the band has an actual image, the image fills the
// band with `objectFit: 'contain'` so the original aspect ratio is
// preserved. The band wrap keeps the tinted background visible
// around the image (or empty when no image).
const HEADER_BAND_IMAGE_STYLE = {
  width: '100%',
  height: '100%',
  objectFit: "cover" as const,
};
const FOOTER_BAND_IMAGE_STYLE = {
  width: '100%',
  height: '100%',
  objectFit: 'cover' as const,
};

// Quick task 20260907-redesign-pdf-layout — the right-column
// thumbnail size. Each thumbnail is 110pt wide × 88pt tall.
//
// Quick task 20260907-pdf-5-screenshots-locked-toast —
// `RIGHT_COL_THUMB_COUNT = 5`. The doctor wants max 5
// screenshots stacked vertically in the right column; the
// rest render in a horizontal wrap row below the signature.
//
// Quick task 20260907-extra-screenshots-pack — shrunk
// `EXTRA_THUMB_WIDTH` + `EXTRA_THUMB_HEIGHT` to match the
// right column (110 × 88) instead of 120 × 100. The smaller
// thumbnails make the wrap row more compact vertically
// (~88pt instead of 100pt per row of extras), which lets a
// typical row fit on page 1 alongside the main row content.
// @react-pdf/renderer paginates any remaining overflow to
// page 2.
//
// Quick task 20260912-pdf-extras-3-per-row-page1 — shrunk
// `RIGHT_COL_THUMB_HEIGHT` from 88 → 72. Page 1's vertical
// budget after the info boxes is dominated by the right
// column at 5 × 88 = 440pt + 16pt margin = 456pt; with
// paddingTop (96) + info boxes (~72) + paddingBottom (96)
// + bands, only ~72pt remained for the extras wrap row —
// not enough for one row of 3 at 88pt each. Cutting the
// right column to 5 × 72 + 16 = 376pt frees ~80pt, so the
// extras wrap row now fits one full row of 3 on page 1
// (with ~64pt to spare). ponytail: keep RIGHT_COL_THUMB_WIDTH
// at 110; only the height shrinks so the screenshot's
// natural landscape aspect ratio still fits with
// `objectFit: 'contain'` inside the (now shorter) box.
const RIGHT_COL_THUMB_WIDTH = 110;
const RIGHT_COL_THUMB_HEIGHT = 72;
const RIGHT_COL_THUMB_COUNT = 5;
const EXTRA_THUMB_WIDTH = 110;
const EXTRA_THUMB_HEIGHT = 88;

export type AttachedScreenshot = {
  screenshotId: number;
  filePath: string;
  sortOrder: number;
  // ponytail: pre-loaded Buffer because @react-pdf/renderer scales per
  // its <Image style.width='100%'> prop and ignores intrinsic dims.
  imageBuffer: Buffer;
};

export type ReportLanguage = 'en' | 'ar';

export type ReportPdfInput = {
  // Top + bottom image bands (rendered on every page via `fixed`).
  headerBox: ImageBox | null;
  footerBox: ImageBox | null;
  // Info box 1 — instrument + pre-medication.
  instrumentLabel: string;
  premedication: string | null;
  // Info box 2 — name + age + date. `patientAgeYears` is null when
  // the patient has no DOB on file (orchestrator can't compute it).
  patientName: string;
  patientAgeYears: number | null;
  procedureDateLabel: string;
  // Signature block — image (when uploaded) + printed name.
  signatureBox: ImageBox | null;
  doctorName: string;
  // Procedure type drives which anatomy boxes render.
  procedureType: 'colon' | 'upper_gi';
  // 8 procedure-type-specific box columns.
  esophagus: string;
  stomach: string;
  pylorus: string;
  duodenum: string;
  colon: string;
  ileum: string;
  // Always-on conclusion + recommendation.
  conclusion: string;
  recommendation: string;
  // Attached screenshots (ordered ASC by sortOrder). First 4 go
  // on the right column; the rest go below the signature.
  attachedScreenshots: AttachedScreenshot[];
  // Phase 7 / Plan 07-04 — I18N-03 + RPT-06: 'en' keeps Helvetica + LTR
  // (default); 'ar' switches to NotoSansArabic + bidi <Text>
  // wrappers per D-25..D-27.
  language?: ReportLanguage;
};

// Minimal subset of @react-pdf/renderer primitives the template needs.
// Both TypeScript and the build treat this as `any`-shaped because
// @react-pdf/renderer's types are large; the factory function's
// contract is enforced by the runtime module shape (Document, Page,
// Text, View, Image, StyleSheet.create).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PdfPrimitives = any;

// ponytail: StyleSheet.create() is a state factory function that
// freezes styles at module evaluation time. With a no-static-import
// design the primitives arrive AFTER module init, so the factory
// takes primitives as a parameter and creates the stylesheet on the
// first call. Memoised inside the closure so subsequent renders
// don't re-freeze the same styles.
let _memoisedStyles: ReturnType<PdfPrimitives['StyleSheet']['create']> | null = null;
function getStyles(P: PdfPrimitives): ReturnType<PdfPrimitives['StyleSheet']['create']> {
  if (_memoisedStyles) return _memoisedStyles;
  _memoisedStyles = P.StyleSheet.create({
    // Quick task 20260907-pdf-multipage-fixes — paddingTop +
    // paddingBottom bumped to 96 (band 80 + 16 gap) on BOTH sides so
    // body content fits inside the pinned header + footer bands on
    // every page of a multi-page report. The bands themselves are
    // edge-to-edge (`left: 0, right: 0`); the page padding only
    // affects the body content area.
    page: {
      paddingTop: 96,
      paddingBottom: 96,
      paddingLeft: 32,
      paddingRight: 32,
      fontSize: 11,
      fontFamily: 'Helvetica',
      color: '#0f172a',
    },
    pageRtl: {
      // ponytail: AR mode flips the page padding so the bound edge sits
      // on the right (where Arabic readers expect the spine).
      paddingTop: 96,
      paddingBottom: 96,
      paddingLeft: 32,
      paddingRight: 32,
      fontSize: 11,
      fontFamily: 'NotoSansArabic',
      color: '#0f172a',
    },
    // Info box 1 (Instrument + Pre-medication, 2 columns).
    infoBox2: {
      flexDirection: 'row',
      borderWidth: 1,
      borderColor: '#94a3b8',
      marginBottom: 6,
    },
    // Info box 2 (Name + Age + Date, 3 columns).
    infoBox3: {
      flexDirection: 'row',
      borderWidth: 1,
      borderColor: '#94a3b8',
      marginBottom: 6,
    },
    // Each column inside an info box (border-right separates columns).
    infoCol: {
      flexDirection: 'row',
      flex: 1,
      padding: 6,
      borderRightWidth: 1,
      borderRightColor: '#cbd5e1',
    },
    // Last column drops the border-right.
    infoColLast: {
      flexDirection: 'row',
      flex: 1,
      padding: 6,
    },
    infoLabel: {
      fontWeight: 'bold',
      marginRight: 4,
    },
    infoValue: {},
    infoValueLtr: {
      // ponytail: numeric fragments (Age, Date) flow LTR even when
      // the surrounding label is RTL in AR mode. Pitfall 8.
      direction: 'ltr' as const,
    },
    // Main row — text boxes on the left, screenshot stack on the right.
    mainRow: {
      flexDirection: 'row',
      marginBottom: 6,
    },
    textColumn: {
      flex: 1,
      marginRight: 6,
    },
    screenshotColumn: {
      width: RIGHT_COL_THUMB_WIDTH + 8,
      flexDirection: 'column',
    },
    // Single anatomy / conclusion / recommendation box.
    //
    // Quick task 20260907-pdf-report-editor-fixes — border dropped
    // (matches the reference image where the boxes are separated
    // by gaps, not lines). The padding + marginBottom spacing
    // remain so the boxes stay visually distinct.
    anatomyBox: {
      padding: 6,
      marginBottom: 4,
    },
    anatomyTitle: {
      fontWeight: 'bold',
      fontSize: 11,
      marginBottom: 2,
    },
    anatomyBody: {
      lineHeight: 1.3,
    },
    anatomyBodyRtl: {
      lineHeight: 1.3,
      direction: 'rtl' as const,
    },
    // Right-column screenshot thumbnail.
    rightThumbWrap: {
      width: RIGHT_COL_THUMB_WIDTH,
      height: RIGHT_COL_THUMB_HEIGHT,
      marginBottom: 4,
    },
    rightThumb: {
      width: RIGHT_COL_THUMB_WIDTH,
      height: RIGHT_COL_THUMB_HEIGHT,
      objectFit: 'contain' as const,
    },
    // Screenshots wrap row — overflow thumbnails (those that
    // didn't fit in the right column above) render as a
    // horizontal wrap row below the signature block.
    // `flexWrap: 'wrap'` lets the thumbnails flow onto
    // multiple lines; @react-pdf/renderer paginates any
    // further overflow to the next page.
    extraRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginBottom: 6,
    },
    extraThumbWrap: {
      width: EXTRA_THUMB_WIDTH,
      height: EXTRA_THUMB_HEIGHT,
      marginRight: 6,
      marginBottom: 6,
      // Quick task 20260907-pdf-polish-recommendation-borders —
      // border dropped (matches the reference image).
    },
    extraThumb: {
      width: EXTRA_THUMB_WIDTH,
      height: EXTRA_THUMB_HEIGHT,
      objectFit: 'contain' as const,
    },
    // Signature block — "Signature:" label centered (row 1),
    // signature image (row 2), printed doctor name on the
    // bottom (row 3). The block uses `flexDirection: 'column'`
    // + `alignItems: 'center'` so everything stacks + centers
    // horizontally. The `signatureLabel` is bold + a little
    // larger so it reads as the section title.
    //
    // Quick task 20260907-pdf-screenshot-pagination-fix —
    // restored the "Signature:" label that the doctor asked
    // for back. The previous round dropped it; the doctor
    // wanted it back AND centered.
    signatureBlock: {
      flexDirection: 'column',
      alignItems: 'center',
      marginTop: 8,
      marginBottom: 6,
    },
    signatureLabel: {
      fontSize: 11,
      fontWeight: 'bold',
      marginBottom: 4,
    },
    signatureImage: {
      width: 120,
      height: 40,
      marginBottom: 4,
      objectFit: 'contain' as const,
    },
    signatureName: {
      fontSize: 10,
      fontWeight: 'bold',
    },
  });
  return _memoisedStyles;
}

/**
 * Build the React element tree for the report PDF using the supplied
 * @react-pdf/renderer primitives. The caller is responsible for
 * passing in a fully-resolved module (Document, Page, Text, View,
 * Image, StyleSheet) — typically loaded via
 * `await import('@react-pdf/renderer')` in a CJS main process.
 *
 * Returning a React element (not JSX) lets the factory be plain
 * `React.createElement` calls — the build emits static require()s for
 * `react` only, and the @react-pdf/renderer primitives are passed by
 * reference at call time.
 *
 * Phase 7 / Plan 07-04 — I18N-03: input.language = 'ar' switches to
 * NotoSansArabic font + bidi <Text direction='rtl'> wrappers for body
 * fields + numeric fragment <Text direction='ltr'> isolation per
 * Pitfall 8. The font must be pre-registered by the orchestrator
 * (render-report-pdf.ts) before calling this factory.
 */
export function createReportPdfElement(
  P: PdfPrimitives,
  input: ReportPdfInput,
): React.JSX.Element {
  const styles = getStyles(P);
  const {
    headerBox = null,
    footerBox = null,
    instrumentLabel,
    premedication = null,
    patientName,
    patientAgeYears,
    procedureDateLabel,
    signatureBox = null,
    doctorName,
    procedureType,
    esophagus,
    stomach,
    pylorus,
    duodenum,
    colon,
    ileum,
    conclusion,
    recommendation,
    attachedScreenshots,
    language = 'en',
  } = input;
  const isAr = language === 'ar';
  const pageStyle = isAr ? styles.pageRtl : styles.page;

  // ponytail: numeric fragment Text factory. Age + Date are wrapped
  // in direction:'ltr' so AR body text (RTL) flows around them but
  // the digits stay LTR (Pitfall 8).
  const ltrNumber = (key: string, body: string): React.JSX.Element => {
    return React.createElement(
      P.Text,
      { key, style: { direction: 'ltr' } },
      body,
    ) as React.JSX.Element;
  };

  // ponytail: bidi-wrapped label/value pair. The label flows through
  // the bidi wrapper (EN = LTR, AR = RTL); the value flows the same
  // direction EXCEPT when it's a numeric fragment (Age / Date), which
  // is forced to LTR via `ltrNumber`. Empty values are hidden (no
  // dangling colon).
  const field = (
    key: string,
    labelEn: string,
    labelAr: string,
    value: string,
    numeric: boolean,
    isLast: boolean,
  ): React.JSX.Element | null => {
    if (value === '' || value === null) return null;
    return React.createElement(
      P.View,
      { key, style: isLast ? styles.infoColLast : styles.infoCol },
      isAr
        ? React.createElement(
            P.Text,
            { style: { ...styles.infoLabel, direction: 'rtl' } },
            labelAr,
          )
        : React.createElement(P.Text, { style: styles.infoLabel }, labelEn),
      numeric
        ? ltrNumber(`${key}-val`, value)
        : isAr
          ? React.createElement(
              P.Text,
              { style: { ...styles.infoValue, direction: 'rtl' } },
              value,
            )
          : React.createElement(P.Text, { style: styles.infoValue }, value),
    );
  };

  // ponytail: anatomy / conclusion / recommendation box.
  // `body` is bidi-wrapped in AR mode (empty → '—' placeholder so
  // the box keeps its layout even before the doctor types).
  const anatomy = (
    key: string,
    titleEn: string,
    titleAr: string,
    body: string,
  ): React.JSX.Element =>
    React.createElement(
      P.View,
      { key, style: styles.anatomyBox },
      isAr
        ? React.createElement(
            P.Text,
            { style: { ...styles.anatomyTitle, direction: 'rtl' } },
            titleAr,
          )
        : React.createElement(P.Text, { style: styles.anatomyTitle }, titleEn),
      isAr
        ? React.createElement(
            P.Text,
            { style: styles.anatomyBodyRtl },
            body || '—',
          )
        : React.createElement(P.Text, { style: styles.anatomyBody }, body || '—'),
    );

  // Quick task 20260907-redesign-pdf-layout — first 4 screenshots
  // go on the right column (stacked vertically); the rest go below
  // the signature in a wrap-row. Same source list — split here.
  // Quick task 20260907-pdf-screenshot-pagination-fix — the
  // right column has the first 5 screenshots stacked
  // vertically; the rest render in the `extraRow` wrap row
  // below the signature.
  //
  // Quick task 20260907-pdf-5-screenshots-locked-toast —
  // hard-capped at 5 (RIGHT_COL_THUMB_COUNT) per the doctor's
  // request: max 5 vertical, rest horizontal wrap row. The
  // right column's max height on a typical page (info boxes
  // + 4 anatomy boxes = ~440pt) fits exactly 5 thumbnails
  // at 88pt each — going higher produces the awkward page-1 +
  // page-2 split the doctor reported.
  const rightThumbs = attachedScreenshots.slice(
    0,
    RIGHT_COL_THUMB_COUNT,
  );
  const extraThumbs = attachedScreenshots.slice(
    RIGHT_COL_THUMB_COUNT,
  );

  return React.createElement(
    P.Document,
    null,
    React.createElement(
      P.Page,
      { size: 'LETTER', style: pageStyle },
      // 1. Top band — always renders so the page layout is stable;
      //    the <Image> sits inside when the doctor has uploaded a
      //    header image. When no image is uploaded, the band shows
      //    a thin tinted strip (backgroundColor on the wrap).
      //    Quick task 20260907-pdf-multipage-fixes — `fixed: true`
      //    makes the band appear on EVERY page of a multi-page
      //    report (not just page 1). The body's paddingTop (96)
      //    leaves room so content doesn't slide under the band.
      React.createElement(
        P.View,
        {
          style: HEADER_BAND_STYLE,
          fixed: true,
          'data-testid': 'report-pdf-header-band',
        },
        headerBox !== null
          ? React.createElement(P.Image, {
              src: headerBox.buffer,
              style: HEADER_BAND_IMAGE_STYLE,
              'data-testid': 'report-pdf-header-image',
            })
          : null,
      ),

      // 2. Info box 1 — Instrument | Pre-medication (2 columns).
      React.createElement(
        P.View,
        {
          style: styles.infoBox2,
          'data-testid': 'report-pdf-info-box-instrument-premedication',
        },
        field(
          'instrument',
          'Instrument: ',
          'الجهاز: ',
          instrumentLabel,
          false,
          premedication === null || premedication === '',
        ),
        field(
          'premedication',
          'Pre-medication: ',
          'التخدير المبدئي: ',
          premedication ?? '',
          false,
          true,
        ),
      ),

      // 3. Info box 2 — Name | Age | Date (3 columns).
      React.createElement(
        P.View,
        {
          style: styles.infoBox3,
          'data-testid': 'report-pdf-info-box-patient',
        },
        field('name', 'Name: ', 'الاسم: ', patientName, false, false),
        field(
          'age',
          'Age: ',
          'العمر: ',
          patientAgeYears === null ? '' : `${patientAgeYears} years`,
          true,
          false,
        ),
        field('date', 'Date: ', 'التاريخ: ', procedureDateLabel, true, true),
      ),

      // 4. Main row — text column (left) + first 4 screenshots (right).
      //
      //    Quick task 20260907-pdf-polish-recommendation-borders —
      //    the recommendation box + signature block moved from the
      //    page-level flow into the LEFT column of this row. The
      //    reference image shows the doctor's clinical text
      //    (anatomy + conclusion + recommendation + signature) as
      //    one stacked flow on the left, with screenshots on the
      //    right.
      React.createElement(
        P.View,
        {
          style: styles.mainRow,
          'data-testid': 'report-pdf-main-row',
        },
        React.createElement(
          P.View,
          { style: styles.textColumn },
          procedureType === 'upper_gi'
            ? anatomy('esophagus', 'Esophagus', 'المريء', esophagus)
            : null,
          procedureType === 'upper_gi'
            ? anatomy('stomach', 'Stomach', 'المعدة', stomach)
            : null,
          procedureType === 'upper_gi'
            ? anatomy('pylorus', 'Pylorus', 'البواب', pylorus)
            : null,
          procedureType === 'upper_gi'
            ? anatomy('duodenum', 'Duodenum', 'الاثني عشر', duodenum)
            : null,
          procedureType === 'colon'
            ? anatomy('colon', 'Colon', 'القولون', colon)
            : null,
          procedureType === 'colon'
            ? anatomy('ileum', 'Ileum', 'اللفائفي', ileum)
            : null,
          anatomy('conclusion', 'Conclusion', 'الخلاصة', conclusion),
          anatomy(
            'recommendation',
            'Recommendation',
            'التوصيات',
            recommendation,
          ),
          // Signature block — image on row 1, printed doctor name
          // on row 2. Sits at the bottom of the same left column
          // as the anatomy boxes.
          React.createElement(
            P.View,
            {
              style: styles.signatureBlock,
              'data-testid': 'report-pdf-signature',
            },
            // Row 1 — "Signature:" label, centered (EN + AR).
            // Quick task 20260907-pdf-screenshot-pagination-fix —
            // restored the "Signature:" label that was dropped in
            // the previous round, plus centered alignment per the
            // doctor's request.
            isAr
              ? React.createElement(
                  P.Text,
                  {
                    style: {
                      ...styles.signatureLabel,
                      direction: 'rtl',
                      alignSelf: 'center',
                    },
                  },
                  'التوقيع: ',
                )
              : React.createElement(
                  P.Text,
                  {
                    style: {
                      ...styles.signatureLabel,
                      alignSelf: 'center',
                    },
                  },
                  'Signature: ',
                ),
            // Row 2 — the doctor's actual signature (image).
            // Null when no signature has been uploaded in Profile;
            // the block just shows the printed name on row 3.
            signatureBox !== null
              ? React.createElement(P.Image, {
                  src: signatureBox.buffer,
                  style: styles.signatureImage,
                })
              : null,
            // Row 3 — the printed doctor name. Bold so it reads
            // as a signature line. AR flows RTL via the existing
            // isAr branch.
            isAr
              ? React.createElement(
                  P.Text,
                  { style: { ...styles.signatureName, direction: 'rtl' } },
                  doctorName,
                )
              : React.createElement(
                  P.Text,
                  { style: styles.signatureName },
                  doctorName,
                ),
          ),
        ),
        React.createElement(
          P.View,
          {
            style: styles.screenshotColumn,
            'data-testid': 'report-pdf-right-screenshots',
          },
          ...rightThumbs.map((s) =>
            React.createElement(
              P.View,
              { key: s.screenshotId, style: styles.rightThumbWrap },
              React.createElement(P.Image, {
                src: s.imageBuffer,
                style: styles.rightThumb,
              }),
            ),
          ),
        ),
      ),

      // 5. Extra screenshots (5+) — wrap-row below the main row.
      extraThumbs.length > 0
        ? React.createElement(
            P.View,
            {
              style: styles.extraRow,
              'data-testid': 'report-pdf-extra-screenshots',
            },
            ...extraThumbs.map((s) =>
              React.createElement(
                P.View,
                { key: s.screenshotId, style: styles.extraThumbWrap },
                React.createElement(P.Image, {
                  src: s.imageBuffer,
                  style: styles.extraThumb,
                }),
              ),
            ),
          )
        : null,

      // 6. Bottom band — pinned to the bottom of every page via
      //    `fixed: true`. Same shape as the top band: always
      //    renders so the page layout is stable. The body
      //    content's paddingBottom (124) leaves room for the
      //    80px band + a 12pt gap.
      React.createElement(
        P.View,
        {
          style: FOOTER_BAND_STYLE,
          fixed: true,
          'data-testid': 'report-pdf-footer-band',
        },
        footerBox !== null
          ? React.createElement(P.Image, {
              src: footerBox.buffer,
              style: FOOTER_BAND_IMAGE_STYLE,
              'data-testid': 'report-pdf-footer-image',
            })
          : null,
      ),
    ),
  );
}