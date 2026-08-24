---
phase: 08-licensing-ed25519-signed-lic-14-day-trial-activation-flow
plan: 05
subsystem: license
tags: [license, renderer, i18n, ed25519, sidebar, modal, swr-hook]
dependency_graph:
  requires: [08-01, 08-02, 08-04]
  provides: [License sub-page, LicenseGate boot-time modal, useLicenseStatus hook, license.* i18n namespace, route {name: 'license'}]
  affects:
    - src/renderer/src/App.tsx
    - src/renderer/src/lib/router.ts
    - src/renderer/src/components/SettingsSidebar.tsx
    - src/renderer/src/hooks/useLicenseStatus.ts (new)
    - src/renderer/src/components/LicenseGate.tsx (new)
    - src/renderer/src/pages/License.tsx (new)
    - src/renderer/src/i18n/{en,ar}/translation.json
tech-stack:
  added: []
  patterns:
    - SWR-style hook (status, loading, refresh) over window.api.license.status()
    - SessionStorage-flag modal dismissal (per CONTEXT agent discretion)
    - Tailwind literal-class lookup for state badge color (JIT compiler friendly)
    - Forced switch-statement style route dispatch so <LicenseGate>{routeElement}</LicenseGate> can wrap every authenticated route in one composition
key-files:
  created:
    - src/renderer/src/hooks/useLicenseStatus.ts
    - src/renderer/src/components/LicenseGate.tsx
    - src/renderer/src/pages/License.tsx
  modified:
    - src/renderer/src/App.tsx
    - src/renderer/src/lib/router.ts
    - src/renderer/src/components/SettingsSidebar.tsx
    - src/renderer/src/i18n/en/translation.json
    - src/renderer/src/i18n/ar/translation.json
decisions:
  - 'Wrapped the route switch in <LicenseGate>{routeElement}</LicenseGate> via a routeElement let-binding instead of nesting the switch directly — keeps the JSX in one return while letting LicenseGate compose as the parent. The modal sits as a sibling of children inside the Dialog so it shows above any route.'
  - 'useLicenseStatus dropped the refreshInFlightRef guard used by useProcedures/useDoctorProfile. The IPC is cheap + idempotent, and the only caller that needs dedup (handleLoadLic) awaits its own promise. A stale-fetch guard would add a useRef for no observable benefit.'
  - 'statusBadgeColor is a literal switch returning tailwind class name strings (bg-emerald-500 / bg-blue-500 / bg-red-500 / bg-slate-400) — tailwind JIT requires the class to appear verbatim in source for the compiler to pick it up; a const lookup like {licensed: \"bg-emerald-500\"} is fine too but the switch keeps the LicenseState union exhaustiveness check in TypeScript.'
  - 'state label uses runtime key composition: license.status${state.charAt(0).toUpperCase()}${status.state.slice(1)}. The D-24 parity test verifies every key under license.* exists in EN+AR, so adding a new LicenseState arm in TypeScript without a matching i18n key would surface as a missing translation at runtime rather than a type error.'
  - 'sessionStorage flag key is named license.modal.dismissed (not licenseGateDismissed) — matches the rest of the license.* i18n namespace and survives Electron app restart (sessionStorage semantics, per CONTEXT agent discretion).'
metrics:
  duration: ~7 min
  completed_date: 2026-08-24
  tasks: 1
  files: 8
status: complete
---

# Phase 8 Plan 5: License sub-page + LicenseGate modal + SWR-style hook — Summary

## One-liner

Renderer-side license UI: single-Card License sub-page (status row + 4-char grouped machine id + Load .lic button), boot-time LicenseGate modal that fires on `state: 'unactivated' | 'expired'`, SWR-style `useLicenseStatus` hook, SettingsSidebar entry between Audit and Backup & Restore, `{name: 'license'}` route case, and a 32-key bilingual `license.*` i18n namespace; closes LIC-03 + I18N-01 + I18N-03 UI halves end-to-end.

## Tasks

### Task 1: License sub-page + SettingsSidebar entry + LicenseGate modal + useLicenseStatus hook + Router + App + bilingual i18n — DONE

