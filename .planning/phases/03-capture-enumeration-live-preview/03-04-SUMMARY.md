---
phase: 03-capture-enumeration-live-preview
plan: 04
subsystem: capture
tags: [react, router, dropdown-menu, settings, navigation, role-gating]
gap_closure: true
gap_ids: [G-03-1, G-03-2]

# Dependency graph
requires:
  - phase: 03-capture-enumeration-live-preview (plan 02)
    provides: settings-capture route, SettingsCapture page with device dropdown + D-09 live preview, currentUser.isFirstAdmin on useSession()
  - phase: 02-database-patient-audit-auth
    provides: role-gated settings page (SettingsUsers)
provides:
  - Patient List header Settings DropdownMenu exposing Capture (every authenticated doctor) and Users (admin only)
  - Renderer role-aware component coverage for the Settings entry point
  - Static-analysis integration contract preventing the Settings → Capture entry point from becoming unreachable again
affects:
  - 03-verify (resolves G-03-1 / G-03-2 in UAT; unblocks the 7 hardware-dependent UAT items)
  - 04-recording (Phase 4 inherits the same entry point so the doctor can change the default device after hardware swaps)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single-button 'Settings' replaced with shadcn DropdownMenu (Radix primitive already in components/ui/dropdown-menu.tsx)"
    - "Role gating moved from the trigger's `disabled` to the Users menu item's `disabled`, so the trigger is always available"
    - "Source-grep static-analysis tests pin the navigation target so a future refactor cannot silently remove the Patient List entry point"

key-files:
  created: []
  modified:
    - src/renderer/src/pages/PatientsList.tsx
    - tests/renderer/pages/patients-list.test.tsx
    - tests/integration/renderer-main-capture-contract.test.ts

key-decisions:
  - "Used the existing shadcn DropdownMenu primitives — no new package, no new icon, no new shadcn install (per project locked tech stack in PROJECT.md)"
  - "Kept the trigger labeled 'Settings' (instead of a 'Settings: Capture' subhead) so the entry point reads naturally; the menu's two items are self-describing"
  - "Admin gate reads `currentUser?.isFirstAdmin` via the existing useSession() hook — same source of truth used by PatientsList for soft-delete restore and by SettingsUsers for the admin page"
  - "Test pattern: seed mocks THEN `await session.refresh()` THEN render — mirrors the settings-users.test.tsx pattern so non-admin session seeding is deterministic across the two page tests"

patterns-established:
  - "Static-analysis contract tests should pin navigation targets with both `navigate({ name: ... })` (positive) and the literal `'settings-users'` (negative) assertions, so the regression catches both 'destination removed' and 'destination renamed' failures"

requirements-completed: [CAPT-01, CAPT-03, SET-01]

# Coverage metadata (#1602)
coverage:
  - id: P3-M1
    description: PatientList header Settings DropdownMenu exposes Capture (every doctor) and Users (admin only)
    requirement: CAPT-01, CAPT-03, SET-01, G-03-1, G-03-2
    verification:
      - kind: unit
        ref: tests/renderer/pages/patients-list.test.tsx
        status: pass
      - kind: integration
        ref: tests/integration/renderer-main-capture-contract.test.ts
        status: pass
    human_judgment: false
  - id: P3-M2
    description: Non-admin clicking the disabled Users menu item does not navigate (T-3-13, role-gated)
    requirement: SET-01, D-02
    verification:
      - kind: unit
        ref: tests/renderer/pages/patients-list.test.tsx
        status: pass
    human_judgment: false
  - id: P3-M3
    description: Static-analysis contract pins the Patient List -> settings-capture navigation so the entry point cannot silently disappear
    requirement: G-03-1, G-03-2
    verification:
      - kind: integration
        ref: tests/integration/renderer-main-capture-contract.test.ts
        status: pass
    human_judgment: false

# Metrics
duration: 18min
completed: 2026-08-02
status: complete
---

# Phase 3: Plan 04 Summary

**Renderer navigation fix: Patient List header now exposes Settings → Capture to every authenticated doctor, while preserving admin-only access to Settings → Users; closes G-03-1 and G-03-2**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-08-02T20:00:00Z
- **Completed:** 2026-08-02T20:18:00Z
- **Tasks:** 2 (tracer + integration contract)
- **Files modified:** 3 (1 source, 2 test)
- **Tests:** 8 new (6 component + 2 integration), **197/197 total green** (baseline 189 + 8)

## Accomplishments

- **`PatientsList` header Settings control is now a shadcn `DropdownMenu`** with two items:
  - **Capture** — always enabled, navigates to `{ name: 'settings-capture' }` for every authenticated doctor. This is the missing entry point that was the root cause of G-03-1 / G-03-2.
  - **Users** — `disabled` bound to `!currentUser?.isFirstAdmin`; navigates to `{ name: 'settings-users' }` only when the first admin picks it. Preserves the existing admin-only access (D-02 / SET-04 / T-3-13).
- **Role-aware component coverage (6 new tests)** — admin sees both items enabled, non-admin sees Capture enabled and Users disabled, and clicking each item routes (or does NOT route) correctly. The disabled-Users click test relies on Radix's `data-disabled` CSS rule swallowing the click before the `onSelect` fires.
- **Static-analysis integration contract (2 new tests)** — `PATIENTS_LIST_SRC` source fixture alongside the existing `ProcedureRoom` / `SettingsCapture` fixtures. The new describe block asserts both the `navigate({ name: 'settings-capture' })` literal (positive proof the entry point exists) and the `'settings-users'` literal (negative proof admin access is preserved). Future refactors that drop either string fail the contract.
- **Renderer-only fix** — no changes to routes, IPC, `SettingsCapture`, or session state. `canRestore` already existed on `PatientsList` from the soft-delete-restore work, so the admin check reuses it; no new derivation logic.

