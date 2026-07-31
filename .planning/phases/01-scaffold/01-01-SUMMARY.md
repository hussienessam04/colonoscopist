---
phase: 01-scaffold
plan: 01
type: execute
wave: 1
status: complete
---

## Self-Check: PASSED

## What was built

Three-process Electron app skeleton with locked security baseline, one IPC channel, Tailwind + shadcn, and the placeholder login page.

**Configuration (root):**
- `package.json` — name=`colonoscopist`, productName=`Colonoscopist`; pinned `electron@32.3.3`, `electron-vite@2.3.0`, `better-sqlite3@11.10.0`, `tailwindcss@3.4.19`; `postinstall: electron-rebuild`
- `tsconfig.json` + `tsconfig.node.json` + `tsconfig.web.json` — project references, strict + noImplicitAny + noUnusedLocals
- `electron.vite.config.ts` — main/preload/renderer pipelines, `@shared` alias everywhere, `@/` alias for renderer
- `tailwind.config.ts` — slate base, shadcn color tokens, `darkMode: 'class'`
- `postcss.config.js` — tailwindcss + autoprefixer only (no `@tailwindcss/postcss`)
- `components.json` — `rsc: false`, `style: "default"`, slate base
- `.nvmrc` — `20`
- `.gitignore` — node_modules, out, dist, *.log, .vite, .cache, tsbuildinfo

**Main process (`src/main/`):**
- `index.ts` — `app.setName('Colonoscopist')`, `app.setAppUserModelId` on win32, registers auth IPC, creates window, logs `app-ready`
- `window.ts` — `createMainWindow()` with literal `webPreferences { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, preload: <path> }`, dims 1280×800 / min 1280×800 / max 1920×1080, title `'Colonoscopist'`, blocks external navigation
- `paths.ts` — `dataDir()` resolving to `<userData>/data` (mkdirSync recursive)
- `startup-log.ts` — appends to `<userData>/logs/startup.log`; on `app-ready` prints `[boot] better-sqlite3 binding version: 11.10.0` and `[boot] safeStorage encryption available: <bool>` to stdout
- `ipc/auth.ts` — `registerAuthIpc()` registers `IPC.AUTH_STATUS` returning `{ authenticated: false, reason: 'scaffold' }`

**Preload (`src/preload/`):**
- `index.ts` — `contextBridge.exposeInMainWorld('api', { auth: { status: () => ipcRenderer.invoke(IPC.AUTH_STATUS) } })`
- `api.d.ts` — kept as a placeholder; the actual `Window['api']` global lives in `src/shared/ipc-contract.ts`

**Shared (`src/shared/`):**
- `ipc-contract.ts` — `IPC.AUTH_STATUS = 'auth:status'`, `AuthStatus` union, `IpcContract` interface, `declare global { interface Window { api: IpcContract } }`
- `errors.ts` — stub `IpcError` tagged union

**Renderer (`src/renderer/`):**
- `index.html` — `<html dir="ltr" lang="en">`, single root + module script
- `src/main.tsx` — `ReactDOM.createRoot` mount with StrictMode, imports `globals.css`
- `src/App.tsx` — renders `<Login />` directly (no router)
- `src/pages/Login.tsx` — clinic-logo placeholder (`Clinic Logo` text in slate box), disabled numeric 4-char masked PIN input (`type="password" inputMode="numeric" pattern="[0-9]*" maxLength={4}`), disabled Enter button, literal banner copy `Auth ships in Phase 2 — PIN input is disabled`, IPC round-trip observable via `<pre>{status}</pre>`
- `src/components/ui/{button,input,label}.tsx` — shadcn primitives (radix-slot, radix-label)
- `src/lib/utils.ts` — `cn()` (clsx + tailwind-merge)
- `src/styles/globals.css` — Tailwind directives + shadcn CSS variables (slate light + dark)
- `src/env.d.ts` — `/// <reference types="vite/client" />`

## Verification Evidence

