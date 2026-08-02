---
status: testing
phase: 03-capture-enumeration-live-preview
source:
  - .planning/phases/03-capture-enumeration-live-preview/03-01-SUMMARY.md
  - .planning/phases/03-capture-enumeration-live-preview/03-02-SUMMARY.md
  - .planning/phases/03-capture-enumeration-live-preview/03-03-SUMMARY.md
started: 2026-08-02T19:30:00Z
updated: 2026-08-02T19:50:00Z
status: testing
---

## Current Test

number: 1
name: Real Windows DirectShow enumeration matches canonical names
expected: |
  On a Windows machine with an EasyCap SD or HDMI/DVI capture card plugged in,
  the Settings → Capture device dropdown shows the actual USB DirectShow device
  name (e.g. "USB Video Device", "EasyCap", "USB2.0 TV") AND the live preview
  opens using the matching browser deviceId from mediaDevices.enumerateDevices().
awaiting: user response

## Tests

### Auto-passed entries (coverage classifier — recorded as pass, NOT presented)

### A1. canonicalizeName() + canonicalizeOrThrow() — single boundary for all device identity (D1)
expected: Single source of truth for device names; NFC + zero-width + whitespace collapse + trim; empty canonical result throws
result: pass
source: automated
coverage_id: D1

### A2. noDeviceAudit IPC sink writes a capture.no_device audit row when the renderer empty state renders (D4)
expected: Renderer empty state → main writes audit row with session-scoped doctorId
result: pass
source: automated
coverage_id: D4

### A3. autoDetectPreset returns SD/HD/fallback with first-matching regex wins (P3-V3)
expected: EasyCap → SD 720×480; HDMI → HD 1920×1080; unknown → HD fallback; first regex wins
result: pass
source: automated
coverage_id: P3-V3

### A4. presetRepo round-trips per-doctor default + per-(doctor, device) preset matrix (P3-V4)
expected: Doctor isolation + device isolation; canonicalization on write; corrupt-row defensive read
result: pass
source: automated
coverage_id: P3-V4

### A5. Every capture.* IPC mutation writes an audit row; first-save emits `matched` regex metadata (P3-V5)
expected: BLOCKER 4 (doctorId from requireSession) + BLOCKER 5 (no-device sink) proven
result: pass
source: automated
coverage_id: P3-V5

### A6. IpcContract.capture shape matches preload bridge; no doctorId in setPreset / setDefaultDevice (P3-V7)
expected: BLOCKER 4 payload check; SettingsCapture is the only setDefaultDevice caller; useCaptureDeviceMap is the only enumerateDevices consumer
result: pass
source: automated
coverage_id: P3-V7

### A7. Phase 3 scope guards: no MediaRecorder, capture:start, capture:stop, .mp4 paths (P3-V8)
expected: Static-analysis guard proves Phase 4 leakage into Phase 3 scope is caught at test time
result: pass
source: automated
coverage_id: P3-V8

### A8. useVideoPreview opens getUserMedia only after Start, releases every track on Stop + unmount + device change (P2-H1)
expected: Stream lifecycle is correct across all transition paths; no leaked handles
result: pass
source: automated
coverage_id: P2-H1

### A9. useVideoPreview maps the 4 getUserMedia error classes (NotAllowed/NotFound/Overconstrained/NotReadable) to typed PreviewError (P2-H2)
expected: Inline error states for all 4 error classes; no modal dialog
result: pass
source: automated
coverage_id: P2-H2

### A10. useCaptureDeviceMap enumerates BOTH dshow (via IPC) and mediaDevices (via browser API); label-based bridge (P2-H3)
expected: Bridge resolves the matching browser deviceId for each dshow canonical name
result: pass
source: automated
coverage_id: P2-H3

### A11. Procedure Room picker change does NOT call setDefaultDevice or setPreset — session-only override (P2-P2)
expected: Override applies to current procedure session only; saved default is unchanged
result: pass
source: automated
coverage_id: P2-P2

### A12. Settings → Capture hydrates saved default + preset on mount, surfaces "Last used: …" (P2-S1)
expected: Doctor sees their previous settings immediately on entry; label is "Last used: <X>"
result: pass
source: automated
coverage_id: P2-S1

### A13. Settings → Capture re-opens getUserMedia when device or preset changes (P2-S2)
expected: BLOCKER 6 — preview reacts live without manual re-start
result: pass
source: automated
coverage_id: P2-S2

### A14. Settings → Capture Save calls setDefaultDevice + setPreset with no `doctorId` field (P2-S3)
expected: BLOCKER 4 enforced at the renderer; payloads omit doctorId
result: pass
source: automated
coverage_id: P2-S3

### A15. Settings → Capture renders SD/HD/Custom radio + Custom resolution+framerate fields with 25/30/50/60 (P2-S4)
expected: SET-02 UI exactly as specified — no bitrate/pixel-format/GOP controls
result: pass
source: automated
coverage_id: P2-S4

### A16. Settings → Capture renders inline validation error and disables Save when Custom resolution is malformed (P2-S5)
expected: W×H format validated client-side; Save disabled until valid
result: pass
source: automated
coverage_id: P2-S5

### A17. Settings → Capture does NOT re-enumerate on preset or device change (P2-S6)
expected: D-10 — enumeration cadence is page entry only, not on every change
result: pass
source: automated
coverage_id: P2-S6

