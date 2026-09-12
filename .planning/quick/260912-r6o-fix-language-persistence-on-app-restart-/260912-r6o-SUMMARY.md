---
slug: fix-language-persistence-on-app-restart-
date: 2026-09-12
status: complete
tasks: 3
files_changed: 8
duration_min: ~10
---

# Quick task 260912-r6o — language persistence + NotoSansArabic ENOENT + i18n sweep

Three small bugs fixed in one quick pass.

## Task 1 — i18n detector reorder (commit `c3fa61b`)

`src/renderer/src/i18n/index.ts:30` detector order was `['htmlTag', 'localStorage', 'navigator']`. `htmlTag` reads `<html lang="en">` (hardcoded in `src/renderer/index.html`) BEFORE React mounts, so it always won — the operator's saved AR choice was ignored on every boot. Swapped order to `['localStorage', 'htmlTag', 'navigator']` so the saved value wins. `caches: ['localStorage']` is unchanged — the resolved value is still persisted on first save.

One-line diff. No other change needed (the second pass of the order acts as fallback for first-launch when localStorage is empty).

**Files:** `src/renderer/src/i18n/index.ts` (1 line)

## Task 2 — NotoSansArabic TTF multi-location lookup (commit `625d758`)

`src/main/pdf/render-report-pdf.ts:94` did `path.join(__dirname, 'fonts', 'NotoSansArabic-Regular.ttf')`. The comment above claimed `__dirname` is the source tree in dev — FALSE. electron-vite emits `src/main/*` into `out/main/index.js` (single-file lib bundle, confirmed in `electron.vite.config.ts` lines 11-15), so `__dirname` is `out/main/` in BOTH dev and prod. The TTF lives at `src/main/pdf/fonts/NotoSansArabic-Regular.ttf` (verified the file exists in source) but never makes it into `out/main/fonts/` without a copy step that doesn't exist today. Result: AR PDF rendering silently degraded to Helvetica (tofu boxes for Arabic glyphs) on every boot.

Ponytail fix: small lookup tries the canonical `out/main/fonts/…` path first (forward-compatible with a future copy step / extraResources), then falls back to `out/main/../../src/main/pdf/fonts/…` (dev source tree, resolves to `src/main/pdf/fonts/NotoSansArabic-Regular.ttf` today). `existsSync` picks the first that exists; if NONE exist, the existing `try/catch` still fires (Font.register throws on empty src), `_notoArabicAvailable = false`, the AR report still writes with Helvetica fallback.

Also rewrote the stale comment block so the next reader doesn't believe the false claim about dev `__dirname`.

Ponytail comment added: "if the build is ever run as an ASAR bundle, the dev fallback may break under `app.asar/` — add a third path join at that time, no other change."

**Files:** `src/main/pdf/render-report-pdf.ts` (function + comment + new `existsSync` import)

## Task 3 — Second i18n sweep (commit `9bc6b2e`)

Same pattern as the previous sweep (260912-q4g). Added 3 new top-level namespaces (`pinEntry`, `partialAlert`, `trim`) to BOTH `en/translation.json` and `ar/translation.json`, wired `useTranslation()` in 3 components, replaced literal English with `{t('namespace.key')}`.

- **PinEntry.tsx** — `useTranslation` imported, 11 keys added. Replaced `'Back'`, `'Sign in as …'`, `'Enter your 4-digit PIN'`, `'Locked'`, `'Incorrect PIN'`, `'Try again in'`, `'Account locked — contact admin'`, `'Sign-in failed'`, `'Encryption unavailable — see logs'`, `'Signing in…'`, `'Enter'` plus 2 aria-labels.
- **DestructivePartialAlert.tsx** — `useTranslation` imported, 3 keys added. Replaced `'Partial recording'` title and the two description copy variants. Trailing space after `deviceDisconnectedPrefix` preserved so the `<span>` timestamp renders inline.
- **TrimControls.tsx** — `useTranslation` imported, 10 keys added. Replaced `'Trim'`, `'Done'`, `'In frame'`, `'Out frame'`, 2 alt texts, `'In:'`, `'· Out:'`, `'Apply'` (via `common.apply`), `'Restore original'` (via `procedure.trimRestore`), `'Trim is unavailable on partial recordings.'`, and the over-cap note interpolated `cap` value.
- **PatientProcedures.tsx** — `useTranslation` already wired. Replaced `>DOB:<` literal with `{t('common.dob')}:` (per plan: reuse existing `common.dob` + literal colon — keeps the AR font consistent).
- **ProfileEditor.tsx** — scan only. Already imports `useTranslation`, every user-visible string already routed through `t()`. The two literal-looking strings (`<Label …>العربية</Label>` and `<p>…</p>` skeleton ellipsis) are intentional (Arabic literal is correct; the ellipsis is a visual loading indicator, not user copy). No edits needed.

