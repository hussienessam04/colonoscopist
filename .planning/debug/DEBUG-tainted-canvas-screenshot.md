# DEBUG — Tainted Canvas on +Capture (Procedure Review)

## Status

`diagnosed` — root cause confirmed. No fix applied (mode: `find_root_cause_only`).

---

## Symptoms

**Verbatim toast reported by user during UAT:**

> Failed to execute 'toBlob' on 'HTMLCanvasElement': Tainted canvases may not be exported.

**Expected:** Clicking `+Capture` on the Procedure Review screen saves a JPEG screenshot to
`<userData>/data/media/patients/<id>/<procedureId>/screenshots/<ts>.jpg`, and the
thumbnail appears in the screenshot timeline.

**Actual:** Error toast above; no screenshot saved; thumbnail does not appear.

**Reproduction:**

1. `npm run dev` (Electron).
2. Patients list → row actions → "Open Procedure Preview" → Record 30s → Stop.
3. Procedure Review screen → click Play on the `<video>` → click `+Capture`.
4. Failure as described.

---

## Root Cause

**The `<video>` element loads the recorded mp4 cross-origin (renderer origin ≠
`http://127.0.0.1:<random>`), and Chromium's HTMLCanvasElement security guard
correctly throws on `canvas.toBlob()` because the canvas became tainted by
`drawImage(<cross-origin video>, ...)`.**

Two co-failing preconditions make the tainted canvas unavoidable end-to-end:

1. **`MediaServer` sends zero CORS headers.** The mp4 response in
   `src/main/recorder/preview-server.ts:491-494` (full 200 path) and `:505-506`
   (206 Partial Content path) sets `Accept-Ranges`, `Content-Type`,
   `Cache-Control`, `Pragma`, `Content-Range`, `Content-Length` — but never
   `Access-Control-Allow-Origin`.
2. **The `<video>` element has no `crossOrigin` attribute.** In
   `src/renderer/src/pages/ProcedureReview.tsx:252-260` the video element is
   constructed with `src={videoSrc}` but no `crossOrigin="anonymous"`. The
   renderer loads via either `http://localhost:<vite-dev-port>` (dev,
   `src/main/window.ts:46`) or `file://.../renderer/index.html` (prod,
   `src/main/window.ts:48`) — both are cross-origin to
   `http://127.0.0.1:<random>/media/...`.

Either precondition alone blocks a CORS-clean load: without the server header,
Chromium would refuse a CORS-mode request; without the client attribute, the
load happens in no-cors mode and taints any canvas that touches the resulting
media.

A *latent* second instance of the same bug exists in the recording-time
preview path — `src/renderer/src/pages/ProcedureRoom.tsx:305-313` constructs
the live `<img src={previewUrl}>` without `crossOrigin`, and
`src/main/recorder/preview-server.ts:225-227` does not send
`Access-Control-Allow-Origin` on the multipart/x-mixed-replace MJPEG response
either. The MJPEG capture path (`useScreenshotIntake` → `captureScreenshot`)
runs the same `drawImage` → `toBlob` sequence and would fail the same way if a
mid-procedure `S` hotkey screenshot were exercised end-to-end.

`src/renderer/src/lib/capture-screenshot.ts:96-98` is the throw site
(`ctx.drawImage(source, 0, 0, w, h)` followed by `await canvasToBlob(...)`).
The library itself is correct — it cannot un-taint a source that was
loaded without CORS.

---

## Evidence

1. **Server side — no CORS on `/media/`.** `preview-server.ts:491-494, 539-540`
   show the full set of headers emitted by `MediaServer.onHttpRequest`:
   `Accept-Ranges`, `Content-Type: video/mp4`, `Cache-Control`,
   `Pragma`, plus `Content-Length` on the 200 path and `Content-Range` on the
   206 path. There is no `res.setHeader('Access-Control-Allow-Origin', ...)`
   call anywhere in the file (verified by grep — only references are in this
   debug file's source-tree; the only `.ts`/`.tsx` hits for CORS / crossOrigin
   across the whole repo are in the UAT gap description itself,
   `.planning/phases/05-screenshots-procedure-review-trim/05-UAT.md:276,281-282`).
   The same gap applies to the `PreviewServer.onHttpRequest` MJPEG route at
   `preview-server.ts:225-227`.

