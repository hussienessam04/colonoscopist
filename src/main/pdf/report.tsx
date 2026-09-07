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
const HEADER_BAND_STYLE = {
  width: '100%',
  height: 80,
  backgroundColor: '#E6EFF1',
  marginBottom: 6,
  padding: 4,
};
// Quick task 20260907-pdf-report-editor-fixes — footer pinned to
// the bottom of every page via `fixed: true` + `position:
// 'absolute', bottom: 0` + the page's paddingBottom is bumped to
// leave room (see pageStyle / pageRtl below). The band still
// reserves its 80px height when no image is uploaded (matches the
// always-render behavior from the previous task).
const FOOTER_BAND_STYLE = {
  position: 'absolute' as const,
  bottom: 32,
  left: 32,
  right: 32,
  width: 'auto',
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
  objectFit: 'contain' as const,
};
const FOOTER_BAND_IMAGE_STYLE = {
  width: '100%',
  height: '100%',
  objectFit: 'contain' as const,
};

// Quick task 20260907-redesign-pdf-layout — the right-column
// thumbnail size fits 4 stacked in a US Letter page (after the
// header band + 2 info boxes + 4 anatomy boxes + recommendation +
// signature + footer band leave ~22pt of vertical room per row of
// the right column at 11pt body). Width matches the column share.
const RIGHT_COL_THUMB_WIDTH = 110;
const RIGHT_COL_THUMB_HEIGHT = 88;
const EXTRA_THUMB_WIDTH = 120;
const EXTRA_THUMB_HEIGHT = 100;
// ponytail: only 4 screenshots on the right; the rest go below.
const RIGHT_COL_THUMB_COUNT = 4;

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
    // Quick task 20260907-pdf-report-editor-fixes — paddingBottom
    // bumped from 32 to 32 + 80 (footer band height) + 12 (small
    // gap) = 124 so the body content doesn't slide under the
    // pinned footer. Same for the RTL page.
    page: {
      padding: 32,
      paddingBottom: 124,
      fontSize: 11,
      fontFamily: 'Helvetica',
      color: '#0f172a',
    },
    pageRtl: {
      // ponytail: AR mode flips the page padding so the bound edge sits
      // on the right (where Arabic readers expect the spine).
      paddingTop: 32,
      paddingBottom: 124,
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
    //
    // Quick task 20260907-pdf-polish-recommendation-borders — dropped
    // the border (the reference image shows screenshots on the right
    // column with no border around each one).
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
    // Extra-screenshots row (5+) — wrap-row below the signature.
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
    // Signature block — image on the left, "Signature:" label +
    // signature line + printed doctor name on the right.
    //
    // Quick task 20260907-pdf-report-editor-fixes — borderTop
    // dropped (no line between screenshots and signature). The
    // signatureLine child keeps its own borderTop for the
    // underline where the doctor signs.
    signatureBlock: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      marginBottom: 6,
      paddingTop: 6,
      paddingBottom: 6,
    },
    signatureLabel: {
      fontSize: 10,
      fontWeight: 'bold',
      marginRight: 6,
    },
    signatureImage: {
      width: 120,
      height: 40,
      marginRight: 12,
      objectFit: 'contain' as const,
    },
    signatureLine: {
      flex: 1,
      borderTopWidth: 1,
      borderColor: '#0f172a',
      paddingTop: 2,
      fontSize: 10,
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
  const rightThumbs = attachedScreenshots.slice(0, RIGHT_COL_THUMB_COUNT);
  const extraThumbs = attachedScreenshots.slice(RIGHT_COL_THUMB_COUNT);

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
      React.createElement(
        P.View,
        { style: HEADER_BAND_STYLE, 'data-testid': 'report-pdf-header-band' },
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
          // Signature block — image (left) + "Signature:" label +
          // signature line + printed doctor name (right). Sits at
          // the bottom of the same left column as the anatomy boxes.
          React.createElement(
            P.View,
            {
              style: styles.signatureBlock,
              'data-testid': 'report-pdf-signature',
            },
            signatureBox !== null
              ? React.createElement(P.Image, {
                  src: signatureBox.buffer,
                  style: styles.signatureImage,
                })
              : null,
            // ponytail: "Signature:" label is bold so the section is
            // self-describing (quick task 20260907-pdf-report-editor-fixes).
            // AR label flows RTL via the existing isAr branch.
            isAr
              ? React.createElement(
                  P.Text,
                  { style: { ...styles.signatureLabel, direction: 'rtl' } },
                  'التوقيع: ',
                )
              : React.createElement(
                  P.Text,
                  { style: styles.signatureLabel },
                  'Signature: ',
                ),
            React.createElement(
              P.View,
              { style: styles.signatureLine },
              isAr
                ? React.createElement(
                    P.Text,
                    { style: { direction: 'rtl' } },
                    doctorName,
                  )
                : React.createElement(P.Text, null, doctorName),
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