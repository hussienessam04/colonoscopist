---
status: testing
phase: 05-screenshots-procedure-review-trim
source: [05-01-SUMMARY.md, 05-02-SUMMARY.md, 05-03-SUMMARY.md, 05-04-SUMMARY.md, 05-05-SUMMARY.md, 05-06-SUMMARY.md, 05-07-SUMMARY.md, 05-08-SUMMARY.md, 05-09-SUMMARY.md, 05-UAT.md (hardware smoke)]
started: 2026-08-07T11:50:00.000Z
updated: 2026-08-07T18:00:00.000Z
---

## Current Test

[testing complete — 2 new gaps (G-05-13, G-05-14) reported at end of session, awaiting plan-phase --gaps round 4]

## Tests

### 1. Cold Start Smoke Test (MediaServer boot + migration 0003)
expected: |
  Boot the Electron app from scratch with `npm run dev`. Confirm:
  - Login screen renders without console errors
  - Migration 0003 (`screenshots_and_trim`) applies on a fresh DB (or is detected as already-applied on a warm DB)
  - The MediaServer boots at app start and binds to `127.0.0.1:<random>` — no port-in-use error
  - Wizard-bootstrap completes for a fresh DB; sign-in works on a warm DB
result: pass

### 2. Record a 30-second procedure
expected: |
  Open the Patients list → click the actions menu (⋯) on any non-deleted row → click "Open Procedure Preview" → On the Procedure Preview / Procedure Room screen, click Record.
  - MJPEG live preview appears within ~1s (`recording.start` IPC returns previewUrl)
  - Timer ticks 00:00:01 → 00:00:30 over 30 seconds
  - Click Stop. Screen navigates to Procedure Review within ~2s.
  - No error toast. Review screen renders the recorded mp4 in the <video> pane on the left.
result: pass

### 3. Capture 2 screenshots from playback
expected: |
  Click Play on the <video>. While playing, click the +Capture button at the end of the screenshot timeline twice:
  - Once at ~10s into playback
  - Once at ~20s into playback
  Two <img> thumbnails render below the scrubber. Each carries a hover tooltip with HH:MM:SS.mmm timestamp. +Capture is the last child of the timeline row.
result: pass
note: post-fix re-test (G-05-3 resolved in 05-05).

### 4. Click a thumbnail to seek
expected: |
  Click the first thumbnail (~10s). <video> seeks to ~10s — progress fill jumps to ~33% of track width, playhead timestamp label updates, frame freezes on the captured frame. Click-to-seek is one-way; video does NOT auto-resume (doctor clicks Play to resume).
result: pass

### 5. Trim 5s–25s
expected: |
  Click Trim button (scissors icon) in right rail. Two handles + red-shaded cut region appear on scrubber. Drag in-handle to 5s, out-handle to 25s. Right rail labels: "In: 00:00:05 · Out: 00:00:25". Cut region is shaded red. **NEW (G-05-12 fix):** Scrubber shows blue dot markers at every captured screenshot position + a tick scale (every 5s for <60s, every 10s for >60s). **NEW (G-05-12 fix):** TrimControls shows in-frame JPEG preview at the in-handle + out-frame JPEG preview at the out-handle, above the In/Out labels. Click Apply. Spinner replaces Apply button for ~1–5s. On completion: toast "Trim applied" appears, <video> reloads to trimmed clip (~20s long), procedure.videoPath points to trimmed sibling, videoPathOriginal preserved (first-trim-only COALESCE guard).
  **G-05-11 was fixed in plan 05-08** — `windowsVerbatimArguments: true` removed from trim spawn (was truncating path at first space → ffmpeg tried to open `C:\Users\Hussien` directory → EACCES).
  **G-05-12 was fixed in plan 05-09** — Scrubber dot markers + tick scale + TrimControls in/out frame previews.
result: pass

### 6. Verify the trimmed mp4 plays
expected: |
  Right rail shows Restore original enabled (videoPathOriginal populated). Click Play. Video plays the trimmed 20s segment (5s–25s of original, ±500ms tolerance per -ss before -i -c copy tradeoff). No "mp4 won't play" error. Trimmed clip ends before original would have ended.
result: pass

### 7. Restore and verify the original
expected: |
  Click Restore original. Spinner replaces Restore button briefly. <video> reloads to original (untrimmed) recording at videoPathOriginal. Click Play. Video plays the full 30-second original. restoreFromOriginal is idempotent — calling again is a no-op. videoPathOriginal column preserved against future trims.
