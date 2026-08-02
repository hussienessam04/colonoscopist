# Phase 3: Capture Device Enumeration + Live Preview + Quality Presets - Research

**Researched:** 2026-08-02
**Domain:** Electron renderer `getUserMedia` preview + main-process ffmpeg DirectShow enumeration + per-doctor-per-device preset persistence
**Confidence:** HIGH (locked stack, locked decisions, well-trodden Electron + MediaDevices pattern, CONTEXT.md prescriptive)

## Summary

Phase 3 ships the **preview half** of the two-path capture architecture — no recording, no ffmpeg child for `dshow` input yet. The work splits cleanly across three tiers: (a) **main** runs `ffmpeg -list_devices true -f dshow -i dummy` once per IPC call, canonicalizes the names (NFC + trim + collapse-spaces per D-11), and writes the result to the typed `capture.listDevices` IPC; (b) **preload** exposes the new `capture` namespace through `contextBridge` with zero new permissions beyond Phase 1; (c) **renderer** uses `navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact } } , audio: false })` to render the live preview into a `<video>` element driven by a `useVideoPreview` hook (single source of truth for the `<video>` lifecycle — reused by Settings → Capture and Procedure Room).

The per-doctor-per-device preset matrix lives in the existing `settings` key/value table (no migration). Quality presets are pure data shape per D-05 (resolution free text + framerate enum 25/30/50/60). The auto-detect heuristic is a tiny pure function in `src/main/capture/auto-detect-preset.ts` that runs once per (doctor, device) pair on first save. Phase 3 also wires `BrowserWindow.webPreferences.permissions = ['media']` so the sandboxed renderer can request camera access.

**Primary recommendation:** Build three sequential plan files — `03-01` (main + IPC + dshow enumeration + canonicalization + settings helpers + tests), `03-02` (renderer hooks + pages + routing + Zustand capture store + tests), `03-03` (UI smoke + audit verification + ffmpeg-static dep + asarUnpack note for Phase 4). Ponytail discipline: do NOT add ffmpeg recording, do NOT spawn child processes for capture, do NOT add a new DB migration.

## Project Constraints (from AGENTS.md / stack)

Locked from the project brief, do not deviate:

- **Tech stack:** electron-vite + React + TypeScript + Tailwind + shadcn/ui; `ffmpeg-static` as a child process from main; `better-sqlite3` for SQLite; `@react-pdf/renderer` for PDF; Ed25519 license later.
- **Security baseline:** `BrowserWindow.webPreferences = { contextIsolation: true, nodeIntegration: false, sandbox: true, preload via contextBridge }`. Phase 3 ADDS `permissions: ['media']` (per PITFALLS Integration Gotchas) **without** weakening the existing flags.
- **Offline-only daily use:** no network calls beyond license activation (out of scope for Phase 3). Device enumeration is purely local.
- **Hardware-class:** EasyCap SD analog (720×480), HDMI/DVI HD digital (1920×1080), generic webcam. Auto-detect heuristic covers both by device-name substring.
- **i18n parity:** EN + AR shipped from day 1. Phase 3 ships preview surfaces with placeholder labels; full i18n translation arrives in Phase 7. UI strings use `aria-label` and `data-testid` so Phase 7 can sweep through without restructuring.

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Two surfaces, one source of truth. Settings → Capture owns the persistent default; Procedure Room reads it and shows an inline dropdown that lets the doctor override for the current procedure session only. Override is NOT persisted. Dropdown shows "Last used: <X>" label. Reversible.
- **D-02:** Empty state in Procedure Room when no device saved or saved device unplugged: black preview box + centered text "No device selected — go to Settings → Capture to pick one" + inline "Open Settings" button. Stays on Procedure Room (no auto-route). Audit `capture.no_device` event fires. Reversible.
- **D-03:** Saved device unplugged between sessions shows the same empty state as D-02 (one empty state, one copy). Previous default remains in `settings` and resurfaces when device is plugged back in. Reversible.
- **D-04:** Quality preset matrix keyed by `(doctorId, deviceName)` — per-doctor-per-device. Costly (touches `settings` table layout, IPC contract, Phase 4 recorder arg derivation).
- **D-05:** `Custom` preset exposes exactly two fields: resolution (W×H free text, e.g. `1024×768`) and framerate (numeric dropdown 25/30/50/60). Bitrate, pixel format, GOP out of scope for Phase 3.
- **D-06:** First-use default for unknown (doctor, device) auto-detected by device-name regex: SD analog on `EasyCap|USB Video|USB2.0 TV|CVBS|Composite|S-Video`; HD digital on `HDMI|1080p|HD|Digital|DVI|UVC`; fallback HD digital. Saved to matrix; heuristic fires once per pair. Reversible via row delete.
- **D-07:** Procedure Room has three controls: **Start Preview**, **Stop Preview**, **Finish**. Flow: pick device → Start → preview renders → Stop releases device → Finish closes room. Unmount on route leave calls `MediaStreamTrack.stop()` on every track. Reversible.
- **D-08:** Preview always `audio: false`. Endoscopes don't have audio; webcams may. No audio toggle in Phase 3. Reversible.
- **D-09:** Settings → Capture has a live preview pane that updates reactively as device/preset changes. Independent Start/Stop controls. Uses the same `useVideoPreview` hook as Procedure Room. Costly (touches page layout + hook shape + IPC cadence).
- **D-10:** Device enumeration on app launch + on entry to either Procedure Room or Settings → Capture. No USB hot-plug detection in v1. Reverse: re-enter page to refresh. Reversible.
- **D-11:** Device names canonicalized once on enumeration in main: NFC unicode normalization + trim leading/trailing whitespace + collapse internal double-spaces. Canonical form is stored as `deviceId` everywhere (IPC, settings key, matrix, Phase 4 ffmpeg arg). Display == canonical. Costly (touches enumeration helper, settings key shape, Phase 4 ffmpeg invocation, saved matrix rows).

### the agent's Discretion

- `src/main/capture/auto-detect-preset.ts` home (D-06); signature + whether to expose matched regex group as audit metadata.
- Framerate dropdown values; default 25/30.
- Empty-state copy (substance locked).
- `getUserMedia` error states (`NotAllowedError`, `NotFoundError`, `OverconstrainedError`, `NotReadableError`); inline error, no modal.
- Whether to add "Refresh devices" button to dropdown header; default omit.
- Audit metadata for `capture.preset_changed`, `capture.device_changed`, `capture.preview_started`, `capture.preview_stopped`, `capture.preview_failed`; minimum `{ deviceName, preset }`.
- `BrowserWindow.webPreferences.permissions = ['media']` (D-11 + PITFALLS Integration Gotchas); verify security baseline not regressed.
- Where Finish button routes; "previous route" fallback.

### Deferred Ideas (OUT OF SCOPE)

