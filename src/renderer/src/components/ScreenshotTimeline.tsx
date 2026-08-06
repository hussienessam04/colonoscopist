// Screenshot timeline — horizontally scrollable thumbnail row.
// Plan 01 ships the presentational shape; Plan 02 fills the Toast-undo
// delete pattern. Memo boundary lives on the inner ScreenshotThumbnail
// so adding/removing one doesn't re-render its siblings.

import { Button } from '@/components/ui/button';
import { ScreenshotThumbnail } from '@/components/ScreenshotThumbnail';
import type { Screenshot } from '@shared/ipc-contract';

export type ScreenshotTimelineProps = {
  // Procedure id is reserved for the annotation panel (Plan 02). The
  // timeline itself is presentational.
  procedureId: string;
  screenshots: Screenshot[];
  onSeek: (ms: number) => void;
  onCapture: () => void;
  onDelete?: (s: Screenshot) => void;
  testId?: string;
};

export function ScreenshotTimeline({
  procedureId,
  screenshots,
  onSeek,
  onCapture,
  onDelete,
  testId,
}: ScreenshotTimelineProps): JSX.Element {
  return (
    <div
      className="flex items-center gap-2 overflow-x-auto pb-2"
      data-testid={testId ?? 'screenshot-timeline'}
      data-procedure-id={procedureId}
      role="list"
    >
      {screenshots.map((s) => (
        <ScreenshotThumbnail
          key={s.id}
          screenshot={s}
          onSeek={onSeek}
          onDelete={onDelete}
        />
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={onCapture}
        data-testid="screenshot-timeline-capture"
        aria-label="Capture current frame"
      >
        + Capture
      </Button>
    </div>
  );
}
