# Phase 6: Doctor Profile + Report Editor + PDF Generation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-08
**Phase:** 6-doctor-profile-report-editor-pdf-generation
**Areas discussed:** Profile data model, Report state machine, PDF generation timing + language

---

## Profile data model

| Option | Description | Selected |
|--------|-------------|----------|
| New doctor_profile table (1:1 with users) | `doctor_profile` keyed by user_id FK. Cleanest separation. wizard auto-creates the row when admin finishes setup. users.full_name stays as English; bilingual columns live on doctor_profile. | ✓ |
| Extend users + extend settings | Extend users with full_name_ar; add new settings keys for clinic info + signature/logo paths. Clutters users table (mixed auth + profile concerns). | |
| Single profiles table (no users link) | Single profiles table replacing users.full_name entirely. Bigger blast radius — Phase 2 wizard + audit_log reference users.full_name. | |
| You decide | Capture decision, let the planner figure out details | |

**User's choice:** New doctor_profile table (1:1 with users) — confirmed.
**Notes:** users.full_name stays as English; bilingual columns live on doctor_profile. wizard auto-creates the doctor_profile row when admin finishes setup.

| Option | Description | Selected |
|--------|-------------|----------|
| Parallel columns (_en + _ar) | Each bilingual field gets two columns (full_name_en NOT NULL, full_name_ar NULL). AR columns nullable. Matches Phase 2 full_name TEXT pattern. | |
| Single JSON column per field | Store `{"en":"...","ar":"..."}` in one TEXT column with json_valid CHECK. Harder to grep + audit. | |
| Generic i18n table | `doctor_profile_i18n (profile_id, lang, field, value)`. Long-tail-friendly. Overkill for v1. | |
| You decide | Capture decision, let the planner figure out details | ✓ |

**User's choice:** You decide (recommended: Parallel columns).
**Notes:** Planner picks Parallel columns; matches Phase 2 full_name TEXT pattern; AR columns nullable so doctor can fill later.

| Option | Description | Selected |
|--------|-------------|----------|
| Migration copies data, keeps wizard untouched | Migration backfills doctor_profile from users.full_name + settings.clinic_name on first launch post-Phase 6. Wizard + auth/login keep using users.full_name. Profile editor is a new dedicated page (Settings > Profile). | |
| Extend wizard to collect bilingual info on first run | Wizard grows new fields (fullNameAr, clinicNameAr, address, phone) + signature/logo upload. Existing clinics see wizard on first launch after Phase 6 upgrade. | |
| Drop settings.clinic_name | On migration, settings.clinic_name is deleted + doctor_profile becomes the sole source. Backwards-compat risk for auth.status IPC. | |
| You decide | Capture decision, let the planner figure out details | ✓ |

**User's choice:** You decide (recommended: Migration copies data, keeps wizard untouched).
**Notes:** Planner picks option 1. settings.clinic_name stays in DB (Phase 2 IPC reads from it; rewriting that surface is out of Phase 6 scope). Report PDF reads from doctor_profile.

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal: required by PROF-01 verbatim | full name EN+AR, clinic info (name EN+AR, address, phone), signature image (PNG/JPEG), clinic logo. One row, one upload per asset. | ✓ |
| Add: clinic stamp + per-asset name | Optional clinic stamp/letterhead variant + per-asset name field. v1.1 territory, PROF-01 doesn't ask. | |
| Add: doctor specialty + qualifications | Specialty (gastroenterologist / surgeon / GP), qualifications, registration number. PROF-01 doesn't lock it. | |
| You decide | Capture decision, let the planner figure out details | |

**User's choice:** Minimal: required by PROF-01 verbatim — confirmed.

---

## Report state machine

| Option | Description | Selected |
|--------|-------------|----------|
| One report per procedure (1:1) | UNIQUE on reports.procedure_id. Doctor opens draft, edits, finalizes. Admin edits in-place. PDF on disk is overwritten on finalize + admin edit. | ✓ |
| Multiple revisions stack (1:many) | Procedure -> reports[] with version=N+1. Each finalize creates a new row. Full revision history. PDF per version. | |
| Single row + separate audit history | Single report row + report_edit_log table for audit history of every field change. | |
| You decide | Capture decision, let the planner figure out details | |

**User's choice:** One report per procedure (1:1) — confirmed.

| Option | Description | Selected |
|--------|-------------|----------|
| Admin edits -> updated_at only; finalized_at frozen | PDF regenerated to reflect edit. Original finalize_at is canonical "when this became final"; edits are corrections. | ✓ |
| Admin edits -> bump finalized_at | Cleaner for downstream consumers (PDF timestamp = latest finalized) but loses original finalize time. | |
| Admin edits -> create new revision | Closest to "report has history" but breaks 1:1 cardinality. | |
| You decide | Capture decision, let the planner figure out details | |

**User's choice:** Admin edits -> updated_at only; finalized_at frozen — confirmed.

| Option | Description | Selected |
|--------|-------------|----------|
| Strict: only findings/diag/recommendations | Per RPT-04 verbatim. Locked: procedure_id, doctor_id, attached_screenshots, finalized_at, created_at. | |
| Wider: free-text fields + screenshot add/remove | Allow admin to also add/remove attached screenshots after finalize. Doctor may want to swap a screenshot. PDF re-generates. | ✓ |
| Narrower: only those three fields, no screenshot reorder | Lock everything after finalize, including screenshot order. Most defensive. | |
| You decide | Capture decision, let the planner figure out details | |

**User's choice:** Wider: free-text fields + screenshot add/remove — confirmed.