2. **Client side — `<video>` has no `crossOrigin` attribute.**
   `ProcedureReview.tsx:252-260`:
   ```tsx
   <video
     ref={videoRef}
     controls
     preload="metadata"
     className="aspect-video w-full"
     data-testid="procedure-review-video"
     aria-label="Procedure recording playback"
     src={videoSrc ?? undefined}
   />
   ```
   No `crossOrigin="anonymous"` prop. With Chromium's default same-origin
   policy and no CORS header on the response, the resulting
   `HTMLVideoElement` is a cross-origin media element. Any subsequent
   `drawImage(<video>, …)` taints the destination canvas.

3. **Renderer origin ≠ MediaServer origin.** `src/main/window.ts:46` loads
   `DEV_SERVER_URL` (typically `http://localhost:<vite-port>`); line 48
   loads `file://…/renderer/index.html`. The MediaServer binds to
   `http://127.0.0.1:<random>` (`preview-server.ts:413-415`). Chromium
   treats `localhost` and `127.0.0.1` as different hosts, and `file://` as
   an opaque origin distinct from any `http://` origin — so the request
   crosses origins regardless of environment.

4. **Tests do not exercise the tainted-canvas security guard.** In
   `tests/renderer/lib/capture-screenshot.test.ts:57-61` the suite
   monkey-patches `HTMLCanvasElement.prototype.toBlob` to a synthetic
   implementation that *unconditionally* returns a `Blob`:
   ```ts
   proto.toBlob = function (cb, type?, q?) {
     const buf = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
     setTimeout(() => cb(new Blob([buf], { type: type ?? 'image/jpeg' })), 0);
   };
   ```
   The real Chromium implementation throws "Tainted canvases may not be
   exported" *synchronously inside `toBlob` itself* (it fires the callback
   with `null`). The mock never hits that branch, so the entire class of
   cross-origin-capture failures is invisible to the unit suite. There is
   no integration test that actually issues a real `<video>.load()`
   against a real `MediaServer` response and then asserts `toBlob()`
   behaviour.

5. **Server-side tests do not assert the CORS header is absent either.**
   `tests/main/recorder/preview-server.test.ts:326-335` asserts only
   `content-type`, `accept-ranges`, `content-length`. No test reads
   `response.headers['access-control-allow-origin']`, so adding the
   missing header is not currently part of the contract surface — there is
   no positive expectation to break and no negative expectation to
   satisfy.

---

## Eliminated

- hypothesis: "Quality / format error in JPEG encoding"
  evidence: `canvasToBlob` in `capture-screenshot.ts:36-50` is the throw site
  path; the actual error message is verbatim the Chromium DOMException for a
  tainted canvas, not an encoder error. Encoder errors surface as
  `canvas.toBlob returned null` (different message, asserted in tests).
  timestamp: 2026-08-07

- hypothesis: "Blob/FileReader encoding bug"
  evidence: `canvas.toBlob` throws *before* `FileReader.readAsDataURL` is
  reached. Error originates from the canvas export guard, not the base64
  conversion. `blobToBase64` at `capture-screenshot.ts:52-67` is not in the
  failure stack.
  timestamp: 2026-08-07

- hypothesis: "MediaServer returns wrong bytes / partial mp4"
  evidence: `<video>.readyState >= 2` gate in `ProcedureReview.tsx:163-166`
  passes (the user can Play the video and observe frames), so the mp4 itself
  is decodable. Failure is specifically `toBlob()` after `drawImage()` —
  Chromium's tainted-canvas guard, not a decode / range issue.
  timestamp: 2026-08-07

---

## Files Involved

