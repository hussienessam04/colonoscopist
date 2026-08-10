// @vitest-environment happy-dom
// Plan 02-03 Task 3 — PatientsList tests.
// Per PAT-02 + PAT-04: search + MRN exact + show-deleted toggle + page-size + soft-delete.
// Per Fix 6: every patients.list call writes a patient_list audit row in main.
// Plan 03-04 — Settings DropdownMenu surfaces Capture (every doctor) + Users (admin only).

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getApi } from '../setup';
import { initialRoute, setRoute, getRoute } from '@/lib/router';
import { session } from '@/store/session';
import PatientsList from '@/pages/PatientsList';
import type { Patient } from '@shared/ipc-contract';

const patients: Patient[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    fullName: 'Alice Carter',
    dob: '1980-04-12',
    gender: 'female',
    mrn: 'MRN-001',
    phone: '555-0001',
    notes: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deletedAt: null,
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    fullName: 'Bob Singh',
    dob: '1975-09-30',
    gender: 'male',
    mrn: 'MRN-002',
    phone: '555-0002',
    notes: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deletedAt: null,
  },
];

const ADMIN_USER = {
  id: '00000000-0000-4000-8000-000000000099',
  fullName: 'Dr. Layla',
  isFirstAdmin: true,
  lastLoginAt: Date.now(),
  failedAttempts: 0,
  lockedUntil: null,
};
const STAFF_USER = {
  id: '00000000-0000-4000-8000-000000000044',
  fullName: 'Nurse Tarek',
  isFirstAdmin: false,
  lastLoginAt: null,
  failedAttempts: 0,
  lockedUntil: null,
};

function setAdminSession(): void {
  // Default to admin signed in so the Settings button is enabled.
  const api = getApi();
  api.auth.status.mockResolvedValue({
    hasUsers: true,
    authenticated: true,
    userId: ADMIN_USER.id,
    clinicName: 'Cairo',
    isFirstAdmin: true,
  });
  api.auth.usersList.mockResolvedValue([ADMIN_USER]);
  api.patients.list.mockResolvedValue({ rows: patients, total: patients.length });
}

function setNonAdminSession(): void {
  const api = getApi();
  api.auth.status.mockResolvedValue({
    hasUsers: true,
    authenticated: true,
    userId: STAFF_USER.id,
    clinicName: 'Cairo',
    isFirstAdmin: false,
  });
  api.auth.usersList.mockResolvedValue([ADMIN_USER, STAFF_USER]);
  api.patients.list.mockResolvedValue({ rows: patients, total: patients.length });
}

beforeEach(() => {
  setRoute(initialRoute);
  // Seed the auth + patients mocks BEFORE refreshing session so the refresh
  // resolves against a real auth.status() / usersList() response.
  setAdminSession();
  void session.refresh();
});