### Human UAT checkpoints (coverage classifier — present[] entries)

### 1. Real Windows DirectShow enumeration matches canonical names (P3-V1, P3-V2, D2)
expected: |
  On a Windows machine with EasyCap SD or HDMI/DVI capture card plugged in:
  - Settings → Capture device dropdown shows the actual USB DirectShow device name
  - The live preview opens using the matching browser deviceId
  - Names with non-ASCII chars / spaces / trailing whitespace display cleanly and consistently
  - EasyCap → first-use preset is SD analog 720×480
  - HDMI/DVI → first-use preset is HD digital 1920×1080
result: [pending]

### 2. Procedure Room empty state with Open Settings CTA + capture.no_device audit row (P2-P1)
expected: |
  With no saved device OR with saved device unplugged:
  - Black inline preview box appears
  - "No device selected — go to Settings → Capture to pick one" message
  - "Open Settings" button visible, navigates without losing Procedure Room context
  - `capture.no_device` row written to audit_log with session userId
result: [pending]

### 3. Procedure Room Start / Stop / Finish lifecycle releases hardware handles (P2-P3)
expected: |
  - Click Start Preview → live preview opens with selected browser deviceId
  - Click Stop Preview → stream tracks stopped, device released
  - Click Finish → close room, return to previous route (or Patient List fallback)
  - Navigate away while preview running → device indicator released (no leaked handle)
result: blocked
blocked_by: prior-issue
reason: "Cannot test Start/Stop/Finish lifecycle until Settings → Capture device dropdown is fixed (Test 1, Test 2)."

### 4. Settings preview pane reacts to preset change without manual re-start (BLOCKER 6 — Q-C; covered by P2-S2 but worth end-to-end visual confirmation)
expected: |
  - Change device dropdown → preview re-opens with new device constraints
  - Change preset radio → preview re-opens with new constraints
  - Click Save → only then is setDefaultDevice + setPreset called
  - Leave page without Save → no settings mutation
result: blocked
blocked_by: prior-issue
reason: "Settings → Capture device picker is the entry point; cannot test reactive preview until it renders."

### 5. Disabled Record button remains disabled; no video file created (Phase 4 boundary)
expected: |
  - Record button visible in Procedure Room but visibly disabled
  - No mp4 file written anywhere on disk during preview
  - No ffmpeg recording child process spawned
result: blocked
blocked_by: prior-issue
reason: "Procedure Room depends on Settings → Capture device selection to test the recording-disabled boundary."

### 6. Session-only override behavior in Procedure Room (D-01)
expected: |
  - Saved default is X
  - Open Procedure Room → picker shows X
  - Switch to Y in the room → preview uses Y
  - Click Finish, re-enter Procedure Room → picker shows X again (not Y)
result: blocked
blocked_by: prior-issue
reason: "Session-only override dropdown in Procedure Room requires Settings → Capture to set the default first."

### 7. useRoute() previous-route snapshot for Finish navigation (Q-B, P2-R1)
expected: |
  - Open Procedure Room from Patient Detail
  - Click Finish → returns to Patient Detail (not patients list)
  - Open Procedure Room directly via deep-link
  - Click Finish → falls back to {name: 'patients'}
result: blocked
blocked_by: prior-issue
reason: "Procedure Room entry point depends on Settings → Capture device flow being reachable."

### 8. Permission flow on Windows — camera permission prompt + indicator (BLOCKER 3 — D5)
expected: |
  - First preview launch on Windows shows camera permission prompt
  - On approval, OS camera indicator turns on
  - WebPreferences has all five flags intact (verified via test, but worth human confirmation)
result: blocked
blocked_by: prior-issue
reason: "Permission flow only triggers when preview actually starts; depends on Settings → Capture device UI being reachable."

### 9. Real hardware auto-detect heuristic match (SET-02, D6)
expected: |
  - Plug EasyCap → first-use preset auto-saves as SD 720×480
  - Plug HDMI capture → first-use preset auto-saves as HD 1920×1080
  - Generic webcam with no clear markers → first-use preset is HD fallback
  - Manual override persists over auto-detect
result: blocked
blocked_by: prior-issue
reason: "Auto-detect surface is Settings → Capture; cannot test heuristic until device picker renders."

## Summary

total: 26
passed: 17
issues: 0
pending: 2
skipped: 0
blocked: 7

## Gaps

- gap_id: G-03-1
  truth: "Settings → Capture shows a device dropdown populated from DirectShow enumeration and the live preview opens with the matching browser deviceId"
  status: resolved
  resolved_by: 03-04-PLAN.md (executed 2026-08-02)
  resolved_at: 2026-08-02
  original_reason: "User reported: thats not exist in settings Capture device dropdown"
  severity: major
  test: 1

- gap_id: G-03-2
  truth: "Settings → Capture page exposes the device picker UI and all Phase 3 user-visible capture surfaces"
  status: resolved
  resolved_by: 03-04-PLAN.md (executed 2026-08-02)
  resolved_at: 2026-08-02
  original_reason: "User reported: settings doesnt contain anything related to device you need to fix that first so we can work in the tests"
  severity: major
  test: 2

## Deferred Follow-Ups

[none yet]
