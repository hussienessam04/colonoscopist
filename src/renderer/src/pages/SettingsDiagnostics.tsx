// Settings → Diagnostics — quick task 20260913-5b0.
//
// Workstation-level diagnostic bundle for vendor support. Mirrors the
// SettingsAbout visual treatment (ivory Card on warm-ivory bg,
// small-caps teal labels, monospace values) but reads runtime state via
// `window.api.app.getDiagnostic()` instead of hardcoded constants.
//
// The page renders app/electron/node versions + the userData + logs
// path + license state + the last 200 lines of startup.log, with a
// Copy button that writes the JSON dump to the clipboard via the
// already-wired `clipboard.copyText` IPC channel.
//
// ponytail: no separate "Open logs folder" button — the path is
// displayed in the UI and the doctor copies it manually. Adding a
// shell.openPath IPC for one button is out of scope.

import { Bug, Clipboard } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SettingsLayout } from '@/components/SettingsLayout';
import type { DiagnosticInfo } from '@shared/ipc-contract';

export default function SettingsDiagnostics(): JSX.Element {
  const { t } = useTranslation();
  const [diagnostic, setDiagnostic] = useState<DiagnosticInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void window.api.app
      .getDiagnostic()
      .then((info) => {
        if (!cancelled) {
          setDiagnostic(info);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : 'Failed to load diagnostics.');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCopy(): Promise<void> {
    if (!diagnostic) return;
    try {
      await window.api.clipboard.copyText({ text: JSON.stringify(diagnostic, null, 2) });
      toast.success(t('diagnostics.copySuccess'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Copy failed.');
    }
  }

  const rows: Array<{ labelKey: string; value: string; testId: string }> = diagnostic
    ? [
        { labelKey: 'diagnostics.appVersionLabel', value: diagnostic.appVersion, testId: 'diag-app-version' },
        { labelKey: 'diagnostics.electronVersionLabel', value: diagnostic.electronVersion, testId: 'diag-electron-version' },
        { labelKey: 'diagnostics.nodeVersionLabel', value: diagnostic.nodeVersion, testId: 'diag-node-version' },
        { labelKey: 'diagnostics.chromeVersionLabel', value: diagnostic.chromeVersion, testId: 'diag-chrome-version' },
        { labelKey: 'diagnostics.userDataDirLabel', value: diagnostic.userDataDir, testId: 'diag-user-data' },
        { labelKey: 'diagnostics.logsDirLabel', value: diagnostic.logsDir, testId: 'diag-logs-dir' },
        { labelKey: 'diagnostics.machineIdLabel', value: diagnostic.machineId || '—', testId: 'diag-machine-id' },
        {
          labelKey: 'diagnostics.licenseStateLabel',
          value:
            diagnostic.licenseState === null
              ? '—'
              : diagnostic.licenseState === 'trial'
                ? `${t('diagnostics.licenseStateTrial')} (${diagnostic.trialDaysRemaining ?? 0}d)`
                : t(`diagnostics.licenseState_${diagnostic.licenseState}`),
          testId: 'diag-license-state',
        },
      ]
    : [];

  return (
    <SettingsLayout
      title={t('diagnostics.pageTitle')}
      subtitle={t('diagnostics.pageDescription')}
      activeTab="diagnostics"
      backTestId="settings-diagnostics-back"
    >
      <Card
        data-testid="settings-diagnostics-card"
        className="border-[#E0D9C6] bg-[#FBF7EE] shadow-[0_1px_2px_rgba(19,32,46,0.04),0_8px_24px_-12px_rgba(19,32,46,0.12)]"
      >
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0E3A47]">
            <Bug className="size-4" aria-hidden="true" />
            {t('diagnostics.pageTitle')}
          </CardTitle>
          <CardDescription className="text-[#5C6770]">
            {t('diagnostics.pageDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {loading ? (
            <p className="text-sm text-[#5C6770]" data-testid="settings-diagnostics-loading">
              {t('diagnostics.loading')}
            </p>
          ) : (
            <>
              {rows.map((row, i) => (
                <div
                  key={row.labelKey}
                  className={`grid grid-cols-3 gap-2 ${i < rows.length - 1 ? 'pb-2 border-b border-border' : ''}`}
                >
                  <span className="text-[#5C6770]">{t(row.labelKey)}</span>
                  <span className="col-span-2 font-mono break-all" data-testid={row.testId}>
                    {row.value}
                  </span>
                </div>
              ))}
              <Button
                onClick={() => void handleCopy()}
                data-testid="settings-diagnostics-copy"
                className="self-start bg-[#0E3A47] text-white hover:bg-[#0B2C36]"
              >
                <Clipboard className="size-4 mr-2" aria-hidden="true" />
                {t('diagnostics.copyButton')}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </SettingsLayout>
  );
}
