// Procedure Review — Phase 5 / Plan 03. Per D-10 + D-12 + D-13 — video left,
// scrubber + screenshot timeline below the video, right rail gains the
// read-only Notes accordion + the conditional `<DeviceLostBanner>` for
// partial recordings + the new `<TrimControls>` panel.
//
// Plan 03 wires:
//   - the `/media/` route on the long-lived MediaServer (via useMediaUrl)
//     to source the `<video>` element;
//   - the trim handles on the Scrubber (via useTrim);
//   - the right-rail Trim panel (via TrimControls + useTrim).
//
// D-11 — the Scrubber receives `segments` from `useProcedures` so pause
// markers render as tick marks. The default no-pause case (zero segments)
// renders a clean track.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import DeviceLostBanner from '@/components/device-lost-banner';
import { DestructivePartialAlert } from '@/components/DestructivePartialAlert';
import { Scrubber } from '@/components/Scrubber';
import { ScreenshotTimeline } from '@/components/ScreenshotTimeline';
import { ProcedureNotesReview } from '@/components/ProcedureNotesReview';
import { StatusBadge } from '@/components/StatusBadge';
import { TrimControls } from '@/components/TrimControls';
import { useProcedures } from '@/hooks/useProcedures';
import { useRoute } from '@/store/route';
import { useLastLost, recordingStore } from '@/store/recording';
import { useScreenshotToasts, screenshotToastStore } from '@/store/screenshot-toast';
import { useMediaUrl } from '@/hooks/useMediaUrl';
import { useTrim } from '@/hooks/useTrim';
import { captureScreenshot } from '@/lib/capture-screenshot';
import { formatDurationHHMMSS } from '@/lib/format-duration';
import type { Patient, Procedure, Screenshot } from '@shared/ipc-contract';

