---
status: complete
task: unify the settings layout and the navbar in settings
date: 2026-08-12
commits:
  - 90f57e3: feat(settings): unify shell across all 6 settings pages via SettingsLayout
files_modified:
  - src/renderer/src/components/SettingsLayout.tsx (NEW)
  - src/renderer/src/pages/SettingsHub.tsx
  - src/renderer/src/pages/SettingsCapture.tsx
  - src/renderer/src/pages/SettingsUsers.tsx
  - src/renderer/src/pages/Audit.tsx
  - src/renderer/src/pages/BackupRestore.tsx
  - src/renderer/src/pages/ProfileEditor.tsx
  - tests/integration/renderer-main-capture-contract.test.ts
  - tests/renderer/pages/settings-hub.test.tsx
tests_added: 0 (existing 63 settings tests + 44 contract tests cover the new shell)
---

# Quick task 260812-n0h: Unify settings layout + sidebar

## What changed

The six settings pages (Hub, Capture, Users, Audit, BackupRestore, ProfileEditor) had drifted into six slightly different shells: header kicker text varied (`Workspace` / `Settings` / i18n strings), h1 wording differed (`Settings` / `Capture` / `Settings · Users` / i18n), Back button labels were inconsistent (`Back` / `Back to patients` / icon-only), Back button variants were inconsistent (`outline` / `ghost`), sidebar widths were inconsistent (16rem / 20rem), and grid layouts differed (2-col / 3-col with custom widths).

A single `<SettingsLayout>` component now provides the unified shell. Every settings page renders the same header (`Settings` kicker + h1 + optional subtitle + optional right-side action slot + Back button → `settings-hub`; Hub → `patients`) and the same `[16rem_minmax(0,1fr)]` grid with `<SettingsSidebar activeTab={...} />` in the left column.

## Single new component

`src/renderer/src/components/SettingsLayout.tsx`:

```ts
type Props = {
  title: string;
  subtitle?: string;
  activeTab?: SettingsTab;
  headerAction?: ReactNode;     // right-side slot (Save, Add user, etc.)
  backTestId?: string;          // default 'settings-layout-back'
  backTo?: Route;                // default { name: 'settings-hub' }
  backLabel?: string;            // default 'Back'
  children: ReactNode;           // body content
};
```

Pages call `<SettingsLayout title="Capture" activeTab="capture" headerAction={...}>{body}</SettingsLayout>`. The Hub passes `backTo={{name:'patients'}}` + `backLabel="Back to patients"` to make its hop explicit.

## Per-page changes

| Page | activeTab | headerAction | Notable body change |
|------|-----------|--------------|---------------------|
| SettingsHub | undefined | none | Card body unchanged |
| SettingsCapture | `'capture'` | Save button (moved from right aside) | Inner 2-col `[preview + controls]` replaces the old 3-col grid |
| SettingsUsers | `'users'` | Add user trigger | Table body unchanged |
| Audit | `'audit'` | none | Filter Card + results Card + Dialog unchanged |
| BackupRestore | `'backup-restore'` | none | Two-Card layout unchanged; Back variant `outline` (was `ghost`) |
| ProfileEditor | `'profile'` | none | Clinic + Assets + Language Cards unchanged |

## Test seam contracts preserved

- `data-testid="settings-hub-back"` (Hub) — backTestId prop
- `data-testid="audit-back"`, `"backup-restore-back"`, `"profile-editor-back"` — backTestId prop
- `data-testid="save-capture"` (Capture's Save button) — moved to header slot
- `data-testid="settings-hub-{capture,profile,audit,backup-restore,users}"` sidebar entries — still mounted (now from SettingsLayout)
- ProfileEditor form fields, Audit filter/table testids, BackupRestore card testids — unchanged

## Updated test contract

`tests/integration/renderer-main-capture-contract.test.ts` G-03-6 contract shifted from "page imports SettingsSidebar directly" to:
- `SettingsLayout.tsx` is the single consumer of `<SettingsSidebar />` and renders `<SettingsSidebar activeTab={activeTab} ...>`
- `SettingsHub.tsx`, `SettingsCapture.tsx`, `SettingsUsers.tsx` no longer import `<SettingsSidebar>` directly (verified by `not.toMatch`)
- Each page passes the appropriate `activeTab="..."` string literal to `<SettingsLayout>`

## Verification

- `npx tsc -p tsconfig.web.json --noEmit` → clean.
- `npm run test:unit -- --run tests/renderer/pages/settings-hub.test.tsx tests/renderer/pages/settings-capture.test.tsx tests/renderer/pages/settings-users.test.tsx tests/renderer/pages/profile-editor.test.tsx tests/renderer/pages/Audit.test.tsx tests/renderer/pages/BackupRestore.test.tsx` → **63/63 pass**.
- `npm run test:unit -- --run tests/integration/renderer-main-capture-contract.test.ts` → **44/44 pass**.
- `npm run test:unit` (full suite) → **714/717 pass** (3 pre-existing Playwright RTL config failures unrelated).
- Visual: open the app → Settings → click each sidebar entry. Header, kicker, h1, Back button, and sidebar position are identical across all 6 pages. Capture's Save button is now next to Back in the header.

## Manual smoke (next session)

- Open the app → Settings → Capture → click each sidebar entry to confirm the header + sidebar + grid look identical.
- Capture: pick a device, change a preset, click Save (now in the header next to Back) — settings persist.
- Audit: filter by date, click a row, confirm the detail dialog still opens.
- BackupRestore: trigger a backup, confirm the backup-card flow still works.
- ProfileEditor: edit a field, confirm auto-save still fires.
- SettingsHub: click Back to patients.