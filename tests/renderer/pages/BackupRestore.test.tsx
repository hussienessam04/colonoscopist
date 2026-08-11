// @vitest-environment happy-dom
// BackupRestore page tests — Phase 7 / Plan 07-05 (SET-05 + SET-06).
//
// Per UI-SPEC §Implementation Bindings Backup & Restore layout + the
// plan's must-have truth surface:
//   1. Layout: two side-by-side Cards with data-testid="backup-card" +
//      data-testid="restore-card".
//   2. Backup success: pickDestination returns a path; create returns
//      {path, sizeBytes, procedureCount}; the success toast renders
//      with a "Reveal in Explorer" action that calls backup.reveal.
//   3. Backup failure: create rejects → toast.error fires and the
//      Create Backup button re-enables.
//   4. Restore preview success: pickZip → preview returns a shape with
//      dbIntegrityCheck='ok'; the dialog opens with a green integrity
//      line + Restore to staging button enabled.
//   5. Restore integrity fail: preview returns a corruption string;
//      the dialog shows "Failed: <message>" in red + Restore to staging
//      button disabled.
//   6. v1.1 activate placeholder: the "Activate this backup" button is
//      rendered disabled with the v1.1 tooltip copy.
//
// We mock sonner entirely — happy-dom does not render sonner's toast
// surface, so assertion against toast.action is the only stable contract
// surface. Follows the ProcedureReview.test.tsx pattern.

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '../setup';
import { getApi } from '../setup';
import { initialRoute, setRoute } from '@/lib/router';
import { session } from '@/store/session';
import BackupRestore from '@/pages/BackupRestore';
import type { RestorePreview, UserPublic } from '@shared/ipc-contract';

// Hoisted sonner mock — keeps the toast contract visible per-test.
// ponytail: matches ProcedureReview.test.tsx; sonner is mocked so we
// can assert on the toast.action callback without depending on
// happy-dom's toast portal rendering (which is unreliable).
const toastMock = vi.hoisted(() =>
  Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
);
vi.mock('sonner', () => ({ toast: toastMock }));

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
  setRoute(initialRoute);
  toastMock.success.mockClear();
  toastMock.error.mockClear();
});

async function renderPage(): Promise<void> {
  setSession();
  await session.refresh();
  render(<BackupRestore />);
}

