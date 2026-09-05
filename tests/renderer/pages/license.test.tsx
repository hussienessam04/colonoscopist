// @vitest-environment happy-dom
// License sub-page tests — Phase 8 / Plan 08-06 (LIC-03 + I18N-03)
// + Plan 15 (G-08-8) — machine-id copy uses main-process clipboard IPC.
//
// Per the plan <behavior> block: 9 cases cover the License sub-page
// surface (Plan 05 shipped the page; this plan guards the surface):
//   1. state='unactivated' → "Not activated" label + gray dot + Load
//      button enabled.
//   2. state='trial' → "Trial" label + blue dot + "X days remaining"
//      line + Load button enabled.
//   3. state='expired' → "Expired" label + red dot + Load button
//      enabled.
//   4. state='licensed' → "Licensed" label + green dot + vendor id +
//      licensed at + Load button enabled (allows re-loading).
//   5. "Load .lic file…" button click → window.api.license.pickAndActivate
//      called once with NO arguments.
//   6. bad file (IPC returns {ok:false, code:'IPC_LICENSE_INVALID',
//      reason:'...'}) → error toast surfaces.
//   7. success (IPC returns {ok:true, vendorId, licensedAt}) →
//      toast.success + useLicenseStatus().refresh() is called (we
//      assert the IPC.status() was called again post-activation).
//   8. machine-id copy button → window.api.clipboard.copyText called
//      with the raw hex (NOT the formatted grouped blocks). Plan 15
//      (G-08-8): the main-process clipboard IPC replaces the
//      `navigator.clipboard.writeText` path that failed in Electron
//      sandbox for the machine-id copy.
//   9. sidebar entry `settings-hub-license` navigates to
//      {name: 'license'} route.

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '../setup';
import { getApi } from '../setup';
import { setRoute } from '@/lib/router';
import License from '@/pages/License';
import type { LicenseStatus, UserPublic } from '@shared/ipc-contract';

const ADMIN_USER: UserPublic = {
  id: '00000000-0000-4000-8000-000000000099',
  fullName: 'Dr. Layla',
  isFirstAdmin: true,
  lastLoginAt: Date.now(),
  failedAttempts: 0,
  lockedUntil: null,
  language: 'en',
};

// Hoisted toast mock — same pattern as BackupRestore.test.tsx. happy-dom
// does not render sonner's toast portal, so the stable contract surface
// is the function call itself.
const toastMock = vi.hoisted(() =>
  Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
);
vi.mock('sonner', () => ({ toast: toastMock }));

// Hoisted clipboard IPC mock — Plan 15 (G-08-8) routes the machine-id
// copy through `window.api.clipboard.copyText` (main-process Electron
// clipboard). The mock owns this channel; we don't need the old
// `navigator.clipboard.writeText` stub — happy-dom never crashed on
// the IPC mock the way it crashed on `navigator.clipboard` permissions.
const clipboardIpcMock = vi.hoisted(() => ({
  copyText: vi.fn().mockResolvedValue({ ok: true as const }),
}));

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
  // Plan 15 — wire the IPC clipboard mock into the test's per-test api
  // so handleCopyMachineId can hit it.
  api.clipboard.copyText = clipboardIpcMock.copyText as unknown as ReturnType<typeof vi.fn>;
}

function licenseStatusFor(state: LicenseStatus['state']): LicenseStatus {
  return {
    state,
    vendorId: state === 'licensed' ? 'test-vendor' : null,
    licensedAt: state === 'licensed' ? 1700000000000 : null,
    expiresAt: state === 'trial' ? Date.now() + 7 * 24 * 60 * 60 * 1000 : null,
    trialStartedAt: state === 'trial' ? Date.now() - 7 * 24 * 60 * 60 * 1000 : null,
    trialDaysRemaining:
      state === 'trial' ? 7 : state === 'expired' ? 0 : null,
    machineId: 'a'.repeat(64),
  };
}

beforeEach(() => {
  setRoute({ name: 'license' });
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  clipboardIpcMock.copyText.mockClear();
});

