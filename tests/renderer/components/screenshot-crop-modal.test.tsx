// @vitest-environment happy-dom
// ScreenshotCropModal — Phase 8 / Plan 14 (SCRN-02 extended).
//
// Three cases per the plan: drag updates the selection rect, Apply
// invokes screenshots.crop with the natural-pixel rect, Cancel makes no
// IPC call. happy-dom ships no canvas implementation, so getContext /
// toBlob are stubbed the same way capture-screenshot.test.ts does.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../setup';
import { getApi } from '../setup';
import { ScreenshotCropModal } from '@/components/ScreenshotCropModal';

const toastMock = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
);
vi.mock('sonner', () => ({ toast: toastMock }));

// The displayed image is 640x360 on screen; the source is 1280x720. The
// 2x factor is what proves the display -> natural conversion happens.
const DISPLAY_W = 640;
const DISPLAY_H = 360;
const NATURAL_W = 1280;
const NATURAL_H = 720;

function stubCanvas(): void {
  const proto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  proto.getContext = function (): CanvasRenderingContext2D {
    return { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
  };
  proto.toBlob = function (cb: BlobCallback, type?: string): void {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    setTimeout(() => cb(new Blob([bytes], { type: type ?? 'image/jpeg' })), 0);
  };
}

// happy-dom lays nothing out — every rect is 0x0 and naturalWidth is 0.
// Pin both so the component's display->natural maths has real numbers.
function stubImageGeometry(): void {
  const img = screen.getByTestId('screenshot-crop-img') as HTMLImageElement;
  Object.defineProperty(img, 'naturalWidth', { value: NATURAL_W, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: NATURAL_H, configurable: true });
  img.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: DISPLAY_W,
      bottom: DISPLAY_H,
      width: DISPLAY_W,
      height: DISPLAY_H,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

function renderModal(onCropped = vi.fn(), onClose = vi.fn()): {
  onCropped: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
} {
  render(
    <ScreenshotCropModal
      open
      screenshotId={7}
      src="http://127.0.0.1:51731/media/p1/proc1/screenshots/5000.jpg"
      onClose={onClose}
      onCropped={onCropped}
    />,
  );
  stubImageGeometry();
  return { onCropped, onClose };
}

function drag(from: { x: number; y: number }, to: { x: number; y: number }): void {
  const surface = screen.getByTestId('screenshot-crop-surface');
  fireEvent.mouseDown(surface, { clientX: from.x, clientY: from.y });
  fireEvent.mouseMove(surface, { clientX: to.x, clientY: to.y });
  fireEvent.mouseUp(surface, { clientX: to.x, clientY: to.y });
}

beforeEach(() => {
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  stubCanvas();
});

describe('ScreenshotCropModal', () => {
  it('dragging over the image produces a selection rectangle', () => {
    renderModal();
    expect(screen.queryByTestId('screenshot-crop-selection')).toBeNull();
    drag({ x: 100, y: 50 }, { x: 300, y: 200 });
    const sel = screen.getByTestId('screenshot-crop-selection');
    // Selection is in DISPLAYED coordinates at this point.
    expect(sel.getAttribute('data-rect')).toBe('100,50,200,150');
  });

  it('Apply sends the natural-pixel crop rect over screenshots.crop', async () => {
    const { onCropped, onClose } = renderModal();
    const api = getApi();
    api.screenshots.crop.mockResolvedValue({
      ok: true,
      newDimensions: { width: 400, height: 300 },
      byteSize: 4,
    });

    drag({ x: 100, y: 50 }, { x: 300, y: 200 });
    fireEvent.click(screen.getByTestId('screenshot-crop-apply'));

    await waitFor(() => expect(api.screenshots.crop).toHaveBeenCalledTimes(1));
    const arg = api.screenshots.crop.mock.calls[0]![0] as {
      id: number;
      jpegBase64: string;
      originalDimensions: { width: number; height: number };
      cropRect: { x: number; y: number; width: number; height: number };
    };
    expect(arg.id).toBe(7);
    expect(arg.originalDimensions).toEqual({ width: NATURAL_W, height: NATURAL_H });
    // Displayed 100,50 200x150 at a 2x scale -> 200,100 400x300 natural.
    expect(arg.cropRect).toEqual({ x: 200, y: 100, width: 400, height: 300 });
    expect(arg.jpegBase64.length).toBeGreaterThan(0);

    await waitFor(() => expect(onCropped).toHaveBeenCalledTimes(1));
    expect(onCropped).toHaveBeenCalledWith({ width: 400, height: 300, byteSize: 4 });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(toastMock.success).toHaveBeenCalled();
  });

  it('Cancel closes without any IPC call', () => {
    const { onClose } = renderModal();
    const api = getApi();
    drag({ x: 100, y: 50 }, { x: 300, y: 200 });
    fireEvent.click(screen.getByTestId('screenshot-crop-cancel'));
    expect(api.screenshots.crop).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Apply is disabled until a selection exists', () => {
    renderModal();
    expect(screen.getByTestId('screenshot-crop-apply')).toBeDisabled();
    drag({ x: 100, y: 50 }, { x: 300, y: 200 });
    expect(screen.getByTestId('screenshot-crop-apply')).not.toBeDisabled();
  });

  it('an IPC_INVALID_CROP result surfaces an error toast and leaves the modal open', async () => {
    const { onClose } = renderModal();
    const api = getApi();
    api.screenshots.crop.mockResolvedValue({ ok: false, code: 'IPC_INVALID_CROP' });

    drag({ x: 100, y: 50 }, { x: 300, y: 200 });
    fireEvent.click(screen.getByTestId('screenshot-crop-apply'));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
  });
});
