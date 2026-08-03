---
phase: 03-capture-enumeration-live-preview
verifier: gsd-verifier (opencode)
date: 2026-08-03T05:55:00.000Z
goal_achieved: false
requirements_total: 7
requirements_met: 5
nyquist_compliant: true
human_verification_required: 3
gaps_open: 2
---

# Phase 3 Verification — Capture Enumeration + Live Preview

**Goal:** Let the doctor see all available USB capture devices, pick one, and see a live preview in the Procedure Room hero screen — without yet recording.

**Verdict: GAPS_FOUND**

The capture surfaces, enumeration parser, device bridge, Settings navigation, Procedure Room entry, and preview-only boundary exist. However, code inspection found a real main/preload/renderer response-shape mismatch for `capture.getPreset`, and the required preview cleanup behavioral tests fail. The phase cannot be marked achieved until those are corrected and re-verified.

## Goal-Backward Verification

| Roadmap success criterion | Status | Code evidence |
|---|---|---|
| Devices are enumerated and shown in Settings → Capture and Procedure Room | MET (hardware confirmation still listed below) | `src/main/capture/devices.ts:26-100`; `src/renderer/src/hooks/useCaptureDeviceMap.ts:19-71`; both pages render browser-device dropdowns. |
| Selecting a device opens a decoupled `getUserMedia` preview | PARTIAL | `useVideoPreview.ts:97-107` correctly uses exact browser deviceId and `audio:false`, but cleanup behavioral tests currently fail. |
| SD/HD/Custom presets are selectable and remembered per doctor | UNMET | Persistence exists, but `src/main/ipc/capture.ts:99-125` returns `{ preset: QualityPreset, matched }` while `src/shared/ipc-contract.ts:180` promises `QualityPreset | null`; renderer pages consume the response as a bare `QualityPreset`. Saved presets therefore hydrate with the wrong runtime shape. |
| Non-ASCII/spaced device names round-trip canonically | MET | `canonicalize.ts:16-33`, `devices.ts:83-98`, and canonicalization/parser tests. |
| Procedure Room renders preview hero with disabled Record | MET | `ProcedureRoom.tsx:100-193`, especially `<video>` at 118-125 and disabled Record at 184-186. |

## A. Must-Haves Coverage

Statuses below are based on current code and independently-run checks. Commit SHAs identify the matching implementation commit from each SUMMARY; the SUMMARY claim itself was not used as proof.

### Plan 03-01 — commit `f15ab5f`

#### Truths

| # | Must-have truth | Status | Evidence |
|---|---|---|---|
| 1 | Main enumerates DirectShow video devices, excludes audio, and returns canonical NFC names. | MET | `src/main/capture/devices.ts:26-100`; `canonicalize.ts:16-24`. |
| 2 | Default device and preset matrix are doctor-scoped; doctorId comes from main session only. | MET | `preset-repo.ts:17-69`; `ipc/capture.ts:26-31,83-140`; renderer contract has no doctorId. |
| 3 | Unknown device pairs receive one persisted SD/HD heuristic with matched-regex audit metadata. | MET | `auto-detect-preset.ts:36-77`; `ipc/capture.ts:53-64,99-125`. |
| 4 | Capture IPC inputs are validated; mutations and no-device state are audited canonically. | MET | `ipc/capture.ts:83-154`; `src/shared/validators.ts`; audit tests. |
| 5 | Media permission is enabled without weakening the Electron security baseline. | MET | `src/main/window.ts`; independently-run `tests/shell/security-baseline.test.ts` passed 11/11. |

#### Artifacts

| Artifact | Status | Evidence |
|---|---|---|
| `src/main/capture/devices.ts` / `enumerateDshowDevices` | MET | Substantive exported implementation, used by capture IPC. |
| `src/main/capture/canonicalize.ts` / `canonicalizeName` | MET | Substantive implementation, imported by devices/repository/IPC. |
| `src/main/capture/auto-detect-preset.ts` / `autoDetectPreset`, `MatchedPattern` | MET | Exported and called from capture IPC. |
| `src/main/capture/preset-repo.ts` / `presetRepo` | MET | Real SQLite reads/writes, called from capture IPC. |
| `src/main/ipc/capture.ts` / `registerCaptureIpc`, no-device handler | MET | Six handlers registered and main boot wiring exists. |
| `src/shared/ipc-contract.ts` capture types/methods | PARTIAL | Methods/types exist, but `getPreset` return type disagrees with the main handler's runtime object. |
| `src/shared/validators.ts` capture schemas | MET | Imported and applied at main IPC boundary. |
| `src/preload/index.ts` capture bridge | MET | All six methods invoke matching IPC constants. |
| `tests/main/capture/canonicalize.test.ts` | MET | Exists and covers normalization edge cases. |

