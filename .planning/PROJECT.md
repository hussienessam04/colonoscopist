# Colonoscopist

## What This Is

Colonoscopist is a Windows desktop application that lets small clinics record, document, and report on colonoscopy procedures entirely on one workstation — no cloud, no PACS, no internet required for daily use. It turns a generic USB capture card (EasyCap, HDMI capture, webcam) into a procedure-room tool that captures video, marks findings as screenshots, and emits a clinic-branded PDF report per patient.

## Core Value

A gloved, busy doctor can hit Record on a procedure, capture findings as screenshots during the case, and walk out with a signed PDF report ready for the patient — with zero internet dependency between recordings.

## Business Context

- **Customer**: Small single-doctor / multi-doctor private clinics in the GCC market that need a self-contained procedure-recording system without vendor lock-in or monthly fees.
- **Revenue model**: One-time perpetual license per workstation (Ed25519-signed, offline-activated). 14-day trial, no card required.
- **Success metric**: A clinic goes from install → first signed PDF report without calling support; license activation requires zero online check.
- **Strategy notes**: GCC-first (English + Arabic with full RTL). Postponed: native tamper-resistant addon (N-API) for later sprint; out of scope for v1: cloud, PACS/DICOM, vendor SDKs, AI polyp detection, mobile companion.

## Requirements

### Validated

- **SCRN-01, SCRN-02** — Mid-procedure + post-recording screenshot capture + persistent JPEG store (validated in Phase 5, 05-01 / 05-04).
- **REV-01, REV-02, REV-03, REV-04** — Procedure Review screen with pause markers + clickable screenshot timeline + post-recording capture + non-destructive trim with restore (validated in Phase 5, 05-01 / 05-02 / 05-03 / 05-04).
- **LIC-01** — 14-day trial with full features, no card required. `wizardBootstrap` writes `trial_started_at` inside `db.transaction` + cache invalidation post-commit (validated in Phase 8, 08-02 / 08-08).
- **LIC-02** — Ed25519-signed `.lic` bound to machine fingerprint (CPU + disk serial + MAC, SHA-256). `verifyLicense` is `Object.freeze`d at module export; tampered payloads (byte-flip, wrong signature, fingerprint mismatch) are rejected with `IPC_LICENSE_INVALID` (validated in Phase 8, 08-01 / 08-04 / 08-07).
- **LIC-03** — Activation prompt + expired trial gates the entire UI via boot-time `<LicenseGate>` modal (route-aware: exempts wizard + login routes per Plan 08-09). Renderer handles gate rejection via `safeInvoke` + `<EmptyStateCard>` instead of white-screen (validated in Phase 8, 08-05 / 08-09 / 08-10 / 08-11 / 08-12).
- **LIC-04** — All `ipcMain.handle` registrations gated through `licenseGated` helper with narrow `EXEMPT_CHANNELS` (AUTH_* + LICENSE_* + AUDIT_*); every gate rejection writes a `license.gate_rejected` audit row before returning `{ok: false, code: 'IPC_LICENSE_*'}`. Runtime guard test + grep-gate CI script lock the invariant (validated in Phase 8, 08-03 / 08-06 / 08-10).
- **I18N-03** — License UI strings bilingual (EN + AR, 34 keys including the new `license.emptyState*` keys from Plan 08-10); sidebar badge renders in Arabic; RTL layout clean (validated in Phase 8, 08-05 / 08-10, UAT Test 10).

### Active

- **AUTH** — PIN-based multi-doctor login, per-doctor profiles (EN+AR name, clinic info, signature image, clinic logo), full audit trail of every access.
- **PATIENTS** — Patient CRUD (name, DOB, gender, MRN, phone, notes), search by name and MRN.
- **CAPTURE** — Auto-enumerate DirectShow video devices, picker UI, live preview, record mp4, in-procedure screenshots, procedure timer, mid-procedure quick notes, graceful handling when a device disconnects.
- **REVIEW** — Video playback with scrubber, clickable screenshot timeline, additional screenshots from playback, basic trim (cut start/end).
- **REPORTS** — @react-pdf/renderer based PDF generation auto-filled with active doctor's clinic info and signature, fields for findings / diagnosis / recommendations, attach selected screenshots from the procedure, draft + finalized states.
- **SEARCH** — Search patient history by name, MRN, date range, and doctor.
- **SETTINGS** — Device dropdown, quality presets (SD analog 720x480 / HD digital 1920x1080 / custom resolution+fps), storage path, user management, backup/restore (zip of `data/`).
- **AUDIT** — Audit log covering every login, every procedure view, every edit.
- **I18N** — English + Arabic, full RTL throughout the UI, language per doctor.

