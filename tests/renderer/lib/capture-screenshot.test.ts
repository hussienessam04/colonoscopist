// @vitest-environment happy-dom
// capture-screenshot.ts unit tests — canvas.drawImage downscaling + base64.

import '../setup';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
});

class FakeCanvas {
  width = 0;
  height = 0;
  constructor(public naturalWidth: number, public naturalHeight: number) {}
  toBlob(cb: (b: Blob | null) => void, _type: string, q: number): void {
    // ponytail: real JPEG bytes aren't interesting — return a tiny Blob
    // with the requested MIME so callers can assert on `blob.type` and
    // the q parameter by way of any spy.
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    cb(new Blob([buf], { type: 'image/jpeg' }));
    void q;
  }
  toDataURL(type: string, q: number): string {
    void type;
    void q;
    return 'data:image/jpeg;base64,ZmFrZQ==';
  }
  getContext(_kind: string): object | null {
    return { drawImage: () => undefined };
  }
}

function makeFakeImage(w: number, h: number): HTMLImageElement {
  const img = new Image();
  Object.defineProperty(img, 'naturalWidth', { value: w, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: h, configurable: true });
  return img;
}

function makeFakeVideo(w: number, h: number): HTMLVideoElement {
  const video = document.createElement('video');
  Object.defineProperty(video, 'videoWidth', { value: w, configurable: true });
  Object.defineProperty(video, 'videoHeight', { value: h, configurable: true });
  return video;
}

beforeEach(() => {
  // Ponytail: replace HTMLCanvasElement.prototype.getContext + createElement
  // so the capture path runs under happy-dom (which doesn't ship a real
  // canvas implementation).
  const proto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  proto.getContext = function (): CanvasRenderingContext2D {
    return {
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
  };
  proto.toBlob = function (cb: BlobCallback, type?: string, q?: number): void {
    const buf = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    setTimeout(() => cb(new Blob([buf], { type: type ?? 'image/jpeg' })), 0);
    void q;
  };
});

describe('captureScreenshot', () => {
  it('downscales a 1920x1080 image to fit maxLongEdge=1280 (1280x720)', async () => {
    const { captureScreenshot } = await import('@/lib/capture-screenshot');
    const img = makeFakeImage(1920, 1080);
    const result = await captureScreenshot(img);
    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);
    expect(result.blob.type).toBe('image/jpeg');
    expect(typeof result.base64).toBe('string');
    expect(result.base64.length).toBeGreaterThan(0);
  });

  it('does NOT upscale a 1280x720 video beyond source pixels', async () => {
    const { captureScreenshot } = await import('@/lib/capture-screenshot');
    const video = makeFakeVideo(1280, 720);
    const result = await captureScreenshot(video);
    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);
  });

  it('does NOT upscale a small 240x180 image', async () => {
    const { captureScreenshot } = await import('@/lib/capture-screenshot');
    const img = makeFakeImage(240, 180);
    const result = await captureScreenshot(img);
    expect(result.width).toBe(240);
    expect(result.height).toBe(180);
  });

  it('uses the supplied quality option (passed to toBlob)', async () => {
    const { captureScreenshot } = await import('@/lib/capture-screenshot');
    const img = makeFakeImage(640, 480);
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob');
    await captureScreenshot(img, { maxLongEdge: 1280, quality: 0.42 });
    expect(spy).toHaveBeenCalled();
    const last = spy.mock.calls.at(-1);
    expect(last?.[1]).toBe('image/jpeg');
    expect(last?.[2]).toBeCloseTo(0.42, 2);
  });

  it('throws when the source has no intrinsic dimensions', async () => {
    const { captureScreenshot } = await import('@/lib/capture-screenshot');
    const img = makeFakeImage(0, 0);
    await expect(captureScreenshot(img)).rejects.toThrow(/intrinsic/);
  });
});

describe('blobToBase64', () => {
  it('returns the suffix after the data URL comma', async () => {
    const { blobToBase64 } = await import('@/lib/capture-screenshot');
    const blob = new Blob(['fake'], { type: 'image/jpeg' });
    const b64 = await blobToBase64(blob);
    // ponytail: the prefix is `data:image/jpeg;base64,` — the suffix is
    // base64 of the literal "fake".
    expect(b64).not.toContain('data:');
    expect(b64.length).toBeGreaterThan(0);
  });
});

describe('FakeCanvas (sanity check that mocks are wired)', () => {
  it('mocks return the expected shape', () => {
    const c = new FakeCanvas(100, 200);
    expect(c.toBlob(() => undefined, 'image/jpeg', 0.5)).toBeUndefined();
  });
});
