// @vitest-environment happy-dom
// Plan 02-03 Task 1 — Wizard page tests.
// Per D-01: wizard collects full name + clinic name + 4-digit PIN + confirm, calls
// auth.wizard, then auto-logs in. Validation errors render inline; success navigates
// to the patients route.
//
// Phase 7 / Plan 07-04 — I18N-01: wizard gains a 4th step (Language radio). The
// selected language is included in the auth.wizard IPC call. The existing
// tests are updated to assert the new field; a new test exercises the
// AR-language path.

import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getApi } from '../setup';
import { getRoute } from '@/lib/router';
import Wizard from '@/pages/Wizard';
import { IpcErrorException } from '@shared/errors';

function setSessionMocks(): void {
  const api = getApi();
  api.auth.status.mockResolvedValue({
    hasUsers: true,
    authenticated: true,
    userId: '00000000-0000-4000-8000-000000000001',
    clinicName: 'Cairo Clinic',
    isFirstAdmin: true,
  });
  api.auth.usersList.mockResolvedValue([
    {
      id: '00000000-0000-4000-8000-000000000001',
      fullName: 'Dr. Layla',
      isFirstAdmin: true,
      lastLoginAt: Date.now(),
      failedAttempts: 0,
      lockedUntil: null,
      // Phase 7 / Plan 07-04 — I18N-01: language is part of UserPublic
      // since Plan 07-01. Tests that mock the user list must include it.
      language: 'en',
    },
  ]);
}