result: pass
note: User also reported 2 new issues at end of session (delete toast but no removal; lightbox not showing full-size). Logged as G-05-13 + G-05-14 below — these are NEW runtime bugs discovered AFTER Plan 05-07 shipped, not regressions of the unit suite (which was green at 499/499).

## Automated Coverage (not presented to user — already verified by test suite)

### A1. Migration 0003 schema (SCRN-01)
expected: |
  Migration 0003 creates the screenshots table (FK ON DELETE CASCADE, CHECK >= 0, index on (procedure_id, timestamp_in_video ASC)) and adds procedures.video_path_original column. Idempotent re-runs are no-ops.
result: pass
source: automated
coverage_id: D1 (05-01)
ref: tests/main/db/migrations/0003_screenshots_and_trim.test.ts

### A2. screenshotsRepo CRUD (SCRN-01)
expected: |
  screenshotsRepo.add / get / listByProcedure (timestamp_in_video ASC) / delete (with removeFile option) / updateAnnotation round-trip; delete(id) for unknown id throws IPC_NOT_FOUND.
result: pass
source: automated
coverage_id: D2 (05-01)
ref: tests/main/db/screenshots-repo.test.ts

### A3. screenshots IPC handlers (SCRN-01)
expected: |
  add writes JPEG + inserts row + audits screenshot.captured with { screenshotId, timestampInVideoMs }. LIST returns ASC. DELETE rejects unknown id. UPDATE_ANNOTATION rejects empty body. PROCEDURES_TRIM/RESTORE throw IPC_NOT_IMPLEMENTED until Plan 03 fills them.
result: pass
source: automated
coverage_id: D3 (05-01)
ref: tests/main/ipc/screenshots.test.ts

### A4. capture-screenshot lib (SCRN-02)
expected: |
  captureScreenshot() draws source onto canvas, downscales to maxLongEdge=1280 (never upscales), encodes JPEG at quality=0.85, returns { blob, width, height, base64 }.
result: pass
source: automated
coverage_id: D4 (05-01)
ref: tests/renderer/lib/capture-screenshot.test.ts

### A5. Bare Scrubber (REV-01)
expected: |
  Pointer events + setPointerCapture, click-to-seek + drag-to-seek with progressive onSeek updates; progress fill width = currentMs / durationMs (clamped 0..100).
result: pass
source: automated
coverage_id: D5 (05-01)
ref: tests/renderer/components/Scrubber.test.tsx

### A6. ScreenshotTimeline + click-to-seek + Toast-undo delete (REV-02)
expected: |
  Memoized ScreenshotThumbnail cards in horizontal scroll row, ordered by timestamp_in_video ASC; +Capture button at end; clicking thumbnail seeks video; clicking × deletes with Toast undo.
result: pass
source: automated
coverage_id: D6 (05-01)
ref: tests/renderer/components/ScreenshotTimeline.test.tsx

### A7. Pause markers on scrubber from procedure_segments (REV-01)
expected: |
  Scrubber renders one pause marker per procedure_segment at startedAtMs/durationMs percent with aria-label + title + data-testid.
result: pass
source: automated
coverage_id: D1 (05-02)
ref: tests/renderer/components/Scrubber.test.tsx + tests/renderer/pages/ProcedureReview.test.tsx

### A8. Inline ScreenshotAnnotation (REV-02)
expected: |
  ScreenshotAnnotation opens inline input on caption click + Enter saves via onSave + Escape cancels + blur auto-saves.
result: pass
source: automated
coverage_id: D2 (05-02)
ref: tests/renderer/components/ScreenshotAnnotation.test.tsx

### A9. ProcedureNotesReview read-only accordion (REV-02)
expected: |
  Empty state copy + ASC ordering + default-open for completed + collapsed for partial + no input (read-only).
result: pass
source: automated
coverage_id: D3 (05-02)
ref: tests/renderer/components/ProcedureNotesReview.test.tsx

### A10. StatusBadge variant mapping (REV-03)
expected: |
  StatusBadge wraps shadcn Badge with canonical variant mapping (completed=default, recording/partial=secondary, crashed=destructive).
result: pass
source: automated
coverage_id: D4 (05-02)
ref: tests/renderer/pages/ProcedureReview.test.tsx

### A11. ProcedureReview right rail (REV-01, REV-03)
expected: |
  Right rail: notes accordion + status badge + DeviceLostBanner (partial + .partial.mp4) + Trim placeholder card.
