import { useEffect, useRef, useState } from 'react';
import { Camera, CircleStop, Settings, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { useRoute } from '@/store/route';
import type { QualityPreset } from '@shared/ipc-contract';

function NoDeviceState({ openSettings }: { openSettings: () => void }): JSX.Element {
  useEffect(() => {
    void window.api.capture.noDeviceAudit().catch(() => undefined);
  }, []);

  return (
    <div className="absolute inset-0 grid place-items-center p-6 text-center text-white">
      <div className="flex max-w-md flex-col items-center gap-3">
        <Camera aria-hidden="true" className="size-9 text-slate-400" />
        <p className="font-medium">No device selected — go to Settings → Capture to pick one</p>
        <Button variant="secondary" onClick={openSettings}>
          <Settings aria-hidden="true" />
          Open Settings
        </Button>
      </div>
    </div>
  );
}

export default function ProcedureRoom(): JSX.Element {
  const { previous, navigate } = useRoute();
  const { browser, loading, error: deviceError, lookup, pickBrowserId } = useCaptureDeviceMap();
  const [savedDevice, setSavedDevice] = useState<string | null>(null);
  const [selectedBrowserId, setSelectedBrowserId] = useState<string | null>(null);
  const [preset, setPreset] = useState<QualityPreset>();
  const [defaultLoaded, setDefaultLoaded] = useState(false);
  const initialized = useRef(false);
  const preview = useVideoPreview(selectedBrowserId, preset);

  useEffect(() => {
    let cancelled = false;
    void window.api.capture
      .getDefaultDevice()
      .then((device) => {
        if (!cancelled) setSavedDevice(device);
      })
      .catch(() => {
        if (!cancelled) setSavedDevice(null);
      })
      .finally(() => {
        if (!cancelled) setDefaultLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (loading || !defaultLoaded || initialized.current) return;
    initialized.current = true;
    setSelectedBrowserId(savedDevice ? (pickBrowserId(savedDevice) ?? null) : null);
  }, [defaultLoaded, loading, pickBrowserId, savedDevice]);

  const selectedCanonical = selectedBrowserId ? lookup(selectedBrowserId) : undefined;

  useEffect(() => {
    if (!selectedCanonical) {
      setPreset(undefined);
      return;
    }
    let cancelled = false;
    void window.api.capture
      .getPreset({ deviceId: selectedCanonical })
      .then((nextPreset) => {
        if (!cancelled) setPreset(nextPreset ?? undefined);
      })
      .catch(() => {
        if (!cancelled) setPreset(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCanonical]);

  function finish(): void {
    preview.stop();
    navigate(previous ?? { name: 'patients' });
  }

  const ready = !loading && defaultLoaded;
  const hasSelection = selectedBrowserId !== null;
  const isRunning = preview.active || preview.starting;

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Live capture
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">Procedure Room</h1>
          </div>
          <Button variant="outline" onClick={finish}>
            Finish
          </Button>
        </header>

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="overflow-hidden rounded-xl border border-slate-800 bg-black shadow-2xl">
            <div className="relative aspect-video">
              <video
                ref={preview.videoRef}
                autoPlay
                muted
                playsInline
                aria-label="Live capture preview"
                className="size-full object-contain"
              />
              {ready && !hasSelection ? (
                <NoDeviceState openSettings={() => navigate({ name: 'settings-capture' })} />
              ) : null}
              {!ready ? (
                <div className="absolute inset-0 grid place-items-center text-sm text-slate-400">
                  Finding capture devices…
                </div>
              ) : null}
            </div>
          </div>

          <aside className="flex flex-col gap-5 rounded-xl border bg-card p-5 shadow-sm">
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">Last used: {savedDevice ?? 'None'}</p>
              <label htmlFor="procedure-device" className="text-sm font-medium">
                Capture device
              </label>
              <Select
                value={selectedBrowserId ?? undefined}
                onValueChange={(value) => {
                  preview.stop();
                  setSelectedBrowserId(value);
                }}
                disabled={loading || browser.length === 0}
              >
                <SelectTrigger id="procedure-device" aria-label="Capture device">
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
              <p className="text-xs text-muted-foreground">
                This override lasts only until you finish this room.
              </p>
            </div>

            {deviceError ? <p role="alert" className="text-sm text-destructive">{deviceError}</p> : null}
            {preview.error ? (
              <p role="alert" className="text-sm text-destructive" data-testid="preview-error">
                {preview.error.message} [{preview.error.code}]
              </p>
            ) : null}

            <div className="mt-auto flex flex-col gap-2">
              {isRunning ? (
                <Button variant="outline" onClick={preview.stop}>
                  <CircleStop aria-hidden="true" />
                  Stop Preview
                </Button>
              ) : (
                <Button onClick={preview.start} disabled={!hasSelection}>
                  <Video aria-hidden="true" />
                  Start Preview
                </Button>
              )}
              <Button disabled title="Recording ships in Phase 4">
                Record
              </Button>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
