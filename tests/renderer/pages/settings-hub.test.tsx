// @vitest-environment happy-dom
// Plan 03-05 Task 1 — SettingsHub page tests.
// Per the plan: SettingsHub is a dedicated page with a right-side sidebar nav.
// Capture entry is reachable by every authenticated doctor; Users entry is
// admin-only (disabled when !isFirstAdmin). Back returns to patients.

import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getApi } from '../setup';
import { initialRoute, setRoute, getRoute } from '@/lib/router';
import { session } from '@/store/session';
import SettingsHub from '@/pages/SettingsHub';
import type { UserPublic } from '@shared/ipc-contract';

const ADMIN_USER: UserPublic = {
  id: '00000000-0000-4000-8000-000000000099',
  fullName: 'Dr. Layla',
  isFirstAdmin: true,
  lastLoginAt: Date.now(),
  failedAttempts: 0,
  lockedUntil: null,
};
const STAFF_USER: UserPublic = {
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
    userId: ADMIN_USER.id,
    clinicName: 'Cairo',
    isFirstAdmin: true,
  });
  api.auth.usersList.mockResolvedValue([ADMIN_USER]);
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
}

beforeEach(() => {
  setRoute(initialRoute);
});

describe('SettingsHub', () => {
  it('admin: renders Capture and Users sidebar entries both enabled (T-3-16)', async () => {
    setAdminSession();
    await session.refresh();
    render(<SettingsHub />);
    const capture = await screen.findByRole('button', { name: /^capture$/i });
    const users = await screen.findByRole('button', { name: /^users$/i });
    expect(capture).not.toBeDisabled();
    expect(users).not.toBeDisabled();
  });

  it('non-admin: Capture is enabled and Users is disabled (T-3-16, SET-04)', async () => {
    setNonAdminSession();
    await session.refresh();
    render(<SettingsHub />);
    const capture = await screen.findByRole('button', { name: /^capture$/i });
    const users = await screen.findByRole('button', { name: /^users$/i });
    expect(capture).not.toBeDisabled();
    expect(users).toBeDisabled();
  });

  it('renders a Back button in the header', async () => {
    setAdminSession();
    await session.refresh();
    render(<SettingsHub />);
    const back = await screen.findByRole('button', { name: /^back$/i });
    expect(back).toBeInTheDocument();
  });

  it('admin: clicking Capture navigates to settings-capture', async () => {
    setRoute({ name: 'patients' });
    setAdminSession();
    await session.refresh();
    const user = userEvent.setup();
    render(<SettingsHub />);
    await user.click(await screen.findByRole('button', { name: /^capture$/i }));
    await waitFor(() => expect(getRoute().name).toBe('settings-capture'));
  });

  it('non-admin: clicking Capture navigates to settings-capture (CAPT-01 / G-03-1 / G-03-2)', async () => {
    setRoute({ name: 'patients' });
    setNonAdminSession();
    await session.refresh();
    const user = userEvent.setup();
    render(<SettingsHub />);
    await user.click(await screen.findByRole('button', { name: /^capture$/i }));
    await waitFor(() => expect(getRoute().name).toBe('settings-capture'));
  });

  it('admin: clicking Users navigates to settings-users', async () => {
    setRoute({ name: 'patients' });
    setAdminSession();
    await session.refresh();
    const user = userEvent.setup();
    render(<SettingsHub />);
    await user.click(await screen.findByRole('button', { name: /^users$/i }));
    await waitFor(() => expect(getRoute().name).toBe('settings-users'));
  });

  it('non-admin: clicking the disabled Users button does NOT navigate (T-3-16)', async () => {
    setRoute({ name: 'patients' });
    setNonAdminSession();
    await session.refresh();
    const user = userEvent.setup();
    render(<SettingsHub />);
    const users = await screen.findByRole('button', { name: /^users$/i });
    expect(users).toBeDisabled();
    // Disabled buttons do not fire onClick; the route must stay on 'patients'.
    await user.click(users);
    await new Promise((r) => setTimeout(r, 25));
    expect(getRoute().name).toBe('patients');
  });

  it('Back header button navigates to patients', async () => {
    setRoute({ name: 'settings-hub' });
    setAdminSession();
    await session.refresh();
    const user = userEvent.setup();
    render(<SettingsHub />);
    await user.click(await screen.findByRole('button', { name: /^back$/i }));
    await waitFor(() => expect(getRoute().name).toBe('patients'));
  });

  it('neither sidebar button is active on the Hub (G-03-6)', async () => {
    // The Hub is a router, not a destination — both sidebar entries stay
    // outline-only and carry data-active="false" so neither looks
    // selected. Mounting <SettingsSidebar /> (no activeTab) is the
    // contract that makes this case work.
    setAdminSession();
    await session.refresh();
    render(<SettingsHub />);
    const capture = await screen.findByTestId('settings-hub-capture');
    const users = await screen.findByTestId('settings-hub-users');
    expect(capture.getAttribute('data-active')).toBe('false');
    expect(users.getAttribute('data-active')).toBe('false');
  });
});