result: pass
source: automated
coverage_id: D5 (05-02)
ref: tests/renderer/pages/ProcedureReview.test.tsx

### A12. ScreenshotTimeline +Capture gate on status='crashed' (REV-03, D-13)
expected: |
  +Capture disabled when status === 'crashed' (D-13 partial gate). Enabled when status === 'completed' OR 'partial'.
result: pass
source: automated
coverage_id: D6 (05-02)
ref: tests/renderer/components/ScreenshotTimeline.test.tsx + tests/renderer/pages/ProcedureReview.test.tsx

### A13. procedures.restore IPC + restoreFromOriginal repo (REV-04, D-09)
expected: |
  procedures.restore IPC handler + restoreFromOriginal repo: re-points video_path to video_path_original; rejects when videoPathOriginal is null; rejects when the original file is missing on disk; succeeds when file exists.
result: pass
source: automated
coverage_id: D-09 (05-03)
ref: tests/main/ipc/procedures.test.ts + tests/main/db/procedures-repo.test.ts

### A14. Partial-status gate (REV-04, D-13)
expected: |
  Trim disabled on partial recordings. Enforced at both renderer (Apply disabled when status === 'partial') AND IPC (rejects "Cannot trim a partial recording").
result: pass
source: automated
coverage_id: D-13 (05-03)
ref: tests/renderer/components/TrimControls.test.tsx + tests/main/recorder/trim.test.ts + tests/main/ipc/procedures.test.ts

### A15. PreviewServer /media/ path-escape protection (REV-04, T-05-08)
expected: |
  /media/ route validates path components with regex AND rejects escape attempts via path.relative(userDataRoot, resolvedPath).startsWith('..') returning 403. Returns 404 for invalid path shape or missing file. Returns 405 for non-GET/HEAD methods.
result: pass
source: automated
coverage_id: T-05-08 (05-03)
ref: tests/main/recorder/preview-server.test.ts

### A16. PreviewServer /media/ Accept-Ranges + Content-Type (REV-04, T-05-22)
expected: |
  /media/ route returns mp4 with Accept-Ranges: bytes + Content-Type: video/mp4 + Content-Length so Chromium recognizes it as a seekable video source.
result: pass
source: automated
coverage_id: T-05-22 (05-03)
ref: tests/main/recorder/preview-server.test.ts

### A17. PreviewServer /media/ HTTP Range request support (REV-04, T-05-22)
expected: |
  /media/ route serves HTTP Range requests with 206 + Content-Range + Content-Length so Chromium's <video> can seek. 16 cases covering bytes=START-END, bytes=START-, bytes=-N, out-of-bounds clamping, malformed fallback, start>end 416, multi-range rejection, Range + path-escape defense-in-depth.
result: pass
source: automated
coverage_id: D-22 (05-04)
ref: tests/main/recorder/preview-server.test.ts (16 Range cases)

### A18. applyTrim 5-minute SIGTERM timeout (REV-04, T-05-39)
expected: |
  applyTrim surfaces IPC_VALIDATION when ffmpeg is killed by a timeout-equivalent SIGTERM. The 5-minute timeout constant is applied to runaway ffmpeg subprocesses.
result: pass
source: automated
coverage_id: D-23 (05-04)
ref: tests/main/recorder/trim.test.ts

### A19. MediaServer security audit (REV-04, T-05-08 + T-05-33..38 + T-05-40..43)
expected: |
  9 cases covering URL-encoded path-escape, absolute path, null byte injection, out-of-tree lookup, Range suffix-length, out-of-bounds clamp, start>end 416, malformed fallback 200, defense-in-depth Range+escape.
result: pass
source: automated
coverage_id: D-24 (05-04)
ref: tests/security/range-request.test.ts

### A20. TrimControls 30-min cap + Scrubber clampCurrent + useMediaUrl retry (REV-04)
expected: |
  Renderer hardening: TrimControls MAX_TRIM_DURATION_MS = 30 * 60 * 1000 cap; Scrubber clampCurrent guard; useMediaUrl retry() + retryKey for transient failures; ProcedureReview placeholder Card when mediaUrl is null.
result: pass
source: automated
coverage_id: D-26 (05-04)
ref: tests/renderer/components/TrimControls.test.tsx

### A21. DestructivePartialAlert extracted (SCRN-01, D-13)
expected: |
  DestructivePartialAlert extracted as reusable component; ProcedureReview renders it conditional on status='partial' with copy branching on .partial.mp4 fingerprint. 3 cases: renders on partial, doesn't render on completed, generic copy when status=partial but videoPath is canonical.
