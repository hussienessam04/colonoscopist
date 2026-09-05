// ScreenshotCropModal — Phase 8 / Plan 14 + Plan 15 (SCRN-02 extended).
//
// A doctor's mid-procedure framing often includes scope chrome or
// adjacent anatomy. This modal lets the user define a free-form polygon
// over the screenshot (click to add vertices, double-click to finalize,
// Escape to cancel, Backspace to remove the last vertex) and the modal
// permanently crops the source JPEG to the polygon's bounding box.
//
// ponytail: the displayed image is the <img> itself with an absolutely
// positioned SVG overlay for the polygon — no canvas for display. A
// canvas is created offscreen ONLY on Apply, which is the one place the
// pixels actually matter. Half the code of a canvas-rendered editor and
// it inherits the browser's own image scaling.
//
// Plan 15 (G-08-8) — image fetch. Previously the <img> src was the
// MediaServer HTTP URL (e.g. `http://127.0.0.1:<port>/media/...`), which
// tainted the canvas on drawImage → "Tainted canvases may not be
// exported". Now the modal fetches the JPEG bytes off disk via the
// `screenshots.getBlob` IPC channel, builds a `blob:` URL, and uses that
// as the <img> src. blob: URLs are same-origin so no canvas taint. The
// renderer no longer needs the Lightbox-supplied `src` for display; we
// keep it as an optional fallback for tests/renderers that haven't
// wired the IPC.
//
// Polygon vertices are tracked in DISPLAYED coordinates (what the doctor
// sees) and converted to NATURAL pixels on Apply. Same scaling logic as
// the rectangle path; cropping at display resolution would throw away
// detail on a downscaled 1280px capture.
//
// Deviation (documented in SUMMARY.md): the polygon collapses to its
// axis-aligned bounding box on BOTH sides (renderer + main). The UI
// shows the free-form polygon, but the cropped region is the bbox. A
// future Plan 1.1 can swap to per-pixel polygon masking via main-side
// canvas, but v1 keeps the change minimal.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { CropPolygon } from '@shared/ipc-contract';

export type ScreenshotCropModalProps = {
  open: boolean;
  screenshotId: number;
  // Kept for backward compat (tests / older callers). When omitted the
  // modal fetches its own blob URL via `screenshots.getBlob` on mount.
  src?: string;
  onClose: () => void;
  onCropped: (result: { width: number; height: number; byteSize: number }) => void;
};

const JPEG_QUALITY = 0.9;
const MIN_POLYGON_VERTICES = 3;

type DisplayPoint = { x: number; y: number };

