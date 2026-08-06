// Scrubber — single-track click-to-seek + drag-to-seek control.
// Plan 01 ships the BARE scrubber; Plan 02 stacks Pause markers + Plan 03
// stacks Trim handles as child layers over the same track.
//
// PITFALLS §8 — pointer events use `setPointerCapture` so the drag stays
// alive when the cursor leaves the track rectangle (e.g. doctor drags
// all the way to the right edge of the screen). Without the capture, the
// drag stops at the track border, which surfaces as a stuck handle.

import { useCallback, useEffect, useRef } from 'react';

export type ScrubberProps = {
  durationMs: number;
  currentMs: number;
  onSeek: (ms: number) => void;
  ariaLabel?: string;
  testId?: string;
};

function pctFor(ms: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  const pct = (ms / durationMs) * 100;
  return Math.max(0, Math.min(100, pct));
}

function msFromClientX(clientX: number, rect: DOMRect, durationMs: number): number {
  if (rect.width <= 0) return 0;
  const ratio = (clientX - rect.left) / rect.width;
  return Math.max(0, Math.min(durationMs, Math.round(ratio * durationMs)));
}

export function Scrubber({
  durationMs,
  currentMs,
  onSeek,
  ariaLabel = 'Procedure scrubber',
  testId = 'scrubber-track',
}: ScrubberProps): JSX.Element {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);

  const seekFromClientX = useCallback(
    (clientX: number): void => {
      const track = trackRef.current;
      if (!track || durationMs <= 0) return;
      const rect = track.getBoundingClientRect();
      onSeek(msFromClientX(clientX, rect, durationMs));
    },
    [durationMs, onSeek],
  );

  // ponytail: clean up any in-flight drag listeners on unmount so a route
  // change mid-drag doesn't leak window-level pointermove handlers.
  useEffect(() => {
    return () => {
      dragPointerIdRef.current = null;
    };
  }, []);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.button !== 0) return;
    const track = e.currentTarget;
    track.setPointerCapture(e.pointerId);
    dragPointerIdRef.current = e.pointerId;
    seekFromClientX(e.clientX); // click-to-seek fires immediately
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    if (dragPointerIdRef.current !== e.pointerId) return;
    seekFromClientX(e.clientX);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>): void {
    if (dragPointerIdRef.current !== e.pointerId) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // releasePointerCapture throws if the pointer wasn't captured (e.g.
      // onPointerDown not yet registered with the browser). Safe to ignore.
    }
    dragPointerIdRef.current = null;
  }

  const fillPct = pctFor(currentMs, durationMs);

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={Math.max(0, durationMs)}
      aria-valuenow={Math.max(0, Math.min(durationMs, currentMs))}
      data-testid={testId}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className="relative h-8 cursor-pointer select-none touch-none rounded bg-slate-200"
    >
      <div
        className="absolute inset-y-0 left-0 rounded bg-slate-500"
        style={{ width: `${fillPct}%` }}
        data-testid="scrubber-fill"
      />
    </div>
  );
}