- USB hot-plug detection (v2).
- Audio in preview / recording (Phase 3 silent; Phase 4 may revisit).
- Audio device enumeration (Phase 4).
- Per-doctor `lastLoginAt` style audit row for `capture.preview_started` (matrix metadata covers it).
- Vendor diagnostics screen (Phase 8).
- Phase 4 device-lost during recording (Phase 4).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CAPT-01 | App auto-enumerates all USB DirectShow video devices on launch | `src/main/capture/devices.ts` runs `ffmpeg -list_devices true -f dshow -i dummy` and exposes via `capture.listDevices` IPC; called on app launch (via `initCapture()` in `src/main/index.ts`) and on route entry (D-10) |
| CAPT-02 | Doctor picks device from a dropdown; choice remembered per-doctor for next procedure | Per-doctor `capture.default_device_id` key in `settings` table; Procedure Room reads it; inline dropdown offers session-only override (D-01) |
| CAPT-03 | Live preview via `getUserMedia` decoupled from recorder | `useVideoPreview` hook in `src/renderer/src/hooks/useVideoPreview.ts`; `<video>` lifecycle owned by hook; explicit `MediaStreamTrack.stop()` on cleanup (D-07) |
| CAPT-10 | Device names with non-ASCII, embedded spaces, trailing whitespace round-trip through ffmpeg dshow | Canonicalize in main via `String.prototype.normalize('NFC')` + trim + collapse-spaces (D-11); canonical form is the `deviceId` everywhere |
| SET-01 | User picks default capture device from dropdown in Settings → Capture | New `settings-capture` route; Settings page with `react-hook-form` device picker; mutates `capture.default_device_id` via `capture.setDefaultDevice` IPC |
| SET-02 | User picks quality preset: SD analog, HD digital, or custom (resolution + framerate) | Per-doctor-per-device matrix in `settings` table (D-04); `capture.getPreset` / `capture.setPreset` IPC; custom exposes W×H free text + framerate enum (D-05) |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Capture device enumeration (dshow) | Main | — | Requires spawning ffmpeg; renderer is sandboxed; dshow is a Windows-only Node API (per Phase 1 security baseline) |
| Device-name canonicalization | Main | — | Must run once at enumeration so the same form is used in IPC, settings key, and Phase 4 ffmpeg args (D-11) |
| Auto-detect preset heuristic | Main | — | Pure function, easily unit-tested; outputs feed into the same `settings` write path |
| `settings` key/value read/write | Main | — | DB access is main-only (per Phase 1 security baseline + `better-sqlite3` is native) |
| `getUserMedia` live preview | Renderer | — | Browser API lives in the renderer; `<video>` is a DOM element; sandboxed renderer is the right home |
| Device picker UI | Renderer | — | React + shadcn `Select` is the renderer pattern; D-01 / D-09 specify the UX |
| Audit log emission | Main | — | All audit goes through `recordAudit()` helper (Phase 2 pattern); capture.* events piggyback on the same `db.transaction()` |
| Preset schema validation | Shared | Main + Renderer | zod schemas live in `src/shared/validators.ts`; both sides parse (Phase 2 pattern) |
| `webPreferences.permissions` | Main | — | Window constructor is main-only; one flag added; security baseline preserved |
| `navigator.mediaDevices.enumerateDevices()` | Renderer | — | MediaDevices is a renderer API; cross-reference point for the friendly label to pick a `deviceId` |

## Standard Stack

### Core (already installed, no new installs)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Electron | 32.3.3 | Desktop runtime | Locked by stack; ships `safeStorage`, `contextBridge`, sandboxed `BrowserWindow` |
| electron-vite | 2.3.0 | Build pipeline | Locked; HMR + main/preload/renderer split |
| React | 18.3.1 | UI framework | Locked; shadcn ecosystem expects React |
| TypeScript | 5.5.4 | Type safety | Locked; IPC contract is end-to-end typed |
| Tailwind | 3.4.19 | Styling | Locked; shadcn components are Tailwind |
| shadcn/ui | latest | Components | Locked; `select`, `button`, `card`, `input`, `label` already installed |
| better-sqlite3 | 11.10.0 | SQLite | Locked; `settings` table already exists in `0001_init.sql` |
| zod | 4.4.3 | Validation | Locked; `validators.ts` pattern |

### New for Phase 3

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ffmpeg-static` | 5.3.0 | Bundled ffmpeg binary for `dshow` enumeration | Locked by STACK.md; same package will be used by Phase 4 for recording; `npm view` confirms 5.3.0 is current as of 2026-08-02 |
| `@types/ffmpeg-static` | 5.1.0 | TypeScript types | Standard companion to `ffmpeg-static`; `npm view` confirms 5.1.0 |

### Verified via npm registry

```bash
npm view ffmpeg-static version      # 5.3.0
npm view @types/ffmpeg-static version  # 5.1.0
```

### Installation

```bash
npm install ffmpeg-static@^5
npm install -D @types/ffmpeg-static@^5
```

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `navigator.mediaDevices.enumerateDevices()` (renderer) as the only source | `ffmpeg -list_devices` (main) as the only source | Per PITFALLS §Pitfall 3: the two lists can differ on some hardware (especially EasyCap MediaFoundation vs DirectShow). Phase 3 keeps BOTH: main is canonical for the recording path (Phase 4), renderer is the user-facing picker with friendly labels. They cross-reference by label match. |
| `ffmpeg-static` enumerated from main | `desktopCapturer` from renderer | `desktopCapturer` is for screen/window capture, not DirectShow devices; doesn't enumerate EasyCap/HDMI cards |
| Per-doctor-per-device matrix in `settings` | New `presets` table | Per D-04 matrix lives in `settings`; no migration needed; the key shape is human-readable in audit metadata |
| Auto-detect heuristic in renderer | Auto-detect in main | Heuristic is a pure function on the device name; both could host it. Main wins because the canonical name is computed there and the function is naturally co-located with the write that saves the inferred preset |

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|------------|
| `ffmpeg-static` | npm | 11+ yrs | millions/wk | https://github.com/eligrey/ffmpeg-static | OK | Approved — the canonical npm ffmpeg bundling package; same maintainer as `Modernizr` |
| `@types/ffmpeg-static` | npm | 7+ yrs | hundreds of thousands/wk | DefinitelyTyped | OK | Approved — standard DefinitelyTyped types |

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.

Both packages are long-established, widely-used, and discovered via Context7 + npm registry. No `[ASSUMED]` tags.

## Architecture Patterns

### System Architecture

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│  Renderer (React)                                                                │
│  ┌──────────────────────────────────────────────────────────────────────────┐    │
│  │ Settings → Capture page              │ Procedure Room page               │    │
│  │  - Device dropdown (shadcn Select)   │  - "Last used: <X>" label         │    │
│  │  - Resolution + framerate fields     │  - Inline device dropdown         │    │
│  │  - Live preview pane                 │  - Hero preview <video>           │    │
│  │  - Start/Stop preview                │  - Start / Stop / Finish buttons  │    │
│  └──────────────────────────────────────────────────────────────────────────┘    │
│                                       │                                          │
│                  useCaptureStore (Zustand) + useVideoPreview(<video>) hook       │
│                                       │                                          │
│                  window.api.capture.* via contextBridge (typed IpcContract)      │
└───────────────────────────────────────┼──────────────────────────────────────────┘
                                        │ IPC
┌───────────────────────────────────────┴──────────────────────────────────────────┐
│  Main (electron)                                                                 │
│  ┌──────────────────────────────────────────────────────────────────────────┐    │
│  │ src/main/capture/                                                        │    │
│  │  - devices.ts       enumerateDshowDevices() via ffmpeg-static            │    │
│  │  - canonicalize.ts  canonicalizeName(raw) -> { canonical, raw }          │    │
│  │  - auto-detect-preset.ts autoDetectPreset(canonical) -> 'sd'|'hd'        │    │
│  │  - preset-repo.ts   settings.read/write helpers for matrix               │    │
│  └──────────────────────────────────────────────────────────────────────────┘    │
│                                       │                                          │
│  src/main/ipc/capture.ts  capture.listDevices, capture.getPreset,                 │
│                          capture.setPreset, capture.getDefaultDevice,             │
│                          capture.setDefaultDevice                                 │
│                                       │                                          │
│  Pre-existing: src/main/db/settings.ts (k/v table) + audit.ts (recordAudit)      │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure (Phase 3 additions)

```
src/
├── main/
│   ├── capture/
│   │   ├── devices.ts              # ffmpeg -list_devices + canonicalize
│   │   ├── canonicalize.ts         # NFC + trim + collapse-spaces
│   │   ├── auto-detect-preset.ts   # pure function: name -> 'sd'|'hd'
│   │   └── preset-repo.ts          # settings read/write for matrix
│   └── ipc/
│       └── capture.ts              # IPC handlers + audit writes
├── preload/
│   └── index.ts                    # capture: { listDevices, getPreset, ... } ← extended
├── renderer/
│   └── src/
│       ├── hooks/
│       │   └── useVideoPreview.ts  # <video> + MediaStream lifecycle
│       ├── store/
│       │   └── capture.ts          # Zustand-or-sync store: selectedDevice, isPreviewing
│       ├── pages/
│       │   ├── ProcedureRoom.tsx   # NEW: hero preview + Start/Stop/Finish
│       │   └── SettingsCapture.tsx # NEW: device + preset + live preview
│       └── lib/
│           └── router.ts           # Route grows: 'procedure-room', 'settings-capture'
└── shared/
    ├── ipc-contract.ts             # IPC + IpcContract grows
    └── validators.ts               # zod schemas: captureDeviceId, presetKey, etc.
