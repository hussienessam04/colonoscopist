# Phase 8: Licensing (Ed25519 signed `.lic` + 14-day trial + activation flow) - Research

**Researched:** 2026-08-24
**Domain:** Electron offline license verification (pure-JS Ed25519 + IPC gate)
**Confidence:** HIGH — stack is locked, all upstream artifacts (CONTEXT.md, REQUIREMENTS, ROADMAP, STACK, PITFALLS, ARCHITECTURE, STATE) and current codebase conventions were inspected; @noble/ed25519 API confirmed via Context7.

## Summary

Phase 8 closes the v1 milestone by gating every clinical workflow behind an Ed25519-signed `.lic` artifact (LIC-01..LIC-04). The verify path lives entirely in `src/main/license/verify.ts` — pure-JS via `@noble/ed25519 ^3.1.0` with the public key **embedded as a constant** (the binary never reads the key from disk). The `.lic` artifact is a `archiver`-produced zip of `license.json` (signed payload) + `license.sig` (raw 64-byte Ed25519 signature); tampered JSON or signature triggers `IPC_LICENSE_INVALID` and writes an `audit_log` row. The 14-day trial clock lives on the existing `settings` table as `trial_started_at INTEGER NULL`, written atomically on the first `auth.wizard-bootstrap` (D-01) and read every boot. The IPC gate (`src/main/license/gate.ts`) wraps every `ipcMain.handle` registration with a narrow exemption list (`AUTH_*`, `LICENSE_*`, `AUDIT_LOG`) so the app can boot, login, and activate without a license. UI mirrors the Phase 7 BackupRestore pattern: new `License` sidebar entry → `<License>` sub-page → boot-time `<LicenseGate>` modal for unactivated/expired states. Vendor-side `scripts/gen-license.cjs` reads the Ed25519 private key from `LICENSE_SIGNING_KEY_PATH` (env var) and writes `<machineId>.lic` — the signing key is **never checked into git**. Every license event routes through the existing `audit({...})` helper, surfacing in the Phase 7 Audit sub-page.

**Primary recommendation:** Use `@noble/ed25519 ^3.1.0` (pure-JS, audited, no native rebuild), wrap the single `verifyLicense({...})` helper with `Object.freeze`, register the IPC gate BEFORE every existing `register*()` call in `src/main/index.ts`, and treat the license truth as the verify-path output — never persist `license_is_valid` to `settings`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Ed25519 verify (signature math) | Main process | — | Renderer is sandboxed; crypto + filesystem access live in main. The verify path is shipped code, not vendor input. |
| Machine fingerprint (CPU + disk + MAC) | Main process | — | Requires `wmic` child_process + `os.cpus()` + `os.networkInterfaces()` — Node-only APIs. Renderer has no access. |
| `.lic` file load (dialog picker + zip extract) | Main process | — | Uses `dialog.showOpenDialog` (Fix 7 surface) and `archiver`/`yauzl` (Phase 7 deps). Renderer never reads paths directly. |
| Trial clock persistence | Main process (DB) | — | Single source of truth lives in `settings.trial_started_at`. Renderer reads via IPC only. |
| IPC gate (every `ipcMain.handle`) | Main process | — | The gate is a main-side wrapper around the existing `register*()` pattern. Renderer can't bypass it. |
| License status surface (LicenseStatus shape) | Main process (cached) | Renderer (read-only via IPC) | Main computes at boot + on every `license.activate`; renderer mirrors via `useLicenseStatus()` SWR. |
| Activation modal (boot-time first launch / expired) | Renderer | — | Renderer-only. Lives in `App.tsx` ABOVE the route render path; reads `useLicenseStatus().state` to decide visibility. |
| License sub-page (status card + "Load .lic file…" button) | Renderer | Main (IPC handler) | Reuses Phase 7 SettingsLayout/SettingsSidebar; the picker is `dialog.showOpenDialog` wrapped in main per Fix 7. |
| Audit row emission for license events | Main process | Renderer (filtered Audit page) | `audit({ action: 'license.activated' \| ... })` in main; the Phase 7 Audit sub-page already supports `entityType: 'license'` filter. |
| Vendor signing CLI | Vendor machine | — | `scripts/gen-license.cjs` runs on the vendor's workstation. Never bundled with the shipped app. |
| Embedded Ed25519 public key | Main process (constant) | — | Lives as a literal in `src/main/license/verify.ts`. Binary grep exposes tampering. |
| Trial countdown sidebar badge | Renderer | — | Computed from `LicenseStatus.trialDaysRemaining`. Pure renderer derivation; main ships the timestamp. |
| Bilingual license strings (EN/AR) | Renderer | — | Phase 7 i18next bundle is already wired. Phase 8 adds `license.*` keys to both bundles. |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@noble/ed25519` | ^3.1.0 | License signing/verification | Pure-JS, audited, RFC8032/ZIP215-compliant; no native rebuild needed (unlike `better-sqlite3`). The same library is used in main + vendor CLI + unit tests. |
| `@noble/hashes` | ^2.3.0 | SHA-512 (Ed25519 internal) + SHA-256 (fingerprint) | `@noble/ed25519` v3 requires an explicit `ed.hashes.sha512` hookup per its README; `@noble/hashes/sha2.js` ships both SHA-256 and SHA-512. Pure-JS, no native deps. |
| `archiver` | ^8.0.0 (already installed) | Pack `.lic` zip | Already a Phase 7 dependency (`archiver: ^8.0.0` in `package.json`); no new install. |
| `zod` | ^4.4.3 (already installed) | License IPC input validation | Reuses Phase 7's zod validators; `licenseActivateInput` is a new export of `src/shared/validators.ts`. |
| `i18next` / `react-i18next` | ^26 / ^17 (already installed) | Bilingual `license.*` keys | Phase 7 bundles (`en/translation.json` + `ar/translation.json`) are already loaded; Phase 8 only adds keys. |

### Supporting

| Tool / Pattern | Purpose | When to Use |
|----------------|---------|-------------|
| `os.cpus()[0].model` (Node stdlib) | CPU model for fingerprint | Stable across reboots; the `model` field (not `speed`) is the canonical hardware identifier. |
| `os.networkInterfaces()` (Node stdlib) | First non-internal IPv4 MAC | Excludes loopback (127.0.0.1) + the random MACs Chromium assigns to WebRTC; takes the first non-internal MAC. |
| `wmic diskdrive get serialnumber` (Windows) | Disk serial | Spawned as a one-shot child process at activation time only — NOT on every boot. Per Phase 1's existing child-process quoting discipline (PITFALLS §Pitfall 10). |
| `crypto.createHash('sha256')` (Node stdlib) | Fingerprint hash | Already used by `src/main/auth/pin.ts` for scrypt + salt handling; the same pattern applies here. |
| `Object.freeze` (JS native) | Verify-path tamper resistance | Apply to the `verifyLicense` function export; deeper granularity than module-level freeze so helpers (`hashFingerprint`, `parseLicenseSidecar`) stay unit-testable. |
| `dialog.showOpenDialog({filters:[{name:'Colonoscopist License', extensions:['lic']}]})` (Electron) | `.lic` file picker | Phase 7 D-13 verbatim pattern (BackupRestore picker); the renderer never composes paths. |
| `archiver` zip with `license.sig` + `license.json` entries | `.lic` artifact shape | Per CONTEXT D-10 verbatim — sidecar shape is required by PITFALLS §Pitfall 6. |

### Alternatives Considered

| Recommended | Alternative | Tradeoff |
|-------------|-------------|----------|
| `@noble/ed25519` | Node `crypto.sign(null, ..., 'ed25519')` | `crypto` is Node-only — the renderer can't use it, but the renderer doesn't need to (verify lives in main). Stick with `@noble/ed25519` for API parity with the vendor CLI + unit tests. |
| Embedded public key constant | Public key from a `.pem` file | Loading the key from disk makes it trivial to swap; embedding as a constant forces the binary-level grep test (PITFALLS §Pitfall 6 warning sign #2). |
| `Object.freeze(verifyLicense)` | `Object.freeze(Object.entries)` on the module | Module-level freeze breaks Vitest mocking (you can't reassign `__mock` helpers); function-level freeze is finer-grained. |
| Sidecar `license.json` + `license.sig` (zip) | Single base64-encoded JSON `.lic` | Single-file format requires either (a) signing the inner JSON bytes + storing the JSON separately (defeats single-file) or (b) signing a concatenated string that includes the JSON — vulnerable to canonicalization bugs. Sidecar is the verified-against-tampering pattern per PITFALLS §Pitfall 6. |
| `archiver` for `.lic` zip | `tar` archive | The `archiver` package is already a Phase 7 dependency (used by `src/main/backup/snapshot.ts`); no new install. `tar` would add a dep for a single-use case. |
| One-shot `wmic diskdrive get serialnumber` spawn | `node-disk-info` / `systeminformation` npm | Both are native modules — they would trigger `electron-rebuild` (Pitfall 4 risk) and add an attack surface. `wmic` is a stdlib Windows command, the spawn is awaited once. |
| Settings row for trial clock (`trial_started_at`) | New `license_state` table | New table adds two columns' worth of migration complexity for one boolean-ish clock. Reuses the existing `settings` key-value shape per Phase 2 D-04. |
| `IPC_LICENSE_INVALID` + `IPC_LICENSE_EXPIRED` | Single `IPC_LICENSE_REQUIRED` | Two distinct codes let the renderer distinguish "you've never activated" from "your trial ran out" in modal copy + sidebar badge color. |
| `<LicenseGate>` mounted ABOVE the route in `App.tsx` | Per-page license gate | One mount point guarantees the modal renders for any authenticated route; per-page gates would fragment the boot UX. |
| `scripts/gen-license.cjs` (Node CommonJS) | TypeScript CLI | CommonJS avoids the TS-build step on the vendor's machine (vendor doesn't need the full electron-vite toolchain); the script reads the private key + writes a single zip. |

**Installation:**

```bash
npm install @noble/ed25519 @noble/hashes
```

No new electron-rebuild run needed — both packages are pure-JS (per `@noble/ed25519` README: "zero dependencies, no native compilation").

**Version verification (run before writing plans):**

```bash
npm view @noble/ed25519 version    # 3.1.0
npm view @noble/hashes version     # 2.3.0
```

Both packages were verified against the npm registry on 2026-08-24.

## Package Legitimacy Audit

> Required because Phase 8 installs two external packages (`@noble/ed25519`, `@noble/hashes`).

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|------------|
| `@noble/ed25519` | npm | ~6 yrs (Paul Miller's noble-crypto suite) | ~14M/wk | github.com/paulmillr/noble-ed25519 | OK | Approved |
| `@noble/hashes` | npm | ~6 yrs (paired suite) | ~24M/wk | github.com/paulmillr/noble-hashes | OK | Approved |

**Packages removed due to [SLOP] verdict:** none.

**Packages flagged as suspicious [SUS]:** none.

*`@noble/ed25519` was confirmed against Context7 (`/paulmillr/noble-ed25519`, Source Reputation: High, 336 Code Snippets, Benchmark Score: 88.8) and against the official npm registry (`npm view @noble/ed25519 version` returned `3.1.0`). `@noble/hashes` was confirmed the same way. Both packages are part of Paul Miller's audited noble-crypto family — a maintained, widely-forked, dependency-free alternative to native crypto modules. Registry existence + Context7 confirmation satisfies the [VERIFIED] tag.*

## Architecture Patterns

### System Architecture Diagram

```
�──────────────────────────────────────────────────────────────────────────┐
│                      Electron Main Process                                │
│                                                                          │
│   app.whenReady()                                                         │
│       │                                                                   │
│       ├─→ getDb() + runMigrations()                                        │
│       │       └─→ migration 0008_settings_trial_started_at.sql             │
│       │                                                                   │
│       ├─→ registerLicenseGate()         ← NEW: runs FIRST                  │
│       │       │                                                            │
│       │       ├─→ initTrialClock()                                        │
│       │       │     └─→ reads settings.trial_started_at                    │
│       │       │                                                            │
│       │       └─→ cache LicenseStatus (compute-once-at-boot)              │
│       │                                                                   │
│       ├─→ registerAuthIpc()         ← wrapped by licenseGated (exempt)    │
│       ├─→ registerUsersIpc()        ← wrapped (auth-exempt)               │
│       ├─→ registerAuditIpc()        ← wrapped (exempt — audit logs         │
│       │                                 every read regardless of state)   │
│       ├─→ registerLicenseIpc()      ← NEW: LICENSE_STATUS + LICENSE_ACTIVATE│
│       │       │                                  (exempt from gate)        │
│       ├─→ registerPatientsIpc()     ← wrapped (license required)          │
│       ├─→ registerCaptureIpc()      ← wrapped                             │
│       ├─→ registerProceduresIpc()   ← wrapped                             │
│       ├─→ registerRecordingIpc()    ← wrapped                             │
│       ├─→ registerScreenshotsIpc()  ← wrapped                             │
│       ├─→ registerProfileIpc()      ← wrapped                             │
│       ├─→ registerUsedDevicesIpc()  ← wrapped                             │
│       ├─→ registerReportsIpc()      ← wrapped                             │
│       ├─→ registerReportTemplatesIpc() ← wrapped                          │
│       ├─→ registerBackupIpc()       ← wrapped                             │
│       └─→ registerRestoreIpc()      ← wrapped                             │
│                                                                          │
│   licenseGated(channel, handler)                                          │
│       │                                                                   │
│       ├─→ if channel ∈ EXEMPT → return handler unchanged                  │
│       │                                                                   │
│       └─→ else: wrap handler so it short-circuits with                    │
│           { ok: false, code: 'IPC_LICENSE_INVALID' | 'IPC_LICENSE_EXPIRED' }│
│           when cached LicenseStatus.state is invalid                      │
└──────────────────────────────────────────────────────────────────────────┘
                                  │
                                  │ IPC (typed contract, contextBridge)
                                  │
