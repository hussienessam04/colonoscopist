# Requirements: Colonoscopist

**Defined:** 2026-07-31
**Core Value:** A gloved, busy doctor can hit Record on a procedure, capture findings as screenshots during the case, and walk out with a signed PDF report ready for the patient — with zero internet dependency between recordings.

## v1 Requirements

Requirements for initial release. Each maps to a roadmap phase.

### Authentication & Doctor Profile

- [ ] **AUTH-01**: User can log in with PIN; multi-user support on the same workstation.
- [ ] **AUTH-02**: Failed PIN attempts trigger exponential backoff (1s, 2s, 4s, …) and lock the account after 10 failures (admin PIN reset required to unlock).
- [ ] **AUTH-03**: Every login (success or failure) is recorded in `audit_log` with user id, timestamp, and outcome.
- [ ] **AUTH-04**: Active session ends on explicit logout or app close; no persistent session across workstation reboot.
- [ ] **PROF-01**: User can create and edit a doctor profile: full name (English + Arabic), clinic info (name, address, phone), signature image, clinic logo.
- [ ] **PROF-02**: Report PDFs auto-fill clinic info and signature from the active doctor's profile; no per-report re-entry.

### Patient Management

- [ ] **PAT-01**: User can create a patient with name, DOB, gender, MRN, phone, notes.
- [ ] **PAT-02**: User can search patients by name (substring) and by exact MRN.
- [ ] **PAT-03**: User can view, edit, and delete patient records.
- [ ] **PAT-04**: Deleted patients cannot be hard-deleted while procedures or reports reference them (soft-delete only; historical records preserved).

### Procedure Capture

- [x] **CAPT-01**: App auto-enumerates all USB DirectShow video devices on launch.
- [ ] **CAPT-02**: Doctor can pick a device from a dropdown; the choice is remembered for the next procedure (per-doctor last-used device).
- [x] **CAPT-03**: Live preview shows in the renderer via `getUserMedia`; preview is decoupled from the recorder and continues to work even when no recording is active.
- [ ] **CAPT-04**: Recording uses `ffmpeg-static` as a child process; spawned from main; one child process per active procedure.
- [ ] **CAPT-05**: mp4 is written to `<userData>/data/media/patients/<patientId>/<procedureId>/video.mp4` with `-c:v libx264 -preset veryfast -crf 23 -movflags +faststart`.
- [ ] **CAPT-06**: On Stop, ffmpeg receives SIGTERM with grace (5s) → SIGKILL fallback; mp4 has a valid moov atom and fsync on close.
- [ ] **CAPT-07**: Procedure timer runs during recording (HH:MM:SS visible in the UI).
- [ ] **CAPT-08**: Doctor can attach a quick note mid-procedure; notes are stored against the procedure row.
- [ ] **CAPT-09**: If the capture device disconnects, the UI shows an inline warning; a `.partial.mp4` + sidecar JSON are preserved so the doctor can recover or accept the partial.
- [ ] **CAPT-10**: Device names with non-ASCII characters, embedded spaces, and trailing whitespace are normalized and round-trip cleanly through ffmpeg's dshow input.

### Screenshots & Procedure Review

- [x] **SCRN-01**: Doctor can take a screenshot during a procedure; screenshot is rendered from the current `<video>` preview frame to JPEG. _(Plan 05-01)_
- [x] **SCRN-02**: Screenshots are persisted under `<userData>/data/media/patients/<patientId>/<procedureId>/screenshots/<timestamp>.jpg` and indexed in the `screenshots` table. _(Plan 05-01)_
- [x] **REV-01**: Doctor can open a finished procedure and see the recorded video with a scrubber and play/pause controls. _(Plan 05-01, 05-02, 05-03)_
- [x] **REV-02**: Review screen shows a clickable screenshot timeline; clicking a thumbnail seeks the video to that screenshot's timestamp. _(Plan 05-01, 05-02)_
- [x] **REV-03**: Doctor can take additional screenshots from playback (same path as in-procedure screenshots). _(Plan 05-01, 05-02)_
- [x] **REV-04**: Doctor can trim the procedure (set start + end points); trim produces a new mp4 (the original is never overwritten) via ffmpeg `-ss` / `-t` with stream copy. _(Plans 05-03, 05-04)_

### Reports

