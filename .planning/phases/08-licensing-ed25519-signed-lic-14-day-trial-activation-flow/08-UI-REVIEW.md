# Phase 08 — UI Review

**Audited:** 2026-09-05
**Baseline:** Abstract 6-pillar standards (no UI-SPEC.md)
**Screenshots:** Not captured (no dev server on :3000 / :5173 / :8080)
**Scope:** `LicenseGate.tsx`, `EmptyStateCard.tsx`, `pages/License.tsx`, `SettingsSidebar.tsx`, `hooks/useLicenseStatus.ts`, `i18n/{en,ar}/translation.json` `license.*` keys

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 2/4 | Clipboard error reuses "Failed to activate license"; AR pluralization missing; "Continue in trial" is awkward |
| 2. Visuals | 3/4 | Card layout is clean, but status dot is duplicated (title + grid), EmptyStateCard uses link-styled `<button>` instead of `<Button>` |
| 3. Color | 3/4 | Semantic dot colors correct, but state communicated by color only (a11y fail); `bg-slate-400` is too muted; hardcoded `border-slate-200` |
| 4. Typography | 3/4 | Clean hierarchy; `font-mono` applied to IDs/timestamps; trial-row lacks zero-state copy |
| 5. Spacing | 4/4 | Consistent Tailwind scale, no arbitrary values, responsive button (`w-full sm:w-auto`) |
| 6. Experience Design | 2/4 | Modal flow + dismiss/navigate is correct; BUT sidebar badge keys unused in audited files, clipboard-error copy bug, missing singular/plural in AR + EN |

**Overall: 17/24**

---

## Top 3 Priority Fixes

1. **Clipboard-error reuses the wrong translation key** — `src/renderer/src/pages/License.tsx:111-116` catches `navigator.clipboard.writeText` failures and toasts `t('license.loadLicFailed')` which renders "Failed to activate license" / "فشل تفعيل الترخيص" — wrong context, confusing the doctor after they tap Copy on their own machine ID. Add a new i18n key `license.machineIdCopyFailed` ("Couldn't copy — please copy manually") and call it instead.
   *Impact: cosmetic but misleading — a Copy failure toast saying "activation failed" makes the user think their license is broken.*

2. **AR pluralization missing on `trialDaysRemainingValue` + `sidebarBadgeTrial`** — `src/renderer/src/i18n/ar/translation.json:504` and `:522` render `"{{days}} يوم"` for 1, 5, 14, 30 days all the same way. Arabic plural forms: 1 → يوم, 2 → يومين, 3–10 → أيام, 11–99 → يوماً. EN (`translation.json:504`) renders `"1 days"` with no singular form either — same pattern bug in both languages.
   *Impact: shipping this to an Arabic clinic prints "5 يوم" on a Trial badge — readable but grammatically wrong; this is the primary language for GCC small clinics per PROJECT.md. Fix: add `_one` / `_two` / `_few` / `_other` keys (i18next ICU-style) like `patient.total` already does (en:23-26, ar:75-77).*

3. **Sidebar License entry shows no status dot / badge in the audited `SettingsSidebar.tsx`** — `src/renderer/src/components/SettingsSidebar.tsx:86-95` renders only the static `t('license.sidebarEntry')` ("License" / "الترخيص"). The four `sidebarBadge{Licensed,Trial,Expired,Unactivated}` keys are defined in both `translation.json` bundles (en:521-524, ar:521-524) but have **no usage site** in any audited file. UAT Test 8 expects "colored dot + label: green dot + 'Licensed · Perpetual'" and the UAT session note ("3 of 4 states verified") implies the badge lives elsewhere — likely `App.tsx` or a wrapper not in this audit's scope.
   *Impact: doctors cannot tell at a glance whether they're on Trial or Expired without opening the License page — defeats the "doctor can tell from the sidebar" UX goal. Verify the badge code lives outside audit scope or wire it here.*

---

## Detailed Findings

### Pillar 1: Copywriting (2/4)

**Findings (file:line — issue):**

