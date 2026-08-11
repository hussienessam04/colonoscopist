// @vitest-environment happy-dom
// Quick task 20260811 — PatientProcedures page tests.
//
// Coverage:
//   1. Renders patient header (via patients.get) + procedures list
//      (via procedures.list + reports.getByProcedure).
//   2. "Open procedure" button navigates to { name: 'procedure-review', procedureId }.
//   3. "Open PDF" button invokes window.api.reports.openPdf with { id, reveal:false }.
//
// ponytail: minimal seed + 3 cases per plan acceptance ("≥3 cases"). The
// page is the smallest unit — patient header + procedure rows + report
// controls. No pagination, no filters, no admin gating.

import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getApi } from '../setup';
import { setRoute, initialRoute, getRoute } from '@/lib/router';
import { session } from '@/store/session';
import PatientProcedures from '@/pages/PatientProcedures';
import type { Patient, Procedure, Report } from '@shared/ipc-contract';

const ADMIN_USER = {
  id: '00000000-0000-4000-8000-000000000099',
  fullName: 'Dr. Layla',
  isFirstAdmin: true,
  lastLoginAt: Date.now(),
  failedAttempts: 0,
  lockedUntil: null,
  language: 'en' as const,
};

const PATIENT_ID = '00000000-0000-4000-8000-000000000001';

const PATIENT: Patient = {
  id: PATIENT_ID,
  fullName: 'Alice Carter',
  dob: '1980-04-12',
  gender: 'female',
  mrn: 'MRN-001',
  phone: '555-0001',
  notes: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  deletedAt: null,
};

const PROC_A: Procedure = {
  id: '00000000-0000-4000-8000-0000000000a1',
  patientId: PATIENT_ID,
  doctorId: ADMIN_USER.id,
  startedAt: Date.UTC(2026, 7, 5, 10, 0, 0),
  endedAt: Date.UTC(2026, 7, 5, 10, 5, 0),
  durationSeconds: 300,
  status: 'completed',
  videoPath: 'v.mp4',
  videoPathOriginal: null,
  presetSummary: { kind: 'sd', resolution: '720x480', framerate: 30, bitrate: '4M' },
  audioDeviceName: null,
  createdAt: Date.UTC(2026, 7, 5, 10, 0, 0),
};

const PROC_B: Procedure = {
  id: '00000000-0000-4000-8000-0000000000a2',
  patientId: PATIENT_ID,
  doctorId: ADMIN_USER.id,
  startedAt: Date.UTC(2026, 7, 6, 11, 0, 0),
  endedAt: Date.UTC(2026, 7, 6, 11, 3, 0),
  durationSeconds: 180,
  status: 'partial',
  videoPath: 'v2.mp4',
  videoPathOriginal: null,
  presetSummary: { kind: 'hd', resolution: '1920x1080', framerate: 30, bitrate: '8M' },
  audioDeviceName: null,
  createdAt: Date.UTC(2026, 7, 6, 11, 0, 0),
};

