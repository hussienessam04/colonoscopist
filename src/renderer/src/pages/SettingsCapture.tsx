import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Save, Settings, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCaptureDeviceMap } from '@/hooks/useCaptureDeviceMap';
import { useLicenseChangeRefresh } from '@/hooks/useLicenseStatus';
import { useVideoPreview } from '@/hooks/useVideoPreview';
import { SettingsLayout } from '@/components/SettingsLayout';
import EmptyStateCard from '@/components/EmptyStateCard';
import { isGateRejected, safeInvoke } from '@/lib/ipc-result';
import { qualityPresetSchema } from '@shared/validators';
import { toast } from 'sonner';
import type { QualityPreset } from '@shared/ipc-contract';

const RESOLUTION_PATTERN = /^\d{2,5}[x×]\d{2,5}$/;
const FRAMERATE_OPTIONS = [25, 30, 50, 60] as const;

type PresetKind = 'sd' | 'hd' | 'custom';

type PresetForm = {
  kind: PresetKind;
  resolution: string;
  framerate: number;
};

function defaultForm(): PresetForm {
  return { kind: 'hd', resolution: '1920x1080', framerate: 30 };
}

function fromPreset(preset: QualityPreset | null | undefined): PresetForm {
  if (!preset) return defaultForm();
  if (preset.preset === 'sd') return { kind: 'sd', resolution: '720x480', framerate: 30 };
  if (preset.preset === 'hd') return { kind: 'hd', resolution: '1920x1080', framerate: 30 };
  return {
    kind: 'custom',
    resolution: preset.resolution,
    framerate: preset.framerate,
  };
}

function toQualityPreset(form: PresetForm): QualityPreset {
  if (form.kind === 'sd') return { preset: 'sd' };
  if (form.kind === 'hd') return { preset: 'hd' };
  return { preset: 'custom', resolution: form.resolution, framerate: form.framerate };
}

function buildPreviewPreset(form: PresetForm): QualityPreset | undefined {
  if (form.kind === 'sd') return { preset: 'sd' };
  if (form.kind === 'hd') return { preset: 'hd' };
  if (!RESOLUTION_PATTERN.test(form.resolution)) return undefined;
  return { preset: 'custom', resolution: form.resolution, framerate: form.framerate };
}

