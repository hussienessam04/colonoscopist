# Architecture Research

**Domain:** Electron desktop app, main/preload/renderer split + local SQLite + ffmpeg child process + offline license
**Researched:** 2026-07-31
**Confidence:** HIGH (architecture is standard Electron + node-sqlite3 pattern; deviations from the user's brief are minimal)

## Standard Architecture

### System Overview

```
┌───────────────────────────────────────────────────────────────────┐
│                       Electron Main Process                       │
│   ┌─────────────┐   ┌─────────────┐   ┌────────────────────────┐ │
│   │ SQLite      │   │ License     │   │ Recorder (ffmpeg       │ │
│   │ (better-    │   │ Service     │   │ child_process)         │ │
│   │ sqlite3)    │   │ (Ed25519)   │   │                        │ │
│   └──────┬──────┘   └──────┬──────┘   └────────────┬───────────┘ │
│          │                 │                       │             │
│   ┌──────┴─────────────────┴───────────────────────┴──────────┐  │
│   │  IPC Router (typed, validated; contextBridge surface)     │  │
│   └─────────────────────────────┬─────────────────────────────┘  │
│   ┌─────────────────────────────┴─────────────────────────────┐  │
│   │   safeStorage wrapper (encrypt/decrypt columns at rest)   │  │
│   └────────────────────────────────────────────────────────────┘  │
├───────────────────────────────────────────────────────────────────┤
│   preload (typed contextBridge)                                   │
├───────────────────────────────────────────────────────────────────┤
│                       Renderer (React + Tailwind)                │
│   ┌─────────────┐   ┌─────────────┐   ┌────────────────────────┐ │
│   │ Pages / UI  │   │ Zustand or  │   │ getUserMedia preview   │ │
│   │ (Patient,   │   │ React       │   │ (lives in renderer     │ │
│   │ Procedure,  │   │ Context for │   │  only; ffmpeg is the   │ │
│   │ Report, …)  │   │ shared UI   │   │  recorder on the main  │ │
│   │             │   │ state       │   │  side via dshow)       │ │
│   └─────────────┘   └─────────────┘   └────────────────────────┘ │
└───────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| Main process | Owns Node-side capabilities: SQLite, ffmpeg child, file IO, license verify, safeStorage | `src/main/index.ts`, broken into `db/`, `recorder/`, `license/`, `backup/`, `pdf/` modules |
| Preload | Exposes a typed, minimal API to renderer via `contextBridge.exposeInMainWorld` | `src/preload/index.ts` — only the calls the renderer actually needs |
| Renderer | UI: login, patient list, procedure room, review, report editor, settings | React + React Router (or one-window state-based routing); styled with Tailwind + shadcn |
| SQLite (main side) | Schema + migrations + prepared statements; only the main process touches the DB | `src/main/db/` — connection module, migration runner, per-table modules (`patients.ts`, `procedures.ts`, …) |
| Recorder (main side) | Spawns and supervises the ffmpeg child process per procedure; exposes start/stop/status IPC | `src/main/recorder/ffmpeg.ts` — concurrency limits, error propagation, graceful SIGTERM on stop |
| License service (main side) | Loads + verifies the Ed25519 signed `.lic` file; tracks trial clock; gates the UI | `src/main/license/index.ts` + `cli-license-gen` script run by the vendor |
| PDF generator (main side) | Renders the report PDF using `@react-pdf/renderer` (called via a thin Node bridge) | `src/main/pdf/` — run a small headless renderer hook or call from main with a separate `@react-pdf/renderer` worker |
| Backup/restore (main side) | Zips and unzips `data/` folder using `archiver` | `src/main/backup/index.ts` — emits a streamed zip to a user-chosen path |
| Audit logger (main side) | One append call site; every IPC handler funnels through it | `src/main/audit/index.ts` — call from each handler, never bypass |
| safeStorage wrapper (main side) | Symmetric encrypt/decrypt of sensitive column values | `src/main/security/safe-storage.ts` |
| Preview / screenshots (renderer) | `<video>` from `getUserMedia`; canvas snapshot to JPEG; upload as buffer via IPC | `src/renderer/components/preview/` |
| i18n (renderer) | EN + AR translation bundles; document direction toggling on language change | `src/renderer/i18n/` + i18next init in renderer entry |

## Recommended Project Structure

```
colonoscopist/
├── electron.vite.config.ts          # vite config for main/preload/renderer
├── electron-builder.yml             # Windows packaging (NSIS + portable)
├── package.json
├── tsconfig.json                    # base
├── tsconfig.node.json               # main + preload
├── tsconfig.web.json                # renderer
├── tailwind.config.ts
├── postcss.config.js
├── components.json                  # shadcn registry
├── resources/                       # static assets bundled by electron-builder
│   ├── icons/
│   └── ffmpeg/                      # ffmpeg-static binary (or use npm package)
├── src/
│   ├── main/                        # Electron main process
│   │   ├── index.ts                 # app lifecycle, window creation
│   │   ├── ipc/                     # ipcMain handler registration (thin)
│   │   ├── db/
│   │   │   ├── connection.ts        # better-sqlite3 open + WAL + pragmas
│   │   │   ├── migrations/          # 0001_init.sql, 0002_*.sql
│   │   │   ├── patients.ts          # prepared-statement functions
│   │   │   ├── procedures.ts
│   │   │   ├── screenshots.ts
│   │   │   ├── reports.ts
│   │   │   ├── users.ts
│   │   │   ├── audit.ts
│   │   │   └── settings.ts
│   │   ├── recorder/
│   │   │   ├── ffmpeg.ts            # spawn + supervise child
│   │   │   └── devices.ts           # DirectShow device enumeration
│   │   ├── license/
│   │   │   ├── verify.ts            # Ed25519 verify
│   │   │   ├── fingerprint.ts       # CPU + disk + MAC → hash
│   │   │   └── trial.ts             # 14-day trial clock
│   │   ├── pdf/
│   │   │   └── report.tsx           # @react-pdf/renderer entry
│   │   ├── backup/
│   │   │   ├── archive.ts           # zip the data folder
│   │   │   └── restore.ts           # unzip back into a chosen location
│   │   ├── security/
│   │   │   └── safe-storage.ts      # safeStorage wrap/unwrap with column hints
│   │   └── audit/
│   │       └── log.ts               # append-only helpers
│   ├── preload/
│   │   ├── index.ts                 # contextBridge.exposeInMainWorld('api', …)
│   │   └── api.d.ts                 # global Window['api'] type
│   ├── renderer/
│   │   ├── index.html               # sets <html dir="..."> at load
│   │   ├── main.tsx                 # React entry
│   │   ├── App.tsx                  # router
│   │   ├── pages/
│   │   │   ├── Login.tsx
│   │   │   ├── Dashboard.tsx
│   │   │   ├── PatientList.tsx
│   │   │   ├── PatientDetail.tsx
│   │   │   ├── ProcedureRoom.tsx    # hero screen
│   │   │   ├── ProcedureReview.tsx
│   │   │   ├── ReportEditor.tsx
│   │   │   ├── Settings.tsx
│   │   │   └── About.tsx
│   │   ├── components/
│   │   │   ├── preview/             # live preview + screenshot button
│   │   │   ├── review/              # player + timeline
│   │   │   ├── report/              # PDF preview + finalize flow
│   │   │   └── ui/                  # shadcn-generated components live here
│   │   ├── store/                   # Zustand stores (auth, active procedure, …)
│   │   ├── i18n/
│   │   │   ├── en/common.json
│   │   │   ├── ar/common.json
│   │   │   └── index.ts
│   │   └── styles/
│   │       └── globals.css          # tailwind directives + RTL utilities
│   └── shared/                      # types used in both main and renderer
│       ├── ipc-contract.ts          # every IPC method name + payload schema
│       ├── entities.ts              # Patient, Procedure, Screenshot, Report types
│       └── errors.ts                # structured error codes thrown over IPC
├── tests/
│   ├── main/                        # unit tests for db, license, recorder mocks
│   └── renderer/                    # component tests
├── scripts/
│   ├── gen-license.cjs              # vendor-side Ed25519 signer
│   └── after-install.cjs            # electron-rebuild hook
└── docs/
```

### Structure Rationale

- **`src/main` + `src/preload` + `src/renderer`:** mandatory Electron-vite layout; follows the security baseline (renderer has no Node access).
- **`src/shared/`:** single source of truth for IPC contract types — preload's typed surface and main's `ipcMain` handlers import from the same file.
- **`src/main/db/`:** per-table modules keep the prepared-statement surface small and reviewable; migrations live alongside code, in plain SQL files.
- **`src/main/recorder/`:** isolates the ffmpeg interaction so no other code path accidentally touches the child process.
- **`src/main/license/` + `scripts/gen-license.cjs`:** the activation script (`gen-license`) is held offline by the vendor; the verify path is shipped. Clear separation.
- **`src/renderer/components/preview/` vs `review/`:** two distinct UI flows; cleanly separable.

## Architectural Patterns

### Pattern 1: Typed IPC contract via contextBridge

**What:** Every renderer-callable method is defined once in `src/shared/ipc-contract.ts` as a typed function signature. The preload imports the contract types and exposes a matching object. The main side registers `ipcMain.handle()` for each method.

**When to use:** Always. The contract is the security boundary.

**Trade-offs:** Pro — full type safety end-to-end, single source of truth, easy to audit. Con — boilerplate-y for trivial methods.

**Example:**
```typescript
// src/shared/ipc-contract.ts
export interface IpcContract {
  patients: {
    list: (query: { search?: string }) => Promise<Patient[]>
    get: (id: string) => Promise<Patient | null>
    create: (input: Omit<Patient, 'id' | 'created_at'>) => Promise<Patient>
    update: (id: string, patch: Partial<Patient>) => Promise<Patient>
  }
  // …
}

// src/preload/index.ts
const api: IpcContract = {
  patients: {
    list: (q) => ipcRenderer.invoke('patients:list', q),
    // …
  },
}
contextBridge.exposeInMainWorld('api', api)

// src/main/ipc/patients.ts
ipcMain.handle('patients:list', async (_e, query) => db.patients.list(query))
```

### Pattern 2: Main-process-owned state + one-way IPC

**What:** No state lives in the renderer that's not a mirror of the DB. Mutations always go through main; renderer reads via invoke or push-style events.

**When to use:** For clinical data (patient, procedure, report). Avoids "two sources of truth" bugs.

**Trade-offs:** Pro — auditable, consistent. Con — slightly more round-trips than optimistic UI; acceptable for clinical app.

### Pattern 3: ffmpeg child process with structured supervision

**What:** Recorder module owns a single ffmpeg child per active procedure; exposes start/stop/status IPC; tracks child PID + last stderr line; sends SIGTERM with a fallback to SIGKILL after 5s; cleans mp4 on unexpected exit.

**When to use:** For every recording. The recorder's state machine is its own module.

**Trade-offs:** Pro — predictable, recoverable. Con — edge cases (Windows device disconnect mid-recording) require explicit handling.

**Example:**
```typescript
// src/main/recorder/ffmpeg.ts (sketch)
const child = spawn(ffmpegPath, [
  '-f', 'dshow', '-i', `video=${deviceName}`,
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
  '-movflags', '+faststart',
  outPath,
])
child.on('exit', (code, signal) => recorder.onExit(procedureId, { code, signal }))
function stop() {
  child.stdin?.write('q\n')           // ffmpeg quits on stdin close
  setTimeout(() => child.kill('SIGKILL'), 5000)
}
```

## Data Flow

### Request Flow

```
[User clicks "Save patient" in PatientDetail]
    ↓
[React form submit handler]
    ↓
[window.api.patients.create(input)]           ← typed, via contextBridge
    ↓
[IPC invoke → main process handler]
    ↓
[db.patients.create(input) → better-sqlite3 prepared stmt]
    ↓
[wrap row + push audit_log event]
    ↓
[return value → preload → renderer state]
```

### State Management

```
Renderer:
  Zustand store (auth, active procedure)
    │       ↑ subscribe
    │       └──── read on render
    ├── invoke(...)  ←──── write actions (calls into preload)
    └── event listener on ipcRenderer ('procedure:status') for live ffmpeg events

Main:
  ─ No global in-memory state beyond DB + active recorder handles
  ─ One recorder instance per active procedure (object map keyed by procedureId)
```

### Key Data Flows

1. **Login:** PIN entered → hash + verify → audit_log insert → renderer shows dashboard.
2. **Start procedure:** renderer asks main to enumerate devices → user picks one → renderer requests `recordings:start({ deviceName, patientId, doctorId, procedureType, quality })` → main spawns ffmpeg → returns `procedureId` + initial `procedure` row → renderer shows live preview.
3. **Mid-procedure screenshot:** renderer canvas-snapshots the `<video>` frame → uploads JPEG bytes via IPC → main writes `<userData>/data/media/patients/<id>/<procedureId>/screenshots/<timestamp>.jpg` + inserts `screenshots` row.
4. **Stop procedure:** renderer → IPC → main → SIGTERM ffmpeg (with 5s SIGKILL fallback) → main updates procedure row with `ended_at`, `duration_seconds`, final `video_path` → renderer moves to review.
5. **Generate report:** renderer fills in findings/diagnosis/etc → IPC to main → main renders PDF via `@react-pdf/renderer` → writes `<userData>/data/reports/<id>.pdf` + updates `reports.pdf_path` → returns path → renderer offers "open" / "save copy".
6. **Backup:** user picks target path → main streams a zip of `data/` (excluding currently-open DB WAL files in a consistent snapshot) → returns when done.
7. **Restore:** user picks source zip → main validates manifest → extracts to a chosen directory → optionally swaps the in-use `data/` (with confirmation).

## Scaling Considerations

This is a single-workstation app. The relevant scale is **patients on this workstation over years**, not concurrent users.

| Scale | Architecture Adjustments |
|-------|---------------------------|
| 0–5k patients / 0–100k procedures | Current architecture is fine — better-sqlite3 handles this on commodity SSDs in milliseconds |
| 5k–50k patients / 100k–1M procedures | Add FTS5 indexes for patient/procedure search; consider monthly archived DB swap |
| >50k patients | Hot patient list paginated; offload report PDFs to NTFS compression; consider Postgres backend (this signals you actually need a server) |

### Scaling Priorities

1. **First bottleneck:** Disk space. Procedure mp4 files grow fast (HD digital, ~3 GB/hour). Phase 1 must define a retention policy and a cleanup UI.
2. **Second bottleneck:** DB WAL growth on long uptime sessions. Mitigate with `PRAGMA wal_checkpoint(TRUNCATE)` after large procedure finalization.

## Anti-Patterns

### Anti-Pattern 1: Renderer calling SQLite directly

**What people do:** Use `better-sqlite3` from the renderer because Vite is friendly.
**Why it's wrong:** Breaks `contextIsolation: true / nodeIntegration: false / sandbox: true`. Sandbox renderer cannot load native Node modules.
**Do this instead:** All DB access from main; renderer uses IPC.

### Anti-Pattern 2: Storing file paths as absolute Windows paths

**What people do:** Save `C:\Users\…` paths in SQLite.
**Why it's wrong:** Path is meaningless across user accounts, machines, or after a backup restore.
**Do this instead:** Store paths **relative to `userData`**; resolve at read time via `path.join(app.getPath('userData'), storedRelPath)`.

### Anti-Pattern 3: One global renderer route stack with stateful side-effects

**What people do:** Component-level event listeners that don't clean up.
**Why it's wrong:** React strict mode double-invokes and Memory leaks in long sessions.
**Do this instead:** Effects with explicit cleanup; subscriptions via Zustand selectors so they tear down with component unmount.

### Anti-Pattern 4: Optimistic UI for clinical data

**What people do:** Update the UI first, then dispatch the save.
**Why it's wrong:** Doctor refreshes, save failed, doctor doesn't notice they typed in a record that doesn't exist.
**Do this instead:** Await the IPC round-trip; show inline spinner; surface errors in-line.

### Anti-Pattern 5: Reusing the same ffmpeg child for back-to-back procedures

**What people do:** Leave ffmpeg running between procedures.
**Why it's wrong:** State leaks, no audio sync reset between patients, moov-atom grow issues.
**Do this instead:** One ffmpeg child per procedure; destroy on stop; next procedure gets a fresh spawn.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| DirectShow capture device | `navigator.mediaDevices` for preview; ffmpeg `-f dshow -i video="<name>"` for recording | Two open handles on the same device is supported but must be explicit |
| Electron `safeStorage` | `safeStorage.encryptString(plain)` / `decryptString(cipher)` | Falls back to DPAPI on Windows; needs to be initialized after `app.whenReady` |
| Electron `desktopCapturer` | Optional alternative to `getUserMedia` for screen capture | Only needed if the doctor wants to capture from a window, not a USB device |
| `app.getPath('userData')` | Single source of truth for storage root | All paths in DB are stored relative to this root |
| `electron-builder` autoupdate | Hook `update-electron-app` or squirrel-style | Note: in GCC, internet at clinic update time may not exist; consider manual-update flow for v1 |
| `ffmpeg-static` binary | `process.env.FFMPEG_PATH` from the npm package, or `require('ffmpeg-static')` | Path resolves to the binary inside `node_modules` |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| renderer ↔ main (calls into main) | `ipcRenderer.invoke` ↔ `ipcMain.handle` (typed contract) | All renderer→main is async by nature |
| main → renderer (push events) | `webContents.send(channel)` + `ipcRenderer.on` | Used sparingly: ffmpeg progress, device-lost warnings |
| main modules ↔ DB | better-sqlite3 prepared statements in per-table files | Transactions wrap multi-row writes (e.g., procedure finalize updates 3 tables) |
| DB ↔ filesystem | Stored paths are relative to `userData`; resolved at read time | Backup tool resolves all paths to absolute on archive, re-anchors on restore |
| License verification ↔ every IPC | Wrap all `ipcMain.handle` registrations in a `license-gated` helper that returns a license-error code if invalid | Cleaner than checking inside every handler |

## Sources

- electron-vite official docs (electron-vite.org) — main/preload/renderer split
- Electron security guidance — `contextIsolation`, `sandbox`, `nodeIntegration: false`
- better-sqlite3 README — sync API, WAL mode, prepared statements
- @react-pdf/renderer v4 docs — headless rendering from Node
- ffmpeg DirectShow input docs — `-f dshow -i video="<name>"`
- @noble/ed25519 docs — pure-JS Ed25519 verify
- User brief — locked-in stack, schema, and milestone map

---
*Architecture research for: Colonoscopist (Electron desktop, offline, GCC clinics)*
*Researched: 2026-07-31*
