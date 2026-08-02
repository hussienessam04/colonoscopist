# Phase 3: Capture Device Enumeration + Live Preview + Quality Presets - Context

**Gathered:** 2026-08-02
**Status:** Ready for planning

## Phase Boundary

Ship USB capture device enumeration, live preview via `getUserMedia`, quality presets, a Settings → Capture screen with its own live preview, and a Procedure Room hero with manual Start/Stop preview controls and a Finish control that closes the room. Per-doctor last-used device and per-doctor-per-device quality preset are persisted. **Phase 3 does NOT spawn ffmpeg yet** — recording, timer, mid-procedure notes, device-lost handling, and the Procedure table all ship in Phase 4. CAPT-10 (device-name normalization) ships in Phase 3 because Phase 4 inherits the canonical form on day one.

## Implementation Decisions

### Device picker UX

- **D-01:** Two surfaces, one source of truth. Settings → Capture owns the persistent default; Procedure Room reads it and shows an inline dropdown that lets the doctor **override for the current procedure session only**. The override is **not** persisted as a new default — once the doctor leaves Procedure Room (Finish) or starts a new procedure, the saved default returns. The dropdown in Procedure Room shows "Last used: <X>" as a label above the picker; selecting a different device here changes only the active session's preview, not `settings.captures.default_device_id` — **Reversibility:** **reversible** — UI surface; setting is a single key in the `settings` table.
- **D-02:** Empty state in Procedure Room when no device is saved or the saved device isn't currently plugged in: black preview box, centered text "No device selected — go to Settings → Capture to pick one", with an inline "Open Settings" button that navigates without losing context. Stays on the Procedure Room page (does not auto-route), so the doctor can still see the page chrome and use the rest of the nav. Audit log writes a `capture.no_device` event when this state renders — **Reversibility:** **reversible** — UI surface + audit-log row.
- **D-03:** When a saved device is unplugged between sessions, Procedure Room shows the same empty state as D-02 ("No device selected…"), not a "previously used device missing" warning — keeping one empty state to one copy. The previous default remains in `settings` and resurfaces when the doctor plugs the device back in — **Reversibility:** **reversible** — the `settings` row is unchanged; behavior is purely presentational.

### Quality preset persistence

- **D-04:** Quality preset is keyed by **(doctorId, deviceName)** — a per-doctor-per-device matrix. A doctor who uses EasyCap at clinic A and HDMI at clinic B does not have to switch preset between visits — **Reversibility:** **costly** — touches `settings` table layout (a `key` shape that includes the device name), Phase 4 recorder arg-derivation, and the IPC contract for `capture.getPreset(doctorId, deviceName)` / `capture.setPreset(...)`. Switching to a per-doctor global later would orphan the matrix rows but not break the schema.
- **D-05:** `Custom` preset exposes exactly two fields: **resolution (W×H free text, e.g. `1024×768`)** and **framerate (numeric, dropdown of 25/30/50/60)**. Bitrate, pixel format, and GOP size are out of scope for Phase 3 — they are ffmpeg-only concerns that the Phase 4 agent-discretion handles via the same preset record plus default ffmpeg args — **Reversibility:** **reversible** — pure data shape in the `settings` value.
- **D-06:** First-use default for an unknown (doctor, device) pair is **auto-detected by device-name heuristics**: device-name contains `EasyCap`, `USB Video`, `USB2.0 TV`, `CVBS`, `Composite`, or `S-Video` → **SD analog (720×480 NTSC)**. Device-name contains `HDMI`, `1080p`, `HD`, `Digital`, `DVI`, or `UVC` → **HD digital (1920×1080)**. Else fallback to **HD digital**. The chosen default is then **saved** to the matrix so the heuristic only fires once per (doctor, device). If the doctor changes the preset after auto-detect, the manual choice wins permanently — **Reversibility:** **reversible** — heuristic is a function in `src/main/capture/auto-detect-preset.ts`; the saved matrix row can be deleted by the doctor to re-trigger it.

### Preview lifecycle

- **D-07:** Procedure Room has three primary controls visible at all times: **Start Preview** (visible when no preview is running), **Stop Preview** (visible when preview is running), and **Finish** (always visible). The flow is:
  1. Doctor picks a device (or accepts the saved default / last-used override)
  2. Doctor clicks **Start Preview** when ready
  3. Preview renders the live `<video>` from `getUserMedia`
  4. Doctor clicks **Stop** to release the device, or **Finish** to close the room
  5. Closing the room (Finish) or navigating away unmounts the page and the preview stream is stopped (`MediaStreamTrack.stop()` on every track) — **Reversibility:** **reversible** — UI state machine + cleanup `useEffect`.