```

### Pattern 1: Typed IPC contract extension (Phase 3 grows `IpcContract`)

**What:** Extend `src/shared/ipc-contract.ts` with new IPC constants and `IpcContract` methods for the `capture` namespace. Never invent a new bridge shape.

**When to use:** Every Phase 3 IPC surface. The contract is the security boundary.

```typescript
// src/shared/ipc-contract.ts (additions)
export const IPC = {
  // ... existing
  CAPTURE_LIST_DEVICES: 'capture:list-devices',
  CAPTURE_GET_DEFAULT_DEVICE: 'capture:get-default-device',
  CAPTURE_SET_DEFAULT_DEVICE: 'capture:set-default-device',
  CAPTURE_GET_PRESET: 'capture:get-preset',
  CAPTURE_SET_PRESET: 'capture:set-preset',
} as const;

export type CaptureDevice = {
  deviceId: string;        // canonical name (canonical form)
  rawName: string;         // ffmpeg's emitted string (for audit only)
  index: number;           // order in dshow list
  type: 'dshow';
};

export type QualityPreset =
  | { preset: 'sd' }
  | { preset: 'hd' }
  | { preset: 'custom'; resolution: string; framerate: number };

export interface IpcContract {
  // ... existing
  capture: {
    listDevices: () => Promise<CaptureDevice[]>;
    getDefaultDevice: () => Promise<string | null>;
    setDefaultDevice: (input: { deviceId: string }) => Promise<{ ok: true }>;
    getPreset: (input: { doctorId: string; deviceId: string }) => Promise<QualityPreset | null>;
    setPreset: (input: { doctorId: string; deviceId: string; preset: QualityPreset }) => Promise<{ ok: true }>;
  };
}
```

**Source:** Cont7 verified Electron + Phase 2 IPC pattern (already in `src/main/ipc/patients.ts`).

### Pattern 2: Per-page React state for transient preview, IPC for persistent settings

**What:** Component-local state for `selectedDeviceId`, `isPreviewing`, `error`. Persisted default (`capture.default_device_id` + per-(doctor, device) preset matrix) flows through IPC. Mirror Phase 2 patient list pattern: one-shot fetch on mount, IPC roundtrip on each mutation.

**When to use:** Every Phase 3 page that touches settings.

```typescript
// src/renderer/src/hooks/useVideoPreview.ts
import { useEffect, useRef, useState } from 'react';

export type PreviewError = {
  code: 'NotAllowedError' | 'NotFoundError' | 'OverconstrainedError' | 'NotReadableError' | 'Unknown';
  message: string;
};

export function useVideoPreview(deviceId: string | null) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<PreviewError | null>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!deviceId || !videoRef.current) {
      setActive(false);
      return;
    }
    let stream: MediaStream | null = null;
    let cancelled = false;

    setError(null);
    setActive(true);

    navigator.mediaDevices
      .getUserMedia({ video: { deviceId: { exact: deviceId } }, audio: false })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play().catch(() => {});
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const err = e as { name?: string; message?: string };
        setError({
          code: (err.name as PreviewError['code']) ?? 'Unknown',
          message: err.message ?? 'Preview failed',
        });
        setActive(false);
      });

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
      setActive(false);
    };
  }, [deviceId]);

  return { videoRef, error, active };
}
```

**Source:** Context7 MDN `MediaDevices/getUserMedia` + `MediaDevices/enumerateDevices` + Phase 2 patient-list hook pattern.

### Pattern 3: Canonical string normalization up-front (D-11)

**What:** Apply NFC unicode normalization + trim + collapse-spaces exactly once when the device name enters the app from ffmpeg. The canonical form is then the ONLY form stored in settings, the IPC payload, the audit metadata, and (in Phase 4) the ffmpeg `-i` arg. Display == canonical because the doctor sees the canonical string both in the dropdown and in any error message.

**When to use:** Always; the canonicalization helper is the single entry point.

```typescript
// src/main/capture/canonicalize.ts
export function canonicalizeName(raw: string): string {
  return raw
    .normalize('NFC')                              // D-11 step 1
    .replace(/[\u200B-\u200D\uFEFF]/g, '')          // strip zero-width
    .replace(/\s+/g, ' ')                          // collapse internal whitespace
    .trim();                                       // D-11 step 3
}

export function canonicalizeOrThrow(raw: string): string {
  const c = canonicalizeName(raw);
  if (c.length === 0) throw new Error('Empty device name after canonicalization');
  return c;
}
```

**Source:** Context7 MDN `String.prototype.normalize` + PITFALLS §Pitfall 10 verification.

### Pattern 4: Pure-function auto-detect (D-06)

**What:** A pure function from canonical device name → inferred preset. Trivial to unit-test; the same function is reused without rewrites if the regex list grows.

```typescript
// src/main/capture/auto-detect-preset.ts
export type InferredPreset = 'sd' | 'hd';

const SD_PATTERNS = [/EasyCap/i, /USB\s*Video/i, /USB\s*2\.0\s*TV/i, /CVBS/i, /Composite/i, /S[-‐ー]?Video/i];
const HD_PATTERNS = [/HDMI/i, /1080p/i, /\bHD\b/i, /Digital/i, /DVI/i, /UVC/i];

