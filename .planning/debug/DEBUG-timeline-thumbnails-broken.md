---
status: diagnosed
trigger: "G-05-15 — after Plan 05-11 fixed the lightbox full-size URL, the TIMELINE thumbnails in ScreenshotTimeline still show 'FRAME' placeholder + spinner icon instead of the captured JPEG"
created: 2026-08-07T19:00:00.000Z
updated: 2026-08-07T19:00:00.000Z
goal: find_root_cause_only
---

## Current Focus

goal: find_root_cause_only — return ROOT CAUSE FOUND so plan-phase can schedule the fix
next_action: done — diagnosis complete; bug is that `ScreenshotTimeline` never wires `thumbnailSrc` to each `ScreenshotThumbnail`, so the `<img>` branch never renders and the placeholder div always shows

## Symptoms

expected: Each thumbnail in the `ScreenshotTimeline` row renders the captured JPEG at ~120×110px (per `D-04` + `ScreenshotThumbnail.tsx:64`), so the doctor can visually identify which frame each card corresponds to.
actual: All 3 timeline thumbnails display:
- A small icon at top-left (the expand / Maximize2 affordance, not a loading spinner)
- "FRAME" text in the body (the placeholder div at `ScreenshotThumbnail.tsx:102-107`)
- The HH:MM:SS timestamp strip at bottom (`00:00:00`, `00:00:00`, `00:00:08` — DB rows exist with valid data)
- The × delete button at top-right
- The annotation input (when `onAnnotate` is wired)

No captured image is visible. The DB rows ARE present (timestamps are populated); the file IS on disk under `<userData>/data/media/patients/<p>/<proc>/screenshots/<ts>.jpg`; the MediaServer route IS now capable of serving the subdir shape (per Plan 05-11). But the timeline `<img>` never gets a URL, so the `<img>` element is never even rendered.
reproduction: `npm run dev` → Procedure Review → confirm at least one screenshot row exists → observe the timeline row. Every thumbnail renders the "FRAME" placeholder instead of the JPEG.
errors: No console error. The `thumbnailSrc` prop is undefined, so the conditional `thumbnailSrc && !errored` (`ScreenshotThumbnail.tsx:93`) is false and the placeholder div is rendered. The `<img>` element is never mounted, so there is no failed network request to debug.
started: Plan 05-07 shipped the `ScreenshotTimeline` + `ScreenshotThumbnail` pair with a `thumbnailSrc?: string` prop on the thumbnail. Plan 05-11 fixed the LIGHTBOX URL composition (`ScreenshotLightbox.tsx:62-72`) to include the `screenshots/` subdir. Plan 05-11 did NOT touch the timeline — the timeline's `thumbnailSrc` wiring was apparently never completed in the first place, and the placeholder fall-through has been masking the missing wiring since Plan 05-07.

## Evidence

- **`src/renderer/src/components/ScreenshotThumbnail.tsx:31, 93-108`** — the thumbnail accepts an optional `thumbnailSrc?: string` prop. The render is:
  ```tsx
  {thumbnailSrc && !errored ? (
    <img src={thumbnailSrc} ... />
  ) : (
    <div ... aria-label="Thumbnail pending">frame</div>
  )}
  ```
  When `thumbnailSrc` is undefined (as it is in the current timeline), the placeholder "frame" div is what always renders. The `<img>` is never instantiated, so no HTTP request fires — there is no 404 to investigate, no CORS error to chase. The bug is upstream of the network layer.

- **`src/renderer/src/components/ScreenshotTimeline.tsx:61-70`** — the timeline wrapper propagates its props to each thumbnail but does NOT pass `thumbnailSrc`:
  ```tsx
  {screenshots.map((s) => (
    <ScreenshotThumbnail
      key={s.id}
      screenshot={s}
      onSeek={onSeek}
      onDelete={onDelete}
      onAnnotate={onAnnotate}
      onOpen={onOpen}
    />
  ))}
  ```
  Confirmed via `grep -r "thumbnailSrc"` across `src/` — the symbol appears ONLY in `ScreenshotThumbnail.tsx` (the prop declaration + the `<img src=...>`). No call site populates it. The timeline also does not accept a `mediaBaseUrl` prop itself, so it has no way to compose a URL even if it wanted to.