### Out of Scope

- Cloud sync, multi-clinic central admin — offline-only mandate, single workstation per license.
- Vendor SDKs (Olympus, Pentax, etc.) — generic DirectShow capture only; deliberate avoidance of vendor lock-in.
- DICOM / PACS integration — no medical-imaging interop required for v1.
- Insurance, billing, scheduling — workflow focus is record+report, not clinic management.
- Speech-to-text dictation — out of scope for v1; can be added later if requested.
- Mobile companion app — Windows desktop only for v1.
- AI polyp detection — clinical decision-support not in scope; no regulatory path for that in v1.
- Advanced video editing beyond basic start/end trim — NLE features (transitions, titles, multitrack) are not in scope.

## Context

- **Market**: GCC (Gulf Cooperation Council) region — primary language Arabic with full RTL; English secondary. Bilingual doctor profiles required.
- **Hardware reality**: clinics use a mix of EasyCap-style SD analog capture (720×480 NTSC/PAL), HDMI/DVI digital capture cards (1920×1080), and generic webcams. The app must enumerate all of them and let the doctor pick.
- **Capture approach**: `navigator.mediaDevices.getUserMedia` for the live preview in the renderer (no native plugin, works with sandbox on); `ffmpeg-static` spawned as a child process to write the recorded mp4 to disk (ffmpeg handles the encode + container + DirectShow device selection robustly).
- **Local-first**: SQLite via `better-sqlite3` (synchronous, fast, simple to backup), PII encrypted with Electron `safeStorage`. The data folder under `userData` is the single source of truth; backup is a plain zip of `data/` (db + license + media).
- **No phone-home, ever**: license is an Ed25519-signed JSON bound to a machine fingerprint (CPU + disk serial + MAC, hashed) — reactivation only when hardware changes.

## Constraints