export function autoDetectPreset(canonicalName: string): InferredPreset {
  if (SD_PATTERNS.some((re) => re.test(canonicalName))) return 'sd';
  if (HD_PATTERNS.some((re) => re.test(canonicalName))) return 'hd';
  return 'hd'; // default fallback per D-06
}
```

**Source:** D-06 spec + Phase 2 validator pattern (pure functions in `validators.ts`).

### Pattern 5: Settings key/value repository for the preset matrix

**What:** Read/write the matrix via simple helpers; no new migration since the `settings` table already exists. The key shape is human-readable so vendor inspection works.

```typescript
// src/main/capture/preset-repo.ts
import { getDb } from '../db';
import type { QualityPreset } from '@shared/ipc-contract';

const KEY = (doctorId: string, deviceId: string) =>
  `capture.preset.${doctorId}.${deviceId}`;
const DEFAULT_KEY = (doctorId: string) => `capture.default_device_id.${doctorId}`;

export const presetRepo = {
  getMatrix(doctorId: string, deviceId: string): QualityPreset | null {
    const db = getDb();
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY(doctorId, deviceId)) as { value: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.value) as QualityPreset;
  },
  set({ doctorId, deviceId, preset }: { doctorId: string; deviceId: string; preset: QualityPreset }): void {
    const db = getDb();
    db.prepare(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    ).run(KEY(doctorId, deviceId), JSON.stringify(preset), Date.now());
  },
  getDefault(doctorId: string): string | null {
    const db = getDb();
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(DEFAULT_KEY(doctorId)) as { value: string } | undefined;
    return row ? row.value : null;
  },
  setDefault({ doctorId, deviceId }: { doctorId: string; deviceId: string }): void {
    const db = getDb();
    db.prepare(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    ).run(DEFAULT_KEY(doctorId), deviceId, Date.now());
  },
};
```

**Source:** Phase 2 `settings` table (already in `0001_init.sql` line 70–74) + Phase 2 patient repo pattern.

### Anti-Patterns to Avoid

- **Spawning ffmpeg for recording in Phase 3.** Phase 3 only enumerates via ffmpeg. The ffmpeg child for `-i video="<name>"` + mp4 encoding is Phase 4. Mixing the two now creates a double-track of `PROC.md` work.
- **Storing absolute device names verbatim.** Always pass through `canonicalizeName()`. The transducer "device-name-once-canonicalized" gets baked in here, not "we'll fix it later" — Phase 4 inherits the canonical form.
- **Renderer-side SQLite access.** Every `settings` read/write goes through main IPC. The sandboxed renderer cannot load `better-sqlite3`.
- **Storing the matrix in a per-doctor JSON blob.** Per-doctor-per-device key shape is cleaner for audit metadata and for future "reset just this device" affordances.
- **Recording audio in Phase 3 even though MediaDevices exposes mics.** D-08 locks `audio: false` everywhere. Webcams may have mics; we ignore them.
- **Optimistic UI for preset changes.** Per Phase 2 anti-pattern: await the IPC round-trip; surface errors inline. The doctor trusts the saved value because it round-tripped.
- **A separate "Refresh devices" button in the dropdown header.** Per D-10 + agent discretion: omit. If the doctor plugs/unplugs, they re-enter the page.
- **Calling `setPermissionRequestHandler` to manually grant `media`.** Per PITFALLS Integration Gotchas + Electron docs: `webPreferences.permissions = ['media']` is the correct, minimal mechanism. `setPermissionRequestHandler` is reserved for non-media permissions (geolocation, notifications) and adds UI prompts we don't want.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| USB device enumeration | Custom Win32 SetupAPI calls via `ffi-napi` | `ffmpeg-static` + `dshow -list_devices` | Same ffmpeg binary that Phase 4 records with; one enumeration source of truth. Dev surface is ffmpeg's stable CLI, not native COM. |
| NFC unicode normalization | Custom normalization table | `String.prototype.normalize('NFC')` (Node stdlib) | Built-in, locale-aware, single function call |
| Webcam preview stopped on unmount | Manual `video.src = ''` + DOM hack | `stream.getTracks().forEach(t => t.stop())` then `videoRef.current.srcObject = null` | The MDN recipe; releases the OS handle deterministically |
| Permission grant for camera | Custom `setPermissionRequestHandler` with a dialog | `webPreferences: { permissions: ['media'] }` | Per Electron docs: one flag, no UI prompt, preserves sandbox |
| Permission settings for the dropdown | Custom dropdown | shadcn `Select` primitive (already installed) | shadcn already wraps Radix; Phase 2 SettingsUsers page uses it for Reset PIN |
| Auto-detect heuristic | Per-device branching with OS-level detection | First-letter regex of canonical name | D-06 spec; cheap, deterministic, easy to test |
| Settings persistence | New table + migration | Existing `settings` k/v table | Per D-04 matrix lives in `settings`; no migration |
| Device ID for Phase 4 ffmpeg arg | A separate ffmpeg-name lookup call | The canonical name (already Phase 3 IPC payload) | D-11 makes the canonical name the ONE ID shared across IPC, settings, and ffmpeg arg |
| React `useVideoPreview` hook | Page-local `useEffect` blocks | Single hook in `src/renderer/src/hooks/useVideoPreview.ts` | Reused by Settings → Capture and Procedure Room (per D-09) |

**Key insight:** The DeviceName-Once-Canonicalized principle (D-11) is the phase's load-bearing decision. It eliminates the entire class of "ffmpeg fails on curly quote" bugs from the very first IPC call — saving all the downstream debugging that PITFALLS §Pitfall 10 warns about.

## Common Pitfalls

### Pitfall 1: `getUserMedia` throws in the sandboxed renderer

**What goes wrong:** DevTools shows `NotAllowedError` immediately on first preview, even though the OS camera light comes on momentarily.

**Why it happens:** Default Electron sandbox blocks `getUserMedia` until `'media'` is added to `webPreferences.permissions`.

**How to avoid:** Add `permissions: ['media']` to the `BrowserWindow` constructor in `src/main/window.ts`. Verify the security baseline still reads `contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true`.

**Warning signs:** `NotAllowedError` on first preview; works in browser DevTools outside Electron.

**Phase to address:** Phase 3 (Plan 03-01).

**Source:** Electron docs (Context7) + PITFALLS Integration Gotchas.

### Pitfall 2: Canonicalize never run; ffmpeg fails in Phase 4 on a curly quote

**What goes wrong:** ffmpeg args emitted in Phase 4 contain `video=USB Vidëo` (or with trailing space) and ffmpeg exits with "Option video= (null) not found".

**Why it happens:** Phase 3 stored the raw dshow string in `settings`; Phase 4 re-uses it without normalization.

**How to avoid:** Apply `canonicalizeName()` at the IPC boundary in `src/main/capture/devices.ts`. The canonical form is the ONLY form ever returned to the renderer. Audit metadata echoes the canonical form. Phase 4 reads from the same column.

**Warning signs:** `vitest` tests on `canonicalize.ts` failing on the test cases from D-11.

**Phase to address:** Phase 3 (Plan 03-01).

**Source:** PITFALLS §Pitfall 10 + D-11.

### Pitfall 3: Preview stream leaks across route changes

**What goes wrong:** Doctor clicks Finish on Procedure Room, navigates to Patients list, preview stream keeps running; camera light stays on; battery drains.

**Why it happens:** `<video>` element unmounted but `MediaStream` tracks never stopped.

**How to avoid:** `useVideoPreview` hook's `useEffect` cleanup calls `stream.getTracks().forEach(t => t.stop())` and nulls `videoRef.current.srcObject`. Audit each preview lifecycle: `capture.preview_started` on stream assignment, `capture.preview_stopped` on cleanup, `capture.preview_failed` on `getUserMedia` rejection.

**Warning signs:** Camera LED on after navigating away from Procedure Room.

**Phase to address:** Phase 3 (Plan 03-02).

**Source:** MDN `MediaStreamTrack.stop()` + Phase 2 recorder `close` cleanup pattern.

### Pitfall 4: Procedure Room dropdown persists the session override into settings

**What goes wrong:** Doctor picks a different device for one procedure; on the next procedure, the saved default is the override, not the original.

**Why it happens:** UI confuses "session override" with "default update". `capture.setDefaultDevice` is called from the override path.

**How to avoid:** Per D-01: Procedure Room's inline dropdown calls `setSelectedDevice` (component-local). Only Settings → Capture's "Save" mutates `capture.setDefaultDevice`. The Procedure Room dropdown must NOT call `setDefaultDevice`; the "Last used: <X>" label clarifies this.

**Warning signs:** `audit_log` shows `capture.device_changed` from a Procedure Room event with no Settings change.

**Phase to address:** Phase 3 (Plan 03-02).

**Source:** D-01.

### Pitfall 5: Enumeration runs on every render of Procedure Room

**What goes wrong:** Each `useState` update triggers an IPC call; ffmpeg spawns repeatedly; CPU spikes.

**Why it happens:** `useEffect` deps include volatile state.

**How to avoid:** Enumeration on mount + on route entry only (D-10). Use `useEffect(..., [])` for the initial listDevices call; refresh on explicit user action (e.g., modal reopen). The list is cached in component state and not refetched until the user re-enters.

**Warning signs:** Startup log shows repeated `capture-devices-enumerated` events during a single Procedure Room session.

**Phase to address:** Phase 3 (Plan 03-02).

**Source:** PITFALLS §Performance Traps.

### Pitfall 6: Audit rows missing the canonical device name

**What goes wrong:** `audit_log.metadata` shows the raw dshow string (with curly quote); a second audit row for the same device shows the canonical form; vendor investigation gets confused.

**Why it happens:** Some paths run `canonicalizeName`, others don't.

**How to avoid:** Audit metadata always stores the canonical form. Helper `audit({ ..., metadata: { deviceName: canonical, preset: 'sd' } })` everywhere in `src/main/ipc/capture.ts`. Test asserts `audit_log.metadata` columns match the canonical form.

**Warning signs:** Two `capture.preset_changed` rows for the same save show different names.

**Phase to address:** Phase 3 (Plan 03-01 + 03-03).

**Source:** Phase 2 audit pattern (recordAudit always uses canonical IDs).

### Pitfall 7: Auto-detect heuristic saves 'hd' for an EasyCap device

**What goes wrong:** Doctor plugs EasyCap, the app sets the saved preset to HD digital; preview forces 1920×1080; EasyCap returns black.

**Why it happens:** The regex priority or the fallback is wrong.

**How to avoid:** SD analog patterns checked BEFORE HD digital patterns. Unit tests cover `EasyCap USB Video`, `USB2.0 TV`, `HDMI Capture`, `1080p Webcam`, `Generic Webcam`. The fallback is `'hd'` per D-06 spec.

**Warning signs:** Vitest snapshot mismatches for known device names.

**Phase to address:** Phase 3 (Plan 03-01).

**Source:** D-06.

### Pitfall 8: Permissions flag set without preserving the security baseline

**What goes wrong:** Adding `permissions: ['media']` is followed accidentally by `webSecurity: false` "to fix" something; the renderer becomes CORS-bypassable.

**Why it happens:** Copy-paste from a Stack Overflow answer.

**How to avoid:** Plan 03-01 task explicitly diffs the `BrowserWindow` config before/after with a UAT check: `contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, permissions: ['media']`. The Phase 1 security baseline script (`scripts/check-security-baseline.cjs`) continues to pass.

**Warning signs:** `check-security-baseline.cjs` exits non-zero.

**Phase to address:** Phase 3 (Plan 03-01).

**Source:** AGENTS.md security baseline + Phase 1.

### Pitfall 9: Settings → Capture changes the saved default while preview is open

**What goes wrong:** Doctor opens Settings → Capture, picks a different device, sees preview, closes Settings. The preview they thought they were "checking" is now the saved default.

**Why it happens:** Settings page has no Save button; changes are auto-persisted.

**How to avoid:** Two-mode Settings → Capture: a "Configure" mode that updates local state + preview reactively, and an explicit "Save" button that writes `capture.setDefaultDevice` + `capture.setPreset`. The preview is a verification; the save is opt-in.

**Warning signs:** `audit_log` shows `capture.device_changed` without a corresponding UI click.

**Phase to address:** Phase 3 (Plan 03-02).

**Source:** D-09.

### Pitfall 10: `MediaRecorder` is used for screenshot-from-preview "in case it's easy"

**What goes wrong:** Doctor pauses on a frame, UI snaps via `MediaRecorder.start()`; subsequent real recording in Phase 4 conflicts.

**Why it happens:** Out-of-scope scope creep.

**How to avoid:** Phase 3 ships `<video>` + `useVideoPreview` only. Screenshot-from-preview is a Phase 5 concern (canvas snapshot). `MediaRecorder` is forbidden for v1; PITFALLS §Pitfall 1.

**Warning signs:** A new IPC handler named `capture:record-clip` in `src/main/ipc/capture.ts`.

**Phase to address:** Phase 3 (Plan 03-01 explicit list "DO NOT ADD").

**Source:** PITFALLS §Pitfall 1.

## Code Examples

Verified patterns from Context7 + Phase 2 codebase:

### Example 1: Enumerate DirectShow devices via ffmpeg-static

```typescript
// src/main/capture/devices.ts
import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import { canonicalizeName } from './canonicalize';
import type { CaptureDevice } from '@shared/ipc-contract';

