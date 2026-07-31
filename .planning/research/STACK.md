# Stack Research

**Domain:** Desktop medical-imaging-adjacent recorder/reporter (Electron, Windows, offline)
**Researched:** 2026-07-31
**Confidence:** HIGH (stack is locked in by the user's brief; versions verified against current docs)

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Electron | ^32 | Desktop runtime (Chromium + Node) | Industry standard for cross-platform Electron desktop apps; ships with safeStorage, contextBridge, and a hardened sandbox that fits the security baseline. |
| electron-vite | ^2 | Build/dev pipeline | HMR for renderer + main + preload in one config; first-party React + TypeScript template; solves the multi-source-build pain. |
| React | ^18 | UI framework | Matches the team's familiarity; shadcn/ui + Tailwind ecosystem expects React. |
| TypeScript | ^5.5 | Type safety | End-to-end type sharing between renderer/preload/main matters when IPC is the contract. |
| Vite | ^5 (bundled with electron-vite) | Build/bundle | Already pulled in by electron-vite; renderer dev server. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| ffmpeg-static | ^5 | Bundled ffmpeg binary | Spawned as a child process for recording/encoding DirectShow capture to mp4. |
| better-sqlite3 | ^11 | Local SQLite (sync API) | Main-process data layer. WAL mode, encrypted-at-rest via safeStorage. |
| @react-pdf/renderer | ^4 | PDF generation | Pure-React report templates, deterministic output, no native deps. |
| tailwindcss + shadcn/ui | tailwind ^3.4, shadcn latest | UI styling + component library | High-contrast clinical UI, copy-into-repo components, Radix primitives underneath. |
| @noble/ed25519 (or `@stablelib/ed25519`) | latest | License signing/verification | Pure-JS Ed25519, no native deps — fits a portable Electron build. |
| archiver / yauzl | latest | Backup/restore zip | Pack/unpack the `data/` folder for backup. |
| electron-builder | ^25 | Packaging (NSIS + portable) | Code-signed Windows installers; handles ASAR, auto-update hooks. |
| i18next + react-i18next + i18next-browser-languagedetector | latest | Localization | EN + AR with RTL switch; ICU message formatting for medical text. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| electron-vite | Dev/build | `electron.vite.config.ts` with separate main/preload/renderer pipelines. |
| electron-rebuild | Native module rebuild | Run after `npm install` if Node ABI changes; better-sqlite3 needs this. |
| ESLint + typescript-eslint | Lint | Strict TS config; ban `any` across IPC contracts. |
| Prettier | Format | Tied to `.editorconfig`. |
| Vitest | Unit tests | Renderer + main-process unit tests; no DOM needed for main. |

## Installation

```bash
# Core
npm install react react-dom
npm install -D electron electron-vite typescript @types/react @types/react-dom @types/node

# Supporting
npm install ffmpeg-static better-sqlite3 @react-pdf/renderer tailwindcss \
  @noble/ed25519 archiver i18next react-i18next i18next-browser-languagedetector

# Dev dependencies (testing + lint + packaging)
npm install -D electron-builder electron-rebuild vitest eslint prettier \
  @typescript-eslint/parser @typescript-eslint/eslint-plugin
```

After install: `npx electron-rebuild` to compile `better-sqlite3` against the Electron Node ABI.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| electron-vite | electron-forge | When you want first-party Squirrel/auto-update and a templated vite setup |
| better-sqlite3 | Prisma with SQLite | If schema migrations need a typed DSL; better-sqlite3 + hand-written migrations is lighter and faster |
| ffmpeg-static (child_process) | MediaRecorder API | Short clips (<5 min), no DirectShow device selection needed; long procedures break MediaRecorder |
| @react-pdf/renderer | puppeteer HTML→PDF | If the report needs full CSS; puppeteer ships Chromium and is a much heavier dep |
| @noble/ed25519 | Node `crypto` Ed25519 | Stick with `@noble/ed25519` — pure-JS, same API in main and tests; `crypto` is fine too if we accept Node-only |
| Pin login + per-doctor profile | Password + session token | When you need remote admin; we don't, and passwords add a recovery flow we don't want |
| File-based activation (`.lic` load) | Cloud license check | When the customer trusts the vendor; GCC small clinics don't, and no-internet clinic days are real |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| MediaRecorder for long-form procedure recording | Browser implementation varies; Chromium caps at 4–6 GB file chunks; loses frames under memory pressure during 2h procedures | ffmpeg child process writing segmented mp4 |
| node-sqlite3 (callback API) | Callback hell in main process; no transactional simplicity | better-sqlite3 synchronous API |
| Prisma with SQLite | Migration DSL adds a build step; better-sqlite3 + a 200-line migration runner is fewer moving parts | better-sqlite3 + hand-rolled `migrations/` table |
| Cloud sync (Supabase / Firebase) | Violates offline-only mandate; introduces PII boundary for a single-clinic product | SQLite + manual zip backup |
| DICOM / PACS | Regulatory burden (HIPAA/GDPR/HIPAA-style audits), no v1 customer need | Direct mp4 + JPEG screenshots, no DICOM headers |
| Vendor endoscopy SDKs (Olympus, Pentax) | License fees per integration, breaks the "generic USB capture" value prop | DirectShow generic capture via `desktopCapturer` / DirectShow device string |
| Puppeteer/Playwright for the renderer | Adds a Chromium inside Electron — duplicates the runtime | Pure React + Vite |
| Electron `nodeIntegration: true` | Removes the security baseline; renderer becomes RCE for any XSS | contextIsolation + sandbox + preload bridge |

## Stack Patterns by Variant

**If procedure recordings < 30 min (clinic day is light):**
- Single mp4 file write, no segmentation
- `ffmpeg -f dshow -i video="<device>" -c:v libx264 -preset veryfast -crf 23 out.mp4`

**If procedure recordings > 30 min (typical colonoscopy 20–60 min, some > 2h):**
- Segmented mp4 (every 10 min) + final concat, OR mp4 with `-movflags +faststart` for resumability
- Always run `ffmpeg` with explicit `-t` timeout + SIGTERM handler so a hung encode can't lock the file handle
- Flush the moov atom at the end (ffmpeg does this by default; do not trust `MediaRecorder`-style writes)

**If shipping to Arabic clinics as primary language:**
- Set `lang="ar"` document direction at boot, render `<html dir="rtl">`
- shadcn components must be re-checked for RTL layout traps (sliders, dropdowns, dialogs need `dir` attribute or `tailwindcss-rtl` config)

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| better-sqlite3 ^11 | Electron 32 (Node 20 ABI) | Always run `electron-rebuild` after upgrading Electron major |
| @react-pdf/renderer ^4 | React 18 | React 19 support is in beta; pin 4.x until 5.x stabilizes |
| electron-vite ^2 | Electron 30+ | Will follow Electron majors; pin and rebuild together |
| Tailwind ^3.4 | shadcn (Radix UI underneath) | shadcn CLI generates Tailwind classes; do not move to Tailwind 4 until shadcn ships an official build |

## Sources

- electron-vite official docs (electron-vite.org)
- better-sqlite3 README + Electron rebuild docs
- @react-pdf/renderer v4 docs
- ffmpeg-static package + DirectShow input docs
- Electron security baseline (contextIsolation, sandbox) — Electron official security guide
- Ed25519 via @noble/ed25519 docs (pure JS, audited)
- shadcn/ui CLI docs (Tailwind config, RTL handling caveats)
- electron-builder docs (Windows code signing, NSIS)

---
*Stack research for: Colonoscopist (Electron desktop, offline, GCC clinics)*
*Researched: 2026-07-31*
