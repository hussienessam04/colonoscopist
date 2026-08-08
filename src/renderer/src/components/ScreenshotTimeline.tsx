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
//     more than one screenshot is attached, native HTML5 drag-and-drop
//     is enabled on attached thumbnails. The drop event builds the new
//     orderedIds array from DOM order after the drop and calls onReorder.
//
// ponytail: extend, don't replace. The previous Phase 5 props keep
// working unchanged; the three new props are all optional with safe
// defaults (empty Set, no-op callbacks).

import { useState, type DragEvent } from 'react';
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
  // ponytail: which screenshot is being dragged? Module state via
  // useState so the drop target can read the source id from the dataTransfer
  // payload and rebuild the new order. The native HTML5 DnD surface is
  // small enough to keep inline.
  const [draggingId, setDraggingId] = useState<number | null>(null);

  // ponytail: enabled only when reorder callback is supplied AND there
  // are at least 2 attached screenshots — DnD on a single item is a
  // confusing affordance (no reorder is possible).
  const reorderEnabled =
    reorder !== undefined && [...attached].length > 1;

  const handleDragStart = (screenshotId: number) =>
    (e: DragEvent<HTMLDivElement>): void => {
      if (!reorderEnabled) return;
      setDraggingId(screenshotId);
      e.dataTransfer.effectAllowed = 'move';
      // dataTransfer.setData is required by some browsers to actually
      // fire the drop event; we use a no-op payload.
      e.dataTransfer.setData('text/plain', String(screenshotId));
    };
  const handleDragOver = (e: DragEvent<HTMLDivElement>): void => {
    if (!reorderEnabled || draggingId === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };
  const handleDrop = (targetId: number) =>
    (e: DragEvent<HTMLDivElement>): void => {
      if (!reorderEnabled || draggingId === null || reorder === undefined) return;
      e.preventDefault();
      if (targetId === draggingId) {
        setDraggingId(null);
        return;
      }
      // Build the new orderedIds from DOM order of attached thumbnails
      // after the swap. The DOM order is the source of truth for "what
      // the doctor sees" — we walk the screenshots[] array (already
      // sorted by timestampInVideoMs in useReport), filter to attached
      // only, then move draggingId to the targetId position.
      const base = screenshots
        .map((s) => s.id)
        .filter((id) => attached.has(id) && id !== draggingId);
      const targetIdx = base.indexOf(targetId);
      if (targetIdx < 0) {
        setDraggingId(null);
        return;
      }
      const next = [...base.slice(0, targetIdx), draggingId, ...base.slice(targetIdx)];
      reorder(next);
      setDraggingId(null);
    };
  const handleDragEnd = (): void => {
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
            // attached, wrap it in a draggable div. We don't make the
            // ScreenshotThumbnail itself draggable — its onClick seeks
            // the <video>, which conflicts with the DnD start.
            draggable={isDraggable}
            onDragStart={isDraggable ? handleDragStart(s.id) : undefined}
            onDragOver={isDraggable ? handleDragOver : undefined}
            onDrop={isDraggable ? handleDrop(s.id) : undefined}
            onDragEnd={isDraggable ? handleDragEnd : undefined}
            className={`relative rounded ${
              isAttached ? 'border-2 border-blue-500' : 'border-2 border-transparent'
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