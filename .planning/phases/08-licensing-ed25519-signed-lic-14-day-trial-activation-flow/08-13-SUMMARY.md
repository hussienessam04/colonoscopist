---
phase: 08-licensing-ed25519-signed-lic-14-day-trial-activation-flow
plan: 13
subsystem: renderer-license-ui
tags: [ui-audit, i18n, a11y, license]
status: complete
requires:
  - Plan 08-05 (License sub-page + useLicenseStatus)
  - Plan 08-10 (EmptyStateCard consumers)
provides:
  - license.machineIdCopyFailed / trialEndsToday / continueWithTrial i18n keys
  - trialDaysRemainingValue + sidebarBadgeTrial plural sets (EN 2 forms, AR 6 CLDR forms)
  - SettingsSidebar License status dot + badge (settings-hub-license-dot / -badge testids)
affects:
  - src/renderer/src/pages/License.tsx
  - src/renderer/src/components/SettingsSidebar.tsx
tech-stack:
  added: []
  patterns:
    - i18next plural suffixes via `count` (matches existing patient.total)
    - state signalled by colour + glyph + text (never colour alone)
key-files:
  created: []
  modified:
    - src/renderer/src/pages/License.tsx
    - src/renderer/src/components/EmptyStateCard.tsx
    - src/renderer/src/components/SettingsSidebar.tsx
    - src/renderer/src/components/LicenseGate.tsx
    - src/renderer/src/i18n/en/translation.json
    - src/renderer/src/i18n/ar/translation.json
    - tests/renderer/pages/license.test.tsx
    - tests/renderer/i18n/parity.test.ts
decisions:
  - Renamed continueTrial -> continueWithTrial in place instead of adding a second key and leaving a dead one
  - Kept statusLicensed/Trial/... as the License page status label; sidebarBadge* keys get their real usage site in SettingsSidebar (no duplicate wording on the page)
  - Relaxed the D-24 parity orphan check to accept AR-only CLDR plural categories whose base key exists in EN
requirements-completed: [LIC-03, I18N-03]
metrics:
  duration: ~25m
  completed: 2026-09-05
  files-touched: 8
  commits: 3
---

# Phase 8 Plan 13: UI Audit Fix Sweep Summary

All 12 findings from `08-UI-REVIEW.md` (3 blockers + 9 warnings) closed with renderer-only changes — no new dependencies, no main-process or IPC changes.

## What Changed

**Blockers**

1. `License.tsx` clipboard catch toasted `loadLicFailed` ("Failed to activate license") after a Copy failure — now toasts the new `license.machineIdCopyFailed` ("Couldn't copy — please copy manually").
2. `trialDaysRemainingValue` + `sidebarBadgeTrial` rendered one string for every count ("1 days", "5 يوم"). Both now use i18next's `count` plural resolution: EN gets `_one`/`_other`, AR gets all six CLDR categories (`_zero`/`_one`/`_two`/`_few`/`_many`/`_other`) with hand-written Arabic. `trialDaysRemaining === 0` renders the new `trialEndsToday` copy instead of "0 days".
3. The four `sidebarBadge*` keys had no usage site. `SettingsSidebar` now consumes `useLicenseStatus()` and renders a colour dot (`settings-hub-license-dot`, carries `data-state`) plus the state label (`settings-hub-license-badge`) on the License entry.

**Warnings**

- Status dot removed from `CardTitle` and moved into the Status grid row (no more duplicate status signalling).
- Status is no longer colour-only: the dot is paired with a per-state lucide glyph (Check / Clock / AlertTriangle / Minus) and the text label.
- `EmptyStateCard` uses shadcn `<Button variant="outline" size="sm">` instead of a link-styled raw `<button>`.
- Unactivated dot `bg-slate-400` → `bg-slate-500`.
- Both `border-slate-200` separators → `border-border` theme token.
- Loading state lost its `italic`.
- `LicenseGate` "Continue in trial" → `continueWithTrial` ("Start trial" / "ابدأ الفترة التجريبية").

## Files Touched

6 source/i18n files + 2 test files (see frontmatter).

## Verification

| Check | Result |
|-------|--------|
| `npm run typecheck:web` | No new errors. 7 pre-existing errors in `useReport.ts` / `ReportEditor.tsx` (uncommitted report-templates work, out of scope) remain unchanged. |
| `tests/renderer/pages/license.test.tsx` | 9/9 pass |
| `tests/renderer/pages/license-gate.test.tsx` | 8/8 pass |
| `tests/renderer/i18n/parity.test.ts` | 5/5 pass |
| `tests/renderer/components/**` (regression sweep incl. settings-sidebar) | 93/93 pass across 12 files |

## Deviations from Plan

1. **[Rule 3 — blocking] Parity test rejected the AR plural forms.** `tests/renderer/i18n/parity.test.ts` enforces exact key symmetry in *both* directions, so AR's `_zero`/`_two`/`_few`/`_many` (categories English does not have) would have failed as "orphaned AR keys". Relaxed the orphan check to accept an AR-only key whose base key exists in EN, and only when the suffix is a real CLDR plural category. The forward check (every EN key has an AR key) is untouched.
2. **[Rule 1 — bug] Existing test asserted the old dot colour.** `license.test.tsx:122` asserted `bg-slate-400`; Warning 7 changes it to `bg-slate-500`. Updated the assertion (commit 2).
3. **Renamed `continueTrial` rather than adding `continueWithTrial` beside it.** The plan allowed either; renaming avoids shipping a dead key. No consumer or test references the old key by name.
4. **Did not render the `sidebarBadge*` string on the License page Status row** (plan Step 2.7). It would print "Licensed" and "Licensed · Perpetual" on the same row. The keys get their genuine usage site in `SettingsSidebar` (Blocker 3), which is what the audit asked for.

## Self-Check: PASSED

- All 8 modified files present on disk.
- Commits `5edf19c` (source + i18n) and `c7228ba` (tests) in `git log`.
