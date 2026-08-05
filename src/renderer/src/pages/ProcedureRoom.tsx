import { useEffect, useMemo, useRef, useState } from 'react';
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
import ProcedureNotesPanel from '@/components/procedure-notes-panel';
import { useCaptureDeviceMap } from '@/hooks/useCaptureDeviceMap';
import { useVideoPreview } from '@/hooks/useVideoPreview';
import { useRoute } from '@/store/route';
import { recordingStore, useRecordingState } from '@/store/recording';
import { formatDurationHHMMSS } from '@/lib/format-duration';
import type { Procedure, QualityPreset } from '@shared/ipc-contract';

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
  const routeState = useRoute();
  const { previous, navigate } = routeState;
  const route = routeState.current;
  const patientIdFromRoute = route.name === 'procedure-room' ? route.patientId ?? '' : '';
  const { browser, loading, error: deviceError, lookup, pickBrowserId } = useCaptureDeviceMap();
  const [savedDevice, setSavedDevice] = useState<string | null>(null);
  const [selectedBrowserId, setSelectedBrowserId] = useState<string | null>(null);
  const [preset, setPreset] = useState<QualityPreset>();
  const [defaultLoaded, setDefaultLoaded] = useState(false);
  const [procedureId, setProcedureId] = useState<string | null>(null);
  const procedureInitRef = useRef(false);
  const deviceInitRef = useRef(false);
  const preview = useVideoPreview(selectedBrowserId, preset);
  const recordingState = useRecordingState();
  const [timerMs, setTimerMs] = useState(0);

  // Subscribe to recording:status once on mount (per D-02 + PITFALLS perf hint).
  useEffect(() => {
    const unsubscribe = window.api.recording.onStatus((status) => {
      recordingStore.setStatus(status);
    });
    return () => {
      unsubscribe();
      recordingStore.reset();
    };
  }, []);

  // Tick the timer once a second while recording.
  useEffect(() => {
    if (recordingState.status !== 'recording' && recordingState.status !== 'paused') {
      setTimerMs(0);
      return;
    }
    const tick = (): void => {
      setTimerMs(recordingState.startedAt ? Date.now() - recordingState.startedAt : 0);
    };
    tick();
    const handle = setInterval(tick, 1000);
    return () => clearInterval(handle);
  }, [recordingState.status, recordingState.startedAt]);

  // Navigate to procedure-review on stopped (per D-05).
  useEffect(() => {
    if (recordingState.status === 'stopped' && recordingState.procedureId) {
      const pid = recordingState.procedureId;
      recordingStore.reset();
      navigate({ name: 'procedure-review', procedureId: pid });
    }
  }, [recordingState.status, recordingState.procedureId, navigate]);

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

  // Per Plan 02 — create the procedure row once on mount so the notes panel
  // has a stable id and the recording.start call can attach to it.
  useEffect(() => {
    if (procedureInitRef.current) return;
    if (!patientIdFromRoute) return;
    procedureInitRef.current = true;
    let cancelled = false;
    void window.api.procedures
      .create({ patientId: patientIdFromRoute })
      .then((row: Procedure) => {
        if (!cancelled) setProcedureId(row.id);
      })
      .catch(() => {
        // ponytail: surface a non-fatal state by leaving procedureId null;
        // the notes panel disables itself and Record is gated downstream.
        if (!cancelled) procedureInitRef.current = false;
      });
    return () => {
      cancelled = true;
    };
  }, [patientIdFromRoute]);

  useEffect(() => {
    if (loading || !defaultLoaded || deviceInitRef.current) return;
    deviceInitRef.current = true;
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
  const isRecording = recordingState.status === 'recording' || recordingState.status === 'paused';
  const recordingBusy = recordingState.status === 'starting' || recordingState.status === 'stopping';

  const timerLabel = useMemo(() => {
    if (!recordingState.startedAt || (recordingState.status !== 'recording' && recordingState.status !== 'paused')) {
      return '00:00:00';
    }
    return formatDurationHHMMSS(timerMs);
  }, [recordingState.startedAt, recordingState.status, timerMs]);

  function handleRecordToggle(): void {
    if (!selectedCanonical || !preset) return;
    if (isRecording) {
      void window.api.recording.stop().catch(() => undefined);
    } else {
      void window.api.recording
        .start({
          patientId: patientIdFromRoute,
          procedureId: procedureId ?? undefined,
          deviceId: selectedCanonical,
          preset,
        })
        .catch(() => undefined);
    }
  }

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
          {!isRecording ? (
            <Button variant="outline" onClick={finish}>
              Finish
            </Button>
          ) : null}
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
                disabled={loading || browser.length === 0 || isRecording}
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

            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Procedure duration
              </p>
              <p
                aria-label="Procedure duration"
                className="font-mono text-2xl tabular-nums text-foreground"
                data-testid="procedure-duration"
              >
                {timerLabel}
              </p>
            </div>

            {deviceError ? <p role="alert" className="text-sm text-destructive">{deviceError}</p> : null}
            {preview.error ? <p role="alert" className="text-sm text-destructive">{preview.error.message}</p> : null}

            <div className="flex flex-col gap-2">
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
              {isRecording ? (
                <Button variant="destructive" onClick={handleRecordToggle} disabled={recordingBusy}>
                  <CircleStop aria-hidden="true" />
                  Stop
                </Button>
              ) : (
                <Button
                  onClick={handleRecordToggle}
                  disabled={!hasSelection || !preset || recordingBusy}
                >
                  <CircleStop aria-hidden="true" />
                  Record
                </Button>
              )}
            </div>

            <ProcedureNotesPanel procedureId={procedureId} />
          </aside>
        </section>
      </div>
    </main>
  );
}