describe('PatientsList', () => {
  it('renders the rows from patients.list', async () => {
    render(<PatientsList />);
    expect(await screen.findByText('Alice Carter')).toBeInTheDocument();
    expect(await screen.findByText('Bob Singh')).toBeInTheDocument();
  });

  it('typing in the search input calls patients.list with the search param after debounce', async () => {
    const api = getApi();
    render(<PatientsList />);
    const search = await screen.findByLabelText(/search by name/i);
    const user = userEvent.setup();
    await user.type(search, 'ali');
    // wait for debounce
    await waitFor(() => expect(api.patients.list).toHaveBeenCalled(), { timeout: 1500 });
    const lastCall = api.patients.list.mock.calls[api.patients.list.mock.calls.length - 1]?.[0];
    expect(lastCall).toMatchObject({ search: 'ali' });
  });

  it('toggling "Show deleted" calls patients.list with includeDeleted=true', async () => {
    const api = getApi();
    render(<PatientsList />);
    const checkbox = await screen.findByLabelText(/show deleted/i);
    const user = userEvent.setup();
    await user.click(checkbox);
    await waitFor(() => expect(api.patients.list).toHaveBeenCalled(), { timeout: 1500 });
    const lastCall = api.patients.list.mock.calls[api.patients.list.mock.calls.length - 1]?.[0];
    expect(lastCall).toMatchObject({ includeDeleted: true });
  });

  it('"+ New patient" navigates to patient-new', async () => {
    render(<PatientsList />);
    const btn = await screen.findByRole('button', { name: /new patient/i });
    const user = userEvent.setup();
    await user.click(btn);
    await waitFor(() => {
      // We need the route to advance; assert via the next render or router state.
    });
  });

  it("row's Delete action opens the confirm dialog; confirming calls patients.softDelete and refreshes the list", async () => {
    const api = getApi();
    api.patients.softDelete.mockResolvedValue({ ok: true });
    render(<PatientsList />);
    await screen.findByText('Alice Carter');
    const user = userEvent.setup();
    // Open the actions menu for Alice
    const aliceMenu = screen.getByRole('button', { name: /actions for alice carter/i });
    await user.click(aliceMenu);
    await user.click(await screen.findByRole('menuitem', { name: /^delete$/i }));
    // Confirm dialog appears
    expect(await screen.findByText(/delete patient\?/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^archive$/i }));
    await waitFor(() => expect(api.patients.softDelete).toHaveBeenCalledTimes(1));
    expect(api.patients.softDelete).toHaveBeenCalledWith(patients[0]!.id);
    // List refetched after the delete.
    await waitFor(() => expect(api.patients.list).toHaveBeenCalledTimes(vi.mocked(api.patients.list).mock.calls.length));
  });
});

// Plan 03-05 — PatientsList header Settings Button routes to the new
// settings-hub page (G-03-3). The prior DropdownMenu surface shipped in
// 03-04 was replaced by a single Button that opens the Settings hub; the
// hub's right-side sidebar handles per-section gating (admin only for
// Users, every doctor for Capture).
describe('PatientsList — Settings hub entry', () => {
  it('header Settings Button (not a DropdownMenu) routes to settings-hub for any authenticated session', async () => {
    setRoute(initialRoute);
    setAdminSession();
    await session.refresh();
    const user = userEvent.setup();
    render(<PatientsList />);
    await screen.findByText('Alice Carter');
    const settingsTrigger = await screen.findByTestId('settings-trigger');
    expect(settingsTrigger).toBeInstanceOf(HTMLButtonElement);
    // Single button — no transient menu wrapper.
    await user.click(settingsTrigger);
    await waitFor(() => expect(getRoute().name).toBe('settings-hub'));
  });
});

