// @react-pdf/renderer ReportPdf component — full clinical layout per
// CONTEXT.md D-11. The renderer is sandboxed and never imports
// @react-pdf/renderer directly (Pitfall 1 / Pitfall 3 in RESEARCH.md);
// main calls renderToFile() after the renderer passes structured
// report data over IPC.
//
// Layout:
//   - Header (top-left logo + clinic name; top-right signature + doctor
//     name + procedure date)
//   - Patient block (name, MRN, DOB, gender)
//   - Procedure block (date, duration HH:MM:SS, doctor)
//   - Findings / Diagnosis / Recommendations body sections (EN-only per
//     CONTEXT.md D-10; bidi/RTL deferred to Phase 7 i18n)
//   - One <Page> per attached screenshot with a "Fig. N" caption
//   - Footer with "Page X of Y" + clinic name on every page
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
//   - 'en' (default): Helvetica font + LTR document direction (unchanged from Phase 6)
//   - 'ar': NotoSansArabic font (pre-registered by render-report-pdf.ts)
//     + bidi <Text direction='rtl'> wrappers for Arabic body fields +
//     numeric fragment <Text direction='ltr'> isolation per Pitfall 8.
//   The bidi isolation is critical: per Pitfall 8, @react-pdf/renderer's
//   bidi is PARTIAL — without explicit direction overrides, "MRN: 12345"
//   renders as scrambled "MRN: 54321" in AR mode. Wrapping the numeric
//   fragment in `<Text direction='ltr'>` forces LTR ordering for that
//   span while the surrounding text flows RTL.

import React from 'react';
import {
  LOGO_BOX,
  SIGNATURE_BOX,
  type ImageBox,
} from './embed-image';

