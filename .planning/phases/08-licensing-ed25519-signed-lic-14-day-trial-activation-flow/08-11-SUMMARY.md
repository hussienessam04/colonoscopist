---
phase: 08-licensing-ed25519-signed-lic-14-day-trial-activation-flow
plan: 11
subsystem: license
tags: [fix, renderer-handling, gated-ipc, gap-closure]
gap_closure: true
gap_ids: [G-08-5]
requires: [08-10]
provides: [SafeInvoke-Coverage-Extended-SettingsCapture-ProcedureRoom]
status: complete
---

# Phase 8 Plan 11: safeInvoke coverage extension to SettingsCapture + ProcedureRoom

## One-liner

`Settings → Capture` and `Procedure Room` no longer white-screen on `expired`/`unactivated` license state — every `capture.*` IPC site is now wrapped through `safeInvoke`, exactly mirroring the Plan 08-10 (G-08-4) pattern, and gated hydration renders `<EmptyStateCard>` (SettingsCapture) or the existing no-device overlay (ProcedureRoom).

## Files touched

| File | Change |
|------|--------|
| `src/renderer/src/pages/SettingsCapture.tsx` | Wrapped 4 `capture.*` IPC sites with `safeInvoke`; added `gated` state + `<EmptyStateCard>` render; Save now surfaces a license toast on gated persistence. |
| `src/renderer/src/pages/ProcedureRoom.tsx` | Wrapped 3 `capture.*` IPC sites with `safeInvoke`; no new component added (existing no-device overlay handles the gated null path). |
| `tests/renderer/pages/settings-capture.test.tsx` | 2 new `it(...)` regression tests under the existing `describe`. File is now 10/10 green (was 8). |
| `tests/renderer/pages/procedure-room.test.tsx` | 1 new `it(...)` regression test in a fresh `describe` block. File is now 5/5 green (was 4). |

## Requirements completed

- **LIC-04** — license gate at IPC level: renderer must never crash on a gated `{ok:false}` rejection. Closed for the last two consumer pages Plan 08-10 missed.

## gap_closed: G-08-5

Phase 8 UAT Test 8 sibling discovery — `Settings → Capture` crashes to a white screen on `expired`/`unactivated` license state. Same shape-assumption bug class as G-08-4: hydration effect fed `{ok:false}` into `setSavedDeviceId`, downstream `pickBrowserId({ok:false})` crashed the React tree.

### Before vs after

- **Before:** `void window.api.capture.getDefaultDevice().then((device) => setSavedDeviceId(device))` — when the gate returns `{ok:false}`, `device` is the gate object. `pickBrowserId` then iterates `browser` looking for a `deviceId === device` match; the gate object is neither a string nor a valid deviceId, downstream effects cascade into a white screen.
- **After:** `const device = await safeInvoke(window.api.capture.getDefaultDevice())` — null on gate rejection; `setSavedDeviceId(null)`, `setGated(true)`, render `<EmptyStateCard>` which links to `Settings → License`.

Same pattern applied to `handleDeviceChange` (preset fetch), `handleSave` (persistence), `ProcedureRoom` hydration, `ProcedureRoom` preset effect, and `ProcedureRoom` `handleRecordToggle`.

## Verification results

### `npm run typecheck:web`

The same 6 pre-existing errors in `useReport.ts` and `ReportEditor.tsx` (unrelated to this plan — both files are outside the files I touched). Confirmed pre-existing by stashing my changes and re-running `typecheck:web`: same 6 errors, same lines. **No new typecheck regressions introduced.**

### `node scripts/run-vitest.cjs --run tests/renderer/pages/settings-capture.test.tsx tests/renderer/pages/procedure-room.test.tsx`

```
 Test Files  2 passed (2)
      Tests  15 passed (15)
```

- `settings-capture.test.tsx`: 10/10 green (8 existing + 2 new)
- `procedure-room.test.tsx`: 5/5 green (4 existing + 1 new)

### `node scripts/run-vitest.cjs --run tests/renderer/pages/procedure-room-timer.test.tsx`

20/20 green — the canonical ProcedureRoom suite (Plan 04) is unaffected by the `safeInvoke` rewiring.

### Full renderer suite