- **D-08:** Preview always starts in `audio: false` mode. Endoscopes don't have audio; webcams may. No audio toggle ships in Phase 3 — Phase 4 will revisit whether recording picks up the system default audio or stays silent, but preview is silent regardless — **Reversibility:** **reversible** — `getUserMedia` constraint.

### Settings → Capture page scope

- **D-09:** Settings → Capture has a **live preview pane** that updates reactively as the doctor changes device or preset. Verifies device works before the doctor commits a configuration; catches preset misconfig (e.g. EasyCap asked for 1080p) early. The preview pane has its own Start/Stop controls independent of Procedure Room so the doctor can leave Settings without leaving a stream open — **Reversibility:** **costly** — touches the Settings page layout, the `useVideoPreview` hook shape (it must accept a ref or a placeholder element from any page), and possibly the IPC `capture.listDevices` call cadence (refresh on device-dropdown open).
- **D-10:** Device enumeration is performed **on app launch and on entry to either Procedure Room or Settings → Capture** (not on every render). No USB hot-plug detection in v1 — if the doctor plugs a new device mid-session, they re-enter the page to see it in the dropdown. Acceptable for v1 — clinic workflow is "arrive at workstation, plug in, open app" — **Reversibility:** **reversible** — enumeration is one IPC call; cadence is a hook config.

### Device name canonicalization (CAPT-10)

- **D-11:** Device names from `dshow` enumeration are **canonicalized once on enumeration** in main: NFC unicode normalization (so `USB` `U̇SB` collapse to the same key) + trim leading/trailing whitespace + collapse internal double-spaces to single. The canonical form is what gets stored as the `deviceId` (used everywhere — IPC, settings key, matrix row, Phase 4 ffmpeg arg) and the display form is the canonical form re-rendered (so what the doctor sees in the dropdown is exactly what ffmpeg will receive). Round-trip is exact because we never modify the canonical form downstream — **Reversibility:** **costly** — touches the `dshow` enumeration helper, the `settings` key shape, the Phase 4 ffmpeg invocation, and any saved device references in the matrix. Future "show raw device name" affordance is additive.

### the agent's Discretion

- **Where the auto-detect heuristic lives** — `src/main/capture/auto-detect-preset.ts` is the natural home; the agent decides function signature and whether to expose the matched regex group as audit metadata.
- **Framerate dropdown values** — the spec lists 25/30/50/60 as standard NTSC/PAL/EU/HD options; agent picks the final set, defaulting to 25/30 if the doctor doesn't change.
- **Empty-state copy** — substance is locked (D-02); exact wording is at agent discretion as long as the CTA is unambiguous.
- **Preview error states** — `getUserMedia` can reject with `NotAllowedError`, `NotFoundError`, `OverconstrainedError`, `NotReadableError`. The agent chooses copy for each; behavior is locked (inline error, no modal) per UX-Pitfalls table.
- **Device dropdown refresh inside the page** — D-10 locks "re-enter to refresh"; whether an explicit "Refresh devices" button is added to the dropdown header is agent-discretion. Default: omit; ship the simplest version.
- **Per-doctor `lastLoginAt` style audit metadata** — for `capture.preset_changed`, `capture.device_changed`, `capture.preview_started`, `capture.preview_stopped`, `capture.preview_failed`. Agent picks what goes in `metadata`; minimum is `{ deviceName, preset }`.
- **BrowserWindow permissions flag** — `webPreferences: { permissions: ['media'] }` per PITFALLS Integration Gotchas table; verify in Plan 03-01 that this doesn't regress the Phase 1 security baseline.
- **Where the Finish button routes** — D-07 says "back to Patient List" since the room is opened from Patient Detail; agent confirms the source route or applies a generic "previous route" fallback.

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements

- `.planning/ROADMAP.md` §Phase 3 — Goal, success criteria, pitfalls addressed, notes
- `.planning/REQUIREMENTS.md` §CAPT-01, §CAPT-02, §CAPT-03, §CAPT-10, §SET-01, §SET-02 (Traceability row)
- `.planning/PROJECT.md` §Constraints (Electron sandbox, `getUserMedia` for preview, `ffmpeg-static` for recording deferred to Phase 4), §Key Decisions (DirectShow generic capture, ffmpeg child process rationale)
- `.planning/STATE.md` §Current Focus, §Phases, §Open Questions

