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

import React from 'react';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { Document, renderToFile } from '@react-pdf/renderer';
import { app } from 'electron';

import { reportsRepo } from '../db/reports-repo';
import { doctorProfileRepo } from '../db/doctor-profile-repo';
import { userRepo } from '../db/users';
import { audit } from '../db/audit';
import { session } from '../auth/session';
import { patientRepo } from '../db/patients';
import { reportPdfPath, reportsDir } from '../paths';

import { ReportPdf, type ReportPdfInput } from './report';

export async function renderReportPdf(
  reportId: string,
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

  const input: ReportPdfInput = {
    reportId,
    patientName: patient.fullName,
    doctorName: doctor.full_name,
    clinicName: profile?.clinicNameEn ?? 'Clinic',
    procedureDateLabel: new Date(procedure.startedAt).toISOString().slice(0, 10),
    findings: report.findings,
    diagnosis: report.diagnosis,
    recommendations: report.recommendations,
  };

  const pdfPath = reportPdfPath(reportId);

  // Render via @react-pdf/renderer's Node entry. The renderToFile API
  // expects a <Document> element. ReportPdf already returns one; we wrap
  // it in a fresh Document to keep the explicit top-level DocumentProps
  // pattern (matches the canonical @react-pdf docs).
  await renderToFile(
    // ponytail: Document wrapping preserves the future option to set
    // Document-level props (title, author, subject) without touching
    // ReportPdf's return type.
    React.createElement(
      Document,
      null,
      React.createElement(ReportPdf, { input }),
    ),
    pdfPath,
  );

  // Store userData-relative path on the reports row (Anti-Pattern 2).
  const userData = app.getPath('userData');
  const relPdfPath = path.relative(userData, pdfPath).split(path.sep).join('/');
  reportsRepo.setPdfPath(reportId, relPdfPath);

  audit({
    action: 'report.pdf_generated',
    entityType: 'report',
    entityId: reportId,
    userId: session.currentUserId,
    metadata: { pdfPath: relPdfPath },
  });

  return { pdfPath };
}