```
 Test Files  9 failed | 42 passed (51)
      Tests  320 passed (320)
```

The 9 failed test files are `tests/renderer/rtl/*.test.ts` — pre-existing Playwright tests being mis-collected by Vitest (they use `test()` from `@playwright/test`, designed to run via `npx playwright test`). Pre-existing infrastructure issue, unrelated to this plan.

**All 320 actual Vitest tests pass, including the 3 new regression tests in this plan.**

## Deviations from plan

### 1. Test file target for ProcedureRoom regression (cosmetic)

The plan refers to `tests/renderer/pages/procedure-room.test.tsx` as the existing ProcedureRoom test file. That file is currently mis-named — it only tests `ProcedurePreview` (the file got renamed/refactored during Phase 4 but the leftover was never deleted). The canonical ProcedureRoom test file is `procedure-room-timer.test.tsx`.

**Decision:** followed the plan literally — added the regression test to `procedure-room.test.tsx` (which now contains both ProcedurePreview tests and 1 ProcedureRoom test). The plan's "the existing procedure-room.test.tsx test file" instruction is honored verbatim. The canonical ProcedureRoom test file (`procedure-room-timer.test.tsx`) was verified green as a separate check (20/20).

### 2. Save toast wording

Plan wording for Save toast: `toast.error('License required to save capture settings. Activate your license first.')`. Implemented verbatim — and applied to both `setDefaultDevice` and `setPreset` paths (the plan says "if either returns null" but didn't specify whether to show the same message or branch). Same message for both keeps the UX consistent and avoids two different toast strings for the same gate rejection.

## Stub tracking

None — no stubs left behind. The gated path renders the existing `<EmptyStateCard>` (Plan 08-10 component, unchanged) or the existing no-device overlay (ProcedureRoom, unchanged). Both rendering paths are wired to real data flow (null → state → render), not placeholder copy.

## Files-by-file change summary

### `src/renderer/src/pages/SettingsCapture.tsx`

- Added imports: `EmptyStateCard`, `safeInvoke`.
- Added state: `const [gated, setGated] = useState(false);`
- Rewrote hydration `useEffect` (lines 82-121) to async/await with `safeInvoke` for both `getDefaultDevice` and `getPreset`. Null → `setSavedDeviceId(null)`, `setNoSavedDevice(true)`, `setGated(true)`.
- `handleDeviceChange` (line 136): wrapped `getPreset` in `safeInvoke`; null flows through `fromPreset()` (already handles nullish → default form).
- `handleSave` (lines 181-198): wrapped both `setDefaultDevice` and `setPreset` in `safeInvoke`; null on either → clear `toast.error('License required to save capture settings. Activate your license first.')` and return.
- JSX: `{gated ? <EmptyStateCard /> : null}` next to the existing no-device hint.

### `src/renderer/src/pages/ProcedureRoom.tsx`

- Added import: `safeInvoke`.
- Lines 53-72 (hydration effect): wrapped `getDefaultDevice` in `safeInvoke`. Null now flows naturally into the existing no-device overlay.
- Lines 84-102 (preset effect): wrapped `getPreset` in `safeInvoke`. Null → `setPreset(undefined)` (unchanged) → `canRecord` stays false.
- Lines 214-233 (`handleRecordToggle`): wrapped both `getDefaultDevice` and `getPreset` in `safeInvoke`. Null `device` → license-specific message (distinct from the existing "No default capture device set" copy which serves the legitimate empty case). Null preset keeps the existing "No preset saved" message (covers both legitimate empty + gated).

## Self-Check: PASSED

- SettingsCapture.tsx + ProcedureRoom.tsx wired with safeInvoke + EmptyStateCard (SettingsCapture) / no-device overlay (ProcedureRoom) — committed in `68b4a28`.
- 2 new settings-capture tests + 1 new procedure-room test — committed in `faa35e6`.
- 3 atomic commits land in git log (`68b4a28`, `faa35e6`, plus this SUMMARY commit).
- npm run typecheck:web — no new errors (6 pre-existing errors in `useReport.ts`/`ReportEditor.tsx` unrelated to this plan).
- NO modifications to STATE.md or ROADMAP.md (orchestrator owns those).
