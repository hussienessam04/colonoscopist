---
slug: timeline-thumbnails-refresh-after-crop
status: complete
---

# Quick Task Summary: timeline-thumbnails-refresh-after-crop

## Outcome

Cropping a screenshot from the lightbox now updates the ScreenshotTimeline
thumbnails in place — no leave/re-enter required.

## Diff

- `src/renderer/src/components/ScreenshotLightbox.tsx` (+13) — new
  optional `onCropped?: () => void` prop; fires alongside the existing
  internal `cacheBuster` bump so the parent learns about every crop.
- `src/renderer/src/components/ScreenshotTimeline.tsx` (+20 −6) — new
  optional `mediaCacheBuster?: number` prop; when supplied, appends
  `?v=<value>` to each thumbnail's `screenshotUrl(...)` result. Localhost
  MediaServer has no intermediary cache, so the `?v=` query is sufficient
  (the Plan 17 concern about aggressive intermediary caches doesn't apply
  to the timeline URL path).
- `src/renderer/src/pages/ProcedureReview.tsx` (+12) — new `croppedAtMs`
  state, bumped in the `onCropped` handler wired through to
  `ScreenshotLightbox`; the value flows down to `ScreenshotTimeline` as
  `mediaCacheBuster`.
- `tests/renderer/components/ScreenshotTimeline.test.tsx` (+50) — contract
  guard: with `mediaCacheBuster` supplied, every `<img>` src carries the
  same `?v=<bust>`; without it, srcs are the raw MediaServer URL (no
  extra request on first paint).

## Verification

- `node scripts/run-vitest.cjs --run tests/renderer/components/ScreenshotTimeline.test.tsx` → 15/15 pass (14 prior + 1 new)
- `node scripts/run-vitest.cjs --run tests/renderer/components/ScreenshotLightbox.test.tsx` → 5/5 pass (no regression)
- `npm run typecheck:web` → no errors in changed files (pre-existing
  errors in `useReport.ts` + `ReportEditor.tsx` are unrelated)

## Notes

- The fallback read-only `<img>` inside `ScreenshotCropModal` has the
  same shape (MediaServer URL keyed by file path) and would exhibit the
  same staleness if the cropped bytes ever failed to be re-fetched
  there. The crop modal's primary path is a fresh `blob:` URL so the
  fallback is rarely visible. Left as-is per scope.
- Initial `croppedAtMs = 0` keeps the no-crop case byte-identical to
  the previous behaviour (no `?v=` appended, no extra request).
