# Phase 3: Capture Device Enumeration + Live Preview + Quality Presets - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-02
**Phase:** 3-capture-enumeration-live-preview
**Areas discussed:** Device picker UX, Quality preset persistence, Preview lifecycle, Settings → Capture page scope

---

## Device picker UX

| Option | Description | Selected |
|--------|-------------|----------|
| Settings-only, room is read-only | Only Settings → Capture has the picker. Procedure Room shows last-used + "Change device" link to Settings. | |
| Settings is default, room can override | Settings → Capture is persistent default. Procedure Room has its own inline dropdown that lets the doctor override for the current procedure only (not persisted as new default). | ✓ |
| Full picker always on room | Procedure Room has full device dropdown always visible. Settings → Capture shows the same. | |

**Follow-up — override scope:**
- Session-only override (selected): override applies to current procedure session only; saved default returns after Stop + new procedure.
- Per-procedure persistence (rejected): every pick becomes the new "last-used" — no default concept.
- Two distinct slots (rejected): override writes to the doctor's default; same as picking in Settings.

**Follow-up — empty state:**
- Empty preview + change CTA (selected): black preview box with "No device selected — go to Settings → Capture to pick one" + "Open Settings" button; stays on the page.
- Empty state + auto-prompt (rejected): auto-navigate to Settings blocks the procedure flow.
- Auto-pick first device (rejected): silently picks first enumerated device; doctor loses the explicit choice.

**User's choice:** Settings → Capture as persistent default + Procedure Room session-only override + inline empty-state with Open Settings CTA.

---

## Quality preset persistence

| Option | Description | Selected |
|--------|-------------|----------|
| Per-doctor global | One preset per doctor, applies to all their procedures regardless of device. | |
| Per-doctor-per-device matrix | Each (doctor, device) pair gets its own preset. Matches multi-hardware clinics. | ✓ |
| Per-clinic global | One preset per clinic, shared by all doctors. | |

**Follow-up — Custom preset fields:**
- Resolution + framerate only (selected): two inputs matching SET-02 wording exactly.
- Resolution + framerate + bitrate (rejected): bitrate is meaningless for preview; Phase 4 just reads what's saved.
- Full ffmpeg fields (rejected): five inputs — overkill for v1.

**Follow-up — first-use default:**
- Auto-detect by device name (selected): EasyCap/USB Video/CVBS/Composite → SD; HDMI/1080p/HD/Digital/DVI/UVC → HD; else HD. Saved to matrix so the heuristic fires once per (doctor, device).
- HD until changed (rejected): one extra click in the common EasyCap case.
- Force explicit pick (rejected): blocks preview on every new device.

**User's choice:** Per-doctor-per-device matrix + Custom = resolution + framerate only + device-name auto-detect default saved on first use.

---

## Preview lifecycle

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-start on room mount | Preview auto-starts when Procedure Room mounts. Snappy, immediate feedback. | |
| Manual start button | "Start Preview" button only. Explicit, extra click. | |
| Auto-start with manual stop | Auto-start with a visible "Release device" stop button. | |

**User's free-text clarification:** "after picking the device the doctor start manually when he is ready and there is stop button and finish button" — combined into a hybrid: **manual Start + visible Stop + Finish** + unmount cleanup.

**Follow-up — Finish button meaning in Phase 3:**
- Finish = leave Procedure Room (selected): closes preview, returns to Patient List. Phase 4 reuses or replaces.
- Finish = save a stub procedure (rejected): premature — no procedure table in Phase 3.
- Defer Finish to Phase 4 (rejected): user wants Finish now per the hybrid above.

**User's choice:** Manual Start Preview (button) + visible Stop Preview (button while running) + Finish (always visible — closes the room and returns to Patient List). Preview stops on unmount. Audio always off in Phase 3.

---

## Settings → Capture page scope

| Option | Description | Selected |
|--------|-------------|----------|
| Pure settings + preset preview | Dropdowns only. Procedure Room is where preview lives. | |
| Settings + live preview pane | Settings has small live preview pane that updates with device + preset. | ✓ |
| Settings + device-list refresh button | "Test device" button opens temporary preview then closes on click-away. | |

**User's choice:** "go with the best practice" — interpreted as the most defensible engineering choice for clinical users: live preview pane in Settings → Capture that updates reactively with device and preset changes. Lets the doctor verify device works before committing; catches preset misconfig (e.g. EasyCap asked for 1080p) early. Slightly more code, matches "no surprise" principle.

---

## the agent's Discretion

- Where the auto-detect heuristic lives (`src/main/capture/auto-detect-preset.ts` is the natural home; function signature and audit metadata at agent discretion)
- Framerate dropdown values (25/30/50/60 default; agent picks final set)
- Empty-state copy wording (substance locked in D-02; exact text agent-discretion)
- Preview error states for `getUserMedia` rejections (NotAllowedError / NotFoundError / OverconstrainedError / NotReadableError) — inline copy at agent discretion; behavior locked (inline, no modal)
- Whether Settings has an explicit "Refresh devices" button (default: omit; ship the simplest version per D-10)
- Audit metadata shape for `capture.preset_changed`, `capture.device_changed`, `capture.preview_started`, `capture.preview_stopped`, `capture.preview_failed` — minimum `{ deviceName, preset }`
- Verify `webPreferences: { permissions: ['media'] }` addition doesn't regress the Phase 1 security baseline
- Finish-button routing — return to the route that opened Procedure Room, or generic previous-route fallback

---

## Deferred Ideas

- **USB hot-plug detection** — v2. Phase 3 enumerates on page entry only.
- **Audio in preview / recording** — Phase 3 ships `audio: false` everywhere; recording-audio is a Phase 4 decision.
- **Audio device enumeration** — `dshow` exposes audio devices; not Phase 3 scope. Phase 4 IPC surface if needed.
- **Vendor diagnostics screen** — dump of `dshow` device list + saved matrix + auto-detect match reasoning. Useful for support; Phase 8 candidate.
- **Phase 4 device-lost during preview** — `NotReadableError` handling on `getUserMedia` is Phase 3 in-scope; recording device-lost is Phase 4.
- **Pin-hot-plug UI hint** — "If picture looks wrong, click here to run the vendor setup" documentation link per PITFALLS Integration Gotchas — Phase 7 candidate if docs surface grows.