- `src/renderer/src/pages/License.tsx:115` — clipboard catch toasts `t('license.loadLicFailed')` ("Failed to activate license" / "فشل تفعيل الترخيص"). Wrong message for a Copy-button failure; user thinks their license broke. **Bug.**
- `src/renderer/src/i18n/en/translation.json:504` — `"trialDaysRemainingValue": "{{days}} days"` has no `_one` suffix. Renders "1 days" on first day of trial.
- `src/renderer/src/i18n/ar/translation.json:504` — `"{{days}} يوم"` has no Arabic plural forms. i18next supports `_zero`/`_one`/`_two`/`_few`/`_many`/`_other` for AR (see `patient.total` at en:23-26, ar:75-77 for the existing pattern).
- `src/renderer/src/i18n/en/translation.json:522` — `"sidebarBadgeTrial": "Trial · {{days}}d remaining"` uses single-letter "d" abbreviation; inconsistent with `trialDaysRemainingValue` which spells "days". Either spell it out (`"Trial · {{days}} day(s) remaining"`) or use `_one`/`_other`.
- `src/renderer/src/i18n/ar/translation.json:522` — `"تجريبي · {{days}} يوم متبقي"` — same pluralization issue, plus "متبقي" attached always, doesn't agree with the noun.
- `src/renderer/src/components/LicenseGate.tsx:105` — `continueTrial: "Continue in trial"`. Awkward phrasing — "Continue with trial" or "Start 14-day trial" reads better. Cosmetic.
- `src/renderer/src/i18n/en/translation.json:515` — `"loading": "Loading license status…"` — lowercase "loading" while the parent `common.loading` (line 3) is "Loading…". Minor copy inconsistency (this is the only `license.loading`; could just use `common.loading`).
- `src/renderer/src/i18n/en/translation.json:492-526` — 34 keys in `license.*` namespace. EN and AR parity holds at the key level (D-24 parity test per `08-05-SUMMARY.md:107`). Spot-checks confirm both languages read naturally for `modalTitle`, `modalUnactivatedBody`, `modalExpiredBody`, `activateNow`, `loadLicButton`, `loadLicButtonInFlight`, `loadLicSuccess`, `emptyStateMessage`. No mixed-language contamination.
- `src/renderer/src/i18n/ar/translation.json:518` — `"modalExpiredBody": "انتهت الفترة التجريبية البالغة 14 يوماً. يرجى إرسال معرّف الجهاز إلى دعم Colonoscopist للحصول على ملف ترخيص."` — actionable, names the support channel, tells the user what file is needed. Good error recovery copy.
- `src/renderer/src/components/EmptyStateCard.tsx:22` — falls back to `t('license.emptyStateMessage')`: "License required — open Settings → License to activate." / "الترخيص مطلوب — افتح الإعدادات → الترخيص للتفعيل." Clear about both why (license required) and what (open Settings → License).

### Pillar 2: Visuals (3/4)

**Findings:**

- `src/renderer/src/pages/License.tsx:133-247` — single `<Card>` with `CardHeader` (KeyRound icon + title + colored dot) + `CardContent` (3-column grid rows + full-width Load button). Clean, follows `SettingsLayout` shell. No layout defects.
- `src/renderer/src/pages/License.tsx:138-145` vs `License.tsx:151-156` — the colored status dot appears in the `CardTitle` ("License status" label), AND the first grid row repeats "Status: Trial" (text only, no dot). Redundant — the dot should live next to the "Status" grid label, not in the title. **Visual hierarchy finding.**
- `src/renderer/src/components/EmptyStateCard.tsx:24-31` — uses raw `<button>` styled as `text-sm font-medium text-primary underline`. The rest of the gated-IPC flow uses shadcn `<Button>` components (see `License.tsx:227`). Deviation in CTA visual weight between EmptyStateCard consumers and the License page itself. Same `data-testid="gated-empty-state-open-license"` would work either way; the inconsistency is the styling.
- `src/renderer/src/components/LicenseGate.tsx:89-115` — modal uses shadcn `<Dialog>` correctly. Title, Description, Footer with conditional second button. Clean.
- `src/renderer/src/components/SettingsSidebar.tsx:51-119` — sidebar entry added between Audit and Backup & Restore per CONTEXT D-04. Uses the same `<Button>` pattern as siblings. No new visual noise introduced.
- `src/renderer/src/components/LicenseGate.tsx:99-107` — when `state === 'expired'`, the outline "Continue in trial" button is hidden entirely (only "Activate now" renders). Correct UX (trial is over).
- `src/renderer/src/pages/License.tsx:198-219` — machine id row: value + Copy icon-button on the same line, with `font-mono break-all` for the id. Good — avoids overflow on long hex strings. Copy button has `aria-label={t('license.machineIdCopy')}` (line 214). Accessibility win.
- `src/renderer/src/pages/License.tsx:151, 159, 173, 182, 198` — every grid row uses the same `pb-2 border-b border-slate-200` separator except the last row (machine id, line 198). Consistent rhythm.
- `src/renderer/src/pages/License.tsx:227-244` — Load button is `size="lg" className="w-full sm:w-auto"`. Full-width on mobile, auto-width on ≥sm. Good responsive treatment.

