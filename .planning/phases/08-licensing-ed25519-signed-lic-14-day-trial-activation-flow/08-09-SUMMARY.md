---
phase: 08-licensing-ed25519-signed-lic-14-day-trial-activation-flow
plan: 09
subsystem: license
tags: [fix, route-aware-modal, gap-closure]
gap_closure: true
gap_ids: [G-08-3]
requires: [08-05]
provides: [wizard-route-modal-exemption, login-route-modal-exemption]
status: complete
---

# Phase 8 Plan 9: LicenseGate wizard/login exemption Summary

One-liner: Close G-08-3 — LicenseGate modal no longer fires on the wizard or login routes, so first-launch (no users row, no trial, no license) renders the wizard cleanly.

## What changed

Two files touched, no new abstractions.

| File | Change |
|------|--------|
| `src/renderer/src/components/LicenseGate.tsx` | Widen `useRoute()` destructure to also pull `route`. Widen `showModal` predicate to add `route.name !== 'wizard' && route.name !== 'login'`. Update the file-level header comment. |
| `tests/renderer/pages/license-gate.test.tsx` | Add 2 new test cases inside the existing `describe('LicenseGate modal (LIC-03 + D-05)', ...)` block: (a) wizard route + `state='unactivated'` → no modal; (b) login route + `state='expired'` → no modal. Pattern mirrors the existing `state='trial'` test. |

## Why Shape A (LicenseGate self-aware)

LicenseGate already pulled `useRoute()` for the `'Activate now'` navigate call at line 80. Widening that destructure to also pull `route` and adding the two route comparisons to `showModal` is the smallest change with zero new dependency. The component that owns the predicate stays the component that decides the predicate.

Shape B (conditional `<LicenseGate>` wrapping in `App.tsx`) was rejected: App.tsx already special-cases wizard/login for the auth-bootstrap redirect at lines 53-58, but that concern is route-redirect, not license show/hide. Keep the show/hide decision in the same component that owns the predicate.

## Constraints honored

- `App.tsx` line 158 untouched — still `<LicenseGate>{routeElement}</LicenseGate>`.
- `Route` union (`lib/router.ts`) untouched — wizard and login remain top-level routes.
- LicenseGate not redesigned — only the `showModal` predicate widened.
- sessionStorage dismissal flag + `navigate({ name: 'license' })` flow on Activate click unchanged.
- All 6 pre-existing LicenseGate test cases stay green (state-machine + click behaviors).

## Requirements completed

- **LIC-03** — License activation flow is now reachable without the modal stacking on top of the first-time setup screens.

## Gap closed

- **G-08-3** — `08-UAT-session.md` §Gap Summary: LicenseGate modal fired DURING the wizard on first launch, blocking the form. Closed: the modal now exempts the `wizard` and `login` routes; the wizard renders cleanly; the modal still fires on every authenticated route (patients, settings, procedure, report, audit, backup-restore, etc.) for `state='unactivated'` / `state='expired'` as before.

## Verification results

- `node scripts/run-vitest.cjs --run tests/renderer/pages/license-gate.test.tsx` → **8/8 passed** (6 existing + 2 new), 250ms test time, 10.88s total.
- `npm run typecheck:web` → no new errors introduced by this plan. The 6 pre-existing errors in `useReport.ts` + `ReportEditor.tsx` are Phase 6 carry-over, out of scope, and not touched by this plan.
- `npm run typecheck:node` → not affected (only renderer code touched). Confirmed by reading the changed files; no imports from `src/main` or `src/shared` added.

## Deviations from plan

None. Plan executed exactly as written:
- Edit 1 — LicenseGate.tsx: header comment updated (lines 29-33), destructure widened (line 53), predicate widened (lines 66-71). All three edits per the plan's `<action>` block.
- Edit 2 — license-gate.test.tsx: 2 new cases inserted after the `state='licensed'` test. Pattern matches the existing `state='trial'` test. No existing tests modified.

## Stubs

None. The fix is a 2-line predicate widening + 2 new test cases — no placeholders, no TODOs, no half-wired data.

## Notes for the next plan

- The wizard's "Set up clinic" button now triggers the actual trial bootstrap (Plan 08-08 fixed the cache-invalidation half). Combined with this plan's exemption, the first-launch flow is: blank data → wizard renders → wizard completes → `LicenseGate` starts surfacing on the next paint of an authenticated route.
- The `license-gate-continue-trial` testid is still mounted only when `state === 'unactivated'`. The 2 new tests do not assert on it because the wizard/login paths never reach the modal render at all — they short-circuit before `showContinueTrial` is computed.