# Roadmap: Colonoscopist

**Project:** Colonoscopist — Windows desktop recorder/reporter for colonoscopy procedures (Electron + offline, GCC small clinics).
**Phases:** 8 vertical-slice phases (MVP mode).
**Granularity:** Standard (5–8 phases, 3–5 plans each).
**Generated:** 2026-07-31.

---

## Phase 1 — Scaffold (electron-vite + security baseline + native rebuild)

**Goal:** Boot a hardened Electron app shell with React + TypeScript + Tailwind + shadcn/ui; lock down the renderer security baseline; prove `better-sqlite3` builds and runs under Electron's Node ABI via `postinstall` rebuild.
**Mode:** mvp
**Requirements covered:** AUTH-01 (foundation), AUTH-04, SET-03, SET-04
**Success criteria:**

1. App boots with `contextIsolation: true, nodeIntegration: false, sandbox: true` verified in code.
2. `electron-vite` rebuild on `npm install` succeeds for `better-sqlite3` against the current Electron Node ABI; a startup log line records the binding version.
3. Renderer can call a single typed IPC method (`auth:status`) end-to-end through preload + contextBridge.
4. Tailwind + shadcn/ui render a placeholder login screen.
5. `tsconfig` strict mode passes with no `any` in IPC contracts.

**Pitfalls addressed:** Pitfall 4 (native module ABI mismatch).
**Notes:** This phase does not deliver any user-facing feature beyond "the app starts". The deliverable is the foundation every later phase builds on. `SET-03` (storage path) ships at scaffolding time so the `userData` resolution is wired from day 1.

---

## Phase 2 — Database + Migrations + Patient CRUD + Audit + Auth

**Goal:** Ship the data layer (SQLite + migrations + WAL), patient CRUD + search, audit log infrastructure, and the PIN-based auth flow with rate limiting and audit integration.
**Mode:** mvp
**Requirements covered:** AUTH-01, AUTH-02, AUTH-03, AUTH-04, PAT-01, PAT-02, PAT-03, PAT-04, AUDIT-01, AUDIT-02
**Success criteria:**

1. SQLite DB opens at `<userData>/data/app.db` with WAL mode + `journal_mode = WAL`; first launch runs all pending migrations idempotently.
2. Doctor can create, view, edit, soft-delete a patient with name, DOB, gender, MRN, phone, notes.
3. Patient list supports substring search by name and exact-match by MRN; pagination is in place.
4. PIN login works; 5 failed attempts trigger exponential backoff; 10 failed attempts lock the account and require admin PIN reset.
5. Every login (success/fail), patient create/edit/view/delete, and future procedure/report event appends to `audit_log` with user, action, entity_type, entity_id, metadata, timestamp.

**Pitfalls addressed:** Pitfall 5 (PIN brute-force), Pitfall 9 (backup captures partial DB — `PRAGMA wal_checkpoint(TRUNCATE)` wired from day 1).
**Plans:** 3 plans
**Notes:** Sets up every table needed by later phases (`patients`, `users`, `audit_log`, `settings`) so Phase 3+ can layer in procedures/screenshots/reports without a migration conflict.

Plans:

- [x] 02-01-PLAN.md — Database foundation + auth + audit + users infrastructure (DB open, migrations, WAL, scrypt PIN, rate-limit, audit log triggers, auth/users IPC, session state, tests)
- [x] 02-02-PLAN.md — Patient CRUD + search IPC + audit integration (patientRepo, list/get/create/update/softDelete/restore, name substring + MRN exact search, pagination, audit writes)
- [x] 02-03-PLAN.md — Renderer — Wizard + two-step Login + Patient List + Settings → Users (state-based router, shadcn primitives, two-step login, patient list/form, admin users page, tests)

---

## Phase 3 — Capture Device Enumeration + Live Preview + Quality Presets

**Goal:** Let the doctor see all available USB capture devices, pick one, and see a live preview in the Procedure Room hero screen — without yet recording.
**Mode:** mvp
**Requirements covered:** CAPT-01, CAPT-02, CAPT-03, CAPT-10, SET-01, SET-02
**Success criteria:**