| Option | Description | Selected |
|--------|-------------|----------|
| Admin-only post-finalize edits | Admin is the only role with is_first_admin=1 (Phase 2 D-02). All other doctors see read-only. | |
| Any doctor can edit (admin is soft preference) | Skip the role check. RPT-04 interpreted loosely. | ✓ |
| Role gate only for screenshot reorder | Doctor themselves can edit their own; admin can edit any. | |
| You decide | Capture decision, let the planner figure out details | |

**User's choice:** Any doctor can edit (admin is soft preference) — confirmed.

---

## PDF generation timing + language

| Option | Description | Selected |
|--------|-------------|----------|
| On finalize, cached; re-render on edit | Main renders PDF, writes to <userData>/data/reports/<reportId>.pdf, stores path on row. Subsequent opens read from disk. | |
| On demand every open | PDF rendered fresh every time doctor clicks Open. No on-disk cache. Disregards RPT-05 path. | |
| Hybrid: cached + always re-render on open | Cache on finalize + edit; on Open click, ALWAYS re-render and overwrite. PDF on disk is canonical snapshot. | |
| You decide | Capture decision, let the planner figure out details | ✓ |

**User's choice:** You decide (recommended: On finalize, cached; re-render on edit).
**Notes:** Planner picks option 1: matches RPT-05 verbatim ("written to userData/data/reports/<id>.pdf"). Doctor's "Open PDF" click → IPC → main resolves file + spawns electron.shell.openPath().

| Option | Description | Selected |
|--------|-------------|----------|
| Doctor picks language per-render, defaults to EN | Select dropdown on report editor: "Render as: EN / AR". Default = EN. Stored on reports row as pdf_language. | |
| Bilingual PDF (both EN+AR sections) | Always bilingual: EN section on left page, AR on right. AR auto-translates from EN — out of scope. Or doctor fills both EN and AR manually. | |
| Single-language per-render, fields are EN only | Findings/diag/recommendations in EN only. PDF renders EN or AR based on dropdown. AR text from doctor's profile (full_name_ar, clinic_name_ar). | |
| You decide | Capture decision, let the planner figure out details | ✓ |

**User's choice:** Single-language per-render, fields are EN only — confirmed.

| Option | Description | Selected |
|--------|-------------|----------|
| Dropdown on report editor + stored on report row | `<Select>` on report editor: "Render PDF in: English | العربية". Default = English. Stored on reports row as pdf_language. | |
| Dropdown only at Finalize click | No persistent field. Doctor picks at finalize time. | |
| Auto-detect from doctor profile (AR if profile has Arabic) | Auto-detect from doctor_profile: if full_name_ar IS NOT NULL, render AR. | |
| You decide | Capture decision, let the planner figure out details | |

**User's choice:** (overridden) "the pdf report is always in english" — the PDF always renders in English. No language picker needed in Phase 6.
**Notes:** This contradicts the previous answer's premise of "single-language per-render". User clarified: PDF always English. RPT-06 deferred to Phase 7.

| Option | Description | Selected |
|--------|-------------|----------|
| Full template: header, findings, screenshots, signature, footer | PDF header: clinic logo + clinic name + doctor name + signature + procedure date. Body: patient + procedure metadata + findings/diag/recommendations + attached screenshots. Footer: page number + clinic name. | ✓ |
| Minimal template: text + screenshots only | No logo, no signature image, no footer. Minimal v1. | |
| Match Phase 5 review screen layout | PDF mirrors ProcedureReview screen layout (video pane left, tools right). Doesn't apply — static document. | |
| You decide | Capture decision, let the planner figure out details | |

**User's choice:** Full template: header, findings, screenshots, signature, footer — confirmed.

---

## Areas not selected for discussion

- **Signature + logo storage** — Not selected. Agent's discretion (default: files on disk under `<userData>/data/profiles/<userId>/signature.{png,jpg}` + `<userData>/data/profiles/<userId>/logo.{png,jpg}`, paths stored userData-relative on `doctor_profile.signature_path` / `doctor_profile.logo_path`, matches Phase 4 D-04 pattern).

## the agent's Discretion

Areas where user said "You decide" — agent has flexibility:

1. Bilingual field shape → Parallel columns `_en` + `_ar` (recommended)
2. Migration of clinicName + fullName → Migration copies data, keeps wizard untouched (recommended)
3. PDF generation timing → On finalize, cached; re-render on edit (recommended)

## Deferred Ideas

- **Patient profile with past history** — user-suggested mid-discussion. Out of scope for Phase 6. Belongs in its own phase or Phase 7's Search & History (SRCH-01..03 covers cross-procedure lookup).
- **Arabic PDF rendering (RPT-06)** — Phase 7 ships alongside the per-doctor language preference (I18N-01).
- **Auto-translation of report body fields (EN → AR)** — out of v1 scope per REQUIREMENTS Out-of-Scope; offline-only app.
- **Multi-version report history** — D-05 picks 1:1 with audit log as the change trail.
- **Custom report templates (RPT-08)** — v2 requirement.
- **Auto-populated common findings macros (RPT-09)** — v2 requirement.
- **Full-text search across report findings/diagnosis (SRCH-04)** — v2 requirement.
- **Doctor specialty + qualifications** — D-04 defers; v1.1 if clinics ask.
- **Clinic stamp / letterhead variant** — D-04 defers; v1.1 if regional demand.
- **Role gate on post-finalize edits (strict RPT-04)** — D-08 interprets loosely. Adding the gate is one WHERE-clause + one renderer flag if clinic policy tightens.