// Quick task 260812-ns0 — header (top) + footer (bottom) band styles.
// Full-width images, ~80px tall, drawn just inside the page padding
// (so the natural aspect ratio fits without overflowing the page
// width). The aspect ratio of the actual uploaded image is preserved
// via `objectFit: 'contain'` semantics on the @react-pdf/renderer
// <Image> — the band's height grows to match when the source is
// taller than 80px.
const HEADER_BAND_STYLE = {
  width: '100%',
  maxHeight: 80,
  objectFit: 'contain' as const,
  marginBottom: 12,
  // data-testid set on the <Image> itself, not the style.
};
const FOOTER_BAND_STYLE = {
  width: '100%',
  maxHeight: 80,
  objectFit: 'contain' as const,
  marginTop: 12,
};

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
  // Header inputs (logo top-left, signature top-right).
  logoBox: ImageBox | null;
  signatureBox: ImageBox | null;
  // Quick task 260812-ns0 — header (top band) + footer (bottom band)
  // image boxes, rendered on every PDF page. Null when the doctor has
  // not uploaded the asset; the template omits the band entirely in
  // that case (no placeholder, unlike logo + signature which show
  // "[No logo uploaded]" / "[No signature on file]").
  headerBox: ImageBox | null;
  footerBox: ImageBox | null;
  // Quick task 260812-ns0 — used devices (1:N with doctor_profile).
  // Rendered as a compact name + optional-notes list in the patient
  // block header. Empty array = the section is hidden.
  usedDevices: { id: string; name: string; notes: string | null }[];
  // Quick task 260812-ns0 — clinic-default premedication (free-text).
  // Surfaces in the patient block header above findings.
  premedication: string | null;
  clinicName: string;
  doctorName: string;
  procedureDateLabel: string;
  // Patient block.
  patientName: string;
  patientMrn: string | null;
  patientDob: string;
  patientGender: string | null;
  // Procedure block.
  procedureDurationLabel: string;
  // Body sections.
  findings: string;
  diagnosis: string;
  recommendations: string;
  // Attached screenshots (one per page, ordered ASC by sortOrder).
  attachedScreenshots: AttachedScreenshot[];
  // Phase 7 / Plan 07-04 — I18N-03 + RPT-06: 'en' keeps Helvetica + LTR
  // (Phase 6 default); 'ar' switches to NotoSansArabic + bidi <Text>
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
    page: {
      padding: 36,
      fontSize: 11,
      fontFamily: 'Helvetica',
      color: '#1f2937',
    },
    pageRtl: {
      // ponytail: AR mode flips the page padding so the bound edge sits
      // on the right (where Arabic readers expect the spine).
      paddingTop: 36,
      paddingBottom: 36,
      paddingLeft: 36,
      paddingRight: 36,
      fontSize: 11,
      fontFamily: 'NotoSansArabic',
      color: '#1f2937',
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 18,
      paddingBottom: 6,
      borderBottomWidth: 1,
      borderBottomColor: '#cbd5e1',
    },
    headerLeft: {
      flexDirection: 'column',
      width: 200,
    },
    headerRight: {
      flexDirection: 'column',
      width: 220,
      // ponytail: alignItems is not in @react-pdf/renderer's CSS subset;
      // manual right-alignment via textAlign on the children.
    },
    logoOrPlaceholder: {
      fontSize: 9,
      color: '#94a3b8',
    },
    section: {
      marginTop: 14,
      marginBottom: 14,
    },
    sectionTitle: {
      fontSize: 12,
      fontWeight: 'bold',
      marginBottom: 4,
      color: '#0f172a',
    },
    body: {
      lineHeight: 1.4,
    },
    bodyRtl: {
      lineHeight: 1.4,
      // ponytail: @react-pdf/renderer's bidi respects direction on the
      // parent Text; alignItems/textAlign on the surrounding View has
      // no effect on Text wrapping. We rely on <Text direction='rtl'>
      // for the actual bidi flip (Pitfall 8).
    },
    // ponytail: patientBlock was flexWrap:'wrap' + gap:8 — both are
    // outside @react-pdf/renderer's CSS subset. Use explicit
    // textAlign:'right' on the row + per-field marginRight instead;
    // a tighter, deterministic layout for clinical PDFs.
    patientBlock: {
      flexDirection: 'row',
      marginTop: 6,
    },
    patientField: {
      marginRight: 18,
    },
    // Quick task 260812-ns0 — used-devices block (compact name list
    // with optional notes) sits inside the patient block above the
    // procedure block. Hidden when usedDevices.length === 0.
    usedDevicesBlock: {
      marginTop: 6,
      width: '100%',
    },
    usedDevicesLabel: {
      fontSize: 10,
      fontWeight: 'bold',
      color: '#0f172a',
      marginBottom: 2,
    },
    usedDevicesRow: {
      fontSize: 10,
      color: '#1f2937',
    },
    usedDevicesNotes: {
      fontSize: 10,
      color: '#475569',
    },
    // Phase 6 UAT G-06-4 — attached screenshots render as INLINE
    // thumbnails BELOW the body sections (not separate full-page
    // figures). Each thumbnail is ~120×100px to keep the visual
    // footprint small + a grid of 3 columns.
    screenshotsSection: {
      marginTop: 14,
      marginBottom: 14,
    },
    screenshotGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginTop: 6,
    },
    screenshotThumb: {
      width: 120,
      height: 100,
      marginRight: 8,
      marginBottom: 8,
    },
    screenshotCaption: {
      fontSize: 9,
      color: '#475569',
      marginTop: 2,
    },
    footer: {
      position: 'absolute',
      bottom: 18,
      left: 36,
      right: 36,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      fontSize: 9,
      color: '#64748b',
      borderTopWidth: 1,
      borderTopColor: '#e2e8f0',
      paddingTop: 6,
    },
    footerSignature: {
      width: 60,
      height: 20,
      marginRight: 6,
    },
    // Phase 7 / Plan 07-04 — I18N-03 + D-25 + Pitfall 8: signature
    // placement flips to bottom-LEFT in AR mode (vs bottom-RIGHT in
    // EN mode). The footer uses flexDirection:'row' for EN; AR uses
    // row-reversed so the signature+doctor group sits on the left.
    footerRtl: {
      position: 'absolute',
      bottom: 18,
      left: 36,
      right: 36,
      flexDirection: 'row-reverse',
      justifyContent: 'space-between',
      alignItems: 'center',
      fontSize: 9,
      color: '#64748b',
      borderTopWidth: 1,
      borderTopColor: '#e2e8f0',
      paddingTop: 6,
    },
    // Phase 7 / Plan 07-04 — I18N-03 + Pitfall 8: numeric fragment
    // isolation. The numeric Text is wrapped in direction:'ltr' so
    // Arabic body text flows RTL around it but the digits stay LTR.
    numericFragment: {
      // ponytail: the direction style on Text forces bidi ordering
      // for the span; the rendering engine reads it as an LTR run.
      // No fontFamily override — the page's font (Helvetica for EN,
      // NotoSansArabic for AR) covers both ASCII digits and AR glyphs.
    },
  });
  return _memoisedStyles;
}