describe('BackupRestore page', () => {
  it('mounts two side-by-side Cards (data-testid=backup-card + restore-card) with the Create/Choose buttons', async () => {
    await renderPage();
    const backupCard = await screen.findByTestId('backup-card');
    const restoreCard = await screen.findByTestId('restore-card');
    expect(backupCard).toBeInTheDocument();
    expect(restoreCard).toBeInTheDocument();
    // Both buttons present.
    expect(screen.getByTestId('backup-create')).toBeInTheDocument();
    expect(screen.getByTestId('restore-choose')).toBeInTheDocument();
    expect(screen.getByTestId('restore-preview')).toBeInTheDocument();
    // Inline warning Alert per D-12 — present but does NOT disable the button.
    expect(screen.getByTestId('backup-warning')).toBeInTheDocument();
    expect(screen.getByTestId('backup-create')).not.toBeDisabled();
  });

  it('backup success: clicks Create Backup → mocks pickDestination + create → toast.success with Reveal in Explorer action calls backup.reveal', async () => {
    const api = getApi();
    api.backup.pickDestination.mockResolvedValue(
      'C:/Users/Doctor/Desktop/colonoscopist-backup-2026-08-11.zip',
    );
    api.backup.create.mockResolvedValue({
      path: 'C:/Users/Doctor/Desktop/colonoscopist-backup-2026-08-11.zip',
      sizeBytes: 12_345_678,
      procedureCount: 7,
    });
    const user = userEvent.setup();
    await renderPage();
    const backupButton = await screen.findByTestId('backup-create');
    await user.click(backupButton);
    await waitFor(() => expect(api.backup.pickDestination).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.backup.create).toHaveBeenCalledTimes(1));
    expect(api.backup.create).toHaveBeenCalledWith({
      destPath: 'C:/Users/Doctor/Desktop/colonoscopist-backup-2026-08-11.zip',
    });
    // toast.success called with the success label + an action.
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(
        expect.stringMatching(/backup created/i),
        expect.objectContaining({
          action: expect.objectContaining({
            label: expect.stringMatching(/reveal in explorer/i),
            onClick: expect.any(Function),
          }),
        }),
      ),
    );
    // Pull the toast call's action.onClick and invoke it → backup.reveal.
    const lastCall = toastMock.success.mock.calls.at(-1)?.[1] as
      | { action?: { onClick: () => void } }
      | undefined;
    expect(lastCall?.action).toBeDefined();
    lastCall?.action?.onClick();
    expect(api.backup.reveal).toHaveBeenCalledTimes(1);
    expect(api.backup.reveal).toHaveBeenCalledWith({
      path: 'C:/Users/Doctor/Desktop/colonoscopist-backup-2026-08-11.zip',
    });
  });

  it('backup failure: create rejects → toast.error fires + Create Backup re-enabled', async () => {
    const api = getApi();
    api.backup.pickDestination.mockResolvedValue('C:/Users/Doctor/Desktop/bad-backup.zip');
    api.backup.create.mockRejectedValue(new Error('disk full'));
    const user = userEvent.setup();
    await renderPage();
    const backupButton = await screen.findByTestId('backup-create');
    await user.click(backupButton);
    await waitFor(() => expect(api.backup.create).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('backup-create')).not.toBeDisabled());
    expect(toastMock.error).toHaveBeenCalledWith(
      expect.stringMatching(/disk full/i),
    );
  });

  it('restore preview success: pickZip → preview with dbIntegrityCheck=ok → green integrity row + Restore to staging enabled', async () => {
    const api = getApi();
    const preview: RestorePreview = {
      filename: 'colonoscopist-backup-2026-08-10T10-00-00.zip',
      totalSize: 5_368_709_120,
      dbIntegrityCheck: 'ok',
      procedureCount: 12,
    };
    api.restore.pickZip.mockResolvedValue(
      'C:/Users/Doctor/Desktop/colonoscopist-backup-2026-08-10T10-00-00.zip',
    );
    api.restore.preview.mockResolvedValue(preview);
    const user = userEvent.setup();
    await renderPage();
    const choose = await screen.findByTestId('restore-choose');
    await user.click(choose);
    await waitFor(() => expect(api.restore.pickZip).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('restore-zip-path')).toBeInTheDocument());
    const previewButton = await screen.findByTestId('restore-preview');
    await user.click(previewButton);
    await waitFor(() => expect(api.restore.preview).toHaveBeenCalledTimes(1));
    // Integrity line shows the green "Passed" label.
    const integrity = await screen.findByTestId('preview-integrity');
    expect(integrity.textContent).toMatch(/passed/i);
    // Preview row surfaces filename + size + procedure count.
    expect(screen.getByTestId('preview-filename').textContent).toContain(
      'colonoscopist-backup-2026-08-10T10-00-00.zip',
    );
    expect(screen.getByTestId('preview-size').textContent).toMatch(/5\.\d GB/);
    expect(screen.getByTestId('preview-contents').textContent).toMatch(/12/);
    // Restore to staging button enabled.
    const restoreOpen = await screen.findByTestId('restore-confirm-open');
    expect(restoreOpen).not.toBeDisabled();
  });

  it('restore integrity fail: dbIntegrityCheck=corruption string → red Failed: line + Restore to staging disabled', async () => {
    const api = getApi();
    api.restore.pickZip.mockResolvedValue('C:/Users/Doctor/Desktop/broken.zip');
    api.restore.preview.mockResolvedValue({
      filename: 'broken.zip',
      totalSize: 1024,
      dbIntegrityCheck: 'database disk image is malformed',
      procedureCount: 0,
    });
    const user = userEvent.setup();
    await renderPage();
    await user.click(await screen.findByTestId('restore-choose'));
    await waitFor(() => expect(api.restore.pickZip).toHaveBeenCalled());
    await user.click(await screen.findByTestId('restore-preview'));
    await waitFor(() => expect(api.restore.preview).toHaveBeenCalled());
    const integrity = await screen.findByTestId('preview-integrity');
    expect(integrity.textContent).toContain('Failed:');
    expect(integrity.textContent).toContain('database disk image is malformed');
    // Warning Alert about integrity is present.
    expect(screen.getByTestId('preview-integrity-warning')).toBeInTheDocument();
    // Restore to staging button is disabled.
    const restoreOpen = await screen.findByTestId('restore-confirm-open');
    expect(restoreOpen).toBeDisabled();
  });

  it('v1.1 activate placeholder: button exists with disabled attribute + v1.1 tooltip copy', async () => {
    await renderPage();
    const activate = await screen.findByTestId('restore-activate');
    expect(activate).toBeInTheDocument();
    expect(activate).toBeDisabled();
    // The tooltip text from the i18n bundle matches the plan copy.
    expect(activate.getAttribute('title')).toMatch(/activate-this-backup will be available in v1\.1/i);
    expect(activate.textContent).toMatch(/activate this backup/i);
  });

  it('restore preview → confirm → unpack → staging-complete toast with Open staging folder action', async () => {
    const api = getApi();
    api.restore.pickZip.mockResolvedValue('C:/Users/Doctor/Desktop/backup.zip');
    api.restore.preview.mockResolvedValue({
      filename: 'backup.zip',
      totalSize: 4096,
      dbIntegrityCheck: 'ok',
      procedureCount: 3,
    });
    api.restore.unpack.mockResolvedValue({ fileCount: 12, stagingDir: 'data-restore-1700000000000' });
    const user = userEvent.setup();
    await renderPage();
    await user.click(await screen.findByTestId('restore-choose'));
    await waitFor(() => expect(api.restore.pickZip).toHaveBeenCalled());
    await user.click(await screen.findByTestId('restore-preview'));
    await waitFor(() => expect(api.restore.preview).toHaveBeenCalled());
    // Restore to staging button → ConfirmDialog
    const restoreOpen = await screen.findByTestId('restore-confirm-open');
    await user.click(restoreOpen);
    // ConfirmDialog body copy renders
    await screen.findByText(/will contain the unpacked backup/i);
    // The ConfirmDialog confirm button uses t('backup.restoreActivate') =
    // "Restore to staging" — find it via role/label.
    const confirmButtons = await screen.findAllByRole('button', { name: /restore to staging/i });
    // The ConfirmDialog confirm is the last instance; click it.
    await user.click(confirmButtons[confirmButtons.length - 1]);
    await waitFor(() => expect(api.restore.unpack).toHaveBeenCalledTimes(1));
    expect(api.restore.unpack).toHaveBeenCalledWith({
      zipPath: 'C:/Users/Doctor/Desktop/backup.zip',
      // stagingDir is composed renderer-side as data-restore-<timestamp>;
      // main resolves it to userData-rooted via restoreStagingDir() — so
      // we assert the renderer never sends a data/ active-folder path.
      stagingDir: expect.stringMatching(/^data-restore-\d+$/),
    });
    // The staging-complete toast + "Open staging folder" action.
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(
        expect.stringMatching(/staging complete/i),
        expect.objectContaining({
          action: expect.objectContaining({
            label: expect.stringMatching(/open staging folder/i),
            onClick: expect.any(Function),
          }),
        }),
      ),
    );
    // Pull the toast call's action.onClick and invoke it → restore.revealStaging.
    const lastCall = toastMock.success.mock.calls.at(-1)?.[1] as
      | { action?: { onClick: () => void } }
      | undefined;
    lastCall?.action?.onClick();
    await waitFor(() => expect(api.restore.revealStaging).toHaveBeenCalledTimes(1));
    expect(api.restore.revealStaging).toHaveBeenCalledWith({
      stagingDir: 'data-restore-1700000000000',
    });
  });

  it('D-14 verbatim: renderer never sends a data/ active-folder path to the restore IPCs', async () => {
    const api = getApi();
    api.restore.pickZip.mockResolvedValue('C:/Desktop/backup.zip');
    api.restore.preview.mockResolvedValue({
      filename: 'backup.zip',
      totalSize: 4096,
      dbIntegrityCheck: 'ok',
      procedureCount: 3,
    });
    const user = userEvent.setup();
    await renderPage();
    await user.click(await screen.findByTestId('restore-choose'));
    await user.click(await screen.findByTestId('restore-preview'));
    await waitFor(() => expect(api.restore.preview).toHaveBeenCalled());
    const previewArgs = api.restore.preview.mock.calls[0]?.[0] as { zipPath: string; stagingDir: string };
    // stagingDir MUST be a data-restore-<ts> relative name — the renderer
    // never composes a path into the active data/ directory.
    expect(previewArgs.stagingDir).toMatch(/^data-restore-\d+$/);
    expect(previewArgs.stagingDir).not.toMatch(/data\/(?!restore-)/);
  });
});

void vi;
