// Device-name canonicalization (CAPT-10 + D-11).
//
// One boundary: every device name that crosses the IPC layer passes through
// `canonicalizeName()` so the rest of the app (IPC payloads, settings keys,
// matrix rows, and Phase 4 ffmpeg `-i video=<name>`) sees the same string.

export const MAX_DEVICE_NAME_LENGTH = 500;

export class EmptyDeviceNameError extends Error {
  constructor() {
    super('Empty device name after canonicalization');
    this.name = 'EmptyDeviceNameError';
  }
}

export function canonicalizeName(raw: string): string {
  if (typeof raw !== 'string') {
    throw new EmptyDeviceNameError();
  }
  return raw
    .normalize('NFC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // strip zero-width
    .replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '') // strip USB vendor:product ID suffix (browser label, not dshow)
    .replace(/\s+/g, ' ') // collapse internal whitespace
    .trim();
}

export function canonicalizeOrThrow(raw: string): string {
  const c = canonicalizeName(raw);
  if (c.length === 0) throw new EmptyDeviceNameError();
  if (c.length > MAX_DEVICE_NAME_LENGTH) {
    throw new EmptyDeviceNameError();
  }
  return c;
}