function placeholderText(missing: 'logo' | 'signature'): string {
  return missing === 'logo' ? '[No logo uploaded]' : '[No signature on file]';
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
    logoBox,
    signatureBox,
    // Quick task 260812-ns0 — header / footer image bands + used
    // devices + premedication. Header/footer default to null (the
    // bands are hidden when the doctor hasn't uploaded an asset).
    headerBox = null,
    footerBox = null,
    usedDevices = [],
    premedication = null,
    clinicName,
    doctorName,
    procedureDateLabel,
    patientName,
    patientMrn,
    patientDob,
    patientGender,
    procedureDurationLabel,
    findings,
    diagnosis,
    recommendations,
    attachedScreenshots,
    language = 'en',
  } = input;
  const isAr = language === 'ar';
  const pageStyle = isAr ? styles.pageRtl : styles.page;
  const footerStyle = isAr ? styles.footerRtl : styles.footer;
  // ponytail: bidi-wrapped Text factory. Returns a Text element with
  // direction:'rtl' when isAr=true (forces bidi reorder for Arabic body
  // fields), else a plain Text with the body's default direction.
  const rtlText = (
    key: string,
    body: string,
    extraStyle?: Record<string, unknown>,
  ): React.JSX.Element => {
    if (!isAr) {
      return React.createElement(
        P.Text,
        { key, style: extraStyle ?? styles.body },
        body,
      ) as React.JSX.Element;
    }
    return React.createElement(
      P.Text,
      { key, style: { ...styles.bodyRtl, direction: 'rtl', ...extraStyle } },
      body,
    ) as React.JSX.Element;
  };
  // ponytail: numeric fragment Text factory. The numeric value is
  // wrapped in direction:'ltr' so AR body text (RTL) flows around it
  // but the digits stay LTR — without this, Pitfall 8 strikes and
  // "MRN: 12345" renders as "54321 :MRN" inside an RTL container.
  const ltrNumber = (key: string, body: string): React.JSX.Element => {
    return React.createElement(
      P.Text,
      { key, style: { direction: 'ltr' } },
      body,
    ) as React.JSX.Element;
  };

  return React.createElement(
    P.Document,
    null,
    React.createElement(
      P.Page,
      { size: 'LETTER', style: pageStyle },
      // Quick task 260812-ns0 — top band: the uploaded header image
      // (full-width, ~80px tall) renders above the existing fixed
      // header. Null when the doctor hasn't uploaded one; the band is
      // hidden entirely in that case (no placeholder).
      headerBox !== null
        ? React.createElement(
            P.Image,
            {
              src: headerBox.buffer,
              style: HEADER_BAND_STYLE,
              'data-testid': 'report-pdf-header-image',
            },
          )
        : null,
      // Header (logo + signature + names + date)
      React.createElement(
        P.View,
        { style: styles.header, fixed: true },
        React.createElement(
          P.View,
          { style: styles.headerLeft },
          logoBox
            ? React.createElement(P.Image, {
                src: logoBox.buffer,
                style: { width: LOGO_BOX.widthPx, height: LOGO_BOX.heightPx },
              })
            : React.createElement(
                P.Text,
                { style: styles.logoOrPlaceholder },
                placeholderText('logo'),
              ),
          // ponytail: clinic name + doctor name flow through the bidi
          // wrapper — Arabic clinic names render RTL naturally; English
          // stays LTR. The wrapper is a no-op for EN mode.
          isAr
            ? React.createElement(
                P.Text,
                { style: { fontSize: 14, fontWeight: 'bold', direction: 'rtl' } },
                clinicName,
              )
            : React.createElement(P.Text, { style: { fontSize: 14, fontWeight: 'bold' } }, clinicName),
        ),
        React.createElement(
          P.View,
          { style: styles.headerRight },
          signatureBox
            ? React.createElement(P.Image, {
                src: signatureBox.buffer,
                style: { width: SIGNATURE_BOX.widthPx, height: SIGNATURE_BOX.heightPx },
              })
            : React.createElement(
                P.Text,
                { style: styles.logoOrPlaceholder },
                placeholderText('signature'),
              ),
          isAr
            ? React.createElement(
                P.Text,
                { style: { direction: 'rtl' } },
                doctorName,
              )
            : React.createElement(P.Text, null, doctorName),
          React.createElement(P.Text, null, procedureDateLabel),
        ),
      ),

      // Patient block — Patient name is bidi-wrapped; MRN/DOB/Gender
      // labels are bidi-wrapped but the NUMERIC VALUES (MRN, DOB) are
      // isolated as LTR per Pitfall 8.
      React.createElement(
        P.View,
        { style: styles.section },
        isAr
          ? React.createElement(
              P.Text,
              { style: { ...styles.sectionTitle, direction: 'rtl' } },
              'Patient',
            )
          : React.createElement(P.Text, { style: styles.sectionTitle }, 'Patient'),
        React.createElement(
          P.View,
          { style: styles.patientBlock },
          React.createElement(
            P.Text,
            { style: styles.patientField },
            'Name: ',
            isAr
              ? React.createElement(
                  P.Text,
                  { style: { direction: 'rtl' } },
                  patientName,
                )
              : patientName,
          ),
          // MRN: numeric → LTR fragment isolation
          React.createElement(
            P.Text,
            { style: styles.patientField },
            'MRN: ',
            ltrNumber('mrn', patientMrn ?? '—'),
          ),
          // DOB: numeric → LTR fragment isolation
          React.createElement(
            P.Text,
            { style: styles.patientField },
            'DOB: ',
            ltrNumber('dob', patientDob),
          ),
          React.createElement(
            P.Text,
            { style: styles.patientField },
            'Gender: ',
            patientGender ?? '—',
          ),
          // Quick task 260812-ns0 — premedication (clinic default) sits
          // in the patient block above findings. Null / empty = the
          // line is omitted entirely (don't render "[Not set]").
          // Free-text only — render as-is; if the clinic types it in
          // Arabic, the parent <View> flips to RTL via the existing
          // isAr branch above.
          premedication !== null && premedication !== ''
            ? React.createElement(
                P.Text,
                {
                  style: styles.patientField,
                  'data-testid': 'report-pdf-premedication',
                },
                isAr ? 'التخدير المبدئي: ' : 'Pre-medication: ',
                premedication,
              )
            : null,
        ),
        // Quick task 260812-ns0 — used devices (1:N with doctor_profile).
        // Rendered as a compact name list with optional notes in the
        // patient block footer (just before the procedure block). Empty
        // array = the entire block is hidden.
        usedDevices.length > 0
          ? React.createElement(
              P.View,
              {
                style: styles.usedDevicesBlock,
                'data-testid': 'report-pdf-used-devices',
              },
              React.createElement(
                P.Text,
                { style: styles.usedDevicesLabel },
                isAr ? 'الأجهزة المستخدمة' : 'Used devices',
              ),
              ...usedDevices.map((d) =>
                React.createElement(
                  P.Text,
                  { key: d.id, style: styles.usedDevicesRow },
                  d.name,
                  d.notes !== null && d.notes !== ''
                    ? React.createElement(
                        P.Text,
                        { style: styles.usedDevicesNotes },
                        ` — ${d.notes}`,
                      )
                    : null,
                ),
              ),
            )
          : null,
      ),

      // Procedure block — duration is HH:MM:SS numeric; isolate it.
      React.createElement(
        P.View,
        { style: styles.section },
        isAr
          ? React.createElement(
              P.Text,
              { style: { ...styles.sectionTitle, direction: 'rtl' } },
              'Procedure',
            )
          : React.createElement(P.Text, { style: styles.sectionTitle }, 'Procedure'),
        React.createElement(
          P.Text,
          null,
          'Date: ',
          ltrNumber('proc-date', procedureDateLabel),
        ),
        React.createElement(
          P.Text,
          null,
          'Duration: ',
          ltrNumber('proc-duration', procedureDurationLabel),
        ),
        React.createElement(
          P.Text,
          null,
          'Doctor: ',
          isAr
            ? React.createElement(
                P.Text,
                { style: { direction: 'rtl' } },
                doctorName,
              )
            : doctorName,
        ),
      ),

      // Findings / Diagnosis / Recommendations — body sections flow
      // through the bidi wrapper so Arabic text renders RTL while
      // English stays LTR.
      React.createElement(
        P.View,
        { style: styles.section },
        isAr
          ? React.createElement(
              P.Text,
              { style: { ...styles.sectionTitle, direction: 'rtl' } },
              'Findings',
            )
          : React.createElement(P.Text, { style: styles.sectionTitle }, 'Findings'),
        rtlText('findings', findings || '—'),
      ),
      React.createElement(
        P.View,
        { style: styles.section },
        isAr
          ? React.createElement(
              P.Text,
              { style: { ...styles.sectionTitle, direction: 'rtl' } },
              'Diagnosis',
            )
          : React.createElement(P.Text, { style: styles.sectionTitle }, 'Diagnosis'),
        rtlText('diagnosis', diagnosis || '—'),
      ),
      // Recommendations is included for completeness even though the
      // Phase 6 UAT removed it from the editor — historical reports
      // still carry the column value and the PDF must render it.
      recommendations
        ? React.createElement(
            P.View,
            { style: styles.section },
            isAr
              ? React.createElement(
                  P.Text,
                  { style: { ...styles.sectionTitle, direction: 'rtl' } },
                  'Recommendations',
                )
              : React.createElement(P.Text, { style: styles.sectionTitle }, 'Recommendations'),
            rtlText('recommendations', recommendations),
          )
        : null,

      // Phase 6 UAT G-06-4 — attached screenshots render as small
      // INLINE thumbnails in a grid BELOW the body sections (not
      // separate full-page figures). 3 per row, ~120×100px each, with
      // a "Fig. N" caption under each. The grid is positioned on the
      // first page (with the body); if the grid overflows, @react-pdf
      // paginates the rest onto the next page automatically.
      attachedScreenshots.length > 0
        ? React.createElement(
            P.View,
            { style: styles.screenshotsSection, wrap: false },
            React.createElement(P.Text, { style: styles.sectionTitle }, 'Attached screenshots'),
            React.createElement(
              P.View,
              { style: styles.screenshotGrid },
              ...attachedScreenshots.map((s) =>
                React.createElement(
                  P.View,
                  { key: s.screenshotId, style: { marginRight: 8, marginBottom: 8 } },
                  React.createElement(P.Image, {
                    src: s.imageBuffer,
                    style: styles.screenshotThumb,
                  }),
                  React.createElement(
                    P.Text,
                    { style: styles.screenshotCaption },
                    `Fig. ${s.sortOrder + 1}`,
                  ),
                ),
              ),
            ),
          )
        : null,

      // Footer — signature placement flips per D-25 + Pitfall 8:
      // EN = signature bottom-RIGHT (Phase 6 default),
      // AR = signature bottom-LEFT (Pitfall 8 verbatim).
      // The flexDirection row-reverse in footerRtl swaps the two
      // children so the signature group lands on the left.
      React.createElement(
        P.View,
        { style: footerStyle, fixed: true },
        React.createElement(
          P.View,
          { style: { flexDirection: 'row', alignItems: 'center' } },
          signatureBox !== null
            ? React.createElement(P.Image, {
                src: signatureBox.buffer,
                style: styles.footerSignature,
              })
            : null,
          isAr
            ? React.createElement(
                P.Text,
                { style: { direction: 'rtl' } },
                doctorName,
              )
            : React.createElement(P.Text, null, doctorName),
        ),
        React.createElement(
          P.View,
          { style: { flexDirection: 'row', alignItems: 'center' } },
          isAr
            ? React.createElement(
                P.Text,
                { style: { direction: 'rtl' } },
                clinicName,
              )
            : React.createElement(P.Text, null, clinicName),
          React.createElement(
            P.Text,
            {
              style: { marginLeft: 8 },
              render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
                `Page ${pageNumber} of ${totalPages}`,
            },
          ),
        ),
      ),
      // Quick task 260812-ns0 — bottom band: the uploaded footer image
      // (full-width, ~80px tall) renders below the existing fixed
      // footer. Null when the doctor hasn't uploaded one; the band is
      // hidden entirely in that case.
      footerBox !== null
        ? React.createElement(
            P.Image,
            {
              src: footerBox.buffer,
              style: FOOTER_BAND_STYLE,
              'data-testid': 'report-pdf-footer-image',
            },
          )
        : null,
    ),
  );
}

// ponytail: Font import removed — Phase 7 i18n re-imports directly
// from @react-pdf/renderer when needed. Re-exporting Font here
// triggers a module-init edge case in @react-pdf/renderer 4.5.1
// when combined with vitest's module isolation, which silently
// breaks subsequent `pdf().toBuffer()` calls.