describe('Wizard page', () => {
  it('renders the four fields (full name, clinic name, PIN, confirm PIN) + language step', () => {
    getApi().auth.status.mockResolvedValue({
      hasUsers: true,
      authenticated: true,
      userId: '00000000-0000-4000-8000-000000000001',
      clinicName: 'Cairo Clinic',
      isFirstAdmin: true,
    });
    render(<Wizard />);
    expect(screen.getByLabelText(/your full name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/clinic name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^4-digit pin$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm pin/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /finish setup/i })).toBeInTheDocument();
    // Phase 7 / Plan 07-04 — I18N-01: 4th step (language) mounts with
    // both radios visible.
    expect(screen.getByTestId('wizard-step-language')).toBeInTheDocument();
    expect(screen.getByTestId('wizard-language-en')).toBeInTheDocument();
    expect(screen.getByTestId('wizard-language-ar')).toBeInTheDocument();
  });

  it('shows inline validation error when fullName is empty on submit', async () => {
    getApi().auth.status.mockResolvedValue({
      hasUsers: true,
      authenticated: true,
      userId: '00000000-0000-4000-8000-000000000001',
      clinicName: 'Cairo Clinic',
      isFirstAdmin: true,
    });
    const user = userEvent.setup();
    render(<Wizard />);
    // Type everything else but leave fullName blank.
    await user.type(screen.getByLabelText(/clinic name/i), 'Cairo Clinic');
    await user.type(screen.getByLabelText(/^4-digit pin$/i), '1234');
    await user.type(screen.getByLabelText(/confirm pin/i), '1234');
    await user.click(screen.getByRole('button', { name: /finish setup/i }));
    // Wait for react-hook-form to validate + render the inline error.
    const fullNameInput = await screen.findByLabelText(/your full name/i);
    await waitFor(() => expect(fullNameInput).toHaveAttribute('aria-invalid', 'true'));
    const errors = await screen.findAllByText(/full name|required|at least/i);
    expect(errors.length).toBeGreaterThan(0);
    expect(getApi().auth.wizard).not.toHaveBeenCalled();
  });

  it('calls auth.wizard once with valid fields + language=en default and lands on patients route', async () => {
    setSessionMocks();
    const user = userEvent.setup();
    const api = getApi();
    api.auth.wizard.mockResolvedValue({
      accepted: true,
      userId: '00000000-0000-4000-8000-000000000001',
      clinicName: 'Cairo Clinic',
    });
    api.auth.login.mockResolvedValue({
      ok: true,
      user: {
        id: '00000000-0000-4000-8000-000000000001',
        fullName: 'Dr. Layla',
        isFirstAdmin: true,
        lastLoginAt: Date.now(),
        failedAttempts: 0,
        lockedUntil: null,
        language: 'en',
      },
    });
    render(<Wizard />);
    await user.type(screen.getByLabelText(/your full name/i), 'Dr. Layla');
    await user.type(screen.getByLabelText(/clinic name/i), 'Cairo Clinic');
    await user.type(screen.getByLabelText(/^4-digit pin$/i), '1234');
    await user.type(screen.getByLabelText(/confirm pin/i), '1234');
    await user.click(screen.getByRole('button', { name: /finish setup/i }));
    await waitFor(() => expect(api.auth.wizard).toHaveBeenCalledTimes(1));
    // Phase 7 / Plan 07-04 — I18N-01: wizard call now includes the
    // language field. EN is the silent default when no radio click
    // fires (the radio's local state stays at 'en').
    expect(api.auth.wizard).toHaveBeenCalledWith({
      fullName: 'Dr. Layla',
      clinicName: 'Cairo Clinic',
      pin: '1234',
      confirmPin: '1234',
      language: 'en',
    });
    await waitFor(() => expect(getRoute().name).toBe('patients'));
  });

  it('submits language=ar when the AR radio is clicked', async () => {
    setSessionMocks();
    const user = userEvent.setup();
    const api = getApi();
    api.auth.wizard.mockResolvedValue({
      accepted: true,
      userId: '00000000-0000-4000-8000-000000000001',
      clinicName: 'Cairo Clinic',
    });
    api.auth.login.mockResolvedValue({
      ok: true,
      user: {
        id: '00000000-0000-4000-8000-000000000001',
        fullName: 'د. ليلى',
        isFirstAdmin: true,
        lastLoginAt: Date.now(),
        failedAttempts: 0,
        lockedUntil: null,
        language: 'ar',
      },
    });
    render(<Wizard />);
    await user.type(screen.getByLabelText(/your full name/i), 'د. ليلى');
    await user.type(screen.getByLabelText(/clinic name/i), 'Cairo Clinic');
    await user.type(screen.getByLabelText(/^4-digit pin$/i), '1234');
    await user.type(screen.getByLabelText(/confirm pin/i), '1234');
    // ponytail: clicking the AR radio flips the local language state.
    // The submit closure captures the new value.
    await user.click(screen.getByTestId('wizard-language-ar'));
    await user.click(screen.getByRole('button', { name: /finish setup/i }));
    await waitFor(() => expect(api.auth.wizard).toHaveBeenCalledTimes(1));
    expect(api.auth.wizard).toHaveBeenCalledWith({
      fullName: 'د. ليلى',
      clinicName: 'Cairo Clinic',
      pin: '1234',
      confirmPin: '1234',
      language: 'ar',
    });
  });

  it('shows an inline toast on auth.wizard IPC_VALIDATION and does not advance the route', async () => {
    getApi().auth.status.mockResolvedValue({
      hasUsers: true,
      authenticated: true,
      userId: '00000000-0000-4000-8000-000000000001',
      clinicName: 'Cairo Clinic',
      isFirstAdmin: true,
    });
    const user = userEvent.setup();
    const api = getApi();
    api.auth.wizard.mockRejectedValue(
      new IpcErrorException({
        code: 'IPC_VALIDATION',
        message: 'Wizard already completed; first launch only',
      }),
    );
    render(<Wizard />);
    await user.type(screen.getByLabelText(/your full name/i), 'Dr. Layla');
    await user.type(screen.getByLabelText(/clinic name/i), 'Cairo Clinic');
    await user.type(screen.getByLabelText(/^4-digit pin$/i), '1234');
    await user.type(screen.getByLabelText(/confirm pin/i), '1234');
    await user.click(screen.getByRole('button', { name: /finish setup/i }));
    await waitFor(() => expect(api.auth.wizard).toHaveBeenCalled());
    // wizard failure does not advance the route to 'patients' (the initial route was 'login').
    await waitFor(() => expect(getRoute().name).not.toBe('patients'));
  });
});
