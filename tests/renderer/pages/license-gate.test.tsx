// @vitest-environment happy-dom
// LicenseGate modal tests — Phase 8 / Plan 08-06 (LIC-03 + D-05).
//
// Per the plan <behavior> block: 6 cases cover the LicenseGate modal
// surface (Plan 05 shipped the component; this plan guards it):
//   1. state='unactivated' → modal renders + Activate now button +
//      Continue in trial button.
//   2. state='expired' → modal renders + Activate now button (NO
//      Continue in trial button — grayed out per D-05).
//   3. state='trial' → modal does NOT render (sidebar badge only).
//   4. state='licensed' → modal does NOT render.
//   5. "Continue in trial" click → sessionStorage flag set + modal
//      disappears.
//   6. "Activate now" click → sessionStorage flag set + route
//      navigates to {name:'license'}.
//
// The dialog uses radix-ui under the hood; happy-dom does not implement
// the full focus-trap portal so the `data-testid="license-gate-modal"`
// surfaces the body content directly when `Dialog open=true`.

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '../setup';
import { getApi } from '../setup';
import { setRoute, getRoute } from '@/lib/router';
import { LicenseGate } from '@/components/LicenseGate';
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

function licenseStatusFor(state: LicenseStatus['state']): LicenseStatus {
  return {
    state,
    vendorId: state === 'licensed' ? 'test-vendor' : null,
    licensedAt: state === 'licensed' ? 1700000000000 : null,
    expiresAt: null,
    trialStartedAt: state === 'trial' ? Date.now() : null,
    trialDaysRemaining: state === 'trial' ? 14 : 0,
    machineId: 'a'.repeat(64),
  };
}

beforeEach(() => {
  // The LicenseGate reads the sessionStorage flag at module-import
  // time; reset between tests so a dismissed flag doesn't bleed across.
  sessionStorage.clear();
  setRoute({ name: 'patients' });
});

async function renderGate(status: LicenseStatus): Promise<void> {
  setSession();
  const api = getApi();
  api.license.status.mockResolvedValue(status);
  // The gate wraps the route children — pass a sentinel element so
  // we can assert the modal renders alongside (or NOT renders) the
  // children without depending on a specific route's page body.
  render(
    <LicenseGate>
      <div data-testid="route-children">route</div>
    </LicenseGate>,
  );
  await waitFor(() => expect(api.license.status).toHaveBeenCalled());
}

describe('LicenseGate modal (LIC-03 + D-05)', () => {
  it("state='unactivated' renders the modal with both Activate now and Continue in trial buttons", async () => {
    await renderGate(licenseStatusFor('unactivated'));
    const modal = await screen.findByTestId('license-gate-modal');
    expect(modal).toBeInTheDocument();
    // Both buttons per D-05.
    expect(screen.getByTestId('license-gate-activate-now')).toBeInTheDocument();
    expect(screen.getByTestId('license-gate-continue-trial')).toBeInTheDocument();
    // Body copy = "unactivated" variant.
    expect(modal.textContent).toMatch(/welcome|continue|activate|trial|colonoscopist/i);
  });

  it("state='expired' renders the modal with Activate now button but NO Continue in trial button", async () => {
    await renderGate(licenseStatusFor('expired'));
    const modal = await screen.findByTestId('license-gate-modal');
    expect(modal).toBeInTheDocument();
    expect(screen.getByTestId('license-gate-activate-now')).toBeInTheDocument();
    // Continue in trial is omitted post-expiry (D-05 verbatim).
    expect(screen.queryByTestId('license-gate-continue-trial')).not.toBeInTheDocument();
    // Body copy = "expired" variant.
    expect(modal.textContent).toMatch(/ended|support|expired|email/i);
  });

  it("state='trial' does NOT render the modal (sidebar badge only)", async () => {
    await renderGate(licenseStatusFor('trial'));
    // Children should be visible without the modal in the way.
    expect(screen.getByTestId('route-children')).toBeInTheDocument();
    expect(screen.queryByTestId('license-gate-modal')).not.toBeInTheDocument();
    expect(screen.queryByTestId('license-gate-activate-now')).not.toBeInTheDocument();
  });

  it("state='licensed' does NOT render the modal", async () => {
    await renderGate(licenseStatusFor('licensed'));
    expect(screen.getByTestId('route-children')).toBeInTheDocument();
    expect(screen.queryByTestId('license-gate-modal')).not.toBeInTheDocument();
  });

  // Phase 8 / Plan 09 — G-08-3 regression guard: the wizard IS the
  // path to start the trial, so gating it with the activation modal
  // is contradictory. LicenseGate must exempt `wizard` and `login`
  // (the two first-launch entry points) from the showModal predicate.
  // The beforeEach defaults the route to 'patients' — these tests
  // override to 'wizard' / 'login' before renderGate() runs.
  it("wizard route does NOT render the modal even when state='unactivated' (G-08-3 regression guard)", async () => {
    setRoute({ name: 'wizard' });
    await renderGate(licenseStatusFor('unactivated'));
    // Children render cleanly — the wizard form is reachable.
    expect(screen.getByTestId('route-children')).toBeInTheDocument();
    // No modal, no Activate button — wizard never sees the gate.
    expect(screen.queryByTestId('license-gate-modal')).not.toBeInTheDocument();
    expect(screen.queryByTestId('license-gate-activate-now')).not.toBeInTheDocument();
  });

  it("login route does NOT render the modal even when state='expired' (G-08-3 regression guard)", async () => {
    setRoute({ name: 'login' });
    await renderGate(licenseStatusFor('expired'));
    // First-time PIN setup screen stays reachable even after expiry —
    // the doctor must still be able to authenticate into the app to
    // reach the License sub-page and renew.
    expect(screen.getByTestId('route-children')).toBeInTheDocument();
    expect(screen.queryByTestId('license-gate-modal')).not.toBeInTheDocument();
    expect(screen.queryByTestId('license-gate-activate-now')).not.toBeInTheDocument();
  });

  it("'Continue in trial' click sets sessionStorage flag + modal disappears", async () => {
    await renderGate(licenseStatusFor('unactivated'));
    const user = userEvent.setup();
    const continueBtn = await screen.findByTestId('license-gate-continue-trial');
    await user.click(continueBtn);
    // sessionStorage flag is set so the modal stays dismissed for the
    // rest of the session (per CONTEXT agent discretion).
    expect(sessionStorage.getItem('license.modal.dismissed')).toBe('1');
    // The modal disappears (no license-gate-modal in the DOM).
    await waitFor(() =>
      expect(screen.queryByTestId('license-gate-modal')).not.toBeInTheDocument(),
    );
  });

  it("'Activate now' click sets sessionStorage flag + navigates to {name:'license'} route", async () => {
    await renderGate(licenseStatusFor('unactivated'));
    const user = userEvent.setup();
    const activateBtn = await screen.findByTestId('license-gate-activate-now');
    await user.click(activateBtn);
    // sessionStorage flag set so the modal does not immediately
    // re-show on the License sub-page mount.
    expect(sessionStorage.getItem('license.modal.dismissed')).toBe('1');
    // Route is now the License sub-page.
    await waitFor(() => expect(getRoute().name).toBe('license'));
  });
});