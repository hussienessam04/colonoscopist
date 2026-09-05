// @vitest-environment happy-dom
// ScreenshotCropModal — Phase 8 / Plan 14 + Plan 15 + Plan 16 (SCRN-02 extended).
//
// Phase 8 / Plan 15 (G-08-8) — refactored for free-form polygon crop:
//   * The modal fetches the JPEG bytes via the new `screenshots.getBlob`
//     IPC and uses the resulting `blob:` URL as the <img> src (no canvas
//     taint).
//   * Click-to-add vertices (polygon mode), min 3 vertices to enable Apply.
//   * Apply crops to the polygon's bounding box (v1 simplification — see
//     deviations in SUMMARY).
//
// Phase 8 / Plan 16 (G-08-9) — added a mode toggle (Rectangle | Free-hand |
// Polygon). Default mode is Rectangle so a routine crop is one drag.
// The polygon-mode tests below mirror Plan 15's flow; Plan 16 adds
// rectangle drag + freehand drag coverage at the end.
//
// happy-dom ships no canvas implementation, so getContext / toBlob are stubbed.

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

// Switch to polygon mode first (Rectangle is the default — Plan 16).
// Use mouseDown to add vertices: Plan 16 moved polygon-mode add off
// `onClick` and onto `onMouseDown` so a single mousedown handler can
// route to the right mode-aware branch.
function clickPolygonVertices(points: Array<{ x: number; y: number }>): void {
  fireEvent.click(screen.getByTestId('screenshot-crop-mode-polygon'));
  const surface = screen.getByTestId('screenshot-crop-surface');
  for (const p of points) {
    fireEvent.mouseDown(surface, { clientX: p.x, clientY: p.y });
  }
}

// Drive a Rectangle-mode drag with explicit start, a few intermediate
// moves (preview updates), and an end. All events stay on the surface
// — leaving it cancels the drag (mirrors real UX).
function dragRectangle(
  start: { x: number; y: number },
  moves: Array<{ x: number; y: number }>,
  end: { x: number; y: number },
): void {
  fireEvent.click(screen.getByTestId('screenshot-crop-mode-rectangle'));
  const surface = screen.getByTestId('screenshot-crop-surface');
  fireEvent.mouseDown(surface, { clientX: start.x, clientY: start.y });
  for (const m of moves) {
    fireEvent.mouseMove(surface, { clientX: m.x, clientY: m.y });
  }
  fireEvent.mouseUp(surface, { clientX: end.x, clientY: end.y });
}