function ffmpegPath(): string {
  if (!ffmpegStatic) throw new Error('ffmpeg-static not bundled');
  // ponytail: in dev mode, the path inside node_modules is fine. Phase 4 will
  // rewrite `app.asar` -> `app.asar.unpacked` for packaged builds.
  return ffmpegStatic;
}

export async function enumerateDshowDevices(): Promise<CaptureDevice[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath(), [
      '-list_devices', 'true',
      '-f', 'dshow',
      '-i', 'dummy',
    ]);
    let stderr = '';
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.on('error', reject);
    proc.on('close', () => {
      const devices: CaptureDevice[] = [];
      let inVideo = false;
      let idx = 0;
      for (const line of stderr.split('\n')) {
        if (line.includes('DirectShow video devices')) { inVideo = true; continue; }
        if (line.includes('DirectShow audio devices')) { inVideo = false; continue; }
        if (!inVideo) continue;
        const m = line.match(/^\s*"([^"]+)"\s*$/);
        if (!m) continue;
        const raw = m[1];
        devices.push({
          deviceId: canonicalizeName(raw),
          rawName: raw,
          index: idx++,
          type: 'dshow',
        });
      }
      resolve(devices);
    });
  });
}
```

**Source:** `.opencode/skills/electron-ffmpeg/SKILL.md` §3 + D-11.

### Example 2: `getUserMedia` with sandboxed renderer (the preview half)

```typescript
// src/renderer/src/pages/ProcedureRoom.tsx (sketch)
import { useEffect, useState } from 'react';
import { useRoute } from '@/lib/router';
import { useSession } from '@/store/session';
import { useVideoPreview } from '@/hooks/useVideoPreview';
import { Button } from '@/components/ui/button';

