// Screenshot timeline — horizontally scrollable thumbnail row.
// Plan 02 extends the timeline:
//   * +Capture button is GATED on `procedure.status !== 'crashed'` (D-13).
//   * Each thumbnail receives an optional `onAnnotate` callback that wires
//     through to `screenshots.updateAnnotation` via the parent.
//   * Plan 03 will mount the actual thumbnails from the preview server;
//     Plan 02 keeps the placeholder image shape.
// Plan 12 / G-05-15 — the timeline composes each thumbnail's
// `thumbnailSrc` via the shared `screenshotUrl` helper. `mediaBaseUrl`
// is null while the MediaServer IPC round-trip is in flight; the
// timeline degrades gracefully (placeholder renders) until the URL
// lands.

import { Button } from '@/components/ui/button';
import { ScreenshotThumbnail } from '@/components/ScreenshotThumbnail';
import { screenshotUrl } from '@/lib/screenshot-url';
import type { ProcedureStatus, Screenshot } from '@shared/ipc-contract';

export type ScreenshotTimelineProps = {
  // Procedure id is reserved for future scoping (Plan 03+). The timeline
  // itself is presentational.
  procedureId: string;
  // Plan 12 / G-05-15 — the timeline composes each thumbnail's
  // `thumbnailSrc` via the shared `screenshotUrl` helper. The
  // helper needs (mediaBaseUrl, patientId, procedureId, filePath);
  // procedureId is already a prop above. `mediaBaseUrl` is null
  // while the MediaServer IPC round-trip is in flight; the timeline
  // degrades gracefully (placeholder renders) until the URL lands.
  // ProcedureReview passes its `useMediaUrl().url`; ProcedureRoom
  // does the same after Plan 12 added a `useMediaUrl()` call.
  mediaBaseUrl: string | null;
  patientId: string;
  // Plan 02 — the parent passes the procedure's status so the timeline can
  // gate the +Capture button (D-13). When omitted, the timeline assumes
  // 'completed' so legacy Plan 01 callers keep working.
  status?: ProcedureStatus;
  screenshots: Screenshot[];
  onSeek: (ms: number) => void;
  onCapture: () => void;
  onDelete?: (s: Screenshot) => void;
  onAnnotate?: (screenshot: Screenshot, annotation: string | null) => Promise<void>;
  // Plan 07 / G-05-10 — when present, the timeline forwards onOpen to each
  // ScreenshotThumbnail, which renders a dedicated expand affordance. The
  // lightbox is owned by the parent page; the timeline itself is presentational.
  onOpen?: (screenshot: Screenshot) => void;
  testId?: string;
};

function captureAllowed(status: ProcedureStatus | undefined): boolean {
  // D-13 — partial + completed + recording all allow capture; only crashed
  // is blocked. `recording` is included for the ProcedureRoom entry point
  // (which reuses this component), although the room primarily drives
  // capture via the `S` hotkey.
  if (status === undefined) return true;
  return status !== 'crashed';
}

export function ScreenshotTimeline({
  procedureId,
  mediaBaseUrl,
  patientId,
  status,
  screenshots,
  onSeek,
  onCapture,
  onDelete,
  onAnnotate,
  onOpen,
  testId,
}: ScreenshotTimelineProps): JSX.Element {
  const canCapture = captureAllowed(status);
  return (
    <div
      className="flex items-center gap-2 overflow-x-auto pb-2"
      data-testid={testId ?? 'screenshot-timeline'}
      data-procedure-id={procedureId}
      role="list"
    >
      {screenshots.map((s) => (
        <ScreenshotThumbnail
          key={s.id}
          screenshot={s}
          // ponytail: the helper returns `null` when `mediaBaseUrl` is null
          // (MediaServer not yet bound); the thumbnail prop accepts
          // `string | undefined`. Coerce `null` → `undefined` so the
          // conditional render (`thumbnailSrc && !errored`) falls through
          // to the placeholder without a TS strict-mode error.
          thumbnailSrc={screenshotUrl({
            mediaBaseUrl,
            patientId,
            procedureId,
            filePath: s.filePath,
          }) ?? undefined}
          onSeek={onSeek}
          onDelete={onDelete}
          onAnnotate={onAnnotate}
          onOpen={onOpen}
        />
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={onCapture}
        disabled={!canCapture}
        data-testid="screenshot-timeline-capture"
        aria-label="Capture current frame"
      >
        + Capture
      </Button>
    </div>
  );
}
