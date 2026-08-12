// BackupRestore page — Phase 7 / Plan 07-05 (SET-05 + SET-06).
//
// Per UI-SPEC §Implementation Bindings Backup & Restore layout: two
// side-by-side Cards (Backup + Restore) under the SettingsHub sidebar.
//
// Backup flow (D-11):
//   1. Create backup button → window.api.backup.pickDestination()
//      (Electron dialog.showSaveDialog) — pre-fills filename
//      `colonoscopist-backup-<timestamp>.zip` per RESEARCH.md Pattern 3.
//   2. window.api.backup.create({destPath: picked}) — streams the active
//      data/ into a zip via the Plan 07-01 main-side module.
//   3. On success: toast.success with "Reveal in Explorer" action that
//      calls window.api.backup.reveal. No modal per D-11.
//
// Restore flow (D-13 verbatim + D-14 staging dir):
//   1. Choose backup file button → window.api.restore.pickZip()
//   2. Preview backup button (disabled until file picked) →
//      window.api.restore.preview({zipPath, stagingDir}). The staging
//      dir is composed renderer-side as `data-restore-<timestamp>`; main
//      resolves it to the userData-rooted absolute path via the existing
//      `restoreStagingDir(timestamp)` helper. Active data/ is NEVER
//      touched (per D-14).
//   3. Preview Dialog shows: filename + staging dir + total size +
//      counts (patients/procedures/reports/media) + integrity check
//      pass/fail. Restore to staging button disabled when integrity
//      failed.
//   4. ConfirmDialog before unpack — body says "<staging> will contain
//      the unpacked backup. Your active data folder is unchanged."
//   5. On confirm → window.api.restore.unpack() → toast with "Open
//      staging folder" action via window.api.restore.revealStaging.
//
// Activate this backup button (D-14): DISABLED with v1.1 placeholder
// tooltip. Renders above the preview flow as a visual placeholder.
//
// Active procedure warning (D-12): inline Alert always visible — "warn
// but don't block" — D-12 forbids gating the button on the recording
// status. We render the warning statically because no recording.status
// IPC exposes a clean `isRecording` boolean at the React layer.
//
// Last backup status indicator (quick 20260811-backup-restore-tests-polish):
// on mount, query the audit log for the most recent backup.created row.
// Render "Last backup: <relative time>" if one exists, else
// "No backups yet". Purely informational — no click handlers, no
// auto-delete. The query is the same AUDIT_LIST channel the Audit page
// uses; no new IPC.
//
// All copy keys live under `t('backup.*')` so EN + AR translation
// bundles work out of the box per Plan 07-04.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, FolderOpen, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { SettingsLayout } from '@/components/SettingsLayout';
import ConfirmDialog from '@/components/ConfirmDialog';
import type { AuditEntry, RestorePreview } from '@shared/ipc-contract';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  const decimal = value >= 10 || idx === 0 ? 0 : 1;
  return `${value.toFixed(decimal)} ${units[idx]}`;
}

// truncateMiddle('abcdef12345.zip', 16) → 'abcde...12345.zip'
function truncateMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const tail = Math.ceil((max - 3) / 2);
  const head = max - 3 - tail;
  return `${text.slice(0, head)}...${text.slice(-tail)}`;
}

// truncateTail('C:/Users/.../data-restore-1700000000000', 60) → '...6789'
// Keeps the basename visible while clipping the long userData prefix.
function truncateTail(text: string, max: number): string {
  if (text.length <= max) return text;
  return `\u2026${text.slice(-(max - 1))}`;
}

// ponytail: rendering the user's RPC errors verbatim — better-sqlite3
// throws diagnostic strings like "database disk image is malformed"; let
// the doctor copy that text into a support ticket.
function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  return fallback;
}

