// ScreenshotCropModal — Phase 8 / Plan 14 + Plan 15 + Plan 16 (SCRN-02 extended).
//
// A doctor's mid-procedure framing often includes scope chrome or
// adjacent anatomy. This modal lets the user define a crop area over
// the screenshot in one of three modes and then permanently crops the
// source JPEG to the selection's bounding box.
//
// Modes (Phase 8 / Plan 16, G-08-9):
//   * Rectangle — mousedown + drag draws a rectangle (the 80% case).
//   * Free-hand — mousedown + drag samples the cursor path every ~5 px
//     and treats it as a closed polygon on mouseup.
//   * Polygon   — click to add vertices (legacy flow). Stays available
//     for precise manual control.
//
// All three modes feed the same polygon→bbox IPC contract; the rendered
// preview differs but Apply only cares about the final polygon's bbox.
//
// ponytail: the displayed image is the <img> itself with an absolutely
// positioned SVG overlay for the selection — no canvas for display. A
// canvas is created offscreen ONLY on Apply, which is the one place the
// pixels actually matter. Half the code of a canvas-rendered editor and
// it inherits the browser's own image scaling.
//
// Plan 15 (G-08-8) — image fetch. Previously the <img> src was the
// MediaServer HTTP URL (e.g. `http://127.0.0.1:<port>/media/...`), which
// tainted the canvas on drawImage → "Tainted canvases may not be
// exported". Now the modal fetches the JPEG bytes off disk via the
// `screenshots.getBlob` IPC channel, builds a `blob:` URL, and uses that
// as the <img> src. blob: URLs are same-origin so no canvas taint.
//
// Polygon / rectangle / freehand vertices are tracked in DISPLAYED
// coordinates (what the doctor sees) and converted to NATURAL pixels on
// Apply. Same scaling logic as the rectangle path; cropping at display
// resolution would throw away detail on a downscaled 1280px capture.
//
// Deviation (documented in SUMMARY.md): the selection collapses to its
// axis-aligned bounding box on BOTH sides (renderer + main). The UI
// shows the free-form shape, but the cropped region is the bbox. A
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
// ponytail: 5px is the "trace but don't oversample" sweet spot on
// retina + regular DPI displays. Tune up if SVG render shows visible
// polyline zig-zag on fast drags; down if we hit 1k+ vertices.
const FREEHAND_MIN_DELTA_PX = 5;
// Minimum rectangle side (in display pixels) to commit. Smaller than
// this is treated as an accidental click and ignored.
const RECT_MIN_DIM_PX = 10;

type DisplayPoint = { x: number; y: number };
type Mode = 'rectangle' | 'freehand' | 'polygon';

