import { useEffect, useState, useRef } from 'react';
import { Camera, CircleStop, Video, ArrowRight } from 'lucide-react';
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
import type { Procedure } from '@shared/ipc-contract';

function NoDeviceState({ openSettings }: { openSettings: () => void }): JSX.Element {
  return (
    <div className="absolute inset-0 grid place-items-center p-6 text-center text-white">
      <div className="flex max-w-md flex-col items-center gap-3">
        <Camera aria-hidden="true" className="size-9 text-slate-400" />
        <p className="font-medium">
          No device selected — go to Settings → Capture to pick one
        </p>
        <Button variant="secondary" onClick={openSettings}>
          Open Settings
        </Button>
      </div>
    </div>
  );
}

export default function ProcedurePreview(): JSX.Element {
  const routeState = useRoute();
  const route = routeState.current;
  const navigate = routeState.navigate;
  const patientId = route.name === 'procedure-preview' ? route.patientId : '';
  const incomingProcedureId =
    route.name === 'procedure-preview' ? route.procedureId : undefined;

  const { browser, loading, error: deviceError, lookup, pickBrowserId } = useCaptureDeviceMap();
  const [savedDevice, setSavedDevice] = useState<string | null>(null);
  const [selectedBrowserId, setSelectedBrowserId] = useState<string | null>(null);
  const [defaultLoaded, setDefaultLoaded] = useState(false);
  const deviceInitRef = useRef(false);

  const preview = useVideoPreview(selectedBrowserId, undefined);
  const isRunning = preview.active || preview.starting;

  // Read the saved default device on mount.
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

  // Hydrate the device picker once both lists are loaded.
  useEffect(() => {
    if (loading || !defaultLoaded || deviceInitRef.current) return;
    deviceInitRef.current = true;
    setSelectedBrowserId(savedDevice ? pickBrowserId(savedDevice) ?? null : null);
  }, [defaultLoaded, loading, pickBrowserId, savedDevice]);

  const selectedCanonical = selectedBrowserId ? lookup(selectedBrowserId) : undefined;

  // Procedure row id is created on Continue click (not on mount). This way
  // the Continue button is always clickable; we surface any IPC error
  // inline. Reuse the incoming procedureId if the route carries one
  // (return-from-procedure-room path).
  const [procedureId] = useState<string | null>(
    incomingProcedureId ?? null,
  );
  const [procedureError, setProcedureError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const ready = !loading && defaultLoaded;
  const hasSelection = selectedBrowserId !== null;

  function openSettings(): void {
    navigate({ name: 'settings-capture' });
  }

  function continueToRecording(): void {
    if (!patientId || creating) return;
    // If we already have a procedureId (incoming route param), go straight.
    if (procedureId) {
      preview.stop();
      navigate({
        name: 'procedure-room',
        patientId,
        procedureId,
      });
      return;
    }
    // Otherwise create one now, then navigate.
    setCreating(true);
    setProcedureError(null);
    window.api.procedures
      .create({ patientId })
      .then((row: Procedure) => {
        preview.stop();
        navigate({
          name: 'procedure-room',
          patientId,
          procedureId: row.id,
        });
      })
      .catch((err: unknown) => {
        setCreating(false);
        setProcedureError(
          err instanceof Error ? err.message : 'Could not prepare the procedure row.',
        );
      });
  }

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Step 1
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">Preview</h1>
          </div>
          <Button variant="outline" onClick={() => navigate({ name: 'patients' })}>
            Back to patients
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
              {!ready || !hasSelection ? (
                <NoDeviceState openSettings={openSettings} />
              ) : null}
            </div>
          </div>

          <aside className="flex flex-col gap-5 rounded-xl border bg-card p-5 shadow-sm">
            {deviceError ? (
              <p role="alert" className="text-sm text-destructive">
                {deviceError}
              </p>
            ) : null}
            {preview.error ? (
              <p role="alert" className="text-sm text-destructive">
                {preview.error.message}
              </p>
            ) : null}

            <div className="flex flex-col gap-2">
              <label htmlFor="procedure-device" className="text-sm font-medium">
                Capture device
              </label>
              <Select
                value={selectedBrowserId ?? ''}
                onValueChange={(v) => setSelectedBrowserId(v || null)}
              >
                <SelectTrigger id="procedure-device" className="w-full">
                  <SelectValue placeholder="Pick a capture device" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {browser.map((device, index) => {
                      const canonical = lookup(device.deviceId);
                      return (
                        <SelectItem key={device.deviceId} value={device.deviceId}>
                          {canonical || device.label || `Video device ${index + 1}`}
                        </SelectItem>
                      );
                    })}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {selectedCanonical ? `Using: ${selectedCanonical}` : 'Pick a device to enable preview'}
              </p>
            </div>

            <div
              className="rounded-md border border-slate-200 p-3"
              data-testid="preview-step"
            >
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Preview
              </p>
              {isRunning ? (
                <Button
                  variant="outline"
                  onClick={preview.stop}
                  data-testid="stop-preview-button"
                >
                  <CircleStop aria-hidden="true" />
                  Stop Preview
                </Button>
              ) : (
                <Button
                  onClick={preview.start}
                  disabled={!hasSelection}
                  data-testid="start-preview-button"
                >
                  <Video aria-hidden="true" />
                  Start Preview
                </Button>
              )}
            </div>

            <Button
              onClick={continueToRecording}
              disabled={creating || !patientId}
              data-testid="continue-to-recording-button"
            >
              {creating ? 'Preparing…' : 'Continue to recording'}
              <ArrowRight aria-hidden="true" />
            </Button>
            {procedureError ? (
              <p
                role="alert"
                className="text-xs text-destructive"
                data-testid="procedure-error"
              >
                {procedureError}
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {creating
                ? 'Preparing procedure row…'
                : procedureId
                  ? 'Procedure row ready. Continue once you are happy with the framing.'
                  : 'Click Continue to start the procedure.'}
            </p>
          </aside>
        </section>
      </div>
    </main>
  );
}