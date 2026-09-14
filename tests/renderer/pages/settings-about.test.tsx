// @vitest-environment happy-dom
// Quick task 260913-64l — coverage for the Settings → About page.
//
// The page has two visual modes:
//   1. Default (up-to-date): only the app-info card renders + the
//      "You're on the latest version" footer line.
//   2. Update available / downloaded: the conditional update card
//      appears ABOVE the app-info card with Download/Restart CTAs.
//
// Validates:
//   1. Default render shows the app-info card + version footer.
//   2. The update card is hidden when state.available/downloaded/error
//      are all false (the mock default).
//   3. When getState resolves to `available: true`, the update card
//      mounts with the Download button + Check button.
//   4. Clicking Download triggers the IPC and the progress label renders.
//   5. When getState resolves to `downloaded: true`, the Restart button
//      renders instead of Download.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getApi } from '../setup';
import { setRoute } from '@/store/route';
import SettingsAbout from '@/pages/SettingsAbout';

beforeEach(() => {
  setRoute({ name: 'settings-about' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Settings → About (auto-update card)', () => {
  it('default render shows the app-info card + up-to-date footer', async () => {
    render(<SettingsAbout />);
    expect(await screen.findByTestId('settings-about-card')).toBeInTheDocument();
    // Default mock state has available=false / downloaded=false / error=null
    // → update card is gated OFF.
    expect(screen.queryByTestId('settings-about-update-card')).toBeNull();
    // Up-to-date footer is shown when no update is queued.
    expect(await screen.findByTestId('settings-about-up-to-date')).toBeInTheDocument();
  });

  it('update-available state surfaces the Download button + Check button', async () => {
    const api = getApi();
    api.app.update.getState.mockResolvedValue({
      available: true,
      downloaded: false,
      progress: null,
      latestVersion: '0.2.0',
      currentVersion: '0.1.0',
      error: null,
    });
    render(<SettingsAbout />);
    expect(await screen.findByTestId('settings-about-update-card')).toBeInTheDocument();
    expect(screen.getByTestId('settings-about-update-download')).toBeInTheDocument();
    expect(screen.getByTestId('settings-about-update-check')).toBeInTheDocument();
    // Restart button is gated on `downloaded` so it should not exist yet.
    expect(screen.queryByTestId('settings-about-update-install')).toBeNull();
    await waitFor(() => expect(api.app.update.getState).toHaveBeenCalled());
  });

  it('clicking Download fires the IPC', async () => {
    const api = getApi();
    api.app.update.getState.mockResolvedValue({
      available: true,
      downloaded: false,
      progress: null,
      latestVersion: '0.2.0',
      currentVersion: '0.1.0',
      error: null,
    });
    api.app.update.download.mockResolvedValue(undefined);
    render(<SettingsAbout />);
    await userEvent.click(await screen.findByTestId('settings-about-update-download'));
    await waitFor(() => expect(api.app.update.download).toHaveBeenCalledTimes(1));
  });

  it('progress label renders when state.progress is populated', async () => {
    const api = getApi();
    // Default for the post-mount polls: show a 42% download in progress.
    api.app.update.getState.mockResolvedValue({
      available: true,
      downloaded: false,
      progress: { percent: 42, transferred: 42 * 1024 * 1024, total: 100 * 1024 * 1024 },
      latestVersion: '0.2.0',
      currentVersion: '0.1.0',
      error: null,
    });
    // Mount-time poll returns no progress (so the Download button is
    // not disabled) — the Once mock is consumed first; subsequent calls
    // fall through to the default with progress.
    api.app.update.getState.mockResolvedValueOnce({
      available: true,
      downloaded: false,
      progress: null,
      latestVersion: '0.2.0',
      currentVersion: '0.1.0',
      error: null,
    });
    render(<SettingsAbout />);
    // After the mount + initial render, the next 30s poll (or manual
    // check() click) surfaces the progress label.
    await userEvent.click(await screen.findByTestId('settings-about-update-check'));
    expect(await screen.findByTestId('settings-about-update-progress')).toHaveTextContent('42%');
  });

  it('update-downloaded state surfaces the Restart button (no Download button)', async () => {
    const api = getApi();
    api.app.update.getState.mockResolvedValue({
      available: true,
      downloaded: true,
      progress: null,
      latestVersion: '0.2.0',
      currentVersion: '0.1.0',
      error: null,
    });
    render(<SettingsAbout />);
    expect(await screen.findByTestId('settings-about-update-card')).toBeInTheDocument();
    expect(await screen.findByTestId('settings-about-update-install')).toBeInTheDocument();
    expect(screen.queryByTestId('settings-about-update-download')).toBeNull();
  });

  // Quick task 260913-rp5 — the always-visible "Check for updates"
  // button lets the user manually trigger a check on demand. The
  // conditional button inside the update card only mounts after the
  // initial boot-time auto-check surfaces something; this one is in
  // the always-shown app-info card so the user can poke the system
  // any time.
  it('always-visible manual "Check for updates" button fires the IPC even when no update is available', async () => {
    const api = getApi();
    api.app.update.check.mockResolvedValue(undefined);
    render(<SettingsAbout />);
    const checkBtn = await screen.findByTestId('settings-about-check-update');
    expect(checkBtn).toBeInTheDocument();
    await userEvent.click(checkBtn);
    await waitFor(() => expect(api.app.update.check).toHaveBeenCalledTimes(1));
  });
});
