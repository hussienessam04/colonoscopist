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

// quick 20260811-backup-restore-tests-polish — 9 new cases covering the
// cancel/error/edge paths that the original 8 cases skipped.
//
// ponytail: these tests share the per-test setup + MockApi pattern
// from the original describe block above. They exercise the same
// renderPage helper, so the session/auth bootstrap is reused; the
// distinct cases live in the mockResolvedValue overrides per test.
describe('BackupRestore polish + edge cases', () => {
  it('backup cancel via null: pickDestination returns null → no toast + no backup.create + button re-enabled', async () => {
    const api = getApi();
    // pickDestination is already null by default in mockApi() but assert
    // it explicitly for this test's intent.
    api.backup.pickDestination.mockResolvedValue(null);
    const user = userEvent.setup();
    await renderPage();
    const backupButton = await screen.findByTestId('backup-create');
    await user.click(backupButton);
    await waitFor(() => expect(api.backup.pickDestination).toHaveBeenCalledTimes(1));
    // Give any fire-and-forget async work a chance to settle.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(api.backup.create).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(backupButton).not.toBeDisabled();
  });

  it('backup cancel via empty string (defensive): pickDestination returns "" → no toast + no backup.create', async () => {
    const api = getApi();
    api.backup.pickDestination.mockResolvedValue('');
    const user = userEvent.setup();
    await renderPage();
    const backupButton = await screen.findByTestId('backup-create');
    await user.click(backupButton);
    await waitFor(() => expect(api.backup.pickDestination).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(api.backup.create).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(backupButton).not.toBeDisabled();
  });

  it('restore cancel: pickZip returns null → click Choose → no preview call + preview button stays disabled', async () => {
    const api = getApi();
    api.restore.pickZip.mockResolvedValue(null);
    const user = userEvent.setup();
    await renderPage();
    const choose = await screen.findByTestId('restore-choose');
    await user.click(choose);
    await waitFor(() => expect(api.restore.pickZip).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    // restore-preview remains disabled (no zip picked yet).
    const preview = screen.getByTestId('restore-preview');
    expect(preview).toBeDisabled();
    expect(api.restore.preview).not.toHaveBeenCalled();
    // Empty-state hint shows because no zip was picked.
    expect(screen.getByTestId('restore-empty-hint')).toBeInTheDocument();
  });

  it('restore preview error: preview rejects → toast.error + restore-error Alert + restore-confirm-open stays disabled', async () => {
    const api = getApi();
    api.restore.pickZip.mockResolvedValue('C:/Doctor/broken.zip');
    api.restore.preview.mockRejectedValue(new Error('zip unreadable'));
    const user = userEvent.setup();
    await renderPage();
    await user.click(await screen.findByTestId('restore-choose'));
    await waitFor(() => expect(api.restore.pickZip).toHaveBeenCalled());
    await user.click(await screen.findByTestId('restore-preview'));
    await waitFor(() => expect(api.restore.preview).toHaveBeenCalled());
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('zip unreadable'));
    // Restore-error Alert surfaces the failure message inline.
    const errorAlert = await screen.findByTestId('restore-error');
    expect(errorAlert.textContent).toContain('zip unreadable');
    // Preview Dialog never opened (preview state stayed null), so the
    // restore-confirm-open button doesn't appear in the DOM.
    expect(screen.queryByTestId('restore-confirm-open')).not.toBeInTheDocument();
  });

  it('restore unpack error: unpack rejects → toast.error + unpack is the failing call', async () => {
    const api = getApi();
    api.restore.pickZip.mockResolvedValue('C:/Doctor/backup.zip');
    api.restore.preview.mockResolvedValue({
      filename: 'backup.zip',
      totalSize: 4096,
      dbIntegrityCheck: 'ok',
      procedureCount: 3,
    });
    api.restore.unpack.mockRejectedValue(new Error('disk full'));
    const user = userEvent.setup();
    await renderPage();
    await user.click(await screen.findByTestId('restore-choose'));
    await waitFor(() => expect(api.restore.pickZip).toHaveBeenCalled());
    await user.click(await screen.findByTestId('restore-preview'));
    await waitFor(() => expect(api.restore.preview).toHaveBeenCalled());
    const restoreOpen = await screen.findByTestId('restore-confirm-open');
    await user.click(restoreOpen);
    // ConfirmDialog confirm button uses the "Restore to staging" label.
    const confirmButtons = await screen.findAllByRole('button', { name: /restore to staging/i });
    await user.click(confirmButtons[confirmButtons.length - 1]);
    await waitFor(() => expect(api.restore.unpack).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(expect.stringMatching(/disk full/i)),
    );
    // No staging-complete success toast was fired.
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it('stale preview reset on re-pick: pick → preview → re-pick → preview state cleared (dialog closed)', async () => {
    const api = getApi();
    api.restore.pickZip
      .mockResolvedValueOnce('C:/Doctor/first.zip')
      .mockResolvedValueOnce('C:/Doctor/second.zip');
    api.restore.preview.mockResolvedValue({
      filename: 'first.zip',
      totalSize: 4096,
      dbIntegrityCheck: 'ok',
      procedureCount: 3,
    });
    const user = userEvent.setup();
    await renderPage();
    await user.click(await screen.findByTestId('restore-choose'));
    await waitFor(() => expect(api.restore.pickZip).toHaveBeenCalledTimes(1));
    await user.click(await screen.findByTestId('restore-preview'));
    await waitFor(() => expect(api.restore.preview).toHaveBeenCalled());
    // Preview Dialog is open with the integrity line.
    await screen.findByTestId('preview-integrity');
    // Close the modal via Escape so the underlying restore-choose button
    // is reachable — radix-ui Dialog sets pointer-events: none on the
    // page body when the modal is open. Escape closes the Dialog via
    // the shadcn Dialog's default behavior.
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByTestId('preview-integrity')).not.toBeInTheDocument(),
    );
    // Re-pick a different zip → handleChooseBackup resets preview=null
    // + previewOpen=false + stagingDir is recomposed.
    await user.click(screen.getByTestId('restore-choose'));
    await waitFor(() => expect(api.restore.pickZip).toHaveBeenCalledTimes(2));
    // restore-zip-path now reflects the second pick.
    const zipPath = await screen.findByTestId('restore-zip-path');
    expect(zipPath.textContent).toContain('second.zip');
    // restore-empty-hint is gone (a zip is now picked).
    expect(screen.queryByTestId('restore-empty-hint')).not.toBeInTheDocument();
  });

  it('empty data folder: procedureCount: 0 in preview → preview-contents still renders without crashing', async () => {
    const api = getApi();
    api.restore.pickZip.mockResolvedValue('C:/Doctor/empty.zip');
    api.restore.preview.mockResolvedValue({
      filename: 'empty.zip',
      totalSize: 4096,
      dbIntegrityCheck: 'ok',
      procedureCount: 0,
    });
    const user = userEvent.setup();
    await renderPage();
    await user.click(await screen.findByTestId('restore-choose'));
    await waitFor(() => expect(api.restore.pickZip).toHaveBeenCalled());
    await user.click(await screen.findByTestId('restore-preview'));
    await waitFor(() => expect(api.restore.preview).toHaveBeenCalled());
    // The contents row renders with "0 procedures" — no NaN, no crash.
    const contents = await screen.findByTestId('preview-contents');
    expect(contents.textContent).toMatch(/0/);
    // Restore-confirm-open is enabled because integrity passed.
    const restoreOpen = await screen.findByTestId('restore-confirm-open');
    expect(restoreOpen).not.toBeDisabled();
  });

  it('long zip path truncation: zipPath with 200+ chars → restore-zip-path uses truncateTail (renders ellipsis + last 60 chars)', async () => {
    const api = getApi();
    const longPath = `C:/Users/${'a'.repeat(180)}/Documents/long-name-backup.zip`;
    expect(longPath.length).toBeGreaterThan(200);
    api.restore.pickZip.mockResolvedValue(longPath);
    const user = userEvent.setup();
    await renderPage();
    await user.click(await screen.findByTestId('restore-choose'));
    await waitFor(() => expect(api.restore.pickZip).toHaveBeenCalled());
    const zipPathEl = await screen.findByTestId('restore-zip-path');
    const text = zipPathEl.textContent ?? '';
    // truncateTail prepends U+2026 (ellipsis) and clips to last 60 chars.
    expect(text.startsWith('\u2026')).toBe(true);
    expect(text.length).toBeLessThanOrEqual(60);
    // The last char of the rendered text is the last char of the input.
    expect(text.endsWith(longPath.slice(-1))).toBe(true);
  });

  it('last backup indicator — with row: api.audit.list returns a backup.created row → "Last backup:" string rendered', async () => {
    const api = getApi();
    const createdAt = Date.now() - 5 * 60_000; // 5 minutes ago
    api.audit.list.mockResolvedValue({
      rows: [
        {
          id: 1,
          userId: null,
          action: 'backup.created',
          entityType: 'backup',
          entityId: 'colonoscopist-backup.zip',
          metadata: null,
          outcome: 'ok',
          createdAt,
        },
      ],
      total: 1,
    });
    await renderPage();
    // The query fires in the useEffect on mount; wait for the audit.list
    // call + the indicator to render.
    await waitFor(() => expect(api.audit.list).toHaveBeenCalled());
    // The call shape is fixed: {action: 'backup.created', pageSize: 1}.
    const callArgs = api.audit.list.mock.calls[0]?.[0] as { action: string; pageSize: number };
    expect(callArgs.action).toBe('backup.created');
    expect(callArgs.pageSize).toBe(1);
    const indicator = await screen.findByTestId('backup-last-indicator');
    expect(indicator.textContent ?? '').toMatch(/Last backup:/i);
  });

  it('last backup indicator — no row: api.audit.list returns empty → "No backups yet" rendered', async () => {
    const api = getApi();
    api.audit.list.mockResolvedValue({ rows: [], total: 0 });
    await renderPage();
    await waitFor(() => expect(api.audit.list).toHaveBeenCalled());
    const indicator = await screen.findByTestId('backup-last-indicator');
    expect(indicator.textContent ?? '').toMatch(/No backups yet/i);
  });
});

void vi;
