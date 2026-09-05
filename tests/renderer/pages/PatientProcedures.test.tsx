// @vitest-environment happy-dom
// Quick task 20260811 — PatientProcedures page tests.
//
// Coverage (3 original + 6 filter/new-procedure cases):
//   1. Renders patient header (via patients.get) + procedures list
//      (via procedures.list + reports.getByProcedure).
//   2. "Open procedure" button navigates to { name: 'procedure-review', procedureId }.
//   3. "Open PDF" button invokes window.api.reports.openPdf with { id, reveal:false }.
//   4. Back button navigates to { name: 'patients' }; empty state is reachable.
//   5. Reports a "patient not found" toast + returns to patients list when patients.get returns null.
//   6. Filter: text search — type in search box + Apply -> only matching rows shown.
//   7. Filter: status multi-select — pick a status + Apply -> only matching rows shown.
//   8. Filter: Apply commits + Clear resets.
//   9. New Procedure button navigates to { name: 'procedure-preview', patientId }.
//  10. Empty state for filtered-out shows the noMatchFilters variant.
//  11. Date range filter — From/To + Apply -> only rows in range shown.
//
// ponytail: minimal seed + per-test mock overrides. The page is the
// smallest unit — patient header + filter row + procedure rows. No
// pagination, no SWR hook.

import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getApi } from '../setup';
import { setRoute, initialRoute, getRoute } from '@/lib/router';
import { session } from '@/store/session';
import PatientProcedures from '@/pages/PatientProcedures';
import type { Patient, Procedure, ProcedureStatus, Report } from '@shared/ipc-contract';

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

// Three procedures with distinct dates + statuses so the filter tests
// can exercise combinations without depending on a clock.
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

