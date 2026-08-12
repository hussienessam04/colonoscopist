import { useEffect, useMemo, useState } from 'react';
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
import { useVideoPreview } from '@/hooks/useVideoPreview';
import { SettingsLayout } from '@/components/SettingsLayout';
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
  const { browser, loading: bridgeLoading, lookup, pickBrowserId } = useCaptureDeviceMap();

  const [savedDeviceId, setSavedDeviceId] = useState<string | null>(null);
  const [selectedBrowserId, setSelectedBrowserId] = useState<string | null>(null);
  const [form, setForm] = useState<PresetForm>(defaultForm);
  const [saving, setSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [noSavedDevice, setNoSavedDevice] = useState(false);

  // Hydrate from main: saved default device. The dshow list is always
  // available; the browser list may be empty until the user grants the
  // camera permission. We wait for `bridgeLoading` to flip false, which
  // means at least the dshow list is loaded.
  useEffect(() => {
    if (bridgeLoading || hydrated) return;
    let cancelled = false;
    void window.api.capture
      .getDefaultDevice()
      .then((device) => {
        if (cancelled) return;
        setSavedDeviceId(device);
        if (!device) {
          setNoSavedDevice(true);
          setHydrated(true);
          return;
        }
        const browserId = pickBrowserId(device);
        if (browserId) {
          setSelectedBrowserId(browserId);
          void window.api.capture.getPreset({ deviceId: device }).then((preset) => {
            if (cancelled) return;
            setForm(fromPreset(preset));
            setHydrated(true);
          });
        } else {
          setNoSavedDevice(true);
          setHydrated(true);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setNoSavedDevice(true);
        setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [bridgeLoading, hydrated, pickBrowserId]);

  const canonicalName = selectedBrowserId ? lookup(selectedBrowserId) : undefined;
  const previewPreset = useMemo(() => buildPreviewPreset(form), [form]);
  const preview = useVideoPreview(selectedBrowserId, previewPreset);

  function handleDeviceChange(browserId: string): void {
    preview.stop();
    setSelectedBrowserId(browserId);
    setHydrated(false);
    const name = lookup(browserId);
    if (name) {
      void window.api.capture.getPreset({ deviceId: name }).then((preset) => {
        setForm(fromPreset(preset));
        setHydrated(true);
      });
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
      await window.api.capture.setDefaultDevice({ deviceId: selectedCanonical });
      await window.api.capture.setPreset({ deviceId: selectedCanonical, preset });
      toast.success('Capture settings saved.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save capture settings.';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsLayout
      title="Capture"
      subtitle="Pick a default device and a quality preset. Preview verifies the configuration before saving."
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
        >
          <Save className="size-4 mr-1" aria-hidden="true" />
          {saving ? 'Saving…' : 'Save'}
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
                Choose a device and a preset, then start the preview to verify the configuration.
              </div>
            ) : null}
          </div>
        </div>

        <aside className="flex flex-col gap-5 rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              Last used: {savedDeviceId ?? 'None'}
            </p>
            <Label htmlFor="settings-capture-device">Capture device</Label>
            <Select
              value={selectedBrowserId ?? undefined}
              onValueChange={handleDeviceChange}
              disabled={browser.length === 0}
            >
              <SelectTrigger id="settings-capture-device" aria-label="Capture device">
                <SelectValue placeholder="Select a device" />
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
            <p className="text-sm text-muted-foreground">
              <Settings aria-hidden="true" className="mr-1 inline-block size-4" />
              No device saved yet. Pick one to enable Save.
            </p>
          ) : null}

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">Quality preset</legend>
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
                SD analog (EasyCap) — 720×480
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
                HD digital (HDMI / DVI) — 1920×1080
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
                Custom
              </label>
            </div>

            {form.kind === 'custom' ? (
              <div className="flex flex-col gap-3 rounded-md border bg-background p-3">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="settings-capture-resolution">Resolution (W×H)</Label>
                  <Input
                    id="settings-capture-resolution"
                    value={form.resolution}
                    onChange={(event) => setResolution(event.target.value)}
                    placeholder="1920x1080"
                    aria-invalid={!customResolutionValid}
                    data-testid="custom-resolution"
                  />
                  {!customResolutionValid ? (
                    <p role="alert" className="text-xs text-destructive">
                      Use W×H like 1920×1080.
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="settings-capture-framerate">Framerate</Label>
                  <Select
                    value={String(form.framerate)}
                    onValueChange={(value) => setFramerate(Number(value))}
                  >
                    <SelectTrigger id="settings-capture-framerate" aria-label="Framerate">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {FRAMERATE_OPTIONS.map((option) => (
                          <SelectItem key={option} value={String(option)}>
                            {option} fps
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
              <Button variant="outline" onClick={preview.stop}>
                Stop Preview
              </Button>
            ) : (
              <Button
                onClick={preview.start}
                disabled={!selectedBrowserId || !previewPreset}
                data-testid="start-preview"
              >
                <Video aria-hidden="true" />
                Start Preview
              </Button>
            )}
          </div>
        </aside>
      </div>
    </SettingsLayout>
  );
}