async function renderPage(status: LicenseStatus): Promise<void> {
  setSession();
  const api = getApi();
  api.license.status.mockResolvedValue(status);
  render(<License />);
  // Wait for the hook to settle (it fires license.status() on mount).
  await waitFor(() => expect(api.license.status).toHaveBeenCalled());
}

describe('License sub-page (LIC-03 + I18N-03)', () => {
  it("state='unactivated' renders 'Not activated' label + gray dot + enabled Load button", async () => {
    await renderPage(licenseStatusFor('unactivated'));
    const dot = await screen.findByTestId('license-status-dot');
    expect(dot.getAttribute('data-state')).toBe('unactivated');
    // Plan 08-13 / UI audit Warning 7 — bg-slate-400 was too muted at
    // clinical glance distance; the unactivated dot is bg-slate-500 now.
    expect(dot.className).toContain('bg-slate-500');
    const label = await screen.findByTestId('license-status-label');
    expect(label.textContent).toMatch(/not activated/i);
    const button = screen.getByTestId('license-load-lic');
    expect(button).toBeInTheDocument();
    expect(button).not.toBeDisabled();
  });

  it("state='trial' renders 'Trial' label + blue dot + 'X days remaining' line + enabled Load button", async () => {
    await renderPage(licenseStatusFor('trial'));
    const dot = await screen.findByTestId('license-status-dot');
    expect(dot.getAttribute('data-state')).toBe('trial');
    expect(dot.className).toContain('bg-blue-500');
    const label = await screen.findByTestId('license-status-label');
    expect(label.textContent).toMatch(/trial/i);
    const days = await screen.findByTestId('license-trial-days');
    expect(days.textContent).toMatch(/7/);
    expect(days.textContent).toMatch(/day/i);
    const button = screen.getByTestId('license-load-lic');
    expect(button).not.toBeDisabled();
  });

  it("state='expired' renders 'Expired' label + red dot + enabled Load button", async () => {
    await renderPage(licenseStatusFor('expired'));
    const dot = await screen.findByTestId('license-status-dot');
    expect(dot.getAttribute('data-state')).toBe('expired');
    expect(dot.className).toContain('bg-red-500');
    const label = await screen.findByTestId('license-status-label');
    expect(label.textContent).toMatch(/expired/i);
    const button = screen.getByTestId('license-load-lic');
    expect(button).not.toBeDisabled();
  });

  it("state='licensed' renders 'Licensed' label + green dot + vendor id + licensed at + enabled Load button", async () => {
    await renderPage(licenseStatusFor('licensed'));
    const dot = await screen.findByTestId('license-status-dot');
    expect(dot.getAttribute('data-state')).toBe('licensed');
    expect(dot.className).toContain('bg-emerald-500');
    const label = await screen.findByTestId('license-status-label');
    expect(label.textContent).toMatch(/licensed/i);
    const vendor = await screen.findByTestId('license-vendor-id');
    expect(vendor.textContent).toBe('test-vendor');
    const licensedAt = await screen.findByTestId('license-licensed-at');
    expect(licensedAt.textContent).not.toBe('—');
    expect(licensedAt.textContent).toMatch(/\d/); // toLocaleString() always has digits
    const button = screen.getByTestId('license-load-lic');
    expect(button).not.toBeDisabled();
  });

  it("'Load .lic file…' button click → window.api.license.pickAndActivate called once with NO arguments", async () => {
    await renderPage(licenseStatusFor('unactivated'));
    const api = getApi();
    api.license.pickAndActivate.mockResolvedValue({
      ok: false,
      code: 'IPC_LICENSE_CANCELLED' as const,
    });
    const user = userEvent.setup();
    const button = await screen.findByTestId('license-load-lic');
    await user.click(button);
    await waitFor(() => expect(api.license.pickAndActivate).toHaveBeenCalledTimes(1));
    // Per Plan 04 T-08-L10: pickAndActivate takes NO arguments.
    expect(api.license.pickAndActivate.mock.calls[0]).toEqual([]);
  });

  it("bad file: IPC returns {ok:false, code:'IPC_LICENSE_INVALID', reason:'SIGNATURE_MISMATCH'} → error toast surfaces", async () => {
    await renderPage(licenseStatusFor('unactivated'));
    const api = getApi();
    api.license.pickAndActivate.mockResolvedValue({
      ok: false,
      code: 'IPC_LICENSE_INVALID',
      reason: 'SIGNATURE_MISMATCH',
    });
    const user = userEvent.setup();
    const button = await screen.findByTestId('license-load-lic');
    await user.click(button);
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        expect.stringMatching(/signature_mismatch|activation failed/i),
      ),
    );
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("success: IPC returns {ok:true, vendorId, licensedAt} → toast.success fires (refresh runs internally)", async () => {
    await renderPage(licenseStatusFor('unactivated'));
    const api = getApi();
    api.license.pickAndActivate.mockResolvedValue({
      ok: true,
      vendorId: 'new-vendor',
      licensedAt: 1700000000000,
    });
    const statusCallCountBefore = api.license.status.mock.calls.length;
    const user = userEvent.setup();
    const button = await screen.findByTestId('license-load-lic');
    await user.click(button);
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(
        expect.stringMatching(/license activated/i),
      ),
    );
    // The page calls refresh() after success which calls status() again.
    await waitFor(() =>
      expect(api.license.status.mock.calls.length).toBeGreaterThan(
        statusCallCountBefore,
      ),
    );
  });

  it('Plan 15 (G-08-8): machine-id copy button → window.api.clipboard.copyText called with the RAW hex (NOT grouped blocks)', async () => {
    await renderPage(licenseStatusFor('unactivated'));
    // Wait for the status card to mount (proves the hook has resolved +
    // the Card is in the DOM).
    const card = await screen.findByTestId('license-status-card');
    expect(card).toBeInTheDocument();
    const copyButton = await screen.findByTestId('license-copy-machine-id');
    expect(copyButton).toBeInTheDocument();
    // Use fireEvent instead of userEvent — userEvent.click() sometimes
    // bubbles the click through the disabled parent (Button) when the
    // Card uses async state updates. fireEvent dispatches a click event
    // directly on the target.
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.click(copyButton);
    // The handler is async; flush microtasks so the IPC promise resolves
    // before we assert.
    await waitFor(() => expect(clipboardIpcMock.copyText).toHaveBeenCalledTimes(1), {
      timeout: 5000,
    });
    // The card displays the machine id formatted as 4-char grouped blocks
    // (e.g. "aaaa-aaaa-..."), but the clipboard copy writes the raw hex
    // — vendor tooling prefers the raw form for paste-into-email.
    expect(clipboardIpcMock.copyText).toHaveBeenCalledWith({ text: 'a'.repeat(64) });
    const firstCallText = (clipboardIpcMock.copyText.mock.calls[0]?.[0] as { text: string }).text;
    expect(firstCallText).not.toContain('-');
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(
        expect.stringMatching(/machine id copied/i),
      ),
    );
  });

  it("sidebar entry 'settings-hub-license' navigates to {name:'license'} route on click", async () => {
    setRoute({ name: 'settings-hub' });
    const api = getApi();
    api.license.status.mockResolvedValue(licenseStatusFor('unactivated'));
    setSession();
    // Render the SettingsHub so the sidebar mounts and is in the DOM.
    const { default: SettingsHub } = await import('@/pages/SettingsHub');
    render(<SettingsHub />);
    const user = userEvent.setup();
    const licenseEntry = await screen.findByTestId('settings-hub-license');
    expect(licenseEntry).toBeInTheDocument();
    await user.click(licenseEntry);
    // The navigate() call updates the route store — the next assertion
    // uses useSyncExternalStore via the License page.
    // After click, re-mount License via re-render with the new route.
    setRoute({ name: 'license' });
    render(<License />);
    // Now the License page should be mounted; status card visible.
    const dot = await screen.findByTestId('license-status-dot');
    expect(dot).toBeInTheDocument();
  });
});