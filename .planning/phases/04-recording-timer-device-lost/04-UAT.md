---
status: complete
phase: 04-recording-timer-device-lost
source:
  - 04-01-SUMMARY.md
  - 04-02-SUMMARY.md
  - 04-03-SUMMARY.md
  - 04-04-SUMMARY.md
started: 2026-08-05T15:00:00.000Z
updated: 2026-08-06T19:30:00.000Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: App boots; `_migrations` table contains row `0002_procedures`; no console errors at startup; `window.api.procedures.list` and `window.api.procedureNotes.list` are exposed.
result: pass

### 2. Procedure Room: Record button enabled
expected: With a session active and a capture device selected in Settings → Capture, the Procedure Room shows an enabled Record button (not greyed out).
result: pass

### 3. Clicking Record spawns ffmpeg
expected: Click Record. ffmpeg-static child process spawns, the procedure row is created with `status='recording'`, a `recording.start` audit row is written. Live preview continues in the corner.
result: pass

### 4. HH:MM:SS timer ticks
expected: Timer in the Procedure Room starts at `00:00:00` on Record click, ticks up once per second, format is `HH:MM:SS`.
result: pass

### 5. Stop finalizes + navigates to procedure-review
expected: Click Stop. `recording.stop` audit row written. App navigates to the `procedure-review` placeholder page showing the procedure row.
result: pass

### 6. Procedure Review placeholder renders
expected: After Stop, the review page shows the procedure row's metadata (patient name, doctor, status badge). Banner reads "Review + trim land in Phase 5".
result: pass

### 7. Notes panel mounted in side-rail
expected: In the Procedure Room, a notes panel is visible in the right-hand side-rail with a textarea and a Save button.
result: pass

### 8. Save note creates row, appends chronologically
expected: Type a note, click Save. The note appears at the bottom of the list. A `procedure.note_added` audit row is written (metadata has `bodyLength`, not the body content).
result: pass

### 9. Empty body disables Save
expected: With the textarea empty or whitespace-only, the Save button is disabled. No IPC call fires on click.
result: pass

### 10. Over-length body rejected
expected: Paste >1000 characters into the textarea and click Save. An inline error appears, no row is created. The DB CHECK constraint enforces this even if the renderer pre-check is bypassed.
result: pass

### 11. Pause/Resume button appears
expected: Mid-recording, a Pause button appears between the Record/Stop button and the notes panel. Click Pause → it becomes Resume.
result: pass

### 12. Pause freezes HH:MM:SS
expected: After Pause, the HH:MM:SS timer stops ticking and holds the elapsed value. Click Resume → timer continues from that value.
result: pass
note: User clarified: behavior was intentional, not a bug

### 13. Pause #N chip after multiple pauses
expected: After the second or later pause cycle, a `Pause #N` chip renders below the timer.
result: pass

### 14. Final mp4 is single file
expected: After Stop (with or without pauses), a single canonical `video.mp4` exists in the procedure's media directory. Multiple pauses produce segment files that are concatenated; no pauses produce a rename from `video-seg0.mp4`.
result: pass

### 15. Disconnect capture card → DeviceLostBanner appears
expected: Unplug the USB capture card mid-recording. Within ~5s an inline destructive Alert appears in the side-rail with the text "Capture device disconnected" and "Recording preserved up to HH:MM:SS (device: <name>)".
result: pass

### 16. Banner HH:MM:SS is the partial duration
expected: The HH:MM:SS in the banner reflects the time before the device was disconnected (not 00:00:00).
result: pass

### 17. Stop after device-lost finalizes as `partial`
expected: With the banner showing, click Stop. The procedure row's status becomes `partial`. The `video_path` is rewritten to `<segment>.partial.mp4`. A `recording.stopped` audit row with `metadata.partial: true` is written.
result: pass

### 18. ProcedureReview shows partial Alert
expected: Navigate to the review page for a `partial` procedure. A full `<Alert variant='destructive'>` shows the title "Partial recording" and the recovery hint.
result: pass

