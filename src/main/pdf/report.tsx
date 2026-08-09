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

import React from 'react';
import {
  LOGO_BOX,
  SIGNATURE_BOX,
  type ImageBox,
} from './embed-image';

export type AttachedScreenshot = {
  screenshotId: number;
  filePath: string;
  sortOrder: number;
  // ponytail: pre-loaded Buffer because @react-pdf/renderer scales per
  // its <Image style.width='100%'> prop and ignores intrinsic dims.
  imageBuffer: Buffer;
};

export type ReportPdfInput = {
  // Header inputs (logo top-left, signature top-right).
  logoBox: ImageBox | null;
  signatureBox: ImageBox | null;
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
 */
export function createReportPdfElement(
  P: PdfPrimitives,
  input: ReportPdfInput,
): React.JSX.Element {
  const styles = getStyles(P);
  const {
    logoBox,
    signatureBox,
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
  } = input;

  return React.createElement(
    P.Document,
    null,
    React.createElement(
      P.Page,
      { size: 'LETTER', style: styles.page },
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
          React.createElement(P.Text, { style: { fontSize: 14, fontWeight: 'bold' } }, clinicName),
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
          React.createElement(P.Text, null, doctorName),
          React.createElement(P.Text, null, procedureDateLabel),
        ),
      ),

      // Patient block
      React.createElement(
        P.View,
        { style: styles.section },
        React.createElement(P.Text, { style: styles.sectionTitle }, 'Patient'),
        React.createElement(
          P.View,
          { style: styles.patientBlock },
          React.createElement(P.Text, { style: styles.patientField }, `Name: ${patientName}`),
          React.createElement(P.Text, { style: styles.patientField }, `MRN: ${patientMrn ?? '—'}`),
          React.createElement(P.Text, { style: styles.patientField }, `DOB: ${patientDob}`),
          React.createElement(P.Text, { style: styles.patientField }, `Gender: ${patientGender ?? '—'}`),
        ),
      ),

      // Procedure block
      React.createElement(
        P.View,
        { style: styles.section },
        React.createElement(P.Text, { style: styles.sectionTitle }, 'Procedure'),
        React.createElement(P.Text, null, `Date: ${procedureDateLabel}`),
        React.createElement(P.Text, null, `Duration: ${procedureDurationLabel}`),
        React.createElement(P.Text, null, `Doctor: ${doctorName}`),
      ),

      // Findings / Diagnosis / Recommendations
      React.createElement(
        P.View,
        { style: styles.section },
        React.createElement(P.Text, { style: styles.sectionTitle }, 'Findings'),
        React.createElement(P.Text, { style: styles.body }, findings || '—'),
      ),
      React.createElement(
        P.View,
        { style: styles.section },
        React.createElement(P.Text, { style: styles.sectionTitle }, 'Diagnosis'),
        React.createElement(P.Text, { style: styles.body }, diagnosis || '—'),
      ),
      React.createElement(
        P.View,
        { style: styles.section },
        React.createElement(P.Text, { style: styles.sectionTitle }, 'Recommendations'),
        React.createElement(P.Text, { style: styles.body }, recommendations || '—'),
      ),

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

      // Footer with page numbers — now includes the doctor's
      // signature image (per G-06-4 user request). Layout: signature
      // image (left) + doctor name (next to sig) + spacer + clinic
      // name + page number (right).
      React.createElement(
        P.View,
        { style: styles.footer, fixed: true },
        React.createElement(
          P.View,
          { style: { flexDirection: 'row', alignItems: 'center' } },
          signatureBox !== null
            ? React.createElement(P.Image, {
                src: signatureBox.buffer,
                style: styles.footerSignature,
              })
            : null,
          React.createElement(P.Text, null, doctorName),
        ),
        React.createElement(
          P.View,
          { style: { flexDirection: 'row', alignItems: 'center' } },
          React.createElement(P.Text, null, clinicName),
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
    ),
  );
}

// ponytail: Font import removed — Phase 7 i18n re-imports directly
// from @react-pdf/renderer when needed. Re-exporting Font here
// triggers a module-init edge case in @react-pdf/renderer 4.5.1
// when combined with vitest's module isolation, which silently
// breaks subsequent `pdf().toBuffer()` calls.