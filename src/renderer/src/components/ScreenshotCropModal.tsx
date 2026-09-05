// ScreenshotCropModal — Phase 8 / Plan 14 (SCRN-02 extended).
//
// A doctor's mid-procedure framing often includes scope chrome or
// adjacent anatomy. This modal lets them drag a rectangle over the
// full-size screenshot and permanently crop the source JPEG.
//
// ponytail: the displayed image is the <img> itself with an absolutely
// positioned overlay div for the selection — no canvas for display. A
// canvas is created offscreen ONLY on Apply, which is the one place the
// pixels actually matter. Half the code of a canvas-rendered editor and
// it inherits the browser's own image scaling.
//
// Selection is tracked in DISPLAYED coordinates (what the doctor sees)
// and converted to NATURAL pixels once, on Apply — cropping at display
// resolution would throw away detail on a downscaled 1280px capture.

import { useRef, useState } from 'react';
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
import { blobToBase64 } from '@/lib/capture-screenshot';
import type { CropRect } from '@shared/ipc-contract';

export type ScreenshotCropModalProps = {
  open: boolean;
  screenshotId: number;
  src: string;
  onClose: () => void;
  onCropped: (result: { width: number; height: number; byteSize: number }) => void;
};

const JPEG_QUALITY = 0.9;
const MIN_SELECTION_PX = 4;

type Point = { x: number; y: number };

function rectFrom(a: Point, b: Point): CropRect {
  return {
    x: Math.round(Math.min(a.x, b.x)),
    y: Math.round(Math.min(a.y, b.y)),
    width: Math.round(Math.abs(a.x - b.x)),
    height: Math.round(Math.abs(a.y - b.y)),
  };
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
  const dragStartRef = useRef<Point | null>(null);
  const [selection, setSelection] = useState<CropRect | null>(null);
  const [applying, setApplying] = useState(false);

  function pointFromEvent(e: React.MouseEvent): Point | null {
    const img = imgRef.current;
    if (!img) return null;
    const rect = img.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(rect.width, e.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, e.clientY - rect.top)),
    };
  }

  function handleMouseDown(e: React.MouseEvent): void {
    const p = pointFromEvent(e);
    if (!p) return;
    dragStartRef.current = p;
    setSelection(null);
  }

  function handleMouseMove(e: React.MouseEvent): void {
    const start = dragStartRef.current;
    if (!start) return;
    const p = pointFromEvent(e);
    if (!p) return;
    setSelection(rectFrom(start, p));
  }

  function handleMouseUp(e: React.MouseEvent): void {
    const start = dragStartRef.current;
    if (!start) return;
    dragStartRef.current = null;
    const p = pointFromEvent(e);
    if (!p) return;
    const next = rectFrom(start, p);
    setSelection(
      next.width < MIN_SELECTION_PX || next.height < MIN_SELECTION_PX ? null : next,
    );
  }

  async function handleApply(): Promise<void> {
    const img = imgRef.current;
    if (!img || !selection) return;

    // Displayed → natural pixels. A zero-width rect only happens in a
    // detached/unlaid-out DOM; fall back to 1:1 rather than dividing by 0.
    const displayed = img.getBoundingClientRect();
    const scaleX = displayed.width > 0 ? img.naturalWidth / displayed.width : 1;
    const scaleY = displayed.height > 0 ? img.naturalHeight / displayed.height : 1;

    const naturalWidth = img.naturalWidth || Math.round(displayed.width) || 1;
    const naturalHeight = img.naturalHeight || Math.round(displayed.height) || 1;

    const x = Math.max(0, Math.round(selection.x * scaleX));
    const y = Math.max(0, Math.round(selection.y * scaleY));
    const cropRect: CropRect = {
      x,
      y,
      width: Math.max(1, Math.min(Math.round(selection.width * scaleX), naturalWidth - x)),
      height: Math.max(1, Math.min(Math.round(selection.height * scaleY), naturalHeight - y)),
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
      const jpegBase64 = await blobToBase64(blob);

      const result = await window.api.screenshots.crop({
        id: screenshotId,
        jpegBase64,
        originalDimensions: { width: naturalWidth, height: naturalHeight },
        cropRect,
      });

      if (result.ok) {
        toast.success(t('screenshot.cropSuccess'));
        onCropped({ ...result.newDimensions, byteSize: result.byteSize });
        setSelection(null);
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
          <DialogDescription>{t('screenshot.cropSelectHint')}</DialogDescription>
        </DialogHeader>
        <div className="flex justify-center rounded bg-black">
          {/* ponytail: the overlay is positioned against THIS box, so it
              must hug the image exactly — `w-fit` + `relative` on the
              image's own wrapper, not on the centring flex parent. */}
          <div
            className="relative w-fit select-none"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            data-testid="screenshot-crop-surface"
          >
            <img
              ref={imgRef}
              src={src}
              alt={t('screenshot.cropModalTitle')}
              className="max-h-[60vh] w-auto object-contain"
              data-testid="screenshot-crop-img"
              draggable={false}
            />
            {selection ? (
              <div
                className="pointer-events-none absolute border-2 border-primary bg-primary/20"
                style={{
                  left: selection.x,
                  top: selection.y,
                  width: selection.width,
                  height: selection.height,
                }}
                data-testid="screenshot-crop-selection"
                data-rect={`${selection.x},${selection.y},${selection.width},${selection.height}`}
              />
            ) : null}
          </div>
        </div>
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
            onClick={() => {
              void handleApply();
            }}
            disabled={applying || selection === null}
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