### Plan 03-02 — commits `22ee0d8`, `28fe058`, `f245ed6`, `e1bea28`, `74675bb`

#### Truths

| # | Must-have truth | Status | Evidence |
|---|---|---|---|
| 1 | Renderer maintains and bridges dshow and browser device lists. | MET | `useCaptureDeviceMap.ts:19-69`; focused hook tests passed 5/5. |
| 2 | Preview uses exact browser deviceId and `audio:false`. | MET | `useVideoPreview.ts:97-107`. |
| 3 | Settings preview re-opens reactively on device/preset changes; only Save persists. | UNMET | `SettingsCapture.tsx:116-149` calls `preview.stop()` on every change and never calls `preview.start()` afterward. The page test only verifies non-persistence/re-enumeration, not reactive re-open. |
| 4 | Procedure Room shows saved device and keeps picker overrides session-local. | MET | `ProcedureRoom.tsx:39-89,139-166`; no persistence calls. |
| 5 | Both capture surfaces provide inline empty/error state and no-device audit behavior. | MET | `ProcedureRoom.tsx:17-34,126-133`; Settings inline state/errors at `SettingsCapture.tsx:195-211,326-330`. |
| 6 | Explicit Start; Stop/Finish/change/unmount release all tracks and clear `srcObject`. | UNMET | Implementation exists (`useVideoPreview.ts:62-77,139-146`; `ProcedureRoom.tsx:91-94`), but the required behavioral tests failed twice in independent verification. Presence cannot prove cleanup ordering. |
| 7 | Finish uses previous route with patients fallback. | MET | `ProcedureRoom.tsx:91-94`; route store wiring. |

#### Artifacts

| Artifact | Status | Evidence |
|---|---|---|
| `useVideoPreview.ts` | PARTIAL | Substantive and shared, but cleanup behavior is not passing its tests. |
| `useCaptureDeviceMap.ts` | MET | Substantive, used by both pages, focused tests pass. |
| `SettingsCapture.tsx` | PARTIAL | Fully rendered and save-wired, but reactive re-open is absent and preset hydration receives a mismatched IPC shape. |
| `ProcedureRoom.tsx` | PARTIAL | Fully rendered/wired; cleanup behavioral checks fail. |
| `lib/router.ts` | MET | Capture/settings route variants exist. |
| `store/route.ts` | MET | Current/previous route snapshot is wired. |
| `App.tsx` | MET | Authenticated capture/settings cases render production pages. |

### Plan 03-03 — commits `264f727`, `6f72f8c`

#### Truths

| # | Must-have truth | Status | Evidence |
|---|---|---|---|
| 1 | Full unit suite, both typechecks, and build exit 0. | PARTIAL | `npm run typecheck` passed now. Historical build/typecheck passed. Current full Vitest run failed because the native `better-sqlite3` binding is missing for Node 24 and also exposed the two preview cleanup failures. |
| 2 | Security baseline asserts all five flags. | MET | Independent focused run passed 11/11. |
| 3 | Audit trace covers session doctorId, no-device audit, matched metadata. | MET | `tests/main/capture/audit-trace.test.ts`. |
| 4 | Device parser excludes audio and covers canonicalization edge cases. | MET | `tests/main/capture/devices.test.ts`; substantive parser implementation. |
| 5 | Auto-detect and preset repository cover inference and isolation. | MET | `auto-detect-preset.test.ts`, `preset-repo.test.ts`. |
| 6 | Integration test proves contract/preload/renderer shape alignment. | UNMET | Static test passes, but it does not compare the `getPreset` response shape. Main returns a wrapper at `ipc/capture.ts:124`; contract promises bare preset at `ipc-contract.ts:180`. |
| 7 | Scope guards prove Phase 3 contains no recording primitives. | MET | Independent integration test passed; Procedure Room Record is disabled and no recording IPC exists. |
| 8 | Windows hardware smoke confirms real enumeration and silent preview. | PARTIAL | UAT records enumeration as pass, but remaining real preview/lifecycle checks still require hardware confirmation. |

#### Artifacts

| Artifact | Status | Evidence |
|---|---|---|
| `tests/main/capture/devices.test.ts` | MET | Exists and substantive. |
| `tests/main/capture/auto-detect-preset.test.ts` | MET | Exists and substantive. |
| `tests/main/capture/preset-repo.test.ts` | MET | Exists and substantive. |
| `tests/main/capture/audit-trace.test.ts` | MET | Exists and substantive. |
| `tests/shell/security-baseline.test.ts` | MET | 11/11 passed independently. |
| `tests/integration/renderer-main-capture-contract.test.ts` | PARTIAL | 37/37 passed, but misses the observed `getPreset` response-shape drift. |
| `03-VALIDATION.md` | PARTIAL | Automated Wave 0 status exists, but frontmatter remains `status: draft`, `nyquist_compliant: false`, and the recorded count is stale at 189. |

