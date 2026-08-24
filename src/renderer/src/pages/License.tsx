// License sub-page — Phase 8 / Plan 08-05 (LIC-03, I18N-01, I18N-03).
//
// Per CONTEXT D-04 + D-06: a single Card under the SettingsSidebar with:
//   - Status row (color-coded dot + status label) for each state
//   - Trial days remaining (when state='trial')
//   - Vendor + licensed-at (when state='licensed')
//   - Machine ID (always; grouped in 4-char blocks per CONTEXT specific
//     ideas, copy-to-clipboard button)
//   - 'Load .lic file…' button — calls window.api.license.pickAndActivate()
//     which wraps the dialog.showOpenDialog + loadAndVerifyLicense in
//     one main-side call (Phase 7 D-13 verbatim pattern). The renderer
//     NEVER composes a path; the IPC handler owns the picker.
//
// Pattern:
//   - Reuses SettingsLayout (Plan 07-06 quick) — same shell as
//     BackupRestore with activeTab='license' + backTestId='license-back'.
//   - Reuses useLicenseStatus (Plan 08-05) so activation success →
//     refresh() → Card re-renders with the new state without a page
//     reload.
//   - The handleLoadLic function surfaces three IPC outcomes:
//       ok=true                       → toast.success + refresh()
//       code=IPC_LICENSE_CANCELLED    → silent no-op (per Plan 04 T-08-L10)
//       else (IPC_LICENSE_INVALID)    → toast.error with the reason
//
// ponytail: stateBadgeColor is a lookup, not a CSS-in-JS class — tailwind
// needs literal class names so the JIT compiler can pick them up.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, KeyRound, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { SettingsLayout } from '@/components/SettingsLayout';
import { useLicenseStatus } from '@/hooks/useLicenseStatus';
import type { LicenseState } from '@shared/ipc-contract';

// ponytail: 64-char hex grouped in 4-char blocks — `a3f1-b9c2-7e4d-...`.
// Easier to dictate over the phone to vendor support.
function formatMachineId(id: string): string {
  return id.match(/.{1,4}/g)?.join('-') ?? id;
}

// tailwind's JIT compiler picks up these class names because they
// appear verbatim in source. Adding a new state requires updating
// the union in LicenseStatus + this switch.
function statusBadgeColor(state: LicenseState): string {
  switch (state) {
    case 'licensed':
      return 'bg-emerald-500';
    case 'trial':
      return 'bg-blue-500';
    case 'expired':
      return 'bg-red-500';
    case 'unactivated':
      return 'bg-slate-400';
  }
}

export default function License(): JSX.Element {
  const { t } = useTranslation();
  const { status, loading, refresh } = useLicenseStatus();
  const [activating, setActivating] = useState(false);

  async function handleLoadLic(): Promise<void> {
    setActivating(true);
    try {
      // Plan 04 ships IPC.LICENSE_PICK_AND_ACTIVATE which wraps
      // dialog.showOpenDialog + loadAndVerifyLicense in one main-side
      // call (Phase 7 D-13 verbatim pattern). The renderer never
      // composes the path; the IPC handler owns the picker.
      const result = await window.api.license?.pickAndActivate?.();
      if (!result) {
        toast.error(t('license.loadLicFailed'));
        return;
      }
      if (result.ok) {
        toast.success(t('license.loadLicSuccess'));
        await refresh();
        return;
      }
      if (result.code === 'IPC_LICENSE_CANCELLED') {
        // Plan 04 T-08-L10: picker cancel surfaces as a silent no-op.
        // Returning here skips the toast.error fallback below.
        return;
      }
      toast.error(
        t('license.loadLicInvalidReason', {
          reason: result.reason ?? t('license.loadLicFailed'),
        }),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('license.loadLicFailed'));
    } finally {
      setActivating(false);
    }
  }

  async function handleCopyMachineId(): Promise<void> {
    if (!status) return;
    try {
      await navigator.clipboard.writeText(status.machineId);
      toast.success(t('license.machineIdCopied'));
    } catch {
      // ponytail: clipboard access can be denied (browser permissions).
      // The doctor can still read the machine id from the card —
      // surface a soft warning instead of crashing.
      toast.error(t('license.loadLicFailed'));
    }
  }

  const stateLabel =
    status !== null
      ? t(
          `license.status${status.state.charAt(0).toUpperCase()}${status.state.slice(1)}`,
        )
      : t('license.loading');

  return (
    <SettingsLayout
      title={t('license.pageTitle')}
      subtitle={t('license.pageKicker')}
      activeTab="license"
      backTestId="license-back"
    >
      <Card data-testid="license-status-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4" aria-hidden="true" />
            {t('license.statusTitle')}
            {status !== null ? (
              <span
                className={`inline-block size-2 rounded-full ${statusBadgeColor(status.state)}`}
                data-testid="license-status-dot"
                data-state={status.state}
              />
            ) : null}
          </CardTitle>
          <CardDescription>{t('license.pageDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {status !== null ? (
            <>
              <div className="grid grid-cols-3 gap-2 pb-2 border-b border-slate-200">
                <span className="text-muted-foreground">{t('license.statusLabel')}</span>
                <span className="col-span-2" data-testid="license-status-label">
                  {stateLabel}
                </span>
              </div>

              {status.state === 'trial' ? (
                <div className="grid grid-cols-3 gap-2 pb-2 border-b border-slate-200">
                  <span className="text-muted-foreground">
                    {t('license.trialDaysRemainingLabel')}
                  </span>
                  <span className="col-span-2" data-testid="license-trial-days">
                    {t('license.trialDaysRemainingValue', {
                      days: status.trialDaysRemaining ?? 0,
                    })}
                  </span>
                </div>
              ) : null}

              {status.state === 'licensed' ? (
                <>
                  <div className="grid grid-cols-3 gap-2 pb-2 border-b border-slate-200">
                    <span className="text-muted-foreground">{t('license.vendorIdLabel')}</span>
                    <span
                      className="col-span-2 font-mono"
                      data-testid="license-vendor-id"
                    >
                      {status.vendorId ?? '—'}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pb-2 border-b border-slate-200">
                    <span className="text-muted-foreground">
                      {t('license.licensedAtLabel')}
                    </span>
                    <span
                      className="col-span-2 font-mono"
                      data-testid="license-licensed-at"
                    >
                      {status.licensedAt !== null
                        ? new Date(status.licensedAt).toLocaleString()
                        : '—'}
                    </span>
                  </div>
                </>
              ) : null}

              <div className="grid grid-cols-3 gap-2">
                <span className="text-muted-foreground">{t('license.machineIdLabel')}</span>
                <div className="col-span-2 flex items-center gap-2">
                  <span
                    className="font-mono break-all"
                    data-testid="license-machine-id"
                  >
                    {formatMachineId(status.machineId)}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      void handleCopyMachineId();
                    }}
                    data-testid="license-copy-machine-id"
                    aria-label={t('license.machineIdCopy')}
                  >
                    <Copy className="size-3" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </>
          ) : loading ? (
            <p className="text-sm text-muted-foreground italic">
              {t('license.loading')}
            </p>
          ) : null}

          <Button
            size="lg"
            onClick={() => {
              void handleLoadLic();
            }}
            disabled={activating}
            data-testid="license-load-lic"
            className="w-full sm:w-auto"
          >
            {activating ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" aria-hidden="true" />
                <span>{t('license.loadLicButtonInFlight')}</span>
              </>
            ) : (
              t('license.loadLicButton')
            )}
          </Button>
        </CardContent>
      </Card>
    </SettingsLayout>
  );
}