1. App auto-enumerates USB DirectShow capture devices on launch; the device list appears in Settings → Capture and in the Procedure Room dropdown.
2. Selecting a device opens a live `<video>` preview via `navigator.mediaDevices.getUserMedia`; preview decoupled from recorder.
3. Quality presets: SD analog (720×480 NTSC/PAL), HD digital (1920×1080), Custom (resolution + fps) — selectable and remembered per doctor.
4. Device names with non-ASCII characters, embedded spaces, and trailing whitespace round-trip correctly through enumeration (no I/O error on ffmpeg in Phase 4 due to name quoting).
5. Procedure Room hero screen renders the preview with a disabled Record button (Recording is wired in Phase 4).

**Pitfalls addressed:** Pitfall 3 (device enumeration race — preview-only path; main-side ffmpeg open happens in Phase 4 with explicit sequencing).
**Notes:** The choice of last-used device is stored per doctor. This phase does NOT spawn ffmpeg yet.

**Plans:** 8/8 plans executed

Plans:

- [x] 03-04-PLAN.md
- [x] 03-01-PLAN.md — Main foundation: DirectShow enumeration, canonicalization, session-scoped IPC, preload, preset repo, media permission, canonicalize test (Wave 1)
- [x] 03-02-PLAN.md — Renderer: deviceId bridge (dshow ↔ browser), useVideoPreview/useCaptureDeviceMap, Procedure Room + Settings Capture with reactive preview, no-device audit hook, previousRoute Finish (Wave 2, depends_on: 03-01)
- [x] 03-03-PLAN.md — Validation: moved test files, security-baseline + scope guards, integration contract test, full suite + typecheck + build, Windows hardware smoke UAT (Wave 2, depends_on: 03-01, 03-02)
- [x] 03-05-PLAN.md — Gap closure: Settings hub page (replaces transient DropDownMenu, G-03-3) + PatientRow Open Procedure Room entry (G-03-4) (Wave 4, depends_on: 03-04)
- [x] 03-06-PLAN.md — Gap closure: presetHints() defensive guard for malformed custom preset (G-03-5) + shared SettingsSidebar mounted on all three Settings pages with active-tab highlight (G-03-6) (Wave 5, depends_on: 03-05)
- [x] 03-07-PLAN.md — Gap closure: drop getPreset() wrapper at main boundary to match declared `Promise<QualityPreset \| null>` contract (G-03-7) + saved custom-preset renderer hydration regression test (Wave 6, depends_on: 03-01)
- [x] 03-08-PLAN.md — Gap closure: make ProcedureRoom Stop/Finish cleanup tests deterministic under `npm run test:unit` (Electron-as-Node ABI) by awaiting getUserMedia `.then` (G-03-8) + integration contract pins hook release ordering (Wave 7)

---

## Phase 4 — Recording (ffmpeg child process + procedure timer + device-lost handling)

**Goal:** Doctor can press Record, the procedure timer starts, the captured mp4 is written to disk, and Stop produces a valid file — including the long-procedure + device-lost edge cases.
**Mode:** mvp
**Requirements covered:** CAPT-04, CAPT-05, CAPT-06, CAPT-07, CAPT-08, CAPT-09
**Success criteria:**

1. Record button spawns `ffmpeg-static` from main with `-f dshow -i video="<exact-name>" -c:v libx264 -preset veryfast -crf 23 -movflags +faststart`; one child per active procedure.
2. Stop button sends SIGTERM with grace (5s) → SIGKILL fallback; mp4 has a valid moov atom; `fsync` before close; the resulting file plays cleanly in any external player.
3. Procedure timer (HH:MM:SS) ticks during recording; visible on the Procedure Room screen.
4. Doctor can attach a quick mid-procedure note; notes persist on the procedure row.
5. If the capture device disconnects, the UI shows an inline warning (not a modal); `.partial.mp4` + sidecar JSON are preserved; doctor can stop cleanly or recover.

