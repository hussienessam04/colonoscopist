---
status: partial
phase: 05-screenshots-procedure-review-trim
source: [05-01-SUMMARY.md, 05-02-SUMMARY.md, 05-03-SUMMARY.md, 05-04-SUMMARY.md, 05-UAT.md (hardware smoke)]
started: 2026-08-07T11:50:00.000Z
updated: 2026-08-07T11:55:00.000Z
---

## Current Test

[testing complete]

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
result: issue
reported: "i got this toast Failed to execute 'toBlob' on 'HTMLCanvasElement': Tainted canvases may not be exported."
severity: blocker

### 4. Click a thumbnail to seek
expected: |
  Click the first thumbnail (~10s). <video> seeks to ~10s — progress fill jumps to ~33% of track width, playhead timestamp label updates, frame freezes on the captured frame. Click-to-seek is one-way; video does NOT auto-resume (doctor clicks Play to resume).
result: blocked
blocked_by: prior-test
reason: "i cant do this test becuase of the screenshoot error"
note: Cascading from Test 3 (tainted canvas — no thumbnails were created). Re-run after fixing Test 3.

### 5. Trim 5s–25s
expected: |
  Click Trim button (scissors icon) in right rail. Two handles + red-shaded cut region appear on scrubber. Drag in-handle to 5s, out-handle to 25s. Right rail labels: "In: 00:00:05 · Out: 00:00:25". Cut region is shaded red. Click Apply. Spinner replaces Apply button for ~1–5s. On completion: toast "Trim applied" appears, <video> reloads to trimmed clip (~20s long), procedure.videoPath points to trimmed sibling, videoPathOriginal preserved (first-trim-only COALESCE guard).
result: issue
reported: "Trim failed: Error invoking remote method 'procedures:trim': Error: Source video missing at data/media/patients/88147c14-658c-440a-badf-e0707f52acb7/116315a0-355f-4f7f-8c88-75ed80510524/video.mp4"
severity: blocker

### 6. Verify the trimmed mp4 plays
expected: |
  Right rail shows Restore original enabled (videoPathOriginal populated). Click Play. Video plays the trimmed 20s segment (5s–25s of original, ±500ms tolerance per -ss before -i -c copy tradeoff). No "mp4 won't play" error. Trimmed clip ends before original would have ended.
result: blocked
blocked_by: prior-test
reason: "i cant do this test also because of the previous error"
note: Cascading from Test 5 (trim subprocess failed because source mp4 is missing on disk).

### 7. Restore and verify the original
expected: |
  Click Restore original. Spinner replaces Restore button briefly. <video> reloads to original (untrimmed) recording at videoPathOriginal. Click Play. Video plays the full 30-second original. restoreFromOriginal is idempotent — calling again is a no-op. videoPathOriginal column preserved against future trims.
result: blocked
blocked_by: prior-test
reason: "the same i cant test"
note: Cascading from Test 5 (no videoPathOriginal because Trim never ran).

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
passed: 2
issues: 2
pending: 0
skipped: 0
blocked: 3

coverage_automated: 22 of 22 phase deliverables auto-passed (484/484 unit tests across 62 files)

## Gaps

```yaml
- gap_id: G-05-3
  truth: |
    Clicking +Capture during playback successfully saves a JPEG screenshot from the current <video> frame to <userData>/data/media/patients/<id>/<procedureId>/screenshots/<ts>.jpg and the thumbnail appears in the timeline without errors.
  status: failed
  reason: |
    User reported: "Failed to execute 'toBlob' on 'HTMLCanvasElement': Tainted canvases may not be exported."
    Root cause hypothesis: <video> element loads the recorded mp4 from http://127.0.0.1:<random>/media/... (MediaServer route, Plan 03). The MediaServer does NOT send CORS headers (Access-Control-Allow-Origin), so the <video> source is treated as cross-origin by Chromium. canvas.drawImage(<video>, ...) taints the canvas, and toBlob() throws because of the tainted-canvas security guard. Same root cause likely affects any future canvas-from-<video> path.
  severity: blocker
  test: 3
  artifacts: []
  missing:
    - CORS headers on MediaServer /media/ responses (Access-Control-Allow-Origin: * OR Access-Control-Allow-Origin: http://127.0.0.1:<rendererPort>)
    - crossOrigin='anonymous' on <video> element (or crossorigin attribute) so Chromium treats the source as CORS-accessible
    - Or alternative: switch to a non-canvas capture path (e.g., one-shot ffmpeg `image2` muxer write via IPC)
- gap_id: G-05-5
  truth: |
    Clicking Apply in the Trim panel runs ffmpeg against the canonical mp4 path stored in procedures.video_path and produces a trimmed sibling file. video_path_original is preserved (first-trim-only COALESCE).
  status: failed
  reason: |
    User reported: "Trim failed: Error invoking remote method 'procedures:trim': Error: Source video missing at data/media/patients/88147c14-658c-440a-badf-e0707f52acb7/116315a0-355f-4f7f-8c88-75ed80510524/video.mp4"
    The recording flow (Test 2) reportedly succeeded (preview appeared, timer ticked, Stop finalized). But the canonical mp4 at the proceduresRepo.updateVideoPath resolution path does not exist on disk. Possible causes:
    - Stop finalization failed to write video.mp4 at the expected location (file written elsewhere — e.g., as a segment file, or as <procedureId>/video-segment-0.mp4 + concat never ran)
    - procedures.video_path was set to a stale path that points to a file the recording pipeline never wrote
    - The path resolution in trim.ts resolves to <userData>/data/media/.../video.mp4 but the actual file is at a different name (e.g., video-partial.mp4 + .partial suffix for partial status, or video-segment-0.mp4)
    - Test 2 should be re-examined: did the Stop click actually finalize the procedure with status='completed' AND rename the segment files into the canonical video.mp4? Or did it leave the procedure as 'partial'?
  severity: blocker
  test: 5
  artifacts: []
  missing:
    - Verify recording finalize pipeline writes canonical video.mp4 to <userData>/data/media/patients/<id>/<procedureId>/video.mp4 on Stop (status='completed')
    - Or: applyTrim should fall back to the partial mp4 if status='partial' and canonical is missing (with appropriate audit)
    - Or: surface a clearer error indicating which paths were searched + what statuses the procedure row has + what files actually exist in the procedure dir
- gap_id: G-05-7
  truth: |
    After a successful Trim, Restore original re-points <video> to video_path_original and the procedure plays the full original recording.
  status: failed
  reason: |
    Test 7 blocked by Test 5 — videoPathOriginal was never populated because Trim never succeeded. Once G-05-5 is resolved, this test should re-run as part of the gap-closure verification.
  severity: major
  test: 7
  artifacts: []
  missing: []
  blocked_by: G-05-5
```
