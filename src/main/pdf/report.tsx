// @react-pdf/renderer ReportPdf component — tracer stub.
// Per CONTEXT.md D-12 (main-side thin Node bridge; renderer is sandboxed
// and never imports @react-pdf/renderer directly). Plan 06-03 will
// replace this hello-world layout with the full clinical-report layout
// (D-11: header with logo + signature, patient block, procedure block,
// three labeled body sections, attached-screenshot pages, footer with
// page numbers).
//
// This stub MUST be valid + renderable on its own — the tracer's end-to-end
// verify (npm run test:unit on tests/main/pdf/render-report-pdf.test.ts)
// reads a PDF file off disk and asserts the %PDF- magic bytes.

import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontSize: 11,
    fontFamily: 'Helvetica',
  },
  title: {
    fontSize: 18,
    marginBottom: 12,
  },
  section: {
    marginTop: 12,
  },
  sectionLabel: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
    marginBottom: 4,
  },
  body: {
    fontSize: 11,
    lineHeight: 1.4,
  },
});

export type ReportPdfInput = {
  reportId: string;
  patientName: string;
  doctorName: string;
  clinicName: string;
  procedureDateLabel: string;
  findings: string;
  diagnosis: string;
  recommendations: string;
};

export function ReportPdf({ input }: { input: ReportPdfInput }): React.JSX.Element {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.title}>Colonoscopy Report</Text>
        <Text>Patient: {input.patientName}</Text>
        <Text>Doctor: {input.doctorName}</Text>
        <Text>Clinic: {input.clinicName}</Text>
        <Text>Date: {input.procedureDateLabel}</Text>
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Findings</Text>
          <Text style={styles.body}>{input.findings}</Text>
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Diagnosis</Text>
          <Text style={styles.body}>{input.diagnosis}</Text>
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Recommendations</Text>
          <Text style={styles.body}>{input.recommendations}</Text>
        </View>
      </Page>
    </Document>
  );
}
