import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, CircleStop, Pause, Play, Settings, Video } from 'lucide-react';
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
import DeviceLostBanner from '@/components/device-lost-banner';
import { useCaptureDeviceMap } from '@/hooks/useCaptureDeviceMap';
import { useVideoPreview } from '@/hooks/useVideoPreview';
import { useRoute } from '@/store/route';
import { recordingStore, useRecordingState, useTimerSnapshot, useLastLost } from '@/store/recording';
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
  // ponytail: timer display is owned by the store via useTimerSnapshot() so
  // the pause anchor freezes the visible HH:MM:SS (D-11).
  const timer = useTimerSnapshot();
  // Plan 04 — DeviceLostBanner data. Per-slice selector so only the banner
  // re-renders when lastLost changes.
  const lastLost = useLastLost();
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

  // ponytail: keep a local `timerMs` tick driver so non-paused displays
  // continue to count every second. When paused, the snapshot freezes and
  // the local timer also freezes (the useTimerSnapshot selector returns
  // isFrozen=true; we skip the setState on frozen frames).
  useEffect(() => {
    if (timer.isFrozen) {
      setTimerMs(timer.displayMs);
      return;
    }
    setTimerMs(timer.displayMs);
    const handle = setInterval(() => {
      const snap = recordingStore.__getState();
      if (snap.pausedAt !== null) return;
      if (snap.startedAt === null) {
        setTimerMs(0);
        return;
      }
      setTimerMs(Date.now() - snap.startedAt);
    }, 1000);
    return () => clearInterval(handle);
  }, [timer.isFrozen, timer.displayMs]);

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
  // Plan 04 — keep Stop button enabled in 'lost' state so the doctor can
  // finalize the partial mp4 (D-03). 'lost' is the device-disconnected state;
  // finalize-as-partial is wired in the supervisor.
  const isRecording =
    recordingState.status === 'recording' ||
    recordingState.status === 'paused' ||
    recordingState.status === 'lost';
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
      if (!procedureId) return;
      void window.api.recording.stop({ procedureId }).catch(() => undefined);
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

  // Pause/Resume click handler. The button itself is disabled outside the
  // allowed states (see render); this only runs when enabled.
  function handlePauseResumeToggle(): void {
    if (!procedureId) return;
    if (recordingState.status === 'recording') {
      void window.api.recording.pause({ procedureId }).catch(() => undefined);
    } else if (recordingState.status === 'paused') {
      void window.api.recording.resume({ procedureId }).catch(() => undefined);
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
              {recordingState.currentSegmentIndex > 0 && recordingState.status !== 'idle' && recordingState.status !== 'stopped' && recordingState.status !== null ? (
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="pause-count"
                >
                  Pause #{recordingState.currentSegmentIndex}
                </p>
              ) : null}
            </div>

            {deviceError ? <p role="alert" className="text-sm text-destructive">{deviceError}</p> : null}
            {preview.error ? <p role="alert" className="text-sm text-destructive">{preview.error.message}</p> : null}

            <div className="flex flex-col gap-4">
              {/* Step 1 — Preview. Always available once a device is selected.
                  Preview and Recording are two separate flows; the Record
                  button stays disabled until the preview is running so the
                  doctor sees the live feed before committing to capture. */}
              <div
                className="rounded-md border border-slate-200 p-3"
                data-testid="preview-step"
              >
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Step 1 · Preview
                </p>
                {isRunning ? (
                  <Button variant="outline" onClick={preview.stop} data-testid="stop-preview-button">
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

              {/* Step 2 — Recording. Gated on preview running so the doctor
                  doesn't capture before verifying the device + framing. */}
              <div
                className="rounded-md border border-slate-200 p-3"
                data-testid="recording-step"
              >
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Step 2 · Recording
                </p>
                {!isRunning && !isRecording ? (
                  <p className="text-xs text-muted-foreground">
                    Start preview to enable recording.
                  </p>
                ) : null}
                {isRecording ? (
                  <Button
                    variant="destructive"
                    onClick={handleRecordToggle}
                    disabled={recordingBusy}
                    data-testid="stop-recording-button"
                  >
                    <CircleStop aria-hidden="true" />
                    Stop Recording
                  </Button>
                ) : (
                  <Button
                    onClick={handleRecordToggle}
                    disabled={!isRunning || !hasSelection || !preset || recordingBusy}
                    data-testid="record-button"
                  >
                    <CircleStop aria-hidden="true" />
                    Start Recording
                  </Button>
                )}
                {recordingState.status === 'recording' ? (
                  <Button
                    variant="outline"
                    onClick={handlePauseResumeToggle}
                    disabled={recordingBusy}
                    className="mt-2"
                    data-testid="pause-button"
                  >
                    <Pause aria-hidden="true" />
                    Pause
                  </Button>
                ) : recordingState.status === 'paused' ? (
                  <Button
                    variant="outline"
                    onClick={handlePauseResumeToggle}
                    disabled={recordingBusy}
                    className="mt-2"
                    data-testid="resume-button"
                  >
                    <Play aria-hidden="true" />
                    Resume
                  </Button>
                ) : null}
              </div>
            </div>

            <ProcedureNotesPanel procedureId={procedureId} />

            {/* Plan 04 — DeviceLostBanner mounts INLINE below the notes panel.
                No modal, no overlay (per UX-Pitfalls: modal interruption during a
                procedure is forbidden). The banner is purely informational; the
                Stop button above stays enabled so the doctor can finalize as
                partial. */}
            <DeviceLostBanner
              lastLost={lastLost}
              onDismiss={() => recordingStore.clearLastLost()}
            />
          </aside>
        </section>
      </div>
    </main>
  );
}
