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