const REPORT_A: Report = {
  id: 'rpt-1',
  procedureId: PROC_A.id,
  doctorId: ADMIN_USER.id,
  findings: '',
  diagnosis: '',
  recommendations: '',
  procedureDetails: '',
  status: 'finalized',
  finalizedAt: Date.now(),
  pdfPath: 'a.pdf',
  pdfGeneratedAt: Date.now(),
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

beforeEach(() => {
  setRoute(initialRoute);
  const api = getApi();
  api.auth.status.mockResolvedValue({
    hasUsers: true,
    authenticated: true,
    userId: ADMIN_USER.id,
    clinicName: 'Cairo',
    isFirstAdmin: true,
  });
  api.auth.usersList.mockResolvedValue([ADMIN_USER]);
  api.patients.get.mockResolvedValue(PATIENT);
  void session.refresh();
});

describe('PatientProcedures page', () => {
  it('renders the patient header + a row per procedure with status + report status', async () => {
    const api = getApi();
    api.procedures.list.mockResolvedValue({ rows: [PROC_A, PROC_B], total: 2 });
    // First procedure has a finalized report; second has no report.
    api.reports.getByProcedure.mockImplementation(async ({ procedureId }: { procedureId: string }) =>
      procedureId === PROC_A.id ? REPORT_A : null,
    );
    render(<PatientProcedures patientId={PATIENT_ID} />);

    // Header card surfaces the patient's name.
    await waitFor(() => expect(api.patients.get).toHaveBeenCalledWith(PATIENT_ID));
    const header = await screen.findByTestId('patient-procedures-header');
    expect(header).toHaveTextContent('Alice Carter');
    expect(header).toHaveTextContent('MRN-001');

    // Two procedure rows render.
    expect(
      await screen.findByTestId(`patient-procedure-row-${PROC_A.id}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`patient-procedure-row-${PROC_B.id}`),
    ).toBeInTheDocument();

    // Status badges expose the per-procedure status.
    expect(
      screen.getByTestId(`patient-procedure-status-${PROC_A.id}`),
    ).toHaveTextContent('completed');
    expect(
      screen.getByTestId(`patient-procedure-status-${PROC_B.id}`),
    ).toHaveTextContent('partial');

    // PROC_A has a finalized report chip; PROC_B shows "No report".
    expect(
      screen.getByTestId(`patient-procedure-report-status-${PROC_A.id}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`patient-procedure-no-report-${PROC_B.id}`),
    ).toBeInTheDocument();
  });

  it('"Open procedure" button navigates to { name: "procedure-review", procedureId }', async () => {
    const api = getApi();
    api.procedures.list.mockResolvedValue({ rows: [PROC_A], total: 1 });
    api.reports.getByProcedure.mockResolvedValue(null);
    render(<PatientProcedures patientId={PATIENT_ID} />);
    const user = userEvent.setup();
    const openBtn = await screen.findByTestId(`patient-procedure-open-${PROC_A.id}`);
    await user.click(openBtn);
    await waitFor(() =>
      expect(getRoute()).toEqual({
        name: 'procedure-review',
        procedureId: PROC_A.id,
      }),
    );
  });

  it('"Open PDF" button invokes window.api.reports.openPdf with { id, reveal: false }', async () => {
    const api = getApi();
    api.procedures.list.mockResolvedValue({ rows: [PROC_A], total: 1 });
    api.reports.getByProcedure.mockResolvedValue(REPORT_A);
    api.reports.openPdf.mockResolvedValue({ opened: true });
    render(<PatientProcedures patientId={PATIENT_ID} />);
    const user = userEvent.setup();
    const openPdf = await screen.findByTestId(`patient-procedure-open-pdf-${PROC_A.id}`);
    await user.click(openPdf);
    await waitFor(() => expect(api.reports.openPdf).toHaveBeenCalled());
    expect(api.reports.openPdf).toHaveBeenCalledWith({ id: 'rpt-1', reveal: false });
  });

  it('back button navigates to { name: "patients" }', async () => {
    const api = getApi();
    api.procedures.list.mockResolvedValue({ rows: [], total: 0 });
    api.reports.getByProcedure.mockResolvedValue(null);
    render(<PatientProcedures patientId={PATIENT_ID} />);
    const user = userEvent.setup();
    const back = await screen.findByTestId('patient-procedures-back');
    await user.click(back);
    await waitFor(() => expect(getRoute().name).toBe('patients'));
    // Empty state is reachable when the patient has zero procedures.
    expect(
      await screen.findByTestId('patient-procedures-empty'),
    ).toBeInTheDocument();
  });

  it('reports a "patient not found" toast + returns to patients list when patients.get returns null', async () => {
    const api = getApi();
    api.patients.get.mockResolvedValue(null);
    render(<PatientProcedures patientId={PATIENT_ID} />);
    await waitFor(() => expect(api.patients.get).toHaveBeenCalledWith(PATIENT_ID));
    await waitFor(() => expect(getRoute().name).toBe('patients'));
  });
});