### Pillar 3: Color (3/4)

**Findings:**

- `src/renderer/src/pages/License.tsx:54-65` — `statusBadgeColor` switch returns literal Tailwind class strings (`bg-emerald-500` / `bg-blue-500` / `bg-red-500` / `bg-slate-400`). Tailwind JIT picks them up. Correct mapping for the 4 LicenseStates.
- `src/renderer/src/pages/License.tsx:138-144` — status dot is rendered at `size-2` (8px). For `state === 'unactivated'`, the `bg-slate-400` is very muted against a `bg-card` background; hard to see at clinical glance distance. Consider a 2px outline ring or larger size for the gray state.
- **Color-only state differentiation** — the dot is the *only* visual signal that distinguishes Licensed / Trial / Expired / Unactivated. A red-green colorblind user cannot reliably distinguish `bg-emerald-500` from `bg-slate-400` (both look gray-green) nor `bg-blue-500` from `bg-slate-400`. **Accessibility finding** — pair the color with an icon (Check, Clock, X, Minus) or a text label rendered inline.
- `src/renderer/src/pages/License.tsx:151, 159, 173, 182, 198` — every separator border uses hardcoded `border-slate-200`. Other pages (e.g. `pages/PatientsList.tsx:304`) also hardcode slate borders, so this is at least consistent with codebase, but inconsistent with shadcn theme tokens (`border-border`).
- `src/renderer/src/components/EmptyStateCard.tsx:27` — button uses `text-primary` (theme color, not hardcoded). Good.
- `src/renderer/src/components/EmptyStateCard.tsx:21` — message uses `text-muted-foreground` (theme color). Good.
- **Sidebar License entry has no colored status dot or badge in audited `SettingsSidebar.tsx:86-95`**. The four `sidebarBadge{Licensed,Trial,Expired,Unactivated}` keys are defined in i18n but no usage found in audited files. **Color Pillar finding + Experience Design finding** — see Priority Fix #3.
- `src/renderer/src/components/LicenseGate.tsx:108-110` — "Activate now" Button uses default shadcn variant (theme `bg-primary text-primary-foreground`). Correct primary CTA emphasis. The outline "Continue in trial" (line 100-106) is correctly de-emphasized as secondary.

### Pillar 4: Typography (3/4)

**Findings:**

- `src/renderer/src/pages/License.tsx` text sizes used: `text-sm` (CardDescription, grid rows, machine id), `text-xs` (loading state, machine id Copy icon), `text-2xl` (inherited from shadcn CardTitle). Three sizes — within the ≤4 budget.
- Font weights: `font-medium` (CardTitle inherits), `font-semibold` (sidebar header), `font-mono` (technical IDs). Three weights — within the ≤2 budget.
- `src/renderer/src/pages/License.tsx:176, 188, 205` — `font-mono` correctly applied to vendor id, licensed-at timestamp, and machine id. Right choice for technical strings that need to be readable and copy-friendly.
- `src/renderer/src/components/EmptyStateCard.tsx:21, 27` — `text-sm text-muted-foreground` for message, `text-sm font-medium text-primary underline` for button. Two weights (medium + none) on the same line — readable hierarchy.
- `src/renderer/src/components/SettingsSidebar.tsx:53` — `"Sections"` label uses `text-xs font-semibold uppercase tracking-[0.2em]`. Standard eyebrow style; matches `SettingsLayout.tsx:70` exactly.
- `src/renderer/src/pages/License.tsx:222` — loading state: `text-sm text-muted-foreground italic`. Italic on a clinical UI is unusual; the rest of the app uses non-italic loading text (e.g. `ProfileEditor.tsx:432`: `text-sm text-slate-500` plain). Cosmetic.
- `src/renderer/src/pages/License.tsx:158-169` — trial-days row uses the interpolated value `{{days}} days` / `{{days}} يوم`. No zero-state ("Trial ends today" / "Last day") when days=0. Minor copy + typography finding.

