import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CircleStop, Pause, Play, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ProcedureNotesPanel from '@/components/procedure-notes-panel';
import DeviceLostBanner from '@/components/device-lost-banner';
import { useCaptureDeviceMap } from '@/hooks/useCaptureDeviceMap';
import { useVideoPreview } from '@/hooks/useVideoPreview';
import { useRoute } from '@/store/route';
import { recordingStore, useRecordingState, useTimerSnapshot, useLastLost } from '@/store/recording';
import { formatDurationHHMMSS } from '@/lib/format-duration';
import type { QualityPreset } from '@shared/ipc-contract';

export default function ProcedureRoom(): JSX.Element {
  const routeState = useRoute();
  const { navigate } = routeState;
  const route = routeState.current;
  const procedureIdFromRoute = route.name === 'procedure-room' ? route.procedureId : '';
  const patientIdFromRoute = route.name === 'procedure-room' ? route.patientId : '';

  // Procedure row id comes from the route (created on ProcedurePreview mount).
  // The recording.start call reuses this id via the `procedureId` IPC arg.
  const [procedureId] = useState<string | null>(procedureIdFromRoute || null);

  // Live preview is shown here too — the doctor needs to see what is being
  // captured during the procedure. ffmpeg will lock the device once
  // recording starts; the preview may go dark or show a "Recording —
  // preview locked" overlay depending on driver behaviour.
  const { lookup, pickBrowserId } = useCaptureDeviceMap();
  const [savedDevice, setSavedDevice] = useState<string | null>(null);
  const [selectedBrowserId, setSelectedBrowserId] = useState<string | null>(null);
  const [defaultLoaded, setDefaultLoaded] = useState(false);
  const [preset, setPreset] = useState<QualityPreset>();
  const deviceInitRef = useRef(false);
  const preview = useVideoPreview(selectedBrowserId, preset);

  const recordingState = useRecordingState();
  const timer = useTimerSnapshot();
  const lastLost = useLastLost();
  const [timerMs, setTimerMs] = useState(0);
  const [startInFlight, setStartInFlight] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  // Ref-based in-flight guard so a fast double-click can't sneak past
  // before React re-renders the disabled state.
  const startInFlightRef = useRef(false);

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
    if (!defaultLoaded || !savedDevice || deviceInitRef.current) return;
    // pickBrowserId() depends on the hook's browser+dshow mapping; if the
    // mapping hasn't resolved yet it returns undefined. Wait until we get
    // a real browser deviceId before committing + locking.
    const browserId = pickBrowserId(savedDevice);
    if (browserId === undefined) return;
    setSelectedBrowserId(browserId);
    deviceInitRef.current = true;
  }, [defaultLoaded, pickBrowserId, savedDevice]);

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

  // Subscribe to recording:status on mount. React 18 StrictMode runs
  // effects twice in dev (mount/unmount/remount). We let React handle
  // the lifecycle — no manual guard ref — so the second mount gets its
  // own listener. (The previous recordingInitRef guard suppressed the
  // second mount's subscribe, leaving the live component with no
  // listener — which is why the timer never ticked even though main
  // emitted 'started' status rows.)
  useEffect(() => {
    const unsubscribe = window.api.recording.onStatus((status) => {
      recordingStore.setStatus(status);
    });
    return () => {
      unsubscribe();
      recordingStore.reset();
    };
  }, []);

  // Local timer tick driver.
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

  // Navigate to procedure-review on stopped.
  useEffect(() => {
    if (recordingState.status === 'stopped' && recordingState.procedureId) {
      const pid = recordingState.procedureId;
      recordingStore.reset();
      navigate({ name: 'procedure-review', procedureId: pid });
    }
  }, [recordingState.status, recordingState.procedureId, navigate]);

  const isRecording =
    recordingState.status === 'recording' ||
    recordingState.status === 'paused' ||
    recordingState.status === 'lost';
  const recordingBusy =
    recordingState.status === 'starting' || recordingState.status === 'stopping';

  const timerLabel = useMemo(() => {
    if (!recordingState.startedAt || (recordingState.status !== 'recording' && recordingState.status !== 'paused')) {
      return '00:00:00';
    }
    return formatDurationHHMMSS(timerMs);
  }, [recordingState.startedAt, recordingState.status, timerMs]);

  function handleRecordToggle(): void {
    if (!procedureId) return;
    if (isRecording) {
      void window.api.recording.stop({ procedureId }).catch(() => undefined);
      return;
    }
    if (startInFlightRef.current) return;
    startInFlightRef.current = true;
    setStartInFlight(true);
    setStartError(null);
    void (async (): Promise<void> => {
      try {
        const device = await window.api.capture.getDefaultDevice();
        if (!device) {
          setStartError('No default capture device set. Open Settings → Capture and pick one.');
          return;
        }
        const resolvedPreset = await window.api.capture.getPreset({ deviceId: device });
        if (!resolvedPreset) {
          setStartError('No preset saved for this device. Save one in Settings → Capture.');
          return;
        }
        await window.api.recording.start({
          patientId: patientIdFromRoute,
          procedureId,
          deviceId: device,
          preset: resolvedPreset,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Could not start recording.';
        setStartError(msg);
      } finally {
        startInFlightRef.current = false;
        setStartInFlight(false);
      }
    })();
  }

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
              Step 2
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">Procedure Room</h1>
          </div>
          {!isRecording ? (
            <Button
              variant="outline"
              onClick={() =>
                navigate({
                  name: 'procedure-preview',
                  patientId: patientIdFromRoute,
                  procedureId: procedureId ?? undefined,
                })
              }
            >
              <ArrowLeft aria-hidden="true" />
              Back to Preview
            </Button>
          ) : null}
        </header>

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex flex-col gap-4">
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
                {!defaultLoaded ? (
                  <div className="absolute inset-0 grid place-items-center text-sm text-slate-400">
                    Finding capture devices…
                  </div>
                ) : !selectedCanonical ? (
                  <div className="absolute inset-0 grid place-items-center p-6 text-center text-white">
                    <div className="flex max-w-md flex-col items-center gap-3">
                      <Video className="size-9 text-slate-400" aria-hidden="true" />
                      <p className="font-medium">No device selected — set a default in Settings → Capture</p>
                      <Button
                        variant="secondary"
                        onClick={() => navigate({ name: 'settings-capture' })}
                      >
                        Open Settings
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col gap-2 rounded-xl border bg-card p-5 shadow-sm">
              <div className="flex flex-col gap-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Procedure duration
                </p>
                <p
                  aria-label="Procedure duration"
                  className="font-mono text-3xl tabular-nums text-foreground"
                  data-testid="procedure-duration"
                >
                  {timerLabel}
                </p>
                {recordingState.currentSegmentIndex > 0 &&
                recordingState.status !== 'idle' &&
                recordingState.status !== 'stopped' &&
                recordingState.status !== null ? (
                  <p className="text-xs text-muted-foreground" data-testid="pause-count">
                    Pause #{recordingState.currentSegmentIndex}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-col gap-2" data-testid="recording-step">
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
                    disabled={!procedureId || recordingBusy || startInFlight || !selectedCanonical || !preset}
                    data-testid="record-button"
                  >
                    <CircleStop aria-hidden="true" />
                    Start Recording
                  </Button>
                )}
                {startError ? (
                  <p
                    role="alert"
                    className="text-xs text-destructive"
                    data-testid="start-error"
                  >
                    {startError}
                  </p>
                ) : null}
                {recordingState.status === 'recording' ? (
                  <Button
                    variant="outline"
                    onClick={handlePauseResumeToggle}
                    disabled={recordingBusy}
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
                    data-testid="resume-button"
                  >
                    <Play aria-hidden="true" />
                    Resume
                  </Button>
                ) : null}
              </div>
            </div>
          </div>

          <aside className="flex flex-col gap-5 rounded-xl border bg-card p-5 shadow-sm">
            <ProcedureNotesPanel procedureId={procedureId} />

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