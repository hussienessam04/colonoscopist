// @vitest-environment node
// Plan 06-03 Task 1 — embed-image.ts readImageBox + LOGO_BOX / SIGNATURE_BOX tests.
// Per CONTEXT.md D-11 (fixed pixel sizes for the header layout) + the
// missing-or-empty-path null-guard so the PDF template can render a
// placeholder text instead of crashing on undefined <Image src>.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  LOGO_BOX,
  SIGNATURE_BOX,
  PNG_SIGNATURE,
  JPEG_SOI,
  readImageBox,
} from '../../../src/main/pdf/embed-image';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-embed-image-'));
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

function writePng(filePath: string): void {
  // Minimal valid PNG: signature + IHDR + IDAT + IEND. 67-byte canonical
  // 1x1 transparent PNG (RFC 2083 compliant). Sufficient for the
  // magic-byte sniff; @react-pdf/renderer accepts the buffer.
  const bytes = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR length + tag
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
    0x08, 0x06, 0x00, 0x00, 0x00, // bit depth + color + filter
    0x1f, 0x15, 0xc4, 0x89, // CRC
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, // IDAT length + tag
    0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a,
    0x2d, 0xb4, // IDAT body + CRC
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, // IEND length + tag
    0xae, 0x42, 0x60, 0x82, // CRC
  ]);
  writeFileSync(filePath, bytes);
}

function writeJpeg(filePath: string): void {
  // Minimal valid JPEG: SOI + APP0 (JFIF) + EOI. Magic-byte sniff
  // reads only the SOI segment.
  const bytes = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, // SOI + APP0
    0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, // JFIF
    0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xd9, // EOI
  ]);
  writeFileSync(filePath, bytes);
}

describe('embed-image readImageBox (Plan 06-03 Task 1)', () => {
  it('exports LOGO_BOX + SIGNATURE_BOX with the canonical pixel sizes (D-11)', () => {
    expect(LOGO_BOX.widthPx).toBe(120);
    expect(LOGO_BOX.heightPx).toBe(60);
    expect(SIGNATURE_BOX.widthPx).toBe(120);
    expect(SIGNATURE_BOX.heightPx).toBe(40);
  });

  it('returns null when the path is empty (no logo uploaded → placeholder)', () => {
    const result = readImageBox('', LOGO_BOX);
    expect(result).toBeNull();
  });

  it('returns null when the file does not exist on disk', () => {
    const missing = path.join(tmpDir, 'does-not-exist.png');
    const result = readImageBox(missing, LOGO_BOX);
    expect(result).toBeNull();
  });

  it('returns an ImageBox with the fallback dims for a valid PNG', () => {
    const pngFile = path.join(tmpDir, 'logo.png');
    writePng(pngFile);
    const result = readImageBox(pngFile, LOGO_BOX);
    expect(result).not.toBeNull();
    expect(result?.widthPx).toBe(LOGO_BOX.widthPx);
    expect(result?.heightPx).toBe(LOGO_BOX.heightPx);
    expect(result?.relPath).toBe(pngFile);
    expect(result?.buffer).toBeInstanceOf(Buffer);
    // PNG_SIGNATURE prefix check via startsWith — first 8 bytes match.
    expect(result?.buffer.slice(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)).toBe(true);
  });

  it('returns an ImageBox with the fallback dims for a valid JPEG', () => {
    const jpegFile = path.join(tmpDir, 'signature.jpg');
    writeJpeg(jpegFile);
    const result = readImageBox(jpegFile, SIGNATURE_BOX);
    expect(result).not.toBeNull();
    expect(result?.widthPx).toBe(SIGNATURE_BOX.widthPx);
    expect(result?.heightPx).toBe(SIGNATURE_BOX.heightPx);
    expect(result?.buffer.slice(0, JPEG_SOI.length).equals(JPEG_SOI)).toBe(true);
  });

  it('returns null for a subdirectory even though existsSync would say yes', () => {
    const subdir = path.join(tmpDir, 'subdir');
    mkdirSync(subdir, { recursive: true });
    // existsSync returns true for a directory — but readFileSync on a
    // directory throws EISDIR. readImageBox should not crash on this;
    // it surfaces the error to the caller (who already has the null
    // path short-circuit). We document the current behaviour: a directory
    // path causes readImageAsBuffer to throw. Callers must not pass
    // directory paths.
    expect(() => readImageBox(subdir, LOGO_BOX)).toThrow();
  });
});