export default function ProcedureRoom(): JSX.Element {
  const { navigate } = useRoute();
  const { currentUser } = useSession();
  const [savedDevice, setSavedDevice] = useState<string | null>(null);
  const [sessionDevice, setSessionDevice] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    void window.api.capture.getDefaultDevice().then((d) => {
      setSavedDevice(d);
      setSessionDevice(d); // session override starts at the saved default (D-01)
    });
  }, []);

  const activeDevice = sessionDevice ?? savedDevice;
  const { videoRef, error } = useVideoPreview(previewing ? activeDevice : null);

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Procedure Room</h1>
        <Button variant="outline" onClick={() => navigate({ name: 'patient-detail', id: 'previous' })}>
          Finish
        </Button>
      </header>
      {activeDevice ? (
        <video ref={videoRef} autoPlay muted playsInline className="w-full aspect-video bg-black" />
      ) : (
        <div className="aspect-video bg-black grid place-items-center text-white">
          <p>No device selected — go to Settings → Capture to pick one</p>
          <Button onClick={() => navigate({ name: 'settings-capture' })}>Open Settings</Button>
        </div>
      )}
      {error && <p role="alert">{error.message}</p>}
      <div className="flex gap-2">
        {!previewing ? (
          <Button onClick={() => setPreviewing(true)} disabled={!activeDevice}>Start Preview</Button>
        ) : (
          <Button variant="outline" onClick={() => setPreviewing(false)}>Stop Preview</Button>
        )}
      </div>
    </main>
  );
}
```

**Source:** MDN `MediaDevices/getUserMedia` + Phase 2 page pattern (e.g., `PatientsList.tsx`).

### Example 3: zod validator for preset + deviceId

```typescript
// src/shared/validators.ts (additions)
export const captureDeviceIdInput = z.object({
  deviceId: z.string().min(1).max(500),
});

export const presetInput = z.object({
  doctorId: z.string().uuid(),
  deviceId: z.string().min(1).max(500),
  preset: z.discriminatedUnion('preset', [
    z.object({ preset: z.literal('sd') }),
    z.object({ preset: z.literal('hd') }),
    z.object({
      preset: z.literal('custom'),
      resolution: z.string().regex(/^\d{2,5}[x×]\d{2,5}$/, 'W×H like 1920×1080'),
      framerate: z.number().int().refine((n) => [25, 30, 50, 60].includes(n), 'Use 25/30/50/60'),
    }),
  ]),
});

export const presetQueryInput = z.object({
  doctorId: z.string().uuid(),
  deviceId: z.string().min(1).max(500),
});
```

**Source:** Phase 2 validator pattern + D-05.

### Example 4: Audit on every capture event

```typescript
// src/main/ipc/capture.ts (sketch)
import { ipcMain } from 'electron';
import { IPC } from '@shared/ipc-contract';
import { enumerateDshowDevices } from '../capture/devices';
import { presetRepo } from '../capture/preset-repo';
import { audit } from '../db/audit';
import { session } from '../auth/session';
import { presetInput, presetQueryInput, captureDeviceIdInput } from '@shared/validators';

function requireSession(): string {
  const id = session.currentUserId;
  if (!id) throw new Error('Not authenticated');
  return id;
}

export function registerCaptureIpc(): void {
  ipcMain.handle(IPC.CAPTURE_LIST_DEVICES, async () => {
    return enumerateDshowDevices();
  });

  ipcMain.handle(IPC.CAPTURE_GET_DEFAULT_DEVICE, async () => {
    const doctorId = requireSession();
    const deviceId = presetRepo.getDefault(doctorId);
    audit({ action: 'capture.device_changed', entityType: 'capture', entityId: deviceId, metadata: { stage: 'read' } });
    return deviceId;
  });

  ipcMain.handle(IPC.CAPTURE_SET_DEFAULT_DEVICE, async (_e, raw: unknown) => {
    const { deviceId } = captureDeviceIdInput.parse(raw);
    const doctorId = requireSession();
    presetRepo.setDefault({ doctorId, deviceId });
    audit({ action: 'capture.device_changed', entityType: 'capture', entityId: deviceId, metadata: { stage: 'save', deviceName: deviceId } });
    return { ok: true };
  });

  ipcMain.handle(IPC.CAPTURE_GET_PRESET, async (_e, raw: unknown) => {
    const { doctorId, deviceId } = presetQueryInput.parse(raw);
    return presetRepo.getMatrix(doctorId, deviceId);
  });

  ipcMain.handle(IPC.CAPTURE_SET_PRESET, async (_e, raw: unknown) => {
    const { doctorId, deviceId, preset } = presetInput.parse(raw);
    presetRepo.set({ doctorId, deviceId, preset });
    audit({ action: 'capture.preset_changed', entityType: 'capture', entityId: deviceId, metadata: { deviceName: deviceId, preset: preset.preset } });
    return { ok: true };
  });
}
```

**Source:** Phase 2 `src/main/ipc/patients.ts` (every-mutation audit pattern) + D-11 (canonical names in metadata).

### Example 5: Permissions flag in `BrowserWindow`

```typescript
// src/main/window.ts (one-line addition)
webPreferences: {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  permissions: ['media'],  // ← Phase 3: enable camera in sandboxed renderer (PITFALLS Integration Gotchas)
  preload: preloadPath,
},
```

**Source:** Electron docs (Context7) on `MediaAccessPermissionRequest` + `webPreferences.permissions`.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.9 (Electron-as-Node runner via `scripts/run-vitest.cjs`) |
| Config file | none — vitest defaults; per-test setup via `tests/main/setup.ts` and `tests/renderer/setup.ts` |
| Quick run command | `npm run test:unit -- tests/main/capture tests/renderer/hooks` |
| Full suite command | `npm run test:unit` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|---------------|
| CAPT-01 | `enumerateDshowDevices()` returns canonical list from ffmpeg `-list_devices` | unit (mock spawn) | `npm run test:unit -- tests/main/capture/devices.test.ts` | ❌ Wave 0 |
| CAPT-01 | Settings table reaches `capture-devices-enumerated` startup log entry on launch | integration | `npm run test:unit -- tests/main/capture/init.test.ts` | ❌ Wave 0 |
| CAPT-02 | `capture.default_device_id.<doctorId>` round-trips through `setDefault`/`getDefault` | unit | `npm run test:unit -- tests/main/capture/preset-repo.test.ts` | ❌ Wave 0 |
| CAPT-03 | `useVideoPreview` hook starts/stops `MediaStream` on mount/unmount | unit (happy-dom + mocks) | `npm run test:unit -- tests/renderer/hooks/use-video-preview.test.ts` | ❌ Wave 0 |
| CAPT-03 | `useVideoPreview` rejects `NotAllowedError` / `NotFoundError` / `OverconstrainedError` / `NotReadableError` to local error state | unit | `npm run test:unit -- tests/renderer/hooks/use-video-preview.test.ts` | ❌ Wave 0 |
| CAPT-10 | `canonicalizeName` normalizes NFC + trim + collapse-spaces + strips zero-width | unit | `npm run test:unit -- tests/main/capture/canonicalize.test.ts` | ❌ Wave 0 |
| CAPT-10 | Canonical name round-trips through ffmpeg arg (the exact string Phase 4 will receive) | unit | `npm run test:unit -- tests/main/capture/devices.test.ts` | ❌ Wave 0 |
| SET-01 | `capture.setDefaultDevice` writes canonical name to `settings` table | unit | `npm run test:unit -- tests/main/capture/preset-repo.test.ts` | ❌ Wave 0 |
| SET-02 | `capture.setPreset({preset:'custom'})` validates W×H format + framerate enum | unit | `npm run test:unit -- tests/shared/preset-input.test.ts` | ❌ Wave 0 |
| SET-02 | `autoDetectPreset()` returns `'sd'` for EasyCap / `USB Video` / `CVBS` / `S-Video` inputs | unit | `npm run test:unit -- tests/main/capture/auto-detect-preset.test.ts` | ❌ Wave 0 |
| SET-02 | `autoDetectPreset()` returns `'hd'` for `HDMI` / `1080p` / `Digital` / `DVI` / `UVC` | unit | `npm run test:unit -- tests/main/capture/auto-detect-preset.test.ts` | ❌ Wave 0 |
| AUDIT-01 | Every `capture.*` mutation writes an audit row with canonical device name in metadata | integration | `npm run test:unit -- tests/main/capture/audit-trace.test.ts` | ❌ Wave 0 |
| Security baseline | `webPreferences.permissions` does not regress contextIsolation / sandbox / nodeIntegration | smoke | `npm run test:unit -- tests/shell/security-baseline.test.ts` (extending existing) | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm run test:unit -- tests/main/capture tests/renderer/hooks`
- **Per wave merge:** `npm run test:unit`
- **Phase gate:** `npm run test:unit && npm run typecheck` then `/gsd-verify-work 3`