## Task Commits

1. **Task 1 RED — `8d8c0fb`** `test(03-04): add failing Settings menu role-aware coverage` — added 6 failing tests + non-admin session helper. All 6 failed because `PatientsList` still had a flat button.
2. **Task 1 GREEN — `2f17fdc`** `feat(03-04): expose Settings Capture entry from Patient List header` — replaced the Settings button with a `DropdownMenu`; 11/11 tests in `patients-list.test.tsx` green.
3. **Task 2 — `744e6cb`** `test(03-04): pin Patient List -> settings-capture contract` — added the `PATIENTS_LIST_SRC` fixture and the two static-analysis assertions; 24/24 in the integration contract file; 197/197 in the full suite.

## Files Modified

- `src/renderer/src/pages/PatientsList.tsx` — header Settings control is now a `DropdownMenu` with `Capture` + `Users` items; admin gate moved from trigger to the Users item; no other behavioral changes.
- `tests/renderer/pages/patients-list.test.tsx` — added `setNonAdminSession()` helper (mirrors the existing `setAdminSession()`); added a new `describe('PatientsList — Settings menu', ...)` block with 6 tests covering both roles, both navigation targets, and the disabled-click swallow.
- `tests/integration/renderer-main-capture-contract.test.ts` — added `PATIENTS_LIST_SRC` source fixture and a new `describe('Plan 03-04 — Patient List is the entry point for Settings → Capture (G-03-1 / G-03-2)', ...)` block with 2 static-analysis tests.

## Decisions Made

- **Trigger label is "Settings" with a gear icon**, not "Settings: Capture" or any subhead. The two menu items (Capture, Users) are self-describing; the trigger just needs to read as "settings affordance here". Adding the icon is a tiny visual affordance so the dropdown nature is discoverable without me rewriting the existing outline Button.
- **No new file for the entry-point contract.** Putting the two new integration tests in the existing `renderer-main-capture-contract.test.ts` keeps every renderer↔main cross-process contract in one place. A new file would have made the contract harder to find in the next audit.
- **Reused `canRestore` instead of introducing `isAdmin`.** `canRestore = currentUser?.isFirstAdmin ?? false` is already a local derived value; `isFirstAdmin` would have been a name-only refactor without a new behavior. Kept the diff tiny.
- **Static-analysis uses one assertion per concern.** Positive (`navigate({ name: 'settings-capture' })` regex match) and negative (`'settings-users'` literal substring) are separate `it(...)` blocks so a future failure points at the exact regression.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

- **`getRoute().name` returned `'login'` not `'patients'` in the disabled-click test.** First run of the new test failed because the test's `setRoute(initialRoute)` call set the route to `initialRoute` (which is `{ name: 'login' }` per `lib/router.ts`). Fixed by `setRoute({ name: 'patients' })` at the top of the test so the "stays on patients" assertion is meaningful. No code change to `PatientsList` required.

## UAT Gap Closure

This plan closes the two diagnosed gaps blocking the human UAT:

- **G-03-1 (Settings → Capture device dropdown populated from DirectShow)** — root cause was that the Patient List had no entry point into the existing dropdown. The dropdown itself (and D-09 live preview) was always implemented; the user just couldn't reach it. The fix makes the dropdown reachable, so the test that "the dropdown shows the actual USB DirectShow device name" can run end-to-end.
- **G-03-2 (Settings → Capture page exposes the device picker UI and all Phase 3 user-visible capture surfaces)** — same root cause: the page exists, the surfaces exist, the navigation was missing. The fix makes the page first-class in the Patient List header menu.

The 7 UAT tests that were `blocked_by: prior-issue` (Settings UI gap) are now unblocked and ready to run on a real Windows bench. The next `/gsd-verify-work` invocation should reconcile G-03-1 and G-03-2 to `status: resolved` and re-pick the 7 blocked tests.

## Next Phase Readiness

- Phase 3 is now feature-complete from a renderer entry-point perspective.
- `/gsd-verify-work` can resume the blocked Windows hardware UAT (DirectShow enumeration, EasyCap preset auto-detect, real camera permission flow, real device-lost handling). These tests need a Windows workstation with USB capture devices plugged in.
- Phase 4 (recording) is unblocked: doctors can already change the default device via the new entry point, so the ffmpeg child in Phase 4 will pick up the doctor's most recent choice on the first procedure of the day.

---

*Phase: 03-capture-enumeration-live-preview*
*Plan: 04*
*Completed: 2026-08-02*

## Self-Check: PASSED

- 03-04-SUMMARY.md exists at `.planning/phases/03-capture-enumeration-live-preview/03-04-SUMMARY.md`
- All four commits present in `git log`:
  - `8d8c0fb` test(03-04): add failing Settings menu role-aware coverage
  - `2f17fdc` feat(03-04): expose Settings Capture entry from Patient List header
  - `744e6cb` test(03-04): pin Patient List -> settings-capture contract
  - `d185d0e` docs(03-04): complete capture-settings gap closure plan
- Full test suite: **197/197 green** (baseline 189 + 8 new)
- Full typecheck (`npm run typecheck`): clean
- Patient List now exposes a role-aware Settings DropdownMenu (Capture for every doctor, Users for first admin)
- G-03-1 and G-03-2 entry-point gap closed; 7 previously-blocked UAT items unblocked for `/gsd-verify-work`