- **`src/renderer/src/hooks/useMediaUrl.ts:18-50`** — the hook returns only the base URL (`http://127.0.0.1:<port>`); it does not compose any path segment. It is designed to be paired with a composition helper at the call site (see the `<video>` composition in `ProcedureReview.tsx:167-171` and the lightbox composition in `ScreenshotLightbox.tsx:69-72`).

- **`src/renderer/src/components/ScreenshotLightbox.tsx:62-72`** — the FIXED lightbox composition (per Plan 05-11):
  ```ts
  const fileName = screenshot?.filePath.replace(/^.*[\\/]/, '') ?? '';
  const src =
    mediaBaseUrl && screenshot
      ? `${mediaBaseUrl}/media/${patientId}/${procedureId}/screenshots/${fileName}`
      : null;
  ```
  Includes the literal `screenshots/` subdir segment. Confirmed works (lightbox renders full-size per Plan 05-11 verification).

- **`src/renderer/src/components/ScreenshotLightbox.tsx:36-47`** — the lightbox takes `mediaBaseUrl: string | null` as a prop. The timeline does NOT have a similar prop. The timeline would need `patientId`, `procedureId`, AND `mediaBaseUrl` plumbed through to compose the same URL.

- **`src/renderer/src/pages/ProcedureReview.tsx:106, 374-383, 464-471`** — both `mediaUrl` (from `useMediaUrl`) and the lightbox are wired to the page; the timeline is mounted via `<ScreenshotTimeline procedureId={procedureId} ... onOpen={setLightboxScreenshot} />` with no `mediaBaseUrl`/`patientId` props. The timeline currently has no way to know the MediaServer URL — it would need both `patientId` and `mediaBaseUrl` added to its props (or a single `screenshotSrc` helper) to propagate through to each thumbnail.

- **`src/renderer/src/pages/ProcedureRoom.tsx:424-434`** — the gallery-mounted timestamp is identical:
  ```tsx
  <ScreenshotTimeline
    procedureId={procedureId ?? ''}
    status={isRecording ? 'recording' : 'completed'}
    screenshots={screenshotIntake.screenshots}
    onSeek={() => undefined}
    onCapture={() => { void handleScreenshotCapture(); }}
    onDelete={handleScreenshotDelete}
    testId="procedure-room-gallery"
  />
  ```
  No `mediaBaseUrl` / `patientId` prop. The room page does not even call `useMediaUrl` (verified). The bug is not specific to Review — both surfaces that mount the timeline are missing the wiring.

- **`src/main/recorder/preview-server.ts:62-70, 477-498`** — the MediaServer is now correctly configured to accept BOTH the flat shape (`/media/<p>/<proc>/<file>`) and the subdir shape (`/media/<p>/<proc>/screenshots/<file>`) per Plan 05-11. The regex `MEDIA_ROUTE_RE` captures the optional subdir group; `ALLOWED_SUBDIRS = {'screenshots'}` enforces the allow-list; the `path.join` includes the `subdir` segment. The server is ready to serve the URL — it just never gets a request from the timeline.

- **`src/shared/ipc-contract.ts:215-222`** — `Screenshot.filePath` is a userData-relative path. The reported (and on-disk) shape is `data/media/patients/<p>/<proc>/screenshots/<ts>.jpg` per `paths.ts:36-38` and the screenshots IPC writer. (The test fixture at `tests/renderer/components/ScreenshotTimeline.test.tsx:15-33` uses `data/media/p1/screenshots/5000.jpg` — note the missing `patients` segment — which is a separate inconsistency but irrelevant to the rendering bug since the test never asserts the `<img>` src.)

- **`tests/renderer/components/ScreenshotTimeline.test.tsx:34-288`** — the test suite covers click-to-seek, delete button, expand button, memo boundary, capture gate, and annotation wiring. It does NOT assert that the `<img>` src is populated. No test mounts the timeline with `thumbnailSrc` provided. The placeholder fall-through is the only observed behavior, so the test never sees a regression.