const PROC_C: Procedure = {
  id: '00000000-0000-4000-8000-0000000000a3',
  patientId: PATIENT_ID,
  doctorId: ADMIN_USER.id,
  startedAt: Date.UTC(2026, 7, 7, 12, 0, 0),
  endedAt: Date.UTC(2026, 7, 7, 12, 7, 0),
  durationSeconds: 420,
  status: 'recording',
  videoPath: 'v3.mp4',
  videoPathOriginal: null,
  presetSummary: { kind: 'hd', resolution: '1920x1080', framerate: 30, bitrate: '8M' },
  audioDeviceName: null,
  createdAt: Date.UTC(2026, 7, 7, 12, 0, 0),
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

// Setup shared across every test — matches the previous block, kept
// in beforeEach so per-test mock overrides still apply.
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
    api.reports.getByProcedure.mockImplementation(async ({ procedureId }: { procedureId: string }) =>
      procedureId === PROC_A.id ? REPORT_A : null,
    );
    render(<PatientProcedures patientId={PATIENT_ID} />);

    // Header card surfaces the patient's name.
    await waitFor(() => expect(api.patients.get).toHaveBeenCalledWith(PATIENT_ID));
    const header = await screen.findByTestId('patient-procedures-header');
    expect(header).toHaveTextContent('Alice Carter');
    expect(header).toHaveTextContent('MRN-001');

    // Avatar initials derived from fullName (first + last = AC).
    expect(within(header).getByTestId('patient-procedures-avatar')).toHaveTextContent('AC');

    // Two procedure rows render.
    expect(
      await screen.findByTestId(`patient-procedure-row-${PROC_A.id}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`patient-procedure-row-${PROC_B.id}`),
    ).toBeInTheDocument();

    // Status badges expose the translated per-procedure status label.
    expect(
      screen.getByTestId(`patient-procedure-status-${PROC_A.id}`),
    ).toHaveTextContent('Completed');
    expect(
      screen.getByTestId(`patient-procedure-status-${PROC_B.id}`),
    ).toHaveTextContent('Partial');

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

  it('renders <EmptyStateCard> (no navigation away) when patients.get returns null — Plan 08-10 G-08-4 graceful degrade', async () => {
    const api = getApi();
    api.patients.get.mockResolvedValue(null);
    render(<PatientProcedures patientId={PATIENT_ID} />);
    await waitFor(() => expect(api.patients.get).toHaveBeenCalledWith(PATIENT_ID));
    // Plan 08-10 / G-08-4 — renderer no longer navigates away on null.
    // The EmptyStateCard stays visible so the LicenseGate modal can
    // remain interactable on top. Route stays at the initial value
    // (the page never called navigate()).
    expect(await screen.findByTestId('gated-empty-state')).toBeInTheDocument();
    expect(getRoute().name).not.toBe('patients');
  });

  it('text search filter: typing + Apply narrows the table to matching procedures', async () => {
    const api = getApi();
    api.procedures.list.mockResolvedValue({ rows: [PROC_A, PROC_B, PROC_C], total: 3 });
    api.reports.getByProcedure.mockResolvedValue(null);
    render(<PatientProcedures patientId={PATIENT_ID} />);
    const user = userEvent.setup();

    // All three rows render before any filter is applied.
    await screen.findByTestId(`patient-procedure-row-${PROC_A.id}`);
    expect(screen.getByTestId(`patient-procedure-row-${PROC_B.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`patient-procedure-row-${PROC_C.id}`)).toBeInTheDocument();

    const search = await screen.findByTestId('patient-procedures-search');
    await user.type(search, PROC_A.id);

    // Typing alone does NOT filter — Apply is the commit gate.
    expect(
      screen.getByTestId(`patient-procedure-row-${PROC_B.id}`),
    ).toBeInTheDocument();

    await user.click(screen.getByTestId('patient-procedures-apply'));

    // Only PROC_A remains after applying the id-substring search.
    await waitFor(() =>
      expect(
        screen.getByTestId(`patient-procedure-row-${PROC_A.id}`),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByTestId(`patient-procedure-row-${PROC_B.id}`),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(`patient-procedure-row-${PROC_C.id}`),
    ).not.toBeInTheDocument();
  });

  it('status multi-select filter: pick "Completed" + Apply narrows the table to completed procedures', async () => {
    const api = getApi();
    api.procedures.list.mockResolvedValue({ rows: [PROC_A, PROC_B, PROC_C], total: 3 });
    api.reports.getByProcedure.mockResolvedValue(null);
    render(<PatientProcedures patientId={PATIENT_ID} />);
    const user = userEvent.setup();

    await screen.findByTestId(`patient-procedure-row-${PROC_A.id}`);

    // Open the status popover, check Completed.
    await user.click(screen.getByTestId('patient-procedures-status'));
    const completedOption = await screen.findByTestId(
      'patient-procedures-status-completed',
    );
    await user.click(completedOption);
    // Popover stays open; clicking outside (in jsdom clicking outside the
    // popover portal is implicit when we click the Apply button).

    await user.click(screen.getByTestId('patient-procedures-apply'));

    // Only the completed row (PROC_A) survives the filter.
    await waitFor(() =>
      expect(
        screen.getByTestId(`patient-procedure-row-${PROC_A.id}`),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByTestId(`patient-procedure-row-${PROC_B.id}`),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(`patient-procedure-row-${PROC_C.id}`),
    ).not.toBeInTheDocument();
  });

  it('Clear button resets pending + applied filters and restores all rows', async () => {
    const api = getApi();
    api.procedures.list.mockResolvedValue({ rows: [PROC_A, PROC_B, PROC_C], total: 3 });
    api.reports.getByProcedure.mockResolvedValue(null);
    render(<PatientProcedures patientId={PATIENT_ID} />);
    const user = userEvent.setup();

    await screen.findByTestId(`patient-procedure-row-${PROC_A.id}`);

    // Apply a narrowing filter first.
    const search = screen.getByTestId('patient-procedures-search');
    await user.type(search, PROC_A.id);
    await user.click(screen.getByTestId('patient-procedures-apply'));
    await waitFor(() =>
      expect(
        screen.queryByTestId(`patient-procedure-row-${PROC_B.id}`),
      ).not.toBeInTheDocument(),
    );

    // Clear resets everything.
    await user.click(screen.getByTestId('patient-procedures-clear'));
    await waitFor(() =>
      expect(
        screen.getByTestId(`patient-procedure-row-${PROC_B.id}`),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId(`patient-procedure-row-${PROC_A.id}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`patient-procedure-row-${PROC_C.id}`),
    ).toBeInTheDocument();

    // Search input cleared too.
    expect(screen.getByTestId('patient-procedures-search')).toHaveValue('');
  });

  it('"+ New Procedure" button navigates to { name: "procedure-preview", patientId }', async () => {
    const api = getApi();
    api.procedures.list.mockResolvedValue({ rows: [], total: 0 });
    api.reports.getByProcedure.mockResolvedValue(null);
    render(<PatientProcedures patientId={PATIENT_ID} />);
    const user = userEvent.setup();
    const newBtn = await screen.findByTestId('patient-procedures-new');
    await user.click(newBtn);
    await waitFor(() =>
      expect(getRoute()).toEqual({
        name: 'procedure-preview',
        patientId: PATIENT_ID,
      }),
    );
  });

  it('shows "no procedures match these filters" empty state when an active filter matches nothing', async () => {
    const api = getApi();
    api.procedures.list.mockResolvedValue({ rows: [PROC_A, PROC_B, PROC_C], total: 3 });
    api.reports.getByProcedure.mockResolvedValue(null);
    render(<PatientProcedures patientId={PATIENT_ID} />);
    const user = userEvent.setup();

    await screen.findByTestId(`patient-procedure-row-${PROC_A.id}`);

    // Apply a search term that matches no procedure id (every id starts with
    // 00000000-0000-4000-8000-0000000000aX).
    const search = screen.getByTestId('patient-procedures-search');
    await user.type(search, 'no-such-thing');
    await user.click(screen.getByTestId('patient-procedures-apply'));

    const empty = await screen.findByTestId('patient-procedures-empty-filtered');
    expect(empty).toHaveTextContent('No procedures match these filters.');
    expect(empty).toHaveTextContent('Try clearing filters');
    // None of the rows should be present anymore.
    expect(
      screen.queryByTestId(`patient-procedure-row-${PROC_A.id}`),
    ).not.toBeInTheDocument();
  });

  it('date range filter: From/To + Apply narrows the table to procedures in range', async () => {
    const api = getApi();
    api.procedures.list.mockResolvedValue({ rows: [PROC_A, PROC_B, PROC_C], total: 3 });
    api.reports.getByProcedure.mockResolvedValue(null);
    render(<PatientProcedures patientId={PATIENT_ID} />);
    const user = userEvent.setup();

    await screen.findByTestId(`patient-procedure-row-${PROC_A.id}`);

    // PROC_A is 2026-08-05 UTC, PROC_B is 2026-08-06 UTC, PROC_C is 2026-08-07 UTC.
    // Restrict the range to 2026-08-06 .. 2026-08-06 (inclusive toMs).
    const from = screen.getByTestId('patient-procedures-date-from') as HTMLInputElement;
    const to = screen.getByTestId('patient-procedures-date-to') as HTMLInputElement;
    fireChange(from, '2026-08-06');
    fireChange(to, '2026-08-06');

    await user.click(screen.getByTestId('patient-procedures-apply'));

    // Only PROC_B survives (PROC_A is before, PROC_C is after).
    await waitFor(() =>
      expect(
        screen.getByTestId(`patient-procedure-row-${PROC_B.id}`),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByTestId(`patient-procedure-row-${PROC_A.id}`),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(`patient-procedure-row-${PROC_C.id}`),
    ).not.toBeInTheDocument();
  });
});

// ponytail: native <input type="date"> + RTL fireEvent on the value setter
// avoids the JS DOM-implementation gap where happy-dom ignores `value` set
// via the React onChange path for date inputs. Production wires the same
// onChange; only the test shortcut differs.
import { fireEvent } from '@testing-library/react';
function fireChange(el: HTMLInputElement, value: string): void {
  fireEvent.change(el, { target: { value } });
}
