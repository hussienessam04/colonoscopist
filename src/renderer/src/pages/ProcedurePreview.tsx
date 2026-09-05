import { useEffect, useState, useRef } from 'react';
import { ArrowRight, Camera, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FramingGuide } from '@/components/FramingGuide';
import { useCaptureDeviceMap } from '@/hooks/useCaptureDeviceMap';
import { useVideoPreview } from '@/hooks/useVideoPreview';
import EmptyStateCard from '@/components/EmptyStateCard';
import { useRoute } from '@/store/route';
import { safeInvoke } from '@/lib/ipc-result';
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
  const [notesCollapsed, setNotesCollapsed] = useState(false);
  const deviceInitRef = useRef(false);

  const preview = useVideoPreview(selectedBrowserId, undefined);
  const isRunning = preview.active || preview.starting;
  // ponytail: pull `start`/`stop` out so the auto-start effect doesn't
  // re-run on every render (preview object is recreated each render —
  // depending on the whole object would cause an infinite start/stop loop).
  const { start: previewStart, stop: previewStop } = preview;

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
    if (loading || !defaultLoaded || deviceInitRef.current) return;
    deviceInitRef.current = true;
    setSelectedBrowserId(savedDevice ? pickBrowserId(savedDevice) ?? null : null);
  }, [defaultLoaded, loading, pickBrowserId, savedDevice]);

  // ponytail: auto-start the preview as soon as the doctor picks a device.
  // Explicit Start/Stop button removed — picking a device implies "show me
  // the feed". The preview hook handles idempotent start (no double-stream).
  useEffect(() => {
    if (selectedBrowserId && !isRunning && !preview.error) {
      previewStart();
    }
    if (!selectedBrowserId && isRunning) {
      previewStop();
    }
  }, [selectedBrowserId, isRunning, preview.error, previewStart, previewStop]);

  const selectedCanonical = selectedBrowserId ? lookup(selectedBrowserId) : undefined;

  const [procedureId] = useState<string | null>(
    incomingProcedureId ?? null,
  );
  const [procedureError, setProcedureError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Plan 08-10 / G-08-4 — gate-rejected flag. The Continue-to-recording
  // button returns null from procedures.create when the gate rejects;
  // render <EmptyStateCard> so the user sees the License path.
  const [gated, setGated] = useState(false);

  const ready = !loading && defaultLoaded;
  const hasSelection = selectedBrowserId !== null;

  function openSettings(): void {
    navigate({ name: 'settings-capture' });
  }

  function continueToRecording(): void {
    if (!patientId || creating) return;
    if (procedureId) {
      preview.stop();
      navigate({
        name: 'procedure-room',
        patientId,
        procedureId,
      });
      return;
    }
    setCreating(true);
    setProcedureError(null);
    safeInvoke(window.api.procedures.create({ patientId }))
      .then((row: Procedure | null) => {
        if (row === null) {
          // Plan 08-10 / G-08-4 — gate rejected. Keep the user on the
          // preview page; the EmptyStateCard below guides them through
          // activating while the LicenseGate modal stays interactable.
          setCreating(false);
          setGated(true);
          return;
        }
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
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              Preview &amp; Setup
            </h1>
            <p className="text-sm text-muted-foreground">
              Pick the capture device, frame the shot, then continue to recording.
            </p>
          </div>
          <Button variant="outline" onClick={() => navigate({ name: 'patients' })}>
            Back to patients
          </Button>
        </header>

        <section
          className={`grid gap-5 ${notesCollapsed ? 'lg:grid-cols-[minmax(0,1fr)]' : 'lg:grid-cols-[minmax(0,1fr)_20rem]'}`}
        >
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
              <FramingGuide />
              {!ready || !hasSelection ? (
                <NoDeviceState openSettings={openSettings} />
              ) : null}
              {preview.error && hasSelection ? (
                <div className="absolute inset-0 grid place-items-center p-6 text-center text-white">
                  <div className="flex max-w-md flex-col items-center gap-3">
                    <Video aria-hidden="true" className="size-9 text-rose-400" />
                    <p className="font-medium">Could not open the capture device.</p>
                    <p className="text-xs text-slate-300">{preview.error.message}</p>
                    <Button variant="secondary" onClick={() => preview.start()}>
                      Retry
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {!notesCollapsed ? (
            <aside className="flex flex-col gap-5 rounded-xl border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Side panel
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setNotesCollapsed(true)}
                  aria-label="Collapse notes panel"
                >
                  Hide
                </Button>
              </div>
              {deviceError ? (
                <p role="alert" className="text-sm text-destructive">
                  {deviceError}
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
                className="flex flex-col gap-2 rounded-md border border-slate-200 p-3"
                data-testid="preview-step"
              >
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Preview
                </p>
                <p className="text-sm text-foreground">
                  {isRunning ? 'Streaming live feed.' : 'Idle.'}
                </p>
              </div>

              <Button
                onClick={continueToRecording}
                disabled={creating || !patientId}
                data-testid="continue-to-recording-button"
                size="lg"
                className="w-full"
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
              {gated ? <EmptyStateCard /> : null}
              <p className="text-xs text-muted-foreground">
                {creating
                  ? 'Preparing procedure row…'
                  : procedureId
                    ? 'Procedure row ready. Continue once you are happy with the framing.'
                    : 'Click Continue to start the procedure.'}
              </p>
            </aside>
          ) : (
            <div className="flex items-start justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setNotesCollapsed(false)}
                aria-label="Show side panel"
              >
                Show side panel
              </Button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}