**Pitfalls addressed:** Pitfall 1 (corrupt mp4 at end of long procedure), Pitfall 2 (device-lost mid-recording), Pitfall 10 (Windows path quoting).
**Notes:** This is the highest-leverage phase for risk concentration. The supervisor state machine lives in `src/main/recorder/` and is exercised at minimum with a 60-second recording + unplug-mock test.
**Plans:** 4/4 plans complete
**UAT:** 20/20 pass, 0 issues, 0 blocked (verified 2026-08-06)
**Tracer-first decomposition:** Plan 01 ships the production-quality end-to-end recording slice (migration + injected Recorder + IPC + Record button + HH:MM:SS timer + `'procedure-review'` placeholder) covering CAPT-04..CAPT-07 + D-01/D-02/D-05/D-10/D-12; Plan 02 layers the mid-procedure notes feature covering CAPT-08 + D-06/D-07/D-08/D-09; Plan 03 layers Pause/Resume via segment-and-concat covering D-11; Plan 04 layers device-lost detection + crash-recovery covering CAPT-09 + D-03/D-04. Wave 1=Plan 01; Wave 2=Plan 02 (depends on 01); Wave 3=Plan 03 (depends on 01); Wave 4=Plan 04 (depends on 01).

Plans:

- [x] 04-01-PLAN.md — Tracer + migration 0002_procedures.sql + injected `Recorder` supervisor + procedures/recording IPC (start/stop) + asarUnpack wiring + Record button + HH:MM:SS timer + post-finalize navigation to `'procedure-review'` placeholder (Wave 1)
- [x] 04-02-PLAN.md — Mid-procedure notes: `procedure_notes` IPC handlers + shadcn Textarea/ScrollArea/Badge/Alert additions + `<ProcedureNotesPanel>` mounted in ProcedureRoom side-rail (Wave 2, depends_on: 01)
- [x] 04-03-PLAN.md — Pause/Resume via segment files + finalize `ffmpeg -f concat -c copy` with re-encode fallback + renderer Pause/Resume button + `'Pause #N'` chip (Wave 3, depends_on: 01)
- [x] 04-04-PLAN.md — Device-lost detection (`DEVICE_LOST_RE` regex + `.partial.mp4` rename + sidecar JSON) + inline `<DeviceLostBanner>` + `scanForOrphans` launch-time audit walker + `ProcedureReview` Alert upgrade (Wave 4, depends_on: 01)

---

## Phase 5 — Screenshots + Procedure Review + Trim

**Goal:** Doctor can capture screenshots during or after a procedure, walk through the recording on a scrubber with a clickable screenshot timeline, and trim the procedure to the salient portion.
**Mode:** mvp
**Requirements covered:** SCRN-01, SCRN-02, REV-01, REV-02, REV-03, REV-04
**Success criteria:**

1. Doctor can take a screenshot mid-procedure or from review playback; screenshot renders to JPEG from the current `<video>` frame and persists under `<userData>/data/media/patients/<id>/<procedureId>/screenshots/<timestamp>.jpg`.
2. Each screenshot is indexed in the `screenshots` table with `timestamp_in_video`, `file_path` (relative to `userData`), and `annotation` (nullable).
3. Procedure Review screen shows the recorded video with native `<video>` play/pause/seek controls and a clickable screenshot timeline; clicking a thumbnail seeks to that timestamp.
4. Trim control lets doctor set a new in/out point; trim produces a new mp4 (original never overwritten) via ffmpeg `-ss <start> -t <duration> -c copy` and the procedure row updates to point at the trimmed file while preserving the original as `video_path_original`.

**Pitfalls addressed:** Same file-corruption risks as Phase 4 (always operate on copies, never in place).
**Notes:** This phase pairs with Phase 4 — `screenshots` rows can be created during recording (Phase 4 already has the write path), and review + trim are the post-procedure counterparts.

**Plans:** 4/4 plans complete

