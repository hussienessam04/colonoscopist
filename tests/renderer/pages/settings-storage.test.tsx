// @vitest-environment happy-dom
// Quick task 20260912-shared-database-optional — coverage for the
// Settings → Storage page. Validates:
//   1. Initial render reads `getLocation` and shows the toggle state.
//   2. Toggling on reveals the path picker card.
//   3. Save calls `setLocation` with the toggled state + path.
//   4. Reset button clears the local UI state.
//   5. Failed save surfaces an inline error banner.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getApi } from '../setup';
import { setRoute } from '@/store/route';
import SettingsStorage from '@/pages/SettingsStorage';

beforeEach(() => {
  // Quick task 20260912-shared-database-optional — the page is
  // admin-gated via the sidebar entry (SettingsSidebar disables
  // the button for non-admins). The page body itself renders
  // for any signed-in user — direct `setRoute({ name:
  // 'settings-storage' })` bypasses the sidebar gate.
  setRoute({ name: 'settings-storage' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Settings → Storage', () => {
  it('renders the page + reads the current location on mount', async () => {
    const api = getApi();
    api.storage.getLocation.mockResolvedValueOnce({
      enabled: false,
      sharedPath: null,
      effectivePath: '/mock/userData',
      localPath: '/mock/userData',
    });
    render(<SettingsStorage />);
    expect(await screen.findByTestId('settings-storage-card')).toBeInTheDocument();
    await waitFor(() => expect(api.storage.getLocation).toHaveBeenCalledTimes(1));
    // Toggle starts off → path picker card is NOT rendered.
    expect(screen.queryByTestId('settings-storage-pick-folder')).toBeNull();
  });

  it('flipping the toggle on reveals the folder picker card', async () => {
    render(<SettingsStorage />);
    const toggle = await screen.findByTestId('settings-storage-toggle');
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    expect(toggle).toBeChecked();
    // Now the folder picker + reset + save buttons appear.
    expect(screen.getByTestId('settings-storage-pick-folder')).toBeInTheDocument();
    expect(screen.getByTestId('settings-storage-reset')).toBeInTheDocument();
  });

  it('pickFolder IPC result populates the path display', async () => {
    const api = getApi();
    api.storage.pickFolder.mockResolvedValueOnce({ path: '\\\\fileserver\\shared\\colonoscopist' });
    render(<SettingsStorage />);
    await userEvent.click(await screen.findByTestId('settings-storage-toggle'));
    await userEvent.click(screen.getByTestId('settings-storage-pick-folder'));
    await waitFor(() => {
      expect(api.storage.pickFolder).toHaveBeenCalledTimes(1);
    });
    expect(
      await screen.findByTestId('settings-storage-path-display'),
    ).toHaveTextContent('fileserver');
  });

  it('Save calls setLocation with the toggled state + path', async () => {
    const api = getApi();
    api.storage.pickFolder.mockResolvedValueOnce({ path: '/shared/dir' });
    api.storage.setLocation.mockResolvedValueOnce({
      ok: true,
      requiresRestart: true,
    });
    render(<SettingsStorage />);
    // Toggle on + pick folder + save.
    await userEvent.click(await screen.findByTestId('settings-storage-toggle'));
    await userEvent.click(screen.getByTestId('settings-storage-pick-folder'));
    await waitFor(() => expect(api.storage.pickFolder).toHaveBeenCalled());
    await userEvent.click(screen.getByTestId('settings-storage-save'));
    await waitFor(() =>
      expect(api.storage.setLocation).toHaveBeenCalledWith({
        enabled: true,
        sharedPath: '/shared/dir',
      }),
    );
  });

  it('Save surfaces an inline error banner when setLocation returns ok=false', async () => {
    const api = getApi();
    api.storage.pickFolder.mockResolvedValueOnce({ path: '/shared/dir' });
    api.storage.setLocation.mockResolvedValueOnce({
      ok: false,
      reason: 'not-writable',
      requiresRestart: true,
    });
    render(<SettingsStorage />);
    await userEvent.click(await screen.findByTestId('settings-storage-toggle'));
    await userEvent.click(screen.getByTestId('settings-storage-pick-folder'));
    await userEvent.click(screen.getByTestId('settings-storage-save'));
    const alert = await screen.findByTestId('settings-storage-error');
    expect(alert).toHaveTextContent(/not writable/i);
  });

  it('Reset button clears the local toggle + path draft (without writing)', async () => {
    const api = getApi();
    render(<SettingsStorage />);
    const toggle = await screen.findByTestId('settings-storage-toggle');
    await userEvent.click(toggle);
    expect(toggle).toBeChecked();
    await userEvent.click(screen.getByTestId('settings-storage-reset'));
    expect(toggle).not.toBeChecked();
    // setLocation was NEVER called — Reset is local-only.
    expect(api.storage.setLocation).not.toHaveBeenCalled();
  });
});