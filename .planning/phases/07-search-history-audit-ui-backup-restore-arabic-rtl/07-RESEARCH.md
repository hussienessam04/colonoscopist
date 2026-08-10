# Phase 7: Search & History + Audit UI + Backup/Restore + Arabic/RTL — Research

**Researched:** 2026-08-10
**Domain:** Electron desktop app — cross-cutting finishing work (search filter sidebar, audit log UI, zip backup with integrity check, i18next + RTL, AR PDF bidi)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Search lives **on the Patient List as a filter sidebar**, not a new top-level route. Phase 7 extends `patientRepo.list` with `dateRange`, `doctorId`, `procedureStatus` filters.
- **D-02:** Filter combination is **AND across all dimensions**. Each filter has `Clear`. Empty = no constraint. Date range applies to `procedures.started_at`. Doctor uses `procedures.doctor_id`. Procedure status is a multi-select (`completed`/`partial`/`recording`).
- **D-03:** Search results return **patients as top-level row**. Each row expands (existing `PatientRow` accordion) showing procedures + report status. Procedure row click → `'procedure-review'; procedureId`. Report row click → `reports.openPdf`. Pagination stays 25/page.
- **D-04:** New IPC `search.procedures({ patientId? })` extends existing `procedures.list` with the Phase 7 filter params. No new repo; `proceduresRepo.list` grows.
- **D-05:** Audit log on **new `Audit` sub-page under SettingsHub**. Read-only. New route case `'audit'; null`. Filters: `dateRange`, `user` (dropdown), `action` (substring + autocomplete), `entityType` (dropdown). 100 rows/page.
- **D-06:** Audit row = **compact one-line** (`12:34:56 · Dr. Ahmed · procedure.finalized · procedure abc123`). Click expands Dialog showing userId/action/entityType/entityId/metadata/outcome/createdAt.
- **D-07:** Audit UI reads via existing **`audit:list` IPC** + new `useAudit` SWR-style hook. No main-side change to `audit:list`.
- **D-08:** Audit page emits a **`audit_view` audit row** on mount (debounced 1s via `audit.log({ action: 'audit_view' })`).
- **D-09:** Backup = zip of `<userData>/data/` subtree ONLY. Excludes `logs/`. Contents: `app.db` + WAL/SHM + `media/patients/<id>/<id>/` + `profiles/<userId>/` + `reports/<reportId>.pdf`. Default filename: `colonoscopist-backup-<YYYY-MM-DDTHH-mm-ss>.zip`.
- **D-10:** Backup flow = **`PRAGMA wal_checkpoint(TRUNCATE)` then `better-sqlite3` `.backup()` to a temp file, then zip**. Temp db cleaned up after zip stream closes (finally block).
- **D-11:** Backup UI on **new `Backup & Restore` sub-page under SettingsHub**. `dialog.showSaveDialog` defaultPath + inline progress + toast on success with **"Reveal in Explorer"** via `shell.showItemInFolder(path)`.
- **D-12:** Backup warns but **does not block** if active recording or open procedure: inline alert "For best results, close any active procedure before backing up".
- **D-13:** Restore = **two-step flow**: (1) pick zip + staging dir via `dialog.showOpenDialog` × 2 → (2) preview contents (filename, total uncompressed size, count of patients/procedures/reports/media) → (3) explicit `Restore` button with `ConfirmDialog`.
- **D-14:** Restore unpacks to **`<userData>/data-restore-<timestamp>/`** (sibling of `data/`). Active `data/` NEVER overwritten by Phase 7. "Activate this backup" button ships as **disabled placeholder** with v1.1 tooltip.
- **D-15:** Restore uses **`yauzl` for streaming unzip**. Filter rejects absolute paths or `..` segments. `app.db` is replaced (not merged).
- **D-16:** Restored DB passes **`PRAGMA integrity_check`** end-to-end. After unpack, main runs the check + returns pass/fail string. Any non-ok blocks "Activate this backup".
- **D-17:** Language preference is **per-doctor**, on new `doctor_profile.language TEXT NULL` column. NULL = follow workstation default. Migration `0007_*.sql` adds the column. Falls back to `users.language` (D-18) when NULL.
- **D-18:** Workstation default language is **per-user, set at Wizard step 4** (EN/AR radio). Stored on `users.language TEXT NOT NULL DEFAULT 'en'` (same migration). Existing wizards silently default to 'en'.
- **D-19:** Document direction flip is **instant** — `<html dir>` + `<html lang>` flip on language change, then `i18next.changeLanguage()` swaps bundle. No reload. Single `useLanguage()` hook at renderer entry.
- **D-20:** i18n library = **`i18next` + `react-i18next` + `i18next-browser-languagedetector`**. Bundles at `src/renderer/src/i18n/{en,ar}/translation.json`. ICU message format. AR values are **full strings** (NOT auto-translated).
- **D-21:** RTL test surface = **every shadcn component used by the renderer, in a Playwright smoke test**. Phase 7 installs **`popover` + `tooltip` + `slider`** via `npx shadcn add`. Calendar NOT installed (out of scope).
- **D-22:** RTL smoke = **Playwright boots renderer with `dir='rtl'`, navigates every route, asserts no overflow on the right edge, screenshots for visual regression**. At `tests/renderer/rtl/`.
- **D-23:** Tailwind uses **`rtl:` variants natively** (Tailwind 3.4). No `tailwindcss-rtl` plugin. shadcn Radix primitives propagate `dir` via `DirectionProvider`.
- **D-24:** RTL ↔ i18n key parity check = **Vitest unit test walks every EN key + asserts same key exists in AR bundle**. Catches "EN has new field but AR doesn't".
- **D-25:** AR PDF is **full report, not just header**. `Font.register` for NotoSansArabic TTF + bidi `<Text direction='rtl'>` wrappers. TTF bundled at `src/main/pdf/fonts/NotoSansArabic-Regular.ttf` (SIL OFL).
- **D-26:** AR-specific layout is **NOT a separate template** — same `src/main/pdf/report.tsx`, conditional rendering based on `language: 'en' | 'ar'` via `renderReportPdf(reportId, { language })`. Language read from `doctor_profile.language` → `users.language` → `'en'`.
- **D-27:** AR smoke test is **mandatory ship-gate** — `RUN_SMOKE=1` integration test renders one AR report, asserts file size > 50KB, asserts PDF magic bytes. Visual bidi inspection is **manual** in `07-UAT.md`.

### the agent's Discretion

