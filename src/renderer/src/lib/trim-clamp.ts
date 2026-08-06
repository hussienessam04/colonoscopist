// trim-clamp — pure helpers for the trim handles on the Scrubber.
// Per D-06 + PITFALLS §6 — the two drag handles clamp against each other
// with a 1000ms minimum gap so the doctor can't accidentally zero-out the
// trim range.
//
// ponytail: 1000ms is a SOFT floor on the drag. The renderer can still
// pass a smaller gap via direct setInMs/setOutMs (e.g. typing in a numeric
// input — out of scope for Plan 03). The IPC zod `.refine(outMs > inMs)`
// is the HARD floor that bounds every trim IPC call.

export type TrimRange = {
  inMs: number;
  outMs: number;
};

/**
 * Clamp a drag attempt against the OTHER handle, with a 1000ms minimum
 * gap. The drag handler in the Scrubber calls this on every pointermove
 * and feeds the result back via `onTrim`.
 *
 *   isInHandle=true:  attempt to drag the LEFT handle. Clamped to
 *                     `[0, otherMs - 1000]`. The right handle stays put.
 *   isInHandle=false: attempt to drag the RIGHT handle. Clamped to
 *                     `[otherMs + 1000, durationMs]`. The left handle
 *                     stays put.
 *
 * `otherMs` is the position of the OPPOSITE handle (the one NOT being
 * dragged).
 */
export function clampHandle(
  otherMs: number,
  attemptedMs: number,
  isInHandle: boolean,
  durationMs: number,
): TrimRange {
  if (isInHandle) {
    const inMs = Math.max(0, Math.min(attemptedMs, otherMs - 1000));
    return { inMs, outMs: otherMs };
  }
  const outMs = Math.min(durationMs, Math.max(attemptedMs, otherMs + 1000));
  return { inMs: otherMs, outMs };
}