- [x] 05-01-PLAN.md — Screenshot capture pipeline: migration 0003 + screenshots IPC + capture lib + Scrubber + ScreenshotTimeline + ProcedureRoom S/hotkey + ProcedureReview replacement (Wave 1)
- [x] 05-02-PLAN.md — Pause markers on scrubber + Notes accordion + annotation panel + StatusBadge + useProcedures hook + PROCEDURES_LIST_SEGMENTS (Wave 2, depends_on: 01)
- [x] 05-03-PLAN.md — Trim handles on scrubber + ffmpeg trim subprocess + applyTrim + Restore + PreviewServer `/media/` route + PROCEDURES_TRIM/RESTORE handlers + MediaServer + TrimControls + useTrim/useMediaUrl hooks (Wave 3, depends_on: 01, 02)
- [x] 05-04-PLAN.md — Integration hardening: PreviewServer HTTP Range request support + 9-case security audit + DestructivePartialAlert extraction + TrimControls 30-min cap + Scrubber clampCurrent + useMediaUrl retry() + ProcedureReview placeholder Card + 3 pre-existing test cascade-pollution fixes + VERIFICATION.md + Windows hardware smoke UAT.md (Wave 4, depends_on: 01, 02, 03)
  - **Verification:** 484/484 tests across 62 files; `phase_status: complete` (pending Windows hardware smoke per 05-UAT.md); VERIFICATION.md per-requirement score sheet ready; deferred items documented (TRIM-02 multi-segment trim, audio playback, exact-cut re-encode, 30-min browser seek cap).

---

## Phase 6 — Doctor Profile + Report Editor + PDF Generation

**Goal:** Doctor profile is editable and auto-fills the report PDF header; doctor can author a report draft with findings/diagnosis/recommendations and attach screenshots; report finalizes into a PDF stored locally.
**Mode:** mvp
**Requirements covered:** PROF-01, PROF-02, RPT-01, RPT-02, RPT-03, RPT-04, RPT-05, RPT-06, RPT-07
**Success criteria:**

1. Doctor profile editor accepts full name (EN + AR), clinic info (name, address, phone), signature image (PNG/JPEG), and clinic logo; saves to a `doctor_profile` row.
2. Report editor opens a draft for any procedure; fields for findings, diagnosis, recommendations, procedure details; fields are auto-saved on blur.
3. Doctor can attach any number of screenshots from the procedure, in a chosen order (sort_order column).
4. Report has draft + finalized states; finalizing locks most fields (only findings/diagnosis/recommendations editable by an admin role after finalize) and stamps `finalized_at`.
5. PDF generation via `@react-pdf/renderer` writes `<userData>/data/reports/<reportId>.pdf`; doctor can open the PDF in the OS default viewer.
6. PDF renders correctly in English (LTR) and Arabic (RTL); numeric fragments, signature position, and logo placement all verified by an explicit smoke test.

**Pitfalls addressed:** Pitfall 8 (PDF RTL bidi handling).
**Notes:** Sample AR PDF must be generated and visually inspected at end of phase — if `@react-pdf/renderer` bidi proves insufficient, plan a small HTML→PDF fallback for the AR report path only.

---

## Phase 7 — Search & History + Audit UI + Backup/Restore + Arabic/RTL

**Goal:** Cross-cutting finishing work: cross-cutting search by date range and doctor; visible audit log; data backup and restore; full Arabic + RTL coverage.
**Mode:** mvp
**Requirements covered:** SRCH-01, SRCH-02, SRCH-03, SET-05, SET-06, I18N-01, I18N-02, I18N-03
**Success criteria:**

1. Search by date range + doctor (combinable with name/MRN) returns matching procedures with their reports and patient context.
2. Procedure list view paginates; per-row click opens the procedure review screen.
3. Audit log UI shows who-did-what filtered by date range, user, action, entity type.
4. Backup creates a zip of `<userData>/data/` (after `PRAGMA wal_checkpoint(TRUNCATE)`); restore unpacks into a chosen directory with explicit overwrite confirmation.
5. UI is bilingual (EN + AR); document direction flips on language change; every shadcn component renders correctly in RTL (slider, dropdown, dialog, calendar, popover).
6. Restored DB passes `PRAGMA integrity_check` end-to-end.

