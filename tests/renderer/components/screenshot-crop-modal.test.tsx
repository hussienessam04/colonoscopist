// @vitest-environment happy-dom
// ScreenshotCropModal — Phase 8 / Plan 14 + Plan 15 (SCRN-02 extended).
//
// Phase 8 / Plan 15 (G-08-8) — refactored for free-form polygon crop:
//   * The modal fetches the JPEG bytes via the new `screenshots.getBlob`
//     IPC and uses the resulting `blob:` URL as the <img> src (no canvas
//     taint).
//   * Click-to-add vertices, double-click to finalize (no-op), min 3
//     vertices to enable Apply.
//   * Apply crops to the polygon's bounding box (v1 simplification — see
//     deviations in SUMMARY).
//
// Plan 14's drag-rectangle tests are intentionally replaced by the
// polygon flows — the drag-rectangle surface is gone. happy-dom ships
// no canvas implementation, so getContext / toBlob are stubbed.

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
      onClose={onClose}
      onCropped={onCropped}
    />,
  );
  stubImageGeometry();
  return { onCropped, onClose };
}

// Click N points into the polygon. Each click adds a vertex.
function clickPolygonVertices(points: Array<{ x: number; y: number }>): void {
  const surface = screen.getByTestId('screenshot-crop-surface');
  for (const p of points) {
    fireEvent.click(surface, { clientX: p.x, clientY: p.y });
  }
}

beforeEach(() => {
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  stubCanvas();
});

