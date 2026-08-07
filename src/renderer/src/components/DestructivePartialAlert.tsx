// DestructivePartialAlert — extracted from ProcedureReview so the partial-status
// destructive Alert is reusable across the review screen and any future surface
// that wants to surface a partial recording.
//
// Per CONTEXT D-13 + Phase 4 D-03 + Plan 04 task 2:
//   - The Alert renders when `status === 'partial'`.
//   - The copy depends on the canonical fingerprint `.partial.mp4` suffix:
//     * `.partial.mp4` → "Recording stopped because the capture device
//       disconnected. The mp4 was preserved up to <HH:MM:SS>."
//     * otherwise (e.g. SIGKILL on ffmpeg, double-concat-failure) → a generic
//       "Recording ended unexpectedly." message — without the misleading
//       "capture device disconnected" copy.
//   - Otherwise the component returns null.
//
// Defensive clamps per Plan 04 task 2:
//   - `lastKnownTimestampMs ?? 0` — the recording store clears lastLost on
//     'stopped', so the fallback reads 0 ("00:00:00") instead of "NaN".

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { formatDurationHHMMSS } from '@/lib/format-duration';

export type DestructivePartialAlertProps = {
  status: string;
  videoPath: string | null | undefined;
  lastKnownTimestampMs: number | null;
};

export function DestructivePartialAlert({
  status,
  videoPath,
  lastKnownTimestampMs,
}: DestructivePartialAlertProps): JSX.Element | null {
  if (status !== 'partial') return null;
  const isDeviceLost = !!videoPath && videoPath.endsWith('.partial.mp4');
  return (
    <Alert
      variant="destructive"
      data-testid="procedure-review-partial-alert"
      className="flex flex-col gap-2"
    >
      <AlertTitle>Partial recording</AlertTitle>
      <AlertDescription>
        {isDeviceLost ? (
          <>
            Recording stopped because the capture device disconnected. The mp4 was
            preserved up to{' '}
            <span className="font-mono font-medium">
              {formatDurationHHMMSS(lastKnownTimestampMs ?? 0)}
            </span>
            .
          </>
        ) : (
          <>Recording ended unexpectedly. The mp4 was preserved.</>
        )}
      </AlertDescription>
    </Alert>
  );
}
