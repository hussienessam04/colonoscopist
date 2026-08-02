---
phase: 03-capture-enumeration-live-preview
plan: 03
subsystem: capture-validation
tags: [test-suite, security-baseline, integration-contract, scope-guards, audit-trace, auto-detect-preset, dshow-parser, canonicalization, phase3-gate]

# Dependency graph
requires:
  - phase: 03-capture-enumeration-live-preview (plan 01)
    provides: dshow enumeration, canonicalization, session-scoped capture IPC, preset repo, no-device audit sink
  - phase: 03-capture-enumeration-live-preview (plan 02)
    provides: useVideoPreview / useCaptureDeviceMap hooks, Procedure Room + Settings → Capture pages, bridge logic
provides:
  - 39 new automated tests covering devices parser, auto-detect preset, preset repo, audit trace, security baseline, and cross-process contract
  - Five-flag webPreferences assertion (`contextIsolation`, `nodeIntegration`, `sandbox`, `webSecurity`, `permissions: ['media']`) — BLOCKER 3 regression guard
  - BLOCKER 4 contract test — `IpcContract.capture` ↔ preload bridge alignment + absence of `doctorId` from `setPreset` / `setDefaultDevice` payloads
  - Phase 3 scope guards — no `MediaRecorder`, `capture:start`, `capture:stop`, recording child process, `.mp4` output path in any Phase 3 source
  - Validation doc with automated gate status + requirement coverage + deviation notes
affects:
  - 04-recording (Phase 4 inherits canonical dshow parser + scope guard — the integration test will fail if Phase 4 leaks recording primitives back into Phase 3 file scope)
  - 03-VALIDATION.md (the wave_0_complete frontmatter flip is now true; nyquist_compliant stays false until human UAT)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Vitest include pattern extended to tests/shell + tests/integration (was tests/main + tests/renderer only)"
    - "Pre-existing shell tests (auth-status.test.ts) updated to align with the 8-handler registerAuthIpc() and the current AuthStatus shape — exposed by the include-pattern change"
    - "dshow parser regex now tolerates the [dshow @ 0x…] prefix in real ffmpeg output (Rule 1 bug fix)"

key-files:
  created:
    - tests/main/capture/devices.test.ts
    - tests/main/capture/auto-detect-preset.test.ts
    - tests/main/capture/preset-repo.test.ts
    - tests/main/capture/audit-trace.test.ts
    - tests/shell/security-baseline.test.ts
    - tests/integration/renderer-main-capture-contract.test.ts
  modified:
    - src/main/capture/devices.ts
    - src/main/ipc/capture.ts
    - tests/shell/auth-status.test.ts
    - vitest.config.ts
    - .planning/phases/03-capture-enumeration-live-preview/03-VALIDATION.md

key-decisions:
  - "Five-flag webPreferences assertion reads src/main/window.ts source rather than loading BrowserWindow — same approach as scripts/check-security-baseline.cjs but in a vitest-runnable form"
  - "Integration contract test prefers static analysis (grep/AST) over runtime Electron — per the plan's note that TS shape compatibility is enough for the BLOCKER 4 check; zero boot-up cost"
  - "Phase 3 scope guards live in tests/integration/renderer-main-capture-contract.test.ts as a single dedicated describe block; will fail loudly if Phase 4 leaks recording primitives into Phase 3 file scope"
  - "Parser regex updated to /(?:\\[[^\\]]+\\])?\\s*\"([^\"]+)\"\\s*$/ — tolerates the [dshow @ 0x…] prefix that real ffmpeg emits on every dshow line"
  - "setDefaultDevice / setPreset canonicalize BEFORE both the settings write and the audit row (D-11) — audit metadata now echoes the same canonical form as the settings key"

patterns-established:
  - "Static-analysis test pattern for IPC contract alignment — pull the IpcContract block + walk renderer source for forbidden call sites; zero runtime cost"
  - "Scope-guard test pattern — walk a directory, assert each forbidden token is absent; cheap regression catch when a future phase leaks into the wrong file scope"
  - "Pre-IPC canonicalize + pre-audit canonicalize — never let raw input leak into the audit_log metadata column"