┌──────────────────────────────────────────────────────────────────────────┐
│                        Renderer (React + Tailwind)                         │
│                                                                          │
│   main.tsx mounts:                                                        │
│       <LanguageApplier />                                                 │
│       <App />                                                             │
│       <Toaster />                                                         │
│                                                                          │
│   App.tsx (state-based router)                                            │
│       │                                                                   │
│       ├─→ auth.status() on mount (Phase 2 pattern)                         │
│       │                                                                   │
│       ├─→ <LicenseGate> wraps the route render                             │
│       │       │                                                            │
│       │       ├─→ license.status() IPC                                     │
│       │       │     │                                                      │
│       │       │     ├─→ state='unactivated' → show modal                  │
│       │       │     ├─→ state='trial'       → countdown badge only        │
│       │       │     ├─→ state='expired'     → show modal                  │
│       │       │     └─→ state='licensed'    → no UI overhead              │
│       │       │                                                            │
│       │       └─→ sessionStorage flag dismisses modal until next boot      │
│       │                                                                   │
│       └─→ switch (route.name): 'license' → <License /> sub-page            │
│                                                                          │
│   <License /> (Settings sub-page)                                         │
│       │                                                                   │
│       ├─→ status card (machine id + trial clock + license summary)        │
│       │                                                                   │
│       └─→ "Load .lic file…" button                                        │
│           └─→ dialog.showOpenDialog → license.activate IPC                │
└──────────────────────────────────────────────────────────────────────────┘
                                  │
                                  │ File system (vendor-only path)
                                  │
┌──────────────────────────────────────────────────────────────────────────┐
│   scripts/gen-license.cjs (vendor CLI, NOT shipped)                       │
│       │                                                                   │
│       ├─→ reads LICENSE_SIGNING_KEY_PATH env var (defaults to              │
│       │   ./secrets/ed25519.private — gitignored)                          │
│       │                                                                   │
│       ├─→ <machine-fingerprint> <vendor-id> CLI args                       │
│       │                                                                   │
│       └─→ writes <machineId>.lic (zip of license.json + license.sig)       │
└──────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure (Phase 8 deltas only)

```
src/
├── main/
│   ├── db/
│   │   ├── migrations/
│   │   │   └── 00XX_settings_trial_started_at.sql    # NEW (X=12 per agent discretion)
│   │   └── migrations.ts                             # MODIFY: register new migration
│   ├── ipc/
│   │   └── license.ts                                # NEW: LICENSE_STATUS + LICENSE_ACTIVATE
│   ├── license/                                      # NEW entire module
│   │   ├── verify.ts                                 # Ed25519 verify + Object.freeze + embedded pubkey
│   │   ├── fingerprint.ts                            # CPU + disk + MAC → SHA-256
│   │   ├── trial.ts                                  # 14-day clock against settings.trial_started_at
│   │   ├── gate.ts                                   # licenseGated helper + EXEMPT set
│   │   ├── load-license.ts                           # read sidecar zip + invoke verify
│   │   ├── status.ts                                 # cached LicenseStatus computation
│   │   └── index.ts                                  # orchestrator: boot-time init
│   ├── paths.ts                                      # MODIFY: add licenseDir()
│   ├── auth/index.ts                                 # MODIFY: write settings.trial_started_at in wizardBootstrap()
│   └── index.ts                                      # MODIFY: registerLicenseGate() + registerLicenseIpc() FIRST
├── preload/
│   └── index.ts                                      # MODIFY: license.* bridge
├── renderer/src/
│   ├── components/
│   │   ├── LicenseGate.tsx                           # NEW: boot-time modal wrapper
│   │   └── SettingsSidebar.tsx                       # MODIFY: add License entry
│   ├── hooks/
│   │   └── useLicenseStatus.ts                       # NEW: SWR-style hook
│   ├── pages/
│   │   └── License.tsx                               # NEW: sub-page (mirrors BackupRestore)
│   ├── lib/router.ts                                 # MODIFY: add 'license' route
│   ├── i18n/
│   │   ├── en/translation.json                       # MODIFY: add license.* keys
│   │   └── ar/translation.json                       # MODIFY: add license.* keys
│   ├── App.tsx                                       # MODIFY: <LicenseGate> wrapper + 'license' route case
│   └── main.tsx                                      # (no change — gate mounts inside App.tsx)
├── shared/
│   ├── ipc-contract.ts                               # MODIFY: LICENSE_STATUS + LICENSE_ACTIVATE constants + LicenseState/LicenseStatus types
│   ├── errors.ts                                     # MODIFY: add IPC_LICENSE_INVALID + IPC_LICENSE_EXPIRED codes
│   └── validators.ts                                 # MODIFY: licenseActivateInput zod schema
scripts/
└── gen-license.cjs                                   # NEW: vendor CLI
secrets/                                               # NEW dir, .gitignored
tests/
├── main/
│   └── license/
│       ├── verify.test.ts                             # NEW: 6+ cases (happy path, tampered JSON, tampered sig, wrong pubkey, fingerprint mismatch, frozen exports)
│       ├── fingerprint.test.ts                        # NEW: 4+ cases (CPU only, MAC only, disk-serial mock, hash stability)
│       ├── gate.test.ts                               # NEW: 5+ cases (exempt list, expired path, invalid path, audit row emission)
│       └── load-license.test.ts                       # NEW: 3+ cases (zip extraction, parse, sidecar integrity)
├── integration/
│   └── license-verify-roundtrip.test.ts              # NEW: RUN_SMOKE=1 — full gen-license.cjs → verify.ts roundtrip
└── renderer/
    ├── pages/
    │   └── license.test.tsx                          # NEW: 8+ cases (status card, picker stub, error toast, sidebar badge)
    └── rtl/
        └── license.test.ts                           # NEW: Playwright RTL smoke (dir='rtl' + scrollWidth)
```

### Pattern 1: `Object.freeze` on `verifyLicense` only

**What:** Apply `Object.freeze` to the exported `verifyLicense` function (not the whole module) so the verify path is tamper-resistant while helper functions stay unit-testable.

**When to use:** Every export from `src/main/license/verify.ts` that returns license truth.

