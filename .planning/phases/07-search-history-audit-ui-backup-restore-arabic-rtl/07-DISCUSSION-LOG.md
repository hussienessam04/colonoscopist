# Phase 7: Search & History + Audit UI + Backup/Restore + Arabic/RTL - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-10
**Phase:** 7-search-history-audit-ui-backup-restore-arabic-rtl
**Areas discussed:** None — user opted to skip the deep-dive and let the agent capture defaults from PROJECT.md / REQUIREMENTS / prior CONTEXT.md / research files.

---

## Session flow

| Step | Action |
|------|--------|
| 1 | ROADMAP.md parser was failing to detect Phase 7 (em-dash headings `## Phase N — Name` vs parser's expected colon format `## Phase N: Name`). User approved converting all phase headings + removing the stale duplicate Phase 6 stub at lines 260–269. `gsd-tools init phase-op 7` now resolves the phase. |
| 2 | Prior context loaded: PROJECT.md (offline-only + i18n key decisions), REQUIREMENTS.md (SRCH-01..03, SET-05..06, I18N-01..03, AUDIT-01..02, RPT-06 deferred), STATE.md (Phase 6 complete; 559/559 tests passing), prior CONTEXT.md files (06 most recent, then 05, 04). |
| 3 | Codebase scouted: no `i18next`/`archiver`/`yauzl` packages installed yet; `src/main/db/audit.ts` + `src/main/ipc/audit.ts` already ship `audit:list` with date-range + pagination (Phase 2 D-05); `PRAGMA wal_checkpoint(TRUNCATE)` helper wired from day 1 (Phase 2 D-04); `users.language` column does NOT exist yet — Phase 7 migration adds it. |
| 4 | Gray areas presented to user via multi-select (7 areas + Skip): Search scope & UI, Audit log UI, Backup contents & flow, Restore flow & safety, i18n language storage, RTL coverage + shadcn smoke, AR PDF (deferred RPT-06). |
| 5 | User selected **"Skip deep-dive (Recommended)"** — agent captures defaults from research + prior decisions. |
| 6 | Agent wrote `07-CONTEXT.md` with 27 locked decisions (D-01..D-27) covering all 8 requirements + the deferred RPT-06 AR PDF path. |

---

## the agent's Discretion

Items the agent defaulted to without explicit user confirmation (per the Skip deep-dive choice):

| # | Decision | Source |
|---|----------|--------|
| 1 | Patient List sidebar (not new route) for search filters | Phase 2 patientRepo + Phase 3 sidebar pattern (G-03-6) |
| 2 | Audit page lives under SettingsHub (Phase 3 sidebar pattern) | Phase 3 G-03-6 |
| 3 | Backup zip = `<userData>/data/` subtree (excludes `logs/` per Phase 1 D-02) | Phase 1 D-02 sibling-layout |
| 4 | Two-directory restore model (active `data/` vs staging `data-restore-<ts>/`) | PITFALLS §Pitfall 9 + "doctor's last backup is the fallback" |
| 5 | Per-doctor language on `doctor_profile.language` (NULL falls back to `users.language`) | Phase 2 D-02 small-clinic-shared-workstation |
| 6 | Tailwind `rtl:` variants (no `tailwindcss-rtl` plugin) | PITFALLS §Pitfall 7 + ponytail ladder (one less dep) |
| 7 | AR TTF = Noto Sans Arabic (SIL OFL, freely embeddable), committed to repo | RESEARCH §STACK + PROJECT §Constraints (offline-only, no build-time fetch) |
| 8 | Same React template for EN + AR PDFs (conditional rendering on `language`) | Phase 6 D-12 thin bridge; one component, one path |
| 9 | Slider installed + smoke-tested (no current usage); Calendar NOT installed (no scheduling feature per OUT-OF-SCOPE) | REQUIREMENTS OUT-OF-SCOPE + PITFALLS §Pitfall 7 verbatim |
| 10 | `users.language` column added via the same migration as `doctor_profile.language` (`0007_doctor_profile_language_and_users_language.sql`) | Established pattern from Phase 6 `0004_doctor_profile_and_reports.sql` |

---

## Deferred Ideas (captured in CONTEXT.md §Deferred Ideas)

- Restore "Activate this backup" button — disabled placeholder in Phase 7, v1.1 implementation
- Full-text search across report findings/diagnosis (SRCH-04) — v2
- Scheduled/automated backups — out of v1 (manual only)
- Backup to network share / cloud — hard ban (offline-only)
- Backup encryption at rest — v1.1 hardening
- Multi-language (Urdu, Persian) (I18N-04) — v2
- Per-clinic language override — v1.1 if GCC clinics request
- Calendar component — v1.1+ if scheduling ships (currently OUT-OF-SCOPE)
- Arabic voice input for findings — OUT-OF-SCOPE
- Auto-translation of report body EN → AR — out of v1 (doctor types in their language)
- Backup differential/incremental — full-zip only in v1
- Pre-flight backup integrity check on source DB — v1.1 hardening

---

## Pre-existing carry-forward decisions from prior phases

These were already locked in earlier CONTEXT.md files and applied to Phase 7 without re-asking:

- **Phase 1 D-02**: startup log at `userData/logs/` sibling (not inside `data/`) → backup excludes logs.
- **Phase 1 D-06**: no i18n scaffolding in Phase 1 → Phase 7 ships the full i18next + RTL stack from zero.
- **Phase 2 D-04**: `PRAGMA wal_checkpoint(TRUNCATE)` helper wired from day 1 → Phase 7 backup uses it.
- **Phase 2 D-05**: `audit:list` IPC with date-range filter + pagination + 200-row cap → Phase 7 audit UI reads it.
- **Phase 2 Fix 6**: audit-on-every-read pattern → Phase 7 audit page self-audits via `audit_view` (D-08).
- **Phase 4 D-03**: `.partial.mp4` + sidecar JSON suffix convention → Phase 7 backup preserves these files via suffix-only matching.
- **Phase 4 D-05**: `'procedure-review'` route final → Phase 7 search navigates here from procedure rows.
- **Phase 4 D-10**: `procedures.started_at` is the canonical procedure date → Phase 7 search date range applies here.
- **Phase 4 D-11**: `procedure_segments` table for pause markers → Phase 7 search by `procedure status='partial'` uses the convention.
- **Phase 5 D-04**: screenshots persist at `<userData>/data/media/patients/<p>/<proc>/screenshots/<ts>.jpg` → Phase 7 backup captures this subtree.
- **Phase 5 D-07**: `video_path_original` non-destructive trim → Phase 7 backup preserves both paths.
- **Phase 5 P04**: MEDIA_ROUTE_RE + ALLOWED_SUBDIRS defense-in-depth → Phase 7 restore yauzl entry-path filter reuses this pattern.
- **Phase 6 D-02**: bilingual EN+AR parallel columns on `doctor_profile` → Phase 7 i18n keys off `doctor_profile.language`.
- **Phase 6 D-09**: PDF cached on disk at `<userData>/data/reports/<reportId>.pdf` → Phase 7 backup captures this subtree.
- **Phase 6 D-10**: PDF renders EN-only; AR rendering deferred to Phase 7 → picked up as D-25..D-27.
- **Phase 6 D-13**: `@react-pdf/renderer` ^4.5.1 already installed → Phase 7 just adds `Font.register`.

---

*Discussion logged: 2026-08-10*
*User-selected areas: 0 (full skip)*
*Agent-locked decisions: D-01 through D-27*