requirements-completed: [CAPT-01, CAPT-02, CAPT-03, CAPT-10, SET-01, SET-02]

# Coverage metadata (#1602)
coverage:
  - id: P3-V1
    description: parseDshowVideoDevices returns only VIDEO entries, excludes audio; canonicalizes NFC, zero-width, whitespace
    requirement: CAPT-01, CAPT-10
    verification:
      - kind: unit
        ref: tests/main/capture/devices.test.ts
        status: pass
    human_judgment: true
    rationale: "Mock spawn covers the parser exhaustively; real Windows dshow enumeration still needs the bench UAT for ground truth."
  - id: P3-V2
    description: enumerateDshowDevices forwards stderr through the parser and resolves with the canonical list (mock spawn)
    requirement: CAPT-01
    verification:
      - kind: unit
        ref: tests/main/capture/devices.test.ts
        status: pass
    human_judgment: true
    rationale: "Same as P3-V1 — the spawn hook is mocked; Windows bench is the actual hardware proof."
  - id: P3-V3
    description: autoDetectPreset returns SD for SD regexes, HD for HD regexes, HD fallback for unknown; first matching regex wins
    requirement: SET-02
    verification:
      - kind: unit
        ref: tests/main/capture/auto-detect-preset.test.ts
        status: pass
    human_judgment: false
  - id: P3-V4
    description: presetRepo round-trips per-doctor default + per-(doctor, device) preset matrix; doctor + device isolation; canonicalization on write
    requirement: CAPT-02, SET-01, SET-02, CAPT-10
    verification:
      - kind: unit
        ref: tests/main/capture/preset-repo.test.ts
        status: pass
    human_judgment: false
  - id: P3-V5
    description: Every capture.* IPC mutation writes an audit row; first-save emits `matched` regex metadata; BLOCKER 4 (doctorId from requireSession) + BLOCKER 5 (no-device sink) proven
    requirement: AUDIT-01, BLOCKER 4, BLOCKER 5, Q-A
    verification:
      - kind: integration
        ref: tests/main/capture/audit-trace.test.ts
        status: pass
    human_judgment: false
  - id: P3-V6
    description: BrowserWindow webPreferences asserts all five flags (contextIsolation, nodeIntegration, sandbox, webSecurity, permissions: ['media']) + session.setPermissionRequestHandler wiring
    requirement: BLOCKER 3
    verification:
      - kind: smoke
        ref: tests/shell/security-baseline.test.ts
        status: pass
    human_judgment: false
  - id: P3-V7
    description: IpcContract.capture shape matches preload bridge; BLOCKER 4 payload check (no doctorId in setPreset / setDefaultDevice); SettingsCapture is the only caller of setDefaultDevice (D-04, Q-C); useCaptureDeviceMap is the only enumerateDevices consumer (BLOCKER 1)
    requirement: BLOCKER 1, BLOCKER 4, D-01, D-04, Q-C
    verification:
      - kind: integration
        ref: tests/integration/renderer-main-capture-contract.test.ts
        status: pass
    human_judgment: false
  - id: P3-V8
    description: Phase 3 source contains no MediaRecorder, capture:start, capture:stop, recording child-process handler, or .mp4 output path
    requirement: D-08, D-10, D-11; BLOCKER 1, 3, 4, 5; Q-A
    verification:
      - kind: integration
        ref: tests/integration/renderer-main-capture-contract.test.ts
        status: pass
    human_judgment: false

# Metrics
duration: 28min
completed: 2026-08-02
status: complete
---

# Phase 3: Plan 03 Summary

**Integrated Phase 3 validation gate: full unit suite + typecheck + build green; security baseline + cross-process contract + scope guards shipped; BLOCKER 1 hardware proof deferred to human UAT (Task 03-03-03 pending).**

## Performance

- **Duration:** 28 min
- **Started:** 2026-08-02T18:33:00Z
- **Completed:** 2026-08-02T19:01:00Z
- **Tasks:** 2 of 3 (Task 3 is `checkpoint:human-verify` — pending Windows bench smoke)
- **Files modified:** 12 (6 new tests + 2 source fixes + 1 config + 1 pre-existing test fix + 1 validation doc + 1 auth-status fix)
- **Tests:** 39 new + 150 pre-existing = **189/189 passing across 31 test files**

