// RecIndicator — red blinking "REC" badge shown in the top-left of the
// preview during an active recording. Pulses via Tailwind animate-pulse.
// Hidden when not recording; replaces the timer + REC visibility check
// that was previously scattered across the page.

import { cn } from '@/lib/utils';

export type RecIndicatorProps = {
  visible: boolean;
  paused?: boolean;
  className?: string;
};

export function RecIndicator({ visible, paused = false, className }: RecIndicatorProps): JSX.Element | null {
  if (!visible) return null;
  return (
    <div
      className={cn(
        'pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-full bg-red-600/90 px-3 py-1 text-xs font-semibold uppercase text-white shadow-lg backdrop-blur',
        paused ? 'opacity-60' : 'animate-pulse',
        className,
      )}
      role="status"
      aria-live="polite"
      data-testid="rec-indicator"
    >
      <span
        aria-hidden="true"
        className={cn('size-2 rounded-full bg-white', paused ? 'opacity-50' : 'animate-pulse')}
      />
      {paused ? 'Paused' : 'Rec'}
    </div>
  );
}