### Technical research (stack, pitfalls, architecture)

- `.planning/research/STACK.md` — Electron 32 + sandbox + contextIsolation (locked); ffmpeg-static deferred to Phase 4 (NOT Phase 3)
- `.planning/research/PITFALLS.md` §Pitfall 3 (device enumeration race — preview-only path; main-side ffmpeg open happens in Phase 4 with explicit sequencing), §Pitfall 10 (USB path quoting — CAPT-10; canonicalize on enumeration per D-11), §Performance Traps (per-page React re-render — use Zustand selectors with shallow equality), §Integration Gotchas (`getUserMedia` in Electron — set `BrowserWindow` permissions in constructor: `permissions: ['media']`)
- `.planning/research/ARCHITECTURE.md` — Three-process model, IPC contract pattern, project structure (Phase 3 fits the established shape)
- `.planning/research/SUMMARY.md` §Phase 3 implications (preview-only path, no ffmpeg child yet)

### Phase 1 & 2 context (carry forward)

- `.planning/phases/01-scaffold/01-CONTEXT.md` — D-01..D-08 (app identity, window defaults, security baseline)
- `.planning/phases/02-database-patient-audit-auth/02-CONTEXT.md` — D-01..D-08 (wizard, two-step login, settings table shape, audit-log-on-every-mutation, multi-field wizard, vendor recovery file deferred to Phase 8), Existing Code Insights (reusable assets and integration points)

### Skills & procedures (how to ship Phase 3)

