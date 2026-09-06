// ScreenshotLightbox — full-size view of a captured screenshot.
//
// Plan 07 / G-05-10 + Plan 11 / G-05-14: a dialog modal that renders
// the captured JPEG at its native (up to 1280px) resolution.
//
// Phase 8 / Plan 17 (G-08-10) — live preview after crop. The Plan 14
// version composed a URL via `screenshotUrl()` against the MediaServer
// `/media/` route. That route caches bytes on first hit; after a crop
// overwrites the source file on disk, the MediaServer could still
// serve the cached bytes, and bumping a `?v=` query string isn't enough
// to defeat an aggressive intermediary cache. Plan 17 switches the
// lightbox to the same `screenshots.getBlob` → `blob:` URL pattern
// ScreenshotCropModal already uses (per Plan 15 G-08-8). A `cacheBuster`
// counter on the component side re-fires the fetch effect after each
// crop's `onCropped` callback; the freshly-recreated `blob:` URL is
// different from any cached prior one, so the browser rebinds the
// `<img>` immediately. No need to close and reopen the modal.
//
// Closing paths: × button (testid `screenshot-lightbox-close`), Esc,
// click-outside-via-overlay (Radix defaults).
//
// Parity with the timeline delete: the lightbox accepts the same
// `onDelete` callback the timeline receives. The doctor's delete from
// inside the lightbox fires the same Toast-undo flow as a delete from
// the timeline, so a stale-row / undo scenario is identical across both
// surfaces.
//
// ponytail: no new dependencies. shadcn Dialog + lucide X / Trash2 are
// already in the bundle. The `mediaBaseUrl` / `patientId` /
// `procedureId` props are retained (existing callers still pass them)
// but no longer consumed by the component — the blob URL flows from
// the IPC instead of the MediaServer route.

import { useEffect, useState } from 'react';
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
  // ponytail: fired after every successful crop (Plan 17 lightbox + Plan
  // 18 modal both rebind via their own cacheBuster). The parent uses
  // this to bump a shared `mediaCacheBuster` so the ScreenshotTimeline
  // thumbnails — which still load via the MediaServer `/media/` URL —
  // also rebind to the freshly-cropped bytes. Without this seam, the
  // timeline keeps showing the pre-crop thumbnail until the doctor
  // leaves and re-enters the procedure page.
  onCropped?: () => void;
  testId?: string;
};

export function ScreenshotLightbox({
  screenshot,
  patientId,
  procedureId,
  mediaBaseUrl,
  onClose,
  onDelete,
  onCropped,
  testId,
}: ScreenshotLightboxProps): JSX.Element {
  const { t } = useTranslation();
  const [cropOpen, setCropOpen] = useState(false);
  // Phase 8 / Plan 17 (G-08-10) — live preview after crop. We switched
  // from the MediaServer URL (which caches the file on first hit) to a
  // fresh `blob:` URL fetched per render. After a successful crop the
  // on-disk JPEG is overwritten; bumping `cacheBuster` makes the effect
  // re-fetch and produce a brand-new blob URL — the browser sees a new
  // <img src> and rebinds without needing leave/re-enter.
  const [cacheBuster, setCacheBuster] = useState(0);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const open = screenshot !== null;
  const testIdPrefix = testId ?? 'screenshot-lightbox';

  // Phase 8 / Plan 17 (G-08-10) — `mediaBaseUrl`, `patientId`, and
  // `procedureId` were only consumed by the (removed) MediaServer URL
  // path. Plan 18 (G-08-11) re-uses them for the crop modal's read-only
  // fallback: when getBlob fails, the modal displays the screenshot
  // via the MediaServer URL via screenshotUrl().
  // ponytail: returns null when mediaBaseUrl is null — the fallback is
  // silently skipped in that case (the modal still shows the error +
  // Retry button).
  const fallbackSrc = screenshot && mediaBaseUrl
    ? screenshotUrl({
        mediaBaseUrl,
        patientId,
        procedureId,
        filePath: screenshot.filePath,
      })
    : null;

  // Fetch JPEG bytes via IPC and build a fresh blob: URL on every
  // (screenshot.id, cacheBuster) transition. The previous blob URL is
  // revoked in the cleanup so we don't leak object URLs.
  useEffect(() => {
    if (!screenshot) {
      setImageUrl(null);
      return;
    }
    let cancelled = false;
    let currentUrl: string | null = null;
    void (async (): Promise<void> => {
      const getBlob = window.api.screenshots?.getBlob;
      if (typeof getBlob !== 'function') {
        setImageUrl(null);
        return;
      }
      try {
        const result = await getBlob({ id: screenshot.id });
        if (cancelled) return;
        if (result.ok) {
          // Phase 8 / Plan 19 (G-08-12) — `result.bytes` is a fresh
          // ArrayBuffer (was Uint8Array view). Wrap in Uint8Array for
          // BlobPart — same as ScreenshotCropModal.
          const bytes = new Uint8Array(result.bytes);
          currentUrl = URL.createObjectURL(
            new Blob([bytes], { type: result.mimeType }),
          );
          setImageUrl(currentUrl);
        } else {
          setImageUrl(null);
        }
      } catch {
        if (cancelled) return;
        setImageUrl(null);
      }
    })();
    return () => {
      cancelled = true;
      if (currentUrl !== null) {
        URL.revokeObjectURL(currentUrl);
      }
    };
  }, [screenshot?.id, cacheBuster]);

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
          {imageUrl ? (
            <img
              src={imageUrl}
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
              {screenshot ? 'Loading screenshot…' : 'No screenshot'}
            </p>
          )}
        </div>
        {screenshot && (onDelete || imageUrl) ? (
          <div className="flex justify-end gap-2">
            {imageUrl ? (
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
      {screenshot && imageUrl ? (
        <ScreenshotCropModal
          open={cropOpen}
          screenshotId={screenshot.id}
          // Plan 18 (G-08-11) — bumped after a successful crop so the
          // modal re-fetches the freshly-cropped bytes; without this
          // the modal's <img> keeps showing the pre-crop blob.
          cacheBuster={cacheBuster}
          fallbackSrc={fallbackSrc}
          // ponytail: do NOT pass `src` — the modal fetches its own blob
          // via screenshots.getBlob. Sharing ours would couple the two
          // blob lifecycles and confuse the URL.revokeObjectURL cleanup.
          onClose={() => setCropOpen(false)}
          onCropped={() => {
            // Plan 17 live preview: bump cacheBuster so this component
            // re-runs its blob-fetch effect and the <img> rebinds to
            // the newly-cropped JPEG bytes. Plan 18: the modal also
            // receives the new value and re-fetches its own blob.
            setCacheBuster(Date.now());
            // ponytail: notify the parent so the timeline thumbnails
            // (which still load via the MediaServer URL) can rebind
            // too. Without this, only the lightbox updates on crop.
            onCropped?.();
          }}
        />
      ) : null}
    </>
  );
}