// Compute the bounding box of a polygon (axis-aligned). v1 simplification.
function polygonBBox(points: CropPolygon): { x: number; y: number; width: number; height: number } {
  let minX = points[0]!.x;
  let minY = points[0]!.y;
  let maxX = minX;
  let maxY = minY;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function ScreenshotCropModal({
  open,
  screenshotId,
  src,
  onClose,
  onCropped,
}: ScreenshotCropModalProps): JSX.Element {
  const { t } = useTranslation();
  const imgRef = useRef<HTMLImageElement | null>(null);
  // Polygon vertices in DISPLAY coordinates. Empty = no polygon yet.
  const [points, setPoints] = useState<DisplayPoint[]>([]);
  // Image src — either a `blob:` URL we created from the IPC fetcher, OR
  // the Lightbox-provided src as a fallback (kept for backward compat).
  const [imgSrc, setImgSrc] = useState<string | null>(src ?? null);
  const [applying, setApplying] = useState(false);
  const [imgError, setImgError] = useState<string | null>(null);

  // Fetch the JPEG bytes via IPC and build a blob: URL. Used as the
  // <img> src so drawImage() does not taint the canvas. The blob URL is
  // revoked on close/unmount to free the allocation.
  useEffect(() => {
    if (!open) {
      setPoints([]);
      setImgError(null);
      // Note: image src is revoked in the cleanup below when the effect
      // re-runs (open=false). Keep state simple.
      return;
    }
    let cancelled = false;
    let createdUrl: string | null = null;
    void (async (): Promise<void> => {
      // Try the IPC first. If it succeeds we own a blob: URL — clean up
      // on unmount. If it fails fall through to the caller-provided
      // `src` (tests + older callers).
      const getBlob = window.api.screenshots?.getBlob;
      if (typeof getBlob !== 'function') {
        setImgSrc(src ?? null);
        return;
      }
      try {
        const result = await getBlob({ id: screenshotId });
        if (cancelled) return;
        if (result.ok) {
          // ponytail: copy into a fresh Uint8Array<ArrayBuffer> so the
          // BlobPart type match works (the IPC chunk may come through as
          // Uint8Array<ArrayBufferLike> with a possibly-SharedArrayBuffer
          // buffer view, which TS 5.5 rejects on BlobPart).
          const bytes = new Uint8Array(result.bytes.byteLength);
          bytes.set(result.bytes);
          createdUrl = URL.createObjectURL(
            new Blob([bytes], { type: result.mimeType }),
          );
          setImgSrc(createdUrl);
          return;
        }
        // Fall back to the caller-provided src if it exists.
        setImgSrc(src ?? null);
        setImgError(
          result.code === 'IPC_SCREENSHOT_NOT_FOUND'
            ? t('screenshot.cropFailed')
            : t('screenshot.cropFailed'),
        );
      } catch {
        if (cancelled) return;
        setImgSrc(src ?? null);
      }
    })();
    return () => {
      cancelled = true;
      if (createdUrl !== null) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [open, screenshotId, src, t]);

  // Map a mouse event to DISPLAY pixel coords, clamped to the image's
  // bounding rect (snapped to image bounds per Plan 15 MUST-have).
  function pointFromEvent(e: React.MouseEvent): DisplayPoint | null {
    const img = imgRef.current;
    if (!img) return null;
    const rect = img.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(rect.width, e.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, e.clientY - rect.top)),
    };
  }

  function handleSurfaceClick(e: React.MouseEvent): void {
    const p = pointFromEvent(e);
    if (!p) return;
    setPoints((prev) => [...prev, p]);
  }

  function handleSurfaceDoubleClick(): void {
    // Double-click finalizes if we already have at least 3 vertices;
    // otherwise treat as a no-op (mirrors v1 — min 3 to define a shape).
    if (points.length >= MIN_POLYGON_VERTICES) {
      // No additional state mutation here — the points are already in
      // state; Apply uses them. Finalize is implicit (until cleared).
      return;
    }
  }

  function handleClearPolygon(): void {
    setPoints([]);
  }

  function handleRemoveLastVertex(): void {
    setPoints((prev) => prev.slice(0, -1));
  }

  // Keyboard: Escape cancels the polygon; Backspace removes the last
  // vertex. Bound on the wrapping div so the focus must be on the modal
  // (the Dialog content handles Escape already; we only handle Backspace).
  function handleKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Backspace' && points.length > 0) {
      e.preventDefault();
      handleRemoveLastVertex();
    } else if (e.key === 'Escape' && points.length > 0) {
      e.preventDefault();
      handleClearPolygon();
    }
  }

  async function handleApply(): Promise<void> {
    const img = imgRef.current;
    if (!img || points.length < MIN_POLYGON_VERTICES) return;

    // Displayed → natural pixels. A zero-width rect only happens in a
    // detached/unlaid-out DOM; fall back to 1:1 rather than dividing by 0.
    const displayed = img.getBoundingClientRect();
    const scaleX = displayed.width > 0 ? img.naturalWidth / displayed.width : 1;
    const scaleY = displayed.height > 0 ? img.naturalHeight / displayed.height : 1;

    const naturalWidth = img.naturalWidth || Math.round(displayed.width) || 1;
    const naturalHeight = img.naturalHeight || Math.round(displayed.height) || 1;

    // Convert polygon vertices to natural pixels, then bbox.
    const naturalPolygon: CropPolygon = points.map((p) => ({
      x: Math.round(p.x * scaleX),
      y: Math.round(p.y * scaleY),
    }));
    const bbox = polygonBBox(naturalPolygon);
    const cropRect = {
      x: Math.max(0, bbox.x),
      y: Math.max(0, bbox.y),
      width: Math.max(1, Math.min(bbox.width, naturalWidth - bbox.x)),
      height: Math.max(1, Math.min(bbox.height, naturalHeight - bbox.y)),
    };

    setApplying(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = cropRect.width;
      canvas.height = cropRect.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('2D canvas context unavailable');
      ctx.drawImage(
        img,
        cropRect.x,
        cropRect.y,
        cropRect.width,
        cropRect.height,
        0,
        0,
        cropRect.width,
        cropRect.height,
      );
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))),
          'image/jpeg',
          JPEG_QUALITY,
        );
      });
      const { blobToBase64 } = await import('@/lib/capture-screenshot');
      const jpegBase64 = await blobToBase64(blob);

      // Send the polygon (preferred) over the IPC — main validates the
      // bbox and overwrites the source file.
      const result = await window.api.screenshots.crop({
        id: screenshotId,
        croppedBase64: jpegBase64,
        originalDimensions: { width: naturalWidth, height: naturalHeight },
        cropPolygon: naturalPolygon,
      });

      if (result.ok) {
        toast.success(t('screenshot.cropSuccess'));
        onCropped({ ...result.newDimensions, byteSize: result.byteSize });
        setPoints([]);
        onClose();
        return;
      }
      toast.error(
        result.code === 'IPC_INVALID_CROP'
          ? t('screenshot.cropInvalid')
          : t('screenshot.cropFailed'),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('screenshot.cropFailed'));
    } finally {
      setApplying(false);
    }
  }

  // SVG polygon points attribute: "x,y x,y ..."
  const pointsAttr = points.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-4xl" data-testid="screenshot-crop-modal">
        <DialogHeader>
          <DialogTitle>{t('screenshot.cropModalTitle')}</DialogTitle>
          <DialogDescription>
            {t('screenshot.cropPolygonHint')}
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-center rounded bg-black">
          {/* ponytail: the SVG overlay is positioned against THIS box, so it
              must hug the image exactly — `w-fit` + `relative` on the
              image's own wrapper, not on the centring flex parent. */}
          <div
            className="relative w-fit select-none"
            tabIndex={0}
            onClick={handleSurfaceClick}
            onDoubleClick={handleSurfaceDoubleClick}
            onKeyDown={handleKeyDown}
            data-testid="screenshot-crop-surface"
          >
            {imgSrc === null ? (
              // ponytail: render the <img> ALWAYS so the test surface +
              // the naturalWidth/Height refs are stable from the first
              // render. The src is empty until the IPC fetch lands; the
              // browser shows nothing until then. happy-dom doesn't fire
              // the onLoad for an empty src — we just wait for the
              // async resolve.
              <div
                className="flex h-64 w-96 items-center justify-center text-slate-400"
                data-testid="screenshot-crop-loading"
              >
                {t('common.loading')}
              </div>
            ) : null}
            <img
              ref={imgRef}
              src={imgSrc ?? ''}
              alt={t('screenshot.cropModalTitle')}
              className={`max-h-[60vh] w-auto object-contain ${imgSrc === null ? 'hidden' : ''}`}
              data-testid="screenshot-crop-img"
              draggable={false}
              onError={() => {
                // Surface the error inline — the user can hit Cancel.
                setImgError(t('screenshot.cropFailed'));
              }}
            />
            {/* SVG overlay — covers the image's bounding box exactly.
                No canvas; the polygon is a vector <polygon> + <circle> vertex dots.
                The SVG is pointer-events:none so all clicks land on the surface. */}
            {points.length > 0 ? (
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full"
                data-testid="screenshot-crop-overlay"
              >
                {points.length >= 2 ? (
                  // Draw an open polyline for the in-progress polygon.
                  // When the polygon is closed (>=3 vertices + a recent
                  // double-click would close it), but v1 keeps it open
                  // visually until Apply — the bbox crop matches either.
                  <polyline
                    points={pointsAttr}
                    fill="rgba(59,130,246,0.2)"
                    stroke="rgb(59,130,246)"
                    strokeWidth={2}
                    data-testid="screenshot-crop-polyline"
                  />
                ) : null}
                {points.map((p, idx) => (
                  <circle
                    key={idx}
                    cx={p.x}
                    cy={p.y}
                    r={4}
                    fill="rgb(59,130,246)"
                    stroke="white"
                    strokeWidth={1}
                    data-testid="screenshot-crop-vertex"
                    data-vertex={`${p.x},${p.y}`}
                  />
                ))}
              </svg>
            ) : null}
            {imgError !== null ? (
              <p
                className="mt-2 text-center text-sm text-red-400"
                data-testid="screenshot-crop-img-error"
              >
                {imgError}
              </p>
            ) : null}
          </div>
        </div>
        {points.length > 0 && points.length < MIN_POLYGON_VERTICES ? (
          <p
            className="text-center text-sm text-amber-500"
            data-testid="screenshot-crop-hint-min"
          >
            {t('screenshot.cropAtLeastThreePoints')}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={applying}
            data-testid="screenshot-crop-cancel"
          >
            {t('screenshot.cropCancel')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              handleClearPolygon();
            }}
            disabled={applying || points.length === 0}
            data-testid="screenshot-crop-clear"
          >
            {t('common.clear')}
          </Button>
          <Button
            onClick={() => {
              void handleApply();
            }}
            disabled={applying || points.length < MIN_POLYGON_VERTICES}
            data-testid="screenshot-crop-apply"
          >
            {applying ? t('screenshot.cropInProgress') : t('screenshot.cropApply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ScreenshotCropModal;