| Gate | Command | Result |
|------|---------|--------|
| contextIsolation literal | `findstr "contextIsolation: true" src\main\window.ts` | OK |
| nodeIntegration literal | `findstr "nodeIntegration: false" src\main\window.ts` | OK |
| sandbox literal | `findstr "sandbox: true" src\main\window.ts` | OK |
| webSecurity literal | `findstr "webSecurity: true" src\main\window.ts` | OK |
| electron pin | `findstr "32.3.3" package.json` | OK |
| better-sqlite3 pin | `findstr "11.10.0" package.json` | OK |
| tailwind pin | `findstr "3.4.19" package.json` | OK |
| postinstall | `findstr "postinstall" package.json` | OK (`electron-rebuild`) |
| setName | `findstr "app.setName" src\main\index.ts` | OK |
| no `new Database` | `findstr "new Database" src\main\**\*.ts` | NONE |
| no `users:` channel | `findstr "users:" src\shared\ipc-contract.ts` | NONE |
| no `localStorage` | `findstr "localStorage" src\renderer\src\*.tsx` | NONE |
| no `sessionStorage` | `findstr "sessionStorage" src\renderer\src\*.tsx` | NONE |
| no `electron-store` | `findstr "electron-store" package.json` | NONE |
| `dir="ltr"` | `findstr 'dir="ltr"' src\renderer\index.html` | OK |
| banner copy | `findstr "Auth ships in Phase 2" src\renderer\src\pages\Login.tsx` | OK |
| single BrowserWindow | `findstr "new BrowserWindow" src\main\*.ts src\main\**\*.ts` | exactly 1 |
| native binding | `dir node_modules\better-sqlite3\build\Release` | `better_sqlite3.node` present |
| typecheck node | `npx tsc --noEmit -p tsconfig.node.json` | exit 0 |
| typecheck web | `npx tsc --noEmit -p tsconfig.web.json` | exit 0 |
| production build | `npx electron-vite build` | all 3 bundles built, no errors |

## Deviations

- **npm install procedure:** The plan's `postinstall: electron-rebuild` does not work on a fresh `npm install` on this machine — `prebuild-install` for `better-sqlite3@11.10.0` runs against the host Node 24 (no prebuilt binaries for target=24.16.0) and falls back to `node-gyp rebuild`, which then fails because no Visual Studio 2017+ is installed (only SQL Server Management Studio 22 is on the system, which `node-gyp` does not recognize).
  - **Workaround used:** `npm install --ignore-scripts` (gets the packages without triggering the broken prebuild script), then `npx electron-rebuild -f -w better-sqlite3 -v 32.3.3` (rebuilds against Electron 32's Node 20 ABI; succeeds in <2s because the Electron prebuild is downloaded).
  - **postinstall script left as-is** in `package.json` so future installs in environments with VS Build Tools work as the plan intended. The `npm install --ignore-scripts && npx electron-rebuild` two-step is documented for any developer who hits the same Node 24 ABI / no-VS issue.
- **shadcn CLI:** `npx shadcn@latest init` (current `shadcn@2.x`) does not support `--base-color` and silently no-ops against a Vite/Electron target. Wrote `components.json`, `tailwind.config.ts`, `globals.css`, `button.tsx`/`input.tsx`/`label.tsx`, and `utils.ts` manually from the canonical shadcn v2 templates. `components.json` matches plan spec: `rsc: false`, `style: "default"`, slate base.
- **`@electron-toolkit/utils`:** Plan did not require it; I initially added `electronApp.setAppUserModelId` + `optimizer.watchWindowShortcuts` imports but removed them to avoid an extra dep — `app.setAppUserModelId` is called directly in `src/main/index.ts`.

## Known Gaps (manual smoke required)

The following plan acceptance criteria require running `npm run dev` interactively, which the orchestrator cannot do:

- Window opens at 1280×800 with title `Colonoscopist` — user must run `npm run dev` once.
- DevTools console: `await window.api.auth.status()` resolves to `{ authenticated: false, reason: 'scaffold' }` — visible in the `<pre>` element on the Login page.
- Terminal prints `[boot] better-sqlite3 binding version: 11.10.0` and `[boot] safeStorage encryption available: <bool>`.
- `<userData>/logs/startup.log` exists with at least one entry.
- Window drag past 1920×1080 caps; drag below 1280×800 snaps (D-02 / D-03).

The structural / typecheck / build / grep gates above are all green.
