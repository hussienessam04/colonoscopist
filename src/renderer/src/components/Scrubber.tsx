// Scrubber — single-track click-to-seek + drag-to-seek control.
//
// Plan 02 adds pause markers from `procedure_segments` (D-11). Each marker
// is a thin vertical tick positioned at `segment.startedAtMs / durationMs * 100%`
// of the track width. Plan 03 stacks trim handles over the same track when
// `trimMode === true`.
//
// PITFALLS §8 — pointer events use `setPointerCapture` so the drag stays
// alive when the cursor leaves the track rectangle (e.g. doctor drags
// all the way to the right edge of the screen). Without the capture, the
// drag stops at the track border, which surfaces as a stuck handle.

import { useCallback, useEffect, useMemo, useRef } from 'react';
import '@/styles/scrubber.css';
import { formatDurationHHMMSS } from '@/lib/format-duration';
import { clampHandle } from '@/lib/trim-clamp';
import type { ProcedureSegment, Screenshot } from '@shared/ipc-contract';

export type ScrubberProps = {
  durationMs: number;
  currentMs: number;
  onSeek: (ms: number) => void;
  // D-11 — pause markers. When undefined or empty, the track renders clean.
  segments?: ProcedureSegment[];
  // Plan 09 / G-05-12 — screenshot position dots. When supplied, renders
  // one blue marker per row at `s.timestampInVideoMs / durationMs * 100%`.
  screenshots?: Screenshot[];
  // Plan 03 — trim mode. When true + inMs/outMs supplied, renders two
  // draggable handles + a red-shaded region between them.
  trimMode?: boolean;
  inMs?: number;
  outMs?: number;
  onTrim?: (range: { inMs: number; outMs: number }) => void;
  ariaLabel?: string;
  testId?: string;
};

function pctFor(ms: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  const pct = (ms / durationMs) * 100;
  return Math.max(0, Math.min(100, pct));
}

