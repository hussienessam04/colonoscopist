// FramingGuide — subtle rule-of-thirds overlay rendered on top of the live
// preview. Helps the doctor frame the shot consistently without distracting
// from the video. pointer-events-none so it never intercepts clicks on
// the controls beneath it.

import { cn } from '@/lib/utils';

export type FramingGuideProps = {
  visible?: boolean;
  className?: string;
};

export function FramingGuide({ visible = true, className }: FramingGuideProps): JSX.Element | null {
  if (!visible) return null;
  return (
    <svg
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-0 size-full text-white/15',
        className,
      )}
      viewBox="0 0 3 2"
      preserveAspectRatio="none"
      data-testid="framing-guide"
    >
      {/* Two vertical lines (1/3 + 2/3) */}
      <line x1="1" y1="0" x2="1" y2="2" stroke="currentColor" strokeWidth="0.008" vectorEffect="non-scaling-stroke" />
      <line x1="2" y1="0" x2="2" y2="2" stroke="currentColor" strokeWidth="0.008" vectorEffect="non-scaling-stroke" />
      {/* Two horizontal lines (1/3 + 2/3) */}
      <line x1="0" y1="0.667" x2="3" y2="0.667" stroke="currentColor" strokeWidth="0.008" vectorEffect="non-scaling-stroke" />
      <line x1="0" y1="1.333" x2="3" y2="1.333" stroke="currentColor" strokeWidth="0.008" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}