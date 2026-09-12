// RecIndicator — instrument-style status strip rendered as an
// overlay on the top edge of the live preview. Replaces the
// floating red REC badge with a clinical-instrument readout
// that matches the rest of the app's teal/ivory palette.
//
// Quick task 20260912-procedure-room-ui-enhance — the previous
// version was a generic red rounded badge in the top-left
// corner (`bg-red-600/90`). That conflicted with the app's
// teal/ivory clinical palette (red is reserved for emergencies
// in this codebase). The new treatment reads like the top
// status strip of a medical imaging display: a thin teal bar
// with a pulsing dot, the words "RECORDING" or "PAUSED" in
// small-caps mono, and the live duration inline. Sits at the
// top of the preview pane so the doctor can read it at a
// glance without losing focus on the video.

import { cn } from '@/lib/utils';

export type RecIndicatorProps = {
  visible: boolean;
  paused?: boolean;
  durationLabel?: string;
  className?: string;
};

export function RecIndicator({
  visible,
  paused = false,
  durationLabel,
  className,
}: RecIndicatorProps): JSX.Element | null {
  if (!visible) return null;
  const isPaused = paused;
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-3 top-3 flex items-center gap-3 rounded-md border border-[#0E3A47]/30 bg-[#0E3A47]/85 px-3 py-1.5 text-[#E6EFF1] shadow-[0_8px_24px_-12px_rgba(14,58,71,0.6)] backdrop-blur',
        isPaused && 'border-amber-300/40 bg-amber-500/20 text-amber-100',
        className,
      )}
      role="status"
      aria-live="polite"
      data-testid="rec-indicator"
    >
      <span
        aria-hidden="true"
        className={cn(
          'size-2 shrink-0 rounded-full',
          isPaused
            ? 'bg-amber-200/80'
            : 'bg-[#E6EFF1] shadow-[0_0_0_2px_rgba(230,239,241,0.35)]',
        )}
      >
        {!isPaused ? (
          <span className="block size-full animate-ping rounded-full bg-[#E6EFF1]/60" />
        ) : null}
      </span>
      <p
        className="text-[10px] font-semibold uppercase leading-none tracking-[0.22em]"
        data-testid="rec-indicator-status"
      >
        {isPaused ? 'Paused' : 'Recording'}
      </p>
      <span aria-hidden="true" className="text-[#E6EFF1]/40">·</span>
      {durationLabel ? (
        <p
          aria-label="Elapsed recording duration"
          className="font-mono text-[11px] tabular-nums leading-none tracking-tight"
          data-testid="rec-indicator-duration"
        >
          {durationLabel}
        </p>
      ) : null}
    </div>
  );
}