describe('ScreenshotCropModal (Plan 14 + Plan 15 polygon)', () => {
  it('Plan 15: fetches the JPEG bytes via screenshots.getBlob and renders an <img> with a blob: URL', async () => {
    renderModal();
    const api = getApi();
    // The api default mock resolves getBlob with a tiny JPEG; the modal
    // calls it on mount and the effect creates a blob: URL it sets on
    // the <img>. happy-dom does not actually fetch the URL — the <img>
    // stays rendered with whatever src the React tree assigned.
    await waitFor(() => expect(api.screenshots.getBlob).toHaveBeenCalledWith({ id: 7 }));
    const img = screen.getByTestId('screenshot-crop-img') as HTMLImageElement;
    expect(img.src.startsWith('blob:')).toBe(true);
  });

  it('Plan 15: clicking on the surface appends a vertex to the SVG overlay', () => {
    renderModal();
    // No vertices yet.
    expect(screen.queryAllByTestId('screenshot-crop-vertex')).toHaveLength(0);
    // Click 4 vertices forming a polygon.
    clickPolygonVertices([
      { x: 100, y: 50 },
      { x: 300, y: 50 },
      { x: 300, y: 200 },
      { x: 100, y: 200 },
    ]);
    const vertices = screen.getAllByTestId('screenshot-crop-vertex');
    expect(vertices).toHaveLength(4);
    expect(vertices[0].getAttribute('data-vertex')).toBe('100,50');
    expect(vertices[3].getAttribute('data-vertex')).toBe('100,200');
  });

  it('Plan 15: Apply is disabled with 0 vertices and with 2 vertices; enabled at >=3', () => {
    renderModal();
    expect(screen.getByTestId('screenshot-crop-apply')).toBeDisabled();
    clickPolygonVertices([{ x: 100, y: 50 }]);
    expect(screen.getByTestId('screenshot-crop-apply')).toBeDisabled();
    clickPolygonVertices([{ x: 200, y: 100 }]);
    expect(screen.getByTestId('screenshot-crop-apply')).toBeDisabled();
    clickPolygonVertices([{ x: 300, y: 200 }]);
    expect(screen.getByTestId('screenshot-crop-apply')).not.toBeDisabled();
  });

  it('Plan 15: vertex state clears via the Clear button', () => {
    renderModal();
    clickPolygonVertices([
      { x: 100, y: 50 },
      { x: 300, y: 50 },
      { x: 300, y: 200 },
      { x: 100, y: 200 },
    ]);
    expect(screen.getByTestId('screenshot-crop-apply')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('screenshot-crop-clear'));
    // ponytail: use queryAllByTestId — getAllByTestId throws on 0 matches.
    expect(screen.queryAllByTestId('screenshot-crop-vertex')).toHaveLength(0);
    expect(screen.getByTestId('screenshot-crop-apply')).toBeDisabled();
  });

  it('Plan 15: Backspace removes the last vertex; Escape clears all', () => {
    renderModal();
    const surface = screen.getByTestId('screenshot-crop-surface');
    clickPolygonVertices([
      { x: 100, y: 50 },
      { x: 200, y: 100 },
      { x: 300, y: 200 },
      { x: 400, y: 300 },
    ]);
    expect(screen.getAllByTestId('screenshot-crop-vertex')).toHaveLength(4);
    fireEvent.keyDown(surface, { key: 'Backspace' });
    expect(screen.getAllByTestId('screenshot-crop-vertex')).toHaveLength(3);
    fireEvent.keyDown(surface, { key: 'Escape' });
    // ponytail: use queryAllByTestId — getAllByTestId throws on 0 matches.
    expect(screen.queryAllByTestId('screenshot-crop-vertex')).toHaveLength(0);
  });

  it('Plan 15: shows the "min 3 points" hint until the third vertex lands', () => {
    renderModal();
    expect(screen.queryByTestId('screenshot-crop-hint-min')).toBeNull();
    clickPolygonVertices([{ x: 100, y: 50 }]);
    expect(screen.getByTestId('screenshot-crop-hint-min')).not.toBeNull();
    clickPolygonVertices([{ x: 200, y: 100 }]);
    expect(screen.getByTestId('screenshot-crop-hint-min')).not.toBeNull();
    clickPolygonVertices([{ x: 300, y: 200 }]);
    expect(screen.queryByTestId('screenshot-crop-hint-min')).toBeNull();
  });

  it('Plan 15: clicking Clear empties the polygon and disables Apply', () => {
    renderModal();
    clickPolygonVertices([
      { x: 100, y: 50 },
      { x: 300, y: 50 },
      { x: 300, y: 200 },
      { x: 100, y: 200 },
    ]);
    expect(screen.getByTestId('screenshot-crop-apply')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('screenshot-crop-clear'));
    // ponytail: use queryAllByTestId — getAllByTestId throws on 0 matches.
    expect(screen.queryAllByTestId('screenshot-crop-vertex')).toHaveLength(0);
    expect(screen.getByTestId('screenshot-crop-apply')).toBeDisabled();
  });

  it('Plan 15: Backspace removes the last vertex; Escape clears all', () => {
    renderModal();
    const surface = screen.getByTestId('screenshot-crop-surface');
    clickPolygonVertices([
      { x: 100, y: 50 },
      { x: 200, y: 100 },
      { x: 300, y: 200 },
      { x: 400, y: 300 },
    ]);
    expect(screen.getAllByTestId('screenshot-crop-vertex')).toHaveLength(4);
    fireEvent.keyDown(surface, { key: 'Backspace' });
    expect(screen.getAllByTestId('screenshot-crop-vertex')).toHaveLength(3);
    fireEvent.keyDown(surface, { key: 'Escape' });
    // ponytail: use queryAllByTestId — getAllByTestId throws on 0 matches.
    expect(screen.queryAllByTestId('screenshot-crop-vertex')).toHaveLength(0);
  });

  it('Plan 15: Apply sends the polygon (natural pixels) over screenshots.crop + closes + toasts success', async () => {
    const { onCropped, onClose } = renderModal();
    const api = getApi();
    api.screenshots.crop.mockResolvedValue({
      ok: true,
      newDimensions: { width: 400, height: 300 },
      byteSize: 4,
    });

    // 4-point polygon: bbox in display coords = (100,50) ... (300,200) = 200x150.
    // At 2x display->natural scale: bbox = (200,100) ... 400x300.
    // The polygon collapses to the bbox on the renderer side BEFORE the
    // IPC, so the main side receives only the bbox-shaped polygon
    // (or, equivalently, the renderer could send just the bbox rect;
    // we send a polygon because the contract is preferred).
    clickPolygonVertices([
      { x: 100, y: 50 },
      { x: 300, y: 50 },
      { x: 300, y: 200 },
      { x: 100, y: 200 },
    ]);
    fireEvent.click(screen.getByTestId('screenshot-crop-apply'));

    await waitFor(() => expect(api.screenshots.crop).toHaveBeenCalledTimes(1));
    const arg = api.screenshots.crop.mock.calls[0]![0] as {
      id: number;
      croppedBase64: string;
      originalDimensions: { width: number; height: number };
      cropPolygon?: Array<{ x: number; y: number }>;
      cropRect?: { x: number; y: number; width: number; height: number };
    };
    expect(arg.id).toBe(7);
    expect(arg.originalDimensions).toEqual({ width: NATURAL_W, height: NATURAL_H });
    expect(arg.croppedBase64.length).toBeGreaterThan(0);
    // Bbox in natural pixels = (200,100) 400x300.
    expect(arg.cropPolygon).toBeDefined();
    const xs = arg.cropPolygon!.map((p) => p.x);
    const ys = arg.cropPolygon!.map((p) => p.y);
    expect(Math.min(...xs)).toBe(200);
    expect(Math.max(...xs)).toBe(600);
    expect(Math.min(...ys)).toBe(100);
    expect(Math.max(...ys)).toBe(400);

    await waitFor(() => expect(onCropped).toHaveBeenCalledTimes(1));
    expect(onCropped).toHaveBeenCalledWith({ width: 400, height: 300, byteSize: 4 });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(toastMock.success).toHaveBeenCalled();
  });

  it('Plan 15: Cancel closes without any IPC call', () => {
    const { onClose } = renderModal();
    const api = getApi();
    clickPolygonVertices([
      { x: 100, y: 50 },
      { x: 200, y: 100 },
      { x: 300, y: 200 },
    ]);
    fireEvent.click(screen.getByTestId('screenshot-crop-cancel'));
    expect(api.screenshots.crop).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Plan 15: an IPC_INVALID_CROP result surfaces an error toast and leaves the modal open', async () => {
    const { onClose } = renderModal();
    const api = getApi();
    api.screenshots.crop.mockResolvedValue({ ok: false, code: 'IPC_INVALID_CROP' });

    clickPolygonVertices([
      { x: 100, y: 50 },
      { x: 200, y: 100 },
      { x: 300, y: 200 },
    ]);
    fireEvent.click(screen.getByTestId('screenshot-crop-apply'));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
  });
});
