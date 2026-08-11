---
slug: profile-sidebar-and-lang
created: 2026-08-11
type: bugfix
source: ad-hoc user report
---

# Quick Task: ProfileEditor — Add SettingsSidebar + Wire Language Change

## Bug 1: SettingsSidebar missing on Profile

`src/renderer/src/pages/ProfileEditor.tsx` is the only Settings page without `<SettingsSidebar />`. Every other Settings page (Capture, Audit, Backup & Restore, Users, plus SettingsHub) renders the sidebar in the left rail. ProfileEditor only has a Back button at the top — the user sees no nav chrome.

**Fix:** Add `<SettingsSidebar activeTab="profile" />` and wrap the content in the same `grid lg:grid-cols-[16rem_minmax(0,1fr)]` layout the other settings pages use. The SettingsSidebar already supports `activeTab="profile"` (it's in the `SettingsTab` union).

Layout:
```
┌─────────────────────────────────────────────────────────────────┐
│ ┌────────────┐ ┌───────────────────────────────────────────────┐ │
│ │ [icon] Cap │ │  PROFILE                          [← Back]     │ │
│ │ [icon] Pro │ │                                               │ │
│ │ [icon] Aud │ │  ┌─ Clinic Card ─────────────────────────────┐ │ │
│ │ [icon] B&R │ │  │ ...                                       │ │ │
│ │ [icon] Use │ │  └───────────────────────────────────────────┘ │ │
│ └────────────┘ │  ┌─ Assets Card ─────────────────────────────┐ │ │
│                │  │ ...                                       │ │ │
│                │  └───────────────────────────────────────────┘ │ │
│                │  ┌─ Language Card ───────────────────────────┐ │ │
│                │  │ ...                                       │ │ │
│                │  └───────────────────────────────────────────┘ │ │
│                └───────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Bug 2: Language change doesn't take effect

`ProfileEditor.handleLanguageChange` writes `doctor_profile.language` to the DB via `profile.update` + emits the `language.changed` audit row, but never calls `i18n.changeLanguage()` on the renderer. The `<LanguageApplier />` mounted in `main.tsx` only fires its `useEffect([lang])` when `i18n.language` changes — and nothing changes it. So the toast says "Language updated to Arabic" but the UI stays English, `<html dir>` stays `ltr`.

The `Wizard.tsx` page already handles this correctly (line 74: `await i18n.changeLanguage(language)` after wizard bootstrap). ProfileEditor was supposed to mirror that pattern but forgot the i18n call.

**Fix:** After the `Promise.all([profile.update, audit.log])` resolves successfully, call `void i18n.changeLanguage(newLang)`. The existing `<LanguageApplier />` picks up the change via `i18n.language` → recomputes `lang` → useEffect re-fires → dir/lang flip. No changes needed to `useLanguage.ts` or `main.tsx`.

## Scope (smallest working diff)

### 1. `src/renderer/src/pages/ProfileEditor.tsx` — two changes

**Bug 1 — Layout restructure:**
- Import `SettingsSidebar` from `@/components/SettingsSidebar`.
- Change root container from `<div className="mx-auto flex max-w-3xl flex-col gap-4">` to `<div className="mx-auto grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">`.
- Add `<SettingsSidebar activeTab="profile" />` as the first child of the grid (matches SettingsCapture / SettingsUsers / BackupRestore pattern).
- Wrap the existing header + 3 Cards in a `<div className="flex flex-col gap-4">` second grid cell.
- Keep the Back button, drop the `max-w-3xl` (the grid handles width).

**Bug 2 — Wire i18n.changeLanguage:**
- In `handleLanguageChange`, after the existing `await Promise.all([...])`:
  ```ts
  await i18n.changeLanguage(newLang);
  ```
- Access `i18n` via `const { i18n } = useTranslation()` — already destructuring `t`. Add `i18n` to the destructure.
- The i18n change is independent of the DB write — it should fire regardless of the Promise.all result so the user gets immediate visual feedback. But we keep it after the await so we don't flip if the DB write fails (the toast.error path should restore).

Wait — actually, the safer order is:
```ts
const [updated] = await Promise.all([...]);
void i18n.changeLanguage(newLang);  // independent visual update
toast.success(...);
```

Actually keep it sequential: await the DB write first, then i18n. If DB fails, the catch block shows toast.error and we don't flip the UI — consistent state (DB and UI in sync).

### 2. Tests

Extend `tests/renderer/pages/profile-editor.test.tsx` with 2 new cases:
1. **SettingsSidebar renders** — assert the sidebar mounts with `data-active="true"` on the Profile button (mirrors the existing Audit/Backup sidebar test).
2. **Language change flips i18n** — click AR radio → assert `i18n.changeLanguage('ar')` was called (mock it via the existing `tests/renderer/setup.ts` MockApi — wait, `i18n` is from react-i18next, not from `window.api`).

For #2, the existing test setup imports `@/i18n` which calls `i18n.use(initReactI18next).init(...)`. The language flip happens via the same global `i18n` instance. Two options:
- **Option A (light):** assert that `document.documentElement.dir === 'rtl'` after clicking AR (this is the user-visible outcome — DOM mutation is testable in happy-dom).
- **Option B (heavier):** spy on `i18n.changeLanguage` via vi.spyOn and assert it was called with 'ar'.

Ponytail prefers Option A — assert the observable DOM outcome, not the internal call. happy-dom updates `document.documentElement.dir` synchronously when `useEffect` fires after `i18n.changeLanguage()` resolves. Add a small `waitFor` for the effect tick.

### 3. No other changes

- `useLanguage.ts` — no changes (the hook already reacts to `i18n.language` changes via useEffect).
- `main.tsx` — no changes.
- `i18n/index.ts` — no changes.
- `SettingsSidebar.tsx` — no changes (already supports `activeTab="profile"`).
- Wizard.tsx — no changes (already correct).

## Acceptance

- `npm run typecheck` clean (node + web)
- `npm run test:unit -- tests/renderer/pages/profile-editor.test.tsx` passes (existing 8 cases + 2 new)
- `npm run test:unit` — full suite green (or same pre-existing failures as before)
- D-24 parity test still passes (no new i18n keys added)

## Style

Ponytail — reuse existing patterns:
- SettingsSidebar layout copied from SettingsCapture.tsx (the same `lg:grid-cols-[16rem_minmax(0,1fr)]` shape)
- i18n.changeLanguage call copied from Wizard.tsx (the exact same idiom)
- No new components, no new deps