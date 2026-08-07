---
status: diagnosed
trigger: "G-05-14 — lightbox opens but shows the same ~120x90 thumbnail instead of the full-resolution screenshot"
created: 2026-08-07T18:00:00.000Z
updated: 2026-08-07T18:00:00.000Z
goal: find_root_cause_only
---

## Current Focus

goal: find_root_cause_only — return ROOT CAUSE FOUND so plan-phase can schedule the fix
next_action: done — diagnosis complete; bug is a path-layout mismatch between screenshots IPC writer and MediaServer route

## Symptoms

expected: After clicking the expand affordance on a screenshot thumbnail, a lightbox modal opens and renders the captured JPEG at native resolution (~1280×720 per `D-04`).
actual: Lightbox modal opens but the `<img>` shows a broken-image icon (or a small placeholder) instead of the captured frame. User described it as "the same ~120x90 thumbnail" — there is no actual thumbnail in the DOM; the user is describing the broken-image fallback they see in the dialog.
reproduction: `npm run dev` → Procedure Review → `+Capture` → click expand (top-left Maximize2) on the new thumbnail. Lightbox opens, `<img>` requests a MediaServer URL, server returns 404, browser shows broken image.
errors: DevTools Network panel shows the lightbox `<img>` request returns `404 Not Found`. No user-facing error toast (the `<img>` just silently fails to render).
started: Plan 05-07 shipped `ScreenshotLightbox` on top of the existing flat-layout `/media/` route. The route was designed for `video.mp4` and never extended for `screenshots/<ts>.jpg`.

## Evidence

- `src/main/paths.ts:36-38` — `screenshotsDir()` returns `<userData>/data/media/patients/<patientId>/<procedureId>/screenshots` (note the trailing `/screenshots` subdir).
- `src/main/ipc/screenshots.ts:121-129` — `add` handler writes `<ts>.jpg` into `screenshotsDir(...)` and stores `path.relative(userData, absPath).split(path.sep).join('/')` → DB row's `filePath` is `data/media/patients/<p>/<proc>/screenshots/<ts>.jpg`.
- `tests/main/ipc/screenshots.test.ts:115` — assertion `expect(created.filePath.replace(/\//g, path.sep)).toContain('screenshots${path.sep}12345.jpg')` confirms the on-disk + DB layout uses the `screenshots/` subdir.
- `src/main/db/screenshots-repo.ts:1-9` — comment confirms the canonical layout is `<userData>/data/media/patients/<patientId>/<procedureId>/screenshots/<tsMs>.jpg`.
- `src/renderer/src/components/ScreenshotLightbox.tsx:58-62` — URL composition:
  ```ts
  const fileName = screenshot?.filePath.replace(/^.*[\\/]/, '') ?? '';
  const src =
    mediaBaseUrl && screenshot
      ? `${mediaBaseUrl}/media/${patientId}/${procedureId}/${fileName}`
      : null;
  ```
  The `replace(/^.*[\\/]/, '')` strips everything up to the LAST `/` or `\`, so for `data/media/patients/<p>/<proc>/screenshots/<ts>.jpg` the leaf filename is just `<ts>.jpg`. **The `screenshots/` subdir segment is dropped from the URL.**
- `src/main/recorder/preview-server.ts:54` — `MEDIA_ROUTE_RE = /^\/media\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9-]+)\/([\w.-]+)$/` — `<file>` group is `[\w.-]+`, which explicitly excludes `/`. The route is flat by design (only video files).
- `src/main/recorder/preview-server.ts:461-469` — handler resolves the URL to `<userData>/data/media/patients/<patientId>/<procedureId>/<file>` (no `screenshots/` segment in the join).
- `src/main/recorder/preview-server.ts:482-486` — `existsSync(resolved)` returns `false` for the screenshot request → response is `404 Not Found`.
- `src/renderer/src/hooks/useMediaUrl.ts:30-35` — returns the correct `http://127.0.0.1:<port>` base URL, so the lightbox's `mediaBaseUrl` is right. The bug is in path composition, not in the base URL.
- `src/renderer/src/components/ScreenshotLightbox.tsx:96-108` — the `<img>` has `className="max-h-[70vh] w-auto object-contain"`. This CSS is correct for full-size rendering (no width/height lock at 120px). The image would render at native size if a valid JPEG came back. It doesn't, because the URL 404s.
- `src/renderer/src/pages/ProcedureReview.tsx:454-461` — lightbox is mounted with the correct props (`screenshot`, `patientId`, `procedureId`, `mediaBaseUrl`, `onClose`, `onDelete`). State plumbing is fine.
- `src/renderer/src/pages/ProcedureReview.tsx:372` — `onOpen={setLightboxScreenshot}` is wired; clicking expand does set the state.
- `src/renderer/src/components/ScreenshotThumbnail.tsx:58-61` — `handleExpand` correctly calls `onOpen?.(screenshot)` with `e.stopPropagation()` so seek-on-click doesn't double-fire.
- `src/renderer/src/components/ScreenshotTimeline.tsx:67-68` — passes `onOpen={onOpen}` through to each thumbnail. Chain `expand button → thumbnail → timeline → ProcedureReview → setLightboxScreenshot` is intact.

