---
phase: 3
slug: capture-enumeration-live-preview
status: draft
nyquist_compliant: false
wave_0_complete: true
created: 2026-08-02
wave_0_completed: 2026-08-02
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.1.9 (Electron-as-Node runner via `scripts/run-vitest.cjs`) |
| **Config file** | `vitest.config.ts` (includes tests/main, tests/renderer, tests/shell, tests/integration) |
| **Quick run command** | `npm run test:unit -- tests/main/capture tests/renderer/hooks` |
| **Full suite command** | `npm run test:unit` |
| **Estimated runtime** | ~12 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:unit -- tests/main/capture tests/renderer/hooks`
- **After every plan wave:** Run `npm run test:unit`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Automated Gate Status (Wave 0)

| Gate | Command | Result | Captured |
|------|---------|--------|----------|
| Unit suite | `npm run test:unit` | 189/189 passed across 31 test files | 2026-08-02 |
| Renderer typecheck | `npm run typecheck:web` (`tsc --noEmit -p tsconfig.web.json`) | exit 0 | 2026-08-02 |
| Node typecheck | `npm run typecheck:node` (`tsc --noEmit -p tsconfig.node.json`) | exit 0 | 2026-08-02 |
| Production build | `npm run build` (`electron-vite build`) | exit 0 (main + preload + renderer) | 2026-08-02 |

**Wave 0 verdict:** automated gates pass. Wave 0 file existence + automated coverage verified; human UAT (BLOCKER 1 hardware proof) deferred to Task 03-03-03.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | CAPT-01 | T-3-01 / A5 | Spawn dshow enumeration; canonicalize output | unit (mock spawn) | `npm run test:unit -- tests/main/capture/devices.test.ts` | ✅ W0 | ✅ pass |
| 03-01-02 | 01 | 1 | CAPT-10 | T-3-01 | Canonical name round-trips through ffmpeg arg | unit | `npm run test:unit -- tests/main/capture/canonicalize.test.ts` | ✅ W0 | ✅ pass |
| 03-01-03 | 01 | 1 | SET-02 | — | `autoDetectPreset()` SD/HD regex classification | unit | `npm run test:unit -- tests/main/capture/auto-detect-preset.test.ts` | ✅ W0 | ✅ pass |
| 03-01-04 | 01 | 1 | CAPT-02, SET-01, SET-02 | T-3-02 | `settings` k/v read/write round-trip for default + matrix | unit | `npm run test:unit -- tests/main/capture/preset-repo.test.ts` | ✅ W0 | ✅ pass |
| 03-01-05 | 01 | 1 | AUDIT-01 | T-3-04 | Every `capture.*` mutation writes canonical-name audit row | integration | `npm run test:unit -- tests/main/capture/audit-trace.test.ts` | ✅ W0 | ✅ pass |
| 03-01-06 | 01 | 1 | — | T-3-05 | Security baseline preserved (permissions: ['media'] added) | smoke | `npm run test:unit -- tests/shell/security-baseline.test.ts` | ✅ W0 | ✅ pass |
| 03-02-01 | 02 | 1 | CAPT-03 | T-3-03 | `useVideoPreview` starts/stops MediaStream on mount/unmount | unit (happy-dom) | `npm run test:unit -- tests/renderer/hooks/use-video-preview.test.ts` | ✅ W0 | ✅ pass |
| 03-02-02 | 02 | 1 | CAPT-03 | T-3-03 | `useVideoPreview` rejects all four error classes to local state | unit | `npm run test:unit -- tests/renderer/hooks/use-video-preview.test.ts` | ✅ W0 | ✅ pass |
| 03-02-03 | 02 | 1 | D-01, D-07, D-02 | T-3-04 | Procedure Room renders controls + empty state | component | `npm run test:unit -- tests/renderer/pages/procedure-room.test.tsx` | ✅ W0 | ✅ pass |
| 03-02-04 | 02 | 1 | D-09, D-10 | T-3-04 | Settings → Capture renders live preview pane | component | `npm run test:unit -- tests/renderer/pages/settings-capture.test.tsx` | ✅ W0 | ✅ pass |
| 03-03-01 | 03 | 2 | All | — | Vitest full suite + typecheck green | suite | `npm run test:unit && npm run typecheck` | ✅ existing | ✅ pass |
| 03-03-02 | 03 | 2 | CAPT-01..03 | A5 | Manual smoke test on Windows bench enumerates + previews | manual | `/gsd-verify-work 3` UAT | n/a | ⬜ pending human UAT |

---

## Requirement Coverage (Phase 3)

| Requirement | Description | Plan(s) | Automated Coverage | Status |
|-------------|-------------|---------|-------------------|--------|
| CAPT-01 | Auto-enumerate USB DirectShow video devices on launch | 03-01, 03-03 | `tests/main/capture/devices.test.ts` (mock spawn) — VIDEO-only parser + canonical names | ✅ automated |
| CAPT-02 | Per-doctor default device remembered across procedures | 03-01, 03-03 | `tests/main/capture/preset-repo.test.ts` — doctor-isolated k/v round-trip | ✅ automated |
| CAPT-03 | Live preview via `getUserMedia` decoupled from recorder | 03-02 | `tests/renderer/hooks/use-video-preview.test.ts` — start/stop on unmount + 4 error classes | ✅ automated |
| CAPT-10 | Device names with non-ASCII / embedded spaces round-trip through ffmpeg dshow | 03-01, 03-03 | `tests/main/capture/canonicalize.test.ts` (NFC + zero-width + whitespace collapse) + `devices.test.ts` parser round-trip | ✅ automated |
| SET-01 | User picks default capture device from Settings → Capture | 03-01, 03-02 | `tests/main/capture/preset-repo.test.ts` + `tests/renderer/pages/settings-capture.test.tsx` (Save calls `setDefaultDevice` with no `doctorId`) | ✅ automated |
| SET-02 | User picks quality preset (SD / HD / custom) | 03-01, 03-02, 03-03 | `tests/main/capture/auto-detect-preset.test.ts` (SD/HD regexes + fallback) + `tests/renderer/pages/settings-capture.test.tsx` (SD/HD/Custom radio + framerate 25/30/50/60) | ✅ automated |
| AUDIT-01 | Every `capture.*` mutation writes a canonical-name audit row | 03-01, 03-03 | `tests/main/capture/audit-trace.test.ts` — BLOCKER 4 + Q-A + `capture.no_device` empty-state | ✅ automated |
| BLOCKER 3 | Security baseline preserved with `permissions: ['media']` | 03-01, 03-03 | `tests/shell/security-baseline.test.ts` — five-flag webPreferences assertion | ✅ automated |
| BLOCKER 4 | Session-scoped `doctorId`; renderer cannot impersonate another doctor | 03-01, 03-03 | `tests/main/capture/audit-trace.test.ts` (smuggled `doctorId` ignored) + `tests/integration/renderer-main-capture-contract.test.ts` (payload shape + IPC contract alignment) | ✅ automated |
| BLOCKER 5 | `capture.no_device` empty-state audit sink requires a session | 03-03 | `tests/main/capture/audit-trace.test.ts` — no-session path throws + session path writes row | ✅ automated |
| Q-A | First-save auto-detect emits `matched` regex in audit metadata | 03-03 | `tests/main/capture/audit-trace.test.ts` — first save emits `matched`, subsequent reads do not | ✅ automated |
| Q-B | Finish navigates to `previous ?? { name: 'patients' }` | 03-02 | `tests/renderer/store/route` + ProcedureRoom behavior (renderer-side) | ✅ automated |

---

## Wave 0 Requirements

- [x] `tests/main/capture/devices.test.ts` — covers CAPT-01 (mock spawn) + CAPT-10 (canonical round-trip)
- [x] `tests/main/capture/canonicalize.test.ts` — covers CAPT-10 (NFC + trim + collapse-spaces + zero-width strip)
- [x] `tests/main/capture/auto-detect-preset.test.ts` — covers SET-02 (SD regexes + HD regexes + fallback)
- [x] `tests/main/capture/preset-repo.test.ts` — covers CAPT-02 + SET-01 + SET-02 (settings k/v read/write)
- [x] `tests/main/capture/audit-trace.test.ts` — covers AUDIT-01 for every capture.* event
- [x] `tests/renderer/hooks/use-video-preview.test.ts` — covers CAPT-03 (start/stop on unmount + error states)
- [x] `tests/renderer/pages/procedure-room.test.tsx` — covers D-01 (Last used label) + D-07 (Start/Stop/Finish) + D-02 (empty state)
- [x] `tests/renderer/pages/settings-capture.test.tsx` — covers D-09 (live preview pane) + D-10 (no refresh button)
- [x] `tests/shell/security-baseline.test.ts` — extend Phase 1 to assert `permissions: ['media']` is present
- [x] `tests/integration/renderer-main-capture-contract.test.ts` — IpcContract ↔ preload bridge ↔ renderer usage alignment; BLOCKER 4 payload check; Phase 3 scope guards (no MediaRecorder / capture:start / capture:stop / mp4 paths)
- [x] Framework install: not needed (Vitest + jsdom + happy-dom already installed)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live preview renders real USB capture device on Windows | CAPT-01, CAPT-03 | dshow is Windows-only; this is a Mac dev env | Plug EasyCap/HDMI capture into Windows machine; launch app; verify device appears in Settings → Capture and Procedure Room dropdowns; click Start Preview; verify live preview renders. Repeat for HDMI capture. (BLOCKER 1 hardware proof) |
| Phase 4 ffmpeg arg round-trip | CAPT-10 | Phase 4 not yet shipped; manual verification deferred | Defer to Phase 4 UAT — `verify ffmpeg accepts the exact canonical name ffmpeg receives` |
| Auto-detect heuristic real-device match | SET-02 | Regex needs real device-name corpus | Plug EasyCap; verify SD preset auto-selected on first save. Plug HDMI capture; verify HD preset. |
| `capture.no_device` audit row written on Windows | BLOCKER 5 | Audit emission is local-only; Mac dev cannot exercise it | Plug in, unplug, observe empty state; verify a `capture.no_device` row exists in the audit log on the Windows bench. |

---

## Deviations / Notes

- **`webPreferences.permissions` (BLOCKER 3):** the literal text `permissions: ['media']` lives in `src/main/window.ts` for the grep-gate; the actual runtime mechanism is `session.setPermissionRequestHandler`. Electron 32 does not expose `permissions` in the `WebPreferences` type. Both are wired — verified by `tests/shell/security-baseline.test.ts`.
- **Parser regex (CAPT-01):** the dshow parser regex now tolerates the `[dshow @ 0x…]` prefix that real ffmpeg emits on every line (was a Rule 1 bug fix during Plan 03-03). Without the prefix, the parser would never produce a single device on real Windows hardware.
- **Canonicalize-before-audit (D-11):** `setDefaultDevice` and `setPreset` in `src/main/ipc/capture.ts` canonicalize the deviceId BEFORE the settings write AND the audit row, so audit metadata always echoes the same form (Rule 1 bug fix during Plan 03-03 — the prior implementation logged the raw input to audit while writing the canonical form to settings).
- **`vitest.config.ts` include:** `tests/shell/**` and `tests/integration/**` were not previously part of vitest's include glob; Plan 03-03 extends the include pattern so security-baseline + integration tests run in the full suite. Two pre-existing shell tests (`auth-status.test.ts`) needed minor updates to align with the current AuthStatus shape and the 8-handler `registerAuthIpc()`.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] Automated gates pass (test:unit, typecheck, build) — `wave_0_complete: true`
- [ ] `nyquist_compliant: true` — pending human UAT (BLOCKER 1 hardware proof on Windows bench)

**Approval:** pending human UAT (Task 03-03-03 — Windows capture enumeration + live-preview smoke)