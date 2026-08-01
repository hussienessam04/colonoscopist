// @vitest-environment happy-dom
// Plan 02-03 Task 2 — Two-step Login tests.
// Per D-05/D-06: user list (avatar + name + last-login) -> tap row -> PIN entry.
// Per D-07: wrong PIN renders "Incorrect PIN" inline; correct PIN navigates to patients.
// Per D-08: back arrow returns to the list.
// Per D-04 + Fix 7: "Forgot admin PIN?" affordance opens the recovery file picker modal.

import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getApi } from '../setup';
import { getRoute } from '@/lib/router';
import Login from '@/pages/Login';
import type { UserPublic } from '@shared/ipc-contract';

const admin: UserPublic = {
  id: '00000000-0000-4000-8000-000000000001',
  fullName: 'Dr. Layla',
  isFirstAdmin: true,
  lastLoginAt: Date.now() - 60_000,
  failedAttempts: 0,
  lockedUntil: null,
};

const staff: UserPublic = {
  id: '00000000-0000-4000-8000-000000000002',
  fullName: 'Nurse Tarek',
  isFirstAdmin: false,
  lastLoginAt: null,
  failedAttempts: 0,
  lockedUntil: null,
};

describe('Login page (two-step)', () => {
  it('renders one row per user with avatar + name + last-login (per D-05/D-06)', async () => {
    const api = getApi();
    api.auth.usersList.mockResolvedValue([admin, staff]);
    api.auth.status.mockResolvedValue({
      hasUsers: true,
      authenticated: false,
      userId: null,
      clinicName: 'Cairo Clinic',
      isFirstAdmin: false,
    });
    render(<Login />);
    expect(await screen.findByText('Dr. Layla')).toBeInTheDocument();
    expect(await screen.findByText('Nurse Tarek')).toBeInTheDocument();
    // "Admin" appears in both the role label ("Admin · last seen…") and the
    // recovery picker trigger ("Forgot admin PIN?") — use the more specific role label.
    expect(screen.getByText(/^Admin · last seen/)).toBeInTheDocument();
    expect(screen.getByText(/^Staff · last seen/)).toBeInTheDocument();
    expect(screen.getAllByText(/last seen/i).length).toBeGreaterThanOrEqual(2);
  });

  it('transitions to PIN entry on row tap; back arrow returns to list (per D-05 + D-08)', async () => {
    const api = getApi();
    api.auth.usersList.mockResolvedValue([admin, staff]);
    api.auth.status.mockResolvedValue({
      hasUsers: true,
      authenticated: false,
      userId: null,
      clinicName: 'Cairo Clinic',
      isFirstAdmin: false,
    });
    const user = userEvent.setup();
    render(<Login />);
    const row = await screen.findByRole('button', { name: /sign in as dr\. layla/i });
    await user.click(row);
    expect(await screen.findByLabelText(/pin/i)).toBeInTheDocument();
    expect(screen.getByText(/sign in as dr\. layla/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /back to user list/i }));
    await waitFor(() => expect(screen.getByText('Nurse Tarek')).toBeInTheDocument());
  });

  it('submits a wrong PIN and renders inline error "Incorrect PIN" (per D-07)', async () => {
    const api = getApi();
    api.auth.usersList.mockResolvedValue([admin]);
    api.auth.status.mockResolvedValue({
      hasUsers: true,
      authenticated: false,
      userId: null,
      clinicName: 'Cairo Clinic',
      isFirstAdmin: false,
    });
    api.auth.login.mockResolvedValue({ ok: false, code: 'IPC_AUTH_FAILED' });
    const user = userEvent.setup();
    render(<Login />);
    await user.click(await screen.findByRole('button', { name: /sign in as dr\. layla/i }));
    const pinInput = await screen.findByLabelText(/pin/i);
    await user.type(pinInput, '0000');
    await user.click(screen.getByRole('button', { name: /^enter$/i }));
    expect(await screen.findByText(/incorrect pin/i)).toBeInTheDocument();
    expect(api.auth.login).toHaveBeenCalledTimes(1);
    // PIN field is cleared after a wrong attempt (D-07).
    await waitFor(() => expect((pinInput as HTMLInputElement).value).toBe(''));
  });

  it('submits the correct PIN, calls auth.login once, and navigates to patients', async () => {
    const api = getApi();
    api.auth.usersList.mockResolvedValue([admin]);
    api.auth.status.mockResolvedValue({
      hasUsers: true,
      authenticated: false,
      userId: null,
      clinicName: 'Cairo Clinic',
      isFirstAdmin: false,
    });
    api.auth.login.mockResolvedValue({ ok: true, user: admin });
    const user = userEvent.setup();
    render(<Login />);
    await user.click(await screen.findByRole('button', { name: /sign in as dr\. layla/i }));
    const pinInput = await screen.findByLabelText(/pin/i);
    await user.type(pinInput, '1234');
    await user.click(screen.getByRole('button', { name: /^enter$/i }));
    await waitFor(() => expect(api.auth.login).toHaveBeenCalledTimes(1));
    expect(api.auth.login).toHaveBeenCalledWith({ userId: admin.id, pin: '1234' });
    await waitFor(() => expect(getRoute().name).toBe('patients'));
  });

  it('shows "Forgot admin PIN?" affordance; clicking "Email vendor" calls auth.recoveryRequest', async () => {
    const api = getApi();
    api.auth.usersList.mockResolvedValue([admin]);
    api.auth.status.mockResolvedValue({
      hasUsers: true,
      authenticated: false,
      userId: null,
      clinicName: 'Cairo Clinic',
      isFirstAdmin: false,
    });
    api.auth.recoveryRequest.mockResolvedValue({
      accepted: true,
      verificationDeferred: true,
      machineFingerprint: 'fp',
      mailto: 'mailto:test',
    });
    const user = userEvent.setup();
    render(<Login />);
    await user.click(await screen.findByRole('button', { name: /forgot admin pin\?/i }));
    expect(await screen.findByText(/recover admin pin/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^email vendor$/i }));
    await waitFor(() => expect(api.auth.recoveryRequest).toHaveBeenCalledTimes(1));
  });

  it('on IPC_AUTH_FAILED the PIN field clears and the Enter button briefly disables (per D-07)', async () => {
    const api = getApi();
    api.auth.usersList.mockResolvedValue([admin]);
    api.auth.status.mockResolvedValue({
      hasUsers: true,
      authenticated: false,
      userId: null,
      clinicName: 'Cairo Clinic',
      isFirstAdmin: false,
    });
    api.auth.login.mockResolvedValue({ ok: false, code: 'IPC_AUTH_FAILED' });
    const user = userEvent.setup();
    render(<Login />);
    await user.click(await screen.findByRole('button', { name: /sign in as dr\. layla/i }));
    const pinInput = await screen.findByLabelText(/pin/i);
    await user.type(pinInput, '1111');
    await user.click(screen.getByRole('button', { name: /^enter$/i }));
    await waitFor(() => expect(api.auth.login).toHaveBeenCalled());
    await waitFor(() => expect((pinInput as HTMLInputElement).value).toBe(''));
    await waitFor(() => expect(screen.getByRole('button', { name: /^enter$/i })).toBeDisabled());
  });

  it('on IPC_LOCKED the lockout message renders and the back arrow still works (per D-07/D-08)', async () => {
    const api = getApi();
    api.auth.usersList.mockResolvedValue([admin]);
    api.auth.status.mockResolvedValue({
      hasUsers: true,
      authenticated: false,
      userId: null,
      clinicName: 'Cairo Clinic',
      isFirstAdmin: false,
    });
    api.auth.login.mockResolvedValue({ ok: false, code: 'IPC_LOCKED', retryAt: Date.now() + 60_000 });
    const user = userEvent.setup();
    render(<Login />);
    await user.click(await screen.findByRole('button', { name: /sign in as dr\. layla/i }));
    const pinInput = await screen.findByLabelText(/pin/i);
    await user.type(pinInput, '1234');
    await user.click(screen.getByRole('button', { name: /^enter$/i }));
    expect(await screen.findByText(/account locked/i)).toBeInTheDocument();
    // Back arrow still works (per D-08).
    await user.click(screen.getByRole('button', { name: /back to user list/i }));
    await waitFor(() => expect(screen.getByText('Dr. Layla')).toBeInTheDocument());
  });
});