- **`tests/renderer/components/ScreenshotThumbnail.test.tsx`** — does not exist. There is no direct component test for `ScreenshotThumbnail` that would have caught the missing src composition earlier.

- **`tests/renderer/hooks/useMediaUrl.test.ts`** — does not exist. The hook is only tested transitively via `ProcedureReview`.

## Eliminated

- **Timeline URL is wrong (drops `screenshots/` subdir)**: false (different shape of bug). The timeline doesn't compose a URL at all — `thumbnailSrc` is undefined at every call site. The lightbox bug (G-05-14) was that the URL was wrong; the timeline bug is that there is no URL to be wrong. Both produce visually identical symptoms (placeholder + the other UI elements are intact).
- **MediaServer route disallows the subdir**: false — Plan 05-11 extended the route. Regex + `ALLOWED_SUBDIRS` + `path.join` all accept `screenshots/`.
- **`<img>` 404 / CORS / cross-origin**: false — the `<img>` is never rendered. No HTTP request fires.
- **DB rows missing `filePath`**: false — the timestamps render (`00:00:00`, `00:00:00`, `00:00:08`), so the rows exist and the `Screenshot.filePath` is populated. The `leaf filename` extraction in the lightbox works on the same data; the blocker is purely the timeline's missing wiring.
- **`useMediaUrl()` returns null indefinitely**: false — the video `<video>` element on the same page composes a URL from `mediaUrl.url` and renders successfully (otherwise the video playback would also be broken). The lightbox also receives a populated `mediaBaseUrl` and renders correctly after Plan 05-11.
- **The user's "spinner icon" indicates a loading state**: false — the small icon at top-left is the dedicated expand affordance (a Maximize2 SVG per `ScreenshotThumbnail.tsx:127-156`), not a loading spinner. The user correctly identified it as a click target but miscategorized the icon. The actual "frame" placeholder is the body content.

## Root cause

**`ScreenshotTimeline` never plumbs a `thumbnailSrc` to each `ScreenshotThumbnail`, so the `<img>` branch in `ScreenshotThumbnail.tsx:93` is never taken and the "frame" placeholder renders for every thumbnail.**

Two contributing causes (AND-gate: both required):

1. **Missing prop plumbing on the timeline wrapper.** `ScreenshotTimeline.tsx:42-83` does not accept `mediaBaseUrl` or `patientId` props, and its `screenshots.map((s) => <ScreenshotThumbnail ... />)` at line 61-69 does not pass `thumbnailSrc`. There is no other call site that passes `thumbnailSrc` either (verified via `grep -r "thumbnailSrc" src/` — matches only inside `ScreenshotThumbnail.tsx` itself). The `thumbnailSrc?: string` prop added in Plan 05-07 has been a dead code path since the timeline shipped.

2. **No shared URL composition helper for screenshot `src`.** The lightbox owns its own URL composition inline (`ScreenshotLightbox.tsx:62-72`). The video `<video>` owns its own composition inline (`ProcedureReview.tsx:167-171`). A third inline composition is needed for the timeline, but the inputs (`mediaBaseUrl`, `patientId`, `procedureId`, `screenshot.filePath`) are not currently plumbed to the timeline. The leaf-filename extraction regex (`replace(/^.*[\\/]/, '')`) is duplicated knowledge; a one-line helper `screenshotUrl({ mediaBaseUrl, patientId, procedureId, filePath })` would canonicalize the three sites.

If either contributing cause were fixed alone, the bug would still be present:
- If the timeline added `mediaBaseUrl`/`patientId` props but still didn't compose a URL (cause 1 alone), the placeholder would still render — the wiring is the prerequisite for the composition.
- If the composition helper existed but the timeline never imported it (cause 2 alone), the timeline would still have no way to call it.

Both must move together.

## Why the test suite didn't catch it