### Plan 03-04 — commits `8d8c0fb`, `2f17fdc`, `744e6cb`

#### Truths

| # | Must-have truth | Status | Evidence |
|---|---|---|---|
| 1 | Every doctor can reach Settings → Capture from Patient List. | MET (superseded architecture) | Current route is Patient List → Settings Hub → Capture (`PatientsList.tsx:111-119`, `SettingsHub.tsx:36-58`). |
| 2 | Capture is available to all; Users is admin-only. | MET | Shared `SettingsSidebar.tsx:19-50`. |
| 3 | Tests prevent capture settings from becoming unreachable. | MET | Patient-list, settings-hub, sidebar, and integration tests passed in focused run. |

#### Artifacts

| Artifact | Status | Evidence |
|---|---|---|
| `PatientsList.tsx` Settings entry | MET (superseded) | A stable Settings button now routes to the hub rather than the transient menu. |
| `patients-list.test.tsx` | MET | Current hub-entry regression test passes. |
| Integration reachability assertion | MET | Current contract pins the superseding hub path. |

### Plan 03-05 — commits `505ead8`, `51c28c7`

#### Truths

| # | Must-have truth | Status | Evidence |
|---|---|---|---|
| 1 | Authenticated doctors reach a dedicated Settings hub and shared destinations. | MET | `SettingsHub.tsx`; `PatientsList.tsx:111-119`. |
| 2 | Users is visible/admin-gated; Capture is open to all doctors. | MET | `SettingsSidebar.tsx:29-50`. |
| 3 | Every non-deleted PatientRow can open Procedure Room with patientId. | MET | `PatientRow.tsx:55-62`; component test passed 2/2. |
| 4 | Patient-detail placeholder is removed from App UI. | MET | Current `App.tsx`; integration assertion passed. |
| 5 | Renderer/integration tests pin both entry points. | MET | Focused renderer/integration run confirms coverage. |

#### Artifacts

All ten artifacts are **MET**: `SettingsHub.tsx`, router variant, App route, PatientsList button, PatientRow action, `settings-hub.test.tsx`, `patient-row.test.tsx`, `patients-list.test.tsx`, Procedure Room reachability test, and the integration contract. Evidence is in current source/tests and commits `505ead8` / `51c28c7`.

### Plan 03-06 — commits `ade8e6a`, `b72c007`

#### Truths

| # | Must-have truth | Status | Evidence |
|---|---|---|---|
| 1 | Procedure Room no longer crashes on empty/missing custom resolution. | MET | `useVideoPreview.ts:35-42`. |
| 2 | Hook tests cover empty and undefined custom resolution. | MET | `use-video-preview.test.ts`; focused run passed 7/7. |
| 3 | All three Settings pages render one shared sidebar. | MET | `SettingsHub.tsx:37`, `SettingsCapture.tsx:193`, `SettingsUsers.tsx:174`. |
| 4 | Active tab uses `data-active` and visible variant. | MET | `SettingsSidebar.tsx:29-46`; page/component tests pass. |
| 5 | Non-admin Users remains disabled. | MET | `SettingsSidebar.tsx:43`; role tests pass. |
| 6 | Existing Procedure Room tests keep passing with new regressions pinned. | UNMET | Two required Procedure Room lifecycle tests failed in independent focused execution. |

#### Artifacts

All ten declared artifacts exist and are substantive. Nine are **MET**. `tests/renderer/pages/procedure-room.test.tsx` is **PARTIAL** because its Stop and Finish cleanup tests fail. `SettingsSidebar.tsx` correctly exports both `SettingsSidebar` and `SettingsTab`.

**Must-haves score:** **72/80 MET** (34 truths + 46 artifacts; PARTIAL/UNMET do not count as met).

## B. Requirement Traceability

| Requirement | Plans | Evidence | Status |
|---|---|---|---|
| CAPT-01 | 03-01, 03-03, 03-04, 03-05 | `devices.ts`, `useCaptureDeviceMap.ts`, Settings/Procedure dropdowns, `devices.test.ts` | MET |
| CAPT-02 | 03-01, 03-02, 03-03 | `preset-repo.ts`, `capture.ts`, `ProcedureRoom.tsx` | MET |
| CAPT-03 | 03-02, 03-03, 03-04, 03-05, 03-06 | `useVideoPreview.ts`, `ProcedureRoom.tsx`, preview tests | UNMET — cleanup behavioral tests fail and Settings re-open behavior is absent |
| CAPT-10 | 03-01, 03-03 | `canonicalize.ts`, `devices.ts`, canonicalize/device tests | MET |
| SET-01 | 03-01, 03-02, 03-03, 03-04, 03-05, 03-06 | `SettingsCapture.tsx`, `SettingsSidebar.tsx`, settings/preset repository | MET |
| SET-02 | 03-01, 03-02, 03-03 | `auto-detect-preset.ts`, `SettingsCapture.tsx`, `preset-repo.ts` | UNMET — saved preset response shape is broken across IPC |
| SET-04 | 03-05, 03-06 (plus Phase 2 implementation) | `SettingsUsers.tsx`, `SettingsSidebar.tsx`, users IPC | MET |

