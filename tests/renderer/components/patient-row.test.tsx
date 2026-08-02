// @vitest-environment happy-dom
// Plan 03-05 Task 2 — PatientRow component tests.
// Per G-03-4: a non-deleted PatientRow exposes an "Open Procedure Room"
// action that navigates to { name: 'procedure-room', patientId }; a deleted
// PatientRow (deletedAt !== null) does NOT render the action.

import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getApi } from '../setup';
import { initialRoute, setRoute, getRoute } from '@/lib/router';
import { session } from '@/store/session';
import PatientsList from '@/pages/PatientsList';
import type { Patient } from '@shared/ipc-contract';

const ALICE: Patient = {
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
};

const DELETED_ALICE: Patient = {
  ...ALICE,
  id: '00000000-0000-4000-8000-000000000007',
  fullName: 'Deleted Alice',
  deletedAt: Date.now(),
};

const ADMIN_USER = {
  id: '00000000-0000-4000-8000-000000000099',
  fullName: 'Dr. Layla',
  isFirstAdmin: true,
  lastLoginAt: Date.now(),
  failedAttempts: 0,
  lockedUntil: null,
};

function setAdminSession(rows: Patient[]): void {
  const api = getApi();
  api.auth.status.mockResolvedValue({
    hasUsers: true,
    authenticated: true,
    userId: ADMIN_USER.id,
    clinicName: 'Cairo',
    isFirstAdmin: true,
  });
  api.auth.usersList.mockResolvedValue([ADMIN_USER]);
  api.patients.list.mockResolvedValue({ rows, total: rows.length });
}

beforeEach(() => {
  setRoute(initialRoute);
});

describe('PatientRow — Open Procedure Room entry (G-03-4)', () => {
  it('non-deleted row exposes an "Open Procedure Room" menuitem that routes with the patientId', async () => {
    setAdminSession([ALICE]);
    await session.refresh();
    setRoute({ name: 'patients' });

    const user = userEvent.setup();
    render(<PatientsList />);
    await screen.findByText('Alice Carter');

    await user.click(screen.getByRole('button', { name: /actions for alice carter/i }));
    const openProc = await screen.findByRole('menuitem', { name: /open procedure room/i });
    expect(openProc).toBeInTheDocument();

    await user.click(openProc);
    await waitFor(() => expect(getRoute().name).toBe('procedure-room'));
    expect(getRoute()).toMatchObject({ name: 'procedure-room', patientId: ALICE.id });
  });

  it('deleted row does NOT render the "Open Procedure Room" entry (T-3-20)', async () => {
    setAdminSession([DELETED_ALICE]);
    await session.refresh();
    setRoute({ name: 'patients' });

    const user = userEvent.setup();
    render(<PatientsList />);
    await screen.findByText('Deleted Alice');

    await user.click(screen.getByRole('button', { name: /actions for deleted alice/i }));
    // Edit + Restore are present; Open Procedure Room is NOT.
    expect(await screen.findByRole('menuitem', { name: /^edit$/i })).toBeInTheDocument();
    expect(await screen.findByRole('menuitem', { name: /^restore$/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /open procedure room/i })).toBeNull();
  });
});
