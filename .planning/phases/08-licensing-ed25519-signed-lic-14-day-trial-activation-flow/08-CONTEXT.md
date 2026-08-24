# Phase 8: Licensing (Ed25519 signed `.lic` + 14-day trial + activation flow) - Context

**Gathered:** 2026-08-24
**Status:** Ready for planning

## Phase Boundary

License gating works end-to-end: 14-day trial with full features, Ed25519-signed `.lic` file activates the workstation, license verified on every launch, trial clock survives reboots, license gate lives at the IPC boundary (per LIC-04). Phase 8 ships the JS verify path; N-API tamper-resistant addon (LIC-05) is parked as a v1.1 hardening follow-up. The v1 JS verify path is the ship gate.

## Implementation Decisions

### Trial clock lifecycle

- **D-01:** Trial clock **starts on the first successful `auth.wizard-bootstrap`** (the first doctor creates their account — Phase 2 D-01 + D-04 verbatim). The `wizard_bootstrap_completed_at` timestamp is written to `settings.trial_started_at` on the first wizard run and never reset. Reinstalling the app on the same machine preserves the trial (the `settings` row persists in `<userData>/data/app.db`); a fresh DB starts a fresh 14-day window. Matches LIC-01 verbatim ("14-day trial with full features") and the offline-only mandate (no online trial clock). — **Reversibility:** **costly** — the trial clock column is referenced by every boot-time license check + every expiry UI; resetting it requires either a wipe of `settings.trial_started_at` or a manual `audit` row.
- **D-02:** Trial clock **lives on the existing `settings` table** as `trial_started_at INTEGER NULL` (Unix ms). Reuses Phase 2 D-04's `settings` key-value shape — no new table, no migration of structural consequence (column add is one ALTER). The `license_is_valid` boolean does **NOT** live on `settings` (per RESEARCH §Pitfall 6 — never trust an editable source for license truth); the verify path reads `license.sig` + `license.json` sidecar each boot and derives validity. — **Reversibility:** **reversible** — pure schema add on an existing table.

### Trial expiry behavior

- **D-03:** Trial expiry = **hard block per LIC-03 verbatim**. Once `trial_started_at + 14d < now` AND no valid `.lic` is loaded, the app surfaces a full-window "Activate / enter trial" modal AND the IPC gate blocks procedure capture (recording, screenshots, new reports, new patients). Read-only access to existing patient/report data still allowed — no data loss. The modal is dismissible once the user clicks "Activate" or "Continue in trial" (the latter is grayed out post-expiry). The activation modal also fires on first launch post-Phase-8-ship when `trial_started_at IS NULL` AND no `.lic` is loaded (the user lands directly in the modal, not the wizard). — **Reversibility:** **reversible** — IPC-gate exemption list narrows/widens; modal is renderer-only.

### License UI placement

- **D-04:** License lives on a **new `License` sub-page under SettingsHub** (same sidebar pattern as Phase 7 BackupRestore per D-13). Sidebar entry shows live status badge — "Trial · 11d remaining" / "Licensed · Perpétual" / "Expired" / "Not activated". Sub-page content: status card (machine id + trial clock + license summary if loaded) + "Load .lic file…" button (D-05) + audit-log link filtered to license events. — **Reversibility:** **reversible** — additive route + renderer surface.
- **D-05:** First-launch AND first-launch-after-expiry surfaces a **full-window modal** that points to the License sub-page (per LIC-03 "surfaces a clear activate / enter trial prompt" verbatim). The modal has two buttons: "Activate now" (jumps to the License sub-page) and "Continue in trial" (dismissable when trial is still active; grayed-out post-expiry). The modal is shown by `App.tsx` after `auth.status()` resolves and before any other route renders. — **Reversibility:** **reversible** — renderer surface only.
- **D-06:** Activation UX = **`dialog.showOpenDialog({filters:[{name:'Colonoscopist License', extensions:['lic']}]})`** (Phase 7 BackupRestore D-13 verbatim pattern). Single "Load .lic file…" button on the License sub-page → file picker → main reads the file → Ed25519 verify (D-08) → success/error toast + sidebar badge refreshes. No drag-drop, no paste-textbox; matches the Phase 7 IPC-pick-file pattern. — **Reversibility:** **reversible** — renderer button + main IPC handler.