| File | What's wrong |
| --- | --- |
| `src/main/recorder/preview-server.ts` | `MediaServer.onHttpRequest` (lines 423-554) and `PreviewServer.onHttpRequest` (lines 210-252) set `Content-Type`, `Cache-Control`, `Pragma`, `Accept-Ranges` but **no** `Access-Control-Allow-Origin`. The MP4 and MJPEG responses are cross-origin from the renderer's perspective. |
| `src/renderer/src/pages/ProcedureReview.tsx` | `<video>` element at lines 252-260 has `src={videoSrc}` with **no `crossOrigin="anonymous"`** prop. The element loads the MediaServer URL in no-cors mode and taints any canvas that draws it. |
| `src/renderer/src/pages/ProcedureRoom.tsx` | Live `<img>` at lines 305-313 has `src={previewUrl}` with **no `crossOrigin="anonymous"`** prop. Same latent bug — the MJPEG `S`-hotkey capture path will fail the same way once exercised end-to-end. |
| `src/renderer/src/lib/capture-screenshot.ts` | Not a bug per se: `drawImage` → `toBlob` at lines 96-98 is the correct sequence and the throw is the spec-mandated Chromium security behaviour. (The library cannot un-taint an already-loaded source.) |
| `tests/renderer/lib/capture-screenshot.test.ts` | The `toBlob` mock at lines 57-61 unconditionally returns a `Blob`, bypassing the tainted-canvas security guard. This is why the unit suite is green while the feature is broken in production. |
| `tests/main/recorder/preview-server.test.ts` | The MediaServer header assertions at lines 326-335 check `content-type`, `accept-ranges`, `content-length` only. No test asserts the presence or absence of `access-control-allow-origin`, so the missing header is invisible to the contract suite. |
| `src/renderer/src/hooks/useMediaUrl.ts` | Correct: returns the loopback MediaServer URL (`http://127.0.0.1:<port>`). The cross-origin mismatch comes from the renderer's own origin (`localhost:<vite>` or `file://`), not from this hook. |
| `src/renderer/src/hooks/useScreenshotIntake.ts` | Correct: just transports the capture action and timestamps. The `capture` callback at line 65-95 routes through `captureScreenshot`, which is where the tainting surfaces. |
| `src/main/window.ts` | Loads the renderer via `loadURL(DEV_SERVER_URL)` (line 46) or `loadFile(...)` (line 48). These origins are different from `http://127.0.0.1:<random>` and therefore trigger Chromium's cross-origin policy. |

---

## Resolution

- root_cause: The `<video>` element at `src/renderer/src/pages/ProcedureReview.tsx:252-260` loads from `http://127.0.0.1:<port>/media/...` (a cross-origin URL relative to the renderer's `localhost:<vite-port>` / `file://` origin) without `crossOrigin="anonymous"`, and `MediaServer.onHttpRequest` in `src/main/recorder/preview-server.ts:423-554` does not send `Access-Control-Allow-Origin`. As a result, `ctx.drawImage(videoRef.current, 0, 0, w, h)` at `src/renderer/src/lib/capture-screenshot.ts:96` taints the canvas, and the subsequent `canvas.toBlob(…)` at line 98 throws `DOMException: Tainted canvases may not be exported` per Chromium's HTML5 canvas security model.
- fix: (not applied — mode `find_root_cause_only`)
- verification: (not applied — mode `find_root_cause_only`)
- files_changed: []

---

## Suggested Fix Direction

Add `Access-Control-Allow-Origin: *` (or echo the request Origin when loopback) to the response headers emitted by both `MediaServer.onHttpRequest` and `PreviewServer.onHttpRequest` in `src/main/recorder/preview-server.ts`, AND add `crossOrigin="anonymous"` to the `<video>` element in `src/renderer/src/pages/ProcedureReview.tsx` and to the `<img>` in `src/renderer/src/pages/ProcedureRoom.tsx`. (The two changes must land together — either alone re-introduces the failure: missing header ⇒ CORS load rejected; missing attribute ⇒ canvas taints again.) If the CORS coupling is undesirable for v1, the alternative is to swap the renderer-side capture path for a main-process ffmpeg `image2` muxer invocation that writes the JPEG directly to disk, bypassing the canvas entirely.