- **Tech stack (locked)**: electron-vite + React + TypeScript + Tailwind + shadcn/ui; `ffmpeg-static` as a child process; `better-sqlite3` for SQLite; `@react-pdf/renderer` for PDF; Ed25519-signed license files.
- **Security baseline (day 1)**: BrowserWindow `webPreferences` = `{ contextIsolation: true, nodeIntegration: false, sandbox: true, preload via contextBridge }`. No direct Node access in renderer — main-process IPC via a typed contract. `safeStorage` encrypts sensitive fields at rest.
- **Offline-only daily use**: app must boot, login, capture, review, and report with no network; the only network-touching step is license activation when loading a `.lic` file (which is also local file load).
- **Hardware support**: must work with EasyCap SD analog (720×480), HDMI/DVI HD digital (1920×1080), generic webcams — auto-enumerate via Electron `desktopCapturer` / `navigator.mediaDevices.enumerateDevices`.
- **License model**: 14-day trial with full features (no card), perpetual one-time, Ed25519-signed `.lic` file bound to a machine fingerprint, no online reactivation.
- **Timeline**: 8 sprints, ~1 week each, mapped to the milestones in the brief.
- **i18n parity**: both EN and AR shipped from day 1, full RTL throughout.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|--------|
| Generic DirectShow capture over vendor SDKs (Olympus, Pentax) | No vendor lock-in, single binary works across clinics, costs nothing in licensing. Lose: deep scope-control integration. Acceptable for v1. | — Pending |
| `ffmpeg-static` as a child process for recording vs. MediaRecorder API | MediaRecorder quality/control is browser-dependent and flaky for long procedures (2h+); ffmpeg gives predictable bitrate, container, and DirectShow device selection. Extra native binary. | — Pending |
| `better-sqlite3` (synchronous) over `node-sqlite3` / Prisma | Sync API is simpler for an Electron main process, no callback hell, fast for clinic-scale data, trivial to backup. Trade-off: blocking I/O — acceptable because operations are small. | — Pending |
| Ed25519-signed license file + machine fingerprint over online activation | GCC market has spotty internet, clinic owners are skeptical of cloud-tethered software, and you want zero phone-home. Cost: ops overhead of manually generating `.lic` files; gain: total autonomy for the customer. | — Pending |
| 14-day trial, no card, full features | Reduce friction for first-time evaluation in a trust-scarce market. Activation friction is "copy machine ID → email me → I email a file back". | — Pending |
| `@react-pdf/renderer` over LaTeX / HTML-to-PDF tools | Pure JS, no native deps, deterministic output, lets us use React components for report templates. Trade-off: limited CSS subset — acceptable for clinical reports. | — Pending |
| Pin-based login (no passwords) | Clinicians share workstations but rarely want password management friction; small N of users per workstation, audit trail compensates for low entropy. | — Pending |
| Tailwind + shadcn/ui for UI | Fast to build a clinical-feeling, high-contrast UI; shadcn components are copy-into-repo so we own the code. Trade-off: not Radix Material Design polish, but enough for a clinical tool. | — Pending |
| N-API tamper-resistant license check (later sprint) | v1 ships with a JS license check. Hardening is deferred so v1 can ship faster; it is explicitly on the roadmap (Phase 8). | — Pending |
| Backup = zip of `data/` (db + license + media) | No cloud, no service — the customer owns the backup. Easy to verify by unzipping. Restoring is also a zip extract. | — Pending |
| Screenshot frame source = canvas snapshot from `<video>`/`<img>` at capture time (not MJPEG-tee or one-shot ffmpeg `image2`) | Simplest implementation that satisfies both mid-procedure and post-recording entry points; reuses the same `captureScreenshot(source)` lib. Trade-off: live-preview feed needs to be present at capture time (already true since renderer renders it). | ✓ Validated in Phase 5 |
| Trim = `-ss before -i -c copy` (stream copy) with ±500ms accuracy | Faster than re-encode (no quality loss), but cuts may land a few hundred ms off from the doctor's intended handle. Doctor can fine-tune via drag handles. Trade-off accepted for v1; pixel-exact re-encode deferred. | ✓ Validated in Phase 5 |
| Media server = long-lived HTTP on `127.0.0.1:<random>` with `/media/` route + HTTP Range support | `<video>` can't load `file://` under contextIsolation; local HTTP serves the mp4 + Range requests for Chromium seek. Path-escape protection + random port prevent local-network access. | ✓ Validated in Phase 5 |
| `@noble/ed25519` v3 + `@noble/hashes` v2 used via dynamic `await import()` inside `_verifyLicense` | Both packages are pure ESM (`"type": "module"`); electron-vite's `externalizeDepsPlugin` keeps them external so the bundled CJS main emits `require()` calls that Node 24's CJS loader rejects with `ERR_REQUIRE_ESM`. Plan 08-07 fixed via function-scoped `await import()` (mirrors `src/main/backup/index.ts:52` archiver precedent). | ✓ Validated in Phase 8 (08-07) |
| `safeInvoke<T>(p) → Promise<T \| null>` centralized helper + `<EmptyStateCard>` for renderer-side gated-IPC failure handling (Plans 08-10/11/12) | Main-process gate returns `{ok: false, code: 'IPC_LICENSE_*'}` per Plan 03 documented intent; renderer-side discrimination was never implemented and 10+ pages + 1 hook would crash on gate rejection. Centralizing the discriminator makes the bug structurally impossible for new gated-IPC consumers. The EmptyStateCard renders "Open License settings" as the user-facing recovery path. | ✓ Validated in Phase 8 (08-10/11/12) |
| LicenseGate modal exempts `wizard` + `login` routes (Plan 08-09) | The wizard IS the path to start the trial; gating it with the activation modal is contradictory. Login is similarly pre-authentication. LicenseGate reads `useRoute()` and skips the modal for both routes. | ✓ Validated in Phase 8 (08-09) |
| `wizardBootstrap` calls `invalidateLicenseCache()` post-commit (Plan 08-08) | The license status cache was warmed at `app.whenReady()` before wizardBootstrap ran; without invalidation, the cache held stale `state: 'unactivated'` and the modal fired post-wizard. Mirrors `loadAndVerifyLicense` (`load-license.ts:117-119`) precedent. | ✓ Validated in Phase 8 (08-08) |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Business Context check — customer / revenue model / success metric still accurate?
4. Audit Out of Scope — reasons still valid?
5. Update Context with current state (clinic feedback, perf numbers, support load)

---
*Last updated: 2026-09-02 after Phase 8 completion (Licensing — 12/12 plans shipped [6 base + 6 gap-closure], UAT 10/10 pass, 5/5 LIC-01..04 + I18N-03 requirements validated)*
