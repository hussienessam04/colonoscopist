// @vitest-environment happy-dom
// Quick task 260913-rp5 — regression test for the "stuck gated-empty-state
// after activation" bug.
//
// Per the plan <behavior> block:
//   1. SettingsCapture mounts while the IPC gate is rejecting
//      (`getDefaultDevice` returns `{ok:false, code:IPC_LICENSE_INVALID}`)
//   2. The page renders the EmptyStateCard with the "License required
//      — open Settings → License to activate." copy
//   3. We dispatch `colonoscopist:license-changed` on window (the same
//      event the License sub-page dispatches after a successful
//      activation) and swap the mock to a successful return
//   4. Assert: the EmptyStateCard disappears and the device dropdown
//      populates (proving the page re-fetched and cleared `gated`)
//
// This is the canonical reproduction of the user's bug: they
// activated via the License sub-page, navigated back to capture, and
// were still blocked by the gated-empty-state because the renderer's
// hydration useEffect had already settled.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import '../setup';
import { getApi } from '../setup';
import { setRoute } from '@/lib/router';
import { session } from '@/store/session';
import SettingsCapture from '@/pages/SettingsCapture';
import { LICENSE_CHANGED_EVENT } from '@/hooks/useLicenseStatus';
import type { UserPublic } from '@shared/ipc-contract';

const ADMIN_USER: UserPublic = {
  id: '00000000-0000-4000-8000-000000000099',
  fullName: 'Dr. Layla',
  isFirstAdmin: true,
  lastLoginAt: Date.now(),
  failedAttempts: 0,
  lockedUntil: null,
  language: 'en',
};

function setSession(): void {
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

beforeEach(() => {
  setRoute({ name: 'settings-capture' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Quick task 260913-rp5 — SettingsCapture recovers from gated-empty-state on license activation', () => {
  it('renders EmptyStateCard while the IPC gate rejects, then clears it after LICENSE_CHANGED_EVENT fires', async () => {
    setSession();
    const api = getApi();
    // Mount: gate rejects — capture.listDevices returns {ok:false}.
    api.capture.listDevices.mockResolvedValue({
      ok: false,
      code: 'IPC_LICENSE_INVALID',
    });
    api.capture.getDefaultDevice.mockResolvedValue({
      ok: false,
      code: 'IPC_LICENSE_INVALID',
    });

    render(<SettingsCapture />);

    // Page is mounted + hydration has run with the gated-empty-state
    // showing. The plan text the user reports verbatim is
    // "License required — open Settings → License to activate.".
    await waitFor(() => {
      expect(screen.getByTestId('gated-empty-state')).toBeInTheDocument();
    });
    expect(
      screen.getByText(/License required.*open Settings.*License to activate/i),
    ).toBeInTheDocument();

    // Flip the mocks to success (mirrors what the main process does
    // once the cache is invalidated and the sidecar is on disk).
    api.capture.listDevices.mockResolvedValue([
      {
        deviceId: 'EasyCap USB Video',
        rawName: 'EasyCap USB Video',
        index: 0,
        type: 'dshow',
      },
    ]);
    // Return a real device name so hydrate() takes the success branch
    // (sets gated=false, populates savedDeviceId). null would be
    // ambiguous with the gate-rejection shape (safeInvoke yields null
    // for both) and would re-flip gated=true.
    api.capture.getDefaultDevice.mockResolvedValue('EasyCap USB Video');
    api.capture.getPreset.mockResolvedValue({ preset: 'hd' });

    // Fire the same event the License sub-page dispatches on success.
    await act(async () => {
      window.dispatchEvent(new Event(LICENSE_CHANGED_EVENT));
      // Allow microtasks for the re-fetch promise to settle.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // After activation: the EmptyStateCard must disappear. The
    // hydration callback runs again, the gate passes, and `gated` is
    // cleared in the success branch of hydrate().
    await waitFor(() => {
      expect(screen.queryByTestId('gated-empty-state')).not.toBeInTheDocument();
    });
    // The device dropdown is now populated with the EasyCap entry.
    await waitFor(() => {
      expect(api.capture.listDevices).toHaveBeenCalledTimes(2);
    });
    void session;
  });

  // Follow-up: licensed user with NO USB device plugged in (the
  // user's actual situation). Previously the page misrendered the
  // "License required — open Settings → License to activate." card
  // because safeInvoke collapsed BOTH gate rejection AND legitimate
  // null into a single null value. With isGateRejected, hydrate()
  // only flips gated=true on actual `{ok:false}` shapes — a
  // null = no saved device renders the "no device saved yet" hint
  // instead of the gated card.
  it('licensed user with no USB device plugged in renders the no-device hint, NOT the EmptyStateCard', async () => {
    setSession();
    const api = getApi();
    // Licensed clinic, no USB device. listDevices returns an empty
    // array (handler always returns an array, even empty). getDefaultDevice
    // returns null (legitimate — no saved device).
    api.capture.listDevices.mockResolvedValue([]);
    api.capture.getDefaultDevice.mockResolvedValue(null);

    render(<SettingsCapture />);

    // Hydration settles; gated stays false (no gate rejection).
    await waitFor(() => {
      expect(api.capture.getDefaultDevice).toHaveBeenCalled();
    });
    // The EmptyStateCard MUST NOT render.
    expect(screen.queryByTestId('gated-empty-state')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/License required.*open Settings.*License to activate/i),
    ).not.toBeInTheDocument();
    // The no-device hint DOES render.
    await waitFor(() => {
      expect(
        screen.getByText(/no device saved yet/i),
      ).toBeInTheDocument();
    });
    void session;
  });
});