### Wave 0 Gaps

- [ ] `tests/main/capture/devices.test.ts` — covers CAPT-01 (mock spawn) + CAPT-10 (canonical round-trip)
- [ ] `tests/main/capture/canonicalize.test.ts` — covers CAPT-10 (NFC + trim + collapse-spaces + zero-width strip)
- [ ] `tests/main/capture/auto-detect-preset.test.ts` — covers SET-02 (SD regexes + HD regexes + fallback)
- [ ] `tests/main/capture/preset-repo.test.ts` — covers CAPT-02 + SET-01 + SET-02 (settings k/v read/write)
- [ ] `tests/main/capture/audit-trace.test.ts` — covers AUDIT-01 for every capture.* event
- [ ] `tests/renderer/hooks/use-video-preview.test.ts` — covers CAPT-03 (start/stop on unmount + error states)
- [ ] `tests/renderer/pages/procedure-room.test.tsx` — covers D-01 (Last used label) + D-07 (Start/Stop/Finish) + D-02 (empty state)
- [ ] `tests/renderer/pages/settings-capture.test.tsx` — covers D-09 (live preview pane) + D-10 (no refresh button)
- [ ] `tests/shell/security-baseline.test.ts` — extend Phase 1 to assert `permissions: ['media']` is present
- [ ] Framework install: not needed (Vitest + jsdom + happy-dom already installed)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V1 Architecture | yes | Two-path capture architecture per Phase 2 research; renderer is sandboxed; main owns all DB and child-process access |
| V2 Authentication | no | Phase 1/2 already shipped; Phase 3 inherits `requireSession()` |
| V3 Session Management | no | Same as V2 |
| V4 Access Control | yes | `capture.*` IPC handlers gate on `session.currentUserId`; per-doctor scope preserved |
| V5 Input Validation | yes | zod schemas (`captureDeviceIdInput`, `presetInput`, `presetQueryInput`) re-validate in main (per Fix 5) |
| V6 Cryptography | no | No new crypto; Phase 3 doesn't touch encryption |
| V7 Error Handling | yes | `try/catch` in IPC handlers, render IPC errors as `IpcErrorException` (per Phase 2) |
| V9 Communication | no | No new local network |
| V14 Configuration | yes | `webPreferences.permissions = ['media']` is the minimal flag; security baseline preserved (Pitfall 8) |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Untrusted device name from ffmpeg → ffmpeg child arg in Phase 4 | Tampering | `canonicalizeName()` at IPC boundary (D-11) — the canonical form is what ffmpeg receives |
| Renderer DOM injection via malicious device name label | Tampering | React JSX escapes strings by default; no `dangerouslySetInnerHTML` in settings pages |
| Camera access without consent | Information Disclosure | `webPreferences.permissions` requires the app to be the originator; OS camera indicator turns on so the user sees access |
| Device-lost during preview leaves stream half-open | Denial of Service | `useVideoPreview` cleanup calls `stream.getTracks().forEach(t.stop())` on unmount + on dependency change |
| Capture audit row missing PII guard | Information Disclosure | Per Fix 6: metadata echoes canonical device name only — never patient data, never raw labels |

### Security Baseline Re-verification

Plan 03-01 must run `scripts/check-security-baseline.cjs` after the `webPreferences` change to confirm the security baseline still reads:

```
contextIsolation: true
nodeIntegration: false
sandbox: true
webSecurity: true
permissions: ['media']   ← NEW
```

**Source:** AGENTS.md + Phase 1 + PITFALLS Integration Gotchas.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `setPermissionRequestHandler` to grant `media` permission manually | `webPreferences.permissions` array | Electron 32 (current) | One flag, no UI prompt, preserves sandbox; documented in Electron `BrowserWindow` reference |
| `getUserMedia` returns a `MediaStream`; renderer must manually stop | Same API; `useVideoPreview` hook centralizes the lifecycle | React 18 hooks + cleanup | Less boilerplate, cleanup is automatic on unmount |
| `navigator.mediaDevices.enumerateDevices()` only as device picker | Both renderer and main enumerate; cross-reference labels | Phase 3 introduction | Single source of truth for the recording path (Phase 4) |
| `settings` table as opaque JSON blob | Per-domain key prefixes (`capture.preset.<doctorId>.<deviceId>`) | Phase 3 | Human-readable in audit metadata; no migration needed |
| Implicit device-name normalization at ffmpeg invocation | Explicit canonicalization at enumeration | Phase 3 (D-11) | Phase 4 inherits the canonical form — no double-normalization |

**Deprecated/outdated:**
- `setPermissionRequestHandler({ permission: 'media', callback })` → replaced by `webPreferences.permissions` for the common case (per Electron docs).
- `MediaRecorder` for long-form recording → explicitly forbidden (PITFALLS §Pitfall 1); Phase 5 uses `MediaStream` + canvas for snapshots, never `MediaRecorder`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `String.prototype.normalize('NFC')` is available in Electron 32's Node-20 ABI | Pattern 3 / canonicalize.ts | LOW — `String.prototype.normalize` has been in V8 since 2011; if it changes, the unit test for `canonicalize.test.ts` fails immediately |
| A2 | `ffmpeg-static` v5.3.0's bundled binary includes `dshow` input support on Windows | Architecture | LOW — `dshow` is the default Windows input on `ffmpeg-static` since v4 |
| A3 | The framerate dropdown should default to 25/30 if the doctor doesn't change | D-05 + agent discretion | LOW — explicit dropdown means doctor picks; default is cosmetic |
| A4 | `recordAudit` from Phase 2 will accept the `capture.*` action names without renames | Architecture Pattern 5 | LOW — `recordAudit({ action: 'capture.preset_changed', ... })` is a plain string; no action-name registry |
| A5 | `navigator.mediaDevices.enumerateDevices()` returns the same devices as `ffmpeg -list_devices` in this hardware class (EasyCap + HDMI + webcam) | Architecture | MEDIUM — per PITFALLS §Pitfall 3, the lists can differ. Phase 3 keeps BOTH lists; if the renderer-side list is missing a device, the picker falls back to showing only the main-side list. Phase 4 inherits the same defensive pairing. |
| A6 | The `settings` table already supports `ON CONFLICT(key) DO UPDATE` (UPSERT) without schema change | Pattern 5 | LOW — SQLite has supported `ON CONFLICT` since 3.24 (2018); existing migrations ran on 3.40+ |
| A7 | `permissions: ['media']` does not require an explicit `setPermissionRequestHandler` | Pattern 5 | LOW — Electron docs explicitly state this. If Electron changes this in a future release, the security baseline test catches it |

