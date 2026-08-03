---
phase: 03-capture-enumeration-live-preview
plan: 08
subsystem: ui
tags: [react, video-preview, hook, gap-closure, race-condition, tdd]
gap_closure: true
gap_ids: [G-03-8]

# Dependency graph
requires:
  - phase: 03-capture-enumeration-live-preview (plan 02)
    provides: "useVideoPreview hook with release()/stop()/start() + ProcedureRoom page rendering preview + getUserMedia mock in renderer test setup"
  - phase: 03-capture-enumeration-live-preview (plan 06)
    provides: "presetHints() defensive guard for malformed custom presets (G-03-5) — ensures ProcedureRoom doesn't crash on a corrupt row, so cleanup tests can run end-to-end"
provides:
  - "ProcedureRoom Stop and Finish cleanup tests are deterministic under `npm run test:unit` (Electron-as-Node ABI) — both tracks have `mock.calls.length === 1` within the 5s safety-net timeout"
  - "useVideoPreview hook's release ordering documented in source — `requestRef.current += 1` FIRST, then capture streamRef.current, then null streamRef.current, then stop tracks; `.then` cancellation branch stops tracks when `request !== requestRef.current`"
  - "Integration-contract G-03-8 describe block pins the release ordering with 3 regex assertions on `USE_VIDEO_PREVIEW_SRC` — a future refactor cannot silently re-introduce the race"
affects:
  - 03-verify (resolves G-03-8 — CAPT-03 cleanup invariants now verified by automated tests; the failing-test issue is closed)
  - 04-recording (Phase 4 inherits the deterministic preview cleanup path)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Test-side wait pattern: `await mock.results[0].value` forces the `.then` microtask to flush before the test clicks the next button — the missing piece under Electron-as-Node ABI"
    - "Hook-level documentation comment (ponytail: deterministic release ordering) makes the implicit contract explicit without changing behavior — readers see the cancellation branch + ordering at a glance"
    - "Integration-contract regex pins: (a) requestRef.current += 1 BEFORE streamRef.current = null, (b) track.stop() AFTER streamRef.current = null, (c) .then cancellation branch stops tracks when request !== requestRef.current"

key-files:
  created: []
  modified:
    - src/renderer/src/hooks/useVideoPreview.ts
    - tests/renderer/pages/procedure-room.test.tsx
    - tests/integration/renderer-main-capture-contract.test.ts

key-decisions:
  - "Fix the test, not the hook — the hook's release ordering is already correct (`requestRef.current += 1` first, then capture stream, then null stream, then stop tracks). The flake is in the test's wait pattern: it waited for the Stop Preview button to render (which happens when `starting === true`), but the `.then` hadn't resolved yet under Electron-as-Node ABI"
  - "Hoist the `md` (navigator.mediaDevices) reference to the top of the test so the same reference is used both for the `await waitFor` and the `await mock.results[0].value` lines"
  - "Keep the 5s safety-net timeout — defense-in-depth; the explicit `.then` await is the primary fix"
  - "Document the release ordering in source with a ponytail comment block immediately above `release()` — the comment makes the contract explicit at the call site without changing the implementation"

patterns-established:
  - "When a UI hook test fails because the test races against a `.then` microtask under a non-default runtime (Electron-as-Node, JSDOM, etc.), the canonical fix is to await the resolved promise via `await mock.results[0].value` before clicking the next button — never refactor the hook's release ordering"

requirements-completed: [CAPT-03]

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "ProcedureRoom 'Stop releases every track' test is deterministic under `npm run test:unit` (Electron-as-Node ABI) — both tracks have mock.calls.length === 1 within the 5s safety-net timeout"
    requirement: CAPT-03
    verification:
      - kind: unit
        ref: tests/renderer/pages/procedure-room.test.tsx#opens getUserMedia only after Start Preview, and releases every track on Stop
        status: pass
    human_judgment: false
  - id: D2
    description: "ProcedureRoom 'Finish stops the active stream' test is deterministic under `npm run test:unit` (Electron-as-Node ABI) — both tracks have mock.calls.length === 1 within the 5s safety-net timeout"
    requirement: CAPT-03
    verification:
      - kind: unit
        ref: tests/renderer/pages/procedure-room.test.tsx#Finish stops the active stream
        status: pass
    human_judgment: false
  - id: D3
    description: "useVideoPreview hook's release ordering is documented in source and pinned by the integration-contract G-03-8 describe block (3 regex assertions on USE_VIDEO_PREVIEW_SRC)"
    requirement: CAPT-03
    verification:
      - kind: integration
        ref: tests/integration/renderer-main-capture-contract.test.ts#G-03-8 — useVideoPreview release ordering is deterministic > release() declares requestRef.current += 1 BEFORE streamRef.current = null
        status: pass
      - kind: integration
        ref: tests/integration/renderer-main-capture-contract.test.ts#G-03-8 — useVideoPreview release ordering is deterministic > release() calls track.stop() AFTER streamRef.current = null
        status: pass
      - kind: integration
        ref: tests/integration/renderer-main-capture-contract.test.ts#G-03-8 — useVideoPreview release ordering is deterministic > the .then cancellation branch stops tracks when request !== requestRef.current
        status: pass
    human_judgment: false
  - id: D4
    description: "Existing 9 hook tests + existing 5 ProcedureRoom tests keep passing under Electron-as-Node ABI (no regressions)"
    requirement: CAPT-03
    verification:
      - kind: unit
        ref: tests/renderer/hooks/use-video-preview.test.ts
        status: pass
      - kind: unit
        ref: tests/renderer/pages/procedure-room.test.tsx#renders Start Preview, Finish, and disabled Record at idle
        status: pass
      - kind: unit
        ref: tests/renderer/pages/procedure-room.test.tsx#does NOT call setDefaultDevice or setPreset when the picker changes
        status: pass
      - kind: unit
        ref: tests/renderer/pages/procedure-room.test.tsx#fires capture.noDeviceAudit exactly once when the empty state renders
        status: pass
    human_judgment: false