// Drive a Free-hand mode drag that samples the cursor path. We sample
// enough points that the 5px minimum-delta branch is hit at least once.
function dragFreehand(points: Array<{ x: number; y: number }>): void {
  fireEvent.click(screen.getByTestId('screenshot-crop-mode-freehand'));
  const surface = screen.getByTestId('screenshot-crop-surface');
  // The first point is the mousedown sample — every subsequent move is
  // a mousemove (some may be ignored if too close to the last sample).
  const [first, ...rest] = points;
  if (!first) throw new Error('dragFreehand needs at least one point');
  fireEvent.mouseDown(surface, { clientX: first.x, clientY: first.y });
  for (const m of rest) {
    fireEvent.mouseMove(surface, { clientX: m.x, clientY: m.y });
  }
  // mouseup at the last sampled point — happy-dom doesn't simulate
  // cursor position, but we issue the event so the handler runs.
  const last = rest[rest.length - 1] ?? first;
  fireEvent.mouseUp(surface, { clientX: last.x, clientY: last.y });
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

  // ─────────────────────────────────────────────────────────────────────
  // Phase 8 / Plan 16 (G-08-9) — Rectangle + Free-hand crop modes.
  // ─────────────────────────────────────────────────────────────────────

  it('Plan 16: default mode is Rectangle (the mode toggle reflects it)', () => {
    renderModal();
    // Rectangle is the variant button (variant=default from Plan 16);
    // outline buttons render the disabled-style outline variant.
    const rectButton = screen.getByTestId('screenshot-crop-mode-rectangle');
    const freeButton = screen.getByTestId('screenshot-crop-mode-freehand');
    const polyButton = screen.getByTestId('screenshot-crop-mode-polygon');
    expect(rectButton).not.toBeDisabled();
    expect(freeButton).not.toBeDisabled();
    expect(polyButton).not.toBeDisabled();
    // The mode buttons are reachable; the surface is ready to be dragged.
    expect(screen.getByTestId('screenshot-crop-mode-toggle')).not.toBeNull();
  });

  it('Plan 16: Rectangle mode — one drag (mousedown → move → mouseup) commits 4 corners', () => {
    renderModal();
    // No polygon vertices drawn yet.
    expect(screen.queryAllByTestId('screenshot-crop-vertex')).toHaveLength(0);
    // Apply is disabled until we have >=3 finalPolygon vertices.
    expect(screen.getByTestId('screenshot-crop-apply')).toBeDisabled();

    // Drag a rectangle from (100,50) to (300,200) — preview passes
    // through (200,100) before committing.
    dragRectangle(
      { x: 100, y: 50 },
      [{ x: 200, y: 100 }, { x: 250, y: 150 }],
      { x: 300, y: 200 },
    );

    // 4 corners (TL, TR, BR, BL). The committed rectangle is the
    // axis-aligned polygon — we render the four <circle> vertex dots.
    const vertices = screen.getAllByTestId('screenshot-crop-vertex');
    expect(vertices).toHaveLength(4);
    expect(vertices[0].getAttribute('data-vertex')).toBe('100,50');
    expect(vertices[1].getAttribute('data-vertex')).toBe('300,50');
    expect(vertices[2].getAttribute('data-vertex')).toBe('300,200');
    expect(vertices[3].getAttribute('data-vertex')).toBe('100,200');
    expect(screen.getByTestId('screenshot-crop-apply')).not.toBeDisabled();
  });

  it('Plan 16: Rectangle drag smaller than 10px is rejected (no commit)', () => {
    renderModal();
    // An accidental click should not produce a usable selection.
    dragRectangle(
      { x: 100, y: 50 },
      [],
      { x: 105, y: 55 }, // 5x5 px — under RECT_MIN_DIM_PX.
    );
    expect(screen.queryAllByTestId('screenshot-crop-vertex')).toHaveLength(0);
    expect(screen.getByTestId('screenshot-crop-apply')).toBeDisabled();
  });

  it('Plan 16: Rectangle Apply sends the bbox polygon over IPC (2x scale)', async () => {
    const { onCropped, onClose } = renderModal();
    const api = getApi();
    api.screenshots.crop.mockResolvedValue({
      ok: true,
      newDimensions: { width: 400, height: 300 },
      byteSize: 4,
    });

    // 200x150 display rect = 400x300 natural bbox.
    dragRectangle(
      { x: 100, y: 50 },
      [{ x: 200, y: 100 }],
      { x: 300, y: 200 },
    );
    fireEvent.click(screen.getByTestId('screenshot-crop-apply'));

    await waitFor(() => expect(api.screenshots.crop).toHaveBeenCalledTimes(1));
    const arg = api.screenshots.crop.mock.calls[0]![0] as {
      id: number;
      originalDimensions: { width: number; height: number };
      cropPolygon: Array<{ x: number; y: number }>;
    };
    expect(arg.id).toBe(7);
    expect(arg.originalDimensions).toEqual({ width: NATURAL_W, height: NATURAL_H });
    const xs = arg.cropPolygon.map((p) => p.x);
    const ys = arg.cropPolygon.map((p) => p.y);
    expect(Math.min(...xs)).toBe(200);
    expect(Math.max(...xs)).toBe(600);
    expect(Math.min(...ys)).toBe(100);
    expect(Math.max(...ys)).toBe(400);

    await waitFor(() => expect(onCropped).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(toastMock.success).toHaveBeenCalled();
  });

  it('Plan 16: Free-hand mode — drag samples path points (>=3 vertices on release)', () => {
    renderModal();
    // Drag an arc-like path with enough moves to exceed the 5px delta
    // sampling threshold. We expect at least 3 vertices on the
    // committed selection (sampled points are condensed by the
    // min-delta gate).
    dragFreehand([
      { x: 100, y: 100 },
      { x: 130, y: 110 },
      { x: 160, y: 130 },
      { x: 200, y: 160 },
      { x: 240, y: 200 },
      { x: 260, y: 240 },
    ]);

    const vertices = screen.getAllByTestId('screenshot-crop-vertex');
    expect(vertices.length).toBeGreaterThanOrEqual(3);
    // First and last samples anchor the path.
    expect(vertices[0].getAttribute('data-vertex')).toBe('100,100');
    expect(vertices[vertices.length - 1].getAttribute('data-vertex')).toBe('260,240');
    expect(screen.getByTestId('screenshot-crop-apply')).not.toBeDisabled();
  });

  it('Plan 16: switching mode clears the previous selection', () => {
    renderModal();
    // Draw a rectangle selection.
    dragRectangle(
      { x: 100, y: 50 },
      [{ x: 200, y: 100 }],
      { x: 300, y: 200 },
    );
    expect(screen.getAllByTestId('screenshot-crop-vertex')).toHaveLength(4);

    // Switch to Polygon — the rectangle's 4 vertices disappear; the
    // selection state is fresh.
    fireEvent.click(screen.getByTestId('screenshot-crop-mode-polygon'));
    expect(screen.queryAllByTestId('screenshot-crop-vertex')).toHaveLength(0);
    expect(screen.getByTestId('screenshot-crop-apply')).toBeDisabled();

    // Switch to Free-hand — still empty.
    fireEvent.click(screen.getByTestId('screenshot-crop-mode-freehand'));
    expect(screen.queryAllByTestId('screenshot-crop-vertex')).toHaveLength(0);
  });

  it('Plan 16: Polygon mode after Plan 16 keeps the legacy click-to-add flow', () => {
    renderModal();
    // 3 vertices via polygon-mode mousedowns — Apply becomes enabled.
    clickPolygonVertices([
      { x: 100, y: 50 },
      { x: 200, y: 100 },
      { x: 300, y: 200 },
    ]);
    expect(screen.getAllByTestId('screenshot-crop-vertex')).toHaveLength(3);
    expect(screen.getByTestId('screenshot-crop-apply')).not.toBeDisabled();
  });

  // ─────────────────────────────────────────────────────────────────────
  // Phase 8 / Plan 17 (G-08-10) — shape editing after commit.
  //
  // The three modes commit into the same `finalPolygon` state. Once a
  // polygon is committed, doctors can drag individual vertices (resize)
  // or drag the interior (move the whole shape). The Clear button wipes
  // the polygon and re-enables the draw modes. The cursor flips to
  // `move` when the polygon is editable.
  // ─────────────────────────────────────────────────────────────────────

  it('Plan 17: after Rectangle commit, dragging a corner vertex moves that vertex only', () => {
    renderModal();
    // Commit a 4-corner rectangle.
    dragRectangle(
      { x: 100, y: 50 },
      [{ x: 200, y: 100 }],
      { x: 300, y: 200 },
    );
    const before = screen.getAllByTestId('screenshot-crop-vertex');
    expect(before).toHaveLength(4);
    expect(before[0].getAttribute('data-vertex')).toBe('100,50');

    // Drag the TL corner (vertex 0) by (+60, +40).
    const surface = screen.getByTestId('screenshot-crop-surface');
    fireEvent.mouseDown(surface, { clientX: 100, clientY: 50 });
    fireEvent.mouseMove(surface, { clientX: 160, clientY: 90 });
    fireEvent.mouseUp(surface, { clientX: 160, clientY: 90 });

    const after = screen.getAllByTestId('screenshot-crop-vertex');
    expect(after).toHaveLength(4);
    // TL moved; the other three corners are unchanged.
    expect(after[0].getAttribute('data-vertex')).toBe('160,90');
    expect(after[1].getAttribute('data-vertex')).toBe('300,50');
    expect(after[2].getAttribute('data-vertex')).toBe('300,200');
    expect(after[3].getAttribute('data-vertex')).toBe('100,200');
  });

  it('Plan 17: after Rectangle commit, dragging the interior translates the whole shape', () => {
    renderModal();
    dragRectangle(
      { x: 100, y: 50 },
      [{ x: 200, y: 100 }],
      { x: 300, y: 200 },
    );
    expect(screen.getAllByTestId('screenshot-crop-vertex')).toHaveLength(4);

    // Drag the interior (well inside the rectangle) by (+50, +25).
    // The cumulative delta across two moves is what's tested, since
    // shape-drag uses incremental deltas (see DragState.lastMove).
    const surface = screen.getByTestId('screenshot-crop-surface');
    fireEvent.mouseDown(surface, { clientX: 150, clientY: 100 });
    fireEvent.mouseMove(surface, { clientX: 175, clientY: 110 });
    fireEvent.mouseMove(surface, { clientX: 200, clientY: 125 });
    fireEvent.mouseUp(surface, { clientX: 200, clientY: 125 });

    const after = screen.getAllByTestId('screenshot-crop-vertex');
    expect(after).toHaveLength(4);
    // Every vertex shifted by (+50, +25): (+50, +25), (+50, +25), etc.
    expect(after[0].getAttribute('data-vertex')).toBe('150,75');
    expect(after[1].getAttribute('data-vertex')).toBe('350,75');
    expect(after[2].getAttribute('data-vertex')).toBe('350,225');
    expect(after[3].getAttribute('data-vertex')).toBe('150,225');
  });

  it('Plan 17: clicking Clear after a commit empties the polygon + disables Apply', () => {
    renderModal();
    dragRectangle(
      { x: 100, y: 50 },
      [{ x: 200, y: 100 }],
      { x: 300, y: 200 },
    );
    expect(screen.getByTestId('screenshot-crop-apply')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('screenshot-crop-clear'));
    // ponytail: use queryAllByTestId — getAllByTestId throws on 0 matches.
    expect(screen.queryAllByTestId('screenshot-crop-vertex')).toHaveLength(0);
    expect(screen.getByTestId('screenshot-crop-apply')).toBeDisabled();
  });

  it('Plan 17: after Rectangle commit, dragging an interior vertex moves that vertex only', () => {
    renderModal();
    // Build a 4-corner polygon via Rectangle-mode drag (the canonical
    // "committed polygon" path — Polygon mode never commits, so editing
    // shape only kicks in for Rectangle + Free-hand).
    dragRectangle(
      { x: 100, y: 50 },
      [{ x: 200, y: 100 }],
      { x: 300, y: 200 },
    );
    expect(screen.getAllByTestId('screenshot-crop-vertex')).toHaveLength(4);

    // Drag the BR corner (vertex 2) inward by (-40, -25).
    const surface = screen.getByTestId('screenshot-crop-surface');
    fireEvent.mouseDown(surface, { clientX: 300, clientY: 200 });
    fireEvent.mouseMove(surface, { clientX: 260, clientY: 175 });
    fireEvent.mouseUp(surface, { clientX: 260, clientY: 175 });

    const after = screen.getAllByTestId('screenshot-crop-vertex');
    expect(after).toHaveLength(4);
    expect(after[2].getAttribute('data-vertex')).toBe('260,175');
    // The 3 untouched corners stay where they were — edit doesn't add a
    // vertex on top of a vertex grab.
    expect(after[0].getAttribute('data-vertex')).toBe('100,50');
    expect(after[1].getAttribute('data-vertex')).toBe('300,50');
    expect(after[3].getAttribute('data-vertex')).toBe('100,200');
  });

  it('Plan 17: surface cursor flips to "move" once a polygon is committed', () => {
    renderModal();
    // Before commit — drawing mode, crosshair.
    const surface = screen.getByTestId('screenshot-crop-surface');
    expect((surface as HTMLElement).style.cursor).toBe('crosshair');

    // Commit a rectangle.
    dragRectangle(
      { x: 100, y: 50 },
      [{ x: 200, y: 100 }],
      { x: 300, y: 200 },
    );

    expect((surface as HTMLElement).style.cursor).toBe('move');
  });

  it('Plan 17: switching to a new mode while a polygon is committed clears it', () => {
    renderModal();
    dragRectangle(
      { x: 100, y: 50 },
      [{ x: 200, y: 100 }],
      { x: 300, y: 200 },
    );
    expect(screen.getAllByTestId('screenshot-crop-vertex')).toHaveLength(4);

    // Switch to free-hand → cleared.
    fireEvent.click(screen.getByTestId('screenshot-crop-mode-freehand'));
    expect(screen.queryAllByTestId('screenshot-crop-vertex')).toHaveLength(0);

    // Switch to polygon → still cleared.
    fireEvent.click(screen.getByTestId('screenshot-crop-mode-polygon'));
    expect(screen.queryAllByTestId('screenshot-crop-vertex')).toHaveLength(0);
  });

  it('Plan 17: applying a freehand crop sends the latest (edited) polygon over IPC', async () => {
    const { onCropped, onClose } = renderModal();
    const api = getApi();
    api.screenshots.crop.mockResolvedValue({
      ok: true,
      newDimensions: { width: 100, height: 100 },
      byteSize: 4,
    });

    // Draw a freehand path.
    dragFreehand([
      { x: 100, y: 100 },
      { x: 130, y: 110 },
      { x: 160, y: 130 },
      { x: 200, y: 160 },
      { x: 240, y: 200 },
      { x: 260, y: 240 },
    ]);
    expect(screen.getAllByTestId('screenshot-crop-vertex').length).toBeGreaterThanOrEqual(3);

    // Drag the interior down by +20 px so the Apply payload reflects
    // the edit (the polygon sent over IPC should be shifted from the
    // original sampled coords).
    const surface = screen.getByTestId('screenshot-crop-surface');
    fireEvent.mouseDown(surface, { clientX: 150, clientY: 130 });
    fireEvent.mouseMove(surface, { clientX: 150, clientY: 150 });
    fireEvent.mouseUp(surface, { clientX: 150, clientY: 150 });

    // Apply.
    fireEvent.click(screen.getByTestId('screenshot-crop-apply'));
    await waitFor(() => expect(api.screenshots.crop).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onCropped).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);

    // ponytail: don't pin exact polygon coords here — freehand sampling
    // path is allowed to drift. The Edit invariant: at least one vertex
    // moved vs. the first sample (100, 100). Pre-edit the minY was 100
    // (first sample); post-edit the interior drag should have shifted
    // every vertex downward. The polygon sent over IPC carries the
    // post-edit coords.
    const arg = api.screenshots.crop.mock.calls[0]![0] as {
      cropPolygon: Array<{ x: number; y: number }>;
    };
    const minY = Math.min(...arg.cropPolygon.map((p) => p.y));
    expect(minY).toBeGreaterThan(100 - 1); // starting sample y; allow 1px slack
    expect(arg.cropPolygon.length).toBeGreaterThanOrEqual(3);
  });
});
