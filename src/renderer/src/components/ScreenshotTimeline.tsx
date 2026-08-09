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
//     more than one screenshot is attached, pointer-event drag-to-reorder
//     is enabled on attached thumbnails. The drop event builds the new
//     orderedIds array from DOM order after the drop and calls onReorder.
//
// Phase 6 UAT fix (gap G-06-5 — reorder not working): the original
// implementation used native HTML5 drag-and-drop (dataTransfer + dragstart /
// dragover / drop). The inner `<img draggable={false}>` blocks dragstart
// in Chromium when the user mousedown-drags the image, so onReorder never
// fires. Switched to pointer events with explicit `setPointerCapture` on
// the source item so the drag survives mousedown-mousemove-mouseup even
// when the cursor leaves the source thumbnail.
//
// ponytail: extend, don't replace. The previous Phase 5 props keep
// working unchanged; the three new props are all optional with safe
// defaults (empty Set, no-op callbacks).

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
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
  // Phase 6 / Plan 02 — attach-to-report props. All optional; defaults
  // are safe no-ops for the legacy ProcedureReview / ProcedureRoom
  // callers.
  attachedIds?: Set<number>;
  onToggleAttach?: (screenshotId: number) => void;
  onReorder?: (orderedIds: number[]) => void;
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
  onToggleAttach,
  onReorder,
  testId,
}: ScreenshotTimelineProps): JSX.Element {
  const canCapture = captureAllowed(status);
  const attached = attachedIds ?? new Set<number>();
  const toggleAttach = onToggleAttach;
  const reorder = onReorder;
  // ponytail: which screenshot is being dragged? useRef so the
  // pointermove handler (fires on every move, not just React commits)
  // can read the latest value without re-binding the listener.
  const draggingIdRef = useRef<number | null>(null);
  // Also useState so the visual `opacity-50` re-renders on drag start/end.
  const [draggingId, setDraggingId] = useState<number | null>(null);
  // ponytail: list of attached screenshot IDs in current display order.
  // Re-derived from the screenshots prop on every render so React's
  // diff picks up the new order when the parent refreshes the report
  // after onReorder. The drag handler computes the next order from this
  // list + the dropped target.
  const attachedInOrder = screenshots
    .map((s) => s.id)
    .filter((id) => attached.has(id));

  // ponytail: enabled only when reorder callback is supplied AND there
  // are at least 2 attached screenshots — drag on a single item is a
  // confusing affordance (no reorder is possible).
  const reorderEnabled = reorder !== undefined && attachedInOrder.length > 1;

  // ponytail: pointer-event drag-to-reorder. Lifecycle:
  //   pointerdown on an attached thumbnail → record source id,
  //     setPointerCapture so subsequent move events keep flowing to the
  //     source element even when the cursor leaves it.
  //   pointermove (or pointerup) → if cursor is over a different
  //     attached thumbnail, swap the source + target in the new order.
  //   pointerup anywhere → release capture, clear state.
  const handleDragPointerDown =
    (screenshotId: number) =>
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      if (!reorderEnabled) return;
      // ponytail: only left-button drag counts; ignore right-click /
      // middle-click so the context menu + middle-click scroll still work.
      if (e.button !== 0) return;
      // ponytail: prevent the underlying <ScreenshotThumbnail> onClick
      // from firing on the same gesture (it seeks the <video>).
      e.stopPropagation();
      e.preventDefault();
      draggingIdRef.current = screenshotId;
      setDraggingId(screenshotId);
      // ponytail: setPointerCapture keeps the move events flowing to
      // this element even when the cursor leaves its bounds — same
      // pattern as Scrubber.tsx's trim handles.
      e.currentTarget.setPointerCapture(e.pointerId);
    };

  const handleDragPointerMove = (
    e: ReactPointerEvent<HTMLDivElement>,
  ): void => {
    const sourceId = draggingIdRef.current;
    if (sourceId === null || reorder === undefined) return;
    // ponytail: query the element under the pointer. We can't use
    // `e.target` because pointer-capture redirects all events to the
    // source element. document.elementFromPoint(x, y) returns the
    // topmost element at the cursor's client coords.
    const under = document.elementFromPoint(e.clientX, e.clientY);
    if (under === null) return;
    const dropEl = under.closest<HTMLElement>('[data-screenshot-id]');
    if (dropEl === null) return;
    const targetId = Number(dropEl.dataset.screenshotId);
    if (Number.isNaN(targetId) || targetId === sourceId) return;
    if (!attached.has(targetId)) return;
    // ponytail: only re-order once per (source, target) pair so a slow
    // drag across a single target doesn't fire onReorder 30 times/sec.
    if (dropEl.dataset.lastDroppedFrom === String(sourceId)) return;
    dropEl.dataset.lastDroppedFrom = String(sourceId);
    // Build the new order with sourceId inserted at targetId's position.
    const base = attachedInOrder.filter((id) => id !== sourceId);
    const targetIdx = base.indexOf(targetId);
    if (targetIdx < 0) return;
    const next = [...base.slice(0, targetIdx), sourceId, ...base.slice(targetIdx)];
    reorder(next);
  };

  const handleDragPointerUp = (
    e: ReactPointerEvent<HTMLDivElement>,
  ): void => {
    if (draggingIdRef.current === null) return;
    // ponytail: releasePointerCapture throws if the pointer wasn't
    // captured (e.g. up-event fired on a different element). Wrap in
    // try/catch to match the Scrubber pattern.
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // best-effort
    }
    draggingIdRef.current = null;
    setDraggingId(null);
  };

  return (
    <div
      className="flex items-center gap-2 overflow-x-auto pb-2"
      data-testid={testId ?? 'screenshot-timeline'}
      data-procedure-id={procedureId}
      role="list"
    >
      {screenshots.map((s) => {
        const isAttached = attached.has(s.id);
        const isDraggable = reorderEnabled && isAttached;
        const isDragging = isDraggable && draggingId === s.id;
        return (
          <div
            key={s.id}
            // ponytail: when reorder is enabled AND the thumbnail is
            // attached, wrap it in a div with pointer-event drag handlers.
            // We don't use HTML5 draggable because the inner <img
            // draggable={false}> blocks dragstart on Chromium when the
            // user mousedown-drags the image itself.
            data-screenshot-id={s.id}
            onPointerDown={isDraggable ? handleDragPointerDown(s.id) : undefined}
            onPointerMove={isDraggable ? handleDragPointerMove : undefined}
            onPointerUp={isDraggable ? handleDragPointerUp : undefined}
            onPointerCancel={isDraggable ? handleDragPointerUp : undefined}
            className={`relative rounded ${
              isAttached ? 'border-2 border-blue-500 cursor-grab active:cursor-grabbing' : 'border-2 border-transparent'
            } ${isDragging ? 'opacity-50' : ''}`}
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
            <ScreenshotThumbnail
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
          </div>
        );
      })}
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