## Eliminated

- **expand-icon click doesn't propagate state**: false — `handleExpand` (`ScreenshotThumbnail.tsx:58-61`) calls `onOpen?.(screenshot)` after `stopPropagation()`, and `ProcedureReview.tsx:372` wires `onOpen={setLightboxScreenshot}`. State flips when expand is clicked.
- **lightbox CSS constrains image to small width**: false — `className="max-h-[70vh] w-auto object-contain"` (`ScreenshotLightbox.tsx:105`) preserves aspect ratio and lets the image use its natural width up to the dialog's `max-w-4xl`. No `w-[120px]` / `h-[110px]` / `max-w-[120px]` lock. The 120×90 dimensions the user reports are the dimensions of the timeline thumbnail card (`ScreenshotThumbnail.tsx:64: h-[110px] w-[120px]`), not the lightbox image.
- **`useMediaUrl()` returns wrong port / path**: false — `getMediaUrl()` returns `http://127.0.0.1:<port>` (`preview-server.ts:421-423`) and `useMediaUrl.ts:30-35` wires it correctly. The video `<video>` element on the same page uses this same base URL and plays successfully (would 404 too if base were wrong).
- **MediaServer regex rejects the filename**: false — the lightbox URL `/media/<p>/<proc>/<ts>.jpg` matches `MEDIA_ROUTE_RE` (`[\w.-]+` accepts the `.jpg` extension and digits). The regex match succeeds; it's the filesystem lookup that 404s because of the missing `screenshots/` segment.

## Root cause

**Path-layout mismatch between the screenshots IPC writer and the MediaServer route.** Screenshots are written into a `screenshots/` subdirectory under the procedure folder (`<userData>/data/media/patients/<p>/<proc>/screenshots/<ts>.jpg` per `screenshots.ts:121-124`), but the MediaServer's `/media/<p>/<proc>/<file>` route (`preview-server.ts:54` + `preview-server.ts:461-469`) only resolves a flat filename with no subdirectory segments. The lightbox URL composition (`ScreenshotLightbox.tsx:58`) extracts just the leaf filename (`<ts>.jpg`) and composes `/media/<p>/<proc>/<ts>.jpg`, which the server can't find because the actual file is one level deeper (`/screenshots/<ts>.jpg`). Result: 404 → broken `<img>` in the lightbox.

**Two contributing causes** (AND-gate: both required):
1. **Client-side path drop** — `ScreenshotLightbox.tsx:58` `replace(/^.*[\\/]/, '')` keeps only the leaf filename, discarding the `screenshots/` segment.
2. **Server-side no-subdir assumption** — `preview-server.ts:54` regex restricts `<file>` to `[\w.-]+`; `preview-server.ts:461-469` `path.join` builds the flat procedure-directory layout. Neither knows about `screenshots/`.

If either one were fixed alone (e.g., if the regex allowed `/` but the client still dropped the segment, OR if the client included `screenshots/` but the regex blocked `/`), the URL would still 404. Both must move together.

## Why the test suite didn't catch it