result: pass
source: automated
coverage_id: D-27 (05-04)
ref: tests/renderer/pages/procedure-room-timer.test.tsx

### A22. Pre-existing test cascade fixes (SCRN-02)
expected: |
  Migrations count assertions updated 2→3 after Plan 01 added migration 0003; procedure-room-timer cascade pollution fixed via missing IPC mocks + Date.now restoration. All 18 procedure-room-timer tests pass.
result: pass
source: automated
coverage_id: D-28 (05-04)
ref: tests/main/db/migrations.test.ts + tests/main/db/migrations/0002_procedures.test.ts + tests/renderer/pages/procedure-room-timer.test.tsx

## Deferred Follow-Ups

(none yet)

## Summary

total: 7
passed: 7
issues: 2
pending: 0
skipped: 0
blocked: 0

coverage_automated: 22 of 22 phase deliverables auto-passed (484/484 unit tests across 62 files)

## Gaps

```yaml
- gap_id: G-05-3
  truth: |
    Clicking +Capture during playback successfully saves a JPEG screenshot from the current <video> frame to <userData>/data/media/patients/<id>/<procedureId>/screenshots/<ts>.jpg and the thumbnail appears in the timeline without errors.
  status: resolved
  resolved_by: 05-05-PLAN.md
  resolved_at: 2026-08-07
  reason: |
    User reported: "Failed to execute 'toBlob' on 'HTMLCanvasElement': Tainted canvases may not be exported."
  reason: |
    User reported: "Failed to execute 'toBlob' on 'HTMLCanvasElement': Tainted canvases may not be exported."
  severity: blocker
  test: 3
  root_cause: |
    <video> loads from http://127.0.0.1:<random>/media/... (MediaServer route) without crossOrigin="anonymous", AND MediaServer does not send Access-Control-Allow-Origin. Chromium treats the source as cross-origin → canvas.drawImage taints the canvas → canvas.toBlob() throws DOMException. Same latent gap exists on the live-preview <img> in ProcedureRoom (the S-hotkey capture path).
  artifacts:
    - path: src/renderer/src/pages/ProcedureReview.tsx
      issue: '<video ref={videoRef} ... src={videoSrc} /> has no crossOrigin="anonymous" attribute'
    - path: src/renderer/src/pages/ProcedureRoom.tsx
      issue: live <img> for MJPEG preview has no crossOrigin="anonymous" attribute (latent bug for S-hotkey path)
    - path: src/main/recorder/preview-server.ts
      issue: 'MediaServer.onHttpRequest emits no Access-Control-Allow-Origin header (only Accept-Ranges, Content-Type, Cache-Control, Pragma, Content-Length). PreviewServer.onHttpRequest same gap on /preview MJPEG route.'
    - path: tests/renderer/lib/capture-screenshot.test.ts
      issue: 'toBlob monkey-patch bypasses the tainted-canvas guard — masks the bug from the unit suite'
    - path: tests/main/recorder/preview-server.test.ts
      issue: 'no assertion on access-control-allow-origin — the missing header is outside the contract'
  missing:
    - 'Add Access-Control-Allow-Origin: * to MediaServer /media/ response headers (preview-server.ts:491-494, 539-540)'
    - 'Add Access-Control-Allow-Origin: * to PreviewServer /preview response headers (preview-server.ts:225-227) — fixes live-preview latent bug'
    - 'Add crossOrigin="anonymous" to the <video> element in ProcedureReview.tsx:252-260'
    - 'Add crossOrigin="anonymous" to the live <img> element in ProcedureRoom.tsx:305-313 — fixes S-hotkey latent bug'
    - 'Update tests/renderer/lib/capture-screenshot.test.ts to assert a real toBlob (or skip the mock when source is a <video>)'
    - 'Update tests/main/recorder/preview-server.test.ts to assert access-control-allow-origin header'
  debug_session: .planning/debug/DEBUG-tainted-canvas-screenshot.md
- gap_id: G-05-5
  truth: |
    Clicking Apply in the Trim panel runs ffmpeg against the canonical mp4 path stored in procedures.video_path and produces a trimmed sibling file. video_path_original is preserved (first-trim-only COALESCE).
  status: resolved
  resolved_by: 05-06-PLAN.md
  resolved_at: 2026-08-07
  reason: |
    User reported: "Trim failed: Error invoking remote method 'procedures:trim': Error: Source video missing at data/media/patients/88147c14-658c-440a-badf-e0707f52acb7/116315a0-355f-4f7f-8c88-75ed80510524/video.mp4"
  reason: |
    User reported: "Trim failed: Error invoking remote method 'procedures:trim': Error: Source video missing at data/media/patients/88147c14-658c-440a-badf-e0707f52acb7/116315a0-355f-4f7f-8c88-75ed80510524/video.mp4"
  severity: blocker
  test: 5
  root_cause: |
    Path-shape contract drift between Phase 4 recorder and Phase 5 trim resolver. Recorder stores `data/media/patients/<patientId>/<procedureId>/video.mp4` (full userData-relative path) into procedures.video_path, but `paths.ts::videoFilePath` joins procedureMediaDir (which already returns `<userData>/data/media/patients/<patientId>/<procedureId>`) with the stored value. Result: doubled absolute path `<userData>/data/media/patients/<patientId>/<procedureId>/data/media/patients/<patientId>/<procedureId>/video.mp4` → existsSync returns false → applyTrim throws IPC_NOT_FOUND. The toast at trim.ts:80 prints the raw stored value (single path) which matches the DB but doesn't reflect the doubled stat path. Same latent failure in proceduresRepo.restoreFromOriginal (currently masked because Trim never succeeds).
  artifacts:
    - path: src/main/recorder/recorder.ts
      issue: 'relativeVideoPath (lines 1255-1258) returns full userData-relative path; the column semantically wants filename-within-procedure-dir'
    - path: src/main/recorder/trim.ts
      issue: 'applyTrim path resolution (lines 75-83) blindly trusts procedure.videoPath is a filename; toast string matches DB but stat was against the doubled path'
    - path: src/main/paths.ts
      issue: 'videoFilePath (lines 47-52) assumes third arg is a procedure-relative filename — correct for one shape, wrong for the recorder shape'
    - path: src/main/db/procedures-repo.ts
      issue: 'restoreFromOriginal (lines 283-305) — second latent failure point of the same root cause'
    - path: tests/main/recorder/trim.test.ts
      issue: 'test fixture uses videoPath: "video.mp4" (filename) while production writes the full path — contract drift not guarded'
  missing:
    - 'Pick one shape for procedures.video_path and apply everywhere — cleanest: change relativeVideoPath in recorder.ts:1255-1258 to return just the filename (video.mp4) so it matches paths.ts::videoFilePath contract and existing trim.test.ts fixture shape'
    - 'Audit every other writer/reader of procedures.video_path: orphans.ts, restoreFromOriginal, the trimmed-rel returned by applyTrim at trim.ts:114-115 — ensure column stays filename-shaped end-to-end'
    - 'Update tests/main/recorder/trim.test.ts bootstrap to insert the row with the recorder production shape and assert the resolver still finds the fixture — closes the contract-drift gap'
    - 'Improve toast/error path: when source missing, list the searched paths + procedure status + actual files in procedure dir — helps future debugging'
  debug_session: .planning/debug/trim-source-missing.md
- gap_id: G-05-8
  truth: |
    During a procedure, the doctor can capture screenshots with the S hotkey OR the Camera button (ProcedureRoom) AND see the captured screenshots in a gallery panel with delete (Toast-undo) support — so the doctor can review what they've captured mid-procedure and delete accidental captures without waiting until post-recording review.
  status: resolved
  resolved_by: 05-07-PLAN.md
  resolved_at: 2026-08-07
  reason: |
    User reported: "its works but i still need to see the screensshoots in the romm procudere with delete option"
  reason: |
    User reported: "its works but i still need to see the screensshoots in the romm procudere with delete option"
    Test 3 (post-recording +Capture) passes after G-05-3 fix. But the mid-procedure screenshot experience is incomplete: capturing via S/Camera saves the screenshot + returns success toast (per useScreenshotIntake hook, Plan 01), but the captured screenshot is NOT visible in ProcedureRoom. The doctor has no way to see or delete mid-procedure captures during the procedure. The screenshot timeline + Toast-undo delete are only available in ProcedureReview (post-recording). Phase 5's stated goal "Doctor can capture screenshots during OR AFTER a procedure" implies the doctor should see their captures during the procedure too.
  severity: major
  test: 3
  artifacts: []
  missing:
    - ProcedureRoom needs a gallery panel (or chip strip) showing screenshots captured during the current procedure, ordered by capture timestamp
    - Each thumbnail needs a delete affordance (× button or right-click menu) that calls screenshots.delete via IPC + Toast-undo for 5s (reuse Plan 02's delete store)
    - Reuse ScreenshotThumbnail + ScreenshotTimeline components from ProcedureReview where possible (extract to a shared gallery)
    - useScreenshotIntake hook needs to expose the current procedure's screenshots[] state (already calls list on mount? — verify) for the gallery to render
    - Tests for: gallery renders empty state when no screenshots, gallery shows thumbnails in order, × button calls IPC + Toast undo + removes from list
- gap_id: G-05-9
  truth: |
    Each thumbnail in the ScreenshotTimeline has a clearly discoverable delete affordance (× button always visible, NOT hover-only) so the doctor can quickly remove accidental screenshots without learning a hidden interaction.
  status: resolved
  resolved_by: 05-07-PLAN.md
  resolved_at: 2026-08-07
  reason: |
    User reported: "i need to be able to delete them" after Test 4 (seek).
  reason: |
    User reported: "i need to be able to delete them" after Test 4 (seek). Plan 02 shipped a placeholder × button in Plan 01 + wired the delete + Toast-undo in Plan 02, but the visibility/affordance is insufficient — either the × is hover-only (hidden by default) or otherwise not discoverable in the timeline. Audit: confirm ScreenshotThumbnail.tsx renders the × button by default (not on hover) at sufficient size + contrast, with proper aria-label.
  severity: major
  test: 4
  artifacts: []
  missing:
    - Verify ScreenshotThumbnail × button is always visible (not hover-only); confirm with high-contrast icon (not greyed-out)
    - Confirm aria-label="Delete screenshot" on the button (already likely correct — verify)
    - If hover-only currently, change to always-visible
    - Add a unit test: button is in the DOM by default (not conditional on hover state)
- gap_id: G-05-10
  truth: |
    Clicking a thumbnail in the ScreenshotTimeline opens a full-size lightbox/modal view of the screenshot so the doctor can see the actual clinical detail (not just the ~120x90px thumbnail) — useful for verifying a capture before finalizing the procedure report.
  status: resolved
  resolved_by: 05-07-PLAN.md
  resolved_at: 2026-08-07
  reason: |
    User reported: "the photos are thumbnail i cant see the real image"
  reason: |
    User reported: "the photos are thumbnail i cant see the real image". Currently ScreenshotTimeline + ScreenshotThumbnail render the screenshot at ~120x90px in the timeline; clicking the thumbnail seeks the <video> (Test 4) but does NOT open a full-size view. Phase 5 ships a 1280px maxLongEdge JPEG (per D-04) but there's no UI surface to view it at that resolution.
  severity: major
  test: 4
  artifacts: []
  missing:
    - Clicking a thumbnail opens a lightbox/modal showing the full-resolution JPEG (e.g., the 1280x720 capture) with the timestamp + annotation + a close button
    - The lightbox is dismissible via Esc, click-outside, or close button
    - Delete button also available inside the lightbox (parity with timeline delete)
    - Reuse the existing /media/ PreviewServer route for serving the full-size JPEG (no new server work needed)
    - Tests: lightbox opens on click, dismisses on Esc, renders the full-size JPEG src
- gap_id: G-05-11
  truth: |
    Clicking Apply on a non-partial completed procedure runs ffmpeg against the canonical mp4 successfully (no Permission Denied) and produces the trimmed sibling file.
  status: resolved
  resolved_by: 05-08-PLAN.md
  resolved_at: 2026-08-07
  reason: |
    User reported: "Trim failed: Error invoking remote method 'procedures:trim': Error: ffmpeg trim failed (code=4294967283, signal=none): [in#0 @ 0000021c774dc480] Error opening input: Permission denied | Error opening input file C:\Users\Hussien. | Error opening input files: Permission denied"
  reason: |
    User reported: "Trim failed: Error invoking remote method 'procedures:trim': Error: ffmpeg trim failed (code=4294967283, signal=none): [in#0 @ 0000021c774dc480] Error opening input: Permission denied | Error opening input file C:\Users\Hussien. | Error opening input files: Permission denied"
    Root cause confirmed by debugger: `src/main/recorder/trim.ts:137-140` sets `windowsVerbatimArguments: true` on the spawn. With that flag, Node passes the argv array as a single space-joined string with NO quoting/escaping. ffmpeg's parser splits on whitespace, so the path `C:\Users\Hussien Essam\AppData\Roaming\colonoscopist\data\media\patients\<id>\<id>\video.mp4` is truncated at the first space and arrives at ffmpeg as `C:\Users\Hussien` (the user's HOME directory, not a file). ffmpeg tries to open a directory → EACCES → "Permission denied". The trim subprocess is the only spawn in the codebase with this flag — recorder.ts:290 and recorder.ts:1045 use Node's default Windows quoting and work fine, which is why the recording itself succeeds on this user's machine.
  reason: |
    User reported: "Trim failed: Error invoking remote method 'procedures:trim': Error: ffmpeg trim failed (code=4294967283, signal=none): [in#0 @ 0000021c774dc480] Error opening input: Permission denied | Error opening input file C:\Users\Hussien. | Error opening input files: Permission denied"
    The error message ends at "C:\Users\Hussien." — looks truncated (probably MAX_PATH or shell quoting, OR just ffmpeg's stderr truncation behavior). G-05-5 fix made the file findable but ffmpeg can't open it. Candidate causes:
    - The file is locked by another process holding it open: (a) MediaServer's createReadStream for /media/ HTTP serving, (b) preview-server's MJPEG tee still streaming, (c) Chromium's <video> decoder holding a handle, or (d) Windows AV scanner. Most likely culprit: the MediaServer + the chromium <video> both holding read handles — Windows can usually handle concurrent reads, but `-c copy` may need exclusive read access on certain Windows builds.
    - Path quoting issue: path has a space ("Hussien Essam") and the error truncates at the space — possibly `child_process.spawn` is splitting args incorrectly on Windows despite `windowsVerbatimArguments`. Verify spawn signature uses `{ windowsVerbatimArguments: true }` + single arg array entry, NOT shell:true.
    - MAX_PATH (>260 chars without long path support): userData path is `C:\Users\Hussien Essam\AppData\Roaming\colonoscopist\` (~60 chars) + procedureId (~36 chars) + filename. Likely ~120-150 chars total — under MAX_PATH. Probably not it.
    - User permissions: the user account doesn't have read access to the mp4 in userData. Unlikely on a single-user workstation, but possible if the recording was started as a different user (UAC).
    - Antivirus lock: AV is mid-scan of the mp4 when ffmpeg opens it. Possible but rare; usually AV scans release the lock quickly.
  severity: blocker
  test: 5
  artifacts: []
  missing:
    - Fix root cause (likely file-lock conflict with MediaServer/<video> handle)
    - Add a `fs.copyFile(src, tempInput)` BEFORE spawning ffmpeg so the input is a fresh copy, not the live file
    - Or: detect MediaServer/createReadStream open handles and close them before spawning ffmpeg
    - Or: use `windowsVerbatimArguments: true` correctly + verify spawn signature
    - Update trim error message to include: full input path (not just the column value), the file-locking diagnostic, and instructions (e.g., "if a screenshot thumbnail or the <video> is loaded, click pause first")
    - Tests for: applyTrim on a fresh-copy path; applyTrim when MediaServer has the file open concurrently (likely not in unit tests but a smoke check)
- gap_id: G-05-12
  truth: |
    When the doctor enables Trim mode, the right rail + scrubber show a clear visual representation of the trim range (cut region shaded, in-frame + out-frame thumbnails preview, current playhead relative to the trim window) so they can visually confirm exactly what they're trimming.
  status: resolved
  resolved_by: 05-09-PLAN.md
  resolved_at: 2026-08-07
  reason: |
    User reported: "we need to add the timeline in the trim line so i understand exactly the timmming i trim"
  reason: |
    User reported: "we need to add the timeline in the trim line so i understand exactly the timmming i trim". Current TrimControls only shows text labels ("In: 00:00:05 · Out: 00:00:25") and the Scrubber shows two drag handles with a red-shaded cut region between them. But there's no frame-level visual preview — the doctor has to read numeric timestamps + scrub to find what each end of the cut corresponds to in the actual procedure.
  severity: major
  test: 5
  artifacts: []
  missing:
    - In-frame preview thumbnail: when hovering on the in-handle, show the frame at that timestamp (or the nearest keyframe) as a small preview tooltip
    - Out-frame preview thumbnail: same for the out-handle
    - Visual timestamp scale below the scrubber with major ticks (every 5s/10s) when in trim mode
    - Optionally: a mini-timeline showing where the captured screenshots fall relative to the trim window (so the doctor can confirm the salient part of the procedure is included)
- gap_id: G-05-13
  truth: |
    Clicking the × delete button on a screenshot thumbnail invokes the screenshots.delete IPC, removes the row from the database, unlinks the JPEG file from disk, removes the thumbnail from the timeline UI, AND shows a "Screenshot deleted" toast with an Undo affordance that re-creates the screenshot row within 5 seconds.
  status: diagnosed
  reason: |
    User reported: "delete btn show toast msg but dont remove them".
  reason: |
    User reported: "delete btn show toast msg but dont remove them". After Plan 05-07 shipped the gallery + delete discoverability + Toast-undo plumbing, the × button click DOES fire (toast appears), but the screenshot remains visible in the timeline. Candidate causes:
    - The handleScreenshotDelete function in ProcedureRoom OR ProcedureReview fires the toast BEFORE the IPC call returns, and a silent IPC failure leaves the screenshot in the gallery state.
    - The gallery state (in useScreenshotIntake hook) is append-only — there's no `remove(screenshotId)` action wired to the delete handler.
    - The Toast-undo store's enqueueDelete callback fires a 5-second windowed deletion but the actual removal happens on the timeout; if the IPC fails, the screenshot stays in local state but the row is gone from DB → inconsistent UI.
    - The IPC `screenshots.delete` may be failing silently — the IPC_NOT_FOUND or IPC_VALIDATION paths aren't surfaced.
    - Test masking: the gallery tests in plan 05-07 used mock-resolved IPC; real IPC behavior (success/error paths, state mutation) not exercised end-to-end.
  severity: major
  test: 7
  artifacts: []
  missing:
    - Verify IPC screenshots.delete actually fires + returns success before the toast appears (not just toast first then IPC)
    - Verify gallery state in useScreenshotIntake removes the screenshot from its local list on successful delete
    - Verify Toast-undo behavior: if user clicks Undo, the row is re-inserted (current screenshotsRepo.delete is hard delete — may need a soft-delete path for undo)
    - Surface IPC errors as a toast (currently silent on failure)
    - Unit test: mock IPC rejecting + assert the screenshot is NOT removed from gallery state (or remains + error toast appears)
- gap_id: G-05-14
  truth: |
    Clicking the expand affordance on a screenshot thumbnail opens a lightbox modal that displays the FULL-SIZE screenshot at its native resolution (~1280x720 per D-04), NOT the small ~120x90px thumbnail.
  status: diagnosed
  reason: |
    User reported: "still the images is not shown its only thumbnil not the real image that i took as screenshot"
  reason: |
    User reported: "still the images is not shown its only thumbnil not the real image that i took as screenshot". Plan 05-07 shipped the lightbox component via shadcn Dialog (commit 9465012) + the URL composition `${mediaBaseUrl}/media/${patientId}/${procedureId}/${fileName}`. But the user reports the lightbox still shows the thumbnail, not the full-size. Candidate causes:
    - The expand affordance never wires to onClick — user clicks the expand icon but nothing happens (state not propagating)
    - The lightbox opens but renders the same thumbnail src (`<img src={httpUrl} />` where httpUrl points to a different file or the thumbnail-sized version)
    - The lightbox URL composition is wrong — filePath includes the userData prefix (`data/media/patients/.../screenshots/<ts>.jpg`) and gets concatenated incorrectly to the media URL
    - The screenshot.filePath stored is relative to userData but the MediaServer expects a URL path under `/media/<patientId>/<procedureId>/<fileName>` — the fileName extraction is broken
    - The MediaServer serves the file but the lightbox CSS constraints force the <img> to a small width
    - Test masking: tests in plan 05-07 used mock-resolved URL + mock ref; real URL composition not exercised
  severity: major
  test: 7
  artifacts: []
  missing:
    - Verify the expand-icon onClick actually sets lightboxScreenshot state (test in DOM)
    - Verify the lightbox <img> src is the FULL path composed correctly (not the thumbnail src)
    - Verify the lightbox CSS allows the <img> to render at full size (max-w-7xl or similar, not constrained)
    - Verify the URL composition matches the MediaServer's `/media/` route shape
    - Verify the fileName extraction (`screenshot.filePath.replace(/^.*[\\/]/, '')`) handles Windows backslashes
    - Unit test: assert lightbox <img> src === `${mediaBaseUrl}/media/${patientId}/${procedureId}/${fileName}` (full URL, not thumbnail)
```

> **Note:** Test 7 is blocked (cascade from Test 5). Once G-05-11 is fixed, re-run Tests 6 + 7.
