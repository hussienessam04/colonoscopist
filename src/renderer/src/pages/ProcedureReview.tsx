// Procedure Review — Phase 5 / Plan 01. Per D-10 + D-12 + D-13 — video left,
// scrubber + screenshot timeline below the video, bare procedure metadata
// sidebar right. Trim handles, pause markers, Notes accordion land in
// Plan 02 + Plan 03. The <video> src is a placeholder until Plan 03 wires
// the `/media/` route on PreviewServer — click-to-seek wiring is exercised
// via test fixtures that mock the <video> element's currentTime getter/setter.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Scrubber } from '@/components/Scrubber';
import { ScreenshotTimeline } from '@/components/ScreenshotTimeline';
import { useScreenshotIntake } from '@/hooks/useScreenshotIntake';
import { useRoute } from '@/store/route';
import { useLastLost } from '@/store/recording';
import { useScreenshotToasts, screenshotToastStore } from '@/store/screenshot-toast';
import { formatDurationHHMMSS } from '@/lib/format-duration';
import type { Patient, Procedure, ProcedureStatus, Screenshot } from '@shared/ipc-contract';

function formatTimestamp(ms: number | null): string {
  if (ms === null) return '—';
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

function statusBadgeVariant(
  status: ProcedureStatus,
): 'default' | 'secondary' | 'destructive' {
  if (status === 'completed') return 'default';
  if (status === 'recording') return 'secondary';
  return 'destructive';
}

// Per D-13 — the doctor can play + capture on partial recordings, but Trim
// is disabled (no meaningful cut for a half-formed mp4). For Plan 01 we
// just expose the playback + capture; Trim ships in Plan 03.
function isInteractiveStatus(status: ProcedureStatus): boolean {
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
  const [procedure, setProcedure] = useState<Procedure | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [loading, setLoading] = useState(true);
  const lastLost = useLastLost();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [currentMs, setCurrentMs] = useState(0);

  const [screenshotList, setScreenshotList] = useState<Screenshot[]>([]);

  const screenshotIntake = useScreenshotIntake({
    procedureId: procedureId ?? '',
    sourceRef: videoRef,
    isRecording: false,
    startedAt: null,
  });
  // ponytail: keep a single source-of-truth for the screenshot list so the
  // timeline + capture handler share state. The hook's internal state is
  // discarded after the first load.
  useEffect(() => {
    setScreenshotList(screenshotIntake.screenshots);
  }, [screenshotIntake.screenshots]);

  const toasts = useScreenshotToasts();

  useEffect(() => {
    if (!procedureId) return;
    let cancelled = false;
    setLoading(true);
    void window.api.procedures
      .get({ id: procedureId })
      .then((row) => {
        if (!cancelled) setProcedure(row);
      })
      .catch(() => {
        if (!cancelled) setProcedure(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [procedureId]);

  useEffect(() => {
    if (!procedure || !procedure.patientId) return;
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

  const durationMs = useMemo(() => {
    if (!procedure) return 0;
    return procedure.durationSeconds * 1000;
  }, [procedure?.durationSeconds]);

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
    const result = await screenshotIntake.capture();
    if (result) {
      setScreenshotList((prev) => [...prev, result]);
      toast.success('Screenshot captured');
    } else {
      toast.error('Failed to capture screenshot');
    }
  }, [screenshotIntake]);

  const handleDelete = useCallback(
    (s: Screenshot): void => {
      // Optimistic UI: remove the screenshot from local state immediately
      // so the × visual feels instant (D-12). The Toast store schedules
      // the actual IPC delete after 5s; the user can Undo before then.
      setScreenshotList((prev) => prev.filter((row) => row.id !== s.id));
      screenshotToastStore.enqueueDelete(s.id, s.procedureId);
      toast(`Screenshot deleted at ${formatDurationHHMMSS(s.timestampInVideoMs)}`, {
        duration: 5_000,
        action: {
          label: 'Undo',
          onClick: () => screenshotToastStore.undoDelete(s.id),
        },
      });
    },
    [],
  );

  // ponytail: if a delete expires and the IPC fails, we have no rollback
  // here — the screenshot is gone from local state. Plan 02's pull-right
  // guard refines this; Plan 01 ships the simple happy-path version.
  void toasts; // ensure subscription so the store's listeners stay wired

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
            <Scrubber durationMs={durationMs} currentMs={currentMs} onSeek={handleSeek} />
            <ScreenshotTimeline
              procedureId={procedureId}
              screenshots={screenshotList}
              onSeek={handleSeek}
              onCapture={handleCapture}
              onDelete={handleDelete}
            />

            {procedure?.status === 'partial' ? (
              <Alert
                variant="destructive"
                data-testid="procedure-review-partial-alert"
              >
                <AlertTitle>Partial recording</AlertTitle>
                <AlertDescription>
                  {procedure.videoPath.endsWith('.partial.mp4') ? (
                    <>
                      Recording stopped because the capture device disconnected.
                      The mp4 was preserved up to{' '}
                      <span className="font-mono">
                        {formatDurationHHMMSS(lastLost?.lastKnownTimestampMs ?? 0)}
                      </span>
                      .
                    </>
                  ) : (
                    <>
                      Recording ended unexpectedly. The mp4 may be shorter
                      than the wall-clock duration. Check the audit log for
                      the cause.
                    </>
                  )}
                </AlertDescription>
              </Alert>
            ) : null}
          </div>

          <Card data-testid="procedure-review-metadata">
            <CardHeader>
              <CardTitle>Procedure</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              {loading ? (
                <p className="text-muted-foreground">Loading…</p>
              ) : procedure ? (
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
                    {formatDurationHHMMSS(procedure.durationSeconds * 1000)}
                  </p>
                  <p>
                    <span className="font-medium">Status:</span>{' '}
                    {procedure.status === 'partial' ? null : (
                      <Badge
                        variant={statusBadgeVariant(procedure.status)}
                        className="capitalize"
                      >
                        {procedure.status}
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Video: <code className="break-all">{procedure.videoPath}</code>
                  </p>
                </>
              ) : (
                <p className="text-destructive">Procedure not found.</p>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
