---
phase: 03-capture-enumeration-live-preview
plan: 07
subsystem: api
tags: [ipc, react, settings, gap-closure, type-contract, tdd]
gap_closure: true
gap_ids: [G-03-7]

# Dependency graph
requires:
  - phase: 03-capture-enumeration-live-preview (plan 01)
    provides: "main capture IPC handlers (listDevices / getDefaultDevice / setDefaultDevice / getPreset / setPreset / noDeviceAudit) + renderer preload bridge + QualityPreset type"
  - phase: 03-capture-enumeration-live-preview (plan 02)
    provides: "SettingsCapture page with fromPreset() hydration path + ProcedureRoom preset consumption via useVideoPreview.presetHints()"
provides:
  - "Main `getPreset()` returns bare `QualityPreset | null` — matches the `IpcContract.capture.getPreset` declared shape `Promise<QualityPreset | null>`"
  - "Saved custom presets now hydrate correctly in production renderer: Custom radio is checked, resolution input shows saved value, framerate shows saved fps"
  - "Integration-contract G-03-7 describe block pins (a) the declared contract regex, (b) the main source return-type regex AND the wrapper-literal absence, (c) the preload forwarder unchanged"
  - "Saved-preset hydration regression test in SettingsCapture renderer test suite"
  - "Q-A audit metadata still emits `matched` on first-save and skips it on subsequent reads — audit branches read from the local `getOrAutoDetectPreset` return, not the IPC return expression"
affects:
  - 03-verify (resolves G-03-7 — SET-02 + roadmap success criterion 3 now verified)
  - 04-recording (Phase 4 inherits the corrected IPC response shape)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "TDD tracer pattern for IPC contract drift: RED integration-contract regex assertions first, then fix the main boundary, GREEN re-run"
    - "Static-analysis contract pins both the positive regex (declared bare shape) AND the negative literal (wrapper absent) — a future refactor that re-introduces the wrapper fails both halves"
    - "Audit metadata decoupling: the local typed return `{ preset, matched?, isFirstSave }` keeps Q-A intact while the IPC response drops the wrapper — only the IPC return expression changes, not the audit branches"

key-files:
  created: []
  modified:
    - src/main/ipc/capture.ts
    - tests/main/capture/audit-trace.test.ts
    - tests/integration/renderer-main-capture-contract.test.ts
    - tests/renderer/pages/settings-capture.test.tsx

key-decisions:
  - "Drop the wrapper at the main boundary (`return result.preset;`) rather than reshape the contract — the contract was already correct (`Promise<QualityPreset | null>` at `src/shared/ipc-contract.ts:180`); main was the only side that drifted"
  - "Keep `MatchedPattern` import in main (still used by `getOrAutoDetectPreset`'s local typed return) — only the IPC return type and trailing return expression change"
  - "Use static-analysis regex contract (not runtime Electron assertion) — sufficient for a BLOCKER 4-class shape check, no native-module runtime needed"
  - "In the SettingsCapture regression test, await the hydration state via `waitFor(() => expect(customRadio).toBeChecked())` rather than `findByTestId` alone — the radio element exists from the initial render (with `kind: 'hd'`), only the checked state propagates after the `getPreset` promise resolves"

patterns-established:
  - "When a latent IPC contract drift is discovered, write the integration-contract pinning test FIRST and confirm it RED-fails on the buggy source before fixing main — the test pins the contract before the fix muddles the diagnosis"

requirements-completed: [CAPT-02, SET-02]

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "Main `getPreset()` returns bare `QualityPreset | null` — wrapper `{ preset, matched }` dropped at the IPC boundary (G-03-7)"
    requirement: SET-02, CAPT-02
    verification:
      - kind: integration
        ref: tests/integration/renderer-main-capture-contract.test.ts#G-03-7 — getPreset IPC response matches contract > src/main/ipc/capture.ts getPreset returns bare QualityPreset (or null) — no matched wrapper
        status: pass
      - kind: integration
        ref: tests/integration/renderer-main-capture-contract.test.ts#G-03-7 — getPreset IPC response matches contract > IpcContract.capture.getPreset declares Promise<QualityPreset | null>
        status: pass
      - kind: integration
        ref: tests/integration/renderer-main-capture-contract.test.ts#G-03-7 — getPreset IPC response matches contract > preload getPreset forwarder unchanged — still invokes IPC.CAPTURE_GET_PRESET
        status: pass
    human_judgment: false
  - id: D2
    description: "Saved custom presets hydrate in production renderer: Custom radio is checked, resolution input shows saved value, framerate shows saved fps"
    requirement: SET-02
    verification:
      - kind: unit
        ref: tests/renderer/pages/settings-capture.test.tsx#hydrates a saved custom preset from getPreset (G-03-7)
        status: pass
    human_judgment: false
  - id: D3
    description: "Q-A audit metadata: first-save auto-detect writes `matched` regex, subsequent reads do not"
    requirement: CAPT-02
    verification:
      - kind: unit
        ref: tests/main/capture/audit-trace.test.ts#capture IPC audit trace > first-save auto-detect emits `matched` regex metadata; subsequent reads do not (Q-A)
        status: pass
      - kind: unit
        ref: tests/main/capture/audit-trace.test.ts#capture IPC audit trace > getPreset + setPreset + setDefaultDevice + noDeviceAudit all write expected audit rows
        status: pass
    human_judgment: false