Note: ROADMAP Phase 3 lists six requirements (omits SET-04), while the requested verification scope contains seven. This report verifies all seven requested IDs.

## C. UAT Gap Reconciliation

| Gap | Status | Resolution evidence |
|---|---|---|
| G-03-1 | RESOLVED | 03-04 (`2f17fdc`, `744e6cb`), later superseded by the hub path. |
| G-03-2 | RESOLVED | 03-04; current Settings hub/capture path remains reachable. |
| G-03-3 | RESOLVED | 03-05 `505ead8` — dedicated SettingsHub. |
| G-03-4 | RESOLVED | 03-05 `51c28c7` — PatientRow → Procedure Room. |
| G-03-5 | RESOLVED | 03-06 `ade8e6a` — `preset.resolution?.trim()` guard and tests. |
| G-03-6 | RESOLVED | 03-06 `b72c007` — shared sidebar on all Settings pages. |

`03-UAT.md` is stale for G-03-5/G-03-6 (still marked failed) even though current code and regression tests contain the fixes.

## D. Automated Gates

- **Typecheck:** PASSED now (`npm run typecheck`; node + renderer).
- **Historical Plan 03-03 unit gate:** 189/189 passed; Plan 03-04 recorded 197/197; Plan 03-06 recorded 220.
- **Current focused renderer + security + integration run:** 119 passed, 2 failed. Failures are both Procedure Room track-cleanup tests.
- **Current full Vitest run:** 163 passed, 64 failed. Most failures are environmental (`better-sqlite3` Node 24 native binding absent), but the preview cleanup failures also reproduce in the focused run.
- **Security baseline:** PASSED, 11/11.
- **Integration/scope guards:** PASSED, 37/37, but incomplete: they do not detect `getPreset` response-shape drift.
- **Production build:** PASSED in Plan 03-03 evidence; not rerun because the verification mandate prioritizes fast read-only checks and the current source defect is already observable.

## E. Human Verification Items (USB Hardware Only)

1. **Real enumeration and identity bridge** — Plug in EasyCap/HDMI/webcam; verify the same physical device appears with a clean canonical label and resolves to the correct browser deviceId.
2. **Real live preview and permission flow** — Start preview on each device; verify video frames render, camera permission/indicator behaves correctly, audio is absent, and no recording process/file is created.
3. **Real handle release and preset behavior** — While previewing, change device/preset, Stop, Finish, and navigate away; verify the hardware indicator releases, preview re-opens when expected, and saved SD/HD/Custom settings survive leaving/re-entering.

## F. Gaps Found

### Gap 1 — Capture preset IPC response contract is broken

- `IpcContract.capture.getPreset` promises `Promise<QualityPreset | null>` (`src/shared/ipc-contract.ts:180`).
- Main `getPreset()` returns `{ preset: QualityPreset, matched: MatchedPattern | null }` (`src/main/ipc/capture.ts:99-125`).
- Preload forwards the value unchanged (`src/preload/index.ts:41`).
- `SettingsCapture` and `ProcedureRoom` consume it as a bare `QualityPreset`.

**Impact:** Saved/auto-detected presets do not hydrate correctly in the production renderer. SET-02 and roadmap success criterion 3 are not achieved.

**Missing:** Align the main handler and shared contract on one return shape, update renderer consumption, and add an end-to-end contract test that feeds the actual main response into the renderer hydration path.

### Gap 2 — Required preview lifecycle behavior is not proven and reactive Settings re-open is absent

- Independent focused execution failed both Procedure Room cleanup tests: Stop and Finish did not satisfy the track-stop assertions.
- `SettingsCapture` change handlers explicitly call `preview.stop()` but never restart the preview, contradicting the plan's reactive re-open requirement.

**Impact:** CAPT-03's cleanup/reactivity invariants are not achieved with passing behavioral evidence; real hardware handles may remain open or require manual restart after a device/preset change.

**Missing:** Fix the shared preview lifecycle/race at its root, implement automatic re-open while preview was active, and make the named Stop/Finish/change/unmount tests deterministic and green.

## G. Verdict

**GAPS_FOUND — Phase 3 goal is not yet achieved.**

The six recorded UAT gaps are source-resolved, but verification found two additional implementation gaps that the SUMMARYs and static contract tests missed. Do not proceed as if Phase 3 passed until the preset response contract and preview lifecycle/reactivity are fixed and re-verified.

---

_Verified: 2026-08-03T05:55:00.000Z_  
_Verifier: gsd-verifier (opencode)_
