# Phase 7: Search & History + Audit UI + Backup/Restore + Arabic/RTL - Context

**Gathered:** 2026-08-10
**Status:** Ready for planning

## Phase Boundary

Cross-cutting finishing work that makes the v1 product GCC-market ready: cross-cutting search (date range + doctor + procedure status + name/MRN), a visible audit log UI for compliance, full data backup + restore with `PRAGMA integrity_check`, and bilingual EN+AR UI with full RTL coverage across every shadcn component. Phase 7 also picks up Phase 6 D-10's deferred RPT-06 — Arabic PDF rendering via @react-pdf/renderer with bidi isolation. This phase is the ship gate: every visible UI string must be in both languages before tagging it done.

## Implementation Decisions

### Search scope & placement

- **D-01:** Search lives **on the Patient List as a filter sidebar**, not a new top-level route. Phase 2 already ships name-substring + MRN-exact search at `src/main/db/patients.ts` (`patientRepo.list` + `patientRepo.count`); Phase 7 extends that surface with `dateRange`, `doctorId`, `procedureStatus` filters. The Patient List route is the natural home — it's already where the doctor looks for a patient, and the new filters answer "find everything for Dr. Ahmed between 1-15 March" without leaving the page. Per SRCH-01 verbatim ("name, MRN, date range, doctor"). — **Reversibility:** reversible — the filter row is additive; collapsing it back to the Phase 2 surface is a renderer change only.
- **D-02:** Filter combination is **AND across all dimensions** (name substring AND MRN exact AND date range AND doctor AND procedure status). Each filter has a `Clear` button. Empty filters = no constraint (matches the Phase 2 zero-config behavior). Date range applies to `procedures.started_at` (the canonical procedure date per Phase 4 D-10). "Doctor" filter uses `procedures.doctor_id`. "Procedure status" is a multi-select for `completed` / `partial` / `recording` (per Phase 4 D-03/D-04). — **Reversibility:** reversible — query-side predicate change.
- **D-03:** Search results return **patients as the top-level row** (per SRCH-02's "patient context"). Each patient row expands (existing `PatientRow` accordion pattern from Phase 2) to show their procedures + each procedure's report status. Per-procedure row click navigates to `'procedure-review'; procedureId` (existing route from Phase 4 D-05). Report row click opens the PDF via the existing `reports.openPdf` IPC (Phase 6 D-09). Pagination stays 25 patients per page (Phase 2 default). — **Reversibility:** reversible — accordion content shape.
- **D-04:** New IPC `search.procedures({ patientId? })` returns the procedure list for a given patient (Phase 4 already has `procedures.list({ patientId })` — extend that with the Phase 7 filter params). No new repo; `proceduresRepo.list` grows the filter params. — **Reversibility:** reversible — additive IPC.

### Audit log UI

- **D-05:** Audit log lives on **a new `Audit` sub-page under SettingsHub** (Phase 3 sidebar pattern from G-03-6). Read-only viewer per AUDIT-02 (no edit/delete; the SQL triggers already reject those). New route case `'audit'; null` in the `Route` union. Filters: `dateRange` (from/to), `user` (dropdown populated from `users.list`), `action` (substring match on action name — free text + autocomplete from distinct values), `entityType` (dropdown: `user` / `patient` / `procedure` / `report` / `profile` / `screenshot` / `device` / `audit`). Pagination: 100 rows per page (audit is high-volume; the existing `audit:list` IPC already supports pagination with a 200-row cap per Phase 2 D-05). — **Reversibility:** reversible — additive route + renderer surface.
- **D-06:** Each audit row is **a compact one-line summary** ("12:34:56 · Dr. Ahmed · `procedure.finalized` · procedure abc123"). Click expands an inline detail dialog (existing shadcn Dialog from Phase 2) showing `userId`, `action`, `entityType`, `entityId`, `metadata` (JSON pretty-printed), `outcome`, `createdAt`. No click-through to the entity — the entity-browse path lives on Patient List (D-01..D-03). Audit page is for compliance/forensics, not navigation. — **Reversibility:** reversible — UI surface only.
- **D-07:** Audit UI reads via the **existing `audit:list` IPC** (Phase 2). New renderer hook `useAudit({ filters, page })` SWR-style, matching the `useProcedures` / `useDoctorProfile` pattern from Phase 5/6. No main-side change to `audit:list`. — **Reversibility:** reversible — renderer hook.
- **D-08:** Audit page emits a `audit_view` audit row of its own (per AUDIT-01: "every login, procedure view, … is recorded"). The renderer fires `audit.log({ action: 'audit_view' })` once on page mount (debounced 1s). Self-referential but matches the established audit-on-every-read pattern from Phase 2 Fix 6. — **Reversibility:** reversible — additive audit action.

### Backup contents & flow

- **D-09:** Backup is a **zip of `<userData>/data/` subtree ONLY** (excludes `logs/` per Phase 1 D-02 startup-log sibling layout; excludes any license/temp files outside `data/`). Contents: `app.db` + `app.db-wal` + `app.db-shm` + `media/patients/<id>/<id>/` (videos + screenshots) + `profiles/<userId>/` (signatures + logos per Phase 6) + `reports/<reportId>.pdf` (per Phase 6 D-09). Default zip filename: `colonoscopist-backup-<YYYY-MM-DDTHH-mm-ss>.zip`. — **Reversibility:** reversible — output path is a constant.
- **D-10:** Backup flow uses **`PRAGMA wal_checkpoint(TRUNCATE)` then `better-sqlite3` `.backup()` to a temp file, then zip** the temp db + media + profiles + reports into one archive (per PITFALLS §Pitfall 9 — captures a fully-checkpointed DB without a half-written WAL). The Phase 2 D-04 `wal_checkpoint(TRUNCATE)` helper is reused; `better-sqlite3` exposes `db.backup(path)` natively. Temp db file is cleaned up after the zip stream closes (`finally` block). — **Reversibility:** costly — the backup format is referenced by Phase 7 restore (D-12) and by future "migrate to new workstation" flows.
- **D-11:** Backup UI lives on **a new `Backup & Restore` sub-page under SettingsHub**. Backup button: pick destination via Electron's `dialog.showSaveDialog` (defaultPath = `colonoscopist-backup-<timestamp>.zip`) → run D-10 → show inline progress (no modal per UX-Pitfalls table) → on success: toast "Backup created at <path>" with a **"Reveal in Explorer"** affordance via `shell.showItemInFolder(path)` (matches the Phase 6 D-09 PDF reveal pattern). — **Reversibility:** reversible — UI surface.
- **D-12:** Backup warns but **does not block** if there's an active recording or open procedure: inline alert "For best results, close any active procedure before backing up" (per PITFALLS §Pitfall 9). The user can override; the doc notes that the most recent backup is the recovery fallback if anything is mid-write. — **Reversibility:** reversible — UI gate only.

### Restore flow & safety

- **D-13:** Restore is a **two-step flow**: (1) pick backup zip + staging directory via `dialog.showOpenDialog` × 2 → (2) preview the contents (filename, total uncompressed size, count of patients/procedures/reports/media files parsed from the DB after unpack) → (3) explicit `Restore` button with a `ConfirmDialog` saying "This will unpack to <staging dir>. Your active data folder is unchanged." After unpack: run `PRAGMA integrity_check` on the staged db; surface pass/fail in the dialog. — **Reversibility:** reversible — UI flow.
- **D-14:** Restore unpacks to **`<userData>/data-restore-<timestamp>/`** (sibling of the active `data/` directory). Doctor can inspect files in the staging directory manually if needed (explorer reveal). The active `data/` folder is **NEVER** overwritten by Phase 7 — only an explicit "Activate this backup" button would swap directories, and Phase 7 ships that button as a disabled placeholder with a v1.1 tooltip. This bounds the data-loss blast radius; v1.1 can wire activation later without schema change. — **Reversibility:** reversible — UI affordance.
- **D-15:** Restore uses **`yauzl` for streaming unzip** (per RESEARCH §STACK — already in `package-lock.json` as a transitive dep of `@types/yauzl`, will be added directly). Filter rejects entries with absolute paths or `..` segments (per Phase 5 P04 MEDIA_ROUTE_RE + ALLOWED_SUBDIRS defense-in-depth pattern). On entry `app.db` is replaced with the staged copy of `app.db` (not merged — full restore means full restore). — **Reversibility:** reversible — restore format matches backup (D-09).
- **D-16:** Restored DB passes **`PRAGMA integrity_check`** end-to-end per ROADMAP Phase 7 success criterion #6. After unpack, main runs `db.prepare('PRAGMA integrity_check').get()` on the staged DB and returns the result string. UI surfaces "ok" or the error message. Any non-ok result blocks the "Activate this backup" button. — **Reversibility:** reversible — integrity check is a single SQL call.

### i18n: language storage & UX

- **D-17:** Language preference is **per-doctor**, stored on a new `doctor_profile.language TEXT NULL` column (per I18N-01). NULL = follow workstation default. Migration `0007_doctor_profile_language.sql` adds the column. The doctor picks their language on Settings → Profile (existing page from Phase 6); the existing `useDoctorProfile` hook reads it. Falls back to `users.language` (D-18) when `doctor_profile.language IS NULL`. — **Reversibility:** costly — migration + schema column; the `doctor_profile` table already exists so the migration is small but the column is referenced by every renderer's language resolver.
- **D-18:** Workstation default language is **per-user, set at the existing Wizard** (Phase 2 wizard collects `fullName` + `clinicName`). Wizard gains a 4th step: language radio (EN / AR). Stored on `users.language TEXT NOT NULL DEFAULT 'en'` — added by the same migration as D-17 (one ALTER TABLE on `users`, one on `doctor_profile`). Existing wizards don't backfill (silent default = 'en'); first re-login after Phase 7 ships prompts the user to pick. — **Reversibility:** costly — `users.language` is referenced by every renderer's language resolver.
- **D-19:** Document direction flip is **instant** — `<html dir>` and `<html lang>` attributes flip on language change, then `i18next.changeLanguage()` swaps the bundle. No reload. i18next fires from a single `useLanguage()` hook called at the renderer entry (`src/renderer/src/main.tsx`); every page reads translations via `useTranslation()` (the standard react-i18next pattern). — **Reversibility:** reversible — i18next config + provider.
- **D-20:** i18n library = **`i18next` + `react-i18next` + `i18next-browser-languagedetector`** per RESEARCH §STACK + §PITFALLS §Pitfall 7. Bundles at `src/renderer/src/i18n/{en,ar}/translation.json`. ICU message format for medical text with placeholders (e.g., `"procedure.startedAt": "Started at {{date, time}}"`). AR values are full strings (NOT auto-translated) per the Translation Pitfalls table — no machine translation in offline-only app. — **Reversibility:** costly — translation keys are referenced by every component.

### RTL coverage & shadcn smoke

- **D-21:** RTL test surface = **every shadcn component used by the renderer, in a Playwright smoke test**. Current inventory at `src/renderer/src/components/ui/`: `button`, `card`, `input`, `label`, `dialog`, `dropdown-menu`, `select`, `scroll-area`, `alert`, `badge`, `avatar`, `checkbox`, `textarea`, `accordion`, `sonner`. REQUIREMENTS I18N-03 mentions `calendar` but Phase 7 does NOT install it (no procedure-calendar feature in scope; per REQUIREMENTS OUT-OF-SCOPE "Insurance, billing, scheduling" is excluded). Phase 7 installs **`popover`** (Radix primitive, used by `dropdown-menu` already — separate component path) and `tooltip` for completeness; both verified in the smoke. Slider (per I18N-03) is also not currently installed — Phase 7 installs it as a transitive check; if no usage emerges in Phase 7, it's a tested-but-unused artifact. — **Reversibility:** reversible — additive installs.
- **D-22:** RTL smoke strategy = **Playwright boots the renderer with `dir='rtl'`, navigates to every route, asserts no overflow on the right edge of the viewport, and screenshots for visual regression**. One test per route that mounts any of the D-21 components (Login, Patient List, Procedure Room, Procedure Review, Report Editor, Profile Editor, SettingsHub + each sub-page). Pure renderer; no main-side touch. The smoke lives at `tests/renderer/rtl/` and runs in the existing `npm run test:e2e` script. — **Reversibility:** reversible — test additions.
- **D-23:** Tailwind config uses **`rtl:` variants natively** (Tailwind 3.4 supports them when `dir` is set on a parent). No `tailwindcss-rtl` plugin — one less dep; the variants cover `margin`, `padding`, `text-align`, `float`, `border-radius`, and `space-x` flips for RTL contexts. shadcn primitives that depend on Radix (`Dialog`, `DropdownMenu`, `Select`) propagate `dir` via Radix's `DirectionProvider` — verified during D-22 smoke. — **Reversibility:** reversible — Tailwind config + per-class `rtl:` annotations.
- **D-24:** RTL ↔ i18n key parity check = **a Vitest unit test that walks every English key in `src/renderer/src/i18n/en/translation.json` and asserts the same key exists in `src/renderer/src/i18n/ar/translation.json`**. Catches "EN has the new field but AR doesn't" drift — the historical bug class that ships with a half-translated experience (per PITFALLS §Translation table "Login screen in Arabic but menu in English"). — **Reversibility:** reversible — test addition.

### AR PDF (deferred RPT-06 from Phase 6 D-10)

- **D-25:** AR PDF is the **full report, not just the header**. Phase 6 D-10 deferred to Phase 7; Phase 7 picks up: `@react-pdf/renderer` `Font.register` for an Arabic TTF + bidi `<Text direction='rtl'>` wrappers for the doctor name, clinic name, findings/diagnosis/recommendations body + numeric fragment isolation per PITFALLS §Pitfall 8. The Arabic TTF source = **Noto Sans Arabic** (SIL OFL license, freely embeddable, broad glyph coverage for clinical text). Bundled under `src/main/pdf/fonts/NotoSansArabic-Regular.ttf` (new dir). @react-pdf/renderer `Font.register({ family: 'NotoSansArabic', src: path.join(...) })` at the top of `report.tsx`. — **Reversibility:** costly — bundled TTF is committed; switching fonts later is a swap of the file + `Font.register` call.
- **D-26:** AR-specific layout is **NOT a separate template** — same `src/main/pdf/report.tsx` React component (Phase 6), with conditional rendering based on `language: 'en' | 'ar'` passed via `renderReportPdf(reportId, { language })`. The `language` is read from the active doctor's `doctor_profile.language` (D-17), falling back to `users.language` (D-18), falling back to `'en'`. The template conditionally applies `direction: 'rtl'` on `<Document>` + loads NotoSansArabic for body text in AR mode. — **Reversibility:** reversible — render-side branching.
- **D-27:** AR smoke test is **mandatory ship-gate** per PITFALLS §Pitfall 8 — a `RUN_SMOKE=1` integration test that renders one AR report, writes to `<userData>/data/reports/<reportId>.pdf`, asserts file size > 50KB, and asserts the file opens cleanly (PDF magic bytes). Visual inspection of bidi ordering (numeric fragments LTR, Arabic body RTL, signature bottom-right in AR mode per PITFALLS §Pitfall 8) is a **manual** smoke step documented in `07-UAT.md` (out of test scope; pixel-level PDF inspection needs a human). The auto assertion catches "render crashed → 0KB file" and "Font.register failed → missing glyphs". — **Reversibility:** reversible — test addition.

### Audit hooks

- Phase 7 audit actions: `backup.created` (metadata: `{ path, sizeBytes, dbIntegrityCheck, procedureCount }`), `backup.failed`, `restore.previewed` (metadata: `{ zipPath, stagingDir, contents }`), `restore.completed` (metadata: `{ stagingDir, integrityCheck, fileCount }`), `restore.failed`, `restore.activated` (v1.1 placeholder — metadata: `{ from, to }`), `audit_view` (D-08), `language.changed` (metadata: `{ from, to, scope: 'wizard'|'profile' }`).
- All events flow through `src/main/db/audit.ts:audit()` (Phase 2) — no bypassing. AUDIT-01 verbatim.

### the agent's Discretion

- Search filter UI layout (top bar vs left sidebar vs collapsible right rail) — agent picks based on the existing Patient List density.
- Date range picker component — Phase 7 adds `@radix-ui/react-popover` + a thin date-range input (two `<Input type="date">` + a "to" label). No date-picker library dep — native HTML date inputs are accessible + RTL-safe + zero-dep per ponytail ladder.
- Audit row timestamp format (locale-aware via `Intl.DateTimeFormat` vs fixed `YYYY-MM-DD HH:MM:SS`) — agent picks. Recommend locale-aware since i18n is shipping in this phase.
- Backup progress UX (determinate % via `archiver` progress events vs indeterminate inline spinner) — recommend indeterminate (archiver's progress API is awkward; the doctor clicks Backup, gets a toast — total duration is usually <30s for clinic-scale data).
- Whether the AR TTF is committed to the repo (~700KB) or fetched at build time — recommend committed (offline-only app; build-time fetch adds a network step that defeats the air-gap guarantee).
- Whether `Slider` and `Calendar` get installed as D-21 tests (they're in I18N-03 verbatim) — recommend installing Slider (used by report editor brightness/etc in a future phase); skip Calendar (no use case in v1).
- Migration filename for D-17/D-18 — recommend `0007_doctor_profile_language_and_users_language.sql` (covers both ALTER TABLEs in one file).
- Exact audit action list naming (D-08 etc) — agent finalizes; above is the seed set.

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements

- `.planning/ROADMAP.md` §Phase 7 — Goal, success criteria (incl. #6 PRAGMA integrity_check after restore), pitfalls addressed (7, 9)
- `.planning/REQUIREMENTS.md` §SRCH-01..03, §SET-05, §SET-06, §I18N-01..03, §AUDIT-01, §AUDIT-02, §RPT-06 (deferred from Phase 6 to Phase 7)
- `.planning/PROJECT.md` §Key Decisions (i18next + RTL, archiver + yauzl for backup, offline-only), §Constraints (no network, no cloud, no DICOM), §Out of Scope (cloud, billing, scheduling — Calendar is excluded per this)
- `.planning/STATE.md` §Current Focus (Phase 7 next milestone), §Phase 6 decisions (carry-forward D-02, D-09, D-10, D-13)

### Technical research (stack, pitfalls, architecture)

- `.planning/research/STACK.md` §Supporting Libraries (`archiver`/`yauzl` for backup, `i18next` + `react-i18next` + `i18next-browser-languagedetector` for i18n, `@react-pdf/renderer` ^4 — used by Phase 6 PDF and continuing into Phase 7 AR), §RTL handling (`<html dir>` + Radix `dir`), §Version Compatibility (Tailwind 3.4 + `rtl:` variants)
- `.planning/research/PITFALLS.md` §Pitfall 7 (RTL in shadcn components — slider, dropdown, dialog, calendar, popover all need explicit smoke), §Pitfall 8 (PDF RTL bidi — numbers/Latin fragments need `<Text direction='ltr'>` isolation; @react-pdf/renderer bidi is partial), §Pitfall 9 (backup captures partial DB — `PRAGMA wal_checkpoint(TRUNCATE)` + `better-sqlite3 .backup()` to temp file), §Translation table (no machine translation, full AR strings, per-language completeness), §Performance Traps (per-row re-render of audit log — paginate at 100/page; "after zip completes, modal offers 'Open folder'"), §Patterns to avoid (mixing AR + EN in same JSON bundle, embedding assets as base64 in DB)
- `.planning/research/ARCHITECTURE.md` §Component Responsibilities §Backup/restore (main side, `src/main/backup/`), §i18n (renderer side, `src/renderer/i18n/`), §Recommended Project Structure (`src/main/backup/{index,restore}.ts`, `src/renderer/i18n/`), §Data Flow (backup snapshots DB then streams zip; restore streams unzip + integrity check)
- `.planning/research/SUMMARY.md` §Phase 7 implications (search + audit are small additions; AR+RTL is the hard ship-blocker; i18next + Radix `dir` is documented)

### Phase 1–6 context (carry forward)

- `.planning/phases/01-scaffold/01-CONTEXT.md` — D-02 (startup-log at `userData/logs/`, NOT inside `data/` — confirmed backup excludes logs), D-06 (no i18n scaffolding in Phase 1)
- `.planning/phases/02-database-patient-audit-auth/02-CONTEXT.md` — D-04 (`PRAGMA wal_checkpoint(TRUNCATE)` helper wired from day 1 for Phase 7 backup), D-05 (`audit:list` IPC with date-range filter + pagination — Phase 7 audit UI reads this), Phase 2 decisions (audit-on-every-read pattern from Fix 6 — applied to D-08)
- `.planning/phases/03-capture-enumeration-live-preview/03-CONTEXT.md` — D-06 (SettingsSidebar mounted on all three Settings pages; G-03-3 SettingsHub pattern from 03-05 — Phase 7 audit + backup routes follow the same sidebar entry pattern)
- `.planning/phases/04-recording-timer-device-lost/04-CONTEXT.md` — D-03 (`.partial.mp4` + sidecar JSON convention — backup preserves this suffix), D-05 (`'procedure-review'` route final — Phase 7 search navigates here), D-10 (`procedures.started_at` is the canonical date — Phase 7 search date range applies here), D-11 (`procedure_segments` table for pause markers — search by `procedure status='partial'` uses the convention)
- `.planning/phases/05-screenshots-procedure-review-trim/05-CONTEXT.md` — D-04 (`screenshots` table shape — backup captures `<userData>/data/media/patients/<p>/<proc>/screenshots/<ts>.jpg` per file-path convention), D-07 (`video_path_original` non-destructive trim — backup preserves both original + trimmed paths), P04 (MEDIA_ROUTE_RE + ALLOWED_SUBDIRS defense-in-depth — D-15 reuses the yauzl entry-path filter pattern)
- `.planning/phases/06-doctor-profile-report-editor-pdf-generation/06-CONTEXT.md` — D-02 (bilingual EN+AR parallel columns on `doctor_profile` — Phase 7 i18n keys off `doctor_profile.language` per D-17), D-09 (PDF cached on disk at `<userData>/data/reports/<reportId>.pdf` — backup captures this subtree), D-10 (PDF renders EN-only; AR rendering deferred to Phase 7 — picked up as D-25..D-27), D-13 (`@react-pdf/renderer` ^4.5.1 already installed — Phase 7 just adds `Font.register`)

### Skills & procedures (how to ship Phase 7)

- `.opencode/skills/electron-vite/SKILL.md` — Three-process model; Phase 7 main-side backup/restore IPC handlers + renderer-side audit page
- `.opencode/skills/electron-sqlite/SKILL.md` §Backup/restore flows (`PRAGMA wal_checkpoint(TRUNCATE)`, `db.backup()` API, integration_check), §Migration runner (D-17/D-18 migration)

### Existing utilities (reuse, don't reinvent)

- `src/main/db/audit.ts:audit()` — Phase 7 audit page self-audits via D-08 + emits backup/restore events via the Audit hooks section
- `src/main/db/patients.ts:patientRepo.list` (Phase 2) — Phase 7 search extends the filter matrix with `dateRange` + `doctorId` + `procedureStatus` (D-02)
- `src/main/db/procedures-repo.ts:proceduresRepo.list` (Phase 4) — Phase 7 search adds filter params (D-04)
- `src/main/db/migrations.ts` — Phase 7 adds `0007_doctor_profile_language_and_users_language.sql` per agent's discretion
- `src/main/paths.ts:dataDir()` (Phase 2) — Phase 7 adds `restoreStagingDir(timestamp)` for D-14 sibling-directory layout
- `src/main/auth/session.ts:session.currentUserId` (Phase 2) — Phase 7 audit + backup require session
- `src/main/db/doctor-profile-repo.ts` (Phase 6) — Phase 7 adds `language` to the upsert input
- `src/main/pdf/report.tsx` (Phase 6) — Phase 7 adds `Font.register` + AR `direction='rtl'` rendering (D-25/D-26)
- `src/renderer/src/hooks/useProcedures.ts` (Phase 5), `useDoctorProfile.ts` (Phase 6) — Phase 7 adds `useAudit` + `useLanguage` hooks matching the SWR-style pattern
- `src/renderer/src/lib/router.ts` (Phase 2) — Phase 7 adds `'audit'; null` + `'backup-restore'; null` to the Route union
- `src/renderer/src/components/SettingsSidebar.tsx` (Phase 3, G-03-6) — Phase 7 adds `Audit` + `Backup & Restore` entries; same sidebar shared on all Settings sub-pages
- `src/renderer/src/components/ui/dialog.tsx` (Phase 2) — Phase 7 audit row detail + restore confirm use the existing shadcn Dialog

### Established Patterns

- **Typed IPC contract via contextBridge** — every renderer-callable method defined once in `src/shared/ipc-contract.ts`. Phase 7 extends `audit.*`, `patients.*`, `procedures.*`, `doctorProfile.*`, and adds `backup.*` + `restore.*`.
- **One-way renderer → main for mutations, optimistic UI avoided** — backup/restore are awaited before navigation; search filters update on submit (no keystroke-fire).
- **Audit-on-every-mutation** — `audit({ action: 'backup.created' | ..., entityType: 'backup' | 'restore' | 'audit' | 'language', entityId, metadata: { ... } })` for every Phase 7 event.
- **No `any` in IPC contracts** — TS strict mode continues.
- **UserData-relative paths** — D-09 zip captures `<userData>/data/` subtree, paths resolved on read time.
- **Single ffmpeg child per operation** — N/A for Phase 7 (no ffmpeg in this phase).
- **Inline status, no modal** — UX-Pitfalls table; backup progress is inline + toast on success, not a blocking modal.
- **shadcn primitives only** — Tailwind + shadcn; no new UI library. Phase 7 installs `popover`, `tooltip`, `slider` per D-21.
- **Migration per logical group** — single `0007_doctor_profile_language_and_users_language.sql` covers both ALTER TABLEs.
- **Two-directory model for restore** (D-14) — bounds the data-loss blast radius; matches PITFALLS §Pitfall 9 "doctor's last backup is the fallback".

### Integration Points

- `src/main/index.ts` — wires `registerBackupIpc()` + `registerRestoreIpc()` + extends `registerAuditIpc()` with the search/filter params after the existing patient/procedure/screenshot/report/profile IPC. Backup/restore IPC must register AFTER auth so `requireSession()` resolves.
- `src/preload/index.ts` — `api` object grows with `backup.*` + `restore.*` + extended `audit.*` namespaces.
- `src/main/db/migrations/` — adds `0007_doctor_profile_language_and_users_language.sql`.
- `src/main/db/doctor-profile-repo.ts` — `upsert(input)` gains `language?: 'en' | 'ar' | null`.
- `src/main/db/users-repo.ts` — `create` + `wizardBootstrap` gain `language: 'en' | 'ar'`.
- `src/main/db/procedures-repo.ts` — `list(filters)` extends with `dateRange?` + `doctorId?` + `procedureStatus?`.
- `src/main/db/patients-repo.ts` — `list(filters)` extends with the same Phase 7 params so Patient List can show "this patient has procedures in your date range".
- `src/main/backup/{index,restore,snapshot}.ts` (new) — `snapshot(db, outPath)` wraps `PRAGMA wal_checkpoint(TRUNCATE)` + `db.backup(outPath)`; `createBackup(opts)` streams archiver zip; `restoreBackup({ zipPath, stagingDir })` streams yauzl unzip + integrity check.
- `src/main/pdf/report.tsx` — adds `Font.register({ family: 'NotoSansArabic', src: ... })` + bilingual `<Text>` wrappers (D-25/D-26).
- `src/shared/ipc-contract.ts` — extend `IPC` constants + `IpcContract` interface + `Language` + `AuditFilters` + `BackupResult` + `RestorePreview` types.
- `src/renderer/src/i18n/{en,ar}/translation.json` (new) — i18next bundles. `en` starts as the literal strings already in the renderer; `ar` is the Arabic mirror (translated by the user/clinic, not auto-generated).
- `src/renderer/src/main.tsx` — `i18n.init()` on boot; `useLanguage()` hook reads `users.language` via `auth.status` and applies `dir` to `<html>`.
- `src/renderer/src/pages/SettingsHub.tsx` (Phase 3) — Phase 7 adds `Audit` + `Backup & Restore` sub-page entries in SettingsSidebar.
- `src/renderer/src/pages/Audit.tsx` (new) — full audit log viewer (D-05..D-08).
- `src/renderer/src/pages/BackupRestore.tsx` (new) — backup + restore sub-page (D-11..D-15).
- `src/renderer/src/pages/PatientsList.tsx` (Phase 2) — Phase 7 adds the filter sidebar (D-01..D-03).
- `src/renderer/src/pages/Wizard.tsx` (Phase 2) — Phase 7 adds the language radio step (D-18).
- `src/renderer/src/pages/ProfileEditor.tsx` (Phase 6) — Phase 7 adds the per-doctor language picker (D-17).
- `src/renderer/src/App.tsx` — add `'audit'; null` + `'backup-restore'; null` route cases, gated on `status.authenticated`.

## Specific Ideas

- **Filter sidebar matches SettingsHub's visual density** — same Card layout, same input height, same spacing. Doctor's mental model: "another Settings-shaped surface".
- **Audit row timestamp via `Intl.DateTimeFormat`** with the active language — automatic AR/EN formatting for free.
- **Backup filename includes a sortable timestamp** (`colonoscopist-backup-2026-08-10T14-23-05.zip`) — works on Windows filesystems (no `:`).
- **Restore preview counts parsed from the staged DB** — `SELECT count(*) FROM patients`, `FROM procedures`, `FROM reports`. Surface as "12 patients · 47 procedures · 12 reports · 1.2 GB media" so the doctor sees what they're about to unpack.
- **i18n key naming = dotted sections** (`procedure.startedAt`, `patient.searchPlaceholder`) — matches react-i18next convention; D-24 parity check walks the dotted path.
- **AR TTF committed under `src/main/pdf/fonts/`** — bundled at build time; no network fetch (offline-only mandate).
- **Restore staging dir is userData-sibling** — `<userData>/data-restore-<timestamp>/`. The doctor can inspect it with File Explorer if the auto-restore hits a snag.
- **RTL smoke runs as part of `npm run test:e2e`** — existing Playwright infrastructure. One test per route + a "language toggle" test that flips EN ↔ AR and asserts `document.dir` switches.
- **Per-language completeness check** (D-24) — runs in `npm run test:unit` (Vitest). Fast feedback before Playwright even boots.

## Deferred Ideas

- **Restore "Activate this backup" button** — Phase 7 ships the button as a disabled placeholder with a v1.1 tooltip (D-14). Full directory-swap implementation requires careful handling of open file handles (SQLite, MediaServer) and is parked per PITFALLS §Pitfall 9 ("doctor's last backup is the fallback").
- **Full-text search across report findings/diagnosis** (SRCH-04) — v2 requirement. Phase 7 ships structured-filter search; FTS5 on `reports.findings`/`reports.diagnosis` is a future migration.
- **Scheduled/automated backups** — out of v1 scope per PROJECT §Out-of-Scope ("Cloud sync" defer pattern). Doctor runs backup manually.
- **Backup to network share / cloud** — hard ban per offline-only mandate + OUT-OF-SCOPE. Local destination only.
- **Backup encryption at rest** — Phase 2 already encrypts sensitive fields via `safeStorage`; the backup zip is plaintext. v1.1 hardening could AES-encrypt the zip with a clinic-set passphrase.
- **Multi-language (Urdu, Persian)** (I18N-04) — v2 requirement. Phase 7 ships EN+AR per I18N-01 verbatim.
- **Per-clinic language override** — current scope is per-doctor (D-17). A clinic-wide default that overrides individual doctors is a v1.1 if GCC clinics with mixed teams request it.
- **Calendar component** (in I18N-03 verbatim) — no use case in v1 (scheduling is out of scope). If a future phase adds procedure-scheduling, the calendar installs then with full RTL coverage.
- **Arabic voice input for findings** — out of v1 scope (speech-to-text is OUT-OF-SCOPE per REQUIREMENTS). The doctor types or pastes Arabic text.
- **Auto-translation of report body EN → AR** — out of v1 scope. Phase 7 ships the AR template only when the doctor types in AR.
- **Backup differential/incremental** — every backup is full (D-09). Diff/incremental complicates restore validation; full-zip is simpler + small for clinic-scale data.
- **Backup integrity check BEFORE the operation starts** — Phase 7 only checks the DB after restore. Pre-flight integrity check on the source DB is a v1.1 hardening (catches a half-corrupt source before zipping it).

---

*Phase: 7-search-history-audit-ui-backup-restore-arabic-rtl*
*Context gathered: 2026-08-10*