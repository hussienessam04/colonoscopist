// ScreenshotLightbox — full-size view of a captured screenshot.
//
// Plan 07 / G-05-10 + Plan 11 / G-05-14: a dialog modal that renders
// the captured JPEG at its native (up to 1280px) resolution via the
// existing `/media/` route. Screenshots live under a `screenshots/`
// literal subdir on disk (per `paths.ts::screenshotsDir()` +
// `screenshots.ts:add`), so the URL composition includes that segment.
// The parent page owns `selectedScreenshot` state; passing
// `screenshot={null}` closes the dialog. Closing paths: × button
// (testid `screenshot-lightbox-close`), Esc, click-outside-via-overlay
// (Radix defaults).
//
// Parity with the timeline delete: the lightbox accepts the same
// `onDelete` callback the timeline receives. The doctor's delete from
// inside the lightbox fires the same Toast-undo flow as a delete from
// the timeline, so a stale-row / undo scenario is identical across both
// surfaces.
//
// ponytail: no new dependencies. shadcn Dialog + lucide X / Trash2 are
// already in the bundle. URL composition mirrors the existing
// ProcedureReview video src so the path-escape regex (T-05-08 +
// T-05-28 + the new subdir allow-list from G-05-14) protects this
// route.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Crop, Trash2, X } from 'lucide-react';
import { ScreenshotCropModal } from '@/components/ScreenshotCropModal';
import { formatDurationHHMMSS } from '@/lib/format-duration';
import { screenshotUrl } from '@/lib/screenshot-url';
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
  const { t } = useTranslation();
  const [cropOpen, setCropOpen] = useState(false);
  // Plan 14 — crop overwrites the source JPEG in place, so the URL is
  // unchanged and the browser would serve the stale cached bytes. Bump
  // a token after a successful crop to force a re-fetch. Stays 0 (and
  // the URL stays pristine) until the doctor actually crops.
  const [cacheBuster, setCacheBuster] = useState(0);
  const open = screenshot !== null;
  // G-05-15 — canonicalize onto the shared helper. The lightbox owns
  // no URL composition logic; it just calls the helper and trusts the
  // URL. The leaf-filename regex + the literal `screenshots/` subdir
  // + the /media/ route shape all live in `screenshotUrl` now.
  const baseSrc = screenshot
    ? screenshotUrl({
        mediaBaseUrl,
        patientId,
        procedureId,
        filePath: screenshot.filePath,
      })
    : null;
  const src = baseSrc !== null && cacheBuster > 0 ? `${baseSrc}?v=${cacheBuster}` : baseSrc;
  const testIdPrefix = testId ?? 'screenshot-lightbox';
  return (
    <>
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
        {screenshot && (onDelete || src) ? (
          <div className="flex justify-end gap-2">
            {src ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setCropOpen(true)}
                data-testid="screenshot-lightbox-crop"
              >
                <Crop aria-hidden="true" />
                {t('screenshot.cropButton')}
              </Button>
            ) : null}
            {onDelete ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => onDelete(screenshot)}
                data-testid="screenshot-lightbox-delete"
              >
                <Trash2 aria-hidden="true" />
                Delete
              </Button>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
      </Dialog>
      {screenshot && src ? (
        <ScreenshotCropModal
          open={cropOpen}
          screenshotId={screenshot.id}
          src={src}
          onClose={() => setCropOpen(false)}
          onCropped={() => setCacheBuster(Date.now())}
        />
      ) : null}
    </>
  );
}
