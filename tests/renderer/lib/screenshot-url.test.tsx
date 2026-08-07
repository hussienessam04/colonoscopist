// @vitest-environment happy-dom
// screenshotUrl — shared URL composition helper for the screenshot <img>
// src (timeline + lightbox). Plan 12 / G-05-15 contract guards.

import { describe, expect, it } from 'vitest';
import '../setup';
import { screenshotUrl } from '@/lib/screenshot-url';

describe('screenshotUrl', () => {
  // G-05-15 — the helper returns null when the MediaServer URL is not
  // yet available (useMediaUrl.url is null on the very first render
  // before the IPC round-trip resolves). The thumbnail conditional
  // `thumbnailSrc && !errored` in ScreenshotThumbnail.tsx:93 falls
  // through to the placeholder when the helper returns null — the
  // timeline degrades gracefully until the URL lands.
  it('returns null when mediaBaseUrl is null (MediaServer not yet bound)', () => {
    expect(
      screenshotUrl({
        mediaBaseUrl: null,
        patientId: 'p1',
        procedureId: 'proc1',
        filePath: 'data/media/p1/screenshots/5000.jpg',
      }),
    ).toBeNull();
  });

  // G-05-15 — the happy path. The URL includes the literal
  // `screenshots/` subdir segment that matches the on-disk layout
  // (per `src/main/paths.ts::screenshotsDir()`). Plan 05-11 extended
  // the MediaServer regex + ALLOWED_SUBDIRS allow-list to accept this
  // shape; the helper's output is what the <img> requests.
  it('returns the full /media/<p>/<proc>/screenshots/<leaf>.jpg URL — G-05-15', () => {
    expect(
      screenshotUrl({
        mediaBaseUrl: 'http://127.0.0.1:51731',
        patientId: 'p1',
        procedureId: 'proc1',
        filePath: 'data/media/p1/screenshots/5000.jpg',
      }),
    ).toBe('http://127.0.0.1:51731/media/p1/proc1/screenshots/5000.jpg');
  });

  // G-05-15 — the leaf-filename extraction handles Windows backslash
  // paths. The screenshots IPC writer (src/main/ipc/screenshots.ts:121)
  // builds the userData-relative path with `path.join`, which on
  // Windows emits backslashes. The regex `/^.*[\\/]/` matches either
  // separator. This test locks the contract.
  it('extracts the leaf filename from a Windows-backslash path', () => {
    expect(
      screenshotUrl({
        mediaBaseUrl: 'http://127.0.0.1:51731',
        patientId: 'p1',
        procedureId: 'proc1',
        filePath: 'data\\media\\p1\\screenshots\\5000.jpg',
      }),
    ).toBe('http://127.0.0.1:51731/media/p1/proc1/screenshots/5000.jpg');
  });

  // G-05-15 — the leaf-filename extraction handles forward-slash
  // paths (POSIX-style + the on-disk layout we expose in tests via
  // forward slashes). Same regex, same contract.
  it('extracts the leaf filename from a forward-slash path', () => {
    expect(
      screenshotUrl({
        mediaBaseUrl: 'http://127.0.0.1:51731',
        patientId: 'p1',
        procedureId: 'proc1',
        filePath: 'data/media/p1/screenshots/5000.jpg',
      }),
    ).toBe('http://127.0.0.1:51731/media/p1/proc1/screenshots/5000.jpg');
  });
});