# Metrics
duration: 15min
completed: 2026-08-03
status: complete
---

# Phase 3: Plan 08 Summary

**ProcedureRoom Stop and Finish cleanup tests are deterministic under `npm run test:unit` (Electron-as-Node ABI); useVideoPreview release ordering is documented in source and pinned by the integration contract (G-03-8 closed)**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-08-03T08:00:00Z
- **Completed:** 2026-08-03T08:15:00Z
- **Tasks:** 1 (auto Task 1)
- **Files modified:** 3 (`src/renderer/src/hooks/useVideoPreview.ts`, `tests/renderer/pages/procedure-room.test.tsx`, `tests/integration/renderer-main-capture-contract.test.ts`)

## Accomplishments

### Task 1 — Make ProcedureRoom Stop/Finish tests deterministic + pin hook release ordering (G-03-8)

- **`tests/renderer/pages/procedure-room.test.tsx`** — both the Stop test (line 102) and the Finish test (line 129) now await the `getUserMedia` mock's resolved promise (`await md.getUserMedia.mock.results[0].value`) BEFORE the `findByRole('Stop Preview')` lookup. The `md` reference is hoisted to the top of each test so the same reference is used for both the `await waitFor` and the `await mock.results[0].value` lines. The 5s safety-net timeout is preserved as defense-in-depth.
- **`src/renderer/src/hooks/useVideoPreview.ts`** — ponytail comment block added immediately above the `release()` function documenting the deterministic ordering: `requestRef.current += 1` FIRST (cancels in-flight .then), THEN capture `streamRef.current`, THEN null `streamRef.current`, THEN stop tracks. The `.then`'s cancellation branch stops tracks when `request !== requestRef.current`, so tracks are always stopped exactly once even if `release()` runs before the `.then` resolves. The `release()` body is unchanged — the comment makes the contract explicit at the call site.
- **`tests/integration/renderer-main-capture-contract.test.ts`** — new `describe('G-03-8 — useVideoPreview release ordering is deterministic')` block at the end of the file with 3 assertions on `USE_VIDEO_PREVIEW_SRC`: (i) `release()` declares `requestRef.current += 1` BEFORE `streamRef.current = null`, (ii) `release()` calls `track.stop()` AFTER `streamRef.current = null`, (iii) the `.then` cancellation branch stops tracks when `request !== requestRef.current`. Each assertion carries a failure message that names the contract being violated.

## Task Commits

Each task was committed atomically:

1. **Task 1: integration contract + hook comment + test wait fix** — `6236ab7` (fix: document useVideoPreview release ordering + await getUserMedia.then in ProcedureRoom Stop/Finish tests)

_Note: The G-03-7 integration-contract describe block (which also includes the G-03-8 release-ordering regex assertions) was committed separately in plan 03-07 as commit `2cf933a` since both gaps are pinned by the same file._

## Decisions Made

- **Fix the test, not the hook.** The hook's release ordering is correct; the flake is in the test's wait pattern. Refactoring `release()` to be more "test-friendly" would have introduced churn for the sake of a flake that's better fixed at the test boundary.
- **Hoist `md` to the top of the test.** Using the same reference for both the `await waitFor` and the `await mock.results[0].value` lines ensures they see identical mock state — important because the `getUserMedia` mock is reset between tests in the per-test `beforeEach`.
- **Keep the 5s safety-net timeout.** Defense-in-depth; the explicit `.then` await is the primary fix, but the timeout guarantees the test doesn't hang if a future refactor breaks the `.then` chain entirely.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness

- G-03-8 closed. CAPT-03 cleanup invariants (Stop and Finish release every track) now verified by automated tests. The Phase 3 verifier's "Goal achieved: false" can be flipped once the Windows-hardware UAT items complete.
- Phase 4 (Recording) is unblocked: the deterministic preview cleanup path is ready to be extended with recording-start/stop on top of the same hook pattern.

---
*Phase: 03-capture-enumeration-live-preview*
*Completed: 2026-08-03*