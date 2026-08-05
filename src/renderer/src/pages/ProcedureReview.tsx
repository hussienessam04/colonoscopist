// ProcedureReview — Phase 4 placeholder page (per D-05).
// Phase 5 replaces this with the full review + trim UI.

import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useRoute } from '@/store/route';
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
                <p>
                  <span className="font-medium">Status:</span>{' '}
                  {procedure.status === 'partial' ? (
                    <span className="text-sm text-destructive">
                      Partial — recording preserved up to last frame
                    </span>
                  ) : (
                    <Badge variant={statusBadgeVariant(procedure.status)} className="capitalize">
                      {procedure.status}
                    </Badge>
                  )}
                </p>
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