export default function SettingsCapture(): JSX.Element {
  const { t } = useTranslation();
  const { browser, loading: bridgeLoading, lookup, pickBrowserId } = useCaptureDeviceMap();

  const [savedDeviceId, setSavedDeviceId] = useState<string | null>(null);
  const [selectedBrowserId, setSelectedBrowserId] = useState<string | null>(null);
  const [form, setForm] = useState<PresetForm>(defaultForm);
  const [saving, setSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [noSavedDevice, setNoSavedDevice] = useState(false);
  // Plan 08-11 / G-08-5 — mirror Plan 08-10 (G-08-4) gated-IPC pattern. When
  // the main-process license gate returns {ok:false}, safeInvoke yields
  // null and we render <EmptyStateCard> instead of feeding the gate object
  // into setSavedDeviceId (which used to crash downstream pickBrowserId /
  // hydration in the expired/unactivated state).
  const [gated, setGated] = useState(false);

  // Quick task 260913-rp5 — extracted the hydration fetch into a stable
  // callback so the LICENSE_CHANGED_EVENT listener can re-run it when
  // the user activates. The previous version had `useEffect(() => {...},
  // [bridgeLoading, hydrated, pickBrowserId])` with `hydrated=true` after
  // the first run, so the page never recovered after activation: `gated`
  // stayed true and the EmptyStateCard kept showing.
  //
  // Follow-up: distinguish gate rejection (license issue → EmptyStateCard)
  // from "no saved device" (legitimate null when the user is licensed
  // but has never saved a device OR has no USB capture plugged in). The
  // raw IPC response shape is checked via isGateRejected BEFORE passing
  // through safeInvoke — safeInvoke collapses both shapes into null,
  // which is the bug we hit when a licensed user with no USB device
  // still saw "License required — open Settings → License to activate.".
  const hydrate = useCallback((): void => {
    let cancelled = false;
    void (async (): Promise<void> => {
      const rawDevice = await window.api.capture.getDefaultDevice();
      if (cancelled) return;
      if (isGateRejected(rawDevice)) {
        // Plan 08-11 / G-08-5 — gate rejected the read. EmptyStateCard
        // surfaces the license path; the no-device hint stays rendered
        // for the legitimate empty case (handled below).
        setSavedDeviceId(null);
        setNoSavedDevice(true);
        setGated(true);
        setHydrated(true);
        return;
      }
      // rawDevice is now legitimately `string | null | undefined`.
      // null = "no saved device" (license is fine, doctor just hasn't
      // picked one yet); treat as the no-device hint, NOT gated.
      const device = rawDevice ?? null;
      setGated(false);
      if (device === null) {
        setSavedDeviceId(null);
        setNoSavedDevice(true);
        setHydrated(true);
        return;
      }
      setSavedDeviceId(device);
      const browserId = pickBrowserId(device);
      if (!browserId) {
        setNoSavedDevice(true);
        setHydrated(true);
        return;
      }
      setSelectedBrowserId(browserId);
      const preset = await safeInvoke(
        window.api.capture.getPreset({ deviceId: device }),
      );
      if (cancelled) return;
      setForm(fromPreset(preset));
      setHydrated(true);
    })().catch(() => {
      if (cancelled) return;
      setNoSavedDevice(true);
      setHydrated(true);
    });
  }, [pickBrowserId]);

  useEffect(() => {
    if (bridgeLoading || hydrated) return;
    hydrate();
  }, [bridgeLoading, hydrate, hydrated]);

  // Quick task 260913-rp5 — clear the local gated flag when the user
  // activates so the EmptyStateCard disappears. The hydrate() callback
  // also re-runs, which clears gated via the success branch above.
  useLicenseChangeRefresh(() => {
    setGated(false);
    hydrate();
  });

  const canonicalName = selectedBrowserId ? lookup(selectedBrowserId) : undefined;
  const previewPreset = useMemo(() => buildPreviewPreset(form), [form]);
  const preview = useVideoPreview(selectedBrowserId, previewPreset);

  function handleDeviceChange(browserId: string): void {
    preview.stop();
    setSelectedBrowserId(browserId);
    setHydrated(false);
    const name = lookup(browserId);
    if (name) {
      // Plan 08-11 / G-08-5 — wrap preset fetch through safeInvoke; null
      // (gate rejection) flows through fromPreset → defaultForm() which
      // already handles nullish input.
      void safeInvoke(window.api.capture.getPreset({ deviceId: name })).then(
        (preset) => {
          setForm(fromPreset(preset));
          setHydrated(true);
        },
      );
    } else {
      setForm(defaultForm());
      setHydrated(true);
    }
  }

  function setKind(kind: PresetKind): void {
    preview.stop();
    setForm((current) => {
      if (kind === 'sd') return { kind: 'sd', resolution: '720x480', framerate: 30 };
      if (kind === 'hd') return { kind: 'hd', resolution: '1920x1080', framerate: 30 };
      return { ...current, kind: 'custom' };
    });
  }

  function setResolution(value: string): void {
    preview.stop();
    setForm((current) => ({ ...current, resolution: value }));
  }

  function setFramerate(value: number): void {
    preview.stop();
    setForm((current) => ({ ...current, framerate: value }));
  }

  const customResolutionValid = form.kind !== 'custom' || RESOLUTION_PATTERN.test(form.resolution);
  const canSave = !saving && hydrated && selectedBrowserId !== null && !!canonicalName && customResolutionValid;
  const isPreviewing = preview.active || preview.starting;
  const selectedCanonical = canonicalName;

  async function handleSave(): Promise<void> {
    if (!selectedCanonical || !customResolutionValid) return;
    setSaving(true);
    try {
      const preset = toQualityPreset(form);
      qualityPresetSchema.parse(preset);
      // Plan 08-11 / G-08-5 — wrap persistence calls through safeInvoke so
      // the gate's {ok:false} surfaces as a clear toast instead of a
      // white-screen crash on Save.
      const savedDevice = await safeInvoke(
        window.api.capture.setDefaultDevice({ deviceId: selectedCanonical }),
      );
      if (savedDevice === null) {
        toast.error(
          t('settings.captureSaveLicenseRequired'),
        );
        return;
      }
      const savedPreset = await safeInvoke(
        window.api.capture.setPreset({ deviceId: selectedCanonical, preset }),
      );
      if (savedPreset === null) {
        toast.error(
          t('settings.captureSaveLicenseRequired'),
        );
        return;
      }
      toast.success(t('settings.captureSaveSuccess'));
    } catch (err) {
      const message = err instanceof Error ? err.message : t('settings.captureSaveFailed');
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsLayout
      title={t('settings.captureTitle')}
      subtitle={t('settings.captureDescription')}
      activeTab="capture"
      headerAction={
        // Quick task 260812-n0h — Save moved from the right controls aside
        // into the header slot, alongside Back. The testid stays the same
        // (`save-capture`) so the existing settings-capture.test.tsx
        // contract-guard query keeps finding it.
        <Button
          onClick={() => void handleSave()}
          disabled={!canSave}
          data-testid="save-capture"
          className="bg-[#0E3A47] text-white hover:bg-[#0B2C36] disabled:bg-[#E0D9C6] disabled:text-[#8C8478]"
        >
          <Save className="size-4 mr-1" aria-hidden="true" />
          {saving ? t('common.saving') : t('common.save')}
        </Button>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-black shadow-2xl">
          <div className="relative aspect-video">
            <video
              ref={preview.videoRef}
              autoPlay
              muted
              playsInline
              aria-label="Capture preview"
              className="size-full object-contain"
            />
            {!isPreviewing ? (
              <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-slate-400">
                {t('settings.previewHint')}
              </div>
            ) : null}
          </div>
        </div>

        <aside className="flex flex-col gap-5 rounded-xl border border-[#E0D9C6] bg-[#FBF7EE] p-5 shadow-[0_1px_2px_rgba(19,32,46,0.04),0_8px_24px_-12px_rgba(19,32,46,0.12)]">
          <div className="flex flex-col gap-2">
            <p className="text-sm text-[#5C6770]">
              {savedDeviceId
                ? t('settings.captureLastUsed', { device: savedDeviceId })
                : t('settings.captureLastUsedNone')}
            </p>
            <Label htmlFor="settings-capture-device">{t('settings.captureDeviceLabel')}</Label>
            <Select
              // ponytail: empty string instead of `undefined` keeps the
              // Select's value type stable across the null -> string
              // transition at hydration (avoids React's
              // "changing from uncontrolled to controlled" warning).
              value={selectedBrowserId ?? ''}
              onValueChange={handleDeviceChange}
              disabled={browser.length === 0 || selectedBrowserId === null}
            >
              <SelectTrigger
                id="settings-capture-device"
                aria-label={t('settings.captureDeviceLabel')}
                className="bg-[#FBF7EE] border-[#E0D9C6] text-[#13202E] placeholder:text-[#A39A86] hover:border-[#A8C5B5] focus:border-[#0E3A47] focus:bg-white focus:ring-1 focus:ring-[#0E3A47]/30"
              >
                <SelectValue placeholder={t('settings.captureDevicePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {browser.map((device, index) => (
                    <SelectItem key={device.deviceId} value={device.deviceId}>
                      {lookup(device.deviceId) || device.label || `Video device ${index + 1}`}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {noSavedDevice ? (
            <p className="text-sm text-[#8C8478]">
              <Settings aria-hidden="true" className="mr-1 inline-block size-4" />
              {t('settings.captureNoSavedYet')}
            </p>
          ) : null}

          {gated ? <EmptyStateCard /> : null}

          <fieldset className="flex flex-col gap-2 accent-[#0E3A47]">
            <legend className="text-sm font-medium">{t('settings.qualityPresetLabel')}</legend>
            <div className="flex flex-col gap-1 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="quality-preset"
                  value="sd"
                  checked={form.kind === 'sd'}
                  onChange={() => setKind('sd')}
                  data-testid="preset-sd"
                />
                {t('settings.qualityPresetSd')}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="quality-preset"
                  value="hd"
                  checked={form.kind === 'hd'}
                  onChange={() => setKind('hd')}
                  data-testid="preset-hd"
                />
                {t('settings.qualityPresetHd')}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="quality-preset"
                  value="custom"
                  checked={form.kind === 'custom'}
                  onChange={() => setKind('custom')}
                  data-testid="preset-custom"
                />
                {t('settings.qualityPresetCustom')}
              </label>
            </div>

            {form.kind === 'custom' ? (
              <div className="flex flex-col gap-3 rounded-md border border-[#E0D9C6] bg-[#FBF7EE] p-3">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="settings-capture-resolution">{t('settings.resolutionLabel')}</Label>
                  <Input
                    id="settings-capture-resolution"
                    value={form.resolution}
                    onChange={(event) => setResolution(event.target.value)}
                    placeholder={t('settings.resolutionPlaceholder')}
                    aria-invalid={!customResolutionValid}
                    data-testid="custom-resolution"
                    className="bg-[#FBF7EE] border-[#E0D9C6] text-[#13202E] placeholder:text-[#A39A86] hover:border-[#A8C5B5] focus:border-[#0E3A47] focus:bg-white focus:ring-1 focus:ring-[#0E3A47]/30"
                  />
                  {!customResolutionValid ? (
                    <p role="alert" className="text-xs text-destructive">
                      {t('settings.resolutionHint')}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="settings-capture-framerate">{t('settings.framerateLabel')}</Label>
                  <Select
                    value={String(form.framerate)}
                    onValueChange={(value) => setFramerate(Number(value))}
                  >
                    <SelectTrigger
                      id="settings-capture-framerate"
                      aria-label={t('settings.framerateLabel')}
                      className="bg-[#FBF7EE] border-[#E0D9C6] text-[#13202E] placeholder:text-[#A39A86] hover:border-[#A8C5B5] focus:border-[#0E3A47] focus:bg-white focus:ring-1 focus:ring-[#0E3A47]/30"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {FRAMERATE_OPTIONS.map((option) => (
                          <SelectItem key={option} value={String(option)}>
                            {t('settings.framerateFps', { count: option })}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : null}
          </fieldset>

          {preview.error ? (
            <p role="alert" className="text-sm text-destructive">
              {preview.error.message}
            </p>
          ) : null}

          <div className="mt-auto flex flex-col gap-2">
            {isPreviewing ? (
              <Button
                variant="outline"
                onClick={preview.stop}
                className="border-[#E0D9C6] bg-white text-[#5C6770] hover:border-[#0E3A47] hover:bg-[#E6EFF1] hover:text-[#0E3A47]"
              >
                {t('settings.stopPreview')}
              </Button>
            ) : (
              <Button
                onClick={preview.start}
                disabled={!selectedBrowserId || !previewPreset}
                data-testid="start-preview"
                className="bg-[#0E3A47] text-white hover:bg-[#0B2C36] disabled:bg-[#E0D9C6] disabled:text-[#8C8478]"
              >
                <Video aria-hidden="true" />
                {t('settings.startPreview')}
              </Button>
            )}
          </div>
        </aside>
      </div>
    </SettingsLayout>
  );
}
