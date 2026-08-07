import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Video } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import ProcedureNotesPanel from '@/components/procedure-notes-panel';
import DeviceLostBanner from '@/components/device-lost-banner';
import { RecordingControlsBar } from '@/components/RecordingControlsBar';
import { RecIndicator } from '@/components/RecIndicator';
import { FramingGuide } from '@/components/FramingGuide';
import { ScreenshotTimeline } from '@/components/ScreenshotTimeline';
import { useCaptureDeviceMap } from '@/hooks/useCaptureDeviceMap';
import { useMediaUrl } from '@/hooks/useMediaUrl';
import { useVideoPreview } from '@/hooks/useVideoPreview';
import { useScreenshotIntake } from '@/hooks/useScreenshotIntake';
import { useRoute } from '@/store/route';
import { recordingStore, useRecordingState, useTimerSnapshot, useLastLost } from '@/store/recording';
import { screenshotToastStore } from '@/store/screenshot-toast';
import { formatDurationHHMMSS } from '@/lib/format-duration';
import type { QualityPreset, Screenshot } from '@shared/ipc-contract';

export default function ProcedureRoom(): JSX.Element {
  const routeState = useRoute();
  const { navigate } = routeState;
  const route = routeState.current;
  const procedureIdFromRoute = route.name === 'procedure-room' ? route.procedureId : '';
  const patientIdFromRoute = route.name === 'procedure-room' ? route.patientId : '';

  const [procedureId] = useState<string | null>(procedureIdFromRoute || null);

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
  const [notesCollapsed, setNotesCollapsed] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const startInFlightRef = useRef(false);
  // ponytail: when recording, the preview is the MJPEG <img> at previewUrl;
  // when idle, it's the <video> from useVideoPreview. captureScreenshot
  // discriminates by element type, so the same hook drives both paths.
  const previewImgRef = useRef<HTMLImageElement | null>(null);

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

  useEffect(() => {
    const unsubscribe = window.api.recording.onStatus((status) => {
      recordingStore.setStatus(status);
    });
    return () => {
      unsubscribe();
      recordingStore.reset();
    };
  }, []);

  useEffect(() => {
    if (timer.isFrozen) {
      setTimerMs(timer.displayMs);
      return;
    }
    setTimerMs(timer.displayMs);
    const handle = setInterval(() => {
      const snap = recordingStore.__getState();
      if (snap.pausedAt !== null) return;
      const base = snap.timerStartedAt ?? snap.startedAt;
      if (base === null) {
        setTimerMs(0);
        return;
      }
      setTimerMs(Date.now() - base);
    }, 1000);
    return () => clearInterval(handle);
  }, [timer.isFrozen, timer.displayMs]);

  useEffect(() => {
    if (recordingState.status === 'stopped' && recordingState.procedureId) {
      const pid = recordingState.procedureId;
      recordingStore.reset();
      setPreviewUrl(null);
      navigate({ name: 'procedure-review', procedureId: pid });
    }
  }, [recordingState.status, recordingState.procedureId, navigate]);

  const isRecording =
    recordingState.status === 'recording' ||
    recordingState.status === 'paused' ||
    recordingState.status === 'lost';
  const isPaused = recordingState.status === 'paused';
  const recordingBusy =
    recordingState.status === 'starting' || recordingState.status === 'stopping';

  // Phase 5 / Plan 01 — screenshot intake. The hook targets whichever
  // element is currently the preview (img while recording, video otherwise).
  const screenshotIntake = useScreenshotIntake({
    procedureId: procedureId ?? '',
    sourceRef: (isRecording ? previewImgRef : preview.videoRef) as
      | React.RefObject<HTMLImageElement | HTMLVideoElement | null>,
    isRecording,
    startedAt: recordingState.startedAt,
  });
  // Plan 12 / G-05-15 — the room's gallery thumbnails need a
  // MediaServer URL to compose each <img> src. The hook is the same
  // one ProcedureReview uses (line 106); the URL stays bound across
  // page transitions so the IPC round-trip fires only once per app
  // session.
  const mediaUrl = useMediaUrl();
  // ponytail: 250 ms debounce against key auto-repeat so holding S
  // doesn't fire dozens of captures per second (D-02).
  const lastCaptureAtRef = useRef(0);
  async function handleScreenshotCapture(): Promise<void> {
    const now = Date.now();
    if (now - lastCaptureAtRef.current < 250) return;
    lastCaptureAtRef.current = now;
    const result = await screenshotIntake.capture();
    if (result) {
      toast.success('Screenshot captured');
    } else {
      toast.error('Failed to capture screenshot');
    }
  }

  // G-05-8 / G-05-13 — remove the thumbnail immediately, then let the
  // Toast-undo store schedule the disk + DB delete after its 5s window.
  function handleScreenshotDelete(s: Screenshot): void {
    screenshotIntake.remove(s.id);
    screenshotToastStore.enqueueDelete(s.id, s.procedureId);
    toast(`Screenshot deleted at ${formatDurationHHMMSS(s.timestampInVideoMs)}`, {
      duration: 5_000,
      action: {
        label: 'Undo',
        onClick: () => {
          screenshotToastStore.undoDelete(s.id);
          void screenshotIntake.refresh();
        },
      },
    });
  }

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
        const startResult = await window.api.recording.start({
          patientId: patientIdFromRoute,
          procedureId,
          deviceId: device,
          preset: resolvedPreset,
        });
        setPreviewUrl(startResult.previewUrl);
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

  // ponytail: keyboard shortcuts — Space (pause/resume), Esc (stop), R
  // (record), S (screenshot). Guarded so they don't fire while the doctor
  // is typing in the notes textarea. Modifier-key combos (Ctrl+R etc.)
  // bypass the page-level handler so the browser's reload shortcut still
  // works.
  useEffect(() => {
    function isTypingTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return true;
      if (target.isContentEditable) return true;
      return false;
    }
    function handler(e: KeyboardEvent): void {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (isRecording) handlePauseResumeToggle();
      } else if (e.key === 'Escape') {
        if (isRecording) {
          e.preventDefault();
          handleRecordToggle();
        }
      } else if (e.key === 'r' || e.key === 'R') {
        if (!isRecording) {
          e.preventDefault();
          handleRecordToggle();
        }
      } else if (e.key === 's' || e.key === 'S') {
        if (isRecording) {
          e.preventDefault();
          void handleScreenshotCapture();
        }
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isRecording, recordingState.status, procedureId]);

  const canRecord = !!(procedureId && selectedCanonical && preset);

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              Procedure Room
            </h1>
            <p className="text-sm text-muted-foreground">
              Record, pause, and review the colonoscopy procedure.
            </p>
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
          ) : (
            <span className="text-xs text-muted-foreground" aria-live="polite">
              Shortcuts: <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px]">Space</kbd>{' '}
              pause/resume · <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px]">Esc</kbd>{' '}
              stop · <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px]">R</kbd>{' '}
              record · <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px]">S</kbd>{' '}
              screenshot
            </span>
          )}
        </header>

        <section
          className={`grid gap-5 ${notesCollapsed ? 'lg:grid-cols-[minmax(0,1fr)]' : 'lg:grid-cols-[minmax(0,1fr)_20rem]'}`}
        >
          <div className="overflow-hidden rounded-xl border border-slate-800 bg-black shadow-2xl">
            <div className="relative aspect-video">
              {isRecording && previewUrl ? (
                <img
                  ref={previewImgRef}
                  src={previewUrl}
                  // G-05-3 + D-01 — crossOrigin=anonymous tells Chromium
                  // to issue a CORS-mode request. The server's
                  // Access-Control-Allow-Origin: * header (set as the
                  // first line of PreviewServer.onHttpRequest) lets the
                  // load succeed, and the resulting HTMLImageElement is
                  // not a tainted canvas source — the mid-procedure
                  // `S` hotkey screenshot capture path works without
                  // throwing DOMException for tainted canvases.
                  crossOrigin="anonymous"
                  alt="Live capture preview"
                  aria-label="Live capture preview"
                  className="size-full object-contain"
                  data-testid="live-preview-img"
                />
              ) : (
                <video
                  ref={preview.videoRef}
                  autoPlay
                  muted
                  playsInline
                  aria-label="Live capture preview"
                  className="size-full object-contain"
                />
              )}
              <FramingGuide />
              <RecIndicator visible={recordingState.status === 'recording'} paused={isPaused} />
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
              <RecordingControlsBar
                isRecording={isRecording}
                recordingBusy={recordingBusy}
                isPaused={isPaused}
                canRecord={canRecord}
                startInFlight={startInFlight}
                timerLabel={timerLabel}
                pauseCount={recordingState.currentSegmentIndex}
                startError={startError}
                onRecordToggle={handleRecordToggle}
                onPauseResumeToggle={handlePauseResumeToggle}
                onCapture={handleScreenshotCapture}
              />
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
              <ProcedureNotesPanel procedureId={procedureId} />
              <DeviceLostBanner
                lastLost={lastLost}
                onDismiss={() => recordingStore.clearLastLost()}
              />
              {isRecording || screenshotIntake.screenshots.length > 0 ? (
                // G-05-8 / Plan 07 — mid-procedure gallery fed by the
                // existing useScreenshotIntake.screenshots state. The same
                // <ScreenshotTimeline> surface as ProcedureReview; onSeek
                // is a no-op (no <video> to seek during recording) and
                // onAnnotate is intentionally not passed (annotations are
                // review-only). The +Capture button reuses the room's
                // handleScreenshotCapture so the S hotkey and the
                // timeline button are interchangeable.
                <div
                  className="flex flex-col gap-2"
                  data-testid="procedure-room-gallery-section"
                >
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Captured screenshots
                  </h3>
                  <ScreenshotTimeline
                    procedureId={procedureId ?? ''}
                    patientId={patientIdFromRoute}
                    mediaBaseUrl={mediaUrl.url}
                    status={isRecording ? 'recording' : 'completed'}
                    screenshots={screenshotIntake.screenshots}
                    onSeek={() => undefined}
                    onCapture={() => {
                      void handleScreenshotCapture();
                    }}
                    onDelete={handleScreenshotDelete}
                    testId="procedure-room-gallery"
                  />
                </div>
              ) : null}
            </aside>
          ) : (
            <div className="flex items-start justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setNotesCollapsed(false)}
                aria-label="Show notes panel"
              >
                Show notes
              </Button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}