- `tests/renderer/components/ScreenshotLightbox.test.tsx:42-55` — asserts only the `src` attribute string (`http://127.0.0.1:51731/media/p1/proc1/5000.jpg`). The test never makes an HTTP request against a real (or mocked) MediaServer, so it can't detect that the composed URL doesn't actually serve a file.
- `tests/main/recorder/preview-server.test.ts` — every test uses the flat layout (`writeMp4('data/media/patients/p1/proc1/video.mp4', ...)` then requests `/media/p1/proc1/video.mp4`). No test exercises a URL with the `screenshots/` subdir, so the route's flat-only constraint is never probed.
- `tests/renderer/pages/ProcedureReview.test.tsx` — does not have any test that opens the lightbox and asserts the `<img>` renders at native size. No test clicks the expand affordance.
- `tests/main/ipc/screenshots.test.ts` — asserts the file is written to the `screenshots/` subdir, but never asserts that the same file is reachable via the MediaServer route. The producer side and consumer side are tested independently with no end-to-end join.

## Files involved

- `src/renderer/src/components/ScreenshotLightbox.tsx:58-62` — URL composition drops the `screenshots/` segment by extracting only the leaf filename.
- `src/main/recorder/preview-server.ts:54` — `MEDIA_ROUTE_RE` regex has no allowance for subdirectory segments (`<file>` is `[\w.-]+`).
- `src/main/recorder/preview-server.ts:461-486` — handler's `path.join` builds `<userData>/data/media/patients/<patientId>/<procedureId>/<file>` directly, no awareness that screenshots live in a `screenshots/` subdir.
- `src/main/ipc/screenshots.ts:121-129` — writer places files in `<userData>/data/media/patients/<p>/<proc>/screenshots/<ts>.jpg`. This is the canonical layout (not the bug), but it's the layout the URL + server must reach.
- `src/main/paths.ts:36-38` — `screenshotsDir()` is the source of the `screenshots/` subdir path. Resolution helper lives here; could be reused server-side if the fix chooses to add a subdir-segment passthrough.

## Suggested fix direction

Pick one of:

- **(a) URL composition change only** — make `ScreenshotLightbox.tsx:58-62` include `screenshots/` explicitly: `${mediaBaseUrl}/media/${patientId}/${procedureId}/screenshots/${fileName}`. Smallest diff; doesn't touch the server. Works because the URL has a literal `/` and the server's regex accepts it (only `<file>` is restricted — the `<patientId>/<procedureId>` slots already allow `/` because they're split into separate capture groups, so a single extra `/screenshots/` literal before `<file>` is just a non-captured slash literal that the regex needs to accept). Needs the regex relaxed to allow a `screenshots` literal segment, or to allow `/` inside `<file>` with path-traversal guards re-validated.

- **(b) Flatten the on-disk layout** — change `screenshotsDir()` in `src/main/paths.ts:36-38` (and `src/main/ipc/screenshots.ts:121-124`) to write screenshots directly to `<userData>/data/media/patients/<p>/<proc>/<ts>.jpg` (no `screenshots/` subdir). Aligns the layout with the route. Requires a one-time migration for existing rows and the `unlinkSync` path in `screenshots-repo.ts:134`.

Either fix is small; (b) is smaller (no regex work) but requires the existing-row migration. (a) keeps the clean subdir organization at the cost of touching the server-side path-traversal guards.

## Resolution

root_cause: Lightbox URL composition (`ScreenshotLightbox.tsx:58-62`) extracts only the leaf filename from `screenshot.filePath`, dropping the `screenshots/` subdirectory segment. The MediaServer's `/media/<patientId>/<procedureId>/<file>` route (`preview-server.ts:54`, `preview-server.ts:461-469`) only resolves a flat filename with no subdirectory awareness, so the URL requests `<userData>/data/media/patients/<p>/<proc>/<ts>.jpg` while the actual file is at `<userData>/data/media/patients/<p>/<proc>/screenshots/<ts>.jpg`. The server returns 404, the `<img>` shows a broken image.
fix: not in this diagnostic — fix direction above; pick (a) URL composition + regex allowlist or (b) flatten the on-disk layout.
verification: not in this diagnostic
files_changed: []
