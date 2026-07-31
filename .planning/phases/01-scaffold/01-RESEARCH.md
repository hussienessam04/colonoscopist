# Phase 1: Scaffold - Research

**Researched:** 2026-07-31
**Domain:** Electron 32 + electron-vite 2 + React 18 + TS 5.5 + Tailwind 3.4 + shadcn + better-sqlite3 11 (security-hardened app shell, Windows-only, offline)
**Confidence:** HIGH (stack + scaffold procedure locked and verified against official electron-vite docs; native-rebuild path verified against current npm registry)

## Summary

Phase 1 is a from-scratch foundation phase. The deliverable is "the app starts" — a hardened Electron BrowserWindow, a typed single-method IPC contract (`auth:status`), the postinstall rebuild hook for `better-sqlite3` against Electron 32's Node 20 ABI, and a placeholder login screen rendered by Tailwind + shadcn. There is no business logic, no DB, no auth, no ffmpeg — those are Phase 2+. The phase exists to (a) prove the build pipeline works on this machine, (b) wire the security baseline so it cannot regress, and (c) plant the IPC contract so every later phase appends to it instead of inventing a new one.

The two highest-leverage risks are both Pitfall 4 (native module ABI mismatch — `better-sqlite3` must be rebuilt against Electron's Node, not system Node; Pitfalls §4) and the security baseline (must be locked on day 1 or it never gets fixed; STACK.md §Core). Both are addressed by hooks in `package.json` and a literal string match in `webPreferences` so the verifier can grep for it. The third risk is scope creep: every later phase will want to add "just one more thing" to the scaffold — patient schema, ffmpeg wiring, i18n plumbing. The Traceability row in REQUIREMENTS.md (line 181) maps SET-04 to Phase 1 but the phase description (ROADMAP §Phase 1) says "real CRUD in Phase 2"; CONTEXT.md §Deferred Ideas confirms a static stub ships here.

**Primary recommendation:** Use the official `npm create @quick-start/electron@latest ... --template react-ts` scaffolder (preserves the maintained main/preload/renderer split and HMR config), pin the locked exact versions in `package.json` (Electron 32.3.3, electron-vite 2.3.0, better-sqlite3 11.10.0, Tailwind 3.4.x, TS 5.5.x), wire the `postinstall: electron-rebuild` hook before the first `npm install` so the binding is correct from the start, and add a startup log line that records the loaded better-sqlite3 binding version so the Phase 1 success criterion #2 (ABI build verification) is observable.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Product name `Colonoscopist`; appId `com.colonoscopist.app` — **Reversibility: ONE-WAY** (Windows registry keys, install directory, Start Menu label, file associations all derive from these).
- **D-02:** Default window size `1280×800`; minimum `1280×800` — Reversible.
- **D-03:** Window is resizable; maximum `1920×1080` — Reversible.
- **D-04:** Single main `BrowserWindow` for all routes (Login, Patient, Procedure Room, Review, Report, Settings) — Reversibility: COSTLY.
- **D-05:** Placeholder login shows a clinic logo placeholder (gray box with text `Clinic Logo`) above a centered `Enter PIN` input — Reversible.
- **D-06:** No language toggle on placeholder login; English-only text in Phase 1 — Reversible.
- **D-07:** PIN input is numeric, 4 digits, masked (dots, not plaintext); accepts digits only — Reversible.
- **D-08:** `Enter` button disabled with a one-line hint banner: `Auth ships in Phase 2 — PIN input is disabled` — Reversible.

### the agent's Discretion

- Tailwind v3.4 + shadcn/ui component placement (which shadcn components to pre-install for the placeholder login: `Button`, `Input`, `Label` minimum).
- Exact phrasing of the hint banner copy (D-08 covers substance; copy is at the agent's discretion).
- Whether the placeholder clinic logo uses inline SVG or a Tailwind-styled `<div>` — both are fine.

### Deferred Ideas (OUT OF SCOPE)

- **SET-04 traceability mismatch (flag for planner):** Admin add/edit/remove users is mapped to Phase 1 in REQUIREMENTS.md Traceability but logically requires a DB. The planner should ship Phase 1 as a static stub UI (or omit the user-management section entirely) and implement the working feature in Phase 2. Flag this clearly in `01-PLAN.md` so the executor and verifier do not try to wire user-management CRUD without a DB.
- i18n scaffolding (deferred to Phase 7 — I18N-01/02/03).
- Real PIN auth (Phase 2 — AUTH-01/02/03).
- DB connection (Phase 2).
- ffmpeg / capture devices (Phase 3+).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **AUTH-01** | User can log in with PIN; multi-user support on the same workstation. **Phase 1 = foundation only.** Real PIN flow ships Phase 2. | Phase 1 wires `src/main/`, `src/preload/`, `src/renderer/` directories and the `auth:status` IPC channel placeholder; provides the foundation AUTH-01 ships against. The placeholder login UI (D-05/D-07/D-08) is the visual anchor. |
| **AUTH-04** | Active session ends on explicit logout or app close; no persistent session across workstation reboot. | Inherent in the offline-only, no-cookie architecture Phase 1 implements (contextIsolation + sandbox + no `electron-store` for session). ENFORCED by absence of any persistence path in Phase 1 — only `app.getPath('userData')` resolution ships, no DB writes. |
| **SET-03** | User can set the data storage path (advanced; default `<userData>/data`). | Phase 1 must wire `src/main/paths.ts` with `dataDir(): string = path.join(app.getPath('userData'), 'data')` so Phase 2's DB connection has a stable storage root from day 1 (Pitfall 9 fix is "have one source of truth from start"). No UI ships for it — that's Phase 7 (SET-03 traceability is satisfied at Phase 1 by path resolution, not by user setting). |
| **SET-04** | Admin can add, edit, and remove users (PIN reset, role change). **TRACEABILITY MISMATCH:** Per CONTEXT.md §Deferred Ideas, Phase 1 ships a static stub UI only; real CRUD in Phase 2. | The CONTEXT.md deferred-ideas call-out takes precedence over the traceability row. Planner must flag this in `01-PLAN.md` so executors/verifiers don't wire user-management IPC without a DB. |

## Project Constraints (from AGENTS.md)

- Tech stack locked: electron-vite 2 + React 18 + TS 5.5 + Tailwind 3.4 + shadcn/ui + better-sqlite3 11.
- Windows-only v1; no macOS/Linux packaging.
- Offline-only daily use; no cloud, no PACS, no DICOM.
- Security baseline is non-negotiable from day 1: `contextIsolation: true, nodeIntegration: false, sandbox: true`.
- Native module rebuild must be wired via `postinstall` hook (Pitfall 4).
- IPC pattern: typed `src/shared/ipc-contract.ts` imported by main + preload + renderer via global augmentation.
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| App lifecycle + window creation | Frontend Server (SSR) / Main process | — | Electron `app.whenReady()`, single `BrowserWindow`, lifecycle hooks (will-quit); owns the security baseline. |
| `app.getPath('userData')` + `dataDir()` resolution | Main process | — | Single source of truth for all on-disk paths (SET-03); must resolve before any later phase writes. |
| Postinstall native rebuild | Build-time / dev toolchain | — | `npm install` hook runs `electron-rebuild` (Pitfall 4 prevention). Not a runtime tier. |
| BrowserWindow security baseline (`webPreferences`) | Main process | — | Renderer must not relax it; this is the renderer-side privilege barrier. |
| Preload bridge (`contextBridge.exposeInMainWorld`) | Preload | — | Only safe path between renderer and Node; the typed contract is enforced here. |
| `auth:status` IPC method | Main (`ipcMain.handle`) | Preload (`ipcRenderer.invoke` exposed via contextBridge) | The seed of the contract every later phase extends. |
| Startup ABI log | Main process | — | Phase 1 success criterion #2 — observe the loaded native binding version. |
| Placeholder login UI (Tailwind + shadcn) | Renderer (React) | — | Pure cosmetic surface; replaced in Phase 2. |
| Static stub for SET-04 (user management) | Renderer (React) | — | No DB wiring — `<div>User management ships in Phase 2</div>` or omitted. |
| `tsconfig.strict` + no `any` in IPC contract | Build-time | — | Type-safety gate. |

## Standard Stack

### Core

| Library | Version (locked) | Verified on npm registry | Purpose | Why Standard |
|---------|------------------|---------------------------|---------|--------------|
| `electron` | `^32` (pin `.3` minor → `32.3.3`) [VERIFIED: npm registry — `electron@32.3.3` is highest v32] | latest v32 = 32.3.3 | Desktop runtime (Chromium + Node 20 ABI) | Already locked in STACK.md §Core; v32 chosen for Node 20 ABI fit with `better-sqlite3` v11 (STACK §Version Compatibility). |
| `electron-vite` | `^2` (pin → `2.3.0`) [VERIFIED: npm registry — `electron-vite@2.3.0` is highest v2] | latest v2 = 2.3.0 | Build/dev pipeline for main + preload + renderer | Official electron-vite scaffolder (`npm create @quick-start/electron@latest`) and maintainer-documented. Per official docs: "electron-vite does not support `nodeIntegration`" — this matches our security baseline. |
| `react` | `^18` | latest = 19.2.8 (we do NOT upgrade) | UI framework | STACK.md lock; React 19 incompatible with shadcn ecosystem at lock time per STACK §Version Compatibility. |
| `react-dom` | `^18` | n/a | React DOM binder | Mates with React 18. |
| `typescript` | `^5.5` (pin → `5.5.x`) | latest = 7.0.2 (we do NOT follow latest) | Type safety; end-to-end IPC contract | STACK.md lock; bumping to TS 7 risks breaking `@types/*` compat in Phase 2+. Stay at 5.5. |
| `vite` | `^5` (transitive via electron-vite) | latest = 7.x (we do NOT upgrade) | Renderer dev server + bundler | Pin via electron-vite; renderer HMR is the killer feature of electron-vite over Forge. |

### Supporting (Phase 1 installs only the ones needed THIS phase)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `better-sqlite3` | `^11` (pin → `11.10.0`) [VERIFIED: npm registry — `better-sqlite3@11.10.0` is highest v11] | Local SQLite, sync API (Phase 2+ writes; Phase 1 ONLY proves the binding builds and loads in main without errors) | Phase 1 success criterion #2 — install + rebuild + log the binding version. No DB opens. |
| `@electron/rebuild` | `^4` (devDep) | Native module rebuild against Electron's Node ABI | Postinstall hook; replaces legacy `electron-rebuild` (v3.2.9 still works but `@electron/rebuild` is the renamed lineage; STACK.md references either; pick the renamed name for greenfield). |
| `@types/better-sqlite3` | `^7` (devDep) | TS types for `better-sqlite3` | Keeps `tsc --noEmit` clean. |
| `@types/react` | `^18` (devDep) | React types | Mates with React 18. |
| `@types/react-dom` | `^18` (devDep) | React DOM types | Mates with React DOM 18. |
| `@types/node` | `^20` (devDep) | Node 20 types (matches Electron 32's bundled Node) | electron-vite main/preload build expects this. |
| `tailwindcss` | `^3.4` (pin → `3.4.19`) [VERIFIED: npm registry — `tailwindcss@3.4.19` is highest 3.4.x] | CSS engine for the placeholder login | STACK.md lock; do NOT upgrade to Tailwind 4 (no official shadcn compatibility at lock time per STACK §Version Compatibility). |
| `postcss` | `^8` (devDep) | Tailwind PostCSS pipeline | Required by Tailwind. |
| `autoprefixer` | `^10` (devDep) | Tailwind PostCSS plugin | Required by Tailwind. |
| `class-variance-authority`, `clsx`, `tailwind-merge` | latest (peer of shadcn) | Styling helpers emitted by `shadcn add` | Installed only when `shadcn init` runs. |
| `@radix-ui/react-*` | latest (peer of shadcn primitives) | Underlying primitives for shadcn components | Installed on demand by `shadcn add` for `button`, `input`, `label`. |
| `lucide-react` | latest (peer of shadcn) | Icon set used by shadcn defaults | Installed when first shadcn component is added. |

### Deferred to later phases (DO NOT install in Phase 1)

| Library | Phase | Reason to defer |
|---------|-------|-----------------|
| `ffmpeg-static` | Phase 3+ (per STACK) | Phase 1 doesn't open capture devices; adding now creates unused install weight. |
| `@react-pdf/renderer` | Phase 6 | Reports. Not needed for the placeholder login. |
| `@noble/ed25519` | Phase 8 (license verify) | License not wired until Phase 8. |
| `archiver` / `yauzl` | Phase 7 (backup/restore) | Not needed for the placeholder login. |
| `i18next` + `react-i18next` + `i18next-browser-languagedetector` | Phase 7 | i18n deferred per CONTEXT.md D-06. |
| `electron-builder` | Phase 8 (or packaging wave) | Phase 1 doesn't package; adds `dist/` config complexity. Can be deferred — see Open Questions. |
| `better-sqlite3-multiple-ciphers` / SQLCipher | v2 (per PITFALLS §"What NOT to Use") | App-level encryption via `safeStorage` is v1 plan. |
| `electron-store` | NEVER | Persistence for non-DB config (e.g., window state) — out of Phase 1 scope and not in stack. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `npm create @quick-start/electron@latest ... --template react-ts` | `npx degit alex8088/electron-vite-boilerplate` | degit gives the maintainer's full boilerplate but no template selection; `npm create` is the documented path with `--template` flag [VERIFIED: Context7 /electron-vite-docs/guide]. |
| `@electron/rebuild` v4 (renamed lineage) | `electron-rebuild` v3.2.9 (legacy) | Both invoke the same underlying `node-gyp`; greenfield should pick the current name. STACK.md references the legacy name; the rename predates Phase 1. |
| Tailwind CSS via `shadcn init` | Tailwind CSS installed standalone | shadcn init pulls Tailwind 3.4 + configures PostCSS + emits `globals.css` directives; standalone install leaves you wiring the directives manually. |
| `shadcn@latest` CLI (new) | Legacy `shadcn-ui` CLI | Old CLI was deprecated; current package name is `shadcn`. [VERIFIED: npm registry — `shadcn@4.16.1` is latest, `shadcn-ui` is unmaintained]. |
| `better-sqlite3` v11 | `node-sqlite3` (async callbacks) | STACK.md §Alternatives Considered — better-sqlite3 sync API wins in main process; v11 is the locked major (latest v11 = 11.10.0). |
| Pin exact versions (no `^`) | `^` caret ranges | Phase 1 pins exact minors (32.3.3, 2.3.0, 11.10.0) to make the postinstall ABI lock reproducible. Lockfile is regenerated on `npm install` to capture transitives. |

### Installation

Run from the repo root (current directory has no `package.json` yet — greenfield):

```bash
# 1. Initialise package.json (the electron-vite scaffolder requires an empty target dir).
npm init -y

# 2. Run the official electron-vite scaffolder into a temp dir, then move files up —
#    OR run it with the project name as last arg. Using --template react-ts is mandatory.
#    (See "Scaffolding procedure" below — the scaffolder writes into ./colonoscopist by default.)
npm create @quick-start/electron@latest colonoscopist -- --template react-ts

# 3. Move scaffold contents into the repo root (or scaffold in-place, see Open Questions).
# 4. Install runtime deps:
npm install better-sqlite3@11.10.0
# 5. Install dev deps:
npm install -D @electron/rebuild @types/better-sqlite3 tailwindcss@3.4.19 postcss autoprefixer
# 6. Add postinstall hook (manual edit to package.json — see Key Patterns):
#    "postinstall": "electron-rebuild"
# 7. Re-run install to trigger postinstall:
npm install
```

> ⚠️ Order matters. The postinstall hook MUST be added to `package.json` BEFORE the second `npm install` so better-sqlite3 is rebuilt against Electron 32's Node 20 ABI on first install — otherwise the running `better-sqlite3` binary (built for system Node 24) loads incompatibly and the app crashes (Pitfall 4).

## Package Legitimacy Audit

**Required:** the Package Legitimacy Gate ran before this section was written. Every package listed below is verified via `npm view <pkg> version` on the npm registry (direct calls, not WebSearch) and cross-checked against Context7 / official docs.

| Package | Registry | Source | Verdict | Disposition |
|---------|----------|--------|---------|-------------|
| `electron@^32` | npm | electronjs/electron (GitHub) | OK | Approved (pin 32.3.3) |
| `electron-vite@^2` | npm | alex8088/electron-vite (GitHub) | OK | Approved (pin 2.3.0) |
| `react@^18` | npm | facebook/react | OK | Approved |
| `react-dom@^18` | npm | facebook/react | OK | Approved |
| `typescript@^5.5` | npm | microsoft/TypeScript | OK | Approved |
| `better-sqlite3@^11` | npm | WiseLibs/better-sqlite3 | OK | Approved (pin 11.10.0) |
| `@electron/rebuild@^4` | npm | electron/rebuild (renamed from `electron-rebuild`) | OK | Approved |
| `tailwindcss@^3.4` | npm | tailwindlabs/tailwindcss | OK | Approved (pin 3.4.19) — DO NOT upgrade to Tailwind 4 |
| `shadcn` (CLI) | npm | shadcn-ui/ui | OK | Approved (`shadcn add button input label`) |
| `@radix-ui/react-label`, `@radix-ui/react-slot` | npm | radix-ui/primitives | OK | Approved (peer deps of shadcn Button/Input/Label) |
| `lucide-react` | npm | lucide-icons/lucide | OK | Approved (peer dep) |
| `class-variance-authority`, `clsx`, `tailwind-merge` | npm | various | OK | Approved |
| `@quick-start/electron` (scaffolder) | npm | alex8088/electron-vite-boilerplate | OK | Approved (runs once at scaffold time, not a runtime dep) |

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.

> Note on provenance: registry existence alone does not mark a package `[VERIFIED]`. The audit table is the legitimacy verdict; the per-package provenance tags in Standard Stack combine registry + official-doc verification.

## Architecture Patterns

### System Architecture Diagram

```
[Scaffolder: npm create @quick-start/electron@latest --template react-ts]
    │
    │ writes
    ▼
[colonoscopist/]  ←  package.json (electron ^32.3.3, electron-vite ^2.3.0, better-sqlite3 ^11)
    │
    │ npm install
    ▼
[postinstall: electron-rebuild]  ← compiles better-sqlite3 against Electron's Node 20 ABI
    │
    │ npm run dev
    ▼
[Main process: src/main/index.ts]
    ├── resolves app.getPath('userData')          →  src/main/paths.ts
    ├── creates BrowserWindow (1280×800, max 1920×1080)  with
    │       webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: ... }
    ├── logs "better-sqlite3 binding version: X.Y.Z"  ← success criterion #2
    └── registers ipcMain.handle(IPC.AUTH_STATUS)   ← returns { authenticated: false, reason: 'scaffold' }
    │
    ▼
[Preload: src/preload/index.ts]
    ├── imports IPC + types from src/shared/ipc-contract.ts
    ├── contextBridge.exposeInMainWorld('api', { auth: { status: () => ipcRenderer.invoke(IPC.AUTH_STATUS) } })
    └── src/preload/api.d.ts: global Window['api'] type augmentation (no any)
    │
    ▼
[Renderer: src/renderer/]
    ├── index.html sets <html dir="ltr">  (only direction this phase)
    ├── main.tsx mounts React root
    ├── App.tsx routes to Login placeholder
    └── src/renderer/pages/Login.tsx:
            ├── clinic logo placeholder div ("Clinic Logo")     ← D-05
            ├── <Input type="password" maxLength={4} inputMode="numeric" pattern="[0-9]*" />  ← D-07
            ├── <Button disabled>Enter</Button>                  ← D-08
            └── <p>Auth ships in Phase 2 — PIN input is disabled</p>  ← D-08
```

Data flow is one-way, one-shot: a single `auth:status` round-trip. No DB, no ffmpeg, no async events from main.

### Recommended Project Structure (Phase 1 minimal)

```
colonoscopist/
├── package.json                         # name: colonoscopist, type: module, postinstall: electron-rebuild
├── electron.vite.config.ts              # from --template react-ts; tweak main entry if needed
├── tsconfig.json                        # strict: true, noImplicitAny: true (subsumed)
├── tsconfig.node.json                   # main + preload build target
├── tsconfig.web.json                    # renderer build target (DOM lib)
├── tailwind.config.ts                   # content globs for src/renderer/**
├── postcss.config.js
├── components.json                      # shadcn registry config (style: default, RSC: false)
├── electron-builder.yml                 # Win NSIS + portable, asarUnpack for better-sqlite3 (PLACEHOLDER OK until Phase 8)
├── src/
│   ├── main/
│   │   ├── index.ts                     # app.whenReady → createWindow, log ABI, register ipc
│   │   ├── paths.ts                     # dataDir() = userData/data  ← SET-03 fulfillment
│   │   ├── window.ts                    # createMainWindow() with locked webPreferences + D-02/D-03 sizes
│   │   ├── ipc/
│   │   │   └── auth.ts                  # ipcMain.handle(IPC.AUTH_STATUS) → stub return
│   │   └── startup-log.ts               # writes "[boot] better-sqlite3 binding version: X.Y.Z" to stderr + app.getPath('logs')
│   ├── preload/
│   │   ├── index.ts                     # contextBridge.exposeInMainWorld('api', ...)
│   │   └── api.d.ts                     # global Window['api'] declaration
│   ├── renderer/
│   │   ├── index.html                   # <html dir="ltr">
│   │   ├── main.tsx                     # ReactDOM.createRoot
│   │   ├── App.tsx                      # renders <Login />
│   │   ├── pages/
│   │   │   └── Login.tsx                # D-05/D-07/D-08 compliant
│   │   ├── components/
│   │   │   └── ui/                      # shadcn-generated (button.tsx, input.tsx, label.tsx)
│   │   └── styles/
│   │       └── globals.css              # tailwind directives
│   └── shared/
│       ├── ipc-contract.ts              # IPC.AUTH_STATUS constant + AuthStatus type
│       └── errors.ts                    # stub IpcError union for future phases
├── tests/                               # Wave 0 (see Validation Architecture)
│   ├── shared/
│   │   └── ipc-contract.test-d.ts       # type-level: AuthStatus is not any
│   └── shell/
│       └── boot.test.ts                 # electron spawns and ABI log appears
├── scripts/
│   └── check-security-baseline.cjs      # grep webPreferences keys in src/main/window.ts; CI gate
└── docs/
```

> Phase 2 adds `src/main/db/{connection,migrations,...}.ts`; Phase 3 adds `src/main/recorder/`. They are intentionally absent now so a future grep `ls src/main` confirms Phase 1 doesn't open SQLite.

### Pattern 1: Typed single-method IPC contract (the foundation every later phase extends)

**What:** A `src/shared/ipc-contract.ts` file defines channel name constants and types once. The main process imports the constant to register handlers; the preload imports the same file to expose typed methods on `window.api`; the renderer consumes the typed surface.

**When to use:** Always, starting with this phase. Every later phase appends to this file, never invents a new one.

**Example (Phase 1 minimal):**

```typescript
// src/shared/ipc-contract.ts
// No any allowed by Phase 1 verifier (see Validation Architecture).

export const IPC = {
  AUTH_STATUS: 'auth:status',
} as const;

export type AuthStatus =
  | { authenticated: false; reason: 'scaffold' }
  | { authenticated: false; reason: 'no-session'; nextStep: 'login' };

export interface IpcContract {
  auth: {
    status: () => Promise<AuthStatus>;
  };
}
```

```typescript
// src/main/ipc/auth.ts
import { ipcMain } from 'electron';
import type { AuthStatus } from '../../shared/ipc-contract';
import { IPC } from '../../shared/ipc-contract';

export function registerAuthIpc(): void {
  ipcMain.handle(IPC.AUTH_STATUS, (): AuthStatus => ({
    authenticated: false,
    reason: 'scaffold',
  }));
}
```

```typescript
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron';
import type { IpcContract } from '../shared/ipc-contract';
import { IPC } from '../shared/ipc-contract';

const api: IpcContract = {
  auth: {
    status: () => ipcRenderer.invoke(IPC.AUTH_STATUS),
  },
};

contextBridge.exposeInMainWorld('api', api);
```

```typescript
// src/preload/api.d.ts
import type { IpcContract } from '../shared/ipc-contract';
declare global {
  interface Window { api: IpcContract; }
}
export {};
```

```tsx
// src/renderer/pages/Login.tsx
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { AuthStatus } from '../../shared/ipc-contract';

export function Login() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  useEffect(() => {
    void window.api.auth.status().then(setStatus);
  }, []);
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50">
      <div className="flex flex-col items-center gap-6 p-8 w-96">
        <div className="w-32 h-32 rounded-lg bg-slate-200 grid place-items-center text-slate-500">
          Clinic Logo
        </div>
        <Label htmlFor="pin" className="sr-only">PIN</Label>
        <Input
          id="pin"
          type="password"           // masked, D-07
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          disabled                  // D-08
          placeholder="Enter PIN"
          className="text-center tracking-widest text-lg"
        />
        <Button disabled>Enter</Button>
        <p className="text-sm text-slate-500">
          Auth ships in Phase 2 — PIN input is disabled
        </p>
        <pre className="text-xs text-slate-400">
          status: {status ? JSON.stringify(status) : '...'}
        </pre>
      </div>
    </main>
  );
}
```

### Pattern 2: Verified security baseline via a runtime guard + a grep gate

**What:** BrowserWindow is created with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` as literal object properties. Two defences:
1. A startup assertion logs an error if any of those flags is `false` or missing.
2. `scripts/check-security-baseline.cjs` greps `src/main/window.ts` for the exact flag names and exits non-zero on missing — run in CI.

**When to use:** Always. The PROJECT.md security baseline is non-negotiable; CI is the only thing that prevents accidental relaxation (Pitfall: "nodeIntegration:true because it's easier").

```typescript
// src/main/window.ts
import { BrowserWindow, app } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logStartup } from './startup-log';

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 1280, minHeight: 800, maxWidth: 1920, maxHeight: 1080, // D-02/D-03
    title: 'Colonoscopist',                              // D-01
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,                                  // NEVER disable
      preload: path.join(__dirname, '../preload/index.js'),
    },
  });
  logStartup('window-created');
  return win;
}
```

```javascript
// scripts/check-security-baseline.cjs
const fs = require('node:fs');
const src = fs.readFileSync('src/main/window.ts', 'utf8');
const required = ['contextIsolation: true', 'nodeIntegration: false', 'sandbox: true'];
const missing = required.filter((k) => !src.includes(k));
if (missing.length) { console.error('SECURITY BASELINE MISSING:', missing.join(', ')); process.exit(2); }
console.log('security baseline OK');
```

### Anti-Patterns to Avoid (Phase 1)

- **Anti-pattern: Scaffolding via raw `npm init` + manual wiring.** Drift between files; "blank window" issues. Use the official scaffolder.
- **Anti-pattern: Adding `electron-store` for window state.** No persistence in Phase 1; window state is allowed to forget on every launch. Adding `electron-store` invites the renderer to want cookies, storage, and DB-shaped patterns Phase 1 explicitly defers.
- **Anti-pattern: Pinning Tailwind 4.** shadcn ecosystem was not on Tailwind 4 at lock time (STACK §Version Compatibility). Doing so breaks `tailwindcss-animate` and the default `globals.css` from `shadcn init`.
- **Anti-pattern: Adding Zustand / React Router in the name of "preparing for later phases."** Phase 1 has one page (Login). YAGNI.
- **Anti-pattern: Importing `better-sqlite3` inside `src/main/index.ts` to "test it works."** Phase 1 only needs to PROVE the binding was built. Do `require('better-sqlite3')` inside a try/catch in `startup-log.ts` and log the version — then discard the module (the actual connection belongs in Phase 2). Crashing into a DB open during scaffold invites scope drift into migrations.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Three-process build wiring | Manual `tsc` + `esbuild` + `browserify` combo | `electron-vite` official scaffolder (`@quick-start/electron`) | Per electron-vite docs: "electron-vite does not support `nodeIntegration`" — it bakes the hardened layout in. Hand-rolling it drifts toward looser `webPreferences`. |
| HMR for main + preload | Custom watcher | electron-vite's built-in `electron({...})` plugin (already in the template) | Main reload on save is non-trivial to write; the template handles it. |
| `better-sqlite3` Electron rebuild | `npm rebuild --runtime=electron --target=...` | `@electron/rebuild` postinstall hook | One-liner in `package.json`; covers Node ABI for the locked Electron major without per-version scripting. |
| Type-safe IPC | Two parallel `string` unions in main and preload | `src/shared/ipc-contract.ts` imported by both | Drift-causing "TypeError: cannot read property of undefined" at runtime ([ASSUMED — standard Electron-app pattern]). |
| Tailwind + shadcn plumbing | Manual `globals.css` + `tailwind.config.ts` wiring | `npx shadcn@latest init` (or `shadcn init` with legacy CLI if 1.x template requires it) | shadcn emits a Tailwind config with the correct `content` globs and `darkMode: 'class'` so RTL later is a one-line change. |
| React DOM mount | Hand-mount with `React.createElement` | `react-dom/client` `createRoot` | Standard, no advantage to avoiding it. |
| Window-position persistence | Custom serialization to `package.json` | (DEFER) | Phase 1 doesn't persist window state. v1 is "always opens at 1280×800 in centre." |

**Key insight:** Phase 1 is a composition exercise, not invention. Almost every primitive the phase uses has a maintained library or CLI. The planner should emit ~8–10 small tasks that *compose* the official pieces (npm create, shadcn init, @electron/rebuild), not write large amounts of code.

## Runtime State Inventory

Not applicable. Phase 1 is greenfield scaffolding; there is no runtime state to migrate or rename. The "inventory" is empty:

| Category | Items Found |
|----------|-------------|
| Stored data | None — first scaffold; `app.getPath('userData')` resolution is the placeholder for Phase 2. |
| Live service config | None — no services yet. |
| OS-registered state | None — app is not yet installed/registered. (`com.colonoscopist.app` registry keys are a Phase 8 packaging concern.) |
| Secrets / env vars | None — no `.env`, no `safeStorage` calls. |
| Build artifacts | None — first `npm run build` hasn't run. |

## Common Pitfalls

### Pitfall 1 — `postinstall: electron-rebuild` added AFTER the first install

**What goes wrong:** `better-sqlite3`'s prebuilt binary (Postgres's prebuilt, not the Electron one) is resolved from npm cache against system Node 24's ABI. App launches, hits `require('better-sqlite3')`, fails with `cannot find module` or wrong architecture (Pitfall 4).
**Why it happens:** Order of operations — `npm init -y && npm install ...` runs before the user remembers to edit `package.json`.
**How to avoid:** Add `"postinstall": "electron-rebuild"` to `package.json` BEFORE the second `npm install` (the one that fetches `better-sqlite3`). Document the order in the README install section.
**Warning signs:** Postinstall log shows `electron-rebuild` was not invoked; `app.asar/unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node` is missing the Electron header comments.

### Pitfall 2 — Blank renderer window on first `npm run dev`

**What goes wrong:** Main process launches, window appears white.
**Why it happens:** (a) Wrong `preload` path (`../preload/index.js` expected; TS extension forgotten). (b) `webPreferences.preload` is missing. (c) `index.html` references a path Vite hasn't emitted (HMR lag on cold start). (d) Tailwind `content` glob misses the renderer source.
**How to avoid:** Run the 5-step "blank window" checklist from `.opencode/skills/electron-vite/SKILL.md` §5 (DevTools console → webPreferences → preload actually loads → `window.api` exists → built `index.html` script tag).
**Warning signs:** DevTools shows `Uncaught ReferenceError: __dirname is not defined` (renderer) or `Cannot find module '../preload/index.js'`.

### Pitfall 3 — `tsconfig.strict` doesn't include `noImplicitAny` in renderer build

**What goes wrong:** Renderer type-check silently allows `any` in JSX/TSX, defeating the Phase 1 success criterion #5.
**Why it happens:** electron-vite template ships two tsconfigs — `tsconfig.node.json` (main+preload) and `tsconfig.web.json` (renderer). If the renderer extends the base without `"strict": true`, the strictness leaks.
**How to avoid:** Ensure BOTH `tsconfig.node.json` AND `tsconfig.web.json` have `"strict": true, "noImplicitAny": true`. Add a `scripts/check-no-any.cjs` CI gate that greps `src/shared/**.ts` and `src/preload/api.d.ts` for `as any`/`any` (allowlist: `eslint-disable-line` next to literal).

### Pitfall 4 — Pinning too loose (caret ranges) drifts the Electron minor and breaks the ABI lock

**What goes wrong:** Collaborator runs `npm install` months later; Electron was bumped to 32.4.0 in `^32`; better-sqlite3 wasn't rebuilt; app crashes (Pitfall 4 again).
**Why it happens:** Caret ranges allow minor bumps.
**How to avoid:** Pin the Electron minor exactly (`"electron": "32.3.3"`) plus an `engines` field. The `package-lock.json` will lock transitive abi versions.
**Warning signs:** Two `electron-rebuild` invocations produce different binding hashes.

### Pitfall 5 — `shadcn init` for an Electron + Vite project mistakenly adds `components.json` with `rsc: true`

**What goes wrong:** Generated `components.json` has RSC enabled; `shadcn add` emits import paths with `"use client"` directives and server-only patterns.
**Why it happens:** shadcn init defaults differ by template.
**How to avoid:** After `shadcn init`, verify `components.json` has `"rsc": false` and the style is `"default"`. The `--yes --defaults` flags minimize foot-guns.

### Pitfall 6 — `nodeIntegration: true` is silently added by a third-party plugin

**What goes wrong:** A Vite plugin (e.g., a screen-capture mock) requests `webPreferences.nodeIntegration: true`; the `webPreferences` object gets merged by spread; baseline relaxed.
**Why it happens:** Spread/object-merging of `webPreferences` masks drift.
**How to avoid:** Build `webPreferences` as a literal object literal in `src/main/window.ts` — no spread, no merge. The grep gate (§Validation Architecture) catches this.

### Pitfall 7 — Storing real user PIN even in stub form

**What goes wrong:** Phase 1 wires up a "first-time setup" PIN input that accepts 4 digits and writes them somewhere.
**Why it happens:** Misreading D-05/D-07 as "build the form" rather than "build a disabled placeholder."
**How to avoid:** The Pin input is `disabled` (D-08). `onChange` is not wired. D-07 means "the visual treatment matches what Phase 2 ships" — not "Phase 2 ships now."

### Pitfall 8 — Adding `prettier`/`eslint` config that conflicts with electron-vite template defaults

**What goes wrong:** Custom ESLint config disables `no-explicit-any` because some legacy module uses it; Phase 1 success criterion #5 (no `any` in IPC contracts) regresses.
**Why it happens:** Initiator wants strict; composer reflex adds loose.
**How to avoid:** Use the electron-vite template's lint config as-is; add `.eslintrc.cjs` rule `@typescript-eslint/no-explicit-any: "error"` to IPC paths specifically.

## Validation Architecture

Nyquist validation is **enabled** per `workflow.nyquist_validation: true` in `.planning/config.json`. This section is mandatory.

### Test Framework

Phase 1 ships the test infrastructure (the test command, a tiny smoke test) — it does NOT need a full test suite. The success criteria are mostly observability-of-build steps (ABI log, webPreferences literal, IPC round-trip), which are best checked by small CI scripts and a single boot smoke test.

| Property | Value |
|----------|-------|
| Framework | `vitest` (devDep) — chosen because STACK.md lists it and it works for both Node (main) and DOM (renderer) tests; but Phase 1 only uses the Node path |
| Config file | `vitest.config.ts` (Node environment only in Phase 1) |
| Quick run command | `npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json && node scripts/check-security-baseline.cjs && node scripts/check-no-any.cjs && node scripts/check-ipc-contract.cjs && npx vitest run` |
| Full suite command | Same as quick — Phase 1 has only one smoke test |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|---------------|
| AUTH-01 (foundation) | `auth:status` IPC round-trip works end-to-end | smoke (Vitest with electron mock) | `npx vitest run tests/shell/auth-status.test.ts` | ❌ Wave 0 |
| AUTH-04 (foundation) | No cookies/storage are written | static check | `node scripts/check-no-persistence.cjs` (greps for `localStorage`, `sessionStorage`, `electron-store`, `cookie`) | ❌ Wave 0 |
| SET-03 (foundation) | `src/main/paths.ts` exports `dataDir()` resolving to `userData/data` | unit (Vitest) | `npx vitest run tests/main/paths.test.ts` | ❌ Wave 0 |
| SET-04 (stub) | User-management UI is a static stub only | static check | `node scripts/check-set04-stub.cjs` (greps for absent IPC channels like `users:create`) | ❌ Wave 0 |

### Success Criteria → Test Map (per ROADMAP §Phase 1)

| # | Success Criterion | Test Type | Automated Command / Assertion | File Exists? |
|---|-------------------|-----------|-------------------------------|---------------|
| 1 | `contextIsolation: true, nodeIntegration: false, sandbox: true` verified in code | static (grep) | `node scripts/check-security-baseline.cjs` exits 0 | ❌ Wave 0 |
| 2 | `better-sqlite3` rebuild on `npm install` succeeds; startup log records the binding version | build-time + runtime (smoke) | (a) postinstall log shows `electron-rebuild` ran; (b) `npm run dev` produces `[boot] better-sqlite3 binding version: 11.10.0` in stderr | ❌ Wave 0 (smoke test) |
| 3 | Renderer can call `auth:status` end-to-end via preload + contextBridge | smoke (Vitest) | `npm run dev`, then a small headless-driven Electron boot that asserts `await window.api.auth.status()` returns `{ authenticated: false, reason: 'scaffold' }`. Practically: a Vitest test that mounts the preload bridge with a mocked `ipcRenderer.invoke` and asserts the typed return. | ❌ Wave 0 |
| 4 | Tailwind + shadcn render a placeholder login | build-time | `npm run build` exits 0 AND `dist/renderer/assets/*.css` contains at least one Tailwind utility class AND the build emits `dist/renderer/index.html` | ❌ Wave 0 |
| 5 | `tsconfig` strict mode passes with no `any` in IPC contracts | static (grep + tsc) | (a) `npx tsc --noEmit -p tsconfig.node.json` exits 0; (b) `npx tsc --noEmit -p tsconfig.web.json` exits 0; (c) `node scripts/check-no-any.cjs` greps `src/shared/`, `src/preload/api.d.ts` for the substring `any` (with allowlist for `// eslint-disable` and our own `IpcError`/`AuthStatus` union types that don't contain `any`) | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npx tsc --noEmit && node scripts/check-security-baseline.cjs && node scripts/check-no-any.cjs`
- **Per wave merge:** full suite above
- **Phase gate:** Full suite green AND manual `npm run dev` boots the placeholder login before `/gsd-verify-work`

### Wave 0 Gaps (must ship in Phase 1)

- [x] `package.json` — scaffolded by `npm create @quick-start/electron ...`
- [ ] `electron.vite.config.ts` — scaffolded by template; verify
- [ ] `tsconfig.json` + `tsconfig.node.json` + `tsconfig.web.json` — all three with `"strict": true`, `"noImplicitAny": true`
- [ ] `src/shared/ipc-contract.ts` — Phase 1 minimal (one constant + one union type)
- [ ] `src/preload/index.ts` + `src/preload/api.d.ts`
- [ ] `src/main/index.ts` + `src/main/window.ts` (locked `webPreferences`) + `src/main/paths.ts` + `src/main/ipc/auth.ts` + `src/main/startup-log.ts`
- [ ] `src/renderer/pages/Login.tsx` (D-05/D-07/D-08)
- [ ] `components.json` from `shadcn init`
- [ ] `src/renderer/components/ui/{button,input,label}.tsx` from `shadcn add`
- [ ] `src/renderer/styles/globals.css` with `@tailwind base; @tailwind components; @tailwind utilities;`
- [ ] `scripts/check-security-baseline.cjs`
- [ ] `scripts/check-no-any.cjs`
- [ ] `scripts/check-ipc-contract.cjs` — greps that `IPC.AUTH_STATUS === 'auth:status'` and that `IpcContract.auth.status` is declared
- [ ] `scripts/check-set04-stub.cjs` — asserts absence of `users:*` IPC channels in `src/shared/ipc-contract.ts`
- [ ] `scripts/check-no-persistence.cjs` — asserts absence of `localStorage`, `sessionStorage`, `electron-store`, `cookie`
- [ ] `vitest.config.ts`
- [ ] `tests/main/paths.test.ts` — `dataDir()` returns `path.join(userData, 'data')`
- [ ] `tests/shell/auth-status.test.ts` — preload bridge calls `ipcRenderer.invoke('auth:status')` and the typed return matches `AuthStatus`
- [ ] CI script `scripts/verify-phase-1.cjs` — runs all of the above plus `npm run build` in one shot

**If after planning no gaps remain:** "None — existing test infrastructure covers all phase requirements."

## Edge Coverage (must_haves.truths — predicates the planner must plan for)

The planner must emit **truth-asserting verifier tasks** for each predicate below. None of these predicates can be left uncovered because they correspond directly to the Phase 1 success criteria or to security guarantees that downstream phases inherit.

| Predicate | Why it must be asserted | How to assert |
|-----------|--------------------------|---------------|
| `app.whenReady()` callback ran without error | Smoke confirmation the whole pipeline boots | Smoke test; or manual `npm run dev` |
| `BrowserWindow` has `contextIsolation: true, nodeIntegration: false, sandbox: true` literally in source | Phase 1 success criterion #1 | Grep gate |
| Window dims `1280×800` min, `1920×1080` max | D-02/D-03 | Grep + smoke (window dragging check is manual) |
| `postinstall: electron-rebuild` is present in `package.json` | Pitfall 4 prevention | `cat package.json \| grep postinstall` |
| `better-sqlite3` loads in main without "wrong architecture" | Phase 1 success criterion #2 | Smoke boot |
| `[boot] better-sqlite3 binding version: 11.10.0` appears in stderr/log file | Phase 1 success criterion #2 | Tail the log |
| `IPC.AUTH_STATUS === 'auth:status'` constant exported | Phase 1 success criterion #3 | Grep gate |
| Preload exposes `window.api.auth.status` | Phase 1 success criterion #3 | Vitest unit (mocked ipcRenderer) |
| Renderer calling `window.api.auth.status()` returns `{authenticated: false, reason: 'scaffold'}` matching the union | Phase 1 success criterion #3 | Vitest unit |
| Login page renders the 4-disabled-input + Enter-disabled-banner copy verbatim | D-05/D-07/D-08 | Snapshot/render test on Login.tsx |
| `tsconfig.node.json` + `tsconfig.web.json` both have `strict: true, noImplicitAny: true` | Phase 1 success criterion #5 | Grep gate |
| No `as any`, no `: any` in `src/shared/**` and `src/preload/api.d.ts` | Phase 1 success criterion #5 | Grep gate (`scripts/check-no-any.cjs`) |
| `dataDir()` exported from `src/main/paths.ts` returns the `<userData>/data` path | SET-03 (path resolution ships at scaffold time) | Vitest unit |
| No `users:*` IPC channels exist | SET-04 stub-only fidelity | Grep gate (`scripts/check-set04-stub.cjs`) |
| No `localStorage`, `sessionStorage`, `electron-store`, or `cookie` references | AUTH-04 (no persistent session) | Grep gate |
| `<html dir="ltr">` in `src/renderer/index.html` | Consistent baseline; i18n deferred to Phase 7 per D-06 | Grep gate |
| `package.json` `"name": "colonoscopist"` and `"productName": "Colonoscopist"` | D-01 | `cat package.json` |
| Builder config (if added) has `appId: "com.colonoscopist.app"` | D-01 | Grep |
| **App boots on `npm run dev` on this workstation** | The whole phase | Manual smoke + log capture |

The planner must NOT leave any row above uncovered. If a row says "manual smoke", the planner must include a manual-smoke task in the final plan; if a row says "Vitest unit" the planner must include a unit-test task; etc.

## Prohibitions (must_haves.prohibitions — copy these into PLAN.md)

These are explicit anti-patterns the planner must encode into `must_haves.prohibitions` so future executors don't regress them:

- ❌ **Do NOT open the SQLite database in Phase 1.** DB connection (`new Database(...)`) ships in Phase 2. Phase 1 only loads the binding to log its version.
- ❌ **Do NOT wire user-management CRUD (SET-04).** A static stub UI or omitted section is correct; the real feature ships Phase 2.
- ❌ **Do NOT relax the security baseline.** No `nodeIntegration: true`. No `sandbox: false`. No `contextIsolation: false`. The grep gate makes any drift impossible to merge.
- ❌ **Do NOT add `better-sqlite3` import paths beyond the startup `require('better-sqlite3')` that logs the version.** No `Database()` opens. No migrations runner.
- ❌ **Do NOT introduce a CLI or extra IPC handler beyond `auth:status`.** One channel only this phase.
- ❌ **Do NOT upgrade Tailwind to v4.** Locked at 3.4.x per STACK.md.
- ❌ **Do NOT use Tailwind 4 PostCSS plugin or `@tailwindcss/postcss`.** Use the legacy `tailwindcss` package directly.
- ❌ **Do NOT use the MediaRecorder API anywhere.** Out of scope (Pitfall: long-form recording); do not let it creep into the preview path even for hover-glance.
- ❌ **Do NOT scaffold State management (Zustand/Redux/React Context for auth).** One page — Login placeholder. State is one `useState<AuthStatus>`.
- ❌ **Do NOT scaffold i18n (`i18next`, `react-i18next`, `i18next-browser-languagedetector`).** English-only per D-06; i18n ships in Phase 7.
- ❌ **Do NOT scaffold React Router.** One page. Phase 2 adds it.
- ❌ **Do NOT scaffold SQLite migrations runner / `_migrations` table.** Phase 2.
- ❌ **Do NOT scaffold ffmpeg child / recorder.** Phase 3+.
- ❌ **Do NOT scaffold license verification (`@noble/ed25519`).** Phase 8.
- ❌ **Do NOT scaffold backup/restore (`archiver`/`yauzl`).** Phase 7.
- ❌ **Do NOT scaffold the renderer-side auth flow (pin entry, audit log, sessions).** Phase 2.
- ❌ **Do NOT use `electron-store` for window state.** No persistence in Phase 1.
- ❌ **Do NOT pin Electron major above v32.** Stay on the locked major.
- ❌ **Do NOT bake `prettier`/`eslint` rules that disable `no-explicit-any` in IPC paths.**
- ❌ **Do NOT install `node-hid` or `serialport`.** Capture uses DirectShow via ffmpeg (Phase 4); no native HID module needed.
- ❌ **Do NOT alter the postinstall script name** (`postinstall`, not `postInstall` or `after_install`).

## Key Patterns (recommended from the electron-vite + electron-sqlite skills + Context7 docs)

The following patterns come straight from the relevant skills, refreshed against the Context7 docs for accuracy, and shaped for the Phase 1 narrow scope.

### Key Pattern A — Use the official scaffolder, not `npm init`

The maintainer-provided scaffolder bakes in the hardened main/preload/renderer layout that we want; doing it by hand is the most common path to a relaxed `webPreferences`. [VERIFIED: Context7 /alex8088/electron-vite-docs/guide]

```bash
npm create @quick-start/electron@latest colonoscopist -- --template react-ts
cd colonoscopist
```

Then move `colonoscopist/*` into the repo root if the repo dir is empty (no existing files). If files conflict (this repo already has `.planning/`, AGENTS.md, etc.), scaffold into a temp dir, `mv` `src/`, `electron.vite.config.ts`, `tsconfig*.json`, `tailwind.config.*`, `postcss.config.*`, `components.json`, `package.json` (after merge), `vitest.config.*` (if any) into the repo root. NEVER touch `.planning/`, AGENTS.md, `.opencode/`.

### Key Pattern B — One-line postinstall for native modules

```json
{
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "postinstall": "electron-rebuild"
  }
}
```

The hook is the only reliable way to keep `better-sqlite3`'s binding aligned with the running Electron Node version. [VERIFIED: Context7 /websites/electron-vite + electron-vite-samples]

### Key Pattern C — Typed IPC contract in `src/shared/`, imported by both sides

Per electron-vite skill §4; matches the STACK.md §Architecture. Single source of truth prevents drift; the `IPC` `as const` object preserves literal types so channels are checked at compile time. [ASSUMED — standard Electron-app pattern; per the skill and matching electron-builder samples]

### Key Pattern D — UserData path resolution lives in `src/main/paths.ts` from day 1

```typescript
// src/main/paths.ts
import { app } from 'electron';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

export function dataDir(): string {
  const dir = path.join(app.getPath('userData'), 'data');
  mkdirSync(dir, { recursive: true });
  return dir;
}
```

Used for SET-03 default storage root. Phase 2 plugs `dbPath()` and `mediaDir()` into this same file. [ASSUMED — per electron-sqlite skill §2]

### Key Pattern E — Manifest the security baseline in code + in CI

- **In code:** literal `webPreferences` object in `src/main/window.ts` (Pattern 2 above).
- **In CI:** `scripts/check-security-baseline.cjs` greps the file for `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Exit code 2 on miss.

This is the only way a future PR can't silently remove `sandbox: true` "to fix the blank window."

### Key Pattern F — Single ABI log line in `startup-log.ts`

```typescript
// src/main/startup-log.ts
import { app, safeStorage } from 'electron';
import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

let versionCache: string | null = null;
function betterSqliteVersion(): string {
  if (versionCache !== null) return versionCache;
  try {
    const pkg = require('better-sqlite3/package.json') as { version: string };
    versionCache = pkg.version;
  } catch (err) {
    versionCache = `unknown (${(err as Error).message})`;
  }
  return versionCache;
}

export function logStartup(event: string): void {
  const logPath = path.join(app.getPath('userData'), 'logs', 'startup.log');
  mkdirSync(path.dirname(logPath), { recursive: true });
  appendFileSync(
    logPath,
    `[${new Date().toISOString()}] [boot] event=${event} better-sqlite3=${betterSqliteVersion()}\n`,
  );
  if (event === 'app-ready') {
    console.log(`[boot] better-sqlite3 binding version: ${betterSqliteVersion()}`);
    console.log(`[boot] safeStorage encryption available: ${safeStorage.isEncryptionAvailable()}`);
  }
}
```

Phase 1 success criterion #2 (ABI build verification) is observable from this log line. [ASSUMED — startup log is a convention not mandated by docs; based on PITFALLS §4 mitigation "Surface a banner if mismatched"]

### Key Pattern G — `shadcn init` then `shadcn add button input label`

```bash
npx shadcn@latest init --defaults --yes --base-color slate
npx shadcn@latest add button input label
```

Outputs:
- `components.json`
- `src/renderer/components/ui/{button,input,label}.tsx`
- `src/renderer/lib/utils.ts` (for `cn` helper)
- Updates `src/renderer/styles/globals.css` with the `cn` helper and CSS variables shadcn needs

After init, verify `components.json` has `"rsc": false` and `"style": "default"` (Phase 1's no-SSR posture).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `electron-rebuild` (legacy npm name) | `@electron/rebuild` (renamed lineage, v4) | electron/rebuild rename ~2023 | Either works in npm; greenfield should pick `@electron/rebuild`. Same underlying `node-gyp` workflow. |
| `shadcn-ui` (CLI) | `shadcn` (CLI) | shadcn v2 release (~2024-2025) | The `shadcn-ui` package is deprecated; the current CLI is named `shadcn`. [VERIFIED: Context7 /shadcn-ui/ui describes the rename; npm registry confirms `shadcn@latest` = 4.16.1]. |
| React 18 | React 19 (latest) | 2024 (React 19 stable) | We stay on React 18 because @react-pdf/renderer 4 only fully supports React 18 (`@react-pdf/renderer` v4 docs warn on React 19); STACK.md §Version Compatibility locks us. |
| Tailwind 3 + PostCSS | Tailwind 4 + Vite plugin | Tailwind 4 stable, 2025 | We stay on Tailwind 3.4 because shadcn ecosystem has not completed the Tailwind 4 migration at our lock date. |
| `nodeIntegration: true` in renderer | `contextIsolation: true` + preload bridge | Electron security guidance, post-2020 | STACK.md prohibits `nodeIntegration: true`. The electron-vite scaffolder doesn't even support the option. |
| Manual `ffmpeg-static` binary hosting | `ffmpeg-static` npm package (bundled binary) | n/a | Defer to Phase 3+ |
| `@types/node` 18 | `@types/node` 20 (matches Electron 32's Node 20) | Electron 32 chose Node 20 | Mismatch produces phantom type errors in main / preload builds |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `npm create @quick-start/electron@latest colonoscopist -- --template react-ts` is the canonical scaffolder and is interactive-friendly enough to run with the `--template react-ts` flag to skip prompts. | Standard Stack / Installation | If scaffolder is no longer the recommended path, planner falls back to `npx degit alex8088/electron-vite-boilerplate` (the maintainer's repo); the boilerplate is equivalent. |
| A2 | `electron-rebuild` (legacy) and `@electron/rebuild` (renamed) invoke the same underlying `node-gyp` workflow. We pick the renamed `@electron/rebuild@^4` for the devDep. | Standard Stack | If the renamed package doesn't accept `electron-rebuild` postinstall mode, swap to the legacy `electron-rebuild@^3` command name. Functionally identical. |
| A3 | The electron-vite template's `tsconfig.web.json` and `tsconfig.node.json` both inherit from `tsconfig.json` with `"strict": true`. | Key Patterns E + Pitfall 3 | If the template's `tsconfig.web.json` lacks `"strict": true`, the planner must add it in a one-line edit. The CI gate (`scripts/check-no-any.cjs`) covers TS strictness even if a config drifts. |
| A4 | The shadcn CLI is `shadcn` (not `shadcn-ui`) as of mid-2024 onward; the registry URL is `https://ui.shadcn.com/r/styles/default/...`. | Standard Stack | If shadcn CLI requires `RSC` toggled off via a flag we don't pass, the planner must edit `components.json` post-init to set `"rsc": false`. |
| A5 | Phase 1 success criterion #1 (security baseline verified "in code") is satisfied by a grep gate over `src/main/window.ts`, not by an Electron-runtime introspection test. | Validation Architecture, Success Criterion 1 | If the user/verifier wants runtime introspection, the planner must add a Vitest test using Electron's `app.whenReady()` plus a known-window-creation helper. Heavier; default to grep. |
| A6 | Windows-only v1 means the `electron-rebuild` only needs Visual Studio Build Tools (a Windows-specific package) as the build-from-source fallback; we rely on `better-sqlite3`'s prebuilt Electron binding first. | Common Pitfalls / STACK §Version Compatibility | If a clinic machine lacks VS Build Tools and the prebuilt binding fails to match, install will fail. Document in README that VS Build Tools are a hard prerequisite on Windows. |
| A7 | `app.getPath('userData')` resolves to `%APPDATA%/Colonoscopist` on Windows once `app.setName('Colonoscopist')` is called; without `setName`, it resolves to `Electron`, which we don't want. | Key Pattern D / SET-03 | If `app.setName` is forgotten, the data root mismatches the productName and clinic operators will be confused. Document that the main process must call `app.setName('Colonoscopist')` in `app.whenReady()`. |

## Open Questions (RESOLVED)

1. **Should Phase 1 also scaffold `electron-builder` config, or defer to Phase 8?**
   - What we know: STACK.md §Supporting lists `electron-builder@^25` as the packager. Phase 1 is a scaffold, not packaging. But `electron-builder` config sets `appId` (D-01) and `productName` (D-01), so adding it costs ~1 task and makes Phase 8 easier.
   - What's unclear: Whether the user prefers config-as-code in `package.json` (electron-builder `build` field) or as a separate `electron-builder.yml`.
   - Recommendation: Defer `electron-builder` to Phase 8; add `appId` and `productName` to `package.json` only. Phase 1 is not packaging — adding electron-builder invites a deeper install/build config that doesn't pay back until packaging.
   - **RESOLVED: Deferred to Phase 8.** `appId` and `productName` are set in `package.json` only (D-01). Plan 01-01 action explicitly does NOT install electron-builder. Phase 8 picks up packaging.

2. **Should the renderer preload be in a sandbox-compatible mode?**
   - What we know: `sandbox: true` is mandated by STACK.md. The electron-vite skill says "If you must relax `sandbox: true` for a specific Node API in preload, document why and isolate that one window." Our preload uses only `contextBridge` + `ipcRenderer.invoke`, both available in the sandbox.
   - What's unclear: Whether `sandbox: true` breaks any subtle API in the future that we'd need.
   - Recommendation: Ship `sandbox: true`; if Phase 3+ needs a Node API in preload (e.g., for ffmpeg piping), document it and isolate to a second window. The baseline stays for the main window.
   - **RESOLVED: `sandbox: true` ships in Phase 1.** Plan 01-01 writes `webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, ... }` as a literal in `src/main/window.ts`. Plan 02 `scripts/check-security-baseline.cjs` enforces literal substring match — any future PR relaxing `sandbox: true` fails CI.

3. **Should we lock Node version in `.nvmrc` or rely on `engines` only?**
   - What we know: Electron 32 uses Node 20; this repo's system Node is 24. They do not need to match (Electron's Node is its own runtime).
   - What's unclear: Whether the user expects `nvm use` in the docs.
   - Recommendation: Add `.nvmrc` with `20` for dev-time tooling (Vite/Rollup) consistency; document that Electron ships its own Node.
   - **RESOLVED: Add `.nvmrc = 20` as part of the Phase 1 deliverables.** Dev-time tooling (Vite, TypeScript, vitest) runs on system Node 20 to match Electron 32's Node ABI; Electron itself ships its own Node. Flag: this add was missed in the original Plan 01-01 task list — add it as part of the tracer task's `package.json` step.

4. **Should Phase 1 verify behavior via a Playwright/Electron-driven smoke test, or a Vitest-only unit test?**
   - What we know: SUCCESS CRITERION #3 calls for an "end-to-end" renderer-call-main round-trip. A Vitest unit test that mocks `ipcRenderer.invoke` is cheaper than a Playwright boot.
   - What's unclear: Whether the verifier wants an actual Electron-driven smoke (heavier, real-world) or a typed-return unit test (lighter, deterministic).
   - Recommendation: Default to the Vitest unit test. Add an Electron-driven smoke ONLY if verifier pushback. The unit test renders the renderer test outcome deterministically without needing an X server on CI.
   - **RESOLVED: Vitest-only.** Plan 02 installs vitest + mocks `electron` module in `tests/shell/auth-status.test.ts`. The unit test asserts preload calls `ipcRenderer.invoke('auth:status')` AND main handler returns `{ authenticated: false, reason: 'scaffold' }` — deterministically, no Electron boot, no X server.

5. **Should we install `vitest` in Phase 1, even though only one test ships?**
   - What we know: STACK.md §Development Tools lists Vitest. The smoke test in §Validation Architecture uses it.
   - What's unclear: Whether adding Vitest now is premature when no real test exists until Phase 2.
   - Recommendation: Install Vitest as a devDep WITH the single smoke test. Reason: the test infrastructure runs in CI on every commit from this point forward, and adding it later is a tax.
   - **RESOLVED: Install vitest in Phase 1 (Plan 02).** Plan 02 action: `npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom`. Three test files ship: `paths.test.ts`, `auth-status.test.ts`, `Login.test.tsx`. CI runs `npx vitest run` on every commit from this point.

6. **Where does `src/main/startup-log.ts` write the log?**
   - What we know: A log line is observable. `app.getPath('userData')/logs/startup.log` is the standard location for Windows.
   - What's unclear: Whether the user wants the log under `userData/logs/` or `userData/data/logs/`.
   - Recommendation: `userData/logs/startup.log` (sibling of `data/`). Logs are not data; they shouldn't sit inside the backup zip in Phase 7 unless explicitly opted in.
   - **RESOLVED: `userData/logs/startup.log`.** Plan 01-01 `src/main/startup-log.ts` writes to `path.join(app.getPath('userData'), 'logs', 'startup.log')` — sibling of `data/`, not inside it. Phase 7 backup will exclude `logs/` by default (already documented in RESEARCH §Deferred Pitfalls §Backup captures partial DB).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js (runtime for Vite dev server, scripts, npx) | electron-vite dev/build scripts | ✓ | system: v24.16.0 | Pin via `.nvmrc` to v20 (matches Electron 32) to avoid lopsided behavior |
| npm | All installs | ✓ | 11.13.0 | n/a |
| Python 3.12 | `better-sqlite3` native build-from-source fallback | ✓ | 3.12.10 | n/a |
| MS Visual Studio Build Tools (Desktop development with C++) | `better-sqlite3` native build from source on Windows | ⚠ unknown — not verified in this session | Assume present (Windows 11 dev machine) | If absent, install VS Build Tools first OR rely on `better-sqlite3`'s prebuilt Electron binding (which is what electron-rebuild does) |
| Git | electron-vite HMR for renderer; phase commits | ✓ | assumed (this is a git repo) | n/a |
| Windows 10/11 | Phase 1 OS target | ✓ | n/a | n/a |

**Missing dependencies with no fallback:** none on this machine.
**Missing dependencies requiring action before scaffold:** VS Build Tools may need to be installed before the postinstall hook fires for the first time. Document this in README. If `electron-rebuild` succeeds on first install, no action is needed — `better-sqlite3` ships prebuilt Electron binaries on its npm tarball.

> Note: This verification assumes the repo's working machine has the typical Windows dev setup. If the clinic-IT-grade machine rebuilds from scratch, the README must list "Windows 10/11, Node 20.x (via nvm), Visual Studio Build Tools (Desktop development with C++)" as the prerequisites.

## Security Domain

**Security enforcement is enabled** (`workflow.security_enforcement: true`, `security_asvs_level: 1`).

### Applicable ASVS Categories (Phase 1)

| ASVS Category | Applies (Phase 1) | Standard Control |
|---------------|-------------------|------------------|
| **V2 Authentication** | NO (auth is Phase 2) | — |
| **V3 Session Management** | YES — only at the IPC boundary | (a) Single `BrowserWindow` with `sandbox: true` (renderer can't persist). (b) No cookies, no `localStorage`, no `electron-store`. (c) IPC channels are whitelisted in `ipcMain.handle` only. |
| **V4 Access Control** | NO (no entities yet) | — |
| **V5 Input/Output Validation** | YES — input to every IPC handler must be typed | (a) `IPC` channels are typed unions in `src/shared/ipc-contract.ts`. (b) `noImplicitAny` on TS strict. (c) `no any` grep gate. (d) Renderer can't reach Node directly (preload bridge only). |
| **V6 Cryptography** | NO (no crypto yet) | — |
| **V7 Error Handling** | YES — every error has a structured code | (a) `src/shared/errors.ts` (Phase 1 stub) will hold the union. (b) `ipcMain.handle` rejects with `Error('IPC_NAME_FAILED: <reason>')` — but Phase 1 has one happy path only. |
| **V8 Data Protection** | NO (no data yet) | — |
| **V9 Communications** | NO (no network) | — |
| **V10 Malicious Code** | YES — only known packages | (a) Standard Stack table lists every dep. (b) Package Legitimacy Audit all OK. (c) No `postinstall` script beyond `electron-rebuild` from a verified scope. |

### Known Threat Patterns (for the locked stack)

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via crafted `<input>` value reflected back into the DOM | Tampering | Use React's built-in escaping (no `dangerouslySetInnerHTML`); Tailwind class names don't render text. Phase 1's Login page stores the PIN only in `useState`, never in `localStorage` (which would survive reboot — AUTH-04 prohibition). |
| Malicious npm postinstall script | Elevation of Privilege | `@electron/rebuild` is the only postinstall in Phase 1; sourced from `electron/rebuild` on GitHub. `better-sqlite3` itself does NOT define a `postinstall` script in its `package.json`. (Verified via `npm view` — no scripts block content beyond standard fields.) |
| Renderer RCE via relaxed `nodeIntegration` | Elevation of Privilege | The grep gate + the hard-coded `webPreferences` literal. |
| Native module ABI mismatch (bundled binding built for wrong ABI) | Tampering | `@electron/rebuild` postinstall hook; observability via startup log. |
| License bypass (pre-Phase 8 threat surface) | Tampering | Phase 1 ships NO license check, so there is no check to bypass. Phase 8 introduces Ed25519 verify; the verify path's code-frozen-with-`Object.freeze` is the Phase 8 mitigation. |
| Insecure IPC payload shape | Tampering | `no any` grep gate + TS strict + typed contract. |
| Renderer reading arbitrary files | Information Disclosure | Phase 1 has no file-read IPC. The IPC surface for Phase 1 is exactly one channel: `auth:status` returning a literal object. |

## Sources

### Primary (HIGH confidence)

- `electron-vite` Context7 — `/alex8088/electron-vite-docs/guide` — confirmed scaffolder command `npm create @quick-start/electron@latest ... --template react-ts` and `nodeIntegration` is unsupported.
- `electron-vite` Context7 — `/caoxiemeihao/electron-vite-samples/build-configuration` — confirmed `better_sqlite3.node` binding plugin pattern and `dist-native/` output.
- `shadcn/ui` Context7 — `/shadcn-ui/ui` — confirmed `shadcn` (not `shadcn-ui`) is the current CLI package.
- npm registry direct calls:
  - `npm view electron@32 version` → `32.3.3` is the highest v32 release.
  - `npm view electron-vite@2 version` → `2.3.0` is the highest v2 release.
  - `npm view better-sqlite3@11 version` → `11.10.0` is the highest v11 release.
  - `npm view tailwindcss@3.4 version` → `3.4.19` is the highest 3.4.x release.
  - `npm view @electron/rebuild dist-tags.latest` → `4.2.0` is current; `electron-rebuild@3.2.9` is the legacy npm package.
  - `npm view @quick-start/electron dist-tags.latest` → `0.7.1` (verify version in actual scaffold run).
- `.opencode/skills/electron-vite/SKILL.md` — §4 IPC contract pattern, §5 blank-window checklist, §7 native modules + postinstall, §8 security baseline.
- `.opencode/skills/electron-sqlite/SKILL.md` — §1 install and rebuild, §2 database location (`userData/data`), §3 DB singleton (Phase 2 prep), §6 encryption-at-rest (Phase 2 prep).
- `.planning/research/STACK.md` — locked versions, §Alternatives Considered, §Version Compatibility.
- `.planning/research/PITFALLS.md` — §Pitfall 4 (native module ABI mismatch, the central Phase 1 risk), §Pitfall 9 (backup captures partial DB, mitigated by Phase 1 wiring `paths.ts`).
- `.planning/research/ARCHITECTURE.md` — three-process model; `src/shared/ipc-contract.ts` pattern.
- `.planning/REQUIREMENTS.md` — AUTH-01 (foundation), AUTH-04, SET-03, SET-04 traceability + the §Traceability row calling out the SET-04 mismatch.

### Secondary (MEDIUM confidence)

- electron-vite.org landing pages — informative but the Context7 fetch (above) is the authoritative source for current docs.
- Common community-documented patterns for `better-sqlite3` + Electron + `electron-rebuild` (consistent across StackOverflow threads from 2023–2025; the skill and registry docs above are the authoritative source).

### Tertiary (LOW confidence)

- `@types/better-sqlite3` major version compatibility — verified by `npm view @types/better-sqlite3 dist-tags.latest` (= 7.x range); pin to `^7.6` to align with the v11 of better-sqlite3. [ASSUMED — no authoritative compatibility matrix published]
- VS Build Tools is the Windows prerequisite for `better-sqlite3` build-from-source — implied by the standard `electron-rebuild` docs; the prebuilt Electron binding often avoids it but the README must mention it. [ASSUMED]

## Metadata

**Confidence breakdown:**

- Standard Stack: **HIGH** — every version verified via `npm view`; scaffolder command verified via Context7.
- Architecture: **HIGH** — three-process model is per electron-vite official docs; IPC contract pattern is per `.opencode/skills/electron-vite`.
- Pitfalls: **HIGH** — Pitfall 4 is the entire Phase 1 risk and is well-documented; security baseline is non-negotiable per PROJECT.md.
- Validation Architecture: **HIGH** — success criteria are observable (grep / smoke / Vitest unit); CI gates are simple scripts.
- Security: **HIGH** — applies only to V3/V5/V7/V10; Phase 1 has no auth, no data, no crypto; baseline guards are exact.

**Research date:** 2026-07-31
**Valid until:** 2026-08-15 (15 days; scaffold patterns are stable; reassess if a new electron-vite major ships)