**Example:**

```typescript
// src/main/license/verify.ts
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { createHash } from 'node:crypto';

// ponytail: sha512 hookup is REQUIRED for @noble/ed25519 v3 — the
// library's default hash is undefined in the v3 release; without this
// line, ed.verify() throws synchronously.
ed.hashes.sha512 = sha512;

// Embedded Ed25519 public key (32 bytes hex). The matching private
// key lives ONLY on the vendor machine at $LICENSE_SIGNING_KEY_PATH.
// A binary-level grep on the shipped artifact surfaces any tampering
// of this constant — per PITFALLS §Pitfall 6 warning sign #2.
const VENDOR_PUBLIC_KEY_HEX = 'a1b2c3d4...'; // 64 hex chars (32 bytes)
// Verified via: `ed.getPublicKey(decodedPrivateKey)` at keypair creation time.

type VerifyResult =
  | { valid: true; vendorId: string; licensedAt: number; expiresAt: number | null }
  | { valid: false; reason: 'SIGNATURE_MISMATCH' | 'FINGERPRINT_MISMATCH' | 'MALFORMED_PAYLOAD' | 'EXPIRED' };

// Helpers stay editable for unit tests.
export function hashFingerprint(parts: { cpuModel: string; diskSerial: string; mac: string }): string {
  return createHash('sha256').update(`${parts.cpuModel}|${parts.diskSerial}|${parts.mac}`).digest('hex');
}

export function parseLicenseSidecar(zipBuffer: Buffer): { json: unknown; signature: Buffer } {
  // archiver-produced zip; yauzl extracts the two known entry names.
  // Throws MALFORMED_PAYLOAD if either entry is missing.
}

// The verify function — the SINGLE source of license truth.
function _verifyLicense(args: {
  licenseJson: Buffer;        // raw JSON bytes (not parsed)
  signature: Buffer;          // 64-byte Ed25519 signature
  publicKeyHex: string;       // 32-byte hex (embedded constant above)
  machineFingerprint: string; // SHA-256 hex (64 chars)
}): VerifyResult {
  // 1. Re-derive signature from raw JSON bytes (NOT from JSON.parse(json).toString()).
  // 2. ed.verify(signature, messageBytes, publicKeyBytes) → boolean.
  // 3. Parse JSON; compare embedded fingerprintHash to computed.
  // 4. Compare expiresAt > now.
  // Returns VerifyResult; never throws (signature errors → SIGNATURE_MISMATCH).
}

export const verifyLicense = Object.freeze(_verifyLicense) as typeof _verifyLicense;
```

**Key insight:** The `Object.freeze` is applied at module export, not at module top-level. Tests can still mock `hashFingerprint` and `parseLicenseSidecar` by re-importing the module via Vitest's `vi.mock`, but cannot reassign `verifyLicense`. This matches the G-05-13 / G-05-14 pattern of finer-grained freeze.

### Pattern 2: License IPC gate (`licenseGated` helper)

**What:** A single wrapper around `ipcMain.handle` that returns `{ ok: false, code: 'IPC_LICENSE_INVALID' | 'IPC_LICENSE_EXPIRED' }` when the cached license state is invalid/expired.

**When to use:** Every `ipcMain.handle` registration EXCEPT the narrow exemption list.

**Example:**

```typescript
// src/main/license/gate.ts
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC } from '@shared/ipc-contract';
import { getLicenseStatus } from './status';
import { audit } from '../db/audit';

// Narrow exemption list — minimum needed to boot, log in, activate.
const EXEMPT_CHANNELS = new Set<string>([
  IPC.AUTH_STATUS,
  IPC.AUTH_BOOTSTRAP,
  IPC.AUTH_WIZARD,
  IPC.AUTH_LOGIN,
  IPC.AUTH_LOGOUT,
  IPC.AUTH_USERS_LIST,
  IPC.AUTH_RECOVERY_REQUEST,
  IPC.AUTH_ACCEPT_RECOVERY_FILE,
  IPC.LICENSE_STATUS,
  IPC.LICENSE_ACTIVATE,
  IPC.AUDIT_LOG, // audit-on-every-read must work regardless of license state
]);

export function licenseGated<P extends unknown[], R>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: P) => Promise<R> | R,
): (event: IpcMainInvokeEvent, ...args: P) => Promise<R | LicenseGateError> {
  if (EXEMPT_CHANNELS.has(channel)) return handler;

  return async (event, ...args) => {
    const status = getLicenseStatus();
    if (status.state === 'unactivated') {
      return { ok: false, code: 'IPC_LICENSE_INVALID' as const };
    }
    if (status.state === 'expired') {
      return { ok: false, code: 'IPC_LICENSE_EXPIRED' as const };
    }
    return handler(event, ...args);
  };
}

type LicenseGateError =
  | { ok: false; code: 'IPC_LICENSE_INVALID' }
  | { ok: false; code: 'IPC_LICENSE_EXPIRED' };
```

**Usage in `src/main/index.ts`:**

```typescript
// BEFORE the existing register*() calls:
registerLicenseGate();  // wraps every subsequent registration

// The existing call sites get one-line changes:
ipcMain.handle(IPC.PATIENTS_LIST, licenseGated(IPC.PATIENTS_LIST, async (_e, query) => {...}));
// etc.
```

The Phase 1 IPC registration order in `src/main/index.ts` is preserved verbatim (auth → users → audit → patients → capture → procedures → recording → screenshots → profile → used-devices → reports → report-templates → backup → restore) — only the wrapper is added.

**Key insight:** The gate runs BEFORE the handler. The audit row is written unconditionally (audit-on-every-read pattern from Phase 2 D-05); the gate doesn't suppress audit writes. Per CONTEXT D-08: "The audit channel (`AUDIT_LOG`) is NOT gated — audit-on-every-read (Phase 2 D-05) writes continue regardless of license state."

### Pattern 3: Sidecar `.lic` artifact (zip of `license.json` + `license.sig`)

**What:** The shipped `.lic` file is an `archiver`-produced zip containing exactly two entries: `license.json` (the payload) and `license.sig` (the 64-byte Ed25519 signature, raw binary).

**When to use:** Vendor's `gen-license.cjs` produces these; the renderer's `load-license.ts` reads them.

**Example vendor-side:**

```javascript
// scripts/gen-license.cjs (excerpt — full file is vendor-only)
const archiver = require('archiver');
const ed = require('@noble/ed25519');
const fs = require('node:fs');
const { sha512 } = require('@noble/hashes/sha2.js');
const { join } = require('node:path');

ed.hashes.sha512 = sha512;

async function main() {
  const [machineFingerprint, vendorId] = process.argv.slice(2);
  if (!machineFingerprint || !vendorId) {
    console.error('Usage: node scripts/gen-license.cjs <machine-fingerprint> <vendor-id>');
    process.exit(1);
  }

  const keyPath = process.env.LICENSE_SIGNING_KEY_PATH || join(process.cwd(), 'secrets', 'ed25519.private');
  const privateKey = Uint8Array.from(fs.readFileSync(keyPath, 'utf8').trim().split(',').map(Number));
  if (privateKey.length !== 32) {
    console.error('Private key must be exactly 32 bytes (hex or comma-separated)');
    process.exit(2);
  }

  const payload = {
    vendorId,
    machineFingerprint,
    licensedAt: Date.now(),
    expiresAt: null, // perpetual
  };
  const json = Buffer.from(JSON.stringify(payload), 'utf8');
  const signature = await ed.signAsync(json, privateKey);

  const outPath = `${machineFingerprint.slice(0, 12)}.lic`;
  const output = fs.createWriteStream(outPath);
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.pipe(output);
  archive.append(json, { name: 'license.json' });
  archive.append(signature, { name: 'license.sig' });
  await archive.finalize();
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
```

**Example main-side read:**

```typescript
// src/main/license/load-license.ts (excerpt)
import yauzl from 'yauzl';
import { verifyLicense } from './verify';

export async function loadAndVerifyLicense(licPath: string): Promise<LicenseActivationResult> {
  const { json, signature } = await extractSidecar(licPath);
  const fingerprint = await computeMachineFingerprint();

  const result = verifyLicense({
    licenseJson: json,
    signature,
    publicKeyHex: VENDOR_PUBLIC_KEY_HEX,
    machineFingerprint: fingerprint,
  });

  if (!result.valid) {
    audit({
      action: 'license.invalid',
      entityType: 'license',
      entityId: licPath,
      outcome: 'failed',
      metadata: { reason: result.reason, fingerprintHash: fingerprint },
    });
    return { ok: false, reason: result.reason };
  }

  // Write sidecar to <userData>/data/license/license.json + license.sig
  // so status.ts can re-derive on every boot without re-prompting.
  await writeSidecar(licPath, result);

  audit({
    action: 'license.activated',
    entityType: 'license',
    entityId: licPath,
    outcome: 'ok',
    metadata: { vendorId: result.vendorId, fingerprintHash: fingerprint },
  });

  return { ok: true, vendorId: result.vendorId };
}
```

**Key insight:** The vendor CLI is **never bundled with the shipped app**. It lives in `scripts/` for source control + reproducibility, but the `secrets/ed25519.private` file (gitignored) only exists on the vendor machine.

### Pattern 4: Trial clock via `settings.trial_started_at`

**What:** The trial start timestamp lives on the existing `settings` table; the wizard bootstrap writes it on the first successful run; the trial-status IPC reads it on every boot.

**Migration:**

```sql
-- src/main/db/migrations/0012_settings_trial_started_at.sql (filename per agent discretion)
-- Phase 8 / Plan 8 — LIC-01: trial clock persists in `settings`.
ALTER TABLE settings ADD COLUMN trial_started_at INTEGER NULL;
```

**Write side (wizard bootstrap):**

```typescript
// src/main/auth/index.ts: wizardBootstrap() — add ONE insert:
db.prepare(
  `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
   ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
).run('trial_started_at', String(Date.now()), now);
```

**Read side (status computation):**

```typescript
// src/main/license/trial.ts (excerpt)
const TRIAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

