// ScreenshotLightbox — full-size view of a captured screenshot.
//
// Plan 07 / G-05-10: a dialog modal that renders the captured JPEG at its
// native (up to 1280px) resolution via the existing `/media/` route. The
// parent page owns `selectedScreenshot` state; passing `screenshot={null}`
// closes the dialog. Closing paths: × button (testid
// `screenshot-lightbox-close`), Esc, click-outside-via-overlay (Radix
// defaults).
//
// Parity with the timeline delete: the lightbox accepts the same
// `onDelete` callback the timeline receives. The doctor's delete from
// inside the lightbox fires the same Toast-undo flow as a delete from
// the timeline, so a stale-row / undo scenario is identical across both
// surfaces.
//
// ponytail: no new dependencies. shadcn Dialog + lucide X / Trash2 are
// already in the bundle. URL composition mirrors the existing
// ProcedureReview video src so the path-escape regex on the server
// already protects this route (T-05-55 mitigation).

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Trash2, X } from 'lucide-react';
import { formatDurationHHMMSS } from '@/lib/format-duration';
import type { Screenshot } from '@shared/ipc-contract';

export type ScreenshotLightboxProps = {
  screenshot: Screenshot | null;
  patientId: string;
  procedureId: string;
  // null when the MediaServer hasn't bound yet (useMediaUrl.url). The
  // lightbox renders a fallback message in that case — the doctor can
  // dismiss and retry from the parent page.
  mediaBaseUrl: string | null;
  onClose: () => void;
  onDelete?: (screenshot: Screenshot) => void;
  testId?: string;
};

export function ScreenshotLightbox({
  screenshot,
  patientId,
  procedureId,
  mediaBaseUrl,
  onClose,
  onDelete,
  testId,
}: ScreenshotLightboxProps): JSX.Element {
  const open = screenshot !== null;
  // ponytail: same fileName extraction as ProcedureReview's video src —
  // we only pass the leaf filename to the /media/ route, so the server's
  // path-escape regex (T-05-08) already protects this surface.
  const fileName = screenshot?.filePath.replace(/^.*[\\/]/, '') ?? '';
  const src =
    mediaBaseUrl && screenshot
      ? `${mediaBaseUrl}/media/${patientId}/${procedureId}/${fileName}`
      : null;
  const testIdPrefix = testId ?? 'screenshot-lightbox';
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent
        className="max-w-4xl border-slate-700 bg-slate-900 text-white"
        data-testid={testIdPrefix}
      >
        <DialogTitle className="text-white">
          {screenshot
            ? `Screenshot at ${formatDurationHHMMSS(screenshot.timestampInVideoMs)}`
            : 'Screenshot'}
        </DialogTitle>
        <DialogDescription className="text-slate-400">
          Full-size view of the captured frame.
        </DialogDescription>
        {/* Explicit close button for testability + a discoverable affordance
            the UAT doctor can see without learning the shadcn default.
            Redundant with the shadcn X (Esc + click-outside also close). */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close lightbox"
          data-testid="screenshot-lightbox-close"
          className="absolute right-2 top-2 z-30 text-slate-300 hover:bg-slate-800 hover:text-white"
        >
          <X aria-hidden="true" />
        </Button>
        <div className="flex items-center justify-center rounded bg-black">
          {src ? (
            <img
              src={src}
              alt={
                screenshot
                  ? `Screenshot at ${formatDurationHHMMSS(screenshot.timestampInVideoMs)}`
                  : 'Screenshot'
              }
              className="max-h-[70vh] w-auto object-contain"
              data-testid="screenshot-lightbox-img"
              draggable={false}
            />
          ) : (
            <p className="p-6 text-slate-400" data-testid="screenshot-lightbox-no-media">
              Media server not ready
            </p>
          )}
        </div>
        {onDelete && screenshot ? (
          <div className="flex justify-end">
            <Button
              variant="destructive"
              size="sm"
              onClick={() => onDelete(screenshot)}
              data-testid="screenshot-lightbox-delete"
            >
              <Trash2 aria-hidden="true" />
              Delete
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