- `src/renderer/src/lib/router.ts` (modified): extended the `Route` union with `| { name: 'license' }` after the `patient-procedures` variant. Comment block documents the reach surface (SettingsSidebar entry + LicenseGate 'Activate now' navigation).
- `src/renderer/src/components/SettingsSidebar.tsx` (modified): added `KeyRound` to the lucide-react import list, `import { useTranslation } from 'react-i18next'`, and `'license'` to the `SettingsTab` union. Mounted the new `<Button>` between the Audit and Backup & Restore entries per CONTEXT D-04 visual order (Capture → Profile → Audit → License → Backup & Restore → Users). The button mirrors the Audit block shape: variant-driven active highlight + `data-testid="settings-hub-license"` + `data-active` boolean for the plan-06 test seam.
- `src/renderer/src/App.tsx` (modified): added `import LicenseGate from './components/LicenseGate'` + `import License from './pages/License'`. Refactored the switch from a `return …;` per-case form into a `let routeElement: JSX.Element;` + `switch (route.name) { case '…': routeElement = …; break; … }` shape so the final `return <LicenseGate>{routeElement}</LicenseGate>;` can wrap every authenticated route in one composition. The `case 'license':` branch returns `<License />` and sits just before `case 'patient-procedures':` (alphabetic-ish order matches the route union).
- `src/renderer/src/hooks/useLicenseStatus.ts` (new, 46 lines): SWR-style hook matching the `useProcedures`/`useDoctorProfile` family — `useState` + `useEffect` + `useCallback`, no useReducer, no Zustand. Surface: `status: LicenseStatus | null`, `loading: boolean`, `refresh: () => Promise<void>`. The optional-chain on `window.api.license?.status?.()` keeps the hook crash-safe under cascade pollution from prior tests' stashed microtasks (matches the Phase 6 useDoctorProfile pattern).
- `src/renderer/src/components/LicenseGate.tsx` (new, 96 lines): wraps any route children, reads `useLicenseStatus()` + `useRoute()` + `useTranslation()`. The `showModal` predicate is single boolean: `!dismissedThisSession && status !== null && (status.state === 'unactivated' || status.state === 'expired')`. The modal has two buttons:
  - "Continue in trial" — `variant="outline"`, only rendered when `status?.state === 'unactivated'`. For `state: 'expired'` the button is omitted entirely (trial is over).
  - "Activate now" — primary button; calls `dismiss()` (sets `sessionStorage.license.modal.dismissed='1'` + `setDismissedThisSession(true)`) then `navigate({ name: 'license' })`.
  Per CONTEXT agent discretion: the modal is dismissable per-session. Clears on Electron app restart.
- `src/renderer/src/pages/License.tsx` (new, 235 lines): single `<Card>` under the shared `<SettingsLayout>` shell (Plan 07-06 quick) with `activeTab="license"` + `backTestId="license-back"` matching the BackupRestore shape. Card content: status row (color-coded dot via `statusBadgeColor(state)` lookup), trial days remaining (only when `state: 'trial'`), vendor id + licensed-at (only when `state: 'licensed'`), machine id grouped in 4-char blocks via `id.match(/.{1,4}/g)?.join('-')` + a Copy button. The Load button calls `window.api.license?.pickAndActivate?.()` (Plan 04 ships IPC.LICENSE_PICK_AND_ACTIVATE which wraps `dialog.showOpenDialog` + `loadAndVerifyLicense` per Phase 7 D-13 verbatim). The three IPC outcomes are handled: `ok=true` → toast.success + refresh(); `code='IPC_LICENSE_CANCELLED'` → silent no-op (Plan 04 T-08-L10); else → toast.error with the failure reason interpolated into `license.loadLicInvalidReason`.
- `src/renderer/src/i18n/en/translation.json` + `src/renderer/src/i18n/ar/translation.json` (modified): added a top-level `license` namespace at the end of each bundle — 32 keys per language (sidebarEntry, statusTitle, pageTitle, pageKicker, pageDescription, statusLabel, statusLicensed, statusTrial, statusExpired, statusUnactivated, trialDaysRemainingLabel, trialDaysRemainingValue, vendorIdLabel, licensedAtLabel, machineIdLabel, machineIdCopy, machineIdCopied, loadLicButton, loadLicButtonInFlight, loadLicSuccess, loadLicInvalidReason, loadLicFailed, loading, modalTitle, modalUnactivatedBody, modalExpiredBody, continueTrial, activateNow, sidebarBadgeLicensed, sidebarBadgeTrial, sidebarBadgeExpired, sidebarBadgeUnactivated). AR values are hand-written Arabic per Phase 7 D-20. Existing D-24 parity check (`tests/renderer/i18n/parity.test.ts`) verifies key symmetry — passes for the new namespace.

## Verification