### IPC gate scope (LIC-04)

- **D-07:** All `ipcMain.handle` registrations are wrapped in a **`licenseGated` helper** that returns `{ ok: false, code: 'IPC_LICENSE_INVALID' | 'IPC_LICENSE_EXPIRED' }` when the current license state is invalid/expired. The renderer reads `ok: false` as a hard "license invalid" signal (renders the activation modal). The helper is registered BEFORE every other IPC handler in `src/main/index.ts:app.whenReady()` (the existing registration order is preserved — auth → users → audit → patients → capture → procedures → recording → screenshots → profile → used-devices → reports → report-templates → backup → restore; each `register*()` call wraps its `ipcMain.handle` calls). — **Reversibility:** **costly** — every IPC handler registration changes shape; the helper must be added to every module's `register*()` call.
- **D-08:** IPC gate **exemption list** = the minimum needed to boot the app, log in, and activate a license: `AUTH_STATUS`, `AUTH_BOOTSTRAP`, `AUTH_WIZARD`, `AUTH_LOGIN`, `AUTH_LOGOUT`, `AUTH_RECOVERY_REQUEST`, `AUTH_ACCEPT_RECOVERY_FILE`, `LICENSE_STATUS`, `LICENSE_ACTIVATE`, `LICENSE_TRIAL_INFO`. Every other channel (patients.*, capture.*, procedures.*, recording.*, screenshots.*, profile.*, reports.*, etc.) requires a valid license. The audit channel (`AUDIT_LOG`) is NOT gated — audit-on-every-read (Phase 2 D-05) writes continue regardless of license state. — **Reversibility:** **reversible** — narrow exemption list is a constant in `src/main/license/gate.ts`; widening/narrowing is one line.

### License verify path (PITFALLS §Pitfall 6)

- **D-09:** License verify uses **`@noble/ed25519`** (pure-JS, no native dep, audited) per RESEARCH §STACK. The verify function is a single exported helper `verifyLicense({ licenseJson, signature, publicKey, machineFingerprint }): LicenseResult` that:
  1. Hashes the machine fingerprint from CPU + disk serial + MAC (LIC-02 verbatim).
  2. Re-derives the signature payload from the JSON bytes.
  3. Verifies with the embedded public key.
  4. Compares the bound fingerprint in the JSON payload to the computed one.
  The function is wrapped in `Object.freeze` per RESEARCH §PITFALLS §Pitfall 6 ("verification code frozen"). The Ed25519 public key is **embedded as a constant** in `src/main/license/verify.ts` (NOT loaded from disk — a binary-level grep on the build artifact would expose any tampered verify path). — **Reversibility:** **one-way** — the embedded public key is shipped with the binary; rotating it requires a re-release + every clinic re-activates.
- **D-10:** License file = **sidecar `license.sig` + `license.json`** per RESEARCH §PITFALLS §Pitfall 6 (not a single plaintext file). The `.lic` extension on the shipped artifact wraps both files (zip or tar). The verify path reads `license.sig` (raw 64-byte signature) + `license.json` (UTF-8 payload), re-derives the signature, and compares. Tampered JSON → signature mismatch → `IPC_LICENSE_INVALID`. Tampered `.lic` (signature file edited) → signature mismatch → `IPC_LICENSE_INVALID`. — **Reversibility:** **one-way** — the sidecar format is referenced by every boot-time verify.
- **D-11:** Every license activation (success OR failure) writes an **`audit_log` row** per AUDIT-01: `action: 'license.activated' | 'license.invalid' | 'license.expired' | 'license.trial_started'`, `entityType: 'license'`, `metadata: { machineId, fingerprintHash, vendorId, errorCode? }`. Tampered license attempts are visible in the Audit sub-page (Phase 7 D-05) so the clinic owner can see when an attempt was made (and forward the metadata to the vendor). — **Reversibility:** **reversible** — audit helper already in `src/main/db/audit.ts:audit()`.

### Machine fingerprint (LIC-02)

