---
status: complete
task: 20260811-profile-sidebar-and-lang
created: 2026-08-11
completed: 2026-08-11
commits:
  - 2fa2087 (fix/quick)
  - 3ce47df (docs/quick)
---

# Quick Task Summary — ProfileEditor Sidebar + Language Change

## What shipped

- **Bug 1 fix — `SettingsSidebar` now mounts on ProfileEditor** with `activeTab="profile"`. The page layout restructured from `mx-auto flex max-w-3xl flex-col gap-4` to `mx-auto grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]`. First grid cell = `<SettingsSidebar activeTab="profile" />`; second grid cell = `<div className="flex flex-col gap-4">` wrapping the existing header + 3 Cards (Clinic, Assets, Language). Back button, all 3 Cards' content, and the indicator logic untouched. Matches the canonical SettingsCapture / SettingsUsers / BackupRestore grid pattern.
- **Bug 2 fix — `handleLanguageChange` now calls `i18n.changeLanguage`** after the DB write + audit row Promise.all resolves. Destructured `i18n` from `useTranslation()`; added it to the `useCallback` deps. The existing `<LanguageApplier />` in `main.tsx` (calling `useLanguage()`) now picks up the change via the `i18n.language` useEffect and flips `<html dir>` + `<html lang>` + every `useTranslation()` consumer's t() output. Mirrors `Wizard.tsx:74`'s `await i18n.changeLanguage(language)` pattern exactly. Sequential order preserved — DB write fires first; if it throws, the catch block fires `toast.error` and the UI flip is skipped (consistent state).
- **`tests/renderer/pages/profile-editor.test.tsx`** — 2 new cases (file count: 9 → 11):
  1. `SettingsSidebar mounts with activeTab="profile" (profile button active, others inactive)` — mirrors the existing `settings-capture.test.tsx` / `settings-users.test.tsx` sidebar mount contract; asserts all 5 sidebar entries mount and only the Profile button carries `data-active="true"`.
  2. `clicking AR radio calls i18n.changeLanguage("ar") (the missing call that fixed Bug 2)` — `vi.spyOn(i18n, 'changeLanguage')` after lazy-importing `@/i18n`; waits for the call with `waitFor(1500)`. Sanity check that `profile.update` still receives `language: 'ar'`.
- **Test seam swap** — first attempt used the Option A plan path (assert `document.documentElement.dir === 'rtl'` after the click). happy-dom's `dir` mutation requires a `useEffect` consumer of `i18n.language`, which lives in `<LanguageApplier />` mounted only via `main.tsx`. Renderer tests bypass `main.tsx`, so no `useEffect` fires in test → `dir` stays empty. Switched to Option B (spy on `i18n.changeLanguage`) — same DOM outcome in production (LanguageApplier mounted), tighter assertion in test (the missing call site itself). Documented inline with `ponytail:` comment.

## Non-changes (deliberate scope)

- `useLanguage.ts` — untouched (already reacts to `i18n.language` via useEffect).
- `main.tsx` — untouched (LanguageApplier mount unchanged).
- `i18n/index.ts` — untouched (no new keys, no init changes).
- `SettingsSidebar.tsx` — untouched (already supports `activeTab="profile"`).
- `Wizard.tsx` — untouched (already correct; ProfileEditor mirrors its pattern).

## Stats

- Files: 2 modified (ProfileEditor.tsx + profile-editor.test.tsx)
- Net diff: +94 / -5
- Tests: 11/11 profile-editor (was 9; +2 new) + 5/5 parity (unchanged)
- Full suite: 669 passing (was 667; +2 new) — same 9 pre-existing failing files (8 Playwright e2e tests in `tests/renderer/rtl/` that should run via `npm run test:e2e`, not unit; 1 PDF smoke test from Phase 6 plan 06-03 with the 5KB threshold deviation documented in 07-06). Net effect on unit suite: +2 passing, 0 new failures.
- Typecheck: node + web both clean.

## Deviations / Notes

- **Test seam deviation from PLAN.md Option A → Option B.** Plan suggested asserting `document.documentElement.dir === 'rtl'` after the click. That requires `<LanguageApplier />` to be mounted, which only happens through `main.tsx`. Renderer tests bypass `main.tsx` (they import pages directly), so the `useEffect` consumer of `i18n.language` never fires in the test → `dir` stays at happy-dom's default empty string. The internal-call spy (`vi.spyOn(i18n, 'changeLanguage')`) is the right assertion seam — it's exactly the missing call site that was the bug. The production DOM outcome (`dir='rtl'`) is verified by the existing Phase 7 Plan 07-06 Playwright RTL smoke (e2e suite, not unit).
- **Dependency-array stability for `useCallback`** — added `i18n` to the deps. react-i18next returns a stable `i18n` instance per render cycle (singleton bound to module scope); the new dep doesn't cause re-renders or test flakiness.