type DragRect = { start: DisplayPoint; end: DisplayPoint };

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

  // Phase 8 / Plan 16 (G-08-9) — mode toggle. Default 'rectangle' so a
  // routine crop is one drag, no clicks. Rectangle mode is by far the
  // most common clinical case (a doctor crops out the scope chrome or
  // a region of interest — both are rectangles).
  const [mode, setMode] = useState<Mode>('rectangle');
  // The committed selection, in DISPLAY coordinates. Empty = nothing
  // to apply yet. All three modes write into this same field so the
  // IPC contract (polygon → bbox) is unchanged.
  const [finalPolygon, setFinalPolygon] = useState<DisplayPoint[]>([]);
  // Rectangle mode drag-in-progress: {start, end} set on mousedown, end
  // updated by mousemove. null outside an active drag. The functional
  // setter pattern keeps `rect` consistent across close-spaced events
  // (React 18 batches updates across the same tick — closures of
  // stale rect state are the default trap we avoid here).
  const [rect, setRect] = useState<DragRect | null>(null);
  // Freehand mode drag-in-progress: sample list. Resets on mouseup or
  // on switch out of freehand.
  const [freehandPath, setFreehandPath] = useState<DisplayPoint[]>([]);

  const [imgSrc, setImgSrc] = useState<string | null>(src ?? null);
  const [applying, setApplying] = useState(false);
  const [imgError, setImgError] = useState<string | null>(null);

  // Fetch the JPEG bytes via IPC and build a blob: URL. Used as the
  // <img> src so drawImage() does not taint the canvas. The blob URL is
  // revoked on close/unmount to free the allocation.
  useEffect(() => {
    if (!open) {
      setFinalPolygon([]);
      setRect(null);
      setFreehandPath([]);
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
        setImgError(t('screenshot.cropFailed'));
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

  // Reset every selection state — used by the mode toggle buttons and
  // the Clear button. Switching modes mid-selection should never leave a
  // half-drawn rect visible behind a fresh freehand path.
  function clearAll(): void {
    setFinalPolygon([]);
    setRect(null);
    setFreehandPath([]);
  }

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

  // Surface drag/click handlers — mode-aware.
  function handleSurfaceMouseDown(e: React.MouseEvent): void {
    const p = pointFromEvent(e);
    if (!p) return;
    if (mode === 'rectangle') {
      setRect({ start: p, end: p });
    } else if (mode === 'freehand') {
      setFreehandPath([p]);
    } else {
      // Polygon mode — mousedown adds a vertex. We intentionally do
      // NOT use onClick here because a polygon-mode user might also
      // drag (intentionally or otherwise) — mousedown is the explicit
      // "place a point" action; mouseup does nothing in polygon mode.
      setFinalPolygon((prev) => [...prev, p]);
    }
  }

  function handleSurfaceMouseMove(e: React.MouseEvent): void {
    const p = pointFromEvent(e);
    if (!p) return;
    if (mode === 'rectangle') {
      // Functional setState — see rect/setRect note above.
      setRect((prev) => (prev ? { start: prev.start, end: p } : null));
    } else if (mode === 'freehand') {
      setFreehandPath((prev) => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1]!;
        if (Math.hypot(p.x - last.x, p.y - last.y) >= FREEHAND_MIN_DELTA_PX) {
          return [...prev, p];
        }
        return prev;
      });
    }
    // Polygon mode ignores mousemove.
  }

  function handleSurfaceMouseUp(e: React.MouseEvent): void {
    if (mode === 'rectangle') {
      // Read the mouseup point from the event so the commit width/height
      // matches where the user actually released. React 18 batching
      // means the last `setRect(end)` from handleSurfaceMouseMove may
      // not have flushed before this handler runs — relying on state
      // here would commit a stale bbox. The start point is from the
      // functional-setter closure which IS the latest committed state.
      const releasePoint = pointFromEvent(e);
      setRect((prev) => {
        if (!prev) return null;
        const startPoint = prev.start;
        const endPoint = releasePoint ?? prev.end;
        const x = Math.min(startPoint.x, endPoint.x);
        const y = Math.min(startPoint.y, endPoint.y);
        const w = Math.abs(endPoint.x - startPoint.x);
        const h = Math.abs(endPoint.y - startPoint.y);
        if (w >= RECT_MIN_DIM_PX && h >= RECT_MIN_DIM_PX) {
          // Convert rect to a 4-corner polygon so the IPC contract is
          // uniform across modes.
          setFinalPolygon([
            { x, y },
            { x: x + w, y },
            { x: x + w, y: y + h },
            { x, y: y + h },
          ]);
        }
        return null;
      });
      return;
    }
    if (mode === 'freehand') {
      // Append the release point as the final sample so the committed
      // path always reaches the cursor's release position (otherwise the
      // path stops at the last 5px-gated sample).
      const releasePoint = pointFromEvent(e);
      setFreehandPath((prev) => {
        let path = prev;
        if (releasePoint !== null) {
          path = [...prev, releasePoint];
        }
        if (path.length >= MIN_POLYGON_VERTICES) {
          setFinalPolygon(path);
        }
        return [];
      });
    }
  }

  // If the cursor leaves the surface mid-drag the natural next event is
  // a mouseup on something else (the modal overlay, the dialog backdrop).
  // We don't listen globally for mouseup — but we DO cancel the in-progress
  // shape on leave, so a partial commit doesn't leak as a preview.
  function handleSurfaceMouseLeave(): void {
    if (mode === 'rectangle') {
      setRect(null);
    } else if (mode === 'freehand') {
      setFreehandPath([]);
    }
  }

  // Keyboard: Escape clears the selection; Backspace removes the last
  // vertex. Bound on the wrapping div. Polygon-style backspace also
  // works on a committed rectangle (drops one corner) — degenerate but
  // harmless; it still feeds the same IPC pipeline.
  function handleKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Backspace' && finalPolygon.length > 0) {
      e.preventDefault();
      setFinalPolygon((prev) => prev.slice(0, -1));
    } else if (e.key === 'Escape' && finalPolygon.length > 0) {
      e.preventDefault();
      setFinalPolygon([]);
    }
  }

  async function handleApply(): Promise<void> {
    const img = imgRef.current;
    if (!img || finalPolygon.length < MIN_POLYGON_VERTICES) return;

    // Displayed → natural pixels. A zero-width rect only happens in a
    // detached/unlaid-out DOM; fall back to 1:1 rather than dividing by 0.
    const displayed = img.getBoundingClientRect();
    const scaleX = displayed.width > 0 ? img.naturalWidth / displayed.width : 1;
    const scaleY = displayed.height > 0 ? img.naturalHeight / displayed.height : 1;

    const naturalWidth = img.naturalWidth || Math.round(displayed.width) || 1;
    const naturalHeight = img.naturalHeight || Math.round(displayed.height) || 1;

    // Convert the selection to natural pixels, then bbox.
    const naturalPolygon: CropPolygon = finalPolygon.map((p) => ({
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
        setFinalPolygon([]);
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

  // SVG geometries (display coords).
  const rectPreview = rect !== null
    ? {
        x: Math.min(rect.start.x, rect.end.x),
        y: Math.min(rect.start.y, rect.end.y),
        width: Math.abs(rect.end.x - rect.start.x),
        height: Math.abs(rect.end.y - rect.start.y),
      }
    : null;
  const finalPolyAttr = finalPolygon.map((p) => `${p.x},${p.y}`).join(' ');
  const freehandAttr = freehandPath.map((p) => `${p.x},${p.y}`).join(' ');

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
            {mode === 'polygon'
              ? t('screenshot.cropPolygonHint')
              : t('screenshot.cropModeHint')}
          </DialogDescription>
        </DialogHeader>

        {/* Phase 8 / Plan 16 (G-08-9) — mode toggle. Clicking a mode
            clears any in-progress selection so the user can't carry a
            half-drawn rect across into a freehand path. */}
        <div
          className="flex gap-2 border-b border-border pb-3"
          data-testid="screenshot-crop-mode-toggle"
        >
          <Button
            variant={mode === 'rectangle' ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              if (mode !== 'rectangle') {
                clearAll();
                setMode('rectangle');
              }
            }}
            data-testid="screenshot-crop-mode-rectangle"
            disabled={applying}
          >
            {t('screenshot.cropModeRectangle')}
          </Button>
          <Button
            variant={mode === 'freehand' ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              if (mode !== 'freehand') {
                clearAll();
                setMode('freehand');
              }
            }}
            data-testid="screenshot-crop-mode-freehand"
            disabled={applying}
          >
            {t('screenshot.cropModeFreehand')}
          </Button>
          <Button
            variant={mode === 'polygon' ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              if (mode !== 'polygon') {
                clearAll();
                setMode('polygon');
              }
            }}
            data-testid="screenshot-crop-mode-polygon"
            disabled={applying}
          >
            {t('screenshot.cropModePolygon')}
          </Button>
        </div>

        <div className="flex justify-center rounded bg-black">
          {/* ponytail: the SVG overlay is positioned against THIS box, so it
              must hug the image exactly — `w-fit` + `relative` on the
              image's own wrapper, not on the centring flex parent. */}
          <div
            className="relative w-fit select-none"
            tabIndex={0}
            onMouseDown={handleSurfaceMouseDown}
            onMouseMove={handleSurfaceMouseMove}
            onMouseUp={handleSurfaceMouseUp}
            onMouseLeave={handleSurfaceMouseLeave}
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
                The SVG is pointer-events:none so all drags land on the surface. */}
            {(rectPreview !== null && rectPreview.width > 0 && rectPreview.height > 0) ||
            freehandPath.length >= 2 ||
            finalPolygon.length >= 2 ? (
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full"
                data-testid="screenshot-crop-overlay"
              >
                {/* Rectangle mode — live drag preview only. The committed
                    rectangle becomes finalPolygon (4 corners) and renders
                    via the polyline/vertex paths below. */}
                {rectPreview !== null && rectPreview.width > 0 && rectPreview.height > 0 ? (
                  <rect
                    x={rectPreview.x}
                    y={rectPreview.y}
                    width={rectPreview.width}
                    height={rectPreview.height}
                    fill="rgba(59,130,246,0.2)"
                    stroke="rgb(59,130,246)"
                    strokeWidth={2}
                    data-testid="screenshot-crop-rect-preview"
                  />
                ) : null}
                {/* Freehand mode — live drag polyline. Closes only on commit
                    (the render of finalPolygon below shows the closed shape). */}
                {freehandPath.length >= 2 ? (
                  <polyline
                    points={freehandAttr}
                    fill="none"
                    stroke="rgb(59,130,246)"
                    strokeWidth={2}
                    strokeDasharray="4 2"
                    data-testid="screenshot-crop-freehand-preview"
                  />
                ) : null}
                {/* Committed selection — rectangle (4 corners), polygon,
                    or freehand sampled path all render the same way: a
                    filled polyline + per-vertex dots. */}
                {finalPolygon.length >= 2 ? (
                  <polyline
                    points={finalPolyAttr}
                    fill="rgba(59,130,246,0.2)"
                    stroke="rgb(59,130,246)"
                    strokeWidth={2}
                    data-testid="screenshot-crop-polyline"
                  />
                ) : null}
                {finalPolygon.map((p, idx) => (
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
        {finalPolygon.length > 0 && finalPolygon.length < MIN_POLYGON_VERTICES ? (
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
              clearAll();
            }}
            disabled={applying || finalPolygon.length === 0}
            data-testid="screenshot-crop-clear"
          >
            {t('common.clear')}
          </Button>
          <Button
            onClick={() => {
              void handleApply();
            }}
            disabled={applying || finalPolygon.length < MIN_POLYGON_VERTICES}
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