- **D-12:** Machine fingerprint = `SHA-256(CPU.model + diskSerial + MAC)` per LIC-02 verbatim. CPU via `os.cpus()[0].model` (Node stdlib); disk serial via Windows `wmic diskdrive get serialnumber` (spawn a one-shot child process, captured at activation time only — not on every boot); MAC via `os.networkInterfaces()` first non-internal IPv4 MAC. The fingerprint is computed once on activation request and **never recomputed** after the user clicks "Load .lic file…" — the user reads it from the License sub-page (D-04) and emails it to the vendor verbatim. — **Reversibility:** **costly** — the fingerprint composition is referenced by the verify path (D-09); changing the composition invalidates every issued `.lic`.

### Vendor tooling

- **D-13:** Vendor-side signing tool = **`scripts/gen-license.cjs`** per RESEARCH §ARCHITECTURE. Pure Node CLI: `node scripts/gen-license.cjs <machine-fingerprint> <vendor-id>` reads the private key from a path supplied via env var (`LICENSE_SIGNING_KEY_PATH`, defaults to `./secrets/ed25519.private`), produces `<machineId>.lic` (sidecar zip of `license.json` + `license.sig`), and writes it to stdout. The signing key is **NEVER checked into the repo** — `.gitignore` excludes `./secrets/` + the env var pattern. The vendor regenerates a new `.lic` on email request from the clinic (no automated reactivation flow in v1; LIC-06 v2). — **Reversibility:** **reversible** — CLI script is a build artifact; regenerating a `.lic` is one command.

### i18n parity

- **D-14:** Every new license UI string lands in **both `en/translation.json` AND `ar/translation.json`** from day 1 per Phase 7 D-24 parity check. License sub-page, activation modal, status badge, and toast messages all bilingual. RTL coverage verified by the existing Phase 7 Playwright RTL smoke harness (07-06). — **Reversibility:** **reversible** — translation key adds.

### the agent's Discretion

