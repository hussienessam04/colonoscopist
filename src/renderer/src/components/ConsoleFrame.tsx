// ConsoleFrame — medical-imaging-style corner brackets drawn
// over the live preview. When `active` is true the brackets
// pulse teal; when idle they sit dimmer on the dark preview so
// the doctor can still see the framing hint without competing
// with the video.
//
// Quick task 20260912-procedure-room-ui-enhance — signature
// element for the procedure-room redesign. Reads as the
// framing overlay of an endoscopy monitor: thin teal L-shapes
// in each corner, pulse-soft during recording, dim when idle.
// pointer-events-none so it never blocks the controls bar
// beneath it.

import { cn } from '@/lib/utils';

export type ConsoleFrameProps = {
  active: boolean;
  className?: string;
};

export function ConsoleFrame({ active, className }: ConsoleFrameProps): JSX.Element {
  // Common corner styling: L-shape made from two perpendicular
  // borders, ~28px arms, ~2px thick. Sits in each corner of the
  // preview pane with a fixed inset.
  const armClass = cn(
    'pointer-events-none absolute h-7 w-7',
    active
      ? 'border-[#0EA5A5] animate-pulse drop-shadow-[0_0_4px_rgba(14,165,165,0.55)]'
      : 'border-[#E6EFF1]/45',
  );
  const baseBorder = 'border-solid';
  return (
    <div
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-0', className)}
      data-testid="console-frame"
      data-active={active ? 'true' : 'false'}
    >
      <span className={cn(armClass, baseBorder, 'left-2 top-2 border-l-2 border-t-2 rounded-tl-md')} />
      <span className={cn(armClass, baseBorder, 'right-2 top-2 border-r-2 border-t-2 rounded-tr-md')} />
      <span className={cn(armClass, baseBorder, 'bottom-2 left-2 border-b-2 border-l-2 rounded-bl-md')} />
      <span className={cn(armClass, baseBorder, 'bottom-2 right-2 border-b-2 border-r-2 rounded-br-md')} />
    </div>
  );
}