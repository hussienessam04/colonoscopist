// TrimControls — right-rail action panel for the Procedure Review screen.
// Per D-06 + D-09 + D-13 — toggles Trim mode, exposes Apply + Restore
// buttons, and shows the live in/out range as HH:MM:SS labels.
//
// Status partial gate: Apply is disabled when `status === 'partial'` so
// the IPC layer's `Cannot trim a partial recording` rejection never
// surfaces (UX-Pitfalls: prevent the failure mode rather than toasting
// about it). Restore is disabled when `videoPathOriginal` is null
// (never been trimmed).
//
// Inline status (not a modal) per UX-Pitfalls: Apply + Restore buttons
// show a `Loader2` spinner during the IPC round-trip.

import { Loader2, Scissors } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDurationHHMMSS } from '@/lib/format-duration';
import type { ProcedureStatus } from '@shared/ipc-contract';

export type TrimControlsProps = {
  status: ProcedureStatus;
  videoPathOriginal: string | null;
  inMs: number;
  outMs: number;
  trimMode: boolean;
  setTrimMode: (on: boolean) => void;
  applying: boolean;
  restoring: boolean;
  apply: () => Promise<void>;
  restore: () => Promise<void>;
};

export function TrimControls({
  status,
  videoPathOriginal,
  inMs,
  outMs,
  trimMode,
  setTrimMode,
  applying,
  restoring,
  apply,
  restore,
}: TrimControlsProps): JSX.Element {
  // D-13 — partial recordings disable Apply at the renderer so the
  // IPC's `Cannot trim a partial recording` rejection never surfaces.
  const applyDisabled =
    applying || status === 'partial' || inMs >= outMs || status === 'recording' || status === 'crashed';
  // D-09 — Restore only meaningful after a prior trim. The column is
  // null until the first trim lands (COALESCE'd on first trim).
  const restoreDisabled = restoring || videoPathOriginal === null;

  return (
    <Card data-testid="trim-controls">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base font-medium">Trim</CardTitle>
        <Button
          variant={trimMode ? 'default' : 'outline'}
          size="sm"
          onClick={() => setTrimMode(!trimMode)}
          aria-pressed={trimMode}
          data-testid="trim-mode-toggle"
        >
          <Scissors aria-hidden="true" />
          {trimMode ? 'Done' : 'Trim'}
        </Button>
      </CardHeader>
      {trimMode ? (
        <CardContent className="flex flex-col gap-2 text-sm">
          <div className="text-xs text-slate-600" data-testid="trim-range-labels">
            In:{' '}
            <span className="font-mono" data-testid="trim-in-label">
              {formatDurationHHMMSS(inMs)}
            </span>{' '}
            · Out:{' '}
            <span className="font-mono" data-testid="trim-out-label">
              {formatDurationHHMMSS(outMs)}
            </span>
          </div>
          <Button
            size="sm"
            onClick={() => {
              void apply();
            }}
            disabled={applyDisabled}
            data-testid="trim-apply"
          >
            {applying ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Apply
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void restore();
            }}
            disabled={restoreDisabled}
            data-testid="trim-restore"
          >
            {restoring ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Restore original
          </Button>
          {status === 'partial' ? (
            <p className="text-xs text-muted-foreground">
              Trim is unavailable on partial recordings.
            </p>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  );
}
