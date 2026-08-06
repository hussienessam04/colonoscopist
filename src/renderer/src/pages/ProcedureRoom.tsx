import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CircleStop, Pause, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ProcedureNotesPanel from '@/components/procedure-notes-panel';
import DeviceLostBanner from '@/components/device-lost-banner';
import { useRoute } from '@/store/route';
import { recordingStore, useRecordingState, useTimerSnapshot, useLastLost } from '@/store/recording';
import { formatDurationHHMMSS } from '@/lib/format-duration';

export default function ProcedureRoom(): JSX.Element {
  const routeState = useRoute();
  const { navigate } = routeState;
  const route = routeState.current;
  const procedureIdFromRoute = route.name === 'procedure-room' ? route.procedureId : '';
  const patientIdFromRoute = route.name === 'procedure-room' ? route.patientId : '';

  // Procedure row id comes from the route (created on ProcedurePreview mount).
  // The recording.start call reuses this id via the `procedureId` IPC arg.
  const [procedureId] = useState<string | null>(procedureIdFromRoute || null);

  const recordingState = useRecordingState();
  const timer = useTimerSnapshot();
  const lastLost = useLastLost();
  const [timerMs, setTimerMs] = useState(0);
  const recordingInitRef = useRef(false);

  // Subscribe to recording:status once on mount.
  useEffect(() => {
    if (recordingInitRef.current) return;
    recordingInitRef.current = true;
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
    // Read the device + preset saved on the Preview page, then start.
    // Stored via capture.getDefaultDevice + capture.getPreset (set there).
    void (async (): Promise<void> => {
      try {
        const device = await window.api.capture.getDefaultDevice();
        if (!device) return;
        const preset = await window.api.capture.getPreset({ deviceId: device });
        if (!preset) return;
        await window.api.recording.start({
          patientId: patientIdFromRoute,
          procedureId,
          deviceId: device,
          preset,
        });
      } catch {
        // Surface via the standard error path (ipcMain throws → renderer
        // catches); nothing else to do.
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
          <div className="overflow-hidden rounded-xl border bg-card p-8 shadow-sm">
            <div className="flex flex-col gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Procedure duration
                </p>
                <p
                  aria-label="Procedure duration"
                  className="font-mono text-5xl tabular-nums text-foreground"
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
                    disabled={!procedureId || recordingBusy}
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