## Accomplishments

- **`tests/main/capture/devices.test.ts`** (10 tests) — mock spawn via the existing `EnumerateDshowOptions.spawnFn` test hook; asserts the parser returns ONLY DirectShow VIDEO entries (audio section excluded), canonicalizes NFC, zero-width, mixed-whitespace, and trailing whitespace edge cases, drops empty canonical names without crashing, ignores non-quoted ffmpeg banner lines. Test hook covers CAPT-01 parser deterministically; Windows bench UAT remains the hardware ground truth.
- **`tests/main/capture/auto-detect-preset.test.ts`** (11 tests) — SD regexes win over HD; HD patterns (HDMI / 1080p / word-boundary HD / Digital / DVI / UVC) fire in declared order; unknown names return HD fallback. `MatchedPattern` tag captured per call so audit metadata is contract-pinned (Q-A).
- **`tests/main/capture/preset-repo.test.ts`** (11 tests) — `getDefault`/`setDefault` round-trip; `getPreset`/`setPreset` round-trip with custom preset JSON; first-read auto-save not tested here (covered by `audit-trace.test.ts` Q-A path); conflict update; canonicalize-on-write; doctor isolation (two doctors, same device → independent rows); device isolation (one doctor, two devices → independent rows); corrupt-row defensive read returns null instead of throwing.
- **`tests/main/capture/audit-trace.test.ts`** (7 tests) — every capture.* IPC writes an audit row with canonical `deviceName` metadata; first-save auto-detect emits `matched` regex in metadata, subsequent reads do not (Q-A); `setPreset` / `setDefaultDevice` IGNORE any smuggled `doctorId` in the payload and derive from `requireSession()` (BLOCKER 4); `noDeviceAudit` refuses to write when no session, writes `source: 'renderer-empty-state'` when a session is present (BLOCKER 5).
- **`tests/shell/security-baseline.test.ts`** (11 tests) — reads `src/main/window.ts` source and asserts all five `webPreferences` flags (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`, `permissions: ['media']`); forbidden-literal drift detectors (`nodeIntegration: true` etc.); session handler wiring.
- **`tests/integration/renderer-main-capture-contract.test.ts`** (22 tests) — static-analysis contract alignment: every `IpcContract.capture` method is wired into the preload bridge; every preload entry invokes `IPC.CAPTURE_…`; `setPreset` / `setDefaultDevice` signatures omit `doctorId`; zod schemas omit `doctorId`; main IPC derives `doctorId` from `requireSession()` (BLOCKER 4); ProcedureRoom does NOT call `setDefaultDevice` / `setPreset`; SettingsCapture is the only renderer caller of `setDefaultDevice` (D-04, Q-C); `useCaptureDeviceMap` is the only `enumerateDevices` consumer (BLOCKER 1); `useVideoPreview` is the only `getUserMedia` consumer. Phase 3 scope guards assert no `MediaRecorder`, no `capture:start` / `capture:stop` IPC channels, no `.mp4` output paths, no ffmpeg recording args (`libx264` / `-crf` / `-i video=`) anywhere under `src/`.

## Bug fixes (auto-applied per Rule 1)

- **`devices.ts` parser regex too strict for real ffmpeg output.** The original regex `^\s*"([^"]+)"\s*$` rejected every line because real ffmpeg prefixes each line with `[dshow @ 0x…]`. Without the fix, `enumerateDshowDevices()` would return an empty array on real Windows hardware. Updated to `^\s*(?:\[[^\]]+\])?\s*"([^"]+)"\s*$` so the prefix is optional. 10 parser tests now exercise realistic ffmpeg output.
- **`capture.ts` audit metadata logged raw input.** `setDefaultDevice` and `setPreset` wrote the raw `deviceId` (with whitespace, zero-width, etc.) into the audit_log metadata while `presetRepo` wrote the canonical form. This is a D-11 violation (audit metadata always echoes the canonical form). Fixed by canonicalizing before both the settings write AND the audit row.
- **`tests/shell/auth-status.test.ts` had a stale stub payload.** Exposed when the include-pattern change brought shell tests into the full suite. The test asserted `STUB_PAYLOAD = { authenticated: false, reason: 'scaffold' }` but the real `registerAuthIpc().AUTH_STATUS` handler now returns the full `AuthStatus` shape. Also: `registerAuthIpc()` registers 8 channels (status, bootstrap, login, logout, users-list, recovery-request, accept-recovery-file, wizard-bootstrap), so the `toHaveBeenCalledTimes(1)` assertion was wrong. Updated to find the `AUTH_STATUS` call among the 8.
- **`vitest.config.ts` include glob didn't cover `tests/shell` or `tests/integration`.** Security-baseline + integration tests were not running in the full suite prior to this plan. Extended the include pattern.

## Task Commits

1. **Task 1 (automated):** `264f727 test(03-03): capture validation suite + security baseline + integration contract`
2. **Task 2 (docs):** `6f72f8c docs(03-03): mark wave_0 complete + record automated gate status`
3. **Task 3 (pending):** `checkpoint:human-verify` — Windows capture enumeration + live-preview UAT smoke (BLOCKER 1 hardware proof); recorded as pending in 03-VALIDATION.md. The session does NOT execute this task per the orchestrator's instructions.

## Files Created/Modified

- `tests/main/capture/devices.test.ts` (new, 10 tests)
- `tests/main/capture/auto-detect-preset.test.ts` (new, 11 tests)
- `tests/main/capture/preset-repo.test.ts` (new, 11 tests)
- `tests/main/capture/audit-trace.test.ts` (new, 7 tests)
- `tests/shell/security-baseline.test.ts` (new, 11 tests)
- `tests/integration/renderer-main-capture-contract.test.ts` (new, 22 tests)
- `src/main/capture/devices.ts` — parser regex now tolerates `[dshow @ …]` prefix
- `src/main/ipc/capture.ts` — `setDefaultDevice` / `setPreset` canonicalize before audit row
- `tests/shell/auth-status.test.ts` — updated to 8-handler `registerAuthIpc()` and `AuthStatus` shape
- `vitest.config.ts` — `tests/shell/**` + `tests/integration/**` added to include glob
- `.planning/phases/03-capture-enumeration-live-preview/03-VALIDATION.md` — wave_0_complete flipped to true; automated gate status table + requirement coverage table + deviation notes

## Decisions Made

- **Static-analysis integration test over runtime Electron.** Per the plan: "verifying shape compatibility via TS compilation is enough for the BLOCKER 4 check." The test reads source files and asserts shape, signature, and forbidden-token absence via regex. Zero boot-up cost; runs in milliseconds.
- **Phase 3 scope guards live in the integration test file** rather than a dedicated `tests/shell/phase3-scope.test.ts`. They share the file-walking helper with the BLOCKER 1 / 4 consumer assertions; a separate file would just duplicate the walker.
- **Parser regex tolerates the `[dshow …]` prefix as optional.** Real ffmpeg emits the prefix on every dshow line; making it required would also work, but optional matches both banner lines and quoted device lines, which keeps the parser simple.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] dshow parser regex too strict for real ffmpeg output**
- **Found during:** Task 1 (devices.test.ts)
- **Issue:** Original regex `^\s*"([^"]+)"\s*$` never matched any real ffmpeg line because every ffmpeg dshow line is prefixed with `[dshow @ 0x…]`. The parser would have returned an empty array on real Windows hardware.
- **Fix:** Updated to `^\s*(?:\[[^\]]+\])?\s*"([^"]+)"\s*$` — the `[dshow …]` prefix is now optional.
- **Files modified:** `src/main/capture/devices.ts`
- **Verification:** 10/10 parser tests pass against realistic ffmpeg output strings.

**2. [Rule 1 - Bug] `capture.ts` audit metadata logged raw input instead of canonical**
- **Found during:** Task 1 (audit-trace.test.ts)
- **Issue:** `setDefaultDevice` and `setPreset` wrote the raw `deviceId` (with whitespace, zero-width, etc.) into the audit_log metadata while `presetRepo` wrote the canonical form. Violates D-11: "audit metadata always stores the canonical form."
- **Fix:** Canonicalize the deviceId BEFORE both the settings write AND the audit row in both handlers.
- **Files modified:** `src/main/ipc/capture.ts`
- **Verification:** 7/7 audit-trace tests pass; audit rows now record canonical names.

**3. [Rule 1 - Bug] `auth-status.test.ts` stale payload + wrong call-count assertion**
- **Found during:** Task 1 (full suite after extending include glob)
- **Issue:** Test asserted `STUB_PAYLOAD = { authenticated: false, reason: 'scaffold' }` against the real `registerAuthIpc()` handler, but the real handler returns the full `AuthStatus` shape. Also: `registerAuthIpc()` registers 8 channels, but the test asserted `toHaveBeenCalledTimes(1)`.
- **Fix:** Updated assertion to find the `AUTH_STATUS` call among the 8 registered handlers and assert against the real `AuthStatus` shape. Added `app` to the electron mock so `userRepo.countActive()` can resolve.
- **Files modified:** `tests/shell/auth-status.test.ts`
- **Verification:** All shell tests pass.

---

**Total deviations:** 3 auto-fixed (3 bugs). All three are correctness fixes against actual behavior; no scope creep into Phase 4.

## Issues Encountered

- **Flaky renderer test (pre-existing, not caused by this plan).** `tests/renderer/pages/procedure-room.test.tsx > ProcedureRoom > Finish stops the active stream` is timing-sensitive; it passes in isolation and on full-suite re-runs but occasionally fails on the first full-suite run. Not introduced by any of my changes (the test was last modified in Plan 03-02 commit `f5a5923`); out of scope for this plan per "only auto-fix issues DIRECTLY caused by the current task's changes." Documented as a known flake.
- **`vitest.config.ts` include glob didn't cover `tests/shell` or `tests/integration`.** The `auth-status.test.ts` shell test and the integration test plan files would not have run in the full suite without an include-glob extension. Fixed as part of Task 1.

## User Setup Required

None — Task 3 is human UAT, not user setup. The Windows bench operator runs `/gsd-verify-work 3` to perform the BLOCKER 1 hardware proof.

## Next Phase Readiness

- **Plan 03-03 Tasks 1–2 complete.** All automated gates pass. The Phase 3 codebase is type-safe, buildable, and fully tested with the hardened Electron configuration intact.
- **Plan 03-03 Task 3 (BLOCKER 1 hardware proof) pending.** The Windows bench operator must:
  1. Plug in EasyCap SD and/or HDMI/DVI HD capture card
  2. Launch the app and authenticate
  3. Verify Settings → Capture shows the canonical dshow display name AND that the live preview opens with the matching browser deviceId (BLOCKER 1)
  4. Verify first-use preset is SD analog 720×480 for EasyCap and HD digital 1920×1080 for HDMI/DVI; Custom exposes only W×H + framerate 25/30/50/60
  5. Verify Settings preview re-opens reactively on preset change (BLOCKER 6); only Save persists
  6. Verify Procedure Room `Last used: <X>` label and session-only override; Finish returns to previous route
  7. Verify no-device empty state fires `capture.no_device` audit row (BLOCKER 5)
  8. Verify Record remains disabled and no video file is created
  9. Verify navigation away releases the capture device indicator
- **Phase 4 (recording) is unblocked.** The canonical dshow name from `enumerateDshowDevices()` is exactly what the Phase 4 ffmpeg `-i video=<name>` invocation will receive. The integration test scope guards will fail loudly if Phase 4 leaks recording primitives (`MediaRecorder`, `capture:start`, `libx264`, `.mp4` paths) back into the Phase 3 file scope.
- **nyquist_compliant stays `false`** until the human UAT step records device classes tested + any failure text in `03-VALIDATION.md`. `wave_0_complete` is already `true`.

---

*Phase: 03-capture-enumeration-live-preview*
*Plan: 03 (Tasks 1–2 complete; Task 3 pending human UAT)*
*Completed: 2026-08-02*