### Pillar 5: Spacing (4/4)

**Findings:**

- `src/renderer/src/pages/License.tsx:148` — `CardContent className="flex flex-col gap-4"` (16px between rows). Consistent.
- `src/renderer/src/pages/License.tsx:151, 159, 173, 182, 198` — `grid grid-cols-3 gap-2 pb-2` (8px gap, 8px padding-bottom) on every status row. Consistent rhythm.
- `src/renderer/src/components/EmptyStateCard.tsx:18` — `flex flex-col items-center justify-center gap-3 p-8 text-center` (12px gap, 32px padding). Centered, generous breathing room — appropriate for full-page consumer slots.
- `src/renderer/src/components/SettingsSidebar.tsx:52` — `flex flex-col gap-3` between sidebar items. Consistent with sibling sidebars.
- `src/renderer/src/components/LicenseGate.tsx:92-114` — uses shadcn `<Dialog>` defaults (px-6 py-6 inside DialogContent). No custom padding overrides — correctly defers to shadcn.
- `src/renderer/src/pages/License.tsx:227-244` — Load button `w-full sm:w-auto` — full-width on mobile, auto on ≥640px. Good responsive behavior.
- No arbitrary spacing values (`[NNpx]`, `[NNrem]`) in any of the audited files. **Clean.**

### Pillar 6: Experience Design (2/4)

**Findings:**

