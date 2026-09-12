// Settings → Storage — quick task 20260912-shared-database-optional.
//
// Opt-in shared database across devices. Toggle on + pick a
// network folder (SMB / NFS / OneDrive-mounted-as-folder / etc.)
// and the app's SQLite DB opens from that folder on next launch.
// Default stays local — the local `<userData>/data/` is the
// implicit baseline; the toggle is opt-in only.
//
// Migration of an existing local DB to the shared folder is
// OUT OF SCOPE for this task (the doctor can copy the
// `<userData>/data/` tree manually via Finder / Explorer).
// The UI surfaces this as a small inline warning when the toggle
// is on so the doctor isn't surprised that their existing
// records don't appear on device B.
//
// Visual treatment matches the rest of the Settings surfaces:
//   * ivory Card on the warm-ivory page bg
//   * small-caps section labels (`Settings.Storage.*` i18n keys)
//   * teal primary CTA, ivory-cancel outline, coral destructive
//   * StatusBadge-style alert for the "restart required" notice.

import { useCallback, useEffect, useState } from 'react';
import { Folder, MapPin, RotateCcw, Save } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import SettingsLayout from '@/components/SettingsLayout';
import type {
  StorageLocationResult,
  StorageSetLocationResult,
} from '@shared/ipc-contract';

type SaveOutcome =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'ok' }
  | { kind: 'error'; message: string };