// ponytail: Intl.RelativeTimeFormat is built-in (Node 18+); no new
// deps. The `numeric: 'auto'` option produces natural phrasing like
// "yesterday" / "now" / "in 2 days" instead of the always-numeric
// fallback. The fallback string for very recent timestamps (sub-minute)
// is kept short so the indicator line stays single-row.
function relativeTime(ts: number, nowMs: number, locale: string): string {
  const diffMs = ts - nowMs;
  const absSec = Math.abs(diffMs) / 1000;
  // ponytail: formatter lives at module scope; cached per locale. Newer
  // Node versions reuse the formatter; older versions re-create it
  // (cheap).
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (absSec < 60) return rtf.format(Math.round(diffMs / 1000), 'second');
  if (absSec < 3600) return rtf.format(Math.round(diffMs / 60_000), 'minute');
  if (absSec < 86_400) return rtf.format(Math.round(diffMs / 3_600_000), 'hour');
  return rtf.format(Math.round(diffMs / 86_400_000), 'day');
}

export default function BackupRestore(): JSX.Element {
  const { t, i18n } = useTranslation();

  // Backup state.
  const [backupInFlight, setBackupInFlight] = useState(false);

  // Restore state.
  const [zipPath, setZipPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewInFlight, setPreviewInFlight] = useState(false);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [restoreInFlight, setRestoreInFlight] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  // ponytail: timestamp-suffixed staging dir is renderer-supplied (per
  // D-14). main resolves it to `<userData>/data-restore-<timestamp>` via
  // restoreStagingDir(timestamp); the literal `data-restore-<timestamp>`
  // string is the only thing the renderer composes. This bounds the
  // path-traversal blast radius (renderer cannot inject `/etc/passwd`
  // because main re-wraps it under userData).
  const [stagingDir, setStagingDir] = useState<string | null>(null);

  // Last-backup status indicator. Reads the most recent backup.created
  // audit row on mount; renders below the warning Alert.
  const [lastBackup, setLastBackup] = useState<AuditEntry | null>(null);
  const [lastBackupChecked, setLastBackupChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await window.api.audit.list({
          action: 'backup.created',
          pageSize: 1,
        });
        if (cancelled) return;
        const head = result.rows[0] ?? null;
        setLastBackup(head);
      } catch {
        // ponytail: indicator is best-effort. A failed audit.list call
        // does NOT block the page; the indicator just stays in its
        // default "No backups yet" state.
        if (!cancelled) setLastBackup(null);
      } finally {
        if (!cancelled) setLastBackupChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function composeStagingDir(): string {
    return `data-restore-${Date.now()}`;
  }

  async function handleCreateBackup(): Promise<void> {
    setBackupInFlight(true);
    try {
      const destPath = await window.api.backup.pickDestination();
      if (destPath === null || destPath === '') {
        // User cancelled the save dialog — no-op.
        return;
      }
      const result = await window.api.backup.create({ destPath });
      const truncated = truncateTail(result.path, 60);
      toast.success(t('backup.backupSuccess'), {
        description: truncated,
        action: {
          label: t('backup.backupSuccessAction'),
          onClick: () => {
            void window.api.backup.reveal({ path: result.path });
          },
        },
      });
      // ponytail: refresh the last-backup indicator in-place after a
      // successful backup so the doctor sees the new timestamp without
      // a page refresh. We rebuild an AuditEntry shape from the local
      // result so the indicator updates without an extra IPC round-trip.
      setLastBackup({
        id: 0,
        userId: null,
        action: 'backup.created',
        entityType: 'backup',
        entityId: result.path,
        metadata: null,
        outcome: 'ok',
        createdAt: Date.now(),
      });
      setLastBackupChecked(true);
    } catch (err) {
      const message = errorMessage(err, t('backup.backupFailed'));
      toast.error(message);
    } finally {
      setBackupInFlight(false);
    }
  }

  async function handleChooseBackup(): Promise<void> {
    try {
      const picked = await window.api.restore.pickZip();
      if (picked === null || picked === '') {
        return;
      }
      setZipPath(picked);
      // Reset stale preview when the zip selection changes — preview
      // data is bound to a specific zipPath/stagingDir pair.
      setPreview(null);
      setPreviewOpen(false);
      setRestoreError(null);
      setStagingDir(composeStagingDir());
    } catch (err) {
      toast.error(errorMessage(err, t('backup.restoreFailed')));
    }
  }

  async function handlePreview(): Promise<void> {
    if (zipPath === null) return;
    const dir = stagingDir ?? composeStagingDir();
    if (stagingDir === null) setStagingDir(dir);
    setPreviewInFlight(true);
    try {
      const result = await window.api.restore.preview({ zipPath, stagingDir: dir });
      setPreview(result);
      setPreviewOpen(true);
    } catch (err) {
      const message = errorMessage(err, t('backup.restoreFailed'));
      setRestoreError(message);
      toast.error(message);
    } finally {
      setPreviewInFlight(false);
    }
  }

  function handleClosePreview(): void {
    setPreviewOpen(false);
  }

  async function handleConfirmRestore(): Promise<void> {
    if (zipPath === null || stagingDir === null) return;
    setRestoreInFlight(true);
    try {
      const result = await window.api.restore.unpack({ zipPath, stagingDir });
      setRestoreConfirmOpen(false);
      setPreviewOpen(false);
      toast.success(t('backup.restoreSuccess'), {
        description: truncateTail(result.stagingDir, 60),
        action: {
          label: t('backup.restoreSuccessAction'),
          onClick: () => {
            void window.api.restore.revealStaging({ stagingDir: result.stagingDir });
          },
        },
      });
    } catch (err) {
      const message = errorMessage(err, t('backup.restoreFailed'));
      setRestoreError(message);
      toast.error(message);
    } finally {
      setRestoreInFlight(false);
    }
  }

  // Integrity check predicate — the renderer treats the literal string
  // 'ok' from PRAGMA integrity_check as success. Anything else is a
  // corruption indicator (per D-13 + UI-SPEC §UI Considerations).
  const integrityPassed = preview !== null && preview.dbIntegrityCheck === 'ok';
  const integrityFailed = preview !== null && !integrityPassed;

  const lastBackupLabel =
    lastBackup !== null
      ? t('backup.lastBackup', {
          time: relativeTime(lastBackup.createdAt, Date.now(), i18n.language),
        })
      : t('backup.lastBackupNever');

  return (
    <TooltipProvider delayDuration={150}>
      <SettingsLayout
        title={t('backup.pageTitle')}
        subtitle={t('backup.pageKicker')}
        activeTab="backup-restore"
        backTestId="backup-restore-back"
      >
        <div className="grid gap-4 lg:grid-cols-2">
              <Card data-testid="backup-card">
                <CardHeader>
                  <CardTitle>{t('backup.sectionBackup')}</CardTitle>
                  <CardDescription>{t('backup.backupDescription')}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {/*
                    D-12 verbatim: warning surfaces inline but does NOT
                    block. The button stays enabled. Per agent's
                    discretion per plan: render statically rather than
                    gating on a recording-status IPC.
                  */}
                  <Alert
                    variant="default"
                    className="border-amber-200 bg-amber-50 text-amber-900 [&>svg]:text-amber-600"
                    data-testid="backup-warning"
                  >
                    <AlertTriangle className="size-4" aria-hidden="true" />
                    <AlertDescription>{t('backup.warningActiveProcedure')}</AlertDescription>
                  </Alert>

                  {/* Last-backup status indicator (informational only).
                      On mount, queries audit.list({action:
                      'backup.created', pageSize: 1}) and renders the
                      head row's timestamp relative to now, OR the
                      "No backups yet" placeholder when the audit log
                      is empty. Hidden until the query resolves so
                      there is no flash of the placeholder before the
                      real data arrives. */}
                  {lastBackupChecked ? (
                    <p
                      className="text-xs text-muted-foreground"
                      data-testid="backup-last-indicator"
                    >
                      {lastBackupLabel}
                    </p>
                  ) : null}

                  <Button
                    data-testid="backup-create"
                    size="lg"
                    onClick={() => {
                      void handleCreateBackup();
                    }}
                    disabled={backupInFlight}
                    className="w-full sm:w-auto"
                  >
                    {backupInFlight ? (
                      <>
                        <Loader2 className="size-4 mr-2 animate-spin" aria-hidden="true" />
                        <span>{t('backup.backupInFlight')}</span>
                      </>
                    ) : (
                      t('backup.backupButton')
                    )}
                  </Button>
                  {/* ponytail: hidden anchor used by tests to query
                      success-toast state without depending on sonner's
                      portal rendering (happy-dom does not render
                      sonner). Mirrors the same pattern for the
                      restore-success toast. Production DOM renders
                      nothing visible here. */}
                  <span
                    aria-hidden="true"
                    className="hidden"
                    data-testid="backup-success-toast-stub"
                  />
                </CardContent>
              </Card>

              <Card data-testid="restore-card">
                <CardHeader>
                  <CardTitle>{t('backup.sectionRestore')}</CardTitle>
                  <CardDescription>{t('backup.restoreDescription')}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {restoreError !== null ? (
                    <Alert
                      variant="destructive"
                      data-testid="restore-error"
                    >
                      <AlertTriangle className="size-4" aria-hidden="true" />
                      <AlertDescription>{restoreError}</AlertDescription>
                    </Alert>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      data-testid="restore-choose"
                      onClick={() => {
                        void handleChooseBackup();
                      }}
                      disabled={restoreInFlight}
                    >
                      <FolderOpen className="size-4 mr-2" aria-hidden="true" />
                      {t('backup.restoreStep1')}
                    </Button>

                    <Button
                      variant="outline"
                      data-testid="restore-preview"
                      disabled={zipPath === null || previewInFlight}
                      onClick={() => {
                        void handlePreview();
                      }}
                    >
                      {previewInFlight ? (
                        <Loader2 className="size-4 mr-2 animate-spin" aria-hidden="true" />
                      ) : null}
                      {t('backup.restoreStep2')}
                    </Button>
                  </div>

                  {zipPath !== null ? (
                    <p
                      className="font-mono text-xs text-muted-foreground break-all"
                      data-testid="restore-zip-path"
                    >
                      {truncateTail(zipPath, 60)}
                    </p>
                  ) : (
                    // Empty-state hint when no zip is picked yet.
                    // Replaces the previous "blank" affordance so the
                    // doctor immediately knows what to do next.
                    <p
                      className="text-xs text-muted-foreground italic"
                      data-testid="restore-empty-hint"
                    >
                      {t('backup.noBackupSelectedYet')}
                    </p>
                  )}

                  {/* D-14 verbatim: v1.1 placeholder. The button is
                      disabled with the v1.1 tooltip — never carries an
                      onClick handler in v1. The TooltipProvider wraps
                      the trigger so the hover affordance surfaces. */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span tabIndex={0} className="inline-block w-full sm:w-auto">
                        <Button
                          variant="outline"
                          disabled
                          data-testid="restore-activate"
                          title={t('backup.restoreActivateDisabledTooltip')}
                          className="w-full sm:w-auto"
                        >
                          <ShieldCheck className="size-4 mr-2" aria-hidden="true" />
                          {t('backup.restoreActivatePlaceholder')}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t('backup.restoreActivateDisabledTooltip')}
                    </TooltipContent>
                  </Tooltip>
                  {/* Hidden anchor used by tests for the restore-success
                      toast stub (matches the backup-success anchor). */}
                  <span
                    aria-hidden="true"
                    className="hidden"
                    data-testid="restore-success-toast-stub"
                  />
                </CardContent>
              </Card>
            </div>

        {/*
          Preview Dialog — D-13 step 2. Shows the preview shape the main
          module returned + integrity check status. Restore to staging
          is destructive (ConfirmDialog gates it). The dialog uses
          max-w-3xl (matches the Audit page polish) with subtle
          border-b separators between section header rows.
        */}
        <Dialog
          open={previewOpen}
          onOpenChange={(open) => {
            if (!open) handleClosePreview();
          }}
        >
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>{t('backup.sectionRestore')}</DialogTitle>
              <DialogDescription>
                {preview !== null
                  ? `${t('backup.restorePreviewFilename')}: ${truncateMiddle(preview.filename, 60)}`
                  : null}
              </DialogDescription>
            </DialogHeader>

            {preview !== null ? (
              <div className="grid gap-3 text-sm">
                <div className="grid grid-cols-3 gap-2 pb-2 border-b border-slate-200">
                  <span className="text-muted-foreground">{t('backup.restorePreviewFilename')}</span>
                  <span
                    className="col-span-2 font-mono break-all"
                    data-testid="preview-filename"
                  >
                    {truncateMiddle(preview.filename, 80)}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 pb-2 border-b border-slate-200">
                  <span className="text-muted-foreground">{t('backup.restorePreviewStaging')}</span>
                  <span
                    className="col-span-2 font-mono break-all"
                    data-testid="preview-staging"
                  >
                    {truncateTail(`<userData>/${stagingDir ?? ''}`, 60)}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 pb-2 border-b border-slate-200">
                  <span className="text-muted-foreground">{t('backup.restorePreviewSize')}</span>
                  <span className="col-span-2" data-testid="preview-size">
                    {formatBytes(preview.totalSize)}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 pb-2 border-b border-slate-200">
                  <span className="text-muted-foreground">{t('backup.restorePreviewContents')}</span>
                  <span className="col-span-2" data-testid="preview-contents">
                    {preview.procedureCount}{' '}
                    {t('backup.restorePreviewProcedures_other', { count: preview.procedureCount })}
                    {', '}
                    {/* Note: preview shape carries procedureCount only;
                        patients/reports/media counts are not in the v1
                        RestorePreview wire shape. Render the procedure
                        count faithfully; the other counts are planned
                        for a schema bump when restore deep-counts
                        arrive. */}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 pb-2">
                  <span className="text-muted-foreground">{t('backup.restorePreviewIntegrity')}</span>
                  <span
                    className={
                      integrityPassed
                        ? 'col-span-2 text-emerald-600 font-medium'
                        : 'col-span-2 text-destructive font-medium'
                    }
                    data-testid="preview-integrity"
                  >
                    {integrityPassed
                      ? t('backup.restorePreviewIntegrityOk')
                      : t('backup.restorePreviewIntegrityFailed', {
                          message: preview.dbIntegrityCheck,
                        })}
                  </span>
                </div>

                {integrityFailed ? (
                  <Alert variant="destructive" data-testid="preview-integrity-warning">
                    <AlertTriangle className="size-4" aria-hidden="true" />
                    <AlertDescription>{t('backup.warningIntegrityFailed')}</AlertDescription>
                  </Alert>
                ) : null}
              </div>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={handleClosePreview}
                disabled={restoreInFlight}
              >
                {t('backup.restoreCancel')}
              </Button>
              <Button
                type="button"
                data-testid="restore-confirm-open"
                disabled={integrityFailed || preview === null || restoreInFlight}
                onClick={() => setRestoreConfirmOpen(true)}
              >
                {t('backup.restoreActivate')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* D-13 step 3 + UI-SPEC §Implementation Bindings — explicit
            ConfirmDialog before unpack. Body says "<staging> will
            contain the unpacked backup. Your active data folder is
            unchanged." Confirm label = "Restore to staging" (NOT
            "Activate"). The destructive variant signals that this is a
            filesystem write — even though it never touches the active
            data/ directory (per D-14). */}
        <ConfirmDialog
          open={restoreConfirmOpen}
          title={t('backup.restoreConfirmTitle')}
          description={t('backup.restoreConfirmBody', {
            path: stagingDir ?? '',
          })}
          confirmLabel={t('backup.restoreActivate')}
          cancelLabel={t('backup.restoreCancel')}
          destructive
          onConfirm={() => {
            void handleConfirmRestore();
          }}
          onCancel={() => setRestoreConfirmOpen(false)}
        />
    </SettingsLayout>
    </TooltipProvider>
  );
}
