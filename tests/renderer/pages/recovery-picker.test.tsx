// @vitest-environment happy-dom
// Plan 02-03 Task 2 — Recovery file picker tests.
// Per D-04 + Fix 7: email-vendor + select-file + deferred-verify toast.

import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from '@/components/ui/sonner';
import { getApi } from '../setup';
import RecoveryFilePicker from '@/pages/RecoveryFilePicker';

describe('RecoveryFilePicker (D-04 + Fix 7)', () => {
  it('opens the dialog when "Forgot admin PIN?" is clicked', async () => {
    const api = getApi();
    api.auth.recoveryRequest.mockResolvedValue({
      accepted: true,
      verificationDeferred: true,
      machineFingerprint: 'fp',
      mailto: 'mailto:test',
    });
    const user = userEvent.setup();
    render(
      <>
        <RecoveryFilePicker />
        <Toaster />
      </>,
    );
    await user.click(screen.getByRole('button', { name: /forgot admin pin\?/i }));
    expect(await screen.findByText(/recover admin pin/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /email vendor/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /select recovery file/i })).toBeInTheDocument();
  });

  it('clicking "Email vendor" calls auth.recoveryRequest once and surfaces a queued toast', async () => {
    const api = getApi();
    api.auth.recoveryRequest.mockResolvedValue({
      accepted: true,
      verificationDeferred: true,
      machineFingerprint: 'fp',
      mailto: 'mailto:test',
    });
    const user = userEvent.setup();
    render(
      <>
        <RecoveryFilePicker />
        <Toaster />
      </>,
    );
    await user.click(screen.getByRole('button', { name: /forgot admin pin\?/i }));
    await user.click(screen.getByRole('button', { name: /^email vendor$/i }));
    await waitFor(() => expect(api.auth.recoveryRequest).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/recovery email queued/i)).toBeInTheDocument();
  });

  it('clicking "Select recovery file" calls auth.acceptRecoveryFile and shows the Phase 8 deferred-verify toast', async () => {
    const api = getApi();
    api.auth.acceptRecoveryFile.mockResolvedValue({
      accepted: true,
      verificationDeferred: true,
    });
    const user = userEvent.setup();
    render(
      <>
        <RecoveryFilePicker />
        <Toaster />
      </>,
    );
    await user.click(screen.getByRole('button', { name: /forgot admin pin\?/i }));
    await user.click(screen.getByRole('button', { name: /select recovery file/i }));
    await waitFor(() => expect(api.auth.acceptRecoveryFile).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/recovery file accepted/i)).toBeInTheDocument();
    expect(screen.getByText(/phase 8/i)).toBeInTheDocument();
  });
});