**Pitfalls addressed:** Pitfall 7 (RTL layout breaks in shadcn), Pitfall 9 (backup captures partial DB).
**Notes:** This phase is the GCC-market ship gate. Every visible UI string must be in both languages before tagging this phase done.

---

## Phase 8 — Licensing (Ed25519 signed `.lic` + 14-day trial + activation flow)

**Goal:** License gating works end-to-end: 14-day trial with full features; Ed25519-signed `.lic` file activates the workstation; license is verified on every launch; trial clock survives reboots; license gate lives at the IPC boundary.
**Mode:** mvp
**Requirements covered:** LIC-01, LIC-02, LIC-03, LIC-04
**Success criteria:**

1. App offers a 14-day trial with full features; trial clock survives reboots (stored in `settings` table).
2. Activation requires an Ed25519-signed `.lic` file bound to the machine fingerprint (CPU + disk serial + MAC, hashed).
3. License verification uses an embedded public key; signature payload is verified, never the raw JSON. Verification code path is `Object.freeze`'d to discourage tampering.
4. All `ipcMain.handle` registrations are gated through a single license-check helper that returns a structured error code if invalid.
5. Vendor-side `scripts/gen-license.cjs` exists, runs offline, and produces a `.lic` file from a machine-id input; signing key is never checked into the repo.
6. Tampered license (edited JSON, wrong signature) is detected and rejected; clinic sees "license invalid, contact vendor" with the machine id to email back.

**Pitfalls addressed:** Pitfall 6 (license trivially bypassed).
**Notes:** N-API tamper-resistant addon (LIC-05 from v2) is parked as a v1.1 hardening follow-up, not part of v1. The v1 JS verify path is the ship gate.

---

## Phase Summary

| # | Phase | Requirements | Success Criteria | UI hint |
|---|-------|--------------|--------------------|---------|
| 1 | Scaffold | 4 | 5 | no |
| 2 | Database + Patient + Audit + Auth | 10 | 5 | yes (Login + Patient list/detail) |
| 3 | Capture Enumeration + Live Preview | 6 | 5 | yes (Procedure Room — preview only) |
| 4 | Recording (ffmpeg) | 6 | 5 | yes (Procedure Room — Record/Stop) |
| 5 | Screenshots + Review + Trim | 6 | 4 | yes (Procedure Review screen) |
| 6 | Profile + Report + PDF | 9 | 6 | yes (Doctor Profile + Report Editor) |
| 7 | Search + Audit UI + Backup + i18n | 8 | 6 | yes (Search results + Audit + Backup + language switcher) |
| 8 | Licensing | 4 | 6 | yes (License gate UI) |

**Total v1 requirements:** 50. **Mapped:** 50. **Unmapped:** 0 ✓

## Phase Ordering Rationale

- **Patient before Procedure:** A procedure attaches to a patient; cannot record without one.
- **Capture before Recording:** Cannot record without first picking a device and seeing a preview.
- **Profile before Report:** Reports auto-fill clinic info from the active doctor's profile; profile must exist before report generation.
- **Database before everything persistent:** Audit log has no destination without the DB; backup/restore needs the DB and media tree.
- **i18n late:** Translations cover the actual UI surface, not a moving target; Phase 7 is the GCC-market ship gate.
- **License last:** License is the gate, not a development friction. Building it last keeps clinical code paths focused on the product.

## Phase Dependency Graph

```
Phase 1 (Scaffold)
    └── Phase 2 (DB + Auth + Patient)
            └── Phase 3 (Capture + Preview)
                    └── Phase 4 (Recording)
                            └── Phase 5 (Screenshots + Review + Trim)
                                    └── Phase 6 (Profile + Report + PDF)
                                            └── Phase 7 (Search + Audit UI + Backup + i18n)
                                                    └── Phase 8 (Licensing)
```

Linear chain. Each phase's output is the next phase's input.

---
*Roadmap created: 2026-07-31*
*Ready for phase 1 planning: yes*
