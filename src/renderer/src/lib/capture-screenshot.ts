// Renderer-side screenshot capture. Per D-03 + D-04 — drawImage from the
// live <img> MJPEG frame (mid-procedure) or the playback <video> frame
// (Procedure Review) onto an offscreen canvas, downscale to maxLongEdge
// (D-04: 1280), encode JPEG at q=0.85, return blob + base64 for the IPC
// round-trip.
//
// ponytail: does NOT touch the IPC bridge — the caller chooses when to
// invoke `window.api.screenshots.add(...)` and what timestamp to stamp.
// Two entry points (ProcedureRoom hotkey + ProcedureReview +Capture)
// reuse this same primitive.

export type CaptureSource = HTMLImageElement | HTMLVideoElement;

export type CaptureOptions = {
  maxLongEdge?: number;
  quality?: number;
};

export type CaptureResult = {
  blob: Blob;
  width: number;
  height: number;
  base64: string;
};

const DEFAULT_MAX_LONG_EDGE = 1280;
const DEFAULT_QUALITY = 0.85;

function intrinsicDimensions(source: CaptureSource): { w: number; h: number } {
  if (source instanceof HTMLVideoElement) {
    return { w: source.videoWidth, h: source.videoHeight };
  }
  return { w: source.naturalWidth, h: source.naturalHeight };
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('canvas.toBlob returned null'));
          return;
        }
        resolve(blob);
      },
      'image/jpeg',
      quality,
    );
  });
}

export function blobToBase64(blob: Blob): Promise<string> {
  // ponytail: prefer FileReader over manual base64 encoding — FileReader is
  // native, pre-parsed in browser engines, and avoids the JS heap pressure
  // of a synchronous `btoa(String.fromCharCode(...bytes))` on large buffers.
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = (): void => reject(reader.error ?? new Error('FileReader failed'));
    reader.onload = (): void => {
      const result = reader.result as string;
      // data URL is `data:image/jpeg;base64,<bytes>` — strip the prefix.
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

// Pure: does not mutate the source or hold any reference beyond the call.
export async function captureScreenshot(
  source: CaptureSource,
  opts: CaptureOptions = {},
): Promise<CaptureResult> {
  const maxLongEdge = opts.maxLongEdge ?? DEFAULT_MAX_LONG_EDGE;
  const quality = opts.quality ?? DEFAULT_QUALITY;

  const { w: intrW, h: intrH } = intrinsicDimensions(source);
  if (intrW === 0 || intrH === 0) {
    throw new Error('Source has no intrinsic dimensions');
  }

  // ponytail: never upscale — if both dims already fit under maxLongEdge the
  // source pixels pass through at 1:1. The scale clamp lives in the
  // min(1, ratio) expression.
  const scale = Math.min(1, maxLongEdge / Math.max(intrW, intrH));
  const w = Math.round(intrW * scale);
  const h = Math.round(intrH * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2D canvas context unavailable');
  }
  ctx.drawImage(source, 0, 0, w, h);

  const blob = await canvasToBlob(canvas, quality);
  const base64 = await blobToBase64(blob);
  return { blob, width: w, height: h, base64 };
}