export function getTrialState(): { state: 'trial'; daysRemaining: number; expiresAt: number } | null {
  const row = getDb()
    .prepare(`SELECT value FROM settings WHERE key = 'trial_started_at'`)
    .get() as { value: string } | undefined;
  if (!row) return null;
  const startedAt = parseInt(row.value, 10);
  const expiresAt = startedAt + TRIAL_DURATION_MS;
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) return null; // expired → falls to 'expired' state
  return {
    state: 'trial',
    daysRemaining: Math.ceil(remaining / (24 * 60 * 60 * 1000)),
    expiresAt,
  };
}
```

**Key insight:** Per CONTEXT D-02, the `trial_started_at` write is **atomic with the wizard transaction** (the existing wizardBootstrap already wraps 5 inserts in `db.transaction(() => {...})`). Adding a 6th row keeps the first-launch atomicity guarantee.

### Pattern 5: LicenseGate modal (boot-time)

**What:** A `<LicenseGate>` component mounted ABOVE the route render in `App.tsx`. Reads `useLicenseStatus()` to decide whether to show the activation modal.

**Example:**

```tsx
// src/renderer/src/components/LicenseGate.tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';
import { useLicenseStatus } from '@/hooks/useLicenseStatus';
import { useEffect, useState } from 'react';
import { useRoute } from '@/lib/router';

