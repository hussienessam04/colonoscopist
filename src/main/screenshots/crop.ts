// Phase 8 / Plan 14 + Plan 15 — permanent screenshot crop (SCRN-02 extended).
//
// The renderer owns the pixel work (canvas drawImage + toBlob) because
// Electron already ships Canvas; a main-side image library (sharp /
// node-canvas) would add ~30 MB of native install for one operation.
// Main's job here is the trust boundary: the row must exist, the rect
// must sit inside the dimensions the renderer claims, and the write must
// land on the path the DB owns — never a path the renderer composes
// (Anti-Pattern 2 + T-08-14-T1).
//
// Phase 8 / Plan 15 (G-08-8): the renderer can supply either a polygon
// of vertices (free-form) OR a legacy bounding rectangle. v1 collapses
// the polygon to its bounding box on the main side (documented in
// SUMMARY.md — see deviations log). The renderer already does the same
// collapse on its side when drawing to canvas, so the main-side bbox
// validation is a safety net, not a different render.
//
// Crop is permanent. The PDF report pipeline (Phase 6) reads the source
// JPEG, so a non-destructive crop would print the uncropped frame. The
// `screenshot.cropped` audit row is the "what was cropped" trail
// (T-08-14-T2).

import { app } from 'electron';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  CropPolygon,
  CropRect,
  ScreenshotCropResult,
} from '@shared/ipc-contract';
import type { ScreenshotCropInputParsed } from '@shared/validators';
import { screenshotsRepo } from '../db/screenshots-repo';
import { audit } from '../db/audit';

// Compute the axis-aligned bounding box of a polygon. v1 simplification
// — the renderer collapses the same polygon to the bbox when drawing to
// canvas, so main-side validation uses the same shape.
//
// ponytail: Math.min/max over the X and Y arrays. Empty arrays would
// throw (Math.min() === +Infinity) but the renderer MUST supply >=3
// vertices per the validators.min(3) refinement, so the empty case is
// unreachable in practice. Still guard against it for safety.
function polygonBBox(points: CropPolygon): CropRect {
  if (points.length === 0) {
    throw new Error('polygonBBox: empty polygon (unreachable)');
  }
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

export function cropScreenshot(
  input: ScreenshotCropInputParsed,
  userId: string | null,
): ScreenshotCropResult {
  const { id, croppedBase64, originalDimensions } = input;

  const screenshot = screenshotsRepo.get(id);
  if (!screenshot) {
    return { ok: false, code: 'IPC_SCREENSHOT_NOT_FOUND' };
  }

  // Collapse to a single rect — polygon→bbox in v1, pass through rect.
  // zod already guarantees one of the two was provided.
  const cropRect: CropRect =
    input.cropRect !== undefined ? input.cropRect : polygonBBox(input.cropPolygon!);

  // Reject (don't clamp) — a rect outside the image means the renderer
  // and main disagree about the source, and silently shrinking the crop
  // would hand the doctor a different image than the one they selected.
  if (
    cropRect.x + cropRect.width > originalDimensions.width ||
    cropRect.y + cropRect.height > originalDimensions.height
  ) {
    return { ok: false, code: 'IPC_INVALID_CROP' };
  }

  const bytes = Buffer.from(croppedBase64, 'base64');
  if (bytes.byteLength === 0) {
    return { ok: false, code: 'IPC_INVALID_CROP' };
  }

  // The path comes from the DB row, never from the renderer.
  const absPath = path.join(app.getPath('userData'), screenshot.filePath);
  writeFileSync(absPath, bytes);

  // Plan 15 — record whether the caller supplied a polygon (the audit
  // trail lets a clinic reviewer see "free-form crop" vs "rect crop"
  // without needing to read the renderer source).
  const viaPolygon = input.cropPolygon !== undefined;

  audit({
    action: 'screenshot.cropped',
    entityType: 'screenshot',
    entityId: String(id),
    userId,
    metadata: {
      procedureId: screenshot.procedureId,
      screenshotId: id,
      originalWidth: originalDimensions.width,
      originalHeight: originalDimensions.height,
      cropRect,
      viaPolygon,
      polygonVertices: viaPolygon ? input.cropPolygon!.length : 0,
      newWidth: cropRect.width,
      newHeight: cropRect.height,
      byteSize: bytes.byteLength,
    },
  });

  return {
    ok: true,
    newDimensions: { width: cropRect.width, height: cropRect.height },
    byteSize: bytes.byteLength,
  };
}
