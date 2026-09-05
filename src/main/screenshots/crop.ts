// Phase 8 / Plan 14 — permanent screenshot crop (SCRN-02 extended).
//
// The renderer owns the pixel work (canvas drawImage + toBlob) because
// Electron already ships Canvas; a main-side image library (sharp /
// node-canvas) would add ~30 MB of native install for one operation.
// Main's job here is the trust boundary: the row must exist, the rect
// must sit inside the dimensions the renderer claims, and the write must
// land on the path the DB owns — never a path the renderer composes
// (Anti-Pattern 2 + T-08-14-T1).
//
// Crop is permanent. The PDF report pipeline (Phase 6) reads the source
// JPEG, so a non-destructive crop would print the uncropped frame. The
// `screenshot.cropped` audit row is the "what was cropped" trail
// (T-08-14-T2).

import { app } from 'electron';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ScreenshotCropResult } from '@shared/ipc-contract';
import type { ScreenshotCropInputParsed } from '@shared/validators';
import { screenshotsRepo } from '../db/screenshots-repo';
import { audit } from '../db/audit';

export function cropScreenshot(
  input: ScreenshotCropInputParsed,
  userId: string | null,
): ScreenshotCropResult {
  const { id, jpegBase64, originalDimensions, cropRect } = input;

  const screenshot = screenshotsRepo.get(id);
  if (!screenshot) {
    return { ok: false, code: 'IPC_SCREENSHOT_NOT_FOUND' };
  }

  // Reject (don't clamp) — a rect outside the image means the renderer
  // and main disagree about the source, and silently shrinking the crop
  // would hand the doctor a different image than the one they selected.
  if (
    cropRect.x + cropRect.width > originalDimensions.width ||
    cropRect.y + cropRect.height > originalDimensions.height
  ) {
    return { ok: false, code: 'IPC_INVALID_CROP' };
  }

  const bytes = Buffer.from(jpegBase64, 'base64');
  if (bytes.byteLength === 0) {
    return { ok: false, code: 'IPC_INVALID_CROP' };
  }

  // The path comes from the DB row, never from the renderer.
  const absPath = path.join(app.getPath('userData'), screenshot.filePath);
  writeFileSync(absPath, bytes);

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