// ponytail: clamp the visible currentMs into [0, durationMs] so a brief
// overshoot (e.g. when currentTime ticks past the canvas at the end of
// a paused session) doesn't render progress bar past the right edge.
function clampCurrent(ms: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return Math.max(0, Math.min(durationMs, ms));
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
  segments,
  screenshots,
  trimMode = false,
  inMs,
  outMs,
  onTrim,
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

  const fillPct = pctFor(clampCurrent(currentMs, durationMs), durationMs);

  // ponytail: memoize the markers list so a re-render driven by currentMs
  // doesn't allocate a new array (PITFALLS §4 — sibling re-renders).
  const markers = useMemo(() => {
    if (!segments || segments.length === 0 || durationMs <= 0) return [];
    return segments.map((seg, i) => {
      const left = pctFor(seg.startedAt, durationMs);
      const pauseLabel = `Pause ${i + 1}: ${formatDurationHHMMSS(seg.startedAt)}\u2013${formatDurationHHMMSS(seg.endedAt)}`;
      return { key: seg.id, left, pauseLabel };
    });
  }, [segments, durationMs]);

  // Plan 09 / G-05-12 — screenshot position dots. Memoized for the same
  // reason as `markers` (PITFALLS §4). Rendered AFTER pause markers in DOM
  // order so the blue markers visually layer over the slate pause markers.
  const screenshotMarkers = useMemo(() => {
    if (!screenshots || screenshots.length === 0 || durationMs <= 0) return [];
    return screenshots.map((s) => {
      const left = pctFor(s.timestampInVideoMs, durationMs);
      const label = `Screenshot at ${formatDurationHHMMSS(s.timestampInVideoMs)}`;
      return { key: s.id, left, label };
    });
  }, [screenshots, durationMs]);

  // Plan 09 / G-05-12 — tick scale strip rendered BELOW the track when
  // trimMode is on. 5s interval for short recordings (≤60s), 10s for long.
  const ticks = useMemo(() => {
    if (!trimMode || durationMs <= 0) return [];
    const intervalMs = durationMs > 60_000 ? 10_000 : 5_000;
    const result: Array<{ ms: number; label: string }> = [];
    for (let t = 0; t <= durationMs; t += intervalMs) {
      result.push({ ms: t, label: formatDurationHHMMSS(t) });
    }
    return result;
  }, [trimMode, durationMs]);

  // Plan 03 — trim handles. Only rendered when trimMode is on AND both
  // inMs/outMs are provided. The handles are simple <div> elements with
  // their own pointer-event drag — see <TrimHandle> below.
  const renderTrimHandles =
    trimMode && typeof inMs === 'number' && typeof outMs === 'number' && durationMs > 0;

  const inPct = renderTrimHandles ? pctFor(inMs as number, durationMs) : 0;
  const outPct = renderTrimHandles ? pctFor(outMs as number, durationMs) : 0;

  return (
    <div
      // Plan 09 / G-05-12 — when in trim mode the wrapper carries
      // `scrubber-with-ticks` so tests can assert on the wrapper + tick
      // strip BELOW the track. When NOT in trim mode the wrapper has no
      // testid so `screen.getByTestId('scrubber-track')` still resolves to
      // the inner track (avoids duplicate-id match errors in RTL).
      className="flex flex-col gap-1"
      data-testid={trimMode ? 'scrubber-with-ticks' : undefined}
    >
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
        className="scrubber-track relative h-8 cursor-pointer select-none touch-none rounded bg-slate-200"
      >
        <div
          className="scrubber-progress absolute inset-y-0 left-0 rounded bg-slate-500"
          style={{ width: `${fillPct}%` }}
          data-testid="scrubber-fill"
        />
        {markers.map((m) => (
          <div
            key={m.key}
            className="scrubber-pause-marker absolute inset-y-0 w-0.5 bg-slate-700/40"
            style={{ left: `${m.left}%` }}
            aria-label={m.pauseLabel}
            title={m.pauseLabel}
            data-testid="scrubber-pause-marker"
          />
        ))}
        {screenshotMarkers.map((m) => (
          <div
            key={`shot-${m.key}`}
            className="absolute inset-y-0 z-[1] w-1 bg-blue-500/70"
            style={{ left: `${m.left}%` }}
            aria-label={m.label}
            title={m.label}
            data-testid="scrubber-screenshot-marker"
          />
        ))}
        {renderTrimHandles ? (
          <>
            {/* The red-shaded cut region. Sits BEHIND the handles (z=0) but ABOVE the progress fill so the doctor sees the cut clearly. */}
            <div
              className="pointer-events-none absolute inset-y-0 z-0 bg-red-300/50"
              style={{
                left: `${inPct}%`,
                width: `${Math.max(0, outPct - inPct)}%`,
              }}
              data-testid="scrubber-trim-region"
            />
            <TrimHandle
              side="in"
              left={inPct}
              otherMs={outMs as number}
              durationMs={durationMs}
              onTrim={onTrim}
              isInHandle={true}
            />
            <TrimHandle
              side="out"
              left={outPct}
              otherMs={inMs as number}
              durationMs={durationMs}
              onTrim={onTrim}
              isInHandle={false}
            />
          </>
        ) : null}
      </div>
      {trimMode ? (
        <div
          className="scrubber-ticks relative h-4 text-[10px] text-slate-500"
          data-testid="scrubber-tick-scale"
          aria-hidden="false"
        >
          {ticks.map((t) => (
            <span
              key={t.ms}
              className="absolute -translate-x-1/2 whitespace-nowrap"
              style={{ left: `${pctFor(t.ms, durationMs)}%` }}
              data-testid="scrubber-tick"
            >
              {t.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

type TrimHandleProps = {
  side: 'in' | 'out';
  left: number;
  otherMs: number;
  durationMs: number;
  onTrim?: (range: { inMs: number; outMs: number }) => void;
  isInHandle: boolean;
};

function TrimHandle(_props: TrimHandleProps): JSX.Element {
  // ponytail: `side` is unused in the rendered output (the testid encodes
  // isInHandle) — but kept in the prop type for clarity at call-sites.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { left, otherMs, durationMs, onTrim, isInHandle } = _props;
  // ponytail: per-handle drag state — we don't track the pointerId in the
  // parent because each handle has its own capture.
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      if (e.button !== 0) return;
      // stopPropagation so the underlying scrubber's onPointerDown doesn't
      // also fire a seek (we want pure drag, no seek-jump).
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const rect = e.currentTarget.parentElement?.getBoundingClientRect();
      if (!rect) return;
      const attemptedMs = msFromClientX(e.clientX, rect, durationMs);
      if (onTrim) {
        onTrim(clampHandle(otherMs, attemptedMs, isInHandle, durationMs));
      }
    },
    [durationMs, isInHandle, onTrim, otherMs],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      if (e.buttons === 0) return;
      const rect = e.currentTarget.parentElement?.getBoundingClientRect();
      if (!rect) return;
      const attemptedMs = msFromClientX(e.clientX, rect, durationMs);
      if (onTrim) {
        onTrim(clampHandle(otherMs, attemptedMs, isInHandle, durationMs));
      }
    },
    [durationMs, isInHandle, onTrim, otherMs],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore — pointer may have been released already
    }
  }, []);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={isInHandle ? 'Trim in-point' : 'Trim out-point'}
      tabIndex={-1}
      data-testid={isInHandle ? 'scrubber-trim-handle-in' : 'scrubber-trim-handle-out'}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      // z-10 so the handle sits ABOVE the trim region + the progress fill
      // (z=0) and the pause markers (z=1) — captures pointer events first.
      className="absolute inset-y-0 z-10 w-1 cursor-ew-resize bg-red-600"
      style={{ left: `${left}%` }}
    />
  );
}