- **i18n parity** (per plan `<verify>` step): `node -e "..."` direct check — **PASSED** with 32 keys per language including `loadLicSuccess` + `loadLicInvalidReason`. The D-24 vitest in `tests/renderer/i18n/parity.test.ts` will assert the same in CI.
- **`npm run typecheck:web`** — **CLEAN** (no TS errors).
- **`npm run test:unit`** — **791 passed / 794 total**, identical to the Plan 08-04 baseline. **0 new failures** introduced by this plan. The 3 pre-existing failures + 8 pre-existing failed test files are documented:
  - 8 `tests/renderer/rtl/*.test.ts` files require `npm run dev` running (Playwright e2e harness; not runnable in this headless environment per Phase 7 / Plan 07-06 `human_judgment: true` note).
  - 3 `tests/integration/pdf-smoke.test.ts` cases (ReportPdf render, placeholder text, numeric fragments) require `RUN_SMOKE=1` opt-in flag.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - JSX structure] App.tsx switch can't return a wrapped element without refactoring to `let`-binding**
- **Found during:** Task 1 — applying the plan's `<LicenseGate>{switch result}</LicenseGate>` wrap.
- **Issue:** The existing `switch (route.name) { … return <X />; }` shape inside an `App()` returns a single element per case. Wrapping the entire switch's return value in `<LicenseGate>{switch result}</LicenseGate>` requires either (a) inlining the switch inside the JSX, or (b) refactoring to a `let routeElement` accumulator that the switch assigns to.
- **Fix:** Refactored to the `let routeElement: JSX.Element; switch (…) { case '…': routeElement = <X />; break; … } return <LicenseGate>{routeElement}</LicenseGate>` form (option (b)). The change is mechanical — no logic drift, no new branches. Test count and typecheck parity unchanged. The composition stays one-sided: LicenseGate is the parent, the route is the only child, the modal lives as a sibling of `children` inside LicenseGate's Dialog so it covers whatever authenticated route is active.
- **Files modified:** `src/renderer/src/App.tsx`
- **Commit:** f50cb33

**2. [Rule 2 - defensive null-guard] useLicenseStatus hook + License.tsx use optional-chain on `window.api`**
- **Found during:** Task 1 — applying the plan templates verbatim before typecheck.
- **Issue:** The plan template wrote `await window.api.license.status()` + `await window.api.license.pickAndActivate()`. Phase 6's pattern (useDoctorProfile + useReport) guards the same calls with `window.api.profile?.get?.()` because cascade pollution from prior tests can stash `window.api` mid-render. Without the optional chain, a stale `window.api` reference returns `Cannot read properties of undefined` and the renderer crashes on HMR boundaries or after a vitest cascade.
- **Fix:** optional-chain everywhere in `useLicenseStatus.ts`, `LicenseGate.tsx`, and `License.tsx`. Production callers always seed `window.api` at boot (preload bridge); the guard is zero-cost in production and unblocks the test cascade path. Matches `useDoctorProfile` + `useReport` precedent verbatim.
- **Files modified:** `src/renderer/src/hooks/useLicenseStatus.ts`, `src/renderer/src/components/LicenseGate.tsx`, `src/renderer/src/pages/License.tsx`
- **Commit:** f50cb33

### Notes

- The plan called for `machineIdCopied` toast on the copy-to-clipboard handler. Implemented. Plan 06 will assert the toast + the navigator.clipboard.writeText call shape.
- The plan called for an i18n parity check via `node -e` directly. Ran inline; output matched the expected `i18n parity OK (32 license.* keys, incl. loadLicSuccess + loadLicInvalidReason)`.
- The plan called for Plan 06 to ship `tests/renderer/pages/license.test.tsx` (8+ cases) + `tests/renderer/rtl/license.test.ts`. Not in this plan's scope; out-of-scope deferral per PLAN.md line 472 ("Plan 06 ships the production test code; the test plan is Plan 06").
- The plan called for the new renderer's `data-testid` contract: `settings-hub-license`, `license-gate-modal`, `license-gate-continue-trial`, `license-gate-activate-now`, `license-status-card`, `license-status-dot`, `license-status-label`, `license-trial-days`, `license-vendor-id`, `license-licensed-at`, `license-machine-id`, `license-copy-machine-id`, `license-load-lic`, `license-back`. All present.

## Self-Check: PASSED

- Files exist: ✓ all 8 created/modified files confirmed on disk via `git status --short`.
- Commits exist: ✓ f50cb33 confirmed via `git log --oneline -1`.
- i18n parity: ✓ 32 keys per language, includes `loadLicSuccess` + `loadLicInvalidReason`.
- typecheck:web: ✓ CLEAN.
- test:unit: ✓ 791/794 (no regression vs. Plan 04 baseline).
