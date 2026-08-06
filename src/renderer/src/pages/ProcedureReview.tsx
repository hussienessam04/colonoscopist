// Procedure Review — Phase 5 / Plan 02. Per D-10 + D-12 + D-13 — video left,
// scrubber + screenshot timeline below the video, right rail gains the
// read-only Notes accordion + the conditional `<DeviceLostBanner>` for
// partial recordings. Plan 03 wires the `/media/` route on PreviewServer
// + the trim action panel.
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
import { Scrubber } from '@/components/Scrubber';
import { ScreenshotTimeline } from '@/components/ScreenshotTimeline';
import { ProcedureNotesReview } from '@/components/ProcedureNotesReview';
import { StatusBadge } from '@/components/StatusBadge';
import { useProcedures } from '@/hooks/useProcedures';
import { useRoute } from '@/store/route';
import { useLastLost, recordingStore } from '@/store/recording';
import { useScreenshotToasts, screenshotToastStore } from '@/store/screenshot-toast';
import { captureScreenshot } from '@/lib/capture-screenshot';
import { formatDurationHHMMSS } from '@/lib/format-duration';
import type { Patient, Screenshot } from '@shared/ipc-contract';

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

  // Fetch the patient row separately so the metadata sidebar shows the
  // full name (procedure.patientId is a UUID, not human-readable).
  const [patient, setPatient] = useState<Patient | null>(null);
  useEffect(() => {
    if (!procedure?.patientId) {
      setPatient(null);
      return;
    }
    let cancelled = false;
    void window.api.patients
      .get(procedure.patientId)
      .then((row) => {
        if (!cancelled) setPatient(row);
      })
      .catch(() => {
        if (!cancelled) setPatient(null);
      });
    return () => {
      cancelled = true;
    };
  }, [procedure?.patientId]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [currentMs, setCurrentMs] = useState(0);

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

  const durationMs = useMemo(() => {
    if (!procedure) return 0;
    return procedure.durationSeconds * 1000;
  }, [procedure?.durationSeconds]);

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
              />
              {procedure && !isInteractiveStatus(procedure.status) ? (
                <div className="bg-slate-100 p-6 text-center text-sm text-slate-500">
                  Playback unavailable — procedure status is {procedure.status}.
                </div>
              ) : null}
              {!procedure?.videoPath ? (
                <div className="bg-slate-100 p-6 text-center text-sm text-slate-500">
                  Video preview unavailable — `/media/` route ships in Plan 03.
                </div>
              ) : null}
            </div>
            <Scrubber
              durationMs={durationMs}
              currentMs={currentMs}
              onSeek={handleSeek}
              segments={segments}
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
                      <StatusBadge status={procedure.status} />
                    </p>
                  </>
                ) : (
                  <p className="text-muted-foreground">Loading…</p>
                )}
              </CardContent>
            </Card>

            <ProcedureNotesReview
              procedureId={procedureId}
              status={procedure?.status ?? 'completed'}
            />

            {procedure?.status === 'partial' && procedure.videoPath.endsWith('.partial.mp4') ? (
              <DeviceLostBanner
                lastLost={lastLost}
                onDismiss={() => recordingStore.clearLastLost()}
              />
            ) : null}

            {procedure && procedure.status !== 'partial' ? (
              <Card className="border-dashed bg-muted/30">
                <CardHeader>
                  <CardTitle className="text-base font-medium text-muted-foreground">
                    Trim
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">
                  Trim ships in Plan 03.
                </CardContent>
              </Card>
            ) : null}
          </aside>
        </section>
      </div>
    </main>
  );
}