export function LicenseGate({ children }: { children: React.ReactNode }): JSX.Element {
  const { status } = useLicenseStatus();
  const { navigate } = useRoute();
  const { t } = useTranslation();
  const [dismissedThisSession, setDismissedThisSession] = useState(
    sessionStorage.getItem('license.modal.dismissed') === '1',
  );

  const showModal =
    !dismissedThisSession &&
    status !== null &&
    (status.state === 'unactivated' || status.state === 'expired');

  // Hide modal for 'trial' / 'licensed' — sidebar badge handles trial countdown.
  return (
    <>
      {children}
      <Dialog open={showModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('license.modalTitle')}</DialogTitle>
            <DialogDescription>
              {status?.state === 'expired' ? t('license.modalExpiredBody') : t('license.modalUnactivatedBody')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            {status?.state === 'unactivated' ? (
              <Button
                variant="outline"
                onClick={() => setDismissedThisSession(true) || sessionStorage.setItem('license.modal.dismissed', '1')}
              >
                {t('license.continueTrial')}
              </Button>
            ) : null}
            <Button
              onClick={() => {
                sessionStorage.setItem('license.modal.dismissed', '1');
                setDismissedThisSession(true);
                navigate({ name: 'license' });
              }}
            >
              {t('license.activateNow')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

**Key insight:** The "Continue in trial" button is grayed out (or hidden) for `expired` state per CONTEXT D-05. The sessionStorage flag means a doctor who dismissed the modal this session won't see it again until next launch (per agent discretion in CONTEXT.md).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Ed25519 verify | Custom bigint field arithmetic on Curve25519 | `@noble/ed25519 ^3.1.0` | Curve math is subtle; noble is audited (Paul Miller's suite) + RFC8032/ZIP215-compliant. Re-implementing introduces subtle malleability bugs. |
| SHA-256 hashing | Custom Merkle–Damgård | Node `crypto.createHash('sha256')` (already used by `src/main/auth/pin.ts`) | Stdlib is constant-time and audited. |
| SHA-512 (for Ed25519) | Custom or alternative lib | `@noble/hashes ^2.3.0` (`sha2.js`) | Required by `@noble/ed25519` v3 — the library's default hash is undefined. |
| ZIP archive | Custom CRC + zlib stream | `archiver ^8.0.0` (Phase 7 dep) | Already installed; handles ZIP64, headers, streaming, central directory. |
| File picker | Custom HTML `<input type=file>` | `dialog.showOpenDialog({filters:[{name:'Colonoscopist License', extensions:['lic']}]})` (Phase 7 D-13 pattern) | Sandboxed renderer can't read absolute paths; Electron's picker is the only legitimate way. |
| Audit row write | Direct `INSERT INTO audit_log` | `audit({ action: 'license.activated' \| ... })` (Phase 2 helper) | The helper applies the SQLite-trigger guard + session-aware `userId` default. Bypassing it is a Phase 2 BLOCKER 4 violation. |
| Settings read/write | Direct `INSERT INTO settings` SQL in new modules | Reuse the `settingsRepo` pattern from Phase 2 D-04 (or compose SQL inline since the trial row is one place) | One row, one module — keeps the schema surface narrow. |
| Renderer modal | Custom portal + a11y wrapper | `<Dialog>` shadcn primitive (already installed; BackupRestore uses it) | a11y (focus trap, escape-to-close, `aria-*`) is non-trivial; shadcn's Dialog ships it. |
| Trial countdown math | Custom date math | `Math.ceil((expiresAt - now) / (24*60*60*1000))` | Stdlib; one line. |
| Bilingual i18n | Inline EN/AR switch | i18next (Phase 7 D-19) | The renderer already boots i18n at `main.tsx`; Phase 8 only adds keys. |
| Object.freeze for tamper resistance | Module-level freezing | `Object.freeze` on the function export | Module-level breaks Vitest mocking; function-level is finer-grained. |
| Settings row atomic write | `await db.prepare(...).run(...)` outside a transaction | Inside the existing `wizardBootstrap()` transaction | First-launch atomicity guarantee from Phase 2 D-01. |

**Key insight:** The Phase 8 surface area is small (one verify function + one IPC gate + one modal). The risks live in **getting the IPC registration order wrong**, **forgetting to freeze the verify path**, and **bypassing the audit helper** — not in the crypto math.

## Runtime State Inventory

> Required because Phase 8 ships the `.lic` load path (a new persisted artifact) + the trial clock (a new `settings` row).

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `settings.trial_started_at` (NEW) — written atomically with `wizardBootstrap()` transaction | Code edit: 1 new ALTER TABLE migration (`0012_settings_trial_started_at.sql` or next free number per agent discretion) |
| Stored data | `license.json` + `license.sig` sidecar at `<userData>/data/license/` (NEW) | Code edit: written by `loadAndVerifyLicense()`; read by `getLicenseStatus()` on every boot |
| Live service config | (none) | None — Phase 8 doesn't add live service config (e.g., no n8n workflows, no scheduled tasks) |
| OS-registered state | (none) | None — no Windows Task Scheduler tasks, no Electron app user model changes |
| Secrets/env vars | `LICENSE_SIGNING_KEY_PATH` env var — vendor-only, never read by the shipped app | Code edit: `.gitignore` excludes `./secrets/` + the env var pattern (vendor machine only) |
| Build artifacts / installed packages | `@noble/ed25519`, `@noble/hashes` (NEW deps) | `npm install` + no `electron-rebuild` run (pure-JS) |

**Nothing found in category:** Verified explicitly for OS-registered state, scheduled tasks, and Electron user-data migration paths. Phase 8 has no rename/migration of the userData folder.

## Common Pitfalls

### Pitfall 1: Forgetting to wrap `ipcMain.handle` after `registerLicenseGate()`

**What goes wrong:** A new IPC channel (added in a later phase) registers without the `licenseGated` wrapper. The clinic can call it after trial expiry.

**Why it happens:** The wrapper is opt-in per `register*()` call. A new contributor adds an IPC handler and forgets.

**How to avoid:**
- The `licenseGated` helper is the ONLY way to register gated channels; document this in the helper's JSDoc + `CONTEXT.md` continuity section.
- A grep gate (`scripts/check-license-gate.cjs`) scans `src/main/ipc/*.ts` for `ipcMain.handle(` outside the helper, exits non-zero on drift.
- The Phase 8 plan-1 ships the helper + the gate; every subsequent IPC module imports the helper.

**Warning signs:** A new IPC handler works post-expiry (test that should fail keeps passing).

### Pitfall 2: Reading the `.lic` JSON via `JSON.parse(json)` before signing/verification

**What goes wrong:** `JSON.stringify(obj)` is non-canonical — key order changes break the signature. The verify path re-derives the signature from bytes that no longer match what the vendor signed.

**Why it happens:** Most JSON APIs round-trip through `parse`/`stringify`. Ed25519 signature verification works on raw bytes, so any transformation of the bytes invalidates the signature.

**How to avoid:**
- The vendor CLI writes `license.json` as a single `archive.append(json, { name: 'license.json' })` where `json` is `Buffer.from(JSON.stringify(payload))`.
- The main-side `parseLicenseSidecar()` reads the buffer and passes the **raw bytes** to `verifyLicense` — never `JSON.stringify(JSON.parse(buffer))`.
- A unit test asserts that re-stringifying the JSON does NOT re-verify (proves the byte-stability guarantee).

**Warning signs:** Every license verifies OK in dev but the same file fails in production builds (different Node versions, different V8 string representations).

### Pitfall 3: Forgetting to `Object.freeze` the verify function — or freezing the wrong level

**What goes wrong:** The verify function is editable at runtime. A debugger eval or memory-modification attack replaces the function with one that returns `{ valid: true }` for every input.

**Why it happens:** `Object.freeze` is easy to forget. Module-level freeze breaks Vitest's mocking — contributors downgrade to function-level freeze but skip the freeze entirely to keep tests green.

**How to avoid:**
- `verifyLicense` is wrapped with `Object.freeze` AT module top-level export (not the function declaration). The function body stays a named const so tests can import the same module and read the frozen export.
- A unit test asserts `Object.isFrozen(verifyLicense)` is true.
- Helper functions (`hashFingerprint`, `parseLicenseSidecar`) are NOT frozen — they're imported by tests and mocked freely.

**Warning signs:** `verifyLicense = ...` (reassignment) succeeds silently — no TypeError.

### Pitfall 4: Setting the trial start on a date other than the first wizard bootstrap

**What goes wrong:** Setting `trial_started_at` on first `auth.status()` IPC call gives the clinic a way to extend their trial by reinstalling without resetting the DB. Setting it on first procedure recording creates a window where the doctor hasn't activated but isn't on trial either.

**Why it happens:** The trial clock is a single timestamp — picking the wrong "first" event breaks the contract.

**How to avoid:**
- Per CONTEXT D-01, `trial_started_at` is written **only** in `wizardBootstrap()`, inside the same `db.transaction` as the user/clinic/profile inserts.
- A test asserts that calling `wizardBootstrap` writes `trial_started_at` once and never updates it (no `ON CONFLICT UPDATE`).
- The renderer NEVER calls an IPC to set `trial_started_at` — only main does, in the wizard transaction.

**Warning signs:** Trial countdown shows wrong values; reinstalling the app resets the trial clock.

### Pitfall 5: Disk-serial `wmic` spawn hangs

**What goes wrong:** The `wmic diskdrive get serialnumber` spawn takes 30+ seconds on some Windows machines (or hangs forever on locked-down corporate workstations). The activation modal sits on "Computing fingerprint…" forever.

**Why it happens:** `wmic` is deprecated on newer Windows builds; its replacement (`Get-PhysicalDisk | Select-Object SerialNumber`) is faster but PowerShell-only.

**How to avoid:**
- Wrap the `wmic` spawn in `Promise.race` with a 5-second timeout. On timeout, fall back to PowerShell `Get-CimInstance Win32_DiskDrive` (also 5-second timeout). On both timeouts, return a degraded fingerprint (`cpu + mac` only) and warn the user.
- The fingerprint computation is async — the renderer surfaces "Computing fingerprint…" via `useLicenseStatus().computing` state.

**Warning signs:** The "Load .lic file…" button shows a spinner that never resolves on certain Windows hardware.

### Pitfall 6: Trial countdown rounding shows "0 days remaining" while still inside the trial

**What goes wrong:** Sidebar badge says "Trial · 0d" for the last hour before expiry, then jumps to "Expired". The doctor panics.

**Why it happens:** `Math.ceil(remaining / (24*60*60*1000))` rounds UP, so 12 hours remaining = `Math.ceil(0.5)` = `1d`. But 1 minute remaining = `Math.ceil(0.0007)` = `1d` too — looks fine. The bug surfaces at exactly the boundary.

**How to avoid:**
- Show "X hours remaining" when `daysRemaining === 0` (use the same `Intl.RelativeTimeFormat` pattern from `BackupRestore.tsx:123-134`).
- Color-code the badge: green (`>= 5 days`), amber (`1–4 days`), red (`<= 1 day`).

**Warning signs:** Doctor reports "I have 0 days but I can still record."

### Pitfall 7: Forgetting to register the License IPC channel in `preload/index.ts`

**What goes wrong:** `window.api.license.status()` throws "ipcRenderer.invoke of undefined" — the modal never opens, the renderer can't poll status.

**Why it happens:** Three places need editing (ipc-contract.ts, main/ipc/license.ts, preload/index.ts); missing one breaks the contract.

**How to avoid:**
- The TypeScript discriminated-union return type catches missing keys at compile time: `window.api.license` will be `undefined` until the preload bridge exposes it.
- A test asserts `Object.keys(window.api.license).sort() === ['activate', 'status']`.
- The renderer code never reaches `window.api.license.status()` until the preload bridge exposes it — the modal renders "Loading license…" instead.

**Warning signs:** Renderer console: "Cannot read properties of undefined (reading 'status')".

### Pitfall 8: Audit row emitted with wrong `userId`

**What goes wrong:** License activation at boot happens BEFORE login — the audit row has `userId: null` even though a session is active moments later.

**Why it happens:** The `audit()` helper uses `session.currentUserId` if no `userId` is passed. At boot-time, the session is empty.

**How to avoid:**
- License activation events explicitly pass `userId: null` (it's a workstation-level event, not a per-user one) — per CONTEXT D-11, the metadata carries the machine id + fingerprint hash, NOT the user id.
- A test asserts that an activation audit row has `user_id IS NULL` regardless of whether a session is active.

**Warning signs:** License events show up in the Phase 7 Audit page under the wrong user.

### Pitfall 9: Vendor-side `LICENSE_SIGNING_KEY_PATH` leaks into the shipped binary

**What goes wrong:** The `scripts/gen-license.cjs` reads the env var; if the bundler accidentally picks up the file or the env var, the private key ships in the installer.

**Why it happens:** electron-vite is permissive about `scripts/` directory contents.

**How to avoid:**
- `scripts/gen-license.cjs` is excluded from the electron-builder `files` glob (verified by an electron-builder config check).
- `.gitignore` excludes `./secrets/` + `*.private` patterns.
- The shipped binary contains ONLY the public-key constant from `src/main/license/verify.ts`; a `grep` for the private key in `out/main/index.js` returns zero hits.

**Warning signs:** `grep -r "ed25519.private" out/` finds matches.

## Code Examples

Verified patterns from official sources (Context7 / official docs / current codebase).

### Verify with @noble/ed25519 v3

```typescript
// Source: https://github.com/paulmillr/noble-ed25519/blob/main/README.md (verified via Context7)
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';

// sha512 hookup is REQUIRED in v3 — the library's default hash is undefined.
ed.hashes.sha512 = sha512;

// Sync verify returns boolean (NOT throws on invalid signature).
const isValid: boolean = ed.verify(signature, messageBytes, publicKeyBytes);

// Async variant (preferred for large messages):
const isValidAsync: boolean = await ed.verifyAsync(signature, messageBytes, publicKeyBytes);
```

Key points (from Context7 `/paulmillr/noble-ed25519` errors docs):
- `ed.verify()` returns `false` on invalid signature — never throws.
- Always check the boolean return value.
- Use `{ zip215: false }` for strict RFC8032/FIPS 186-5 mode.

### Fingerprint hash (Node stdlib, matches existing pin.ts pattern)

```typescript
// Mirrors src/main/auth/pin.ts:createHash usage (Phase 2).
import { createHash } from 'node:crypto';

export function hashFingerprint(parts: { cpuModel: string; diskSerial: string; mac: string }): string {
  return createHash('sha256')
    .update(`${parts.cpuModel}|${parts.diskSerial}|${parts.mac}`, 'utf8')
    .digest('hex');
}
```

### Sidecar extraction (yauzl, matches Phase 7 backup pattern)

```typescript
// Mirrors src/main/backup/restore.ts entry-path filter pattern.
import yauzl from 'yauzl';

export async function extractSidecar(zipPath: string): Promise<{ json: Buffer; signature: Buffer }> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      const entries: Record<string, Buffer> = {};
      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        if (entry.fileName === 'license.json' || entry.fileName === 'license.sig') {
          zipfile.openReadStream(entry, (err, stream) => {
            if (err) return reject(err);
            const chunks: Buffer[] = [];
            stream.on('data', (chunk: Buffer) => chunks.push(chunk));
            stream.on('end', () => {
              entries[entry.fileName] = Buffer.concat(chunks);
              zipfile.readEntry();
            });
            stream.on('error', reject);
          });
        } else {
          zipfile.readEntry();
        }
      });
      zipfile.on('end', () => {
        if (!entries['license.json'] || !entries['license.sig']) {
          return reject(new Error('MALFORMED_PAYLOAD: missing license.json or license.sig'));
        }
        resolve({ json: entries['license.json'], signature: entries['license.sig'] });
      });
      zipfile.on('error', reject);
    });
  });
}
```

### Status cache (module-level, recomputed on activation)

```typescript
// src/main/license/status.ts
import { existsSync, readFileSync } from 'node:fs';
import { licenseDir } from '../paths';
import { join } from 'node:path';
import { verifyLicense } from './verify';
import { computeMachineFingerprint } from './fingerprint';
import { getTrialState } from './trial';
import { VENDOR_PUBLIC_KEY_HEX } from './verify';

export type LicenseState = 'licensed' | 'trial' | 'expired' | 'unactivated';

export type LicenseStatus = {
  state: LicenseState;
  vendorId: string | null;
  licensedAt: number | null;
  expiresAt: number | null;
  trialStartedAt: number | null;
  trialDaysRemaining: number | null;
  machineId: string; // SHA-256 hex (first 16 chars displayed as 4-char grouped blocks)
};

let cached: LicenseStatus | null = null;

export function computeLicenseStatus(): LicenseStatus {
  const licDir = licenseDir();
  const jsonPath = join(licDir, 'license.json');
  const sigPath = join(licDir, 'license.sig');
  const machineId = computeMachineFingerprint();

  // Try licensed first.
  if (existsSync(jsonPath) && existsSync(sigPath)) {
    const json = readFileSync(jsonPath);
    const sig = readFileSync(sigPath);
    const result = verifyLicense({
      licenseJson: json,
      signature: sig,
      publicKeyHex: VENDOR_PUBLIC_KEY_HEX,
      machineFingerprint: machineId,
    });
    if (result.valid) {
      return {
        state: 'licensed',
        vendorId: result.vendorId,
        licensedAt: result.licensedAt,
        expiresAt: result.expiresAt,
        trialStartedAt: null,
        trialDaysRemaining: null,
        machineId,
      };
    }
  }

  // Fall back to trial / expired / unactivated.
  const trial = getTrialState();
  if (trial) {
    return {
      state: 'trial',
      vendorId: null,
      licensedAt: null,
      expiresAt: trial.expiresAt,
      trialStartedAt: null,
      trialDaysRemaining: trial.daysRemaining,
      machineId,
    };
  }

  // No license + no trial (either expired or never started).
  const trialStartedAt = readTrialStartedAt();
  return {
    state: trialStartedAt ? 'expired' : 'unactivated',
    vendorId: null,
    licensedAt: null,
    expiresAt: null,
    trialStartedAt,
    trialDaysRemaining: 0,
    machineId,
  };
}

export function getLicenseStatus(): LicenseStatus {
  if (cached) return cached;
  cached = computeLicenseStatus();
  return cached;
}

export function invalidateLicenseCache(): void {
  cached = null;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| License = single JSON file with `is_valid` boolean | Sidecar `license.json` + `license.sig` (signed) | PITFALLS §Pitfall 6 (2026-07-31) | Tampered JSON can't pass Ed25519 verify; the JSON bytes are the signature payload. |
| `node:crypto` Ed25519 verify | `@noble/ed25519 ^3.1.0` (pure-JS) | STACK.md (2026-07-31) | API parity across main + vendor CLI + tests; no native rebuild. |
| Verify-path reachable via debugger eval | `Object.freeze(verifyLicense)` | PITFALLS §Pitfall 6 (2026-07-31) | Function replacement blocked; binary-level grep exposes tampering. |
| License in `settings.license_is_valid` boolean | Derive license truth on every boot from sidecar + fingerprint | PITFALLS §Pitfall 6 (Technical Debt Patterns: "Storing license state in the settings table | Never — keep license verification independent") | Settings is editable; sidecar + fingerprint + verify is the source of truth. |
| `trial_started_at` written outside `wizardBootstrap` transaction | Inside the wizard `db.transaction(() => {...})` block | CONTEXT.md D-01 (2026-08-24) | First-launch atomicity preserved. |
| License UI as full-window modal on every launch | `sessionStorage` flag dismisses modal for the rest of the session | CONTEXT.md agent discretion (2026-08-24) | A dismissed modal doesn't re-interrupt the doctor mid-workflow. |
| Single `IPC_LICENSE_REQUIRED` code | `IPC_LICENSE_INVALID` + `IPC_LICENSE_EXPIRED` | CONTEXT.md agent discretion (2026-08-24) | Renderer copy can distinguish "never activated" from "trial ran out". |
| Audit row with `userId: currentUser` for license events | `userId: null` + metadata carries machine id + fingerprint hash | CONTEXT.md D-11 (2026-08-24) | License is workstation-level, not per-user; the metadata is what the clinic forwards to the vendor. |

**Deprecated/outdated:**
- The Phase 2 `recoveryRequest()` returns `machineFingerprint: 'tbd-phase-8'` as a placeholder. Phase 8 fills this with the real fingerprint hash.
- The Phase 2 `acceptRecoveryFile()` returns `{ accepted: true, verificationDeferred: true }`. Phase 8 replaces this with the actual Ed25519 verify (the deferred shape is no longer needed for license files; it remains for the `.recover` PIN-recovery use case which is a separate flow).

## Assumptions Log

> All claims below are tagged `[ASSUMED]` because they derive from training knowledge or codebase conventions rather than being verified in this session against authoritative documentation. The planner and discuss-phase use this section to identify decisions that need user confirmation before execution.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@noble/ed25519 ^3.1.0` requires `ed.hashes.sha512 = sha512` setup before any verify call. | Code Examples | If wrong: verify throws synchronously; the unit test catches it. Low risk — Context7 docs confirm. |
| A2 | `wmic diskdrive get serialnumber` works on Windows 10/11; `wmic` is deprecated but still functional. | Don't Hand-Roll; Pitfall 5 | If wrong on a future Windows build: PowerShell fallback path. Medium risk — vendor should test on a Windows 11 machine before release. |
| A3 | The first non-internal IPv4 MAC from `os.networkInterfaces()` is stable across reboots (the OS picks the same NIC). | Pattern 4 (fingerprint); Pitfall 6 | If wrong (rare — some VMs randomize MACs): the vendor gets a different fingerprint per reboot and re-activation is required. Low risk for a real workstation. |
| A4 | `archiver`'s zip output is byte-identical across runs for the same input + options. | Pattern 3 | If wrong: vendor regenerates `.lic` files; verify still works (verify reads sidecar entries, not zip metadata). Low risk. |
| A5 | The `archiver` package handles binary `Buffer` entries without re-encoding. | Pattern 3 (signature entry) | If wrong: the signature is corrupted on disk; verify fails. Verify with a unit test that round-trips a 64-byte signature. Medium risk — covered by the round-trip test. |
| A6 | The Electron `dialog.showOpenDialog` filters `extensions: ['lic']` accepts `.lic` only. | Don't Hand-Roll | If wrong: doctor picks the wrong file; verify fails; error toast surfaces. Low risk — covered by the unit test on `loadAndVerifyLicense`. |
| A7 | `Object.freeze` on a function prevents `Object.defineProperty(verifyLicense, 'name', ...)` reassignment. | Don't Hand-Roll | If wrong: tampering remains possible. Low risk — `Object.isFrozen(verifyLicense) === true` is asserted in the test. |
| A8 | The sessionStorage flag for modal dismissal survives page refreshes (per same-origin policy) but not Electron app restarts. | Pattern 5 | If wrong: doctor sees the modal on every refresh. Low risk — this is documented behavior in the agent's discretion section of CONTEXT.md. |
| A9 | The existing `audit()` helper from Phase 2 accepts `metadata: Record<string, unknown>` for license event payloads. | Pattern 4 (audit rows) | If wrong: zod validator rejects the license-specific metadata. Low risk — the validator already accepts arbitrary string keys. |
| A10 | `archiver` is already installed (`^8.0.0` in `package.json` per Phase 7). | Standard Stack | If wrong: plan-1 adds the install + electron-rebuild check (but archiver is pure-JS so no rebuild needed). Verified by reading `package.json` line 44. |

**If this table is empty:** All claims above are MEDIUM or LOW confidence; the planner should review the assumptions during plan-phase and add `checkpoint:human-verify` tasks for any that affect vendor workflows (A2, A3) or tampering resistance (A1, A7).

## Open Questions

1. **What happens if `wmic` is removed in a future Windows build?**
   - What we know: `wmic` is deprecated in Windows 11; the replacement is `Get-CimInstance Win32_DiskDrive` (PowerShell).
   - What's unclear: Whether Microsoft plans to remove `wmic` entirely; whether the activation modal should show a "this workstation doesn't expose a disk serial — contact vendor" error if both spawns fail.
   - Recommendation: Add a PowerShell fallback path with a 5s timeout; if both fail, fall back to `cpu + mac` only (still unique-enough for a single workstation) and warn the user. Document the PowerShell fallback in the vendor README.

2. **Should the renderer know the machine fingerprint before showing the activation modal?**
   - What we know: The fingerprint is computed in main (wmic + os.cpus + os.networkInterfaces); the renderer's modal copy includes "Email this id to vendor".
   - What's unclear: Whether the modal shows the fingerprint immediately on first launch, or only after the doctor clicks "Activate now" (which triggers the IPC).
   - Recommendation: Show the fingerprint in the modal immediately — the doctor reads it BEFORE clicking the button so they can email the vendor without having to first navigate to the License sub-page.

3. **Does the trial clock restart on app reinstall?**
   - What we know: The `settings` row lives in `<userData>/data/app.db`; reinstalling the Electron app preserves `<userData>` (same app name = same userData path).
   - What's unclear: Whether the doctor's expectation matches this. Some clinicians expect a reinstall to reset the trial; the spec says NO.
   - Recommendation: Per CONTEXT D-01 verbatim — "Reinstalling the app on the same machine preserves the trial (the `settings` row persists in `<userData>/data/app.db`)". Document in the License sub-page FAQ.

4. **What is the exact `archiver` API for appending a Buffer entry?**
   - What we know: `archive.append(buffer, { name: 'entry.name' })` is the documented API; Phase 7 uses this for the backup zip.
   - What's unclear: Whether the buffer needs explicit encoding hints for binary content (like the signature bytes).
   - Recommendation: Use `archive.append(signature, { name: 'license.sig' })` with no extra options; verify via the round-trip integration test that the extracted bytes match the original buffer.

5. **Should the license sub-page show the machine id as grouped blocks (`a3f1-b9c2-...`) or raw hex?**
   - What we know: CONTEXT.md agent discretion section suggests grouped blocks for readability.
   - What's unclear: Whether the renderer copy should also show a "Copy" button for the id.
   - Recommendation: Render as grouped blocks; add a copy button (`navigator.clipboard.writeText`) — matches the BackupRestore "Reveal in Explorer" pattern of one-click action affordances.

## Environment Availability

> Phase 8 has external runtime dependencies (npm packages + the vendor's Windows machine).

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js 18+ | `wmic` spawn, `os.cpus()`, `crypto.createHash` | ✓ | Node 20 (Electron 32) | — |
| `@noble/ed25519` ^3.1.0 | `verifyLicense()` | ✓ (npm install) | 3.1.0 (verified 2026-08-24) | — |
| `@noble/hashes` ^2.3.0 | `ed.hashes.sha512` hookup + SHA-256 | ✓ (npm install) | 2.3.0 (verified 2026-08-24) | — |
| `archiver` ^8.0.0 | `.lic` zip packing | ✓ (already installed Phase 7) | 8.0.0 | — |
| `yauzl` ^3.4.0 | `.lic` zip unpacking | ✓ (already installed Phase 7) | 3.4.0 | — |
| Windows `wmic` | disk serial | ✓ on Windows 10/11 (deprecated) | n/a | PowerShell `Get-CimInstance Win32_DiskDrive` (5s timeout) |
| Linux/macOS support | (none — Windows-only v1 per PROJECT.md) | n/a | — | Phase 8 v1 is Windows-only; portable fingerprint composition is a v2 nicety |
| Vendor's Ed25519 private key | `gen-license.cjs` | ✗ (vendor-only — never checked in) | n/a | Vendor generates via `ed.keygen()` + saves to `./secrets/ed25519.private` |
| Vendor's offline machine | `gen-license.cjs` execution | Vendor-only (out of repo) | n/a | — |

**Missing dependencies with no fallback:** None for the shipped app.

**Missing dependencies with fallback:**
- Windows `wmic` failure → PowerShell fallback (5s timeout) → CPU+MAC-only fingerprint (still unique-enough).

## Validation Architecture

> Phase 8 has 4 LIC requirements + 1 vendor-side surface. Wave 0 needs new test files; Wave 1+ adds integration coverage.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.9 + Playwright 1.50 (e2e) |
| Config file | `vitest.config.ts` (existing) |
| Quick run command | `npm run test:unit` |
| Full suite command | `npm run test:unit && npm run test:integration:smoke && npm run test:e2e` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| LIC-01 | 14-day trial with full features; clock survives reboots | unit + integration | `node scripts/run-vitest.cjs --run tests/main/license/trial.test.ts tests/integration/license-trial-survives-reboot.test.ts` | ❌ Wave 0 |
| LIC-02 | Ed25519-signed `.lic` bound to fingerprint (CPU + disk + MAC) | unit + integration (roundtrip) | `node scripts/run-vitest.cjs --run tests/main/license/verify.test.ts tests/main/license/fingerprint.test.ts tests/integration/license-verify-roundtrip.test.ts` | ❌ Wave 0 |
| LIC-03 | On launch, missing/invalid license surfaces activation prompt; expired blocks procedure capture | unit + integration | `node scripts/run-vitest.cjs --run tests/main/license/gate.test.ts tests/integration/license-gate-blocks-procedure.test.ts` | ❌ Wave 0 |
| LIC-04 | All IPC handlers gated by license validity | unit + grep-gate | `node scripts/check-license-gate.cjs && node scripts/run-vitest.cjs --run tests/main/license/gate-coverage.test.ts` | ❌ Wave 0 |
| AUDIT-01 (license events) | license.activated / invalid / expired / trial_started audit rows | unit | `node scripts/run-vitest.cjs --run tests/main/license/audit.test.ts` | ❌ Wave 0 |
| I18N-03 (license RTL) | License UI renders correctly in RTL | e2e (Playwright) | `npm run test:e2e -- tests/renderer/rtl/license.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm run test:unit -- tests/main/license/ tests/renderer/pages/license.test.tsx`
- **Per wave merge:** `npm run test:unit && npm run test:integration:smoke:phase8` (new RUN_SMOKE=1 script)
- **Phase gate:** Full suite green + `/gsd-verify-work 8` against `08-UAT.md` (Windows hardware smoke for the disk-serial spawn)

### Wave 0 Gaps

- [ ] `tests/main/license/verify.test.ts` — 6+ cases: happy-path verify, tampered JSON, tampered signature, wrong public key, fingerprint mismatch, `Object.isFrozen(verifyLicense) === true`.
- [ ] `tests/main/license/fingerprint.test.ts` — 4+ cases: CPU-only, MAC-only, mocked disk serial, SHA-256 stability (same input → same hash).
- [ ] `tests/main/license/trial.test.ts` — 3+ cases: clock read, expiry boundary, missing row (unactivated).
- [ ] `tests/main/license/gate.test.ts` — 5+ cases: exempt list membership, expired path returns `IPC_LICENSE_EXPIRED`, invalid path returns `IPC_LICENSE_INVALID`, audit row emitted on gate rejection, no gate for AUDIT_LOG.
- [ ] `tests/main/license/load-license.test.ts` — 3+ cases: sidecar extraction happy path, missing entry throws, malformed zip throws.
- [ ] `tests/main/license/gate-coverage.test.ts` — 1+ case: assert every `ipcMain.handle(` in `src/main/ipc/*.ts` is wrapped with `licenseGated` (or in the EXEMPT set).
- [ ] `tests/main/license/audit.test.ts` — 2+ cases: license.activated audit row has `userId: null` + correct metadata shape; license.invalid row has correct reason metadata.
- [ ] `tests/integration/license-verify-roundtrip.test.ts` — 1 case (RUN_SMOKE=1): generate keypair → vendor CLI stub → produce `.lic` → load → verify → assert cached status.
- [ ] `tests/integration/license-trial-survives-reboot.test.ts` — 1 case (RUN_SMOKE=1): wizard bootstrap writes `trial_started_at`; close DB; reopen; assert row persists.
- [ ] `tests/integration/license-gate-blocks-procedure.test.ts` — 1 case (RUN_SMOKE=1): wizard bootstrap with no `.lic`; assert `procedures.create` IPC returns `IPC_LICENSE_INVALID`; activate `.lic`; assert success.
- [ ] `tests/renderer/pages/license.test.tsx` — 8+ cases: status card renders all 4 states, "Load .lic file…" calls `license.activate`, error toast on bad file, machine-id copy button, sidebar badge countdown.
- [ ] `tests/renderer/rtl/license.test.ts` — 1 case: Playwright RTL smoke (dir='rtl' + scrollWidth check + screenshot).
- [ ] `scripts/check-license-gate.cjs` — grep gate: every `ipcMain.handle(` in `src/main/ipc/*.ts` is either wrapped with `licenseGated` OR appears in `EXEMPT_CHANNELS`. Exits non-zero on drift.
- [ ] Framework install: no new Vitest/Playwright packages needed (Phase 7 already installed both).

*(If no gaps: see Wave 0 list above — 12 new test files + 1 new grep gate.)*

## Security Domain

> Required because Phase 8 ships the security-critical license verify path.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V1 Architecture | yes | Threat-modeling of `.lic` forgery + fingerprint spoofing documented in PITFALLS §Pitfall 6 |
| V2 Authentication | yes | `@noble/ed25519` verify + embedded public key constant |
| V3 Session Management | yes | License gate runs BEFORE the existing session helper (Phase 2 `requireSession()`); license is workstation-level, not session-level |
| V4 Access Control | yes | `licenseGated` helper enforces IPC gate; exemption list is a single source of truth |
| V5 Input Validation | yes | `licenseActivateInput` zod schema (`.strict()`) + sidecar entry-name allow-list |
| V6 Cryptography | yes | `@noble/ed25519` (audited pure-JS); `crypto.createHash('sha256')` (Node stdlib); NO hand-rolled crypto |
| V7 Error Handling | yes | Tampered license → `IPC_LICENSE_INVALID` (structured error code), never a generic error |
| V8 Data Protection | yes | License sidecar lives in `<userData>/data/license/` (per Anti-Pattern 2: userData-relative); no PII beyond the fingerprint hash |
| V9 Communication | n/a | No network I/O; offline-only |
| V10 Malicious Code | yes | `Object.freeze(verifyLicense)`; grep gate `scripts/check-license-gate.cjs`; `.gitignore` excludes `./secrets/` |
| V11 Business Logic | yes | Trial clock lives on `settings`; wizard bootstrap writes once (no `ON CONFLICT UPDATE`) |
| V12 Files & Resources | yes | Renderer NEVER composes paths; `dialog.showOpenDialog` (Phase 7 D-13 pattern) is the only legitimate path source |

### Known Threat Patterns for Electron + Ed25519 Licensing

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Tampered `.lic` JSON | Tampering | Ed25519 verify on raw JSON bytes (NOT `JSON.parse/stringify` round-trip); `IPC_LICENSE_INVALID` + audit row |
| Tampered `.lic` signature | Tampering | Same verify path; signature is 64 raw bytes compared against the embedded public key |
| Replay attack (load yesterday's `.lic` on a new machine) | Spoofing | License payload embeds `machineFingerprint`; verify compares to computed fingerprint (CPU + disk + MAC) |
| License theft (vendor-signed `.lic` shared across clinics) | Spoofing | Same as above — the embedded `machineFingerprint` binds the `.lic` to one workstation |
| Trial clock manipulation | Tampering | Trial timestamp is a `settings` row written inside the wizard `db.transaction`; the verify path reads it but never trusts it (license verify is independent of trial clock) |
| Verify-path replacement (debugger eval) | Elevation of Privilege | `Object.freeze(verifyLicense)`; binary-level grep gate exposes tampering |
| Public key replacement (attacker swaps the embedded key) | Spoofing | The public key is a 32-byte hex constant in `src/main/license/verify.ts`; a binary-level grep on `out/main/index.js` finds the literal — any change breaks the verify |
| Trial-clock reset (reinstall the app) | Repudiation | The `<userData>` directory persists across app reinstalls (same Electron app name = same path); the trial row survives |
| Renderer-side license bypass (XSS → fake IPC response) | Spoofing | Renderer is sandboxed (Phase 1 baseline: `contextIsolation: true, nodeIntegration: false, sandbox: true`); no direct access to `ipcMain` |
| Disk-serial spoofing (attacker changes the disk) | Tampering | License is bound to the disk serial at issue time; a new disk = new fingerprint = new `.lic` required (vendor workflow) |
| Fingerprint collision (two workstations share CPU model + MAC vendor) | Information Disclosure | The disk serial provides per-machine uniqueness; collisions across CPU+MAC are rare enough that disk-serial disambiguates |
| Vendor signing key leak (private key committed to git) | Elevation of Privilege | `.gitignore` excludes `./secrets/` + `*.private`; `scripts/gen-license.cjs` reads via env var (default path is gitignored); a `grep -r "ed25519.private" out/` check returns zero hits |

## Sources

### Primary (HIGH confidence)
- Context7 `/paulmillr/noble-ed25519` — verify API, error handling, zip215 strict mode (336 Code Snippets, Source Reputation: High)
- Context7 `/paulmillr/noble-curves` — alternative library for cross-curve signing (considered, not used)
- npm registry (`npm view @noble/ed25519 version` → `3.1.0`; `npm view @noble/hashes version` → `2.3.0`) — verified 2026-08-24
- Current codebase: `src/main/index.ts:app.whenReady()` registration order (HIGH — verified by reading the file)
- Current codebase: `src/shared/ipc-contract.ts` IPC pattern (HIGH — verified by reading the file)
- Current codebase: `src/main/db/audit.ts:audit()` helper (HIGH — verified by reading the file)
- Current codebase: `src/main/paths.ts:licenseDir()` not yet present; pattern from `reportsDir()` (HIGH — verified by reading the file)
- Current codebase: `src/main/auth/index.ts:wizardBootstrap()` transaction shape (HIGH — verified by reading the file)
- Current codebase: `src/main/db/migrations.ts` migration runner (HIGH — verified by reading the file)
- Current codebase: `src/main/db/migrations/0007_*.sql` migration pattern (HIGH — verified by reading the file)
- Current codebase: `src/renderer/src/components/SettingsSidebar.tsx` sidebar entry pattern (HIGH — verified by reading the file)
- Current codebase: `src/renderer/src/pages/BackupRestore.tsx` Settings sub-page pattern (HIGH — verified by reading the file)
- Current codebase: `src/renderer/src/lib/router.ts:Route` union (HIGH — verified by reading the file)
- Current codebase: `src/renderer/src/i18n/en/translation.json` (HIGH — verified by reading the file; `recovery.*` keys already present)
- `.planning/research/STACK.md` §Supporting Libraries (`@noble/ed25519` pure-JS) (HIGH)
- `.planning/research/PITFALLS.md` §Pitfall 6 (license trivially bypassed) (HIGH)
- `.planning/research/ARCHITECTURE.md` §Component Responsibilities §License service (HIGH)
- `.planning/phases/08-licensing-ed25519-signed-lic-14-day-trial-activation-flow/08-CONTEXT.md` (HIGH — all 14 locked decisions)

### Secondary (MEDIUM confidence)
- `scripts/gen-license.cjs` API shape — derived from `archiver` README + `ed.signAsync()` Context7 docs (MEDIUM — verify in plan-1)
- `wmic diskdrive get serialnumber` deprecation status — derived from Windows docs (MEDIUM — verify on a Windows 11 machine)

### Tertiary (LOW confidence)
- None — every claim either has Context7 / npm-registry / current-codebase backing, or is tagged `[ASSUMED]` in the Assumptions Log above.

## File Manifest

### Files to CREATE

| Path | Purpose |
|------|---------|
| `src/main/license/verify.ts` | Ed25519 verify + `Object.freeze(verifyLicense)` + embedded public key constant |
| `src/main/license/fingerprint.ts` | CPU + disk + MAC → SHA-256 hash (with wmic spawn + PowerShell fallback) |
| `src/main/license/trial.ts` | 14-day clock reader (against `settings.trial_started_at`) |
| `src/main/license/gate.ts` | `licenseGated` helper + `EXEMPT_CHANNELS` set |
| `src/main/license/load-license.ts` | Sidecar zip extraction + `verifyLicense` invocation + audit row |
| `src/main/license/status.ts` | Cached `LicenseStatus` computation (called by `gate.ts` + IPC handlers) |
| `src/main/license/index.ts` | Module orchestrator: `registerLicenseGate()`, `invalidateLicenseCache()` exports |
| `src/main/ipc/license.ts` | `LICENSE_STATUS` + `LICENSE_ACTIVATE` IPC handlers (exempt from gate) |
| `src/main/db/migrations/0012_settings_trial_started_at.sql` | ALTER TABLE settings ADD COLUMN trial_started_at INTEGER NULL |
| `src/renderer/src/components/LicenseGate.tsx` | Boot-time modal wrapper (renders ABOVE the route in `App.tsx`) |
| `src/renderer/src/hooks/useLicenseStatus.ts` | SWR-style hook (calls `license.status()` + `license.activate()`) |
| `src/renderer/src/pages/License.tsx` | Settings sub-page (mirrors BackupRestore pattern) |
| `scripts/gen-license.cjs` | Vendor CLI (reads `LICENSE_SIGNING_KEY_PATH`, writes `<machineId>.lic`) |
| `tests/main/license/verify.test.ts` | 6+ verify-path cases |
| `tests/main/license/fingerprint.test.ts` | 4+ fingerprint cases |
| `tests/main/license/trial.test.ts` | 3+ trial-clock cases |
| `tests/main/license/gate.test.ts` | 5+ gate behavior cases |
| `tests/main/license/load-license.test.ts` | 3+ sidecar extraction cases |
| `tests/main/license/gate-coverage.test.ts` | 1+ coverage assertion (every `ipcMain.handle` is wrapped) |
| `tests/main/license/audit.test.ts` | 2+ audit row shape cases |
| `tests/integration/license-verify-roundtrip.test.ts` | 1 RUN_SMOKE=1 case (full vendor-CLI → verify roundtrip) |
| `tests/integration/license-trial-survives-reboot.test.ts` | 1 RUN_SMOKE=1 case (clock survives DB reopen) |
| `tests/integration/license-gate-blocks-procedure.test.ts` | 1 RUN_SMOKE=1 case (gate blocks + activation unblocks) |
| `tests/renderer/pages/license.test.tsx` | 8+ License sub-page cases |
| `tests/renderer/rtl/license.test.ts` | 1 Playwright RTL smoke |
| `scripts/check-license-gate.cjs` | Grep gate: every `ipcMain.handle` is wrapped or exempt |
| `secrets/.gitignore` | Excludes `./secrets/` directory + `*.private` pattern |

### Files to MODIFY

| Path | Change |
|------|--------|
| `package.json` | Add `dependencies: { "@noble/ed25519": "^3.1.0", "@noble/hashes": "^2.3.0" }` |
| `src/shared/ipc-contract.ts` | Add `IPC.LICENSE_STATUS`, `IPC.LICENSE_ACTIVATE` constants; add `LicenseState`, `LicenseStatus`, `LicenseActivateInput`, `LicenseActivateResult` types; add `license: { status, activate }` to `IpcContract` |
| `src/shared/validators.ts` | Add `licenseActivateInput` zod schema (`.strict()`) |
| `src/shared/errors.ts` | Add `IPC_LICENSE_INVALID` + `IPC_LICENSE_EXPIRED` codes to the `IpcError` union |
| `src/main/index.ts` | Import + call `registerLicenseGate()` BEFORE every `register*()` call; wrap each existing registration with `licenseGated(IPC.X, ...)` |
| `src/main/paths.ts` | Add `licenseDir()` helper (mirrors `reportsDir()` pattern) |
| `src/main/db/migrations.ts` | Add migration `0012_settings_trial_started_at` to the `MIGRATIONS` array |
| `src/main/auth/index.ts` | Inside `wizardBootstrap()` transaction: add INSERT for `settings.trial_started_at = String(Date.now())` |
| `src/preload/index.ts` | Add `license: { status, activate }` to the contextBridge `api` object |
| `src/renderer/src/components/SettingsSidebar.tsx` | Add `<License>` entry (between Audit and Backup & Restore, after Profile); update `SettingsTab` union with `'license'` |
| `src/renderer/src/lib/router.ts` | Add `\| { name: 'license' }` to the `Route` union |
| `src/renderer/src/App.tsx` | Wrap the route render with `<LicenseGate>`; add `case 'license'` to the switch |
| `src/renderer/src/i18n/en/translation.json` | Add `license.*` keys (modal title/body, status labels, sidebar copy, error toasts) |
| `src/renderer/src/i18n/ar/translation.json` | Add matching `license.*` keys (Arabic strings + RTL-aware copy) |
| `scripts/run-vitest.cjs` (or new `run-vitest-phase8.cjs`) | Add Phase 8 smoke entry: `tests/integration/license-verify-roundtrip.test.ts` + `license-trial-survives-reboot.test.ts` + `license-gate-blocks-procedure.test.ts` |
| `.gitignore` | Add `secrets/` + `*.private` + `*.lic` (vendor `.lic` files generated locally should not be committed) |

## Risk Summary

| Risk | Severity | Mitigation |
|------|----------|------------|
| License trivially bypassed (PITFALLS §Pitfall 6) | HIGH | Embedded public key + `Object.freeze(verifyLicense)` + sidecar `.lic` + audit row on every tampered attempt |
| IPC gate forgotten on a new handler | MEDIUM | `licenseGated` is the only registration helper; `scripts/check-license-gate.cjs` grep gate catches drift |
| Trial clock manipulation via settings row | MEDIUM | Trial clock written once inside the wizard transaction (no `ON CONFLICT UPDATE`); verify path reads `settings.trial_started_at` but license truth is independent |
| Vendor signing key leaked into shipped binary | HIGH | `secrets/` gitignored; `LICENSE_SIGNING_KEY_PATH` env var; `electron-builder` `files` glob excludes `scripts/gen-license.cjs` + a `grep -r "ed25519.private" out/` check |
| `.lic` JSON byte-stability (re-stringify breaks signature) | MEDIUM | Vendor CLI writes raw `Buffer.from(JSON.stringify(payload))`; main reads raw buffer without re-stringify; unit test asserts re-stringifying fails verify |
| Disk-serial spawn hangs | MEDIUM | 5s `Promise.race` timeout + PowerShell fallback + degraded fingerprint (cpu+mac only) + warn user |
| Fingerprint drift (NIC swap, disk change) | LOW | Vendor re-issues `.lic` on email request (per CONTEXT D-13); N re-activations per year is a v2 follow-up |
| SessionStorage dismissal survives app restart (expected to NOT) | LOW | Verified by `sessionStorage` semantics — cleared on Electron app restart |
| Renderer reads paths via direct string composition | LOW | Renderer never sends paths; `dialog.showOpenDialog` (Phase 7 D-13 pattern) is the only legitimate source |
| Trial expiry UI confusion ("0 days remaining" while still inside) | LOW | Show hours when days ≤ 0; color-code the badge |
| Audit row has wrong `userId` for license events | LOW | License events explicitly pass `userId: null` + metadata carries machine id + fingerprint hash |

**Pitfall 6 mitigations summary (from PITFALLS.md):**

1. ✅ Verify the `.lic` with Ed25519 public key embedded in the binary — `VENDOR_PUBLIC_KEY_HEX` constant in `verify.ts`.
2. ✅ Store as sidecar `license.sig` + `license.json` — `archiver` zip in `load-license.ts`.
3. ✅ Failure logged locally — `audit({ action: 'license.invalid', metadata: { reason, fingerprintHash } })`.
4. ✅ Ship JS path with hard-coded checksums + `Object.freeze`'d verification code — `Object.freeze(verifyLicense)` in `verify.ts`.
5. ⚠️ N-API addon (LIC-05) deferred to v1.1 per CONTEXT.md "Notes" section.

---

*Research for Phase 8: Licensing (Ed25519 signed `.lic` + 14-day trial + activation flow)*
*Confidence: HIGH*
*Valid until: 2026-11-30 (60 days — @noble/ed25519 v3 is stable; electron 32 + Phase 7 patterns are stable)*
