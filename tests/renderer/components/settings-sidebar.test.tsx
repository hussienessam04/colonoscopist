// @vitest-environment happy-dom
// Plan 03-06 Task 2 — SettingsSidebar component tests (G-03-6).
// Per the plan: SettingsSidebar is a shared sidebar nav that lives on
// every Settings page (Hub, Capture, Users). It owns the active-tab
// highlight (data-active attribute + default vs outline variant) and
// the admin gate on the Users button. The SettingsHub page (which has
// no active destination) renders <SettingsSidebar /> with no prop;
// SettingsCapture passes activeTab="capture"; SettingsUsers passes
// activeTab="users". The two testids (settings-hub-capture,
// settings-hub-users) are preserved from the prior inline <aside> so
// the existing SettingsHub tests keep passing.

import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getApi } from '../setup';
import { initialRoute, setRoute, getRoute } from '@/lib/router';
import { session } from '@/store/session';
import { SettingsSidebar } from '@/components/SettingsSidebar';
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

describe('SettingsSidebar', () => {
  it('admin: Capture and Users both render enabled with data-active="false" when no activeTab is set', async () => {
    // The Hub is a router, not a destination — both buttons stay
    // outline-only and carry data-active="false" so neither looks
    // selected. This is the default state of SettingsHub's mount.
    setAdminSession();
    await session.refresh();
    render(<SettingsSidebar />);
    const capture = await screen.findByTestId('settings-hub-capture');
    const users = await screen.findByTestId('settings-hub-users');
    expect(capture).not.toBeDisabled();
    expect(users).not.toBeDisabled();
    expect(capture.getAttribute('data-active')).toBe('false');
    expect(users.getAttribute('data-active')).toBe('false');
  });

  it('non-admin: Users is disabled when no activeTab is set (admin gate travels with the sidebar)', async () => {
    // T-3-22 — disabled Users on non-admin sessions regardless of which
    // page mounts the sidebar. The Hub page must inherit the same gate
    // as the dedicated Users page.
    setNonAdminSession();
    await session.refresh();
    render(<SettingsSidebar />);
    const users = await screen.findByTestId('settings-hub-users');
    expect(users).toBeDisabled();
    const capture = screen.getByTestId('settings-hub-capture');
    expect(capture).not.toBeDisabled();
  });

  it('activeTab="capture" highlights Capture and leaves Users inactive', async () => {
    setAdminSession();
    await session.refresh();
    render(<SettingsSidebar activeTab="capture" />);
    const capture = await screen.findByTestId('settings-hub-capture');
    const users = await screen.findByTestId('settings-hub-users');
    expect(capture.getAttribute('data-active')).toBe('true');
    expect(users.getAttribute('data-active')).toBe('false');
  });

  it('activeTab="users" highlights Users and leaves Capture inactive', async () => {
    setAdminSession();
    await session.refresh();
    render(<SettingsSidebar activeTab="users" />);
    const capture = await screen.findByTestId('settings-hub-capture');
    const users = await screen.findByTestId('settings-hub-users');
    expect(capture.getAttribute('data-active')).toBe('false');
    expect(users.getAttribute('data-active')).toBe('true');
  });

  it('admin: clicking Capture navigates to settings-capture from the sidebar', async () => {
    // T-3-23 — the navigation literal lives inside the shared component
    // so every page that mounts the sidebar gets the same route change.
    setRoute({ name: 'patients' });
    setAdminSession();
    await session.refresh();
    const user = userEvent.setup();
    render(<SettingsSidebar />);
    await user.click(await screen.findByTestId('settings-hub-capture'));
    await waitFor(() => expect(getRoute().name).toBe('settings-capture'));
  });

  it('non-admin: clicking the disabled Users button does NOT navigate (T-3-22)', async () => {
    // Disabled buttons do not fire onClick; the route must stay where
    // the doctor left it. Mirrors the same gate on the Hub page so the
    // contract is identical for Hub / Capture / Users mounts.
    setRoute({ name: 'patients' });
    setNonAdminSession();
    await session.refresh();
    const user = userEvent.setup();
    render(<SettingsSidebar activeTab="capture" />);
    const users = await screen.findByTestId('settings-hub-users');
    expect(users).toBeDisabled();
    await user.click(users);
    await new Promise((r) => setTimeout(r, 25));
    expect(getRoute().name).toBe('patients');
  });
});

// Phase 7 / Plan 07-02 — D-05 + D-11: Audit + Backup & Restore visual
// entries. The route union extends in router.ts; the buttons live on the
// shared SettingsSidebar so every Settings sub-page inherits them. The
// active highlight keys on `route.name === 'audit'` (or 'backup-restore')
// since those pages have no `activeTab` prop yet.
describe('SettingsSidebar — Phase 7 Audit + Backup & Restore entries', () => {
  it('renders the Audit + Backup & Restore buttons alongside the existing entries', async () => {
    setAdminSession();
    await session.refresh();
    render(<SettingsSidebar />);
    const audit = await screen.findByTestId('settings-hub-audit');
    const backup = await screen.findByTestId('settings-hub-backup-restore');
    expect(audit).toBeInTheDocument();
    expect(backup).toBeInTheDocument();
    // Icons render inline; presence of the data-testid + a <svg> child
    // is sufficient — keeps the assertion copy-independent of icon
    // refactors.
    expect(audit.querySelector('svg')).not.toBeNull();
    expect(backup.querySelector('svg')).not.toBeNull();
  });

  it('clicking Audit navigates to {name: "audit"}', async () => {
    setRoute({ name: 'patients' });
    setAdminSession();
    await session.refresh();
    const user = userEvent.setup();
    render(<SettingsSidebar />);
    await user.click(await screen.findByTestId('settings-hub-audit'));
    await waitFor(() => expect(getRoute().name).toBe('audit'));
  });

  it('clicking Backup & Restore navigates to {name: "backup-restore"}', async () => {
    setRoute({ name: 'patients' });
    setAdminSession();
    await session.refresh();
    const user = userEvent.setup();
    render(<SettingsSidebar />);
    await user.click(await screen.findByTestId('settings-hub-backup-restore'));
    await waitFor(() => expect(getRoute().name).toBe('backup-restore'));
  });

  it('Audit + Backup & Restore are NOT admin-gated (every doctor sees them)', async () => {
    setNonAdminSession();
    await session.refresh();
    render(<SettingsSidebar />);
    const audit = await screen.findByTestId('settings-hub-audit');
    const backup = await screen.findByTestId('settings-hub-backup-restore');
    expect(audit).not.toBeDisabled();
    expect(backup).not.toBeDisabled();
  });
});