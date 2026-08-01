// @vitest-environment happy-dom
// Plan 02-03 Task 3 — Settings → Users tests.
// Per D-02 + D-03 + SET-04: admin-gated; admin cannot remove themselves.

import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getApi } from '../setup';
import { initialRoute, setRoute } from '@/lib/router';
import { session } from '@/store/session';
import SettingsUsers from '@/pages/SettingsUsers';
import type { UserPublic } from '@shared/ipc-contract';

const admin: UserPublic = {
  id: '00000000-0000-4000-8000-000000000099',
  fullName: 'Dr. Layla',
  isFirstAdmin: true,
  lastLoginAt: Date.now(),
  failedAttempts: 0,
  lockedUntil: null,
};
const staff: UserPublic = {
  id: '00000000-0000-4000-8000-000000000044',
  fullName: 'Nurse Tarek',
  isFirstAdmin: false,
  lastLoginAt: null,
  failedAttempts: 0,
  lockedUntil: null,
};

function setAdminSession(): void {
  const api = getApi();
  api.auth.status.mockResolvedValue({
    hasUsers: true,
    authenticated: true,
    userId: admin.id,
    clinicName: 'Cairo',
    isFirstAdmin: true,
  });
  api.auth.usersList.mockResolvedValue([admin, staff]);
}

function setNonAdminSession(): void {
  const api = getApi();
  api.auth.status.mockResolvedValue({
    hasUsers: true,
    authenticated: true,
    userId: staff.id,
    clinicName: 'Cairo',
    isFirstAdmin: false,
  });
  api.auth.usersList.mockResolvedValue([admin, staff]);
}

beforeEach(() => {
  setRoute(initialRoute);
  // Each test seeds the auth mocks inside its body before any component renders.
});

describe('Settings → Users', () => {
  it('renders the user list when session.isFirstAdmin === true', async () => {
    setAdminSession();
    await session.refresh();
    render(<SettingsUsers />);
    expect(await screen.findByText('Dr. Layla')).toBeInTheDocument();
    expect(await screen.findByText('Nurse Tarek')).toBeInTheDocument();
  });

  it('"Add user" opens the dialog; submit calls users.create once', async () => {
    setAdminSession();
    await session.refresh();
    const api = getApi();
    api.users.create.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000200',
      fullName: 'New Staff',
      isFirstAdmin: false,
      lastLoginAt: null,
      failedAttempts: 0,
      lockedUntil: null,
    });
    const user = userEvent.setup();
    render(<SettingsUsers />);
    await user.click(await screen.findByRole('button', { name: /^add user$/i }));
    // Dialog opens with "Add user" title + a submit button.
    expect(await screen.findByRole('dialog', { name: /add user/i })).toBeInTheDocument();
    await user.type(await screen.findByLabelText(/full name/i), 'New Staff');
    const pinInputs = await screen.findAllByLabelText(/4-digit pin/i);
    await user.type(pinInputs[0]!, '1234');
    await user.click(screen.getByRole('button', { name: /^add user$/i }));
    await waitFor(() => expect(api.users.create).toHaveBeenCalledTimes(1));
    expect(api.users.create).toHaveBeenCalledWith({ fullName: 'New Staff', pin: '1234' });
  });

  it('"Reset PIN" opens the dialog; submit calls users.resetPin once', async () => {
    setAdminSession();
    await session.refresh();
    const api = getApi();
    api.users.resetPin.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<SettingsUsers />);
    // Open the staff's actions menu
    const staffMenu = await screen.findByRole('button', { name: /actions for nurse tarek/i });
    await user.click(staffMenu);
    await user.click(await screen.findByRole('menuitem', { name: /reset pin/i }));
    const pinInputs = await screen.findAllByLabelText(/new pin/i);
    await user.type(pinInputs[0]!, '4321');
    const confirmInputs = await screen.findAllByLabelText(/confirm pin/i);
    await user.type(confirmInputs[0]!, '4321');
    await user.click(screen.getByRole('button', { name: /^reset pin$/i }));
    await waitFor(() => expect(api.users.resetPin).toHaveBeenCalledTimes(1));
    expect(api.users.resetPin).toHaveBeenCalledWith({ userId: staff.id, newPin: '4321' });
  });

  it('"Remove" opens the confirm; confirm calls users.remove once', async () => {
    setAdminSession();
    await session.refresh();
    const api = getApi();
    api.users.remove.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<SettingsUsers />);
    const staffMenu = await screen.findByRole('button', { name: /actions for nurse tarek/i });
    await user.click(staffMenu);
    await user.click(await screen.findByRole('menuitem', { name: /^remove$/i }));
    expect(await screen.findByText(/remove user\?/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^remove$/i }));
    await waitFor(() => expect(api.users.remove).toHaveBeenCalledTimes(1));
    expect(api.users.remove).toHaveBeenCalledWith({ userId: staff.id });
  });

  it('renders the "Admin only" gate when session.isFirstAdmin === false', async () => {
    setNonAdminSession();
    await session.refresh();
    render(<SettingsUsers />);
    // Two elements contain "Admin only" — the title and the description.
    expect(await screen.findByText(/^admin only$/i)).toBeInTheDocument();
  });

  it("the current admin's own Remove button is disabled (per D-02)", async () => {
    setAdminSession();
    await session.refresh();
    const user = userEvent.setup();
    render(<SettingsUsers />);
    const adminMenu = await screen.findByRole('button', { name: /actions for dr\. layla/i });
    await user.click(adminMenu);
    const removeItem = await screen.findByRole('menuitem', { name: /^remove$/i });
    expect(removeItem).toHaveAttribute('data-disabled', '');
  });
});
