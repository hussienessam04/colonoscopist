// PNG/JPEG magic-byte sniff + Buffer loader for @react-pdf/renderer.
//
// Per CONTEXT.md D-04 + RESEARCH §Pitfall 4: the IPC upload handlers
// (PROFILE_UPLOAD_SIGNATURE / LOGO in Plan 06-02) reject any payload
// whose first bytes don't match the canonical PNG / JPEG signatures.
// The same magic-byte constants drive the PDF template's image embed
// via `readImageAsBuffer` — a non-PNG/JPEG file errors out before
// @react-pdf/renderer sees a malformed buffer.
//
// Source bytes are from the PNG RFC 2083 + JPEG ITU-T T.81 specs:
//   PNG:  89 50 4E 47 0D 0A 1A 0A
//   JPEG: FF D8 FF (followed by an APP0/APP1/DQT marker in practice)

import { readFileSync, existsSync } from 'node:fs';
import { ipcError } from '@shared/errors';

// ponytail: per-task layout shape consumed by the ReportPdf template.
// `widthPx`/`heightPx` come from the LOGO_BOX/SIGNATURE_BOX fallbacks
// (fixed pixel sizes per CONTEXT.md D-11) or zero for screenshots
// (where @react-pdf/renderer scales via the <Image style.width='100%'>
// prop and ignores intrinsic dims).
export type ImageBox = {
  buffer: Buffer;
  widthPx: number;
  heightPx: number;
  relPath: string;
};

// CONTEXT.md D-11 — fixed pixel sizes for the header layout.
export const LOGO_BOX = { widthPx: 120, heightPx: 60 } as const;
export const SIGNATURE_BOX = { widthPx: 120, heightPx: 40 } as const;

// ponytail: returns null when the path is missing/empty so the
// ReportPdf template can render a "No logo uploaded" placeholder
// instead of crashing on @react-pdf/renderer's <Image src={undefined}>.
export function readImageBox(
  absPath: string,
  fallback: { widthPx: number; heightPx: number },
): ImageBox | null {
  if (!absPath) return null;
  if (!existsSync(absPath)) return null;
  const buffer = readImageAsBuffer(absPath);
  return {
    buffer,
    widthPx: fallback.widthPx,
    heightPx: fallback.heightPx,
    relPath: absPath,
  };
}

export const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export const JPEG_SOI = Buffer.from([0xff, 0xd8, 0xff]);

function startsWith(buf: Buffer, sig: Buffer): boolean {
  if (buf.byteLength < sig.byteLength) return false;
  for (let i = 0; i < sig.byteLength; i += 1) {
    if (buf[i] !== sig[i]) return false;
  }
  return true;
}

// Read-side helper. Returns the file bytes ready to pass to
// @react-pdf/renderer's `<Image src={...}>`. Throws IPC_BAD_REQUEST if
// the file's magic bytes do not match PNG or JPEG — defense-in-depth
// at the read side in case a non-image file ended up at the path.
export function readImageAsBuffer(absPath: string): Buffer {
  const buf = readFileSync(absPath);
  if (startsWith(buf, PNG_SIGNATURE)) return buf;
  if (startsWith(buf, JPEG_SOI)) return buf;
  throw ipcError('IPC_BAD_REQUEST', 'image: invalid PNG/JPEG signature');
}

// ponytail: callers that only need to know the format (not the buffer)
// use `detectImageFormat`. Returns 'png' | 'jpeg' | null. Zero-dep;
// mirrors the magic-byte check inline so the upload IPC doesn't need
// a separate MIME library.
export type DetectedImageFormat = 'png' | 'jpeg' | null;
export function detectImageFormat(buf: Buffer): DetectedImageFormat {
  if (startsWith(buf, PNG_SIGNATURE)) return 'png';
  if (startsWith(buf, JPEG_SOI)) return 'jpeg';
  return null;
}

// ponytail: extension picker for the on-disk filename based on the
// sniffed format. The IPC handler uses this so the file always lands
// with the extension matching its actual bytes (not the renderer's hint).
export function extensionForFormat(format: DetectedImageFormat): 'png' | 'jpg' | null {
  if (format === 'png') return 'png';
  if (format === 'jpeg') return 'jpg';
  return null;
}