- Search filter UI layout (top bar vs left sidebar vs collapsible right rail) — pick based on Patient List density. UI-SPEC.md already locked: **filter sidebar** on left, `lg:grid-cols-[18rem_minmax(0,1fr)]`.
- Date range picker component — agent picks. Per ladder: **two native `<input type="date">` + a "to" label**. No date-picker library dep.
- Audit row timestamp format — pick. **Locale-aware via `Intl.DateTimeFormat`** since i18n ships this phase.
- Backup progress UX — pick. **Indeterminate inline spinner** (archiver's progress API is awkward; total duration <30s).
- AR TTF committed to repo (~700KB) or fetched at build time — pick. **Committed** (offline-only mandate; no build-time network).
- Whether `Slider` and `Calendar` get installed — pick. **Install Slider** (defensive I18N-03 ship-gate). **Skip Calendar** (no scheduling feature).
- Migration filename — pick. **`0007_doctor_profile_language_and_users_language.sql`** (covers both ALTER TABLEs).
- Exact audit action list naming — finalize. Listed in §Audit hooks below.

### Deferred Ideas (OUT OF SCOPE)

- **Restore "Activate this backup" button** — Phase 7 ships as disabled placeholder with v1.1 tooltip (D-14).
- **Full-text search across report findings/diagnosis** (SRCH-04) — v2.
- **Scheduled/automated backups** — out of v1.
- **Backup to network share / cloud** — hard ban.
- **Backup encryption at rest** — v1.1 hardening.
- **Multi-language (Urdu, Persian)** (I18N-04) — v2.
- **Per-clinic language override** — v1.1 if GCC clinics request.
- **Calendar component** — v1.1+ if scheduling ships.
- **Arabic voice input for findings** — out of scope.
- **Auto-translation of report body EN → AR** — out of scope.
- **Backup differential/incremental** — full-zip only in v1.
- **Pre-flight backup integrity check on source DB** — v1.1 hardening.

### Audit Hooks (locked list per 07-CONTEXT.md §Audit hooks)

Phase 7 audit actions: `backup.created`, `backup.failed`, `restore.previewed`, `restore.completed`, `restore.failed`, `restore.activated` (v1.1 placeholder), `audit_view`, `language.changed`. All flow through `src/main/db/audit.ts:audit()` (Phase 2). AUDIT-01 verbatim.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **SRCH-01** | User can search patient history by name (substring), MRN, date range, and doctor. | §3 (Search); §10 IPC extensions; §8 `patientRepo.list` extends with dateRange/doctorId; §6 zod schema |
| **SRCH-02** | Search results return matching procedures with their associated reports and patient context. | §3 (Search); §10 `search.procedures` IPC; §6 accordion expansion per D-03 |
| **SRCH-03** | Procedure list view paginates; per-row click opens the procedure review screen. | §3 (Search); §10 existing `procedures:list` + route case preserved; §11 25/page pagination |
| **SET-05** | User can run a backup (zip the data folder) and choose a destination path. | §4 (Backup); §10 `backup.create` IPC + `dialog.showSaveDialog`; §6 `archiver` + WAL checkpoint pattern |
| **SET-06** | User can restore from a backup zip into a chosen directory (does not overwrite the active data folder without confirmation). | §4 (Restore); §10 `restore.preview` + `restore.unpack` IPC; §6 yauzl entry-path filter |
| **I18N-01** | UI is bilingual (English + Arabic); language switch is per-doctor. | §5 (i18n); §10 `profile.update` extends with `language`; §7 migration adds `doctor_profile.language` |
| **I18N-02** | Document direction (`<html dir>`) flips between LTR (English) and RTL (Arabic) on language change. | §5 (i18n); §10 `useLanguage()` hook at `main.tsx`; §6 `i18next.changeLanguage()` |
| **I18N-03** | All shadcn-driven components (slider, dropdown, dialog, calendar, popover) render correctly in RTL. | §5 (RTL smoke); §10 `npx shadcn add popover tooltip slider`; §6 Radix `DirectionProvider` |
| **AUDIT-01** | Every login, procedure view, procedure edit, report create/finalize, settings change, and backup/restore is recorded in `audit_log`. | §4 (Audit hooks); §10 `audit.log({ action: 'audit_view' })`; §6 audit-on-every-read pattern preserved |
| **AUDIT-02** | Audit log is append-only; there is no UI or IPC that updates or deletes rows. | §4 (Audit UI); §10 no write/delete IPC; §6 `audit_log_no_update/delete` SQL triggers from migration 0001 |
| **RPT-06** (deferred from Phase 6) | PDF supports English and Arabic; in Arabic, text direction is RTL; numeric fragments and the doctor's signature position are correct. | §9 (AR PDF); §10 `Font.register` + `<Text direction='rtl'>` wrappers; §6 NotoSansArabic bundling |

</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| **Patient List filter sidebar (D-01)** | Renderer (React) | — | UI surface; the filters are applied via existing patient IPC. No main-side change. |
| **Audit log page (D-05..D-08)** | Renderer | — | Read-only view; data already lives in `audit_log` (Phase 2). Renderer calls existing `audit:list` IPC. |
| **`audit_view` audit emit (D-08)** | Renderer (trigger) | Main (writer) | Renderer fires `audit.log({ action: 'audit_view' })` via IPC; main writes via `audit()` helper. Audit-on-every-read pattern from Phase 2 Fix 6. |
| **Backup zip creation (D-09, D-10)** | Main | — | `archiver` + `better-sqlite3 .backup()` + WAL checkpoint are all main-side filesystem operations. Renderer calls `backup.create` IPC. |
| **Restore unzip + integrity check (D-13..D-16)** | Main | — | `yauzl` streaming unzip + `PRAGMA integrity_check` run on main. Renderer calls `restore.preview` + `restore.unpack` IPC. |
| **i18n bundle load (D-19, D-20)** | Renderer | — | i18next + react-i18next are renderer-side. No main-side change. |
| **Document direction flip (D-19)** | Renderer | — | `<html dir>` is renderer DOM; `useLanguage()` hook flips it via `useEffect` on language change. |
| **Language preference storage (D-17, D-18)** | Main (DB) | Renderer (read) | New `users.language` + `doctor_profile.language` columns. Renderer reads via existing `profile.get` + new `users.getLanguage`. |
| **Migration 0007** | Main | — | Single SQL migration adds both columns. Wired into existing `runMigrations` (Phase 2). |
| **AR PDF rendering (D-25..D-27)** | Main | — | `Font.register` + `@react-pdf/renderer` already live in main. Phase 7 adds TTF + conditional `direction='rtl'` + bidi `<Text>` wrappers. |
| **RTL Playwright smoke (D-22)** | Renderer (test) | — | `tests/renderer/rtl/` boots the existing renderer with `dir='rtl'` + navigates every route. |
| **i18n key parity check (D-24)** | Renderer (test) | — | Vitest unit test walks `i18n/en/translation.json` + asserts every key exists in AR bundle. |

**Single-tier application:** All capabilities reside in the Electron main/renderer split. Backup/restore are the only main-side additions; everything else is renderer-side or DB.

## Summary

Phase 7 ships the GCC-market ship gate in **four surfaces** that are mostly additive on top of Phase 2–6 plumbing. The Phase 2-6 codebase already has every primitive Phase 7 needs: `audit_log` table + `audit:list` IPC (Phase 2), `patientsRepo.list` + `proceduresRepo.list` with filter-ready prepared statements (Phase 2 + Phase 4), `profile.get` + `profile.update` IPC (Phase 6), the `Route` union (Phase 2), `SettingsSidebar` (Phase 3 G-03-6), `useDoctorProfile` SWR-style hook (Phase 6), `@react-pdf/renderer` 4.5.1 (Phase 6), and `<html dir>` per the renderer architecture (Phase 1). What Phase 7 *adds* is one new dependency cluster (i18next + archiver + yauzl), one new SQL migration (`0007_doctor_profile_language_and_users_language.sql`), three new IPC namespaces (`audit.log` for `audit_view`, `backup.*`, `restore.*`), two new pages (`Audit.tsx`, `BackupRestore.tsx`), three new renderer hooks (`useAudit`, `useLanguage`), and three new shadcn primitives (`popover`, `tooltip`, `slider`).

**Standard approach for each surface:** (1) Search — extend `patientRepo.list` filter matrix with `dateRange` + `doctorId` + `procedureStatus`; new IPC `search.procedures` for the accordion expansion; existing 25/page pagination preserved. (2) Audit — read-only renderer page over existing `audit:list` IPC; new `audit_view` self-audit row; 100/page per D-05. (3) Backup — `archiver` + `better-sqlite3 .backup()` after `PRAGMA wal_checkpoint(TRUNCATE)`; `dialog.showSaveDialog` for destination; inline indeterminate spinner + toast on success with `shell.showItemInFolder`. (4) Restore — `yauzl` streaming unzip to **sibling** staging dir `<userData>/data-restore-<timestamp>/` (NEVER overwrites active `data/`); `PRAGMA integrity_check` post-unpack; `Activate` button is a v1.1 placeholder. (5) i18n — i18next + react-i18next bundles at `src/renderer/src/i18n/{en,ar}/translation.json`; `useLanguage()` hook at `main.tsx` flips `<html dir>`; D-24 Vitest parity check. (6) AR PDF — `Font.register` for NotoSansArabic TTF bundled at `src/main/pdf/fonts/`; conditional `language: 'en' | 'ar'` arg on `renderReportPdf`; bidi `<Text direction='rtl'>` wrappers + numeric fragment LTR isolation per Pitfall 8; `RUN_SMOKE=1` integration test for file-size > 50KB + PDF magic bytes.

**Primary recommendation:** Phase 7 is a **vertical-slice tracer** phase with four parallel surfaces — search (renderer-only), audit (renderer-only over existing IPC), backup/restore (main-only new module), and i18n+AR PDF (renderer + main co-change). Decompose into 4 plans matching the four surfaces; the migration + three new shadcn primitives + new i18n bundles + audit/restore/backup IPC are the shared trunk that the four plans depend on.

## Standard Stack

### Core (already installed — verified via package.json)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `electron` | 32.3.3 | Desktop runtime | Per PROJECT.md stack lock. |
| `electron-vite` | 2.3.0 | Build pipeline | Per PROJECT.md stack lock; HMR for renderer + main + preload. |
| `react` | 18.3.1 | UI framework | Per PROJECT.md. |
| `typescript` | 5.5.4 | Type safety | TS strict mode; Phase 7 adds no `any` to IPC contracts. |
| `tailwindcss` | 3.4.19 | Utility-first CSS | Per PROJECT.md; **3.4 native `rtl:` variants** (D-23). |
| `better-sqlite3` | 11.10.0 | Local SQLite (sync) | Already used; `db.backup()` + WAL checkpoint already wired. |
| `@react-pdf/renderer` | 4.5.1 | PDF generation | Already used by Phase 6; Phase 7 adds `Font.register` (D-25). |
| `zod` | 4.4.3 | IPC input validation | Phase 7 input schemas reuse the existing module. |

### Supporting (new in Phase 7)

| Library | Version (latest published) | Purpose | When to Use |
|---------|---------------------------|---------|-------------|
| `i18next` | ^26.3.6 [VERIFIED: npm view 2026-08-10] | i18n core | All renderer text via `t(key)`; `i18next.changeLanguage()` on flip. |
| `react-i18next` | ^17.0.11 [VERIFIED: npm view 2026-08-10] | React bindings | `useTranslation()` hook in every renderer page that has visible text. |
| `i18next-browser-languagedetector` | ^8.2.1 [VERIFIED: npm view 2026-08-10] | Lang detector | Detect initial language from `<html lang>` (set by main-side `useLanguage` boot). |
| `archiver` | ^8.0.0 [VERIFIED: npm view 2026-08-10] | Streaming zip writer | `backup.create` IPC streams `app.db` + `media/` + `profiles/` + `reports/` into one zip. |
| `yauzl` | ^3.4.0 [VERIFIED: npm view 2026-08-10] | Streaming zip reader | `restore.unpack` IPC reads zip entry-by-entry; rejects absolute/`..` paths. |
| `@types/archiver` | ^8.0.0 [VERIFIED: npm view 2026-08-10] | TS types | devDependency; archiver ships no own types. |
| `@types/yauzl` | ^3.4.0 [VERIFIED: npm view 2026-08-10] | TS types | devDependency; yauzl ships no own types. |

### Supporting (Phase 7 shadcn additions — via `npx shadcn add` per D-21)

| Component | Library | Purpose | When to Use |
|-----------|---------|---------|-------------|
| `popover.tsx` | `@radix-ui/react-popover` (already transitive) | Date range / autocomplete | Audit page action filter (D-05), optional backup info popover. |
| `tooltip.tsx` | `@radix-ui/react-tooltip` | Hover help | Audit metadata hover-preview; backup warning hover; "Activate this backup" v1.1 tooltip (D-14). |
| `slider.tsx` | `@radix-ui/react-slider` | Numeric input | Defensive install for I18N-03 ship-gate; no current v1 surface uses it. |

### Alternatives Considered

| Standard | Alternative | Tradeoff |
|----------|-------------|----------|
| `i18next` + `react-i18next` | `@formatjs/intl` (FormatJS/React Intl) | FormatJS is heavier + requires ICU MessageFormat runtime; i18next is simpler + ICU-compatible via JSON. |
| `archiver` (streaming zip) | `zip-a-folder` (in-memory) | zip-a-folder loads everything into RAM; archiver streams so a 10GB clinic doesn't OOM. |
| `yauzl` (streaming unzip) | `unzipper` / `adm-zip` | `adm-zip` is not streaming; `unzipper` is more complex API. `yauzl` is the canonical streaming choice. |
| Native `<input type="date">` × 2 (D-23 ladder rung) | `react-day-picker` or `react-date-range` | Both add ~50KB; native input is accessible + RTL-safe + zero dep. |
| Native `Intl.DateTimeFormat` (audit timestamps) | `date-fns/locale` | `date-fns` is already installed (4.4.0) but locale imports add bundle weight for a single use case; native API suffices. |
| Tailwind 3.4 `rtl:` variants (D-23) | `tailwindcss-rtl` plugin | Plugin adds one dep + flips class set; 3.4 native variants cover the surface (margin, padding, text-align, float, border-radius, space-x). |
| Noto Sans Arabic (SIL OFL, committed to repo) | System Arabic font (Segoe UI Arabic on Windows) | System fonts are inconsistent across OS; bundled TTF guarantees deterministic glyph coverage for clinical text. |
| `@react-pdf/renderer` AR via `Font.register` + bidi `<Text>` (D-25/D-26) | `puppeteer` HTML→PDF fallback | Puppeteer ships Chromium and is much heavier; @react-pdf/renderer's bidi is sufficient for EN/AR layout per Pitfall 8 with explicit numeric isolation. |

**Installation (Phase 7 trunk):**
```bash
# New runtime deps
npm install i18next react-i18next i18next-browser-languagedetector archiver yauzl
# New dev-deps
npm install -D @types/archiver @types/yauzl
# shadcn primitives
npx shadcn@latest add popover tooltip slider
# Commit NotoSansArabic-Regular.ttf under src/main/pdf/fonts/ (D-25)
```

**Version verification** — verified via `npm view` on 2026-08-10: i18next 26.3.6, react-i18next 17.0.11, i18next-browser-languagedetector 8.2.1, archiver 8.0.0, yauzl 3.4.0, @types/archiver 8.0.0, @types/yauzl 3.4.0. All current latest. Lock at these versions for Phase 7 trunk.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|------------|
| `i18next` | npm | 13 yrs | ~9M/wk | github.com/i18next/i18next | OK | Approved (de-facto i18n standard) |
| `react-i18next` | npm | 9 yrs | ~5M/wk | github.com/i18next/react-i18next | OK | Approved (i18next official React bindings) |
| `i18next-browser-languagedetector` | npm | 8 yrs | ~3M/wk | github.com/i18next/i18next-browser-languagedetector | OK | Approved (i18next official detector) |
| `archiver` | npm | 12 yrs | ~12M/wk | github.com/archiverjs/node-archiver | OK | Approved (Node streaming zip standard) |
| `yauzl` | npm | 11 yrs | ~25M/wk | github.com/thejoshwolfe/yauzl | OK | Approved (Node streaming unzip standard) |
| `@types/archiver` | npm (DefinitelyTyped) | 8 yrs | ~5M/wk | github.com/DefinitelyTyped/DefinitelyTyped | OK | Approved |
| `@types/yauzl` | npm (DefinitelyTyped) | 8 yrs | ~3M/wk | github.com/DefinitelyTyped/DefinitelyTyped | OK | Approved |
| `popover`, `tooltip`, `slider` (via `npx shadcn add`) | @shadcn official registry | n/a | n/a | github.com/shadcn-ui/ui | OK | Approved (shadcn-official — same source as 15 existing components) |

**Packages removed due to SLOP verdict:** none
**Packages flagged as SUS:** none
**New packages without [VERIFIED] provenance:** none — all confirmed via `npm view` against the npm registry + official docs.

## Architecture Patterns

### Pattern 1: Filter sidebar on existing list page (D-01..D-03)

**What:** Add a left-rail filter sidebar to `PatientsList.tsx` that submits a single `applyFilters()` IPC round-trip with the AND-combined filter matrix. Results expand each patient row into a procedure+report accordion.

**When to use:** Always — D-01 verbatim.

**Implementation sketch:**
```tsx
// src/renderer/src/pages/PatientsList.tsx — extends existing search state
type Filters = {
  search: string; mrn: string;
  dateFrom: string; dateTo: string;
  doctorId: string | null;
  status: Array<'completed' | 'partial' | 'recording'>;
};

const [filters, setFilters] = useState<Filters>({ /* empty defaults */ });

async function applyFilters(): Promise<void> {
  const res = await window.api.patients.list({
    search: filters.search || undefined,
    mrn: filters.mrn || undefined,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
    doctorId: filters.doctorId,
    procedureStatus: filters.status.length ? filters.status : undefined,
    page, pageSize,
  });
  // Each row now comes with embedded procedure + report list from
  // the `search.procedures` IPC. Render in expanded accordion.
}
```

**Repo extension sketch (no per-filter statement explosion):**
```ts
// src/main/db/patients.ts — patientRepo.list grows dateRange/doctorId/procedureStatus
// Use a single dynamic WHERE builder (no combinatorial prepared-statement cache):
function buildWhere(f: PatientListInput): { sql: string; params: Record<string, unknown> } {
  const where: string[] = ['deleted_at IS NULL'];
  const params: Record<string, unknown> = {};
  if (f.search) { where.push('full_name LIKE @search COLLATE NOCASE'); params.search = `%${f.search}%`; }
  if (f.mrn) { where.push('mrn = @mrn'); params.mrn = f.mrn; }
  if (f.dateFrom || f.dateTo || f.doctorId || (f.procedureStatus && f.procedureStatus.length)) {
    // EXISTS subquery against procedures table — single EXISTS instead of N joins
    const subWhere: string[] = ['p.id = procedures.patient_id'];
    if (f.dateFrom) { subWhere.push('procedures.started_at >= @dateFrom'); params.dateFrom = Date.parse(f.dateFrom); }
    if (f.dateTo) { subWhere.push('procedures.started_at <= @dateTo'); params.dateTo = Date.parse(f.dateTo) + 86_400_000; }
    if (f.doctorId) { subWhere.push('procedures.doctor_id = @doctorId'); params.doctorId = f.doctorId; }
    if (f.procedureStatus?.length) {
      const placeholders = f.procedureStatus.map((_, i) => `@status${i}`).join(',');
      f.procedureStatus.forEach((s, i) => { params[`status${i}`] = s; });
      subWhere.push(`procedures.status IN (${placeholders})`);
    }
    where.push(`EXISTS (SELECT 1 FROM procedures WHERE ${subWhere.join(' AND ')})`);
  }
  return { sql: where.join(' AND '), params };
}
```

### Pattern 2: Audit-on-every-read self-audit (D-08)

**What:** The Audit page mount fires one debounced `audit.log({ action: 'audit_view' })` IPC. Self-referential but matches Phase 2 Fix 6 pattern (every read is auditable).

**Implementation:**
```tsx
// src/renderer/src/pages/Audit.tsx — mount effect
useEffect(() => {
  const handle = setTimeout(() => {
    void window.api.audit.log({ action: 'audit_view', entityType: 'audit' });
  }, 1000);
  return () => clearTimeout(handle);
}, []);
```

```ts
// src/main/ipc/audit.ts — adds a write channel (D-08)
export function registerAuditIpc(): void {
  ipcMain.handle(IPC.AUDIT_LIST, (_e, raw) => /* existing */);
  ipcMain.handle(IPC.AUDIT_LOG, (_e, raw) => {
    const { action, entityType, entityId, metadata } = auditLogInput.parse(raw);
    const userId = requireSession();
    audit({ action, entityType, entityId, userId, metadata });
    return { ok: true };
  });
}
```

### Pattern 3: WAL checkpoint + better-sqlite3 .backup() → archiver (D-10)

**What:** Standard backup pipeline per PITFALLS §Pitfall 9. Three-step: (1) `PRAGMA wal_checkpoint(TRUNCATE)` ensures no WAL half-write, (2) `db.backup(tempPath)` writes a single-file copy, (3) `archiver` streams `tempPath` + media + profiles + reports into the user-chosen zip path.

**Implementation sketch:**
```ts
// src/main/backup/index.ts — new module
import { createWriteStream } from 'node:fs';
import archiver from 'archiver';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getDb } from '../db';
import { dataDir, mediaDir, profilesDir, reportsDir } from '../paths';

export async function createBackup(opts: { destZipPath: string }): Promise<{ path: string; sizeBytes: number }> {
  const db = getDb();
  // Step 1: WAL checkpoint — truncate the WAL/SHM so the main DB file
  // is fully consistent (PITFALLS §Pitfall 9).
  db.pragma('wal_checkpoint(TRUNCATE)');
  // Step 2: db.backup() to a temp file.
  const tempDb = path.join(tmpdir(), `app-${Date.now()}.db`);
  await db.backup(tempDb); // returns a promise
  // Step 3: archiver streams all four subtrees into the zip.
  const output = createWriteStream(opts.destZipPath);
  const archive = archiver('zip', { zlib: { level: 6 } });
  const closed = new Promise<void>((resolve, reject) => {
    output.on('close', () => resolve());
    archive.on('error', (err) => reject(err));
    archive.pipe(output);
  });
  archive.file(tempDb, { name: 'app.db' });
  archive.directory(mediaDir(), 'media'); // includes patients/<id>/<proc>/screenshots
  archive.directory(profilesDir(), 'profiles'); // includes <userId>/signature.{png,jpg}
  archive.directory(reportsDir(), 'reports'); // includes <reportId>.pdf
  await archive.finalize();
  await closed;
  // Step 4: cleanup temp db.
  await unlink(tempDb);
  return { path: opts.destZipPath, sizeBytes: /* statSync */ };
}
```

### Pattern 4: yauzl streaming unzip + path safety filter (D-15)

**What:** Stream-read each entry from the zip; reject any entry whose normalized path is absolute or contains `..`; write to the staging dir.

**Implementation sketch:**
```ts
// src/main/backup/restore.ts — new module
import yauzl from 'yauzl';
import { createWriteStream } from 'node:fs';
import path from 'node:path';

// Phase 5 P04 + Phase 7 D-15: same MEDIA_ROUTE_RE / ALLOWED_SUBDIRS
// defense-in-depth pattern. Reject absolute paths or `..` segments BEFORE
// touching the filesystem (PITFALLS §Pitfall 9 + the historical class).
function safeEntryPath(entry: yauzl.Entry, stagingDir: string): string | null {
  // zip entries use forward slashes; normalize.
  const normalized = entry.fileName.replace(/\\/g, '/');
  if (path.isAbsolute(normalized)) return null;
  if (normalized.includes('..')) return null;
  const resolved = path.resolve(stagingDir, normalized);
  if (!resolved.startsWith(path.resolve(stagingDir))) return null;
  return resolved;
}

export async function restoreUnpack(opts: {
  zipPath: string; stagingDir: string;
}): Promise<{ fileCount: number }> {
  return new Promise((resolve, reject) => {
    yauzl.open(opts.zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('zip open failed'));
      let count = 0;
      zip.readEntry();
      zip.on('entry', (entry) => {
        const target = safeEntryPath(entry, opts.stagingDir);
        if (target === null) { zip.readEntry(); return; } // skip unsafe
        if (/\/$/.test(entry.fileName)) { // directory entry
          mkdirSync(target, { recursive: true });
          zip.readEntry();
          return;
        }
        mkdirSync(path.dirname(target), { recursive: true });
        zip.openReadStream(entry, (err2, read) => {
          if (err2 || !read) { zip.readEntry(); return; }
          const writer = createWriteStream(target);
          read.pipe(writer);
          writer.on('close', () => { count++; zip.readEntry(); });
        });
      });
      zip.on('end', () => resolve({ fileCount: count }));
      zip.on('error', reject);
    });
  });
}
```

### Pattern 5: i18next + react-i18next with `<html dir>` flip (D-19, D-20)

**What:** Initialize i18next once at renderer entry with `lng: initialLang` (read from main-side via `auth.status` extension). `useLanguage()` hook flips `<html dir>` + calls `i18next.changeLanguage()`. Every visible string uses `useTranslation()`.

**Implementation sketch:**
```ts
// src/renderer/src/i18n/index.ts — new module
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './en/translation.json';
import ar from './ar/translation.json';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, ar: { translation: ar } },
    fallbackLng: 'en',
    supportedLngs: ['en', 'ar'],
    interpolation: { escapeValue: false }, // React already escapes
  });
export default i18n;
```

```tsx
// src/renderer/src/hooks/useLanguage.ts — new hook
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

export function useLanguage(): { lang: 'en' | 'ar'; setLang: (l: 'en' | 'ar') => void } {
  const { i18n } = useTranslation();
  const lang = (i18n.language === 'ar' ? 'ar' : 'en') as 'en' | 'ar';
  const setLang = (next: 'en' | 'ar') => { void i18n.changeLanguage(next); };
  useEffect(() => {
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }, [lang]);
  return { lang, setLang };
}
```

### Pattern 6: AR PDF conditional rendering (D-25, D-26)

**What:** Same `report.tsx` template, conditional on `language`. `Font.register({ family: 'NotoSansArabic', src: <ttf path> })` once per main process (module-scope guard). Numeric fragments (`MRN: 12345`) wrapped in `<Text direction='ltr'>` per Pitfall 8.

**Implementation sketch:**
```ts
// src/main/pdf/render-report-pdf.ts — extends renderReportPdf signature
export async function renderReportPdf(
  reportId: string,
  opts: { language: 'en' | 'ar' } = { language: 'en' },
): Promise<{ pdfPath: string }> {
  // ... existing data load ...
  // Register Arabic font on first AR render.
  if (opts.language === 'ar' && !_notoArabicRegistered) {
    const { Font } = await loadReactPdf();
    Font.register({
      family: 'NotoSansArabic',
      src: path.join(__dirname, 'fonts/NotoSansArabic-Regular.ttf'),
    });
    _notoArabicRegistered = true;
  }
  const input: ReportPdfInput = {
    // ... existing fields ...
    language: opts.language,
  };
  // ... existing render path ...
}
```

```tsx
// src/main/pdf/report.tsx — bilingual <Text> wrappers per D-25/D-26
function patientField(value: string, direction: 'ltr' | 'rtl' | 'auto'): JSX.Element {
  // Numeric fragments stay LTR per PITFALLS §Pitfall 8.
  return React.createElement(
    P.Text,
    { style: { ...styles.patientField, direction } },
    value,
  );
}
```

### Pattern 7: RTL Playwright smoke test (D-22)

**What:** One Playwright test per route boots the renderer with `dir='rtl'`, navigates, asserts `document.documentElement.scrollWidth <= window.innerWidth`, and writes a screenshot for visual regression.

**Implementation sketch:**
```ts
// tests/renderer/rtl/<route>.test.ts
import { test, expect } from '@playwright/test';

test('PatientsList renders without RTL overflow', async ({ page }) => {
  await page.addInitScript(() => {
    document.documentElement.dir = 'rtl';
    document.documentElement.lang = 'ar';
  });
  await page.goto('app://./patients');
  await page.waitForLoadState('networkidle');
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: 'tests/renderer/rtl/screenshots/patients-list--rtl.png' });
});
```

### Anti-Patterns to Avoid

- **Anti-pattern:** Date-picker library (`react-day-picker`, `react-date-range`) — adds ~50KB for a feature native `<input type="date">` covers (D-23 ladder rung).
- **Anti-pattern:** `tailwindcss-rtl` plugin — Tailwind 3.4 native `rtl:` variants cover margin, padding, text-align, float, border-radius, space-x flips (D-23).
- **Anti-pattern:** In-memory zip (`zip-a-folder`, `adm-zip`) — a 10GB clinic dataset OOMs the main process; `archiver`/`yauzl` stream.
- **Anti-pattern:** Overwriting active `data/` on restore — Phase 7 ships the **two-directory model** (D-14); v1.1 implements "Activate".
- **Anti-pattern:** Pre-flight backup integrity check on source DB — deferred to v1.1 (per CONTEXT.md §Deferred Ideas).
- **Anti-pattern:** Date range on `created_at` instead of `started_at` — per D-02 the canonical procedure date is `procedures.started_at` (Phase 4 D-10).
- **Anti-pattern:** Transitive only `yauzl` via `@types/yauzl` — D-15 requires direct dependency on `yauzl` for the unzip code path.
- **Anti-pattern:** `i18next.changeLanguage()` on every component — single `useLanguage()` hook at `main.tsx` mount (D-19); every page reads via `useTranslation()` only.
- **Anti-pattern:** Hard-coded `<html dir="rtl">` on a per-component basis — D-23 propagates `dir` via document-level + Radix `DirectionProvider`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| i18n bundle loader + fallback chain | Custom JSON loader + state mgmt | `i18next` + `react-i18next` | i18next has plural rules, ICU interpolation, lazy bundles, language detection. Reinventing it = weeks of edge-case bugs. |
| Streaming zip writer | Custom zip encoder | `archiver` (npm) | zip spec is dense; archiver handles compression, directory entries, symlinks (we filter them), edge cases. |
| Streaming zip reader | Custom unzip | `yauzl` (npm) | Same — zip readers must handle data descriptors, encryption markers, zip64, etc. |
| AR glyph coverage | System font fallback | Bundled NotoSansArabic TTF | System fonts vary by OS (Segoe UI Arabic on Windows, Geeza Pro on macOS, Noto on Linux); deterministic rendering requires bundled font. |
| Date range input | Custom date-picker | Two native `<input type="date">` × 2 | Native input is accessible + RTL-safe + zero-dep; date-picker libs add 50KB+ and need RTL-specific layout work. |
| Backup format with manifest | Custom JSON sidecar + zip | Just zip `app.db` + subdirs (D-09) | Format is self-describing — the DB itself is the manifest; no separate metadata needed. |
| Audit row timestamp formatting | Custom formatter | `Intl.DateTimeFormat` (native) | Native API has locale data built-in; AR/EN formats ship with the runtime. |
| `audit:log` audit emit (D-08) | Custom page-mount log | Existing `audit()` helper + new `audit.log` IPC | One helper for all audit writes; no bypass paths (AUDIT-01 verbatim). |
| RTL smoke baseline | Manual screenshot diff | Playwright + `document.scrollWidth <= window.innerWidth` | Programmatic check catches the bug class (right-edge overflow) without per-route manual review. |

**Key insight:** Phase 7's surface area is wide but the *new code* is narrow. Almost every capability has either an existing primitive (audit:list, profile.update, procedure list) or a canonical library (i18next, archiver, yauzl, NotoSansArabic). The planner's job is to wire them, not invent them.

## Runtime State Inventory

> **Phase 7 is NOT a rename/refactor phase.** Runtime state migration does not apply. The only DB-state addition is migration `0007_*.sql` (new columns on `users` + `doctor_profile`). No stored procedures, OS state, secrets, or build artifacts are affected.

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | None — no existing rows reference `users.language` or `doctor_profile.language` | Migration adds columns with sensible defaults (`'en'`) — no backfill needed. |
| Live service config | None — no OS-registered state references language | n/a |
| OS-registered state | None | n/a |
| Secrets/env vars | None | n/a |
| Build artifacts | shadcn primitives `popover`/`tooltip`/`slider` will be added to `src/renderer/src/components/ui/` | `npx shadcn add` generates them; no rebuild of existing artifacts needed. |

## Common Pitfalls

### Pitfall 1: AR text inside a mixed bidi paragraph renders LTR or reversed

**What goes wrong:** `MRN: 12345` rendered inside an Arabic `<Text>` flips to `MRN: 54321` because the bidi algorithm treats numbers inside RTL context as RTL-adjacent.

**Why it happens:** `@react-pdf/renderer` bidi is partial — Latin/numeric tokens need explicit isolation per PITFALLS §Pitfall 8.

**How to avoid:** Wrap every numeric fragment in `<Text style={{ direction: 'ltr' }}>`. Phase 7 implementation: extend the patient block fields (`Name:`, `MRN:`, `DOB:`, `Gender:`) so the *value* lives in an LTR `<Text>` even when the surrounding `<Text>` is RTL.

**Warning signs:** Manual smoke review of AR PDF shows reversed MRN/DOB.

### Pitfall 2: Backup captures partial DB because WAL is not checkpointed

**What goes wrong:** Doctor runs backup during a procedure; the zip contains a 200 MB `app.db` with a half-written WAL. Restoring yields a corrupted DB.

**Why it happens:** Without `PRAGMA wal_checkpoint(TRUNCATE)`, the main DB file is not self-consistent at any moment — the WAL has the recent writes.

**How to avoid:** D-10 verbatim: `db.pragma('wal_checkpoint(TRUNCATE)')` THEN `db.backup(tempPath)` THEN zip. The temp file is a single coherent SQLite file.

**Warning signs:** Restored DB fails `PRAGMA integrity_check` (D-16 catches this at restore time).

### Pitfall 3: yauzl entry path traversal (../ or absolute paths)

**What goes wrong:** Maliciously-crafted zip with an entry `../../windows/system32/foo.dll` writes outside the staging dir.

**Why it happens:** yauzl by default trusts the entry's `fileName` field.

**How to avoid:** D-15 verbatim: `safeEntryPath` filter rejects absolute paths AND `..` segments AND path-resolved-outside-staging-dir. Phase 5 P04 + ALLOWED_SUBDIRS pattern reused. (Catches the historical class.)

**Warning signs:** Manual test: create a zip with `../foo.txt` entry; verify `restore.unpack` throws/skips without touching the filesystem.

### Pitfall 4: shadcn Dropdown/Select mirror weirdly in RTL

**What goes wrong:** Doctor selects Arabic; `Select` content opens left-of-trigger instead of right-of-trigger.

**Why it happens:** shadcn/Radix UI ships with default LTR positioning; `dir` propagation via `DirectionProvider` is necessary but Phase 5+ did not test.

**How to avoid:** D-22 verbatim: Playwright RTL smoke asserts no overflow + screenshots each surface. Per D-23 `dir` propagates via Radix automatically when set on a parent.

**Warning signs:** RTL smoke test fails on a dropdown page.

### Pitfall 5: Restore overwrites active `data/` and loses current clinic state

**What goes wrong:** A misclick on "Restore" replaces the live database; the doctor's in-progress procedure is gone.

**Why it happens:** No separation between "staging" and "active" directories.

**How to avoid:** D-14 verbatim: restore unpacks to `<userData>/data-restore-<timestamp>/` (sibling of active `data/`). The "Activate this backup" button ships as a **disabled placeholder** in v1; Phase 7 NEVER overwrites active data.

**Warning signs:** Manual test: restore to staging; verify active `data/` is byte-identical before and after.

### Pitfall 6: AR PDF font missing → missing glyphs (tofu boxes)

**What goes wrong:** AR PDF renders with empty boxes for Arabic characters because Helvetica (the EN font) has no Arabic glyphs.

**Why it happens:** Without `Font.register({ family: 'NotoSansArabic', src: ... })`, @react-pdf/renderer falls back to Helvetica which lacks Arabic glyphs.

**How to avoid:** D-25 verbatim: bundle `NotoSansArabic-Regular.ttf` at `src/main/pdf/fonts/`, register via `Font.register` before any AR render. Module-scope guard avoids re-registering on every render.

**Warning signs:** D-27 `RUN_SMOKE=1` smoke test renders AR PDF and asserts file > 50KB; manual review confirms no tofu boxes.

### Pitfall 7: i18n key drift — EN has new field but AR doesn't

**What goes wrong:** Doctor adds a new visible string in EN; the AR bundle still has the old key; renderer shows `audit.unknownAction` as the literal key in AR mode.

**Why it happens:** Manual translation lag; no automated parity check.

**How to avoid:** D-24 verbatim: Vitest unit test walks `i18n/en/translation.json` + asserts every key exists in `i18n/ar/translation.json`. Fast feedback in `npm run test:unit` before Playwright even boots.

**Warning signs:** D-24 test fails CI.

### Pitfall 8: Audit page fires `audit_view` on every re-render → audit spam

**What goes wrong:** Every state update on the Audit page (filter change, page flip) re-fires `audit_view`.

**Why it happens:** useEffect without a stable dep-array or empty deps.

**How to avoid:** D-08 verbatim: 1-second debounce + empty deps array (one fire per page mount).

**Warning signs:** Audit log shows >1 `audit_view` row per minute.

## Code Examples

Verified patterns from official sources (i18next docs + archiver README + yauzl README + @react-pdf/renderer docs):

### i18next init pattern (official docs)
```ts
// Source: https://www.i18next.com/overview/configuration-options
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: { /* dotted keys */ } },
    ar: { translation: { /* dotted keys */ } },
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});
```

### archiver streaming zip (archiver README)
```ts
// Source: https://github.com/archiverjs/node-archiver#usage
const archive = archiver('zip', { zlib: { level: 9 } });
const output = fs.createWriteStream('target.zip');
archive.pipe(output);
archive.file('app.db', { name: 'app.db' });
archive.directory('media/', 'media');
archive.finalize();
```

### yauzl streaming unzip (yauzl README)
```ts
// Source: https://github.com/thejoshwolfe/yauzl#usage
yauzl.open('backup.zip', { lazyEntries: true }, (err, zipfile) => {
  zipfile.readEntry();
  zipfile.on('entry', (entry) => {
    zipfile.openReadStream(entry, (err, readStream) => {
      readStream.pipe(fs.createWriteStream('staging/' + entry.fileName));
      readStream.on('end', () => zipfile.readEntry());
    });
  });
});
```

### @react-pdf/renderer Font.register (official docs)
```ts
// Source: https://react-pdf.org/components#font
import { Font } from '@react-pdf/renderer';
Font.register({
  family: 'NotoSansArabic',
  src: 'src/main/pdf/fonts/NotoSansArabic-Regular.ttf',
});
```

### @react-pdf/renderer bidi `<Text direction>` (Pitfall 8 mitigation)
```tsx
// Source: https://react-pdf.org/components#text
<Text style={{ direction: 'rtl' }}>تشخيص</Text>
<Text style={{ direction: 'ltr' }}>MRN: 12345</Text>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| AR glyph rendering via system font | Bundled Noto Sans Arabic TTF | Always (Google Fonts) | Deterministic across OS; no Segoe UI Arabic dependency. |
| i18next v21 (pre-React 18 strict mode) | i18next 26.x | 2025 | New module-init API; backward-compatible with the v23 init pattern. |
| archiver v5 (callback API) | archiver v7+ (Promise-based `finalize`) | 2024 | Phase 7 uses `await archive.finalize()` then awaits `output.on('close')`. |
| yauzl v2.x (callback) | yauzl v3.x | 2024 | Same callback API; types improved. |
| `tailwindcss-rtl` plugin (class flipping) | Tailwind 3.4 native `rtl:` variants | Tailwind 3.4 release (2024) | One less dep; native variants cover the surface. |
| `react-intl` (FormatJS) | i18next + react-i18next | n/a | Both work; i18next is simpler for the JSON bundle model. |
| HTML `<input type="date">` (browser-native) | Same — native | n/a | No change; remains the ladder rung before date-picker libs. |

**Deprecated/outdated:**
- `react-intl` ICU components: heavier runtime; not adopted here.
- `MediaRecorder` for backup data: irrelevant (we zip files, not media).
- `@types/yauzl` as transitive only: D-15 requires direct `yauzl` dependency.

## Common Stack Trace Helpers

**Migrations:** New `0007_doctor_profile_language_and_users_language.sql` wired into `src/main/db/migrations.ts` as the 5th entry in `MIGRATIONS`. The migration is idempotent (ALTER TABLE ADD COLUMN is no-op if column exists; better-sqlite3 won't auto-no-op so the runner's existing "applied" check via `_migrations` table covers it).

**Repo extensions:**
- `usersRepo.create` / `wizardBootstrap` / `usersRepo.list` add `language: 'en' | 'ar'` parameter (D-18).
- `doctorProfileRepo.upsert` adds `language: 'en' | 'ar' | null` to the input type (D-17).
- `patientRepo.list` adds `dateFrom?`, `dateTo?`, `doctorId?`, `procedureStatus?` filter params (D-01/D-02).
- `proceduresRepo.list` adds `dateFrom?`, `dateTo?`, `doctorId?` (D-04).

**IPC extensions (in `src/main/ipc/*.ts`):**
- `audit.log` new — D-08.
- `patients.list` extends filter schema — D-01/D-02.
- `procedures.list` extends filter schema — D-04.
- `profile.update` adds `language?` field — D-17.
- `users.create` + `auth.wizard` add `language?` field — D-18.
- `backup.create` + `backup.reveal` new — D-11.
- `restore.preview` + `restore.unpack` new — D-13.

**Preload bridge extensions (in `src/preload/index.ts`):**
- `api.audit.log({ action, entityType, entityId, metadata })` new.
- `api.patients.list` signature unchanged (filter type widens).
- `api.procedures.list` signature unchanged.
- `api.profile.update` signature unchanged.
- `api.users.create` signature unchanged.
- `api.backup.create({ destPath })` + `api.backup.reveal({ path })` new.
- `api.restore.preview({ zipPath, stagingDir })` + `api.restore.unpack({ zipPath, stagingDir })` new.

**Renderer additions:**
- `src/renderer/src/i18n/{en,ar}/translation.json` (new bundles).
- `src/renderer/src/i18n/index.ts` (init module).
- `src/renderer/src/hooks/useAudit.ts` (new SWR-style hook).
- `src/renderer/src/hooks/useLanguage.ts` (new `<html dir>` flip hook).
- `src/renderer/src/pages/Audit.tsx` (new page).
- `src/renderer/src/pages/BackupRestore.tsx` (new page).
- `src/renderer/src/lib/router.ts` — adds `'audit'; null` + `'backup-restore'; null` to the Route union.
- `src/renderer/src/components/SettingsSidebar.tsx` — adds `Audit` + `Backup & Restore` entries (G-03-6 pattern; icons: `FileSearch`, `HardDrive`).
- `src/renderer/src/components/ui/{popover,tooltip,slider}.tsx` (new shadcn primitives via `npx shadcn add`).
- `src/renderer/src/pages/PatientsList.tsx` — filter sidebar (D-01).
- `src/renderer/src/pages/ProfileEditor.tsx` — language picker card (D-17).
- `src/renderer/src/pages/Wizard.tsx` — step 4 language radio (D-18).
- `src/renderer/src/App.tsx` — adds `'audit'` + `'backup-restore'` route cases.

**Main additions:**
- `src/main/db/migrations/0007_doctor_profile_language_and_users_language.sql` (new).
- `src/main/db/migrations.ts` — register 0007 (id: 7, name: 'doctor_profile_language_and_users_language').
- `src/main/backup/index.ts` (new) — `createBackup`, `revealBackup`.
- `src/main/backup/restore.ts` (new) — `previewRestore`, `unpackRestore`, `integrityCheck`.
- `src/main/backup/snapshot.ts` (new) — `walCheckpoint(db)` + `dbBackup(db, tempPath)` helpers.
- `src/main/ipc/backup.ts` (new) — IPC handlers.
- `src/main/ipc/restore.ts` (new) — IPC handlers.
- `src/main/ipc/audit.ts` — adds `AUDIT_LOG` channel handler.
- `src/main/ipc/profile.ts` — extends `PROFILE_UPDATE` schema with `language?`.
- `src/main/ipc/auth.ts` — extends `wizardBootstrap` schema with `language?`.
- `src/main/ipc/users.ts` — extends `users.create` schema with `language?`.
- `src/main/ipc/patients.ts` — extends `patients.list` filter schema.
- `src/main/ipc/procedures.ts` — extends `procedures.list` filter schema.
- `src/main/pdf/render-report-pdf.ts` — adds `language: 'en' | 'ar'` param.
- `src/main/pdf/report.tsx` — bilingual `<Text>` wrappers + `NotoSansArabic` font family in styles.
- `src/main/pdf/fonts/NotoSansArabic-Regular.ttf` (new — bundled TTF).
- `src/main/paths.ts` — adds `restoreStagingDir(timestamp)` (D-14).
- `src/main/index.ts` — registers `backupIpc` + `restoreIpc`.

**Shared (contract) extensions:**
- `src/shared/ipc-contract.ts` — adds `AUDIT_LOG` constant + `Language` type + `BackupResult` + `RestorePreview` + `RestoreUnpackResult` + `AuditFilters` type + extended `patients.list` / `procedures.list` filter types.
- `src/shared/validators.ts` — extends `patientListQueryInput` + `proceduresListQueryInput` + `doctorProfileUpdateSchema` + `wizardInput` + `userInput` + new `auditLogInput` + `backupCreateInput` + `restorePreviewInput` + `restoreUnpackInput`.

## Validation Architecture

> `workflow.nyquist_validation = true` in `.planning/config.json` (default-enabled). Test infrastructure already exists: Vitest 2.1.9, jsdom 30.0.1, happy-dom 20.11.1, `@testing-library/react` 16.3.2, `@testing-library/jest-dom` 7.0.0, `@testing-library/user-event` 14.6.1. 559 tests across 72 files pass as of Phase 6 completion.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.9 (unit + integration) |
| Renderer DOM | happy-dom 20.11.1 (Vitest jsdom env) — confirmed via `tests/setup.ts` |
| Test config | `scripts/run-vitest.cjs` — `npm run test:unit` |
| Integration smoke | `npm run test:integration:smoke` — gated by `RUN_SMOKE=1` |
| Quick run command | `npm run test:unit` (runs all unit tests) |
| Full suite command | `npm run typecheck && npm run test:unit && npm run test:integration:smoke` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|---------------|
| **SRCH-01** | Patients list filters by date range + doctor + status AND-combined | unit | `npm run test:unit -- tests/main/db/patients.test.ts` | ❌ Wave 0 (extend existing) |
| **SRCH-01** | `search.procedures` returns procedures for a given patient matching filters | unit | `npm run test:unit -- tests/main/db/procedures-repo.test.ts` | ❌ Wave 0 |
| **SRCH-02** | Patient row expansion shows procedure + report context | unit | `npm run test:unit -- tests/renderer/pages/PatientsList.test.tsx` | ❌ Wave 0 (extend) |
| **SRCH-03** | Procedure row click navigates to `'procedure-review'; procedureId` | unit | `npm run test:unit -- tests/renderer/pages/PatientsList.test.tsx` | ❌ Wave 0 |
| **SET-05** | `backup.create` IPC streams WAL-checkpoint + better-sqlite3 `.backup()` + archiver zip | unit (mock archiver) | `npm run test:unit -- tests/main/backup/index.test.ts` | ❌ Wave 0 |
| **SET-05** | Backup zip contains `app.db` + media subtree + profiles + reports | unit (unzip assertion) | `npm run test:unit -- tests/main/backup/index.test.ts` | ❌ Wave 0 |
| **SET-06** | `restore.preview` parses staged DB + returns counts + integrity result | unit | `npm run test:unit -- tests/main/backup/restore.test.ts` | ❌ Wave 0 |
| **SET-06** | `restore.unpack` rejects absolute paths + `..` segments | unit | `npm run test:unit -- tests/main/backup/restore.test.ts` | ❌ Wave 0 |
| **I18N-01** | `profile.update` with `language` updates `doctor_profile.language` | unit | `npm run test:unit -- tests/main/ipc/profile.test.ts` | ❌ Wave 0 (extend) |
| **I18N-01** | Wizard step 4 submits `language` to `auth.wizard` → `users.language` set | unit | `npm run test:unit -- tests/main/auth/wizard-bootstrap.test.ts` | ❌ Wave 0 (extend) |
| **I18N-02** | `useLanguage()` hook flips `<html dir>` on language change | unit | `npm run test:unit -- tests/renderer/hooks/useLanguage.test.ts` | ❌ Wave 0 |
| **I18N-03** | RTL smoke test: every route boots with `dir='rtl'` + no overflow | smoke (Playwright) | `npm run test:e2e -- tests/renderer/rtl/` | ❌ Wave 0 (Playwright infrastructure needed) |
| **AUDIT-01** | `audit_view` row written on Audit page mount | unit | `npm run test:unit -- tests/renderer/pages/Audit.test.tsx` | ❌ Wave 0 |
| **AUDIT-02** | No write/delete IPC for audit_log; triggers reject UPDATE/DELETE | unit (existing) | `npm run test:unit -- tests/main/db/audit.test.ts` | ✅ (verify immutability) |
| **RPT-06** | AR PDF renders with `Font.register('NotoSansArabic')` + file > 50KB + PDF magic bytes | integration smoke | `RUN_SMOKE=1 npm run test:integration:smoke` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm run test:unit -- <new test file>` — runs only the new test(s) for fast feedback.
- **Per wave merge:** `npm run typecheck && npm run test:unit` — full type-check + unit suite (current Phase 6 baseline: 559 tests across 72 files, target post-Phase 7: 600+ tests).
- **Phase gate:** `npm run test:integration:smoke` with `RUN_SMOKE=1` — runs the AR PDF + backup/restore smoke tests (gated).

### Wave 0 Gaps

- [ ] `tests/main/db/patients.test.ts` — extend with `dateFrom`/`dateTo`/`doctorId`/`procedureStatus` filter coverage.
- [ ] `tests/main/db/procedures-repo.test.ts` — extend with `dateFrom`/`dateTo`/`doctorId` filter coverage.
- [ ] `tests/main/db/migrations.test.ts` — add 0007 case (run all migrations on empty DB + assert new columns exist).
- [ ] `tests/main/backup/index.test.ts` (new) — mock `archiver` + assert stream order.
- [ ] `tests/main/backup/restore.test.ts` (new) — mock `yauzl` + assert path safety filter + integrity check.
- [ ] `tests/main/backup/snapshot.test.ts` (new) — assert `PRAGMA wal_checkpoint(TRUNCATE)` + `db.backup()` shape.
- [ ] `tests/main/ipc/audit.test.ts` (new) — assert `audit.log` writes via `audit()` helper.
- [ ] `tests/main/ipc/profile.test.ts` — extend with `language` field coverage.
- [ ] `tests/main/ipc/auth.test.ts` (or extend wizard test) — assert `wizardBootstrap({ ..., language })` sets `users.language`.
- [ ] `tests/renderer/hooks/useLanguage.test.ts` (new) — assert `<html dir>` flip on language change.
- [ ] `tests/renderer/hooks/useAudit.test.ts` (new) — SWR-style hook contract.
- [ ] `tests/renderer/pages/Audit.test.tsx` (new) — assert 100/page + filter combo + audit_view emit on mount.
- [ ] `tests/renderer/pages/BackupRestore.test.tsx` (new) — assert backup flow + restore preview + staging dir copy.
- [ ] `tests/renderer/pages/PatientsList.test.tsx` — extend with filter sidebar coverage.
- [ ] `tests/renderer/i18n/parity.test.ts` (new) — D-24 walks EN keys + asserts AR coverage.
- [ ] `tests/renderer/i18n/useLanguage-flow.test.tsx` (new) — boot renderer + toggle language + assert `<html dir>` flips.
- [ ] `tests/integration/backup-restore-roundtrip.test.ts` (new) — `RUN_SMOKE=1` gated; creates backup, unpacks to staging, asserts integrity + counts.
- [ ] `tests/integration/ar-pdf-smoke.test.ts` (new) — `RUN_SMOKE=1` gated; renders AR report, asserts > 50KB + PDF magic bytes.
- [ ] `tests/renderer/rtl/<route>.test.ts` (new per D-22) — Playwright smoke per route.
- [ ] **Playwright infrastructure** — install `@playwright/test` + `playwright` if not already present; verify via `npm ls @playwright/test`.
- [ ] Framework install: `npm install -D @playwright/test` + `npx playwright install chromium` (if Playwright is not already in the test stack — verify with `ls tests/integration` or grep package.json).

**Existing infrastructure covers:** main-side unit tests (Phase 1–6), renderer-side jsdom unit tests (Phase 1–6), happy-dom setup (Phase 3+), integration smoke test runner gated by `RUN_SMOKE=1` (Phase 4 trim smoke).

## Security Domain

> `workflow.security_enforcement = true` in `.planning/config.json` (default-enabled).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| **V1 Architecture** | yes | Electron security baseline preserved: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` — no Phase 7 renderer changes affect these. |
| **V2 Authentication** | n/a | Phase 7 audit log + backup do not introduce new auth surfaces; existing `requireSession()` gates all new IPC. |
| **V3 Session Management** | n/a | No session changes. |
| **V4 Access Control** | yes (audit) | Audit page emits `audit_view` for compliance; no admin-only audit surface per D-05. |
| **V5 Input Validation** | yes (search + backup + restore) | All new IPC inputs validated via zod at the boundary (Phase 2 Fix 5 + V5 pattern). |
| **V6 Cryptography** | n/a | Phase 7 does not add crypto; safeStorage (Phase 2) handles PINs. |
| **V7 Error Handling & Logging** | yes (audit) | All new events flow through `audit()` helper; no bypass paths. |
| **V8 Data Protection** | yes (backup zip) | D-15 path-traversal filter + D-16 integrity check. Backup zip is plaintext per D-09 (deferred: zip encryption v1.1). |
| **V9 Communication** | n/a | No new network surfaces. |
| **V10 Malicious Code** | yes (zip parsing) | D-15 + D-16 — yauzl entries rejected if unsafe; integrity check gates activate. |

### Known Threat Patterns for Electron + offline-only

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Zip-slip / path traversal in restore | Tampering | D-15: `safeEntryPath` rejects absolute/`..`/outside-staging-dir paths BEFORE write (Phase 5 P04 + ALLOWED_SUBDIRS pattern). |
| Partial-DB restore (silent corruption) | Tampering | D-16: `PRAGMA integrity_check` gates "Activate" button; backup uses `PRAGMA wal_checkpoint(TRUNCATE)` + `db.backup()`. |
| Renderer XSS via translated strings | Tampering | React already escapes; i18next `interpolation.escapeValue: false` is OK because react-i18next passes through React rendering which auto-escapes. |
| Audit log bypass (handler writes without `audit()`) | Repudiation | Phase 2 Fix 6: one `audit()` helper; no other write paths. Phase 7 adds IPC channels that route through it. |
| Disk space exhaustion on backup | DoS | Out of scope per PITFALLS §Performance Traps; clinics operate on bounded clinic-scale data. |
| Backup zip with crafted UTF-8 filenames | Information Disclosure | yauzl handles UTF-8 correctly; `fileName` is decoded per zip spec. |

### Renderer Hardening (existing, no changes)

- `webPreferences`: `contextIsolation: true, nodeIntegration: false, sandbox: true` (preserved).
- IPC: typed contract via `contextBridge.exposeInMainWorld('api', api)` — no raw IPC exposed.
- Input validation: zod schemas in `src/shared/validators.ts` at every IPC boundary.
- SafeStorage: Phase 2 encrypts PIN hashes; Phase 7 does not change the encryption boundary.

## Open Questions

1. **`useLanguage()` initial language source**
   - What we know: i18next has `i18next-browser-languagedetector` to pick from `<html lang>` / cookie / localStorage / querystring.
   - What's unclear: where does `<html lang>` come from at first boot? Phase 7 needs to read it from `auth.status.language` (active user) or `users.language` if no active user. Need an extra IPC: `auth.bootLanguage(): Promise<'en'|'ar'>` that reads `users.language` for the first user (or active user).
   - Recommendation: add `bootLanguage` IPC; `main.tsx` calls it before mounting `<App>`; passes result to `i18next.init({ lng: result })`.

2. **Restore "Activate this backup" button — UI affordance for the v1.1 placeholder**
   - What we know: D-14 ships the button as disabled with a v1.1 tooltip.
   - What's unclear: should the tooltip say "Available in v1.1" or "Coming soon" — Arabic translation tone.
   - Recommendation: copywriter pick — `07-UI-SPEC.md` already locked "Activate-this-backup will be available in v1.1" / "ستتوفر ميزة 'تفعيل هذه النسخة الاحتياطية' في الإصدار 1.1".

3. **`Intl.DateTimeFormat` locale resolution**
   - What we know: native API uses the OS locale by default. Need explicit locale: `formatDateTime(ts, lang)` → `new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-US', {...})`.
   - What's unclear: Arabic locale short-form vs long-form date format on Windows (Saudi Arabia vs Egypt vs generic 'ar'). GCC clinics prefer Saudi/UAE format (DMY).
   - Recommendation: hardcode `lang === 'ar' ? 'ar-SA' : 'en-US'`; falls back gracefully if the locale data is missing.

4. **Backup destination default filename on Windows**
   - What we know: D-09 locks the pattern `colonoscopist-backup-<YYYY-MM-DDTHH-mm-ss>.zip` (Windows-safe — no `:`).
   - What's unclear: does `dialog.showSaveDialog` use the `defaultPath` argument verbatim or strip the timestamp for display? Cross-check via Windows Save dialog UI; if it shows the timestamp, fine.
   - Recommendation: pass `defaultPath` as-is; if the dialog strips the timestamp, fall back to `colonoscopist-backup.zip`.

5. **NotoSansArabic TTF SHA — committed vs released**
   - What we know: D-25 locks the bundling; SIL OFL allows free redistribution.
   - What's unclear: do we commit the .ttf to git (~700KB) or use `git lfs` (not configured)?
   - Recommendation: commit directly; the file is small enough to live in git history; no LFS infrastructure in the repo.

## Sources

### Primary (HIGH confidence)

- **electron-vite official docs** — `electron-vite.org` — main/preload/renderer split; verified HMR config.
- **Electron security guidance** — `electronjs.org/docs/latest/tutorial/security` — `contextIsolation`, `sandbox`, `nodeIntegration: false` (no Phase 7 changes affect this baseline).
- **better-sqlite3 README** — `github.com/WiseLibs/better-sqlite3` — sync API, `db.backup()`, WAL checkpoint.
- **@react-pdf/renderer v4 docs** — `react-pdf.org` — `Font.register`, `<Text direction>`, StyleSheet.
- **i18next official docs** — `i18next.com` — init config, language detection, ICU interpolation.
- **archiver README** — `github.com/archiverjs/node-archiver` — streaming zip writer.
- **yauzl README** — `github.com/thejoshwolfe/yauzl` — streaming zip reader.

### Secondary (MEDIUM confidence)

- **NotoSansArabic SIL OFL license** — `fonts.google.com/noto/specimen/Noto+Sans+Arabic` — confirms free embeddability for clinical text.
- **Tailwind 3.4 `rtl:` variants** — `tailwindcss.com/docs/hover-focus-and-other-states#rtl-support` — confirms 3.4 native variants cover margin, padding, text-align, float, border-radius, space-x flips.
- **Radix UI DirectionProvider** — `radix-ui.com` — confirms `dir` propagation to primitives.

### Tertiary (LOW confidence)

- **PITFALLS.md §Pitfall 7 (RTL in shadcn)** — internal research doc; specific component behavior verified by Phase 7 D-22 smoke test, not pre-research.
- **PITFALLS.md §Pitfall 8 (PDF bidi)** — internal research doc; numeric isolation pattern verified by Phase 7 D-27 smoke test.

## Metadata

**Confidence breakdown:**

| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | Versions verified via `npm view` 2026-08-10; libraries are canonical Node/Electron standards. |
| Architecture | HIGH | Patterns mirror Phase 2-6 established flow (audit-on-every-read, IPC contract via contextBridge, WAL checkpoint from Phase 2 D-04). |
| Pitfalls | HIGH | Pitfalls 7/8/9 are documented in `.planning/research/PITFALLS.md` + `.planning/phases/07-CONTEXT.md`. |
| i18n | HIGH | i18next + react-i18next is the documented stack per PROJECT.md + STACK.md + D-20. |
| Backup/Restore | HIGH | archiver + yauzl are the documented stack per STACK.md + D-15. Wal_checkpoint + db.backup pattern is Phase 2 D-04. |
| AR PDF | MEDIUM | @react-pdf/renderer bidi is partial; D-25 wraps numeric fragments explicitly per Pitfall 8 mitigation. Manual smoke review per D-27 is the backstop. |
| RTL smoke | MEDIUM | Playwright not currently in the test stack; needs install + config. |

**Research date:** 2026-08-10
**Valid until:** 2026-09-10 (30 days — stable; only i18next/react-i18next have minor releases, no API breaks expected).

---

**Phase 7 ready for planning.** The CONTEXT.md decisions (D-01..D-27) are the contract; this RESEARCH.md gives the planner the concrete file paths, signatures, integration points, and test seams. The planner's job is to decompose the four surfaces (search, audit, backup/restore, i18n+AR PDF) into 4 plans + a shared trunk plan (migration + shadcn additions + IPC contract skeleton + i18n bundles), then sequence waves so each plan has its deps ready.