- [ ] **RPT-01**: Doctor can open a report draft for any procedure; drafts auto-fill clinic info and signature from the active doctor profile.
- [ ] **RPT-02**: Report has fields for findings, diagnosis, recommendations, and procedure details (free text).
- [ ] **RPT-03**: Doctor can attach any number of screenshots from the procedure to the report, in a chosen order.
- [ ] **RPT-04**: Report has two states: draft (editable) and finalized (timestamp locked; only the findings/diagnosis/recommendations fields can be edited by an admin).
- [ ] **RPT-05**: Report generates a PDF via `@react-pdf/renderer`; PDF is written to `<userData>/data/reports/<reportId>.pdf`.
- [ ] **RPT-06**: PDF supports English and Arabic; in Arabic, text direction is RTL; numeric fragments and the doctor's signature position are correct.
- [ ] **RPT-07**: Doctor can open the generated PDF in the OS default viewer.

### Search & History

- [ ] **SRCH-01**: User can search patient history by name (substring), MRN, date range, and doctor.
- [ ] **SRCH-02**: Search results return matching procedures with their associated reports and patient context.
- [ ] **SRCH-03**: Procedure list view paginates; per-row click opens the procedure review screen.

### Settings

- [x] **SET-01**: User can pick the default capture device from a dropdown (Settings → Capture).
- [ ] **SET-02**: User can pick a quality preset: SD analog (720×480), HD digital (1920×1080), or custom (resolution + framerate).
- [ ] **SET-03**: User can set the data storage path (advanced; default is `<userData>/data`).
- [ ] **SET-04**: Admin can add, edit, and remove users (PIN reset, role change).
- [ ] **SET-05**: User can run a backup (zip the data folder) and choose a destination path.
- [ ] **SET-06**: User can restore from a backup zip into a chosen directory (does not overwrite the active data folder without confirmation).

### Audit Log

- [ ] **AUDIT-01**: Every login, procedure view, procedure edit, report create/finalize, settings change, and backup/restore is recorded in `audit_log` with user, action, entity type, entity id, metadata, timestamp.
- [ ] **AUDIT-02**: Audit log is append-only; there is no UI or IPC that updates or deletes rows.

### Localization (EN + AR + RTL)

- [ ] **I18N-01**: UI is bilingual (English + Arabic); language switch is per-doctor.
- [ ] **I18N-02**: Document direction (`<html dir>`) flips between LTR (English) and RTL (Arabic) on language change.
- [ ] **I18N-03**: All shadcn-driven components (slider, dropdown, dialog, calendar, popover) render correctly in RTL.

### Licensing

- [ ] **LIC-01**: App offers a 14-day trial with full features, no card required, no internet check.
- [ ] **LIC-02**: Activation requires a valid Ed25519-signed `.lic` file bound to the workstation's machine fingerprint (CPU + disk serial + MAC, hashed).
- [ ] **LIC-03**: On launch, app verifies the license; if missing or invalid, app surfaces a clear "activate / enter trial" prompt and blocks procedure capture until resolved.
- [ ] **LIC-04**: All IPC handlers are gated by license validity; license is enforced at the boundary, not in each handler.

## v2 Requirements

Deferred to a future release. Tracked but not in the current roadmap.

### Review & Editing

- **TRIM-02**: Multi-segment trim (multiple in/out points in one procedure).
- **REV-05**: Video annotations (arrows, freehand marks) on top of the recorded video during review.

### Reports

- **RPT-08**: Custom report templates selectable per clinic.
- **RPT-09**: Auto-populated common findings macros (doctor picks "polyp, sessile" from a list).

### Search & History

- **SRCH-04**: Full-text search across report findings/diagnosis (FTS5 on `reports.findings`, `reports.diagnosis`).

### Languages

- **I18N-04**: Additional languages (Urdu, Persian) — defer until clinic demand confirms.

### Licensing

- **LIC-05**: Tamper-resistant license check via N-API native addon (hardening on top of the v1 JS verify path).
- **LIC-06**: Re-activation allowance (e.g., N re-activations per year for NIC/MAC changes).

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Cloud sync | Violates offline-only mandate; introduces PII boundary; ops/regulatory burden |
| Multi-clinic central admin | Each workstation is independent; chain-clinic feature would require cloud |
| DICOM / PACS integration | Regulatory burden; no v1 customer need; defers to v2+ if a hospital partnership materializes |
| Vendor endoscopy SDKs (Olympus, Pentax, etc.) | License fees per integration; breaks the "generic USB capture" positioning |
| Insurance, billing, scheduling | Out of core value; competes with existing EMR vendors |
| Speech-to-text dictation | Arabic STT model maturity + accuracy work; defer until clinic demand |
| Mobile companion app | Windows desktop is the v1 surface; clinic can email PDFs to patients |
| AI polyp detection | Regulatory device-class risk; needs labeled dataset; defers to v2+ with regulator input |
| Real-time multi-user collaboration | Single-workstation mandate; locking + conflicts not required at clinic scale |
| Advanced video editing (NLE) | Out of core scope; the trim-cut-start/end capability covers v1 review needs |
| Online reactivation / phone-home | Hard ban; GCC clinic distrust of vendor cloud; vendor runs an offline signing tool |

