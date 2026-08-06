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
  testId?: string;
};

function ScreenshotThumbnailImpl({
  screenshot,
  onSeek,
  onDelete,
  thumbnailSrc,
  onAnnotate,
  testId,
}: ScreenshotThumbnailProps): JSX.Element {
  const [errored, setErrored] = useState(false);
  const handleClick = (): void => onSeek(screenshot.timestampInVideoMs);
  const handleDelete = (e: MouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation(); // do NOT trigger the seek click handler
    onDelete?.(screenshot);
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
          className={`size-full object-cover ${onAnnotate ? 'pt-5 pb-5' : 'pb-5'}`}
          onError={() => setErrored(true)}
          draggable={false}
        />
      ) : (
        <div
          className={`flex size-full items-center justify-center bg-slate-100 text-[10px] uppercase tracking-wider text-slate-400 ${onAnnotate ? 'pt-5 pb-5' : 'pb-5'}`}
          aria-label="Thumbnail pending"
        >
          frame
        </div>
      )}
      <span className="absolute inset-x-0 bottom-0 z-10 bg-black/50 px-1 py-0.5 text-xs text-white">
        {formatDurationHHMMSS(screenshot.timestampInVideoMs)}
      </span>
      {onDelete ? (
        <button
          type="button"
          onClick={handleDelete}
          aria-label={`Delete screenshot at ${formatDurationHHMMSS(screenshot.timestampInVideoMs)}`}
          className="absolute right-1 top-6 z-20 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-xs text-white hover:bg-red-600"
        >
          ×
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
