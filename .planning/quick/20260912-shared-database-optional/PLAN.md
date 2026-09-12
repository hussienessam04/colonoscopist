---
slug: shared-database-optional
created: 2026-09-12
type: feature
source: ad-hoc user idea — share the same SQLite DB across two devices (e.g. record on the OR laptop, write the report from the doctor's room laptop). Optional toggle; default stays local.
---

# Quick Task: optional shared database across devices

## Idea

Doctor has a laptop in the OR for recording procedures, then wants
to walk to his room and write the report from a different laptop.
The current product locks every byte of data under
`<userData>/data/` — there's no way for device B to see what
device A recorded.

The simplest opt-in answer: point the app at a shared folder
(SMB / NFS / OneDrive / Dropbox mounted as a folder). SQLite
opens the DB from that path; both devices read/write the same
file. SQLite's WAL mode + `busy_timeout` handles the two-device
write race (one wins, the other waits). Default stays local —
the toggle is **opt-in**, no migration, no break.

## Architecture

- **Config file** at `<userData>/data-location.json` (ALWAYS at
  the local userData root — never at the shared path, to avoid
  the chicken-and-egg of "where does the config that points to
  the shared path live"). Shape:
  ```ts
  { enabled: boolean; sharedPath: string | null; updatedAt: number }
  ```
- **`src/main/storage/data-location-config.ts`** (new):
  sync read/write of the config JSON. Validates `sharedPath`
  exists when enabled.
- **`src/main/paths.ts`** — `dataDir()` now reads the config and
  returns either `<userData>/data` (default) or `<sharedPath>/data`
  (when sharing enabled). All subdirs (mediaDir, profilesDir,
  reportsDir, licenseDir, dbPath) inherit. Note that the
  `screenshotAbsPath` resolver joins `<userData>` directly to a
  stored RELATIVE path — that needs to thread through the
  effective data root too so screenshots from device A still
  resolve when device B reads them from the shared path. The
  stored `file_path` column stays RELATIVE (Anti-Pattern 2) but
  the resolver now joins `<effectiveDataRoot>` instead of
  `<userData>`.
- **IPC** (`src/main/ipc/storage.ts`, new):
    - `STORAGE_GET_LOCATION` → `{ enabled, sharedPath,
      effectivePath, localPath }`
    - `STORAGE_SET_LOCATION({ enabled, sharedPath })` → saves
      the config. Returns `{ ok: true, requiresRestart: true }`
      (the toggle takes effect on the next app launch — we close
      the DB and reopen at the new path automatically, but a
      running recording keeps the old path; cleaner to require
      restart).
    - `STORAGE_PICK_FOLDER` → opens `dialog.showOpenDialog`
      with `properties: ['openDirectory']`, returns the picked
      path (or null if cancelled).
- **Preload bridge** — adds the three channels to
  `window.api.storage`.
- **Renderer page** (`src/renderer/src/pages/SettingsStorage.tsx`,
  new): a Card with the toggle + path display + buttons.
    - Off (default): shows "Local — `<userData>/data`" read-only.
    - On: shows the shared path + "Choose folder" button + "Reset
      to local" button.
    - Always shows a small warning banner: "Changes take effect
      on next app launch."
- **Sidebar entry** — add `Storage` between Capture and Profile
  in `SettingsSidebar.tsx` (or at the bottom — TBD by visual
  fit; Capture/Profile/Audit/License/Backup/Users is the current
  order; Storage fits alongside Backup since both are
  "infrastructure" concerns).
- **Route + nav** — add `settings-storage` to the route union
  in `lib/router.ts`.
- **i18n** — EN + AR strings.

## Files

- NEW `src/main/storage/data-location-config.ts` — sync config
  read/write.
- NEW `src/main/ipc/storage.ts` — IPC handlers.
- NEW `src/renderer/src/pages/SettingsStorage.tsx` — UI page.
- EDIT `src/main/paths.ts` — `dataDir()` reads the config;
  `screenshotAbsPath` + `videoFilePath` + `profileAssetPath`
  thread through the effective root.
- EDIT `src/main/index.ts` — register the storage IPC.
- EDIT `src/shared/ipc-contract.ts` — `STORAGE_*` channels +
  input/output types.
- EDIT `src/preload/index.ts` — expose `window.api.storage`.
- EDIT `src/renderer/src/components/SettingsSidebar.tsx` — add
  the Storage entry.
- EDIT `src/renderer/src/lib/router.ts` — add `'settings-storage'`.
- EDIT `src/renderer/src/i18n/{en,ar}/translation.json` — new
  keys.
- NEW `tests/main/storage/data-location-config.test.ts` — config
  read/write/validate.
- NEW `tests/renderer/pages/settings-storage.test.tsx` — page
  renders, toggle works, picker flow.

## Verification

- `npm run typecheck` (node + web) → exits 0.
- New tests pass.
- Manual:
    1. Default install → Settings → Storage shows "Local".
       DB lives at `<userData>/data/app.db`.
    2. Toggle "Share database across devices" on → pick a
       folder → save → quit → relaunch. The DB now opens at
       `<sharedPath>/data/app.db`. Local data is still at
       `<userData>/data/app.db` (untouched).
    3. Toggle off → quit → relaunch. DB back at local.

## Out of scope

- **Migration flow**: copying the existing local DB to the
  shared folder when the doctor first toggles sharing on. The
  doctor can do this manually (Finder / Explorer copy). Future
  quick task.
- **License / trial sharing**: when the DB lives on a shared
  path, both devices read the same `trial_started_at` row +
  the same license sidecar. Per-clinic licensing would need
  separate work. Out of scope.
- **Concurrent write UI**: when two devices try to record at
  once, SQLite's `busy_timeout = 5000` handles it; no special UI
  for the rare "another device is recording" prompt.
- **Per-device preferences** (e.g. capture preset): the doctor's
  per-doctor default is read from the shared DB, so device B
  inherits device A's preset matrix. Acceptable for v1; flag
  this as a future polish.