## Traceability

Filled by `ROADMAP.md` after roadmap creation. Each requirement maps to exactly one phase.

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01 | Phase 1 | Pending |
| AUTH-02 | Phase 2 | Pending |
| AUTH-03 | Phase 2 | Pending |
| AUTH-04 | Phase 1 | Pending |
| PROF-01 | Phase 6 | Pending |
| PROF-02 | Phase 6 | Pending |
| PAT-01 | Phase 2 | Pending |
| PAT-02 | Phase 2 | Pending |
| PAT-03 | Phase 2 | Pending |
| PAT-04 | Phase 2 | Pending |
| CAPT-01 | Phase 3 | In Progress (03-01 done; 03-02/03-03 pending) |
| CAPT-02 | Phase 3 | In Progress (03-01 done; 03-02/03-03 pending) |
| CAPT-03 | Phase 3 | Pending (03-02) |
| CAPT-04 | Phase 4 | Pending |
| CAPT-05 | Phase 4 | Pending |
| CAPT-06 | Phase 4 | Pending |
| CAPT-07 | Phase 4 | Pending |
| CAPT-08 | Phase 4 | Pending |
| CAPT-09 | Phase 4 | Pending |
| CAPT-10 | Phase 3 | In Progress (03-01 done; 03-02/03-03 pending) |
| SCRN-01 | Phase 5 | Done (05-01: migration 0003 + screenshots IPC + repo + preload bridge; 05-04: DestructivePartialAlert for partial recordings) |
| SCRN-02 | Phase 5 | Done (05-01: capture-screenshot lib + Scrubber + ScreenshotTimeline + ProcedureRoom S/hotkey) |
| REV-01 | Phase 5 | Done (05-01: Scrubber with pointer events + setPointerCapture; 05-02: pause markers from procedure_segments; 05-03: PreviewServer /media/ route; 05-04: HTTP Range request support + 9-case security audit) |
| REV-02 | Phase 5 | Done (05-01: ScreenshotTimeline + click-to-seek + Toast-undo delete; 05-02: per-thumbnail inline ScreenshotAnnotation) |
| REV-03 | Phase 5 | Done (05-01: ProcedureReview real impl with video left + scrubber + timeline + bare metadata sidebar; 05-02: useProcedures SWR hook + D-13 capture gate) |
| REV-04 | Phase 5 | Done (05-03: trim handles + PROCEDURES_TRIM/RESTORE handlers + applyTrim + Restore; 05-04: HTTP Range request support + 9-case security audit + 30-min trim cap + media URL fallback) |
| RPT-01 | Phase 6 | Pending |
| RPT-02 | Phase 6 | Pending |
| RPT-03 | Phase 6 | Pending |
| RPT-04 | Phase 6 | Pending |
| RPT-05 | Phase 6 | Pending |
| RPT-06 | Phase 6 | Pending |
| RPT-07 | Phase 6 | Pending |
| SRCH-01 | Phase 7 | Pending |
| SRCH-02 | Phase 7 | Pending |
| SRCH-03 | Phase 7 | Pending |
| SET-01 | Phase 3 | In Progress (03-01 done; 03-02/03-03 pending) |
| SET-02 | Phase 3 | In Progress (03-01 done; 03-02/03-03 pending) |
| SET-03 | Phase 1 | Pending |
| SET-04 | Phase 1 | Pending |
| SET-05 | Phase 7 | Pending |
| SET-06 | Phase 7 | Pending |
| AUDIT-01 | Phase 2 | Pending |
| AUDIT-02 | Phase 2 | Pending |
| I18N-01 | Phase 7 | Pending |
| I18N-02 | Phase 7 | Pending |
| I18N-03 | Phase 7 | Pending |
| LIC-01 | Phase 8 | Pending |
| LIC-02 | Phase 8 | Pending |
| LIC-03 | Phase 8 | Pending |
| LIC-04 | Phase 8 | Pending |

**Coverage:**

- v1 requirements: 50 total
- Mapped to phases: 50
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-31*
*Last updated: 2026-07-31 after initial definition*
