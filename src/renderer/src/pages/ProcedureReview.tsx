// ProcedureReview — Phase 4 placeholder page (per D-05).
// Phase 5 replaces this with the full review + trim UI.
// Plan 04 wraps the partial status in a full shadcn Alert with the recovery
// hint + formatted duration (per D-03).

import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useRoute } from '@/store/route';
import { useLastLost } from '@/store/recording';
import { formatDurationHHMMSS } from '@/lib/format-duration';
import type { Procedure, ProcedureStatus } from '@shared/ipc-contract';

function formatTimestamp(ms: number | null): string {
  if (ms === null) return '—';
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

function statusBadgeVariant(status: ProcedureStatus): 'default' | 'secondary' | 'destructive' {
  if (status === 'completed') return 'default';
  if (status === 'recording') return 'secondary';
  // partial + crashed share the destructive variant per Plan 02.
  return 'destructive';
}

export default function ProcedureReview({ procedureId: initialId }: { procedureId?: string } = {}): JSX.Element {
  const { navigate } = useRoute();
  const route = useRoute().current;
  const routeProcedureId = route.name === 'procedure-review' ? route.procedureId : null;
  const procedureId = initialId ?? routeProcedureId ?? null;
  const [procedure, setProcedure] = useState<Procedure | null>(null);
  const [loading, setLoading] = useState(true);
  // Plan 04 — read the lastLost slot from the recording store. If the
  // partial-finalize happened in the same session, this carries the formatted
  // duration; on a fresh session (or after reset), it's null and we fall back
  // to "See Audit log for last-known timestamp".
  const lastLost = useLastLost();

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
          <Button variant="outline" onClick={() => navigate({ name: 'patients' })}>
            <ArrowLeft aria-hidden="true" />
            Back
          </Button>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Procedure {procedureId.slice(0, 8)}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {loading ? (
              <p className="text-muted-foreground">Loading…</p>
            ) : procedure ? (
              <>
                <p>
                  <span className="font-medium">Started:</span> {formatTimestamp(procedure.startedAt)}
                </p>
                <p>
                  <span className="font-medium">Ended:</span> {formatTimestamp(procedure.endedAt)}
                </p>
                <p>
                  <span className="font-medium">Duration:</span>{' '}
                  {formatDurationHHMMSS(procedure.durationSeconds * 1000)}
                </p>
                <p>
                  <span className="font-medium">Preset:</span> {procedure.presetSummary.kind} ·{' '}
                  {procedure.presetSummary.resolution} · {procedure.presetSummary.framerate}fps
                </p>
                <div>
                  <p>
                    <span className="font-medium">Status:</span>{' '}
                    {procedure.status === 'partial' ? null : (
                      <Badge variant={statusBadgeVariant(procedure.status)} className="capitalize">
                        {procedure.status}
                      </Badge>
                    )}
                  </p>
                  {procedure.status === 'partial' ? (
                    <Alert
                      variant="destructive"
                      data-testid="procedure-review-partial-alert"
                      className="mt-2"
                    >
                      <AlertTitle>Partial recording</AlertTitle>
                      <AlertDescription>
                        {/* ponytail: discriminate the partial cause by the
                            videoPath suffix. The supervisor's device-lost
                            path rewrites the segment to <name>.partial.mp4
                            (recorder.ts::rewritePartial); other partial
                            causes (SIGKILL on unresponsive ffmpeg, ffmpeg
                            failing to start, double-concat-failure) keep the
                            canonical video.mp4 path. So a `.partial.mp4`
                            suffix is the unambiguous device-lost fingerprint
                            at review time — the recording store's lastLost
                            is cleared on 'stopped' and is not available
                            here. */}
                        {procedure.videoPath.endsWith('.partial.mp4') ? (
                          <>
                            Recording stopped because the capture device disconnected. The mp4 was preserved up to{' '}
                            <span className="font-mono">
                              {formatDurationHHMMSS(lastLost?.lastKnownTimestampMs ?? 0)}
                            </span>
                            .
                          </>
                        ) : (
                          <>
                            Recording ended unexpectedly. The mp4 may be shorter than the wall-clock duration. Check the audit log for the cause.
                          </>
                        )}
                      </AlertDescription>
                    </Alert>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  Path: <code>{procedure.videoPath}</code>
                </p>
              </>
            ) : (
              <p className="text-destructive">Procedure not found.</p>
            )}
            <p className="mt-4 text-xs text-muted-foreground">
              Review + trim land in Phase 5.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}