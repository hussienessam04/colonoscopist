// Per-thumbnail card in the screenshot timeline. Plan 01 ships the basic
// shape (onSeek on click + a × button for the delete UX). Plan 02 adds an
// optional `onAnnotate` callback that wires up the inline annotation input
// (D-12 — agent's discretion chose inline `<input>`).
//
// Layout (top -> bottom):
//   [ annotation caption strip — optional ]
//   [ image / placeholder              ]
//   [ timestamp strip                  ]
//   [ × button (top-right of image)    ]
//
// The × button's position changed in Plan 02 to avoid overlap with the new
// annotation strip. It sits at the top-right of the IMAGE area, not the card.
//
// PITFALLS §4 — wrap with React.memo so adding/removing a sibling
// thumbnail doesn't re-render this one.

import { memo, useState, type MouseEvent } from 'react';
import { formatDurationHHMMSS } from '@/lib/format-duration';
import { ScreenshotAnnotation } from '@/components/ScreenshotAnnotation';
import type { Screenshot } from '@shared/ipc-contract';

export type ScreenshotThumbnailProps = {
  screenshot: Screenshot;
  onSeek: (ms: number) => void;
  // Optional in Plan 01 (the click handler lands in Plan 02). When
  // undefined, no × button renders so the click target stays untouched.
  onDelete?: (screenshot: Screenshot) => void;
  // Pre-built thumbnail URL from the preview server (Plan 03 fills the
  // `/media/` route). Plan 01 falls back to a placeholder background.
  thumbnailSrc?: string;
  // Plan 02 — when present, renders `<ScreenshotAnnotation>` above the
  // timestamp label. The parent wires this to the IPC updateAnnotation.
  onAnnotate?: (screenshot: Screenshot, annotation: string | null) => Promise<void>;
  // Plan 07 / G-05-10 — when present, renders a dedicated expand affordance
  // (lucide Maximize2 inline SVG, top-left) that fires onOpen(screenshot).
  // Seek-on-click on the parent card is unchanged; the expand button calls
  // e.stopPropagation() so the parent click handler does NOT also fire.
  onOpen?: (screenshot: Screenshot) => void;
  testId?: string;
};

function ScreenshotThumbnailImpl({
  screenshot,
  onSeek,
  onDelete,
  thumbnailSrc,
  onAnnotate,
  onOpen,
  testId,
}: ScreenshotThumbnailProps): JSX.Element {
  const [errored, setErrored] = useState(false);
  const handleClick = (): void => onSeek(screenshot.timestampInVideoMs);
  const handleDelete = (e: MouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation(); // do NOT trigger the seek click handler
    onDelete?.(screenshot);
  };
  const handleExpand = (e: MouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation(); // do NOT trigger the parent seek click handler
    onOpen?.(screenshot);
  };
  return (
    <div
      className="relative h-[110px] w-[120px] cursor-pointer overflow-hidden rounded border border-slate-300 hover:border-slate-500"
      onClick={handleClick}
      data-testid={testId ?? 'screenshot-thumbnail'}
      data-screenshot-id={screenshot.id}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
      aria-label={`Seek to ${formatDurationHHMMSS(screenshot.timestampInVideoMs)}`}
    >
      {onAnnotate ? (
        <span
          className="absolute inset-x-0 top-0 z-10 block bg-slate-100 px-1 py-0.5"
          // ponytail: the caption strip lives above the image so the
          // annotation doesn't overlap the HH:MM:SS label. The inner button
          // stopPropagation prevents the parent thumbnail's seek handler
          // from firing (D-12).
          onClick={(e) => e.stopPropagation()}
        >
          <ScreenshotAnnotation
            screenshot={screenshot}
            onSave={(annotation) => onAnnotate(screenshot, annotation)}
          />
        </span>
      ) : null}
      {thumbnailSrc && !errored ? (
        <img
          src={thumbnailSrc}
          alt={`Screenshot at ${formatDurationHHMMSS(screenshot.timestampInVideoMs)}`}
          // Quick task 20260906-report-editor-procedure-center-print-regen-thumbnails —
          // object-contain so the FULL image is visible inside the 110×120
          // box (letterboxed on tall/wide captures) instead of cropping.
          className={`size-full object-contain bg-slate-900 ${onAnnotate ? 'pt-5 pb-5' : 'pb-5'}`}
          onError={() => setErrored(true)}
          draggable={false}
          data-testid="screenshot-thumbnail-img"
        />
      ) : (
        <div
          className={`flex size-full items-center justify-center bg-slate-100 text-[10px] uppercase tracking-wider text-slate-400 ${onAnnotate ? 'pt-5 pb-5' : 'pb-5'}`}
          aria-label="Thumbnail pending"
        >
          frame
        </div>
      )}
      {/* Quick task 20260906-screenshot-tile-i18n-and-badge-polish —
          compact timestamp pill at the bottom-center. Stronger
          background opacity + mono font so the image's tint doesn't
          bleed through (was \`bg-black/50\` + plain \`text-xs\`). */}
      <span className="absolute bottom-1 left-1/2 -translate-x-1/2 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-white shadow-sm">
        {formatDurationHHMMSS(screenshot.timestampInVideoMs)}
      </span>
      {onDelete ? (
        // ponytail: 24×24 solid-red disc (was 20×20 translucent-black).
        // The hit target is large enough for a gloved clinician to tap without
        // a hover-reveal; the red is high-contrast against any captured
        // frame; shadow-md + focus-visible:ring-2 make the affordance
        // discoverable for keyboard users (T-05-58 mitigation).
        <button
          type="button"
          onClick={handleDelete}
          aria-label={`Delete screenshot at ${formatDurationHHMMSS(screenshot.timestampInVideoMs)}`}
          className="absolute right-1 top-1 z-20 flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-sm text-white shadow-md focus-visible:ring-2 focus-visible:ring-white hover:bg-red-700"
        >
          ×
        </button>
      ) : null}
      {onOpen ? (
        // ponytail: dedicated expand affordance — independent from the
        // parent seek click. Inline Maximize2 SVG (no new dep). The
        // e.stopPropagation() in handleExpand prevents the parent card
        // from also seeking when the doctor opens the lightbox.
        <button
          type="button"
          onClick={handleExpand}
          aria-label={`Open full-size view of screenshot at ${formatDurationHHMMSS(screenshot.timestampInVideoMs)}`}
          className="absolute left-1 top-1 z-20 flex h-6 w-6 items-center justify-center rounded-full bg-slate-700/80 text-white shadow-md focus-visible:ring-2 focus-visible:ring-white hover:bg-slate-900"
          data-testid="screenshot-thumbnail-expand"
        >
          <svg
            viewBox="0 0 24 24"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 8V5a2 2 0 0 1 2-2h3" />
            <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
            <path d="M3 16v3a2 2 0 0 0 2 2h3" />
            <path d="M21 16v3a2 2 0 0 1-2 2h-3" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

// ponytail: memo is what Plan 02's render-counter test depends on (PITFALLS §4).
export const ScreenshotThumbnail = memo(ScreenshotThumbnailImpl);
ScreenshotThumbnail.displayName = 'ScreenshotThumbnail';

// Re-export the impl so tests that need to mount it directly can.
export { ScreenshotThumbnailImpl as ScreenshotThumbnailForTest };