- Exact migration filename for `settings.trial_started_at` (recommend `0008_settings_trial_started_at.sql` — matches the existing `0008_*.sql` slot used by the MRN auto-serial quick task on 2026-08-12; agent picks the next free number).
- Exact wording of "Activate now" / "Continue in trial" buttons (per D-05) — agent picks from the Phase 7 translation keys; recommend matching the BackupRestore "Restore" / "Cancel" tone.
- Whether the trial-status sidebar badge shows day-remaining countdown (e.g., "Trial · 11d") or just a static "Trial" label — agent picks. Recommend day-remaining countdown (creates urgency without being noisy).
- IPC error code naming (`IPC_LICENSE_INVALID` vs `IPC_LICENSE_EXPIRED` vs unified `IPC_LICENSE_REQUIRED`) — agent picks. Recommend two distinct codes so the renderer can distinguish "you've never activated" from "your trial ran out" in the modal copy.
- Whether `LICENSE_TRIAL_INFO` IPC exists separately or folds into `LICENSE_STATUS` — agent picks. Recommend folding (`LICENSE_STATUS` returns `{ state: 'trial' | 'licensed' | 'expired' | 'unactivated', trialDaysRemaining?, licensedSince?, machineId }`).
- How the License sub-page machine-id is displayed (raw hex vs grouped 4-char blocks) — agent picks. Recommend grouped blocks for readability + copy-friendly.
- Whether the activation modal is dismissable on a per-session basis (sessionStorage flag) — agent picks. Recommend YES — a doctor who clicked "Continue in trial" should not see the modal again until the next launch or until expiry.
- Exact wording of the "license invalid, contact vendor" message (per RESEARCH §PITFALLS §Pitfall 6) — agent picks. Recommend: "This license file is invalid or tampered. Please email your machine ID to <vendor email> for a new license."
- Whether the `Object.freeze` is applied to the entire `src/main/license/verify.ts` module export or just the `verifyLicense` function — agent picks. Recommend the function-level freeze (finer-grained; the module's other helpers stay editable).

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements

- `.planning/ROADMAP.md` §Phase 8 — Goal, 6 success criteria (incl. "verification code path is `Object.freeze`'d to discourage tampering"), pitfall addressed (Pitfall 6), notes (N-API v1.1 follow-up)
- `.planning/REQUIREMENTS.md` §LIC-01, §LIC-02, §LIC-03, §LIC-04 — Traceability row maps these to Phase 8
- `.planning/PROJECT.md` §Key Decisions (Ed25519 row — "Ed25519-signed license file + machine fingerprint over online activation"), §Constraints (license model row, security baseline, offline-only mandate), §Out of Scope (online reactivation / phone-home — hard ban)
- `.planning/STATE.md` §Current Focus (Phase 8 last milestone of v1), §Phase 7 decisions (D-13 BackupRestore disabled placeholder pattern, D-14 i18next parity, D-26 BackupRestore sidebar entry)

### Technical research (stack, pitfalls, architecture)

- `.planning/research/STACK.md` §Supporting Libraries (`@noble/ed25519` — pure-JS, no native dep), §Alternatives (`@noble/ed25519` vs Node `crypto` Ed25519 — `Stick with @noble/ed25519 — pure-JS, same API in main and tests`), §What NOT to Use (no cloud license check), §Version Compatibility (better-sqlite3 rebuild note for the fingerprint spawn pattern)
- `.planning/research/PITFALLS.md` §Pitfall 6 (license trivially bypassed — Ed25519 verify with embedded public key; `license.sig` + `license.json` sidecar; never store `license_is_valid` in settings; `Object.freeze` the verify code path; log every tampered attempt locally), §Warning signs, §Patterns to avoid (`Storing license state in the settings table | Never — keep license verification independent`, `Hardcoding the Ed25519 private key in the repo | The signing key lives ONLY in the vendor's offline CLI`)
- `.planning/research/ARCHITECTURE.md` §Component Responsibilities §License service (loads + verifies Ed25519 signed `.lic` file; tracks trial clock; gates the UI; `src/main/license/index.ts`), §Recommended Project Structure (`src/main/license/{verify,fingerprint,trial}.ts` + `scripts/gen-license.cjs` vendor-side signer), §Internal Boundaries §"License verification ↔ every IPC | Wrap all `ipcMain.handle` registrations in a `license-gated` helper"
- `.planning/research/SUMMARY.md` §License section (delivers Ed25519 verify + trial clock + vendor `gen-license.cjs` + machine-id generator), §Phase 8 implications (machine fingerprint stability across NIC swaps — N re-activations per year deferred to LIC-06 v2)

### Phase 1–7 context (carry forward)

- `.planning/phases/01-scaffold/01-CONTEXT.md` — D-01..D-07 (security baseline + IPC pattern + native module rebuild; Phase 8 adds a single `@noble/ed25519` dep which is pure-JS — no rebuild needed)
- `.planning/phases/02-database-patient-audit-auth/02-CONTEXT.md` — D-04 (`settings` table key-value shape — Phase 8 adds `trial_started_at` column via D-02), D-05 (audit-on-every-read pattern — Phase 8 license activation events follow the same path)
- `.planning/phases/06-doctor-profile-report-editor-pdf-generation/06-CONTEXT.md` — D-05/D-06/D-07 (one report per procedure, draft/finalize state machine, audit-on-every-mutation — license audit events follow the same pattern)
- `.planning/phases/07-search-history-audit-ui-backup-restore-arabic-rtl/07-CONTEXT.md` — D-05/D-06/D-07/D-08 (Audit sub-page shape — Phase 8 license events surface there via filter), D-11/D-13/D-14/D-15 (BackupRestore sub-page pattern with disabled v1.1 placeholder — Phase 8 License sub-page reuses the same sidebar entry), D-19/D-20/D-24 (i18next + RTL + D-24 parity check — Phase 8 license strings are bilingual from day 1)

### Skills & procedures (how to ship Phase 8)

- `.opencode/skills/electron-vite/SKILL.md` — Three-process model; Phase 8 adds main-side license IPC + renderer License sub-page + preload bridge
- `.opencode/skills/electron-sqlite/SKILL.md` §Backup/restore flows (`PRAGMA wal_checkpoint(TRUNCATE)` reused for the disk-serial spawn pattern — capture before any DB write), §Migration runner (D-02 migration add)

### Existing utilities (reuse, don't reinvent)

- `src/main/db/audit.ts:audit()` — Phase 8 license activation events (D-11) write through the same audit helper
- `src/main/auth/session.ts:session.currentUserId` — Phase 8 license gate is a separate gate (NOT conflated with session); the IPC gate runs first, then the existing `session.currentUserId` checks apply
- `src/main/index.ts:app.whenReady()` registration order — Phase 8 license gate wraps every `register*()` call BEFORE the existing handlers (D-07); the canonical registration order is preserved
- `src/main/paths.ts:dataDir()` (Phase 2) — Phase 8 adds `licenseDir()` returning `<userData>/data/license/` for the sidecar files
- `src/main/window.ts:createMainWindow()` (Phase 1) — Phase 8 license modal uses the same `BrowserWindow` + contextBridge surface
- `src/renderer/src/i18n/{en,ar}/translation.json` (Phase 7) — Phase 8 extends with `license.*` keys; D-24 parity check covers the new keys
- `src/renderer/src/pages/SettingsHub.tsx` (Phase 3/7) — Phase 8 adds `License` entry to SettingsSidebar (D-04)
- `src/renderer/src/lib/router.ts:Route` (Phase 2) — Phase 8 adds `'license'; null` to the Route union
- `src/renderer/src/components/ui/{button,card,dialog,alert,tooltip}.tsx` (Phase 2/7) — Phase 8 License sub-page + modal reuse existing shadcn primitives (no new installs)

### Established Patterns

- **Typed IPC contract via contextBridge** — every renderer-callable method defined once in `src/shared/ipc-contract.ts`. Phase 8 extends with `LICENSE_STATUS`, `LICENSE_ACTIVATE` constants + `LicenseState`, `LicenseStatus` types.
- **One-way renderer → main for mutations, optimistic UI avoided** — license activation awaits IPC round-trip; sidebar badge refreshes on ack.
- **Audit-on-every-mutation** — `audit({ action: 'license.activated' | ..., entityType: 'license', metadata: { ... } })` for every Phase 8 event (D-11).
- **No `any` in IPC contracts** — TS strict mode continues; `LicenseStatus` is a discriminated union.
- **UserData-relative paths** — license sidecar files live under `<userData>/data/license/` resolved via `paths.ts:licenseDir()`.
- **Single main-process ffmpeg child per operation** — N/A for Phase 8 (no ffmpeg; the disk-serial spawn is a one-shot, awaited, not long-lived).
- **Inline status, no modal** — UX-Pitfalls table; the License sub-page status card is inline. The activation modal (D-05) is the only modal — it's a one-shot "first launch" prompt, not a per-action blocker.
- **shadcn primitives only** — Tailwind + shadcn; no new UI library. Existing primitives (button, card, dialog, alert, tooltip) cover Phase 8.
- **Migration per logical group** — single `0008_settings_trial_started_at.sql` (or next free number per agent's discretion) covers the `settings.trial_started_at` column add (D-02).
- **Two-directory model for restore** (Phase 7 D-14) — N/A for Phase 8 (no restore).
- **`Object.freeze` on security-critical code paths** — Phase 8 extends the pattern to `src/main/license/verify.ts:verifyLicense()` (D-09 + PITFALLS §Pitfall 6 verbatim).

### Integration Points

- `src/main/index.ts:app.whenReady()` — Phase 8 adds `registerLicenseGate()` BEFORE every existing `register*()` call; the gate wraps `ipcMain.handle` for every handler. The license IPC channels themselves (`LICENSE_STATUS`, `LICENSE_ACTIVATE`, `LICENSE_TRIAL_INFO`) are exempt from the gate (D-08).
- `src/main/license/{verify,fingerprint,trial,gate}.ts` (new) — `verify.ts` (Ed25519 verify + `Object.freeze` + embedded public key, D-09), `fingerprint.ts` (CPU + disk + MAC → SHA-256, D-12), `trial.ts` (14-day clock against `settings.trial_started_at`, D-01), `gate.ts` (the `licenseGated` helper + exemption list, D-07/D-08).
- `src/main/license/load-license.ts` (new) — reads the sidecar `.lic` (zip of `license.sig` + `license.json`), invokes `verifyLicense`, writes the audit row (D-11).
- `src/main/license/status.ts` (new) — computes the current `LicenseStatus` from the trial clock + the loaded `.lic` (the verify path is called once at boot and cached; status IPC reads the cached value).
- `src/preload/index.ts:api` — contextBridge surface; Phase 8 extends with `license.status`, `license.activate`, `license.trialInfo`.
- `src/main/db/migrations/` — adds migration for `settings.trial_started_at` column (D-02).
- `src/shared/ipc-contract.ts` — extend `IPC` constants + `IpcContract` interface + `LicenseState` discriminated union + `LicenseStatus` shape.
- `src/renderer/src/i18n/{en,ar}/translation.json` — extends with `license.*` keys (status, trial, expired, activate, machineId, etc.).
- `src/renderer/src/main.tsx` — adds `<LicenseGate>` wrapper that fires `license.status()` on boot and renders the activation modal (D-05) when state is `unactivated` OR `expired`.
- `src/renderer/src/pages/License.tsx` (new) — License sub-page with status card + machine-id display + "Load .lic file…" button (D-04/D-06).
- `src/renderer/src/pages/SettingsHub.tsx` (Phase 3/7) — adds `License` sub-page entry to SettingsSidebar.
- `src/renderer/src/lib/router.ts` — adds `'license'; null` to the Route union.
- `src/renderer/src/App.tsx` — adds `'license'` route case; activation modal lives ABOVE the route rendering (always visible when needed).

## Specific Ideas

- **Trial countdown in sidebar badge** ("Trial · 11d") — creates urgency without a modal-on-every-launch interrupt; matches the "GCC clinic distrust of vendor cloud" tone by being honest about remaining time.
- **Machine ID displayed in 4-char grouped blocks** (`a3f1-b9c2-7e4d-...`) for copy-friendly + readable — easier to dictate over the phone to vendor support.
- **Activation modal uses the existing `dialog.tsx` from Phase 2** — no new modal primitive; same component the BackupRestore confirm dialog uses (Phase 7 D-13 verbatim pattern).
- **License sub-page sidebar badge color-codes state** — green dot = Licensed; blue dot = Trial; red dot = Expired; gray dot = Unactivated. Matches the Phase 7 Audit page's filter chip styling.
- **`Object.freeze` on `verifyLicense` only**, not the whole module — finer-grained than module-level freeze; the helper functions (`hashFingerprint`, `parseLicenseSidecar`) stay editable for tests.
- **`audit_log` rows for license events show up in the Phase 7 Audit sub-page filter** — the existing filter already supports `entityType: 'license'` dropdown (Phase 7 D-05). No new audit UI needed.
- **`license_dir` lives under `<userData>/data/license/`** — sibling of `media/`, `profiles/`, `reports/`. The Phase 7 backup (D-09) captures this subtree automatically.
- **Vendor `gen-license.cjs` reads signing key from env var, not a hardcoded path** — vendor can rotate the key location without code change.
- **`license_activated` toast shows the vendor ID + license expiry** (perpétual has no expiry) — the doctor sees confirmation that the license is from a specific vendor without exposing the signing key.

## Deferred Ideas

- **N-API tamper-resistant license check (LIC-05)** — v2 requirement per REQUIREMENTS §v2 Licensing. Phase 8 ships the JS verify path; hardening via native addon is a v1.1 follow-up.
- **Re-activation allowance (LIC-06)** — v2 requirement. Phase 8 ships the basic "load new .lic" path that overwrites the old one; N re-activations per year for NIC/MAC changes is v1.1+ territory.
- **Online reactivation / phone-home** — hard ban per PROJECT §Out-of-Scope + REQUIREMENTS §Out-of-Scope. Phase 8 ships the offline `gen-license.cjs` vendor tool only.
- **Multi-clinic central license server** — out of scope per PROJECT §Out-of-Scope (each workstation is independent).
- **License server / cloud license check** — out of scope per REQUIREMENTS §Out-of-Scope ("Online reactivation / phone-home"). The verify path is fully offline.
- **Trial extension button in UI** — out of scope. Trial can only be extended by the vendor issuing a new `.lic` (no in-app extension).
- **Per-doctor license vs workstation-wide** — current scope is workstation-wide (LIC-02 verbatim — bound to machine fingerprint, not user). Per-doctor licensing is v2 if clinic demand materializes.
- **License transfer between workstations** — out of v1 scope. The vendor can re-issue on email request; the UI is the same "load new .lic" path.
- **Floating licenses (N concurrent seats)** — out of v1 scope per REQUIREMENTS §Out-of-Scope (single workstation per license).
- **License expiration reminder emails** — out of scope (online requirement); trial-end is communicated in-app via the sidebar badge countdown.

---

*Phase: 8-licensing-ed25519-signed-lic-14-day-trial-activation-flow*
*Context gathered: 2026-08-24*