- `.opencode/skills/electron-ffmpeg/SKILL.md` §1 (two-path architecture — Phase 3 ships the preview half only), §2 (ffmpeg-static install deferred to Phase 4), §6 (live preview in renderer — `useVideoPreview` hook pattern adapted for Phase 3's manual Start/Stop), §9 (quality presets shape — Phase 3 ships the *setting*, Phase 4 ships the ffmpeg invocation)
- `.opencode/skills/electron-vite/SKILL.md` — Three-process model, IPC contract pattern, security baseline (re-confirmed), `asarUnpack` (Phase 3 has no native binaries yet)

### Audit log integration (Phase 2 already wired)

- `src/main/db/audit.ts` — `audit_log` insert helper; Phase 3 events go through the same `recordAudit()` helper per Phase 2 D-02 pattern

## Existing Code Insights

### Reusable Assets

- `src/shared/ipc-contract.ts:IpcContract` — Phase 3 extends with `capture: { listDevices, getPreset, setPreset, getDefaultDevice, setDefaultDevice, previewEvent }`. `IPC` constant grows with `CAPTURE_LIST_DEVICES`, `CAPTURE_GET_PRESET`, `CAPTURE_SET_PRESET`, `CAPTURE_GET_DEFAULT`, `CAPTURE_SET_DEFAULT`. Never invents a new bridge shape — follows Phase 2's typed-contract pattern.
- `src/main/paths.ts:dataDir()` — already wraps `userData/data`; no new path helpers needed for Phase 3 (the matrix lives in the `settings` key/value table).
- `src/preload/index.ts:api` — contextBridge exposure point; Phase 3 extends the `api` object with the `capture` namespace.
- `src/renderer/src/components/ui/{select,dropdown-menu,button,label,card}.tsx` — shadcn primitives already installed; Phase 3 reuses for both surfaces (device dropdown + Settings page). `dialog.tsx` available if Settings needs a confirmation modal.
- `src/renderer/src/lib/router.ts:Route` — state-based router; Phase 3 adds `'procedure-room'`, `'procedure-room-new'` (or single `'procedure-room'` with patientId in the route payload), and `'settings-capture'`.
- `src/renderer/src/store/session.ts` — Zustand session store; Phase 3 may add a small `useCapturePreview` store (or stay component-local) for `selectedDevice` / `isPreviewing` state.
- `src/main/db/audit.ts:recordAudit()` — Phase 3 reuses for all `capture.*` audit events.
- `src/main/startup-log.ts` — boot log; Phase 3 may add `capture-devices-enumerated` event (count + first deviceName prefix for verification).

### Established Patterns

- **Typed IPC contract via contextBridge** — every renderer-callable method is defined once in `src/shared/ipc-contract.ts`. Phase 3 extends, never invents.
- **One-way renderer → main for mutations, optimistic UI avoided** — renderer awaits the IPC round-trip; preview state lives in the renderer only.
- **Audit-on-every-mutation** — `recordAudit({ action: 'capture.preset_changed', entityType: 'capture', entityId: doctorId+deviceName, metadata: { ... } })` for every preset/device change and preview start/stop/fail.
- **No `any` in IPC contracts** — TS strict mode continues; per-method arg + return types on `IpcContract`.
- **Settings table key/value store** — `settings.key`, `settings.value` (JSON string). Phase 3 keys: `capture.default_device_id` (doctorId-keyed), `capture.preset.<deviceName>` (doctorId-keyed value: `{ preset: 'sd'|'hd'|'custom', resolution?: string, framerate?: number }`). Phase 2 already established this pattern for clinic name + admin-recovery-flag.
- **Empty-state inline message, no modal** — UX-Pitfalls table forbids modals during a procedure. Phase 3's "no device selected" empty state is inline (D-02).

### Integration Points

- `src/main/window.ts` — add `permissions: ['media']` to `webPreferences` so sandboxed renderer can call `getUserMedia` (per PITFALLS Integration Gotchas). Verify the security baseline isn't disturbed.
- `src/main/index.ts` — Phase 3 wires `initCapture()` (device enumeration cache + audit subscription) → `registerCaptureIpc()` → renderer routes after `registerPatientsIpc()`. Capture must register AFTER patients so the audit infrastructure is ready.
- `src/preload/index.ts` — `api` object grows with `capture: { ... }`.
- `src/renderer/src/App.tsx` — route cases for `'procedure-room'` and `'settings-capture'`; both gated behind `status.authenticated` (existing pattern).
- `src/renderer/src/lib/router.ts` — `Route` union grows.
- `src/shared/ipc-contract.ts` — `IPC` constant + `IpcContract` interface grow.
- `src/main/db/migrations.ts` — Phase 2 migrations already include the `settings` table; Phase 3 does NOT add a migration unless the matrix key shape needs an index (agent-discretion — start without; add if a measured query is slow).

## Specific Ideas

- **Per-doctor-per-device matrix as a `settings` key shape**: `capture.preset.<doctorId>.<deviceName>` → JSON `{ preset: 'sd'|'hd'|'custom', resolution?: string, framerate?: number }`. The key is human-readable in audit metadata and survives DB inspection by the vendor.
- **Auto-detect heuristic**: pure function `autoDetectPreset(deviceName: string): 'sd' | 'hd'` — easy to unit test, easy to extend (add more patterns without touching UI).
- **Live preview pane in Settings** uses the same `useVideoPreview` hook as Procedure Room (single source of truth for the `<video>` lifecycle).
- **"Last used: <X>"** label above the Procedure Room dropdown clarifies that the override is session-only — preventing the doctor from wondering "did this save?"
- **Empty-state CTA** navigates without clearing session: `navigate({ name: 'settings-capture' })` then on return to Procedure Room the saved default is re-read.
- **Finish button** mirrors PowerPoint's "End slideshow" affordance — explicit close, no implicit exit. Doctor presses Finish when they're done previewing; preview stream stops and route navigates back.

## Deferred Ideas

- **USB hot-plug detection** — deferred to v2. Phase 3 enumerates on page entry; doctors who plug a device mid-session re-enter the page. Acceptable per clinic workflow.
- **Audio in preview / recording** — Phase 3 ships `audio: false` everywhere; Phase 4 may revisit audio source for recordings, but preview stays silent. Recording-audio decision is Phase 4 scope.
- **Audio device enumeration** — `dshow` exposes audio devices too; not in Phase 3 scope. ffmpeg child invocation in Phase 4 may need `audio="<name>"` arg for some clinics; that's a Phase 4 IPC surface.
- **Per-doctor `lastLoginAt` style audit row for `capture.preview_started`** — agent-discretion; the matrix-style audit metadata in D-11 records device + preset + timestamp. No separate `last_preview_at` column.
- **Vendor diagnostics screen** — dump of `dshow` device list + saved matrix + auto-detect match reasoning. Useful for support; out of Phase 3 scope; could ship in Phase 8 alongside license tools.
- **Phase 4 device-lost during preview** — preview stream will die if device disconnects; UX is `NotReadableError` handling on `getUserMedia`, which is in-scope for Phase 3 but the device-lost **recording** scenario is Phase 4.

---

*Phase: 3-capture-enumeration-live-preview*
*Context gathered: 2026-08-02*