export default function SettingsStorage(): JSX.Element {
  const { t } = useTranslation();
  const [location, setLocation] = useState<StorageLocationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [pathDraft, setPathDraft] = useState<string | null>(null);
  const [saveOutcome, setSaveOutcome] = useState<SaveOutcome>({ kind: 'idle' });

  // Initial load + every successful save re-syncs the local
  // mirror of the toggle/path. The "currently using" hint comes
  // from `effectivePath` which reflects what the running boot is
  // using (lags one launch behind a fresh save — that's expected
  // and called out in the warning banner).
  const refresh = useCallback(async (): Promise<void> => {
    if (!window.api.storage) {
      setLoading(false);
      return;
    }
    try {
      const result = await window.api.storage.getLocation();
      setLocation(result);
      setEnabled(result.enabled);
      setPathDraft(result.sharedPath);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not load storage settings.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handlePickFolder(): Promise<void> {
    if (!window.api.storage) return;
    const picked = await window.api.storage.pickFolder();
    if (picked.path) setPathDraft(picked.path);
  }

  async function handleSave(): Promise<void> {
    if (!window.api.storage) return;
    setSaveOutcome({ kind: 'saving' });
    try {
      const result: StorageSetLocationResult = await window.api.storage.setLocation({
        enabled,
        sharedPath: enabled ? pathDraft : null,
      });
      if (!result.ok) {
        const reason =
          result.reason === 'missing'
            ? 'The folder does not exist.'
            : result.reason === 'not-directory'
              ? 'The path is not a directory.'
              : result.reason === 'not-writable'
                ? 'The folder is not writable.'
                : 'Storage location could not be saved.';
        setSaveOutcome({ kind: 'error', message: reason });
        toast.error(reason);
        return;
      }
      // Refresh so the "currently using" hint + updatedAt stay
      // accurate. Note: `effectivePath` still shows the OLD path
      // until the doctor quits + relaunches (the toggle takes
      // effect on next boot — see the warning banner).
      await refresh();
      setSaveOutcome({ kind: 'ok' });
      toast.success(
        enabled
          ? 'Sharing will start on next app launch.'
          : 'Local will be restored on next app launch.',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed.';
      setSaveOutcome({ kind: 'error', message: msg });
      toast.error(msg);
    }
  }

  function handleReset(): void {
    setEnabled(false);
    setPathDraft(null);
  }

  // Render
  return (
    <SettingsLayout
      activeTab="storage"
      title={t('settings.storage.title')}
      subtitle={t('settings.storage.subtitle')}
    >
      <Card data-testid="settings-storage-card" className="border-[#E0D9C6] bg-[#FBF7EE] shadow-[0_1px_2px_rgba(19,32,46,0.04),0_8px_24px_-12px_rgba(19,32,46,0.12)]">
        <CardHeader>
          <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0E3A47]">
            {t('settings.storage.toggleTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Toggle */}
          <label
            className="flex items-start gap-3 rounded-md border border-[#E0D9C6] bg-white p-4 cursor-pointer transition-colors hover:border-[#A8C5B5]"
            data-testid="settings-storage-toggle-row"
          >
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="mt-0.5 size-4 accent-[#0E3A47]"
              disabled={loading || saveOutcome.kind === 'saving'}
              data-testid="settings-storage-toggle"
            />
            <div className="flex-1 space-y-1">
              <p className="text-sm font-medium text-[#13202E]">
                {t('settings.storage.toggleLabel')}
              </p>
              <p className="text-xs text-[#5C6770]">
                {t('settings.storage.toggleHelp')}
              </p>
            </div>
          </label>

          {/* Path picker (visible only when toggle is on) */}
          {enabled ? (
            <div className="space-y-3 rounded-md border border-[#E0D9C6] bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0E3A47]">
                  {t('settings.storage.pathTitle')}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handlePickFolder}
                  disabled={loading || saveOutcome.kind === 'saving'}
                  className="border-[#E0D9C6] bg-white text-[#5C6770] hover:border-[#0E3A47] hover:bg-[#E6EFF1] hover:text-[#0E3A47]"
                  data-testid="settings-storage-pick-folder"
                >
                  <Folder className="size-4 mr-1.5" aria-hidden="true" />
                  {t('settings.storage.pickFolder')}
                </Button>
              </div>
              <p
                className={
                  pathDraft
                    ? 'break-all rounded border border-[#E0D9C6] bg-[#FBF7EE] px-3 py-2 font-mono text-xs text-[#13202E]'
                    : 'rounded border border-dashed border-[#E0D9C6] bg-[#FBF7EE] px-3 py-2 text-xs italic text-[#8C8478]'
                }
                data-testid="settings-storage-path-display"
              >
                {pathDraft ?? t('settings.storage.noPathPicked')}
              </p>
              <p className="text-xs text-[#5C6770]">
                {t('settings.storage.pathHelp')}
              </p>
            </div>
          ) : null}

          {/* Always-visible restart warning + current-state hint */}
          <div
            className="rounded-md border border-amber-300/40 bg-amber-50/80 px-4 py-3 text-xs text-[#8C6B0F]"
            data-testid="settings-storage-restart-warning"
          >
            <p className="font-semibold uppercase tracking-[0.12em]">
              {t('settings.storage.warningTitle')}
            </p>
            <p className="mt-1">
              {t('settings.storage.warningBody')}
            </p>
            {location ? (
              <p className="mt-2 font-mono text-[11px] text-[#5C6770]">
                <MapPin className="mr-1 inline-block size-3" aria-hidden="true" />
                {t('settings.storage.currentlyUsing', {
                  path: location.effectivePath,
                })}
              </p>
            ) : null}
          </div>

          {/* Action row */}
          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            {enabled ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleReset}
                disabled={loading || saveOutcome.kind === 'saving'}
                className="text-[#5C6770] hover:bg-[#E6EFF1] hover:text-[#0E3A47]"
                data-testid="settings-storage-reset"
              >
                <RotateCcw className="size-4 mr-1.5" aria-hidden="true" />
                {t('settings.storage.reset')}
              </Button>
            ) : null}
            <Button
              type="button"
              onClick={handleSave}
              disabled={
                loading ||
                saveOutcome.kind === 'saving' ||
                (enabled && !pathDraft)
              }
              className="bg-[#0E3A47] text-white hover:bg-[#0a2C36] disabled:opacity-50"
              data-testid="settings-storage-save"
            >
              <Save className="size-4 mr-1.5" aria-hidden="true" />
              {saveOutcome.kind === 'saving'
                ? t('settings.storage.saving')
                : t('settings.storage.save')}
            </Button>
          </div>

          {saveOutcome.kind === 'error' ? (
            <p
              role="alert"
              className="rounded-md border border-[#C66B4D]/40 bg-[#C66B4D]/10 px-4 py-3 text-xs text-[#8B3A1F]"
              data-testid="settings-storage-error"
            >
              {saveOutcome.message}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </SettingsLayout>
  );
}