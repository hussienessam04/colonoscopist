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
//
// Phase 6 / Plan 02 — the timeline grows three OPTIONAL props so the
// ReportEditor can reuse it for the "attach screenshots to the report"
// picker:
//   - attachedIds: Set<number> — the screenshot IDs that are attached
//     to the active report. Renders a blue-500 border on attached
//     thumbnails for visual distinguish.
//   - onToggleAttach: (screenshotId) => void — fires when the doctor
//     clicks the small "Attach to report" toggle button rendered on
//     each thumbnail (top-LEFT, contrasting with the existing × on
//     top-RIGHT and the expand affordance).
//   - onReorder: (orderedIds: number[]) => void — when supplied AND
//     more than one screenshot is attached, the doctor can use the
//     "Move left" / "Move right" buttons on each attached thumbnail to
//     reorder (Phase 6 UAT G-06-5; replaced earlier drag-to-reorder
//     pointer events + HTML5 DnD implementations — both suffered from
//     nested-element event conflicts).
//
// Phase 6 UAT G-06-5 — reorder via Move Up / Move Down buttons:
//   The original implementation used native HTML5 drag-and-drop
//   (dataTransfer + dragstart / dragover / drop). The inner
//   `<img draggable={false}>` blocks dragstart in Chromium when the
//   user mousedown-drags the image, so onReorder never fired.
//   Replacement: pointer events with setPointerCapture — also failed
//   (the screenshot has its own nested onClick handler; the pointer
//   events from the IMG and overlay buttons get confused).
//   Final solution: discard drag-to-reorder entirely. Replace with
//   small "‹" and "›" buttons on each attached thumbnail that swap
//   the screenshot with its left/right neighbour. Simpler, works in
//   nested layouts, no drag machinery, no event-coordination race
//   conditions. The attached list can still be reordered; the doctor's
//   intent is preserved.
//
// ponytail: extend, don't replace. The previous Phase 5 props keep
// working unchanged; the three new props are all optional with safe
// defaults (empty Set, no-op callbacks).

