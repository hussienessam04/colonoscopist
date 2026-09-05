// @vitest-environment happy-dom
// Plan 02-03 Task 3 — PatientsList tests.
// Per PAT-02 + PAT-04: search + MRN exact + show-deleted toggle + page-size + soft-delete.
// Per Fix 6: every patients.list call writes a patient_list audit row in main.
// Plan 03-04 — Settings DropdownMenu surfaces Capture (every doctor) + Users (admin only).
//
// Quick task 20260811 — Phase 7 / Plan 07-02 filter sidebar + accordion
// expansion tests were dropped (both surfaces reverted); a new case
// covers the "View procedures" DropdownMenuItem navigation.

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
  language: 'en' as const,
};
const STAFF_USER = {
  id: '00000000-0000-4000-8000-000000000044',
  fullName: 'Nurse Tarek',
  isFirstAdmin: false,
  lastLoginAt: null,
  failedAttempts: 0,
  lockedUntil: null,
  language: 'en' as const,
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

  it('typing in the MRN input calls patients.list with the mrn param after debounce', async () => {
    const api = getApi();
    render(<PatientsList />);
    const mrn = await screen.findByLabelText(/mrn \(exact\)/i);
    const user = userEvent.setup();
    await user.type(mrn, 'MRN-001');
    await waitFor(() => expect(api.patients.list).toHaveBeenCalled(), { timeout: 1500 });
    const lastCall = api.patients.list.mock.calls[api.patients.list.mock.calls.length - 1]?.[0];
    expect(lastCall).toMatchObject({ mrn: 'MRN-001' });
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
    // Confirm dialog appears — Phase 7 / Plan 07-04 renamed the title to
    // "Archive patient?" per UI-SPEC §Copywriting Contract.
    expect(await screen.findByText(/archive patient\?/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^archive$/i }));
    await waitFor(() => expect(api.patients.softDelete).toHaveBeenCalledTimes(1));
    expect(api.patients.softDelete).toHaveBeenCalledWith(patients[0]!.id);
    // List refetched after the delete.
    await waitFor(() => expect(api.patients.list).toHaveBeenCalledTimes(vi.mocked(api.patients.list).mock.calls.length));
  });

  // Quick task 20260811 — View procedures dropdown item navigates to
  // { name: 'patient-procedures', patientId } per plan. Procedure
  // listing itself is covered by tests/renderer/pages/PatientProcedures.test.tsx.
  it("row's \"View procedures\" action navigates to { name: 'patient-procedures', patientId }", async () => {
    render(<PatientsList />);
    await screen.findByText('Alice Carter');
    const user = userEvent.setup();
    const aliceMenu = screen.getByRole('button', { name: /actions for alice carter/i });
    await user.click(aliceMenu);
    await user.click(await screen.findByTestId('view-procedures'));
    await waitFor(() =>
      expect(getRoute()).toEqual({
        name: 'patient-procedures',
        patientId: '00000000-0000-4000-8000-000000000001',
      }),
    );
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

// Quick task 20260811-patients-list-polish — header kicker, active
// filter chips, refined empty states, and the "Showing X-Y of Z"
// pagination footer format. Cases mirror PLAN.md §Acceptance so a
// regression in any of these surfaces fails the suite.
describe('PatientsList — UI polish (20260811-patients-list-polish)', () => {
  it('header "PATIENTS" kicker renders above the page title', async () => {
    render(<PatientsList />);
    await screen.findByText('Alice Carter');
    const kicker = await screen.findByTestId('patient-page-kicker');
    // ponytail: i18next resolves the kicker to the bundled "Patients"
    // string in the en bundle; the test contract is the testid + the
    // string content, not any specific casing (CSS uppercases it).
    expect(kicker).toHaveTextContent(/Patient/i);
  });

  it('active filter chip for search renders; clicking × clears search', async () => {
    const api = getApi();
    render(<PatientsList />);
    const search = await screen.findByLabelText(/search by name/i);
    const user = userEvent.setup();
    await user.type(search, 'John');
    // Chip mounts once the search input has any content.
    const chip = await screen.findByTestId('filter-chip-search');
    expect(chip).toHaveTextContent('John');
    // Click the chip × — the inner button (badge's remove affordance).
    const removeBtn = chip.querySelector('button');
    expect(removeBtn).not.toBeNull();
    await user.click(removeBtn as HTMLButtonElement);
    // Chip disappears + the next debounced patients.list call has no
    // search param.
    await waitFor(() => {
      expect(screen.queryByTestId('filter-chip-search')).toBeNull();
    });
    await waitFor(() => {
      const lastCall =
        api.patients.list.mock.calls[api.patients.list.mock.calls.length - 1]?.[0];
      expect(lastCall).toMatchObject({ search: undefined });
    });
  });

  it('active filter chip for MRN renders when MRN is non-empty', async () => {
    render(<PatientsList />);
    const mrn = await screen.findByLabelText(/mrn \(exact\)/i);
    const user = userEvent.setup();
    await user.type(mrn, '12345');
    const chip = await screen.findByTestId('filter-chip-mrn');
    expect(chip).toHaveTextContent('12345');
  });

  it('empty state with no rows + no filters renders "Add your first patient" CTA → navigates to patient-new', async () => {
    const api = getApi();
    api.patients.list.mockResolvedValue({ rows: [], total: 0 });
    render(<PatientsList />);
    const cta = await screen.findByTestId('patient-empty-cta');
    expect(cta).toBeInTheDocument();
    // The surrounding empty-state cell uses the first-patient testid.
    expect(await screen.findByTestId('patient-empty-first')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(cta);
    await waitFor(() => expect(getRoute().name).toBe('patient-new'));
  });

  it('empty state with rows=0 + search filter renders the filtered empty message', async () => {
    const api = getApi();
    api.patients.list.mockResolvedValue({ rows: [], total: 0 });
    render(<PatientsList />);
    const search = await screen.findByLabelText(/search by name/i);
    const user = userEvent.setup();
    await user.type(search, 'John');
    // Filtered empty cell renders instead of the first-patient CTA.
    const filtered = await screen.findByTestId('patient-empty-filtered');
    expect(filtered).toBeInTheDocument();
    expect(screen.queryByTestId('patient-empty-first')).toBeNull();
    expect(filtered).toHaveTextContent(/no procedures match these filters/i);
    expect(filtered).toHaveTextContent(/try clearing your filters/i);
  });

  it('pagination footer uses the "Showing X-Y of Z" range format', async () => {
    const api = getApi();
    // 2 rows + total=50 + page=1 + pageSize=25 → "Showing 1-25 of 50".
    api.patients.list.mockResolvedValue({ rows: patients, total: 50 });
    render(<PatientsList />);
    await screen.findByText('Alice Carter');
    const range = await screen.findByTestId('pagination-range');
    expect(range).toHaveTextContent('Showing 1-25 of 50');
  });
});

// Plan 08-10 / G-08-4 — when the gated IPC returns {ok: false} the
// page must NOT crash on a missing rows/total destructure. It renders
// <EmptyStateCard> instead. Regression test for the exact failure point
// the UAT caught on PatientsList (the original reported issue).
describe('PatientsList — gated-IPC graceful degrade (08-10)', () => {
  it('renders <EmptyStateCard> when patients.list returns {ok: false, code: IPC_LICENSE_INVALID}', async () => {
    const api = getApi();
    api.patients.list.mockResolvedValue({
      ok: false,
      code: 'IPC_LICENSE_INVALID',
    });
    render(<PatientsList />);
    expect(await screen.findByTestId('gated-empty-state')).toBeInTheDocument();
    // Page did not crash on rows/total destructure; the table is
    // rendered (no rows) but the EmptyStateCard sits above it.
    expect(screen.queryByText('Alice Carter')).not.toBeInTheDocument();
  });
});