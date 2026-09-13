# Quick Task 260913-4qz: replace default React icon with Health Icons gastroenterology CC0 SVG

**Gathered:** 2026-09-13
**Status:** Ready for planning

<domain>
## Task Boundary

Replace the default React/Electron app icon with the Health Icons "gastroenterology" icon (CC0 / public domain) for the Colonoscopist Windows desktop app. Wire it to:

1. The browser tab favicon (renderer)
2. The BrowserWindow icon (main process — taskbar/dock)

Source for the icon: https://healthicons.org — "gastroenterology" (specific to GI / colonoscopy context). CC0 1.0 (no attribution required, free for commercial use, no copyright restrictions). Edited only to swap `fill="currentColor"` → `fill="#0E3A47"` so the icon renders at the app's deep teal brand color regardless of container.

The "default React icon" in the prior state was no icon at all — the renderer's `index.html` had no favicon link, and `BrowserWindow` had no `icon:` option. Electron falls back to its built-in default (a generic Chromium icon).

</domain>

<decisions>
### Implementation Decisions

- **Single SVG file served by the renderer** — the icon lives at `src/renderer/public/icon.svg`. Vite copies `public/` → `out/renderer/` on build, so the same file is reachable as:
  - `GET /icon.svg` for the renderer (favicon)
  - `path.join(__dirname, '../renderer/icon.svg')` for the main process (BrowserWindow icon)
  - Both paths resolve in dev and prod — no separate "dev-only" or "prod-only" branches.

- **Main-side lazy lookup** — `src/main/window.ts` adds a `resolveAppIcon()` helper that probes two candidate paths (`../renderer/icon.svg`, `../renderer/assets/icon.svg`) and returns `undefined` if neither exists. Electron then falls back to its built-in icon. This is the lazy/correct behavior: a missing icon should never crash the app.

- **Out of scope: Windows .exe icon (`.ico`)** — converting SVG → .ico requires either sharp (heavy native dep), png-to-ico (extra npm dep), or ImageMagick (not installed). Generating a .ico without an image library would be ~150 lines of pixel-format code that's almost certainly wrong. The user has been informed this is a follow-up; the visual win (favicon + window icon) is delivered now without taking on a new dep.

- **Color pinned to brand teal** — swapped `currentColor` → `#0E3A47` (the deep teal used throughout the clinical workstation palette). Otherwise the renderer favicon would inherit the document's color (typically black on light themes, white on dark) which would make the icon ambiguous in dark mode.

### the agent's Discretion

- No `extraResources` config change in package.json — the SVG already ships via the renderer output, so the main process can read it without electron-builder extra config.
- No new dependencies (no sharp, no png-to-ico) — SVG-only this round.

</decisions>

<specifics>
## Specific Ideas

- File: `src/renderer/public/icon.svg` — the CC0 gastroenterology icon, brand-tinted to `#0E3A47`. Documented as Health Icons (https://healthicons.org) at the top of the file for trace.
- File: `src/renderer/index.html` — one-line addition of `<link rel="icon" type="image/svg+xml" href="/icon.svg" />` in `<head>`.
- File: `src/main/window.ts` — `nativeImage` + `fs` imports added; `resolveAppIcon()` helper; `icon:` option on `BrowserWindow` constructor.

## Canonical References

- Health Icons license (CC0): https://healthicons.org/about — "icons are available in the public domain (CC0) for use in any type of project. ... You don't need to give credit and you can edit the icons however you want."
- Resolve to Save Lives (the org that maintains Health Icons): https://github.com/resolvetosavelives/healthicons — confirms MIT license for the website itself, CC0 for the icons.
- Electron 32 `nativeImage.createFromPath()` docs: SVG paths are supported on macOS in all versions; on Windows behavior depends on the underlying Chromium image decoder (in Electron 32 Chromium 128+, SVG is supported but the win-icon set still prefers raster formats).

</canonical_refs>