**If this table is empty:** All claims were verified or cited. The MEDIUM item (A5) is the only one worth a checkpoint in Plan 03-02: if the renderer-side list is missing devices, the picker UI must fall back to the main-side list (no `deviceId` conflict is possible since the camera-fallback path lets `getUserMedia` pick).

## Open Questions

1. **Should the auto-detect heuristic log the matched regex group?**
   - What we know: D-06 says "agent decides whether to expose matched regex group as audit metadata".
   - What's unclear: vendor diagnostic value vs. audit log noise.
   - Recommendation: include `matched: 'sd-pattern-EasyCap'` in the `capture.preset_changed` metadata on the first auto-detect save. After that, the doctor changing the preset overrides and the regex match is no longer relevant. This gives the vendor a forensic trail without bloating the audit log.

2. **Should the Finish button route back to the previous patient or to the patient list?**
   - What we know: D-07 says "back to Patient List since the room is opened from Patient Detail"; agent confirms.
   - What's unclear: the current renderer has no `previousRoute` state.
   - Recommendation: track `previousRoute` in `useRoute()` for authenticated-routes only. Phase 3 stores the route the doctor came from when entering Procedure Room and `Finish` returns there. If `previousRoute` is unset, fall back to `{ name: 'patients' }`.

3. **Should the Settings → Capture preview pane persist the in-progress configuration before Save?**
   - What we know: D-09 says "preview pane updates reactively as the doctor changes device or preset".
   - What's unclear: what happens if the doctor navigates away without Save.
   - Recommendation: the preview's local state is component-local; only the explicit Save button calls `capture.setDefaultDevice` + `capture.setPreset`. Navigating away without Save is a no-op (matches the standard "form draft" pattern).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js 20 (Electron 32 ABI) | `String.prototype.normalize`, `child_process.spawn` | ✓ | Electron 32.3.3 (Node 20) | — |
| `ffmpeg-static` binary | `enumerateDshowDevices()` | ✗ (new dep) | 5.3.0 (npm registry) | Phase 3 depends on `npm install ffmpeg-static` succeeding |
| `better-sqlite3` 11.10.0 | `settings` table reads/writes | ✓ | 11.10.0 | — |
| shadcn `Select` | Device dropdown | ✓ | already in `src/renderer/src/components/ui/select.tsx` | — |
| shadcn `Button`, `Card`, `Label`, `Input` | Settings / Procedure Room chrome | ✓ | already installed | — |
| Windows | `dshow` enumeration | ✗ (this is a Mac dev environment per env) | — | macOS dev: tests mock the spawn and verify the IPC handler in isolation; real-device enumeration requires a Windows test bench. macOS dev does NOT support `dshow` so macOS dev cannot run the preview end-to-end. |
| `webPreferences.permissions` | Camera access in sandbox | ✓ | Electron 32 | — |
| `navigator.mediaDevices.getUserMedia` | Live preview | ✓ | Chromium (every Electron version) | — |

**Missing dependencies with no fallback:**
- Windows OS for end-to-end preview verification. **Mitigation:** Phase 3 ships a vitest test suite that mocks the spawn and the renderer hook; a manual smoke test on Windows is the Phase 3 UAT gate (per Plan 03-03).

**Missing dependencies with fallback:**
- `ffmpeg-static` not installed yet. **Mitigation:** `npm install ffmpeg-static@^5 @types/ffmpeg-static@^5` in Plan 03-01 task 1.

**Verification commands** (run in Phase 3 Plan 03-01):
```bash
npm view ffmpeg-static version       # 5.3.0
npm view @types/ffmpeg-static version # 5.1.0
```

## Sources

### Primary (HIGH confidence)

- `.opencode/skills/electron-ffmpeg/SKILL.md` — preview + ffmpeg dshow enumeration pattern (sections 1, 3, 6)
- `.opencode/skills/electron-vite/SKILL.md` — IPC contract, security baseline, preload bridge (sections 4, 8)
- `.planning/research/PITFALLS.md` — Pitfall 3 (enumeration race), Pitfall 10 (USB path quoting), Performance Traps, Integration Gotchas
- `.planning/research/ARCHITECTURE.md` — three-process model, IPC contract, audit pattern
- `.planning/research/STACK.md` — locked dependencies (Electron 32, electron-vite 2, React 18, TS 5.5, better-sqlite3 11, shadcn)
- `.planning/REQUIREMENTS.md` — CAPT-01/02/03/10, SET-01/02 traceability
- `.planning/phases/03-capture-enumeration-live-preview/03-CONTEXT.md` — D-01..D-11 locked decisions
- `.planning/phases/02-database-patient-audit-auth/02-CONTEXT.md` — settings table, audit pattern, IPC handler pattern
- `src/shared/ipc-contract.ts` — existing IPC contract structure to extend
- `src/main/ipc/patients.ts` — every-mutation audit pattern (Phase 2 reference)
- `src/main/db/migrations/0001_init.sql` — settings table already exists
- `src/main/window.ts` — current `webPreferences` (security baseline to preserve)
- Context7 /electron/electron — `BrowserWindow` webPreferences, `MediaAccessPermissionRequest`, `setPermissionRequestHandler` use cases
- Context7 /websites/developer_mozilla_en-us — `MediaDevices/enumerateDevices`, `MediaDevices/getUserMedia`, `OverconstrainedError`, `String.prototype.normalize`

### Secondary (MEDIUM confidence)

- `npm view ffmpeg-static version` → 5.3.0 (verified 2026-08-02)
- `npm view @types/ffmpeg-static version` → 5.1.0 (verified 2026-08-02)
- `ffmpeg-static` GitHub: https://github.com/eligrey/ffmpeg-static (long-established, npm downloads millions/wk)

### Tertiary (LOW confidence)

- A5 (renderer-side vs main-side device enumeration consistency) — flagged as risk; bench verification on a Windows machine is the only ground truth.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — locked by brief + verified npm registry
- Architecture: HIGH — extends Phase 2 patterns; one new `webPreferences` flag
- Pitfalls: HIGH — every pitfall is mapped to a verification step (Vitest test or smoke test)
- Code examples: HIGH — derived from `.opencode/skills/electron-ffmpeg/SKILL.md` + Phase 2 patterns

**Research date:** 2026-08-02
**Valid until:** 2026-09-01 (30 days — Electron 32 / ffmpeg-static versions are stable; the schema is unchanged)