import { Button } from '@/components/ui/button';
import { ScreenshotThumbnail } from '@/components/ScreenshotThumbnail';
import { screenshotUrl } from '@/lib/screenshot-url';
import type { ProcedureStatus, ReportScreenshot, Screenshot } from '@shared/ipc-contract';

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
  onCapture?: () => void;
  onDelete?: (s: Screenshot) => void;
  onAnnotate?: (screenshot: Screenshot, annotation: string | null) => Promise<void>;
  // Plan 07 / G-05-10 — when present, the timeline forwards onOpen to each
  // ScreenshotThumbnail, which renders a dedicated expand affordance. The
  // lightbox is owned by the parent page; the timeline itself is presentational.
  onOpen?: (screenshot: Screenshot) => void;
  // Phase 6 / Plan 02 — attach-to-report props. All optional; defaults
  // are safe no-ops for the legacy ProcedureReview / ProcedureRoom
  // callers.
  // ponytail: prefer the rich `attached` prop (with sortOrder) over the
  // bare Set. The rich form lets the timeline ORDER displayed
  // thumbnails by sortOrder (the DB's sort_order is the source of
  // truth for the PDF render order). Falls back to the Set for
  // back-compat with callers that don't have sortOrder handy.
  attachedIds?: Set<number>;
  attached?: ReportScreenshot[];
  onToggleAttach?: (screenshotId: number) => void;
  onReorder?: (orderedIds: number[]) => void;
  // ponytail: shared cache-buster for the MediaServer-backed thumbnail
  // URLs. The parent bumps this on every crop (lightbox onCropped
  // callback); the timeline appends `?v=<value>` to each thumbnail URL
  // so the browser refetches the freshly-cropped JPEG bytes. Localhost
  // MediaServer has no intermediary cache so `?v=` is sufficient
  // (unlike the lightbox which needs a `blob:` URL because Plan 17).
  mediaCacheBuster?: number;
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
  attachedIds,
  attached,
  onToggleAttach,
  onReorder,
  mediaCacheBuster,
  testId,
}: ScreenshotTimelineProps): JSX.Element {
  const canCapture = captureAllowed(status) && onCapture !== undefined;
  // ponytail: prefer the rich `attached` prop (with sortOrder) for
  // ordering; fall back to the legacy `attachedIds` Set for callers
  // that don't have sortOrder handy. Either path yields the same
  // attached-id Set for the move-button index computation.
  const attachedIdsSet = attachedIds ?? new Set<number>(
    attached ? attached.map((a) => a.screenshotId) : [],
  );
  const toggleAttach = onToggleAttach;
  const reorder = onReorder;
  // ponytail: list of attached screenshot IDs in current display order.
  // Re-derived from the `attached` prop on every render so React's
  // diff picks up the new order when the parent refreshes the report
  // after onReorder. The move-left / move-right handlers compute the
  // next order from this list + the source id.
  const attachedInOrder = attached
    ? [...attached].sort((a, b) => a.sortOrder - b.sortOrder).map((a) => a.screenshotId)
    : screenshots.map((s) => s.id).filter((id) => attachedIdsSet.has(id));

  // ponytail: sort the displayed thumbnails so attached ones render
  // FIRST in their persisted sort_order, then unattached ones in the
  // natural timestampInVideoMs order. Without this, the visual order
  // of the timeline follows the screenshot timestamp (from
  // useProcedureScreenshots) and the move buttons would only update
  // the DB — the user wouldn't see the change.
  const sortOrderById = new Map<number, number>(
    attached ? attached.map((a) => [a.screenshotId, a.sortOrder] as [number, number]) : [],
  );
  const orderedScreenshots = [...screenshots].sort((a, b) => {
    const aOrder = sortOrderById.get(a.id);
    const bOrder = sortOrderById.get(b.id);
    // Both attached: order by sortOrder ASC.
    if (aOrder !== undefined && bOrder !== undefined) {
      return aOrder - bOrder;
    }
    // Only a attached: a first.
    if (aOrder !== undefined) return -1;
    if (bOrder !== undefined) return 1;
    // Neither attached: timestampInVideoMs ASC.
    return a.timestampInVideoMs - b.timestampInVideoMs;
  });

  // Phase 6 UAT G-06-5 — move a screenshot one position to the left
  // in the attached list. When the source is already at the head,
  // it's a no-op. The reorder callback fires with the new id order.
  const handleMoveLeft = (screenshotId: number) => (): void => {
    if (reorder === undefined) return;
    const idx = attachedInOrder.indexOf(screenshotId);
    if (idx <= 0) return;
    const next = [...attachedInOrder];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    reorder(next);
  };
  // Mirror of handleMoveLeft: move one position to the right. No-op
  // when the source is already at the tail.
  const handleMoveRight = (screenshotId: number) => (): void => {
    if (reorder === undefined) return;
    const idx = attachedInOrder.indexOf(screenshotId);
    if (idx < 0 || idx >= attachedInOrder.length - 1) return;
    const next = [...attachedInOrder];
    [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
    reorder(next);
  };

  return (
    <div
      className="flex items-center gap-2 overflow-x-auto pb-2"
      data-testid={testId ?? 'screenshot-timeline'}
      data-procedure-id={procedureId}
      role="list"
    >
      {orderedScreenshots.map((s) => {
        const isAttached = attachedIdsSet.has(s.id);
        const attachedIdx = isAttached ? attachedInOrder.indexOf(s.id) : -1;
        const canMoveLeft = isAttached && attachedIdx > 0;
        const canMoveRight =
          isAttached && attachedIdx >= 0 && attachedIdx < attachedInOrder.length - 1;
        return (
          <div
            key={s.id}
            data-screenshot-id={s.id}
            className={`relative rounded ${
              isAttached ? 'border-2 border-blue-500' : 'border-2 border-transparent'
            }`}
            data-testid={isAttached ? 'screenshot-attached' : undefined}
          >
            {toggleAttach !== undefined ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleAttach(s.id);
                }}
                aria-label={isAttached ? 'Detach from report' : 'Attach to report'}
                className={`absolute left-1 bottom-1 z-20 flex h-5 w-5 items-center justify-center rounded text-xs font-bold shadow-md focus-visible:ring-2 focus-visible:ring-white ${
                  isAttached
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
                data-testid={isAttached ? 'screenshot-detach-toggle' : 'screenshot-attach-toggle'}
              >
                {isAttached ? '✓' : '+'}
              </button>
            ) : null}
            {/* Phase 6 UAT G-06-5 — small Move-Left / Move-Right buttons
                on each attached thumbnail. Hidden when the screenshot
                isn't attached (toggle is off) or is at the head/tail of
                the attached list (no-op moves). Replaces the
                drag-to-reorder mechanism. */}
            {isAttached && (canMoveLeft || canMoveRight) ? (
              <div className="absolute right-1 top-1 z-20 flex gap-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleMoveLeft(s.id)();
                  }}
                  disabled={!canMoveLeft}
                  aria-label="Move screenshot left in report"
                  className="flex h-5 w-5 items-center justify-center rounded bg-slate-700/80 text-xs font-bold text-white shadow-md focus-visible:ring-2 focus-visible:ring-white hover:bg-slate-900 disabled:opacity-30 disabled:cursor-not-allowed"
                  data-testid="screenshot-move-left"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleMoveRight(s.id)();
                  }}
                  disabled={!canMoveRight}
                  aria-label="Move screenshot right in report"
                  className="flex h-5 w-5 items-center justify-center rounded bg-slate-700/80 text-xs font-bold text-white shadow-md focus-visible:ring-2 focus-visible:ring-white hover:bg-slate-900 disabled:opacity-30 disabled:cursor-not-allowed"
                  data-testid="screenshot-move-right"
                >
                  ›
                </button>
              </div>
            ) : null}
            <ScreenshotThumbnail
              screenshot={s}
              // ponytail: the helper returns `null` when `mediaBaseUrl` is null
              // (MediaServer not yet bound); the thumbnail prop accepts
              // `string | undefined`. Coerce `null` → `undefined` so the
              // conditional render (`thumbnailSrc && !errored`) falls through
              // to the placeholder without a TS strict-mode error.
              thumbnailSrc={(() => {
                const base = screenshotUrl({
                  mediaBaseUrl,
                  patientId,
                  procedureId,
                  filePath: s.filePath,
                });
                if (base === null) return undefined;
                return mediaCacheBuster !== undefined
                  ? `${base}?v=${mediaCacheBuster}`
                  : base;
              })()}
              onSeek={onSeek}
              onDelete={onDelete}
              onAnnotate={onAnnotate}
              onOpen={onOpen}
            />
          </div>
        );
      })}
      {onCapture !== undefined ? (
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
      ) : null}
    </div>
  );
}