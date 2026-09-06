// @vitest-environment node
// Unit test for `isPdfLockedError` (src/renderer/src/lib/pdf-locked-error.ts).
// Quick task 20260812 — distinguishes a Windows file-lock error
// (EBUSY/EPERM/EACCES) from other IPC errors so the renderer can
// surface the friendly "close the PDF viewer" toast instead of
// the raw OS message.

import { describe, expect, it } from 'vitest';
import { isPdfLockedError } from '../../../src/renderer/src/lib/pdf-locked-error';

describe('isPdfLockedError', () => {
  it('returns true for an Error with .code = "EPERM"', () => {
    const err = new Error('operation not permitted, rename ...') as Error & {
      code: string;
    };
    err.code = 'EPERM';
    expect(isPdfLockedError(err)).toBe(true);
  });

  it('returns true for an Error with .code = "EBUSY"', () => {
    const err = new Error('resource busy or locked, open ...') as Error & {
      code: string;
    };
    err.code = 'EBUSY';
    expect(isPdfLockedError(err)).toBe(true);
  });

  it('returns true for an Error with .code = "EACCES"', () => {
    const err = new Error('permission denied') as Error & { code: string };
    err.code = 'EACCES';
    expect(isPdfLockedError(err)).toBe(true);
  });

  // ponytail: the IPC boundary (`asIpcError` in
  // src/main/ipc/reports.ts) returns a fresh Error whose `.message`
  // starts with the OS code (e.g. "EPERM: operation not permitted,
  // rename ..."). The original `.code` is NOT preserved across the
  // boundary. The helper falls back to message-text matching so the
  // renderer can still distinguish the lock case.
  it('returns true for an Error whose message starts with "EPERM:" (IPC boundary path)', () => {
    const err = new Error(
      "EPERM: operation not permitted, rename 'C:\\a.tmp' -> 'C:\\a.pdf'",
    );
    expect(isPdfLockedError(err)).toBe(true);
  });

  it('returns true for an Error whose message starts with "EBUSY:"', () => {
    const err = new Error(
      "EBUSY: resource busy or locked, open 'C:\\a.pdf'",
    );
    expect(isPdfLockedError(err)).toBe(true);
  });

  it('returns true for an Error whose message starts with "EACCES:" (case-insensitive)', () => {
    const err = new Error(
      "EACCES: permission denied, open 'C:\\a.pdf'",
    );
    expect(isPdfLockedError(err)).toBe(true);
  });

  it('returns false for an Error with a different OS code (e.g. ENOENT)', () => {
    const err = new Error('no such file') as Error & { code: string };
    err.code = 'ENOENT';
    expect(isPdfLockedError(err)).toBe(false);
  });

  it('returns false for an Error with no lock code in the message', () => {
    const err = new Error('Some unrelated validation error');
    expect(isPdfLockedError(err)).toBe(false);
  });

  it('returns false for a non-Error value (null, undefined, string)', () => {
    expect(isPdfLockedError(null)).toBe(false);
    expect(isPdfLockedError(undefined)).toBe(false);
    expect(isPdfLockedError('EPERM: ...')).toBe(false);
    expect(isPdfLockedError(42)).toBe(false);
  });
});