**Verification grep:** zero remaining literal English UI strings across the affected files (`>DOB:<`, `>Trim<`, `>Done<`, `>Apply<`, `>Locked<`, `>Restore original<`, `>Enter<`, `>Back<`, `Partial recording`, `Frame at in-point`, `Frame at out-point`, `Trim is unavailable`, `Trimming is unavailable`, `Incorrect PIN`, `Try again in`, `Account locked`, `Sign-in failed`, `Encryption unavailable`, `Back to user list`, `Sign in as`, `Enter your 4-digit`, `Signing in`, `Recording stopped because`, `Recording ended unexpectedly` — all clean).

**Files:**
- `src/renderer/src/components/PinEntry.tsx`
- `src/renderer/src/components/DestructivePartialAlert.tsx`
- `src/renderer/src/components/TrimControls.tsx`
- `src/renderer/src/pages/PatientProcedures.tsx`
- `src/renderer/src/i18n/en/translation.json` (+24 keys)
- `src/renderer/src/i18n/ar/translation.json` (+24 keys)

## Deviations

**Amended Task 2 commit to add `?? ''` fallback typecheck fix.** Original Task 2 had `const ttfPath = ttfCandidates.find(...)` returning `string | undefined`, and TypeScript flagged `src: ttfPath` as not assignable to `string`. The runtime catch already handles a missing font (Font.register throws, `_notoArabicAvailable = false`), so the fix is one-line: `?? ''` — empty string still throws inside Font.register, the existing catch handles it identically. This is a direct consequence of Task 2's path resolution change, so it was amended into the Task 2 commit rather than split off.

## Verification

- Task 1: `src/renderer/src/i18n/index.ts:30` detector order is `['localStorage', 'htmlTag', 'navigator']` (confirmed via Read).
- Task 2: `src/main/pdf/render-report-pdf.ts:100-108` tries `__dirname/fonts/...` then `__dirname/../../src/main/pdf/fonts/...` via `existsSync`; missing-font case still hits the existing catch handler. `tsc --noEmit` clean for both `tsconfig.node.json` and `tsconfig.web.json`.
- Task 3: grep across the 4 affected files returns zero literal English UI strings. EN + AR translation bundles validate as JSON and have matching key counts (11/11 pinEntry, 3/3 partialAlert, 10/10 trim). `tsc --noEmit -p tsconfig.web.json` clean.

## Manual UAT (out-of-band — requires `npm run dev` + live device)

1. Open the app, switch language to AR in Settings → Profile. Quit fully, reopen → first paint is `<html dir='rtl' lang='ar'>` and the login screen reads in Arabic.
2. Clear `localStorage.removeItem('i18nextLng')`, reload → falls back to EN (the `<html lang="en">` default).
3. With language = AR, run a procedure + finalize a report → the AR PDF writes successfully (no ENOENT in main-process console) and AR glyphs render as NotoSansArabic (not tofu).
4. Walk through: login (user picker → PIN entry → see Back / Sign in as / Enter your 4-digit PIN / Locked / Incorrect PIN / Signing in… / Enter all in Arabic), ProcedureReview partial-status alert (Partial recording / ended unexpectedly / device disconnected all in Arabic), ProcedureReview Trim panel (Trim / Done / In frame / Out frame / In/Out timestamps / Apply / Restore original / partial cap note all in Arabic), PatientProcedures header (DOB: shows as `تاريخ الميلاد:`).

## Commits

- `c3fa61b` — fix(quick): reorder i18n detector so localStorage wins over htmlTag
- `625d758` — fix(quick): multi-location NotoSansArabic TTF lookup (dev + prod)
- `9bc6b2e` — feat(quick): i18n second sweep - PinEntry + TrimControls + partial alert + DOB label
