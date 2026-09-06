---
slug: timeline-thumbnails-refresh-after-crop
created: 2026-09-06
type: bugfix
source: ad-hoc user report
---
# Quick Task: Timeline thumbnails in Review Procedure don't refresh after crop

## Bug

In the Review Procedure page, after cropping a screenshot via the lightbox, the
lightbox image updates immediately (correctly) but the thumbnail in the
ScreenshotTimeline still shows the **pre-crop** image. The doctor has to leave
the procedure (back to Patient) and re-enter the procedure to see the cropped
image in the thumbnail row.

## Root cause

`src/renderer/src/components/ScreenshotTimeline.tsx:269-274` composes each
thumbnail's `<img>` src via `screenshotUrl({ mediaBaseUrl, patientId,
procedureId, filePath: s.filePath })`. The crop IPC writes the cropped JPEG
bytes to the **same filename** (filePath doesn't change), so the URL stays
identical before and after crop. The MediaServer on `127.0.0.1:<random>` does
send `Cache-Control: no-cache, no-store, must-revalidate`
(`src/main/recorder/preview-server.ts:538`), but Chromium's memory cache for
image responses can still serve the previously-decoded bitmap for the same URL
even with `no-store` (well-known quirk for repeated `<img>` loads of the same
URL in the same session). When the user leaves and re-enters the procedure
page, a fresh `<img>` element mounts and the cache miss forces a re-fetch.

The lightbox already solved the same problem differently: it switched to a
`blob:` URL produced by `screenshots.getBlob` and bumps an internal
`cacheBuster` state on crop (`ScreenshotLightbox.tsx:79 + 238-244`). The
timeline still uses the MediaServer URL path, which has no equivalent
cache-busting seam.

## Scope (smallest working diff)

### 1. `src/renderer/src/pages/ProcedureReview.tsx` — track + propagate crop timestamp

Add `croppedAtMs` state. Bump it in the new `onCropped` handler that fires
after every successful crop. Pass the value down to `ScreenshotTimeline` as
`mediaCacheBuster` and forward it into the existing `ScreenshotLightbox`
via an `onCropped` prop (so the timeline bumps in lockstep with the
lightbox's internal blob fetch).

### 2. `src/renderer/src/components/ScreenshotLightbox.tsx` — accept `onCropped` prop

Add an optional `onCropped?: () => void` prop. Inside the existing internal
handler, call the new prop after bumping `cacheBuster` so the parent
learns about every crop.

### 3. `src/renderer/src/components/ScreenshotTimeline.tsx` — append `?v=<bust>` to thumbnail URLs

Accept `mediaCacheBuster?: number` prop. When present and the URL is
non-null, append `?v=<bust>` to the result of `screenshotUrl(...)`. A new
URL makes the browser refetch; no cache miss required.

The localhost MediaServer has no intermediary cache, so `?v=` is safe
(the concern that ruled it out in Plan 17 — `ScreenshotLightbox.tsx:9-11`
— was about a hypothetical aggressive intermediary that doesn't exist
here).

## Verification

- Manual: crop a screenshot from the lightbox → confirm thumbnail in the
  timeline updates in place, no leave/re-enter.
- Existing tests: `useProcedures` refresh path is untouched; no contract
  change.
- Add a small unit test on `ScreenshotTimeline` that asserts the
  `mediaCacheBuster` shows up in the rendered `<img>` src when supplied,
  and is absent otherwise.

## Out of scope

- The fallback path inside `ScreenshotCropModal` (`fallbackSrc` via the
  MediaServer) — same issue would exist there but the user explicitly
  reported the timeline thumbnail, not the read-only crop modal fallback.
  Tracked separately if it surfaces.
- Switching the timeline to `screenshots.getBlob` (heavier — one IPC round-trip
  per thumbnail per refresh). The `?v=` bust is one line per thumbnail.
