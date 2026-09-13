# Publishing & Auto-update

Quick task 260913-64l — end-to-end release flow for Colonoscopist using `electron-updater` against GitHub Releases. The auto-updater reads `app-update.yml` (emitted at build time by `electron-builder`'s `publish` block in `package.json`) and surfaces an "Update available" card in Settings → About (see `src/renderer/src/pages/SettingsAbout.tsx`).

## 1. Bump the version

Edit the top-level `version` field in `package.json`, or use npm's built-in semver helpers:

```bash
npm version patch     # 0.1.0 → 0.1.1
npm version minor     # 0.1.0 → 0.2.0
npm version major     # 0.1.0 → 1.0.0
```

`npm version` commits the bump + tags the new commit. The tag name (e.g. `v0.1.1`) is what `electron-builder` uses as the GitHub Release name.

## 2. Cut a release

```bash
# 1. tag the release (commits the version bump)
npm version patch

# 2. build the NSIS installer + portable .exe into ./dist/
npm run package         # NSIS installer
npm run package:portable  # portable .exe (optional)

# 3. upload dist/*.exe + latest.yml to a GitHub Release keyed on the tag
GH_TOKEN=<token with repo scope> npm run publish:gh
```

`publish:gh` runs `electron-builder --publish always`. The tool uploads every file in `dist/` plus the `latest.yml` manifest that the auto-updater reads at runtime, and creates/updates a GitHub Release whose name matches the tag (`v0.1.1`).

## 3. GitHub Actions secret (when scripted in CI)

If you script the release in CI, supply `GH_TOKEN` with `repo` scope as a repository secret. The local maintainer publish from a workstation uses their own shell's `GH_TOKEN` env var — **the token is never committed to the repo** (the `publish` block in `package.json` deliberately omits a `token` field).

## 4. Doctor sees the update

Two paths surface the new version to a clinic running v0.1.0:

- **Next app launch** — `initAutoUpdater()` in `src/main/auto-update.ts` runs `autoUpdater.checkForUpdates()` once during `app.whenReady()`. If a newer release exists in the GitHub Releases feed, the renderer polls `APP_UPDATE_GET_STATE` (see `src/renderer/src/hooks/useUpdater.ts`) every 30 s and surfaces a card in Settings → About with a "Download update" button.
- **Periodic re-check (every 6 hours)** — the same `setInterval` in `initAutoUpdater()` re-queries GitHub Releases while the app stays open. A clinic that leaves the workstation on between procedures will pick up the new version automatically.

The auto-updater is **opt-in per download** (`autoDownload = false`). A silent 80 MB mid-procedure download would tank the recording; the "Download update" button is the only path that pulls bytes. Once downloaded, the "Restart now" button triggers `autoUpdater.quitAndInstall()`.

## 5. Smoke check without publishing

```bash
npm run publish:dry -- --win nsis
```

Runs the full NSIS build but skips the GitHub upload — useful when iterating on the `publish` config or verifying a build before cutting a release. Takes ~1-2 min on first run (copies `buildResources`).