### 19. scanForOrphans on next launch
expected: With a `*.partial.mp4` left in `<userData>/data/media/patients/<p>/<proc>/` from a previous session, kill the app, relaunch. A `recording.crash_partial` audit row is written. Re-running scanForOrphans does not write a duplicate (idempotent via fingerprint).
result: pass

### 20. ffmpeg binary loads from asarUnpack
expected: With the app packaged (or `npm run build:win` and install), ffmpeg-static binary loads from `app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.exe`. Recording works in the packaged build.
result: pass

## Summary

total: 20
passed: 20
issues: 0
pending: 0
skipped: 0

## Gaps

```yaml
- gap_id: G-04-1
  truth: "App boots from a cold start; out/main/index.js resolves '../db/procedures-repo' inside buildDefaultDeps; main window opens without unhandled promise rejection; procedures.get + procedureNotes.list IPC channels respond."
  status: resolved
  resolved_by: 8d31e94
  resolved_at: 2026-08-05
  reason: "User reported: npm run dev fails at runtime with `Error: Cannot find module '../db/procedures-repo'` originating from buildDefaultDeps in out/main/index.js:2938, called by initRecorder at line 3059. Electron main process throws unhandled promise rejection and the app does not boot."
  severity: blocker
  test: 1
  artifacts: []
  missing: []
  root_cause: "Lazy `require('../db/procedures-repo')` (and two siblings) inside src/main/recorder/recorder.ts:buildDefaultDeps were preserved as runtime require calls in the bundled out/main/index.js. The relative paths are correct for the source layout but resolve incorrectly after bundling because the bundle is a single file at out/main/index.js — no out/main/db/ or out/main/recorder/ subdirs exist. No actual circular dep exists between recorder and the db modules; the lazy require was defensive code, not required."
  debug_session: .planning/debug/cold-start-require-failure.md
  fix: "Hoist proceduresRepo, audit, defaultFfmpegPath to top-level ES imports in src/main/recorder/recorder.ts; the bundler inlines them into the single output file, eliminating the runtime require."
- gap_id: G-04-2
  truth: "Clicking Record in the Procedure Room spawns ffmpeg-static, creates a procedure row with status='recording', and the recording continues until the user clicks Stop. Live preview continues. Procedure does NOT immediately finalize as 'partial' with 00:00:00 duration unless the device is genuinely disconnected."
  status: resolved
  resolved_by: "phase-4-pause-resume-stop-broke, phase-4-preview-and-stop-partial, phase-4-preview-pause-stop-err, phase-4-fsync-windows-eperm"
  resolved_at: 2026-08-06
  reason: "User reported: clicking Record immediately navigates to ProcedureReview showing 'Partial recording' destructive Alert with 'Recording stopped because the capture device disconnected. The mp4 was preserved up to 00:00:00.' Started and ended timestamps are the same minute (12:25:41). The DEVICE_LOST_RE detection is firing on a healthy device, OR ffmpeg-static is failing to start and the supervisor is misclassifying the failure as device-lost."
  severity: blocker
  test: 3
  artifacts: []
  missing: []
  root_cause: "Multi-layered. The 9s auto-pause was the startWatchdog (10s) never being cleared on the starting→recording transition; the partial status on clean Stop was Windows EPERM from fsync on a read-only handle; live preview during recording required tee'ing MJPEG from the same ffmpeg child that holds the DirectShow device."
  debug_session: .planning/debug/resolved/phase-4-fsync-windows-eperm.md
  fix: "Multiple fixes via debug sessions: cleared startWatchdog on first frame=; gated fsync catch on ENOENT (only file-missing downgrades status); added preview-server.ts + ffmpeg MJPEG tee; extracted RecordingControlsBar overlay; added FramingGuide + RecIndicator overlays; added keyboard shortcuts (Space/Esc/R)."
```
