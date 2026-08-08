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

import React from 'react';
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
} from '@react-pdf/renderer';

import {
  LOGO_BOX,
  SIGNATURE_BOX,
  type ImageBox,
} from './embed-image';

const styles = StyleSheet.create({
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
    paddingBottom: 12,
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
  screenshotPage: {
    padding: 36,
    fontSize: 11,
  },
  screenshotCaption: {
    fontSize: 10,
    color: '#475569',
    marginTop: 8,
  },
  footer: {
    position: 'absolute',
    bottom: 18,
    left: 36,
    right: 36,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 9,
    color: '#64748b',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 6,
  },
});

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

function placeholderText(missing: 'logo' | 'signature'): string {
  return missing === 'logo' ? '[No logo uploaded]' : '[No signature on file]';
}

export function ReportPdf({ input }: { input: ReportPdfInput }): React.JSX.Element {
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

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header} fixed>
          <View style={styles.headerLeft}>
            {logoBox ? (
              <Image
                src={logoBox.buffer}
                style={{ width: LOGO_BOX.widthPx, height: LOGO_BOX.heightPx }}
              />
            ) : (
              <Text style={styles.logoOrPlaceholder}>{placeholderText('logo')}</Text>
            )}
            <Text style={{ fontSize: 14, fontWeight: 'bold' }}>{clinicName}</Text>
          </View>
          <View style={styles.headerRight}>
            {signatureBox ? (
              <Image
                src={signatureBox.buffer}
                style={{ width: SIGNATURE_BOX.widthPx, height: SIGNATURE_BOX.heightPx }}
              />
            ) : (
              <Text style={styles.logoOrPlaceholder}>{placeholderText('signature')}</Text>
            )}
            <Text>{doctorName}</Text>
            <Text>{procedureDateLabel}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Patient</Text>
          <View style={styles.patientBlock}>
            <Text style={styles.patientField}>Name: {patientName}</Text>
            <Text style={styles.patientField}>MRN: {patientMrn ?? '—'}</Text>
            <Text style={styles.patientField}>DOB: {patientDob}</Text>
            <Text style={styles.patientField}>Gender: {patientGender ?? '—'}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Procedure</Text>
          <Text>Date: {procedureDateLabel}</Text>
          <Text>Duration: {procedureDurationLabel}</Text>
          <Text>Doctor: {doctorName}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Findings</Text>
          <Text style={styles.body}>{findings || '—'}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Diagnosis</Text>
          <Text style={styles.body}>{diagnosis || '—'}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recommendations</Text>
          <Text style={styles.body}>{recommendations || '—'}</Text>
        </View>

        <View style={styles.footer} fixed>
          <Text>{clinicName}</Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `Page ${pageNumber} of ${totalPages}`
            }
          />
        </View>
      </Page>

      {attachedScreenshots.map((s) => (
        <Page key={s.screenshotId} size="LETTER" style={styles.screenshotPage}>
          <Image src={s.imageBuffer} style={{ width: '100%', objectFit: 'contain' }} />
          <Text style={styles.screenshotCaption}>Fig. {s.sortOrder + 1}</Text>
          <View style={styles.footer} fixed>
            <Text>{clinicName}</Text>
            <Text
              render={({ pageNumber, totalPages }) =>
                `Page ${pageNumber} of ${totalPages}`
              }
            />
          </View>
        </Page>
      ))}
    </Document>
  );
}

// ponytail: Font import removed — Phase 7 i18n re-imports directly
// from @react-pdf/renderer when needed. Re-exporting Font here
// triggers a module-init edge case in @react-pdf/renderer 4.5.1
// when combined with vitest's module isolation, which silently
// breaks subsequent `pdf().toBuffer()` calls.