function formatTimestamp(ms: number | null): string {
  if (ms === null) return '—';
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

// Per D-13 — the doctor can play + capture on partial recordings, but Trim
// is disabled (no meaningful cut for a half-formed mp4). For Plan 02 we
// just expose the playback + capture; Trim ships in Plan 03.
function isInteractiveStatus(status: string): boolean {
  return status === 'recording' || status === 'completed' || status === 'partial';
}

export default function ProcedureReview({
  procedureId: initialId,
}: {
  procedureId?: string;
} = {}): JSX.Element {
  const { navigate } = useRoute();
  const route = useRoute().current;
  const routeProcedureId = route.name === 'procedure-review' ? route.procedureId : null;
  const procedureId = initialId ?? routeProcedureId ?? null;

  const { procedure, segments, screenshots, refresh, updateAnnotation } = useProcedures(procedureId);
  const lastLost = useLastLost();
  const mediaUrl = useMediaUrl();

  // Fetch the patient row separately so the metadata sidebar shows the
  // full name (procedure.patientId is a UUID, not human-readable).
  const [patient, setPatient] = useState<Patient | null>(null);
  useEffect(() => {
    if (!procedure?.patientId) {
      setPatient(null);
      return;
    }
    let cancelled = false;
    // ponytail: optional-chain `.then` so a mid-render mutation of
    // `window.api` (cascade pollution from a prior test's stashed
    // microtask) cannot crash the render with "Cannot read properties
    // of undefined (reading 'then')". Production callers always seed
    // `window.api` before mount; the optional chain is a defensive
    // zero-cost guard for renderer tests + HMR edge cases.
    const promise = window.api.patients?.get?.(procedure.patientId);
    if (promise && typeof promise.then === 'function') {
      promise
        .then((row) => {
          if (!cancelled) setPatient(row);
        })
        .catch(() => {
          if (!cancelled) setPatient(null);
        });
    } else if (!cancelled) {
      setPatient(null);
    }
    return () => {
      cancelled = true;
    };
  }, [procedure?.patientId]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [currentMs, setCurrentMs] = useState(0);

  const durationMs = useMemo(() => {
    if (!procedure) return 0;
    return procedure.durationSeconds * 1000;
  }, [procedure?.durationSeconds]);

  // Plan 03 — trim orchestration. The hook returns inMs/outMs local
  // state + IPC round-trip wiring; the parent passes the updated
  // procedure back to refresh the right-rail metadata.
  const trim = useTrim(procedureId ?? '', durationMs, useCallback((updated: Procedure) => {
    // Refresh procedure + everything else so the new videoPath + the
    // restored videoPath flow through.
    void refresh();
    // Reload the <video> element so the trimmed / restored mp4 plays.
    // The src recomposes below in the effect that depends on
    // procedure.videoPath.
    const v = videoRef.current;
    if (v) v.load();
    void updated;
  }, [refresh]));

  // Compose the media URL. The procedure's `videoPath` is the userData-
  // relative form (e.g. `data/media/patients/<p>/<proc>/video.mp4`);
  // we only want the leaf filename for the MediaServer's `/media/`
  // route.
  const videoSrc = useMemo(() => {
    if (!mediaUrl.url || !procedure?.videoPath) return null;
    const fileName = procedure.videoPath.replace(/^.*[\\/]/, '');
    return `${mediaUrl.url}/media/${procedure.patientId}/${procedure.id}/${fileName}`;
  }, [mediaUrl.url, procedure?.videoPath, procedure?.patientId, procedure?.id]);

  // Reload the <video> element when the src recomposes (post-trim or
  // post-restore). The `procedure.videoPath` dep is the trigger.
  useEffect(() => {
    const v = videoRef.current;
    if (v && videoSrc) {
      v.load();
    }
  }, [videoSrc]);

  // Track video time updates while playing.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTimeUpdate = (): void => {
      setCurrentMs(Math.max(0, Math.round(video.currentTime * 1000)));
    };
    video.addEventListener('timeupdate', onTimeUpdate);
    return () => video.removeEventListener('timeupdate', onTimeUpdate);
  }, [procedure?.id]);

  const handleSeek = useCallback((ms: number): void => {
    setCurrentMs(ms);
    const video = videoRef.current;
    if (video) {
      video.currentTime = ms / 1000;
    }
  }, []);

  const handleCapture = useCallback(async (): Promise<void> => {
    const video = videoRef.current;
    if (!video) {
      toast.error('Video not ready');
      return;
    }
    if (video.readyState < 2) {
      toast.error('Video metadata not loaded yet');
      return;
    }
    try {
      const { base64 } = await captureScreenshot(video);
      const timestampInVideoMs = Math.max(0, Math.round(video.currentTime * 1000));
      if (!procedure) return;
      await window.api.screenshots.add({
        procedureId: procedure.id,
        timestampInVideoMs,
        jpegBase64: base64,
      });
      toast.success('Screenshot captured');
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to capture screenshot');
    }
  }, [procedure, refresh]);

  const handleDelete = useCallback((s: Screenshot): void => {
    // Optimistic UI: remove the screenshot from local state immediately
    // so the × visual feels instant (D-12). The Toast store schedules
    // the actual IPC delete after 5s; the user can Undo before then.
    void refresh().then(() => undefined);
    screenshotToastStore.enqueueDelete(s.id, s.procedureId);
    toast(`Screenshot deleted at ${formatDurationHHMMSS(s.timestampInVideoMs)}`, {
      duration: 5_000,
      action: {
        label: 'Undo',
        onClick: () => screenshotToastStore.undoDelete(s.id),
      },
    });
  }, [refresh]);

  const handleAnnotate = useCallback(
    async (screenshot: Screenshot, annotation: string | null): Promise<void> => {
      try {
        await updateAnnotation(screenshot.id, annotation);
      } catch {
        // toast already fired inside updateAnnotation
      }
    },
    [updateAnnotation],
  );

  // ponytail: subscribe to the toast store so its listeners stay wired
  // (mirrors Plan 01). The subscription is otherwise unused.
  const toasts = useScreenshotToasts();
  void toasts;

  if (!procedureId) {
    return (
      <main className="min-h-screen bg-slate-100 p-6">
        <div className="mx-auto max-w-7xl">
          <p className="text-sm text-slate-500">Missing procedure id.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Review
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">Procedure</h1>
          </div>
          <Button
            variant="outline"
            onClick={() =>
              procedure
                ? navigate({ name: 'patient-detail', id: procedure.patientId })
                : navigate({ name: 'patients' })
            }
            data-testid="procedure-review-back"
          >
            <ArrowLeft aria-hidden="true" />
            {procedure ? 'Back to Patient' : 'Back'}
          </Button>
        </header>

        <section className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex flex-col gap-3" data-testid="procedure-review-left">
            <div className="overflow-hidden rounded-lg bg-slate-900">
              <video
                ref={videoRef}
                controls
                preload="metadata"
                className="aspect-video w-full"
                data-testid="procedure-review-video"
                aria-label="Procedure recording playback"
                src={videoSrc ?? undefined}
              />
              {procedure && !isInteractiveStatus(procedure.status) ? (
                <div className="bg-slate-100 p-6 text-center text-sm text-slate-500">
                  Playback unavailable — procedure status is {procedure.status}.
                </div>
              ) : null}
              {!procedure?.videoPath ? (
                <div className="bg-slate-100 p-6 text-center text-sm text-slate-500">
                  Video preview unavailable — record a procedure first.
                </div>
              ) : null}
            </div>
            <Scrubber
              durationMs={durationMs}
              currentMs={currentMs}
              onSeek={handleSeek}
              segments={segments}
              trimMode={trim.trimMode}
              inMs={trim.inMs}
              outMs={trim.outMs}
              onTrim={(range) => {
                trim.setInMs(range.inMs);
                trim.setOutMs(range.outMs);
              }}
            />
            <ScreenshotTimeline
              procedureId={procedureId}
              status={procedure?.status}
              screenshots={screenshots}
              onSeek={handleSeek}
              onCapture={handleCapture}
              onDelete={handleDelete}
              onAnnotate={handleAnnotate}
            />
          </div>

          <aside className="flex flex-col gap-3" data-testid="procedure-review-right">
            <ProcedureNotesReview
              procedureId={procedureId}
              status={procedure?.status ?? 'completed'}
            />

            <TrimControls
              status={procedure?.status ?? 'completed'}
              videoPathOriginal={procedure?.videoPathOriginal ?? null}
              inMs={trim.inMs}
              outMs={trim.outMs}
              trimMode={trim.trimMode}
              setTrimMode={trim.setTrimMode}
              applying={trim.applying}
              restoring={trim.restoring}
              apply={trim.apply}
              restore={trim.restore}
            />

            <Card data-testid="procedure-review-metadata">
              <CardHeader>
                <CardTitle>Procedure</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                {procedure ? (
                  <>
                    <p>
                      <span className="font-medium">Patient:</span>{' '}
                      {patient ? patient.fullName : procedure.patientId.slice(0, 8)}
                    </p>
                    <p>
                      <span className="font-medium">Started:</span>{' '}
                      {formatTimestamp(procedure.startedAt)}
                    </p>
                    <p>
                      <span className="font-medium">Ended:</span>{' '}
                      {formatTimestamp(procedure.endedAt)}
                    </p>
                    <p>
                      <span className="font-medium">Duration:</span>{' '}
                      {formatDurationHHMMSS(durationMs)}
                    </p>
                    <p>
                      <span className="font-medium">Status:</span>{' '}
                    </p>
                    <div>
                      <StatusBadge status={procedure.status} />
                    </div>
                  </>
                ) : (
                  <p className="text-muted-foreground">Loading…</p>
                )}
              </CardContent>
            </Card>

            {procedure?.status === 'partial' ? (
              <DestructivePartialAlert
                status={procedure.status}
                videoPath={procedure.videoPath}
                lastKnownTimestampMs={lastLost?.lastKnownTimestampMs ?? null}
              />
            ) : null}
            {procedure?.status === 'partial' && procedure.videoPath.endsWith('.partial.mp4') ? (
              <DeviceLostBanner
                lastLost={lastLost}
                onDismiss={() => recordingStore.clearLastLost()}
              />
            ) : null}
          </aside>
        </section>
      </div>
    </main>
  );
}