- `src/renderer/src/components/LicenseGate.tsx:66-71` — `showModal` predicate is a single boolean (no nested ternaries). Logic: `!dismissedThisSession && status !== null && (state === 'unactivated' || state === 'expired') && route.name !== 'wizard' && route.name !== 'login'`. The wizard/login exemption (G-08-3 fix) is correctly in place.
- `src/renderer/src/components/LicenseGate.tsx:73-81` — `dismiss()` and `activate()` cleanly separate "dismiss this session" from "dismiss + navigate". Per-session dismissal via `sessionStorage.setItem('license.modal.dismissed', '1')` (line 74). Correct.
- `src/renderer/src/pages/License.tsx:72-104` — `handleLoadLic` covers all three IPC outcomes from `IPC.LICENSE_PICK_AND_ACTIVATE`: `ok=true` (toast + refresh), `code='IPC_LICENSE_CANCELLED'` (silent no-op per Plan 04 T-08-L10), else (toast.error with reason). `finally { setActivating(false) }` ensures button re-enables. Solid.
- `src/renderer/src/pages/License.tsx:106-117` — `handleCopyMachineId` has a graceful catch on clipboard rejection but toasts the WRONG message (Priority Fix #1).
- `src/renderer/src/pages/License.tsx:232` — Load button disabled while `activating`. Visual feedback via Loader2 spinner + "Activating…" text (lines 237-240). Good.
- `src/renderer/src/components/EmptyStateCard.tsx:24-31` — graceful-degrade fallback when gated IPC returns `ok:false`. Renders above whatever page was mounting. Per Plan 08-10 SUMMARY, wired into 10 consumer files. Prevents white-screen crash (G-08-4 closure).
- `src/renderer/src/hooks/useLicenseStatus.ts:32-46` — SWR-style hook with `refresh()` callback. Optional-chained `window.api.license?.status?.()` (line 39) for test-cascade resilience. `loading` state driven by IPC in-flight, not mounted-only. Correct.
- **Sidebar status badge gap** — see Priority Fix #3. `SettingsSidebar.tsx:86-95` does not render a status dot or badge; the four `sidebarBadge*` keys are unused in audited scope.
- `src/renderer/src/components/EmptyStateCard.tsx:22` — message says "License required — open Settings → License to activate." Clear about *why* (license required) and *what* (open Settings → License). Good.
- `src/renderer/src/components/LicenseGate.tsx:99-107` — `Continue in trial` button only renders for `state === 'unactivated'`. For `state === 'expired'`, the modal forces the user to "Activate now" (no silent dismissal path). Correct — trial is over, no honest option.
- `src/renderer/src/pages/License.tsx:165` — `status.trialDaysRemaining ?? 0` silently falls back to "0 days" if undefined during `state === 'trial'`. No UI signal that this is a missing-data state. Edge case; minor.
- `src/renderer/src/components/EmptyStateCard.tsx` — no retry button. If `safeInvoke` returns null transiently (IPC busy), the user sees the empty state forever until they navigate away and back. Plan 08-10 SUMMARY documents this as acceptable; flagging for completeness.

---

## Files Audited

- `src/renderer/src/components/LicenseGate.tsx` (118 lines)
- `src/renderer/src/components/EmptyStateCard.tsx` (36 lines)
- `src/renderer/src/pages/License.tsx` (249 lines)
- `src/renderer/src/components/SettingsSidebar.tsx` (122 lines) — only License entry changes (lines 24-29, 31, 42, 86-95)
- `src/renderer/src/hooks/useLicenseStatus.ts` (53 lines)
- `src/renderer/src/i18n/en/translation.json` — `license.*` namespace lines 492-527 (34 keys)
- `src/renderer/src/i18n/ar/translation.json` — `license.*` namespace lines 492-527 (34 keys)
- Reference context: `.planning/phases/08-*/08-05-SUMMARY.md`, `08-10-SUMMARY.md`, `08-UAT-session.md`

## Items Not In Audit Scope (suggest follow-up)

- `App.tsx` `let routeElement` refactor + `<LicenseGate>{routeElement}</LicenseGate>` composition — refactor is mechanical per `08-05-SUMMARY.md` Deviation #1.
- `SettingsSidebar` wrapping in `App.tsx` (or elsewhere) that may add the colored dot + status badge — if it exists, verify it consumes `sidebarBadge{Licensed,Trial,Expired,Unactivated}` keys correctly.
- RTL layout verification at 1280×800 — UAT Test 10 passed; no automated screenshot audit done here.

---

## Cosmetic vs Blocker Summary

**Blockers (must fix):**
1. Clipboard error shows "Failed to activate license" — wrong message (`License.tsx:115`)
2. Arabic pluralization on trial days + sidebar badge (`translation.json` en:504, ar:504, en:522, ar:522)
3. Sidebar License status badge is not implemented in audited scope (or lives elsewhere untested) — `SettingsSidebar.tsx:86-95`

**Warnings (fix recommended):**
- Status dot placement redundant (title + grid row both render status info) — `License.tsx:138-156`
- Status communicated by color only — fails deuteranopia / protanopia — `License.tsx:138-144`
- EmptyStateCard uses link-styled `<button>` instead of shadcn `<Button>` — `EmptyStateCard.tsx:24-31`
- EN singular "1 days" (no `_one` plural key) — `translation.json:504`
- "Continue in trial" awkward — `LicenseGate.tsx:105`
- `bg-slate-400` muted for `unactivated` dot — hard to see — `License.tsx:63`
- `border-slate-200` hardcoded instead of theme token — `License.tsx:151, 159, 173, 182, 198`
- Loading state uses `italic` while other pages use plain — `License.tsx:222`
- `loadLicFailed` reused as fallback for clipboard error — `License.tsx:115` (same as Blocker 1)

**Minor / acceptable:**
- `loading` key in license namespace could fold into `common.loading`
- Trial-days zero-state missing copy ("Last day" / "Trial ends today")
- `useState(false)` for `activating` doesn't have a stale-fetch guard (matches existing `useDoctorProfile` pattern)
- No retry button on `EmptyStateCard` (intentional per Plan 08-10)
