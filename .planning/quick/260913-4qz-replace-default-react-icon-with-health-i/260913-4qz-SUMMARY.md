---
slug: replace-default-react-icon-with-health-i
created: 2026-09-13
type: feature
source: ad-hoc user request
status: complete
---

# Quick Task 260913-4qz: replace default React icon with Health Icons gastroenterology CC0 SVG

## Done

**Wired the Health Icons "gastroenterology" SVG (CC0 / public domain) as the app + favicon icon.**

### Files

- `src/renderer/public/icon.svg` (new, 1.7 KB) — gastroenterology icon, `fill` swapped from `currentColor` → `#0E3A47` (the app's deep teal) so it renders at brand color regardless of container. Documented as Health Icons (CC0) at the top of the file.
- `src/renderer/index.html` — added `<link rel="icon" type="image/svg+xml" href="/icon.svg" />` in `<head>`.
- `src/main/window.ts` — added `nativeImage` + `fs` imports; `resolveAppIcon()` helper probes `../renderer/icon.svg` then `../renderer/assets/icon.svg`; `icon:` option wired to `BrowserWindow`. Missing icon → undefined → Electron default (no crash).

### Verification

- `npm run typecheck` (both node + web configs) exits 0.
- `npm run build` succeeds — `out/renderer/icon.svg` produced (1715 bytes); `out/renderer/index.html` references `./icon.svg`.
- BrowserWindow path resolution: `__dirname` = `out/main/` in compiled bundle → `path.join(__dirname, '../renderer/icon.svg')` → `out/renderer/icon.svg` ✓.
- License: Health Icons CC0 1.0 — no attribution required, free for commercial use, no copyright restrictions.

### Out of scope (follow-up if needed)

- **Windows .exe icon**: SVG → .ico conversion requires sharp / png-to-ico / ImageMagick. Not installed and not added. Windows taskbar will still show the BrowserWindow icon if Electron's Chromium can render the SVG as a window icon (Electron 32 / Chromium 128+ supports SVG windows icons), but the .exe itself (right-click → Properties, install shortcuts) still shows the default Electron icon. Adding `.ico` requires either installing an image library or hand-rolling the ICO format — out of scope for this round.

### Manual checks for the user

- `npm run dev` → app title bar / window icon may still show default in dev (Electron window icon via `nativeImage.createFromPath(SVG)` historically unreliable on Windows; varies by Electron/Chromium version). Favicon works in dev (Vite dev server serves /icon.svg).
- `npm run build` then `npm start` (or `electron-vite preview`) → favicon shows in any browser/Chromium-rendered title bar; BrowserWindow icon renders if the underlying Chromium version supports SVG window icons.
