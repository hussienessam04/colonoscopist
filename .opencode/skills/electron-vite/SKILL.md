---
name: electron-vite
description: |
  Set up and work with Electron + Vite + React + TypeScript apps via electron-vite
  (https://electron-vite.org). Use this skill whenever the user is scaffolding a
  new Electron app, touching main/preload/renderer wiring, designing the IPC
  contract, configuring build/packaging, or debugging "nodeIntegration in
  renderer" / "preload not loading" / "blank window" issues. Triggers on
  phrases like "scaffold electron", "main process", "preload", "contextBridge",
  "ipcMain", "ipcRenderer", "electron-vite config", "package the app", "ASAR
  bundling". Do NOT use this for Tauri (different bundler), web-only React,
  Next.js desktop builds (Electron is simpler), or PWA/Capacitor wrappers.
---

# Electron + Vite + React + TS

## Inputs to collect

- App purpose (one line) — affects window defaults, security posture, IPC surface
- Target OS (Win/macOS/Linux) — affects packaging + native module rebuilds
- Whether the app needs to talk to local hardware (USB, serial, capture cards) — drives the native module + Node integration story

If the user has not yet decided between Electron Forge and electron-vite, **default to electron-vite**: simpler config, faster HMR, smaller mental model. Reach for Forge only if the user already has a Forge template or wants Forge's first-class maker ecosystem (e.g., squirrel auto-update).

## Procedure

### 1. Scaffold the project

```bash
npm create @quick-start/electron@latest my-app -- --template react-ts
cd my-app
npm install
```

Why this template: it pre-wires the main/preload/renderer split, gives you sensible `electron.vite.config.ts`, and avoids 30 minutes of "why is the window blank" debugging.

### 2. Know the three-process model

| Process | Runs | Can access | Lives at |
|---------|------|------------|----------|
| **main** | Node.js | Everything (fs, child_process, native modules) | `src/main/index.ts` |
| **preload** | Node-ish (sandboxed bridge) | Limited Node APIs + a curated surface | `src/preload/index.ts` |
| **renderer** | Chromium | DOM only; talks to main via `window.api` | `src/renderer/` |

The renderer is intentionally Node-free in production. The preload is the only safe bridge. Hardcoding `nodeIntegration: true` to "make it work" is a security hole — use the preload instead.

### 3. Project structure that scales

```
src/
├── main/
│   ├── index.ts          # app lifecycle, window creation
│   ├── ipc/              # one file per domain (e.g., ipc/capture.ts, ipc/patients.ts)
│   ├── services/         # business logic, no Electron imports where possible
│   └── db/               # SQLite, migrations, repositories
├── preload/
│   ├── index.ts          # contextBridge.exposeInMainWorld('api', ...)
│   └── api.d.ts          # type augmentation for window.api
├── renderer/
│   ├── index.html
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/
│   ├── pages/
│   └── hooks/            # useXxx() that wraps window.api calls
└── shared/               # types shared between main and renderer (NO runtime code)
    ├── types.ts
    └── ipc-contract.ts   # channel names + payload types, imported by both sides
```

Why `shared/`: main and renderer must agree on IPC payload shapes. A single source of truth prevents "TypeError: cannot read property of undefined" at runtime.

### 4. IPC contract pattern (the one you should use every time)

```ts
// shared/ipc-contract.ts
export const IPC = {
  PATIENT_CREATE: 'patient:create',
  PATIENT_LIST: 'patient:list',
  CAPTURE_LIST_DEVICES: 'capture:list-devices',
  CAPTURE_START_RECORDING: 'capture:start-recording',
  // ...
} as const

export type Patient = { id: string; name: string; dob: string; /* ... */ }
export type CreatePatientInput = { name: string; dob: string; /* ... */ }
```

```ts
// preload/index.ts
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc-contract'

const api = {
  patients: {
    create: (input: CreatePatientInput) =>
      ipcRenderer.invoke(IPC.PATIENT_CREATE, input),
    list: () => ipcRenderer.invoke(IPC.PATIENT_LIST),
  },
  capture: {
    listDevices: () => ipcRenderer.invoke(IPC.CAPTURE_LIST_DEVICES),
    startRecording: (opts: StartRecordingOptions) =>
      ipcRenderer.invoke(IPC.CAPTURE_START_RECORDING, opts),
    onDeviceLost: (cb: () => void) => {
      ipcRenderer.on('capture:device-lost', cb)
      return () => ipcRenderer.removeListener('capture:device-lost', cb)
    },
  },
}

contextBridge.exposeInMainWorld('api', api)
```

```ts
// preload/api.d.ts
import type { Patient, CreatePatientInput } from '../shared/ipc-contract'

export interface Api {
  patients: {
    create: (input: CreatePatientInput) => Promise<Patient>
    list: () => Promise<Patient[]>
  }
  capture: {
    listDevices: () => Promise<VideoDevice[]>
    startRecording: (opts: StartRecordingOptions) => Promise<void>
    onDeviceLost: (cb: () => void) => () => void
  }
}

declare global {
  interface Window { api: Api }
}
```

```ts
// main/ipc/patients.ts
import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-contract'
import { patientRepo } from '../db/patient-repo'

export function registerPatientIpc() {
  ipcMain.handle(IPC.PATIENT_CREATE, async (_e, input: CreatePatientInput) => {
    return patientRepo.create(input)
  })
  ipcMain.handle(IPC.PATIENT_LIST, async () => patientRepo.list())
}
```

Why this pattern: typed end-to-end, renderer has zero `any`, channels are named once in `IPC`, swapping implementations doesn't break the renderer.

### 5. The "blank window" checklist (run when the renderer is white)

1. DevTools console — usually shows the actual error
2. Check `main/index.ts` `webPreferences`: `contextIsolation: true`, `nodeIntegration: false`, `preload: path.join(__dirname, '../preload/index.js')` (note `.js` not `.ts`, electron-vite handles the build)
3. Check the preload actually loads: `console.log('preload ran')` at the top of `preload/index.ts`
4. Check `contextBridge` exposes correctly: `window.api` should exist in DevTools console
5. Check the renderer entry HTML actually references the built script (look at `dist/renderer/index.html` after `npm run build`)

### 6. Build, package, distribute

```bash
npm run dev       # dev with HMR for renderer, auto-restart for main
npm run build     # produces out/main, out/preload, out/renderer
npm run start     # run the built app locally
npm run package   # uses electron-builder to make installers in dist/
```

`electron-builder` config in `package.json` `"build"` field:

```json
{
  "build": {
    "appId": "com.example.colonoscopist",
    "productName": "Colonoscopist",
    "win": { "target": "nsis" },
    "mac": { "target": "dmg" },
    "linux": { "target": "AppImage" },
    "asar": true,
    "asarUnpack": [
      "**/node_modules/better-sqlite3/**",
      "**/node_modules/ffmpeg-static/**"
    ]
  }
}
```

`asarUnpack` is mandatory for native modules and binaries — they cannot load from inside an ASAR archive.

### 7. Native modules in Electron

Native modules (`better-sqlite3`, `serialport`, `usb`) need to be rebuilt against Electron's Node version, not the system Node:

```bash
npm install --save-dev @electron/rebuild
# After npm install, run:
npx electron-rebuild
```

Add a postinstall script to `package.json` so collaborators don't have to remember:

```json
"scripts": {
  "postinstall": "electron-rebuild"
}
```

For the colonoscopy app specifically: `better-sqlite3` and any `node-hid`/`serialport` for vendor SDKs both need this treatment.

### 8. Security baseline (apply from day 1, not later)

```ts
new BrowserWindow({
  webPreferences: {
    contextIsolation: true,        // isolate preload from renderer
    nodeIntegration: false,         // no Node in renderer
    sandbox: true,                  // OS-level sandbox (loses some Node APIs in preload, often fine)
    webSecurity: true,              // don't disable to "fix" CORS — fix CORS properly
    preload: path.join(__dirname, '../preload/index.js'),
  },
})
```

For a medical app handling patient data, this is non-negotiable. If you must relax `sandbox: true` for a specific Node API in preload, document why and isolate that one window.

## Output contract

Working with this skill should leave you with:

- A scaffolded `my-app/` directory with `src/main`, `src/preload`, `src/renderer`
- `npm run dev` opening a working window with HMR
- A typed IPC contract in `src/shared/ipc-contract.ts` used by both main and renderer
- `electron-builder` configured for the target OS with `asarUnpack` covering native modules
- `postinstall: electron-rebuild` so native modules work after fresh install

## Failure handling

- **Window is blank** → run the 5-step checklist in section 5
- **"Unable to load preload script"** → path is wrong; remember `.js` not `.ts` in the path string (electron-vite builds TS to JS for you)
- **Native module "invalid ELF" or "wrong architecture"** → forgot `electron-rebuild`; run it
- **`window.api` is undefined in renderer** → preload didn't load or `contextBridge` call is wrong; check the preload file actually has `contextBridge.exposeInMainWorld(...)`
- **HMR works but main process changes don't pick up** → main process restarts on change in dev mode; if not, check `electron.vite.config.ts` `main.watch` settings
- **"Cannot find module" after packaging** → that module is inside ASAR; add it to `asarUnpack` (common offenders: native modules, `.node` files, bundled binaries like `ffmpeg-static`)

## Examples

**Input**: "Scaffold a new Electron app for the colonoscopy project with TypeScript and React."

**Output**: `npm create @quick-start/electron@latest colonoscopist -- --template react-ts`, then verify `npm run dev` opens a window.

**Input**: "Add an IPC channel so the renderer can ask main to list USB capture devices."

**Output**: Add `CAPTURE_LIST_DEVICES` to `shared/ipc-contract.ts`, register a handler in `main/ipc/capture.ts`, expose `capture.listDevices` in `preload/index.ts`, type it in `preload/api.d.ts`, call from renderer via `window.api.capture.listDevices()`.

**Input**: "Why does my packaged app crash but `npm run dev` works fine?"

**Output**: Almost always a native module or binary not in `asarUnpack`. Check the stack trace for paths inside `app.asar`; add the missing module to `build.asarUnpack` and rebuild.
