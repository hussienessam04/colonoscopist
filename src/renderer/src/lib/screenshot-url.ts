// screenshotUrl — shared URL composition for the screenshot <img> src.
//
// Plan 12 / G-05-15: the timeline (ScreenshotTimeline) + the lightbox
// (ScreenshotLightbox) + the future PDF preview (Phase 6) all need
// the same URL shape. Before this helper, the lightbox owned the
// composition inline (ScreenshotLightbox.tsx:62-72) and the timeline
// had no composition at all (the `thumbnailSrc` prop was dropped on
// the floor since Plan 05-07 — see DEBUG-timeline-thumbnails-broken.md).
// This module is the single source of truth: the leaf-filename regex
// + the literal `screenshots/` subdir segment + the `/media/` route
// shape all live here. The MediaServer (Plan 05-11) accepts this
// shape via `MEDIA_ROUTE_RE` + `ALLOWED_SUBDIRS` allow-list.
//
// ponytail: returns `null` when `mediaBaseUrl` is `null` so the
// timeline degrades gracefully until `useMediaUrl` resolves. The
// <img> conditional in ScreenshotThumbnail.tsx:93
// (`thumbnailSrc && !errored`) falls through to the placeholder when
// the helper returns null — same graceful-degrade path that the
// <video> element uses for the missing-media-url case.
//
// The leaf-filename regex (`/^.*[\\/]/`) matches either Windows
// backslash OR POSIX forward slash — the screenshots IPC writer
// (src/main/ipc/screenshots.ts:121-129) uses `path.join` which emits
// backslashes on Windows; the test fixtures use forward slashes.
// Both shapes must extract just the trailing filename (e.g.
// `5000.jpg` from `data/media/p1/screenshots/5000.jpg`).

export type ScreenshotUrlArgs = {
  mediaBaseUrl: string | null;
  patientId: string;
  procedureId: string;
  filePath: string;
};

export function screenshotUrl({
  mediaBaseUrl,
  patientId,
  procedureId,
  filePath,
}: ScreenshotUrlArgs): string | null {
  if (!mediaBaseUrl) return null;
  const fileName = filePath.replace(/^.*[\\/]/, '');
  return `${mediaBaseUrl}/media/${patientId}/${procedureId}/screenshots/${fileName}`;
}
