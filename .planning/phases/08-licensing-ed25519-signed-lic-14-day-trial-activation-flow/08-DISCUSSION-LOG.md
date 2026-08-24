# Phase 8: Licensing (Ed25519 signed `.lic` + 14-day trial + activation flow) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-24
**Phase:** 8-licensing-ed25519-signed-lic-14-day-trial-activation-flow
**Areas discussed:** Trial start trigger, Trial expiry behavior, License UI placement, Activation UX

---

## Trial start trigger

| Option | Description | Selected |
|--------|-------------|----------|
| First wizard bootstrap | Clock starts when `auth.wizard-bootstrap` succeeds. Ties the trial to the doctor's first commitment to the app. Clean semantics: no trial running on an uninstalled workstation. | ✓ |
| First launch ever (in settings) | Clock starts on first app boot ever — written to `settings` table on `app.whenReady()`. Survives reinstall of the same binary. Simple but starts before any user exists. | |
| First procedure recording | Clock starts when the first `recording.start` succeeds. Most user-driven — trial only counts when the doctor actually uses the app. Risk: silent long evaluation periods. | |
| First successful login | Clock starts on first `auth.login` success. Mid-ground — ties trial to actual session activity but doesn't require recording. | |

**User's choice:** First wizard bootstrap
**Notes:** Cleanest semantics — ties trial to the moment the doctor commits to the app. No trial running before any user exists.

---

## Trial expiry behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Hard block (LIC-03 verbatim) | Per LIC-03 verbatim — app surfaces 'activate / enter trial' prompt and BLOCKS procedure capture until resolved. Read-only access to existing patient/report data still allowed (no data loss). | ✓ (recommended) |
| Soft warning + capture disabled | Trial ended: shows banner on every screen but allows login + read-only patient/report browsing + audit + backup. Only procedure recording + screenshot capture are blocked. Less aggressive than full block. | |
| Graceful degrade (read + audit only) | Banner-only: all read paths still work, but no IPC that mutates clinical data (recording, screenshots, reports) is allowed. Strictest interpretation. Audit log continues to record license checks. | |

**User's choice:** "recomended" — interpreted as the verbatim recommendation (Hard block per LIC-03 verbatim). Read-only patient/report access preserved so the doctor doesn't lose visibility into existing data.
**Notes:** Strict reading of LIC-03. Read-only preservation matches the "no data loss" principle from PROJECT §Core Value.

---

## License UI placement

| Option | Description | Selected |
|--------|-------------|----------|
| SettingsHub sub-page (Phase 7 pattern) | New 'License' sub-page under SettingsHub (same sidebar pattern as Phase 7 BackupRestore per D-13). Sidebar entry shows live status badge (Trial · 11d / Licensed · Perpétual / Expired). Activation only via this page. | |
| SettingsHub sub-page + first-launch modal | SettingsHub sub-page (status + load .lic) PLUS a full-window modal on first launch (or first launch after expiry) that points to the sub-page. Combines discoverability + interruption. | ✓ (recommended) |
| Header bar status badge only | Status badge in the header bar (top-right, near language switcher per Phase 7) — always visible. Click opens the activation dialog inline. No new Settings sub-page needed. | |

**User's choice:** "recomended" — interpreted as the recommended hybrid (SettingsHub sub-page + first-launch modal). Matches LIC-03 verbatim ("surfaces a clear activate / enter trial prompt") AND the Phase 7 sidebar pattern.
**Notes:** Sub-page gives discoverability; modal gives interruption. Both are needed for the LIC-03 ship gate.

---

## Activation UX

| Option | Description | Selected |
|--------|-------------|----------|
| File picker dialog (Phase 7 pattern) | Electron `dialog.showOpenDialog({filters:[{name:'Colonoscopist License', extensions:['lic']}]})` per Phase 7 BackupRestore (D-13 verbatim). Single button 'Load .lic file…' → file picker → verify → show success/error toast. | ✓ |
| Drag-drop + file picker | Drag-and-drop zone on the License sub-page (accept .lic files) PLUS a fallback file-picker button. More discoverable but needs new renderer surface; same verify path either way. | |
| Paste base64 textbox | Textbox the doctor pastes the .lic contents into (vendor emails the file, doctor opens in Notepad, copies, pastes). Works even when the file picker is unavailable. | |

**User's choice:** File picker dialog (Phase 7 pattern)
**Notes:** Matches the Phase 7 BackupRestore D-13 verbatim pattern. Simplest implementation; same IPC pattern as `BACKUP_PICK_DESTINATION`.

---

## the agent's Discretion

- Migration filename for `settings.trial_started_at` (recommend `0008_settings_trial_started_at.sql` — matches the existing `0008_*.sql` slot used by the MRN auto-serial quick task; agent picks the next free number)
- Exact wording of "Activate now" / "Continue in trial" buttons (per D-05) — agent picks from Phase 7 translation keys
- Trial-status sidebar badge format (day-remaining countdown vs static label) — recommend countdown
- IPC error code naming (`IPC_LICENSE_INVALID` vs `IPC_LICENSE_EXPIRED` vs unified) — recommend two distinct codes
- Whether `LICENSE_TRIAL_INFO` IPC exists separately or folds into `LICENSE_STATUS` — recommend folding into `LICENSE_STATUS`
- Machine-id display format (raw hex vs grouped 4-char blocks) — recommend grouped blocks
- Activation modal dismissable on per-session basis (sessionStorage flag) — recommend YES
- "License invalid, contact vendor" message wording — agent picks
- `Object.freeze` scope (entire module vs just `verifyLicense` function) — recommend function-level freeze

## Deferred Ideas

- **N-API tamper-resistant license check (LIC-05)** — v2 requirement per REQUIREMENTS §v2 Licensing; Phase 8 ships the JS verify path.
- **Re-activation allowance (LIC-06)** — v2 requirement; N re-activations per year for NIC/MAC changes.
- **Online reactivation / phone-home** — hard ban per PROJECT §Out-of-Scope; vendor regenerates `.lic` on email request.
- **Multi-clinic central license server** — out of scope; each workstation is independent.
- **License server / cloud license check** — out of scope per REQUIREMENTS §Out-of-Scope.
- **Trial extension button in UI** — out of scope; vendor extends via new `.lic`.
- **Per-doctor license** — out of v1 scope; workstation-wide per LIC-02 verbatim.
- **License transfer between workstations** — out of v1 scope; vendor re-issues on email.
- **Floating licenses (N concurrent seats)** — out of scope per REQUIREMENTS §Out-of-Scope.
- **License expiration reminder emails** — out of scope (online requirement); trial-end is in-app via sidebar countdown.