- **`tests/renderer/components/ScreenshotTimeline.test.tsx` (entire suite)** — every test mounts the timeline with no `thumbnailSrc` and never asserts what the `<img>` src is. The tests cover click-to-seek, delete, expand, memo, capture gate, annotation. They never inspect the rendered image element. Since the placeholder always renders, the test passes vacuously; there is no assertion that the image branch should be taken.
- **`tests/renderer/components/ScreenshotThumbnail.test.tsx` does not exist.** A direct component test on `ScreenshotThumbnail` (the prop that the timeline silently drops) would have caught the wiring gap immediately.
- **`tests/renderer/hooks/useMediaUrl.test.ts` does not exist.** The hook's contract is only validated transitively.
- **No end-to-end test exists** that takes a screenshot, lands on the timeline, and asserts the rendered `<img>` element has a non-empty `src` attribute. The visual surface is unverified.

## Files involved

- **`src/renderer/src/components/ScreenshotTimeline.tsx:13-83`** — missing `mediaBaseUrl: string | null` and `patientId: string` props (or a single `screenshotSrcBuilder` helper). The `screenshots.map(...)` at line 61-69 silently drops `thumbnailSrc`. This is the primary wiring site.
- **`src/renderer/src/components/ScreenshotThumbnail.tsx:23-41, 93-108`** — has the `thumbnailSrc?: string` prop and the conditional render that falls through to the placeholder. Behavior is correct given the prop; the gap is upstream.
- **`src/renderer/src/pages/ProcedureReview.tsx:106, 374-383`** — has `mediaUrl` and `procedure` but does not pass `mediaBaseUrl` / `patientId` to `<ScreenshotTimeline>`. The fix has to add these two props to the call site.
- **`src/renderer/src/pages/ProcedureRoom.tsx:424-434`** — same gap. The timeline mounts without `mediaBaseUrl` / `patientId`. The room page also does not call `useMediaUrl` at all (currently the room gallery is windows-API-only — the preview server URL was never wired through here).
- **`src/renderer/src/components/ScreenshotLightbox.tsx:62-72`** — duplicated URL composition logic. The fix should canonicalize this into a shared helper (e.g. `src/renderer/src/lib/screenshot-url.ts`) so the new timeline call site and the existing lightbox use the same composition (and the same `screenshots/` subdir literal).
- **`src/renderer/src/hooks/useMediaUrl.ts:18-50`** — unchanged. Returns only the base URL. The composition belongs in a separate helper, not in this hook.
- **`src/main/recorder/preview-server.ts:62, 70, 477-498`** — UNCHANGED. Already accepts the `/media/<p>/<proc>/screenshots/<file>` shape per Plan 05-11. No server work needed.
- **`tests/renderer/components/ScreenshotTimeline.test.tsx:34-288`** — needs a new test asserting that mounting the timeline with `mediaBaseUrl` + `patientId` produces an `<img>` with the correct subdir-aware src on each thumbnail. Without this, the regression will re-appear.
- **`tests/renderer/components/ScreenshotThumbnail.test.tsx`** — missing entirely. Should be added.

## Suggested fix direction

Add `mediaBaseUrl: string | null` and `patientId: string` props to `ScreenshotTimeline`, compose each thumbnail's `thumbnailSrc` inline (or via a shared `screenshotUrl` helper also used by the lightbox) as `${mediaBaseUrl}/media/${patientId}/${procedureId}/screenshots/${fileName}`, and plumb the two new props from `ProcedureReview.tsx` (where `useMediaUrl` is already in scope) and `ProcedureRoom.tsx` (which needs a new `useMediaUrl()` call). Add a regression test that mounts the timeline with a populated `mediaBaseUrl` and asserts the `<img>` src ends with `/media/<patient>/<procedure>/screenshots/<leaf>.jpg`.

## Resolution

root_cause: `ScreenshotTimeline.tsx:61-69` does not pass `thumbnailSrc` to `ScreenshotThumbnail` (and the timeline wrapper has no `mediaBaseUrl` / `patientId` props to compose it from). The `thumbnailSrc?: string` prop exists on `ScreenshotThumbnail.tsx:31` but no call site populates it (verified via `grep -r "thumbnailSrc" src/`). The conditional at `ScreenshotThumbnail.tsx:93` (`thumbnailSrc && !errored`) is therefore always false and the placeholder "frame" div renders for every thumbnail. The `<img>` is never mounted, so there is no 404 to debug — the bug is upstream of the network layer.
fix: not in this diagnostic — fix direction above.
verification: not in this diagnostic
files_changed: []