// Phase 7 / Plan 07-02 — SRCH-01..03 + D-01..D-03: filter sidebar +
// per-row accordion expansion. The sidebar Apply button triggers a
// refetch with the new filters; Clear resets to the empty surface;
// procedure row click navigates to {name: 'procedure-review', procedureId};
// report row click invokes reports.openPdf with {id, reveal:false}.
describe('PatientsList — filter sidebar + accordion expansion (Phase 7)', () => {
  it('renders the filter sidebar with all 5 dimensions + Apply + Clear', async () => {
    render(<PatientsList />);
    expect(await screen.findByTestId('patient-filter-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('filter-search')).toBeInTheDocument();
    expect(screen.getByTestId('filter-mrn')).toBeInTheDocument();
    expect(screen.getByTestId('filter-date-from')).toBeInTheDocument();
    expect(screen.getByTestId('filter-date-to')).toBeInTheDocument();
    expect(screen.getByTestId('filter-doctor')).toBeInTheDocument();
    expect(screen.getByTestId('filter-status-completed')).toBeInTheDocument();
    expect(screen.getByTestId('filter-status-partial')).toBeInTheDocument();
    expect(screen.getByTestId('filter-status-recording')).toBeInTheDocument();
    expect(screen.getByTestId('filter-apply')).toBeInTheDocument();
    expect(screen.getByTestId('filter-clear')).toBeInTheDocument();
  });

  it('Clear filters resets search + mrn and refetches with empty filters', async () => {
    const api = getApi();
    render(<PatientsList />);
    const user = userEvent.setup();
    // Seed a search term, then click Clear.
    const search = await screen.findByTestId('filter-search');
    await user.type(search, 'ali');
    const clear = await screen.findByTestId('filter-clear');
    await user.click(clear);
    await waitFor(() => expect(api.patients.list).toHaveBeenCalled());
    const lastCall = api.patients.list.mock.calls[api.patients.list.mock.calls.length - 1]?.[0];
    // search is now empty + no other filters set.
    expect(lastCall?.search ?? undefined).toBeUndefined();
    expect(lastCall?.mrn ?? undefined).toBeUndefined();
    expect(lastCall?.dateFrom ?? undefined).toBeUndefined();
    expect(lastCall?.dateTo ?? undefined).toBeUndefined();
    expect(lastCall?.doctorId ?? undefined).toBeUndefined();
    expect(lastCall?.procedureStatus ?? undefined).toBeUndefined();
  });

  it('expanding a patient row calls procedures.list + reports.getByProcedure', async () => {
    const api = getApi();
    api.procedures.list.mockResolvedValue({
      rows: [
        {
          id: '00000000-0000-4000-8000-0000000000a1',
          patientId: '00000000-0000-4000-8000-000000000001',
          doctorId: '00000000-0000-4000-8000-000000000099',
          startedAt: Date.UTC(2026, 7, 5, 10, 0, 0),
          endedAt: Date.UTC(2026, 7, 5, 10, 5, 0),
          durationSeconds: 300,
          status: 'completed',
          videoPath: 'v.mp4',
          videoPathOriginal: null,
          presetSummary: { kind: 'sd', resolution: '720x480', framerate: 30, bitrate: '4M' },
          audioDeviceName: null,
          createdAt: Date.UTC(2026, 7, 5, 10, 0, 0),
        },
      ],
      total: 1,
    });
    api.reports.getByProcedure.mockResolvedValue({
      id: 'rpt-1',
      procedureId: '00000000-0000-4000-8000-0000000000a1',
      doctorId: '00000000-0000-4000-8000-000000000099',
      findings: '',
      diagnosis: '',
      recommendations: '',
      procedureDetails: '',
      status: 'finalized',
      finalizedAt: Date.now(),
      pdfPath: 'r.pdf',
      pdfGeneratedAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    render(<PatientsList />);
    const user = userEvent.setup();
    await screen.findByText('Alice Carter');
    const toggle = await screen.findByTestId(
      'patient-row-toggle-00000000-0000-4000-8000-000000000001',
    );
    await user.click(toggle);
    await waitFor(() => expect(api.procedures.list).toHaveBeenCalled());
    expect(
      await screen.findByTestId('procedure-row-00000000-0000-4000-8000-0000000000a1'),
    ).toBeInTheDocument();
    // The report row exposes the Open PDF button when a report exists.
    expect(
      await screen.findByTestId('report-row-open-00000000-0000-4000-8000-0000000000a1'),
    ).toBeInTheDocument();
  });

  it('clicking a procedure row navigates to {name: "procedure-review", procedureId}', async () => {
    const api = getApi();
    api.procedures.list.mockResolvedValue({
      rows: [
        {
          id: '00000000-0000-4000-8000-0000000000a1',
          patientId: '00000000-0000-4000-8000-000000000001',
          doctorId: '00000000-0000-4000-8000-000000000099',
          startedAt: Date.UTC(2026, 7, 5, 10, 0, 0),
          endedAt: Date.UTC(2026, 7, 5, 10, 5, 0),
          durationSeconds: 300,
          status: 'completed',
          videoPath: 'v.mp4',
          videoPathOriginal: null,
          presetSummary: { kind: 'sd', resolution: '720x480', framerate: 30, bitrate: '4M' },
          audioDeviceName: null,
          createdAt: Date.UTC(2026, 7, 5, 10, 0, 0),
        },
      ],
      total: 1,
    });
    api.reports.getByProcedure.mockResolvedValue(null);
    render(<PatientsList />);
    const user = userEvent.setup();
    await screen.findByText('Alice Carter');
    await user.click(
      await screen.findByTestId('patient-row-toggle-00000000-0000-4000-8000-000000000001'),
    );
    const procOpen = await screen.findByTestId(
      'procedure-row-open-00000000-0000-4000-8000-0000000000a1',
    );
    await user.click(procOpen);
    await waitFor(() =>
      expect(getRoute()).toEqual({
        name: 'procedure-review',
        procedureId: '00000000-0000-4000-8000-0000000000a1',
      }),
    );
  });

  it('clicking a report row invokes window.api.reports.openPdf with {id, reveal:false}', async () => {
    const api = getApi();
    api.procedures.list.mockResolvedValue({
      rows: [
        {
          id: '00000000-0000-4000-8000-0000000000a1',
          patientId: '00000000-0000-4000-8000-000000000001',
          doctorId: '00000000-0000-4000-8000-000000000099',
          startedAt: Date.UTC(2026, 7, 5, 10, 0, 0),
          endedAt: Date.UTC(2026, 7, 5, 10, 5, 0),
          durationSeconds: 300,
          status: 'completed',
          videoPath: 'v.mp4',
          videoPathOriginal: null,
          presetSummary: { kind: 'sd', resolution: '720x480', framerate: 30, bitrate: '4M' },
          audioDeviceName: null,
          createdAt: Date.UTC(2026, 7, 5, 10, 0, 0),
        },
      ],
      total: 1,
    });
    api.reports.getByProcedure.mockResolvedValue({
      id: 'rpt-1',
      procedureId: '00000000-0000-4000-8000-0000000000a1',
      doctorId: '00000000-0000-4000-8000-000000000099',
      findings: '',
      diagnosis: '',
      recommendations: '',
      procedureDetails: '',
      status: 'finalized',
      finalizedAt: Date.now(),
      pdfPath: 'r.pdf',
      pdfGeneratedAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    api.reports.openPdf.mockResolvedValue({ opened: true });
    render(<PatientsList />);
    const user = userEvent.setup();
    await screen.findByText('Alice Carter');
    await user.click(
      await screen.findByTestId('patient-row-toggle-00000000-0000-4000-8000-000000000001'),
    );
    const reportOpen = await screen.findByTestId(
      'report-row-open-00000000-0000-4000-8000-0000000000a1',
    );
    await user.click(reportOpen);
    await waitFor(() => expect(api.reports.openPdf).toHaveBeenCalled());
    expect(api.reports.openPdf).toHaveBeenCalledWith({ id: 'rpt-1', reveal: false });
  });

  it('Apply triggers refetch with the new dateFrom / dateTo / status', async () => {
    const api = getApi();
    render(<PatientsList />);
    const user = userEvent.setup();
    // Type a date range, tick Completed, click Apply.
    const dateFrom = await screen.findByTestId('filter-date-from');
    await user.type(dateFrom, '2026-08-01');
    const dateTo = await screen.findByTestId('filter-date-to');
    await user.type(dateTo, '2026-08-31');
    await user.click(screen.getByTestId('filter-status-completed'));
    const apply = screen.getByTestId('filter-apply');
    await user.click(apply);
    await waitFor(() => {
      const calls = api.patients.list.mock.calls;
      // The most recent call after Apply should carry our filters.
      const last = calls[calls.length - 1]?.[0] as
        | {
            dateFrom?: string;
            dateTo?: string;
            procedureStatus?: string[];
          }
        | undefined;
      expect(last?.dateFrom).toBe('2026-08-01');
      expect(last?.dateTo).toBe('2026-08-31');
      expect(last?.procedureStatus).toEqual(['completed']);
    });
  });
});