# Metrics
duration: 25min
completed: 2026-08-03
status: complete
---

# Phase 3: Plan 07 Summary

**Main `getPreset()` now returns bare `QualityPreset | null` matching the declared IPC contract; saved custom presets hydrate correctly in production renderer; integration-contract regex pins the bare shape against future drift (G-03-7 closed)**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-08-03T07:35:00Z
- **Completed:** 2026-08-03T08:00:00Z
- **Tasks:** 2 (tracer Task 1 + auto Task 2)
- **Files modified:** 4 (`src/main/ipc/capture.ts`, `tests/main/capture/audit-trace.test.ts`, `tests/integration/renderer-main-capture-contract.test.ts`, `tests/renderer/pages/settings-capture.test.tsx`)

## Accomplishments

### Task 1 — Drop `getPreset` wrapper at main boundary + integration-contract pinning (G-03-7)

- **`src/main/ipc/capture.ts`** — `getPreset()` return type annotation changed from `{ preset: QualityPreset; matched: MatchedPattern | null }` to `QualityPreset | null`; the trailing `return { preset: result.preset, matched: result.matched ?? null };` replaced with `return result.preset;` (preceded by a ponytail comment documenting the Q-A audit-metadata decoupling). The if/else audit branches are unchanged — they still read `result.matched` from the local `getOrAutoDetectPreset` return. `MatchedPattern` import is kept (still used by the local typed return).
- **`tests/integration/renderer-main-capture-contract.test.ts`** — new `describe('G-03-7 — getPreset IPC response matches contract')` block with 3 assertions: (i) `IpcContract.capture.getPreset` declares `Promise<QualityPreset | null>`; (ii) `src/main/ipc/capture.ts` source regex `/export function getPreset[\s\S]{0,500}QualityPreset \| null/m` matches AND the literal `{ preset: result.preset, matched: result.matched` is absent; (iii) preload `getPreset` forwarder still calls `ipcRenderer.invoke(IPC.CAPTURE_GET_PRESET, input)`. A future refactor that re-introduces the wrapper fails the contract test before it ships.
- **`tests/main/capture/audit-trace.test.ts`** — assertion at lines 88-92 updated from the wrapper shape `{ preset: { preset: 'custom', resolution: '720x480', framerate: 30 }, matched: null }` to the bare shape `{ preset: 'custom', resolution: '720x480', framerate: 30 }`. The surrounding audit-row assertions (action sequence, user_id, deviceName, manual preset row has no matched field, subsequent-read row has no matched field) are unchanged.

### Task 2 — Saved custom-preset hydration regression test in SettingsCapture (G-03-7)

- **`tests/renderer/pages/settings-capture.test.tsx`** — new `it('hydrates a saved custom preset from getPreset (G-03-7)', ...)` case. Sets `api.capture.getPreset.mockResolvedValue({ preset: 'custom', resolution: '1280x720', framerate: 30 })`, renders `<SettingsCapture />`, awaits hydration via `waitFor(() => expect(customRadio).toBeChecked())`, then asserts the resolution input value is `'1280x720'` and the framerate select text contains `'30 fps'`. The existing 7 settings-capture tests keep passing unchanged.

## Task Commits

Each task was committed atomically:

1. **Task 1: integration contract tests (RED)** — `2cf933a` (test: pin getPreset IPC response contract + useVideoPreview release ordering)
2. **Task 1: main getPreset wrapper drop (GREEN)** — `f15b375` (fix: drop getPreset wrapper at main boundary to match declared contract)
3. **Task 2: settings-capture hydration test** — `f700bcb` (test: pin saved custom-preset hydration in SettingsCapture)

## Decisions Made

- **Fix at main, not contract.** The contract was already correct; only main drifted. Reshaping the contract would have touched renderer mocks + tests across multiple plans. The one-line change at the main boundary restores the declared shape with zero renderer churn.
- **Static-analysis contract over runtime Electron assertion.** Sufficient for BLOCKER 4-class shape checks; no native-module runtime needed. Existing 37/37 integration contract suite keeps the same operational model.
- **Audit branches unchanged.** The local `getOrAutoDetectPreset` typed return keeps `matched?` so Q-A audit metadata still emits on first-save. Only the IPC return expression drops the wrapper. This decoupling is what makes the fix safe — Q-A is preserved with zero drift.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- **`better-sqlite3` Node 24 native binding absent.** Running `npm run test:unit` for the main capture suite failed with "no such file" on the binding; the verifier's `03-VERIFICATION.md` already noted this as environmental. Resolved by running `node_modules\.bin\electron-rebuild.cmd -f -w better-sqlite3` — rebuild completed; subsequent test runs use the Electron-ABI binding and pass.

## Next Phase Readiness

- G-03-7 closed. SET-02 (SD/HD/Custom remembered per doctor) now verified end-to-end through production hydration. The Phase 3 verifier's "Goal achieved: false" can be flipped once G-03-8 (already executed in plan 03-08) and the Windows-hardware UAT items complete.
- Phase 4 (Recording) is unblocked: `getPreset` is the last contract-drift hotfix in the capture IPC surface; subsequent plans can rely on the declared `Promise<QualityPreset | null>` shape.

---
*Phase: 03-capture-enumeration-live-preview*
*Completed: 2026-08-03*