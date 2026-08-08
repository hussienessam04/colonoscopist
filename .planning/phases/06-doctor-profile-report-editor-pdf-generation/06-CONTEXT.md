# Phase 6: Doctor Profile + Report Editor + PDF Generation - Context

**Gathered:** 2026-08-08
**Status:** Ready for planning

## Phase Boundary

Doctor profile is editable and auto-fills the report PDF header; doctor can author a report draft with findings/diagnosis/recommendations and attach screenshots; report finalizes into a PDF stored locally. Phase 6 ships the `doctor_profile` table + profile editor, the `reports` + `report_screenshots` tables + report editor screen (draft → finalize state), and PDF generation via `@react-pdf/renderer` writing to `<userData>/data/reports/<reportId>.pdf`. Phase 6 PDF renders in **English only** — Arabic PDF rendering (RPT-06) ships in Phase 7 alongside the i18n work.

## Implementation Decisions

### Doctor profile storage

- **D-01:** Doctor profile lives in a **new `doctor_profile` table (1:1 with `users`)**. `users.full_name` stays as-is (English only, the auth/login + audit surface depends on it). The new `doctor_profile` row holds everything else: `id` (PK), `user_id` (FK → `users.id` UNIQUE), bilingual name + clinic fields, address, phone, signature path, logo path, timestamps. The Phase 2 wizard creates the `doctor_profile` row on first admin setup (in addition to the existing `users` row). Renderer wires a new dedicated page (Settings → Profile) for editing. — **Reversibility:** **one-way** — schema migration; the `doctor_profile` table is referenced by the report PDF header (PROF-02) and by the migration backfill. Renaming later requires a migration + renderer churn.
- **D-02:** Bilingual EN+AR fields use **parallel columns** on `doctor_profile`: `full_name_en TEXT NOT NULL`, `full_name_ar TEXT NULL`, `clinic_name_en TEXT NOT NULL`, `clinic_name_ar TEXT NULL`. AR columns are nullable — the doctor can fill them later (after Phase 7 lands the per-doctor language preference). Other fields (address, phone, signature, logo) are language-neutral — single column. Matches the Phase 2 `users.full_name TEXT` pattern: simple, grep-friendly, audit-friendly. — **Reversibility:** **reversible** — pure data shape; switching to JSON or an i18n table later requires a migration + IPC contract change but doesn't break runtime behavior.
- **D-03:** Phase 2's `settings.clinic_name` + `users.full_name` (EN only) are **migrated into `doctor_profile` on first launch after Phase 6 ships**: `doctor_profile.full_name_en = users.full_name`, `doctor_profile.clinic_name_en = settings.clinic_name`, AR columns NULL. The wizard is left untouched. The Settings → Profile page is the path forward — doctors fill in the bilingual details + upload signature/logo there. `settings.clinic_name` stays in the DB (Phase 2 IPC `auth.status` returns `clinicName` from it; rewriting that surface is out of Phase 6 scope; the report PDF reads from `doctor_profile`, not from `settings`). — **Reversibility:** **costly** — migration; the backfill is read-once and the original `settings.clinic_name` becomes legacy data. Future "drop legacy" is a separate cleanup migration.
- **D-04:** Field set is **minimal, per PROF-01 verbatim**: `full_name_en`, `full_name_ar`, `clinic_name_en`, `clinic_name_ar`, `address`, `phone`, `signature_path` (PNG/JPEG), `logo_path` (PNG/JPEG). One row per doctor; one upload per asset. No specialty, no qualifications, no clinic stamp, no per-asset name — those are v1.1 territory. — **Reversibility:** **reversible** — pure data shape; adding columns is a cheap migration.

### Signature + logo storage (agent's discretion)

- Asset storage is agent-discretion (user did not select this gray area). Default per Phase 4 D-04 + D-07 pattern: files on disk under `<userData>/data/profiles/<userId>/signature.{png,jpg}` + `<userData>/data/profiles/<userId>/logo.{png,jpg}`, with paths stored on `doctor_profile.signature_path` / `doctor_profile.logo_path` (userData-relative per Anti-Pattern 2). Backup zip (Phase 7) then captures the `profiles/` subtree naturally. PDF embeds via the resolved absolute path on read time (`videoFilePath` analogue — `profileAssetPath(userId, assetRel)` helper in `src/main/paths.ts`).

### Report state machine

- **D-05:** **One report per procedure (1:1)** — `reports.procedure_id` is UNIQUE. The doctor opens a draft, edits, finalizes. Admin edits a finalized report in-place (D-07 below); the same row is updated. No revision history beyond the audit log (`report.created`, `report.updated`, `report.finalized`, `report.admin_edited` rows). The PDF on disk is overwritten on finalize + on every post-finalize edit. Matches RPT-01 verbatim ("doctor can open a report draft for any procedure"). — **Reversibility:** **one-way** — schema migration; the UNIQUE constraint is referenced by the report editor's auto-create-on-open flow.
- **D-06:** After finalize, an edit bumps `reports.updated_at` only — **`finalized_at` stays frozen**. PDF on disk is regenerated to reflect the edit. The original `finalized_at` is the canonical "when this report became final"; subsequent edits are corrections. No new `first_finalized_at` column. — **Reversibility:** **reversible** — semantics only, no schema change; switching to bump `finalized_at` later requires no migration but loses the canonical timestamp.
- **D-07:** **Wider post-finalize edits**: admin (or any signed-in doctor per D-08) can edit `findings`, `diagnosis`, `recommendations` AND add/remove/reorder attached screenshots. Locked fields: `procedure_id`, `doctor_id`, `finalized_at`, `created_at`. The renderer disables controls for locked fields + the main IPC enforces with `UPDATE reports SET ... WHERE id = ? AND finalized_at IS NOT NULL` + per-column check. Every edit appends an `audit_log` row. — **Reversibility:** **reversible** — UI gate + main-side WHERE check; widening or narrowing later is renderer + handler change.
- **D-08:** The RPT-04 "only editable by an admin role" wording is interpreted loosely: **any signed-in doctor can edit a finalized report** (their own or someone else's). Admin role is informational/soft. Renderer shows a "Finalized · last edited by <X>" badge but doesn't gate controls. Main IPC does NOT check `is_first_admin` for post-finalize updates. Trade-off: matches the "small clinic, shared workstation" reality (Phase 2 D-02); loses the "admin audit-trail" guardrail that RPT-04 implies. — **Reversibility:** **reversible** — adding the role check is one WHERE-clause + one renderer flag; no schema impact.

### Report fields + auto-save

- Report fields: `findings TEXT`, `diagnosis TEXT`, `recommendations TEXT`, `procedure_details TEXT` (free text, default empty). All English-only fields (D-10). No AR mirror on the report — bilingual rendering is a Phase 7 concern.
- **Auto-save on blur** per the Phase 6 success criterion #2. Each field debounces ~300 ms on blur, fires `reports.update` IPC, writes a `report.updated` audit row. Distinct from the Phase 4 D-07 explicit-Save pattern for notes — the report is the doctor's primary deliverable, and silent save-on-blur matches clinical workflow (no "did I save?" anxiety). Empty string clears the field.

### Screenshot attachment

- `report_screenshots` join table: `report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE, screenshot_id INTEGER NOT NULL REFERENCES screenshots(id) ON DELETE CASCADE, sort_order INTEGER NOT NULL, PRIMARY KEY (report_id, screenshot_id)`. Indexed on `(report_id, sort_order ASC)` for the PDF render query.
- Doctor sees the procedure's full screenshot list (already populated by Phase 5's ScreenshotTimeline + lightbox) on the report editor; toggle which to attach; drag-to-reorder for sort_order. No cap — the doctor attaches as many as clinically useful (typical: 4–10).

### PDF generation

- **D-09:** **PDF cached on disk at finalize; re-rendered on every edit.** Path: `<userData>/data/reports/<reportId>.pdf` (per RPT-05). On Finalize click: main calls `renderReportPdf(reportId)` → @react-pdf/renderer → write to disk → store `pdf_path` + `pdf_generated_at` on the `reports` row. On every post-finalize edit: same path, file overwritten. Doctor's "Open PDF" click → IPC `reports.openPdf({ id })` → main resolves the file + spawns `electron.shell.openPath()` (the OS default viewer). Always read from disk — never re-render on open. Matches RPT-05 verbatim ("written to <userData>/data/reports/<reportId>.pdf") + RPT-07 ("open in OS default viewer"). — **Reversibility:** **one-way** — RPT-05 path is referenced by Phase 7 backup (`data/reports/` subtree) and by the renderer's "Reveal in Explorer" affordance.
- **D-10:** **PDF always renders in English** (per user direction). Fields are EN-only; the doctor fills `findings`/`diagnosis`/`recommendations` in English. The doctor's bilingual profile fields (`full_name_ar`, `clinic_name_ar`) exist (D-02) but are NOT used by the Phase 6 PDF renderer — the header uses `full_name_en` + `clinic_name_en` only. **RPT-06 ("PDF supports English and Arabic") is deferred to Phase 7** alongside the per-doctor language preference. Phase 6 ship gate does NOT include the AR smoke test (Pitfall 8 mitigation reduced to: verify EN PDF renders cleanly + numeric fragments in correct order + signature position correct). — **Reversibility:** **costly** — Phase 7 will need to add the AR rendering path + the language picker on the report editor + update the @react-pdf/renderer template to use `full_name_ar` + `clinic_name_ar` + bidi `<Text direction="rtl">` wrappers. The schema is forward-compatible (AR columns already nullable per D-02).
- **D-11:** PDF template is a **full clinical-report layout**:
  - **Header**: clinic logo (top-left, ~120×60px), clinic name + doctor name (top-right), procedure date (top-right under doctor name).
  - **Patient block**: full name, MRN, DOB, gender — auto-filled from the `patients` row.
  - **Procedure block**: started_at formatted as local date + duration (`HH:MM:SS`), doctor name.
  - **Body**: three labeled sections — Findings / Diagnosis / Recommendations. Each section's text rendered with English LTR.
  - **Attached screenshots**: one per page or as a grid below the body sections, ordered by `sort_order` ASC. Each screenshot rendered at native JPEG dimensions with a small "Fig. N" caption.
  - **Footer**: "Page X of Y" + clinic name (English).
  - One-column portrait, US Letter (8.5×11 in). Single page if no/few screenshots; multi-page when screenshots are attached.
- **D-12:** `src/main/pdf/report.tsx` is a new file with the @react-pdf/renderer React component. The renderer (`src/renderer/src/pages/ReportEditor.tsx`) does NOT render the PDF directly — the renderer is sandboxed and @react-pdf/renderer needs Node. Instead, the renderer passes the report data via IPC and main calls `@react-pdf/renderer.renderToFile()` (or `renderToBuffer()` + `fs.writeFile`). The component template imports `@react-pdf/renderer` + the data props. Matches `research/ARCHITECTURE.md §Component Responsibilities §PDF generator` — "called via a thin Node bridge".
- **D-13:** `@react-pdf/renderer` is added to `package.json` (not yet installed per Phase 5 STATE.md). Version pin: `^4.x` per `research/STACK.md §Version Compatibility` (React 18 compatibility). No new build config needed — `electron-vite` handles the import.

### Audit surface

- Phase 6 audit actions: `report.created`, `report.updated`, `report.screenshot_attached`, `report.screenshot_detached`, `report.finalized`, `report.admin_edited`, `report.pdf_generated`, `report.pdf_opened`, `profile.updated`, `profile.signature_uploaded`, `profile.logo_uploaded`. Minimum metadata: `{ reportId, field?: string }` for report updates; `{ reportId, screenshotId, sortOrder }` for attachment events; `{ reportId, pdfPath }` for PDF events; `{ userId, changedFields: string[] }` for profile updates.
- All events flow through `src/main/db/audit.ts:audit()` (Phase 2) — no bypassing.

### the agent's Discretion

- Exact migration filename (`0004_doctor_profile_and_reports.sql` recommended — covers `doctor_profile` + `reports` + `report_screenshots` in one file). Agent can split if preferred.
- Exact UI shape for the report editor (split pane: editor left, screenshots right? Or single column with screenshot toggle list?). Phase 4's ProcedureRoom "video left, tools right" pattern is the visual template.
- Exact `signature_path` / `logo_path` filename convention (recommend `signature.png` / `logo.png` — single canonical filename; doctor re-uploads overwrite).
- Image format validation (PNG/JPEG only per PROF-01) — accept-list vs. MIME-sniff vs. file-extension check. Recommendation: validate MIME via `mime-types` library (already not installed; pure-Node check via the JPEG/PNG magic bytes is zero-dep).
- Screenshot attachment UX — modal picker vs. inline list — agent picks the simpler one.
- "Reveal PDF in Explorer" affordance vs. "Open in OS viewer" only — recommend both (two buttons in the report editor's header).
- PDF page-number rendering for multi-attached-screenshot reports — `report_screenshots` count decides; agent picks the exact layout (one-per-page vs. 2-per-page grid).
- Whether `report_screenshots` rows are written atomically (single transaction) or one-at-a-time on each attach/detach. Recommendation: single transaction on Save (matches Phase 5's "renderer awaits IPC round-trip" pattern).
- Whether the @react-pdf/renderer template uses inline styles (their `StyleSheet.create()`) or theme objects — both work; agent picks per their style preference.

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements

- `.planning/ROADMAP.md` §Phase 6 — Goal, success criteria (note: success criterion #6 says "PDF renders correctly in English (LTR) and Arabic (RTL)" — **deferred to Phase 7 per D-10**), pitfalls addressed, notes
- `.planning/REQUIREMENTS.md` §PROF-01, §PROF-02, §RPT-01..07 — Traceability row maps these to Phase 6
- `.planning/PROJECT.md` §Key Decisions (`@react-pdf/renderer` rationale, `better-sqlite3` sync API, generic DirectShow capture), §Constraints (offline-only, Electron sandbox), §Out of Scope (cloud, DICOM, vendor SDKs)
- `.planning/STATE.md` §Current Focus (Phase 6 next milestone — Plan 06-01..N following the 4+ plans shape from Phase 5), §Phase 5 decisions (G-05-15 `screenshotUrl` helper, reusable across Phase 6 PDF preview)

### Technical research (stack, pitfalls, architecture)

- `.planning/research/STACK.md` §Supporting Libraries (`@react-pdf/renderer ^4` — React 18 compatibility), §What NOT to Use (Puppeteer/HTML-to-PDF vs @react-pdf/renderer rationale), §Version Compatibility
- `.planning/research/PITFALLS.md` §Pitfall 8 (PDF RTL bidi — explicit `<Text>` isolation, Latin fragments `direction: 'ltr'`). **Scope reduced for Phase 6 per D-10** — the AR smoke test moves to Phase 7.
- `.planning/research/ARCHITECTURE.md` §Component Responsibilities §PDF generator (main side, thin Node bridge), §Recommended Project Structure (`src/main/pdf/` directory, `src/main/pdf/report.tsx` entry), §Data Flow §5 Generate report flow

### Phase 2, 3, 4, 5 context (carry forward)

- `.planning/phases/02-database-patient-audit-auth/02-CONTEXT.md` — D-01..D-08 (migrations runner, audit helper, soft-delete, IPC contract pattern, wizard collects `fullName` EN + `clinicName`)
- `.planning/phases/03-capture-enumeration-live-preview/03-CONTEXT.md` — D-04 (per-doctor-per-device preset matrix in `settings`), D-11 (canonical device-name), Phase 3 decisions (Q-A first-save audit metadata)
- `.planning/phases/04-recording-timer-device-lost/04-CONTEXT.md` — D-01 (one child per procedure), D-03 (`.partial.mp4` + sidecar), D-06..D-09 (procedure notes), D-10 (canonical timer from `procedures.started_at`), D-11 (pause segments), `Procedure` entity shape (`startedAt`, `endedAt`, `durationSeconds`, `presetSummary`)
- `.planning/phases/05-screenshots-procedure-review-trim/05-CONTEXT.md` — D-04 (`screenshots` table shape — referenced by `report_screenshots` join), D-05 (`annotation` column nullable), D-07 (`video_path_original` non-destructive trim — report references `video_path` not the original), `Screenshot` entity shape (`timestampInVideoMs`, `filePath`, `annotation`, `createdAt`)

### Skills & procedures (how to ship Phase 6)

- `.opencode/skills/electron-vite/SKILL.md` — Three-process model; renderer↔main IPC contract
- `.opencode/skills/electron-sqlite/SKILL.md` — Migration runner; Phase 6 adds migrations for `doctor_profile` + `reports` + `report_screenshots` (one file recommended)

### Existing utility for screenshots (Phase 5 P12 + reuse)

- `src/renderer/src/lib/screenshot-url.ts:screenshotUrl()` — Phase 6 PDF preview thumbnails reuse this helper (no fourth copy of the leaf-filename regex + `/media/` template + `screenshots/` subdir). The `@react-pdf/renderer` template runs in main, so it can't import from `src/renderer/` — instead, main reads the JPEG via the existing `/media/` route on the MediaServer OR reads the file directly from `<userData>/data/media/patients/<p>/<proc>/screenshots/<file>.jpg`.

### Audit log integration (Phase 2 already wired)

- `src/main/db/audit.ts:audit()` — Phase 6 reuses for every `report.*` and `profile.*` event with structured metadata

### Schema baseline (Phase 5)

- `src/main/db/migrations/0001_init.sql` — `users` (Phase 2 source for backfill), `settings` (Phase 2 source for `clinic_name` backfill), `audit_log` (Phase 2)
- `src/main/db/migrations/0002_procedures.sql` — `procedures` table (Phase 4 source for `procedure_id` FK on `reports`)
- `src/main/db/migrations/0003_screenshots_and_trim.sql` — `screenshots` table (Phase 5 source for `screenshot_id` FK on `report_screenshots`)

## Existing Code Insights

### Reusable Assets

- `src/shared/ipc-contract.ts:IpcContract` — Phase 6 extends with `profile: { get, update, uploadSignature, uploadLogo }` + `reports: { getOrCreate, update, attachScreenshot, detachScreenshot, reorderScreenshots, finalize, openPdf, regenPdf }`. Phase 6 adds `DoctorProfile`, `Report`, `ReportScreenshot`, `PdfLanguage` types.
- `src/shared/ipc-contract.ts:IPC` — grows with `PROFILE_GET`, `PROFILE_UPDATE`, `PROFILE_UPLOAD_SIGNATURE`, `PROFILE_UPLOAD_LOGO`, `REPORTS_GET_OR_CREATE`, `REPORTS_UPDATE`, `REPORTS_ATTACH_SCREENSHOT`, `REPORTS_DETACH_SCREENSHOT`, `REPORTS_REORDER_SCREENSHOTS`, `REPORTS_FINALIZE`, `REPORTS_OPEN_PDF`, `REPORTS_REGEN_PDF`.
- `src/main/paths.ts:procedureMediaDir(patientId, procedureId)` — Phase 6 adds `profilesDir(userId)` + `profileAssetPath(userId, assetRel)` returning `<userData>/data/profiles/<userId>/<assetRel>`.
- `src/main/db/audit.ts:audit()` — Phase 6 reuses for every `report.*` and `profile.*` event.
- `src/main/auth/session.ts:session.currentUserId` — Phase 6 derives `userId` from `requireSession()` per Phase 2 BLOCKER 4. `getActiveProfile()` is a new helper: `doctor_profile` row lookup keyed by `session.currentUserId`.
- `src/preload/index.ts:api` — contextBridge surface; Phase 6 extends with `profile.*` + `reports.*` namespaces.
- `src/renderer/src/store/route.ts:useRoute()` — Phase 6 adds `'profile-edit'` + `'report-editor'; procedureId: string` + `'report-viewer'; reportId: string` to the `Route` union (or one `'report'; procedureId` route with two states). Agent picks based on UI flow.
- `src/renderer/src/lib/router.ts:Route` — same union extension.
- `src/renderer/src/components/ui/{button,card,scroll-area,alert,badge,dialog,dropdown-menu,select,textarea,checkbox,label,avatar}.tsx` — Phase 6 reuses for profile editor + report editor + report viewer; check shadcn registry for `select` + `textarea` + `dropdown-menu` (already installed per package.json Radix deps).
- `src/renderer/src/components/ScreenshotTimeline.tsx` (Phase 5) — Phase 6 reuses for the "screenshots available to attach" list inside the report editor (read-only mode + attach toggle).
- `src/renderer/src/components/ScreenshotThumbnail.tsx` (Phase 5) — Phase 6 reuses with an additional `attached?: boolean` + `onToggleAttach?: () => void` props.
- `src/renderer/src/components/ScreenshotLightbox.tsx` (Phase 5) — Phase 6 reuses for the "click thumbnail to expand" affordance on the report editor.
- `src/renderer/src/hooks/useProcedures.ts` (Phase 5) — Phase 6 may add `useReport(procedureId)` SWR-style hook matching the pattern.
- `src/renderer/src/lib/screenshot-url.ts:screenshotUrl()` (Phase 5 P12) — Phase 6 PDF preview thumbnails reuse via the same path composition; main-side PDF embed reads the JPEG directly from disk via `<userData>/data/media/patients/<p>/<proc>/screenshots/<file>.jpg`.

### Established Patterns

- **Typed IPC contract via contextBridge** — every renderer-callable method defined once in `src/shared/ipc-contract.ts`. Phase 6 extends, never invents.
- **One-way renderer → main for mutations, optimistic UI avoided** — renderer awaits IPC round-trip; report auto-save-on-blur (D) fires the IPC and waits for ack before clearing the "dirty" indicator.
- **Audit-on-every-mutation** — `audit({ action: 'report.created' | 'report.updated' | ..., entityType: 'report'|'profile', entityId, metadata: { ... } })` for every report + profile event.
- **No `any` in IPC contracts** — TS strict mode continues.
- **UserData-relative paths** — `doctor_profile.signature_path` and `logo_path` stored userData-relative per Anti-Pattern 2; absolute resolution happens at read time.
- **Single main-process ffmpeg child per operation** — N/A for Phase 6 (no ffmpeg in this phase); @react-pdf/renderer runs in main via Node, not as a child process.
- **Inline status, no modal** — UX-Pitfalls table; report auto-save indicator is inline (e.g., "Saved · 12:34:56 PM") not a modal toast.
- **shadcn primitives only** — Tailwind + shadcn; no new UI library. `select` + `textarea` + `dropdown-menu` already installed.
- **Migration per logical group** — single `0004_doctor_profile_and_reports.sql` covers all three new tables (doctor_profile + reports + report_screenshots). Agent's call to split if preferred.

### Integration Points

- `src/main/index.ts` — wires `registerProfileIpc()` + `registerReportsIpc()` + `initPdfRenderer()` after the existing patient/procedure/screenshot IPC. The profile IPC must register AFTER auth so `requireSession()` resolves.
- `src/preload/index.ts` — `api` object grows with `profile` + `reports` namespaces.
- `src/main/db/migrations.ts` — Phase 6 adds migration `0004_doctor_profile_and_reports.sql` (covers all three tables).
- `src/main/db/doctor-profile-repo.ts` (new) — `get(userId)`, `upsert(input)`, `updateSignaturePath(userId, relPath)`, `updateLogoPath(userId, relPath)`. Reuses the established repo pattern from Phase 2.
- `src/main/db/reports-repo.ts` (new) — `getOrCreate(procedureId, doctorId)`, `update(reportId, patch)`, `finalize(reportId)`, `addEdit(reportId, userId, fields)`, `getByProcedure(procedureId)`, plus the screenshot-attach helpers.
- `src/main/pdf/report.tsx` (new) — @react-pdf/renderer React component template. Receives `{ report, patient, procedure, doctor, profile, screenshots }` props. Exports a function `renderReportPdf(input: ReportPdfInput, outputPath: string): Promise<void>` that calls `pdf(<ReportPdf {...input} />).toFile(outputPath)`.
- `src/main/pdf/embed-image.ts` (new, optional) — small helper to load a JPEG/PNG from disk into a `Buffer` for @react-pdf/renderer's `<Image>` source. Uses Node `fs.readFile` (not the /media/ HTTP route).
- `src/shared/ipc-contract.ts` — extend `IPC` constants + `IpcContract` interface + `DoctorProfile` + `Report` + `ReportScreenshot` entity types.
- `src/renderer/src/App.tsx` — add `'profile-edit'` + `'report-editor'` (or `'report'`) route cases, gated on `status.authenticated`.
- `src/renderer/src/lib/router.ts` — `Route` union grows.
- `src/renderer/src/pages/ProfileEditor.tsx` (new) — full name EN+AR, clinic info EN+AR, address, phone, signature upload, logo upload. Auto-save on blur per D (consistency with report editor).
- `src/renderer/src/pages/ReportEditor.tsx` (new) — findings/diagnosis/recommendations/procedure_details text areas (auto-save on blur) + screenshot attachment list (reuse ScreenshotTimeline + toggle attach) + Finalize button + "Open PDF" button (post-finalize).
- `src/renderer/src/pages/ProcedureReview.tsx` (Phase 5) — Phase 6 adds a "Generate report" CTA button (or "Edit report" if a draft exists) that navigates to `'report-editor'; procedureId`.
- `src/renderer/src/SettingsHub.tsx` (Phase 3) — Phase 6 adds a "Profile" sub-page entry in the SettingsSidebar (shared pattern from Phase 3 D-06).

## Specific Ideas

- **Auto-save-on-blur for the report editor** — different from Phase 4's explicit-Save pattern for notes, but matches the doctor's mental model for "I'm writing the report now, don't make me click Save". Visual feedback: "Saving…", "Saved at 12:34:56 PM", or "Save failed — retry".
- **Screenshot attachment list mirrors the existing ScreenshotTimeline** — the doctor sees the same ~120×110px thumbnails they're used to from the ProcedureReview + ProcedureRoom. Toggle button on each ("Attach to report"). Reuses the existing `screenshotUrl` helper for the JPEG src — no fourth copy.
- **Logo top-left, signature top-right** — standard clinical-report layout. Both at fixed pixel sizes (~120×60 logo, ~120×40 signature) so the header doesn't grow/shrink per asset.
- **PDF page footer = clinic name + page number** — matches clinical-report conventions and gives the printed report a quick "what clinic is this from" identifier when pages get separated.
- **Profile editor reuses the wizard's card layout** — same `Card` + `CardHeader` + `CardContent` + `Label` + `Input` pattern from `Wizard.tsx`. Visual continuity for the doctor.
- **Migration backfill is idempotent** — `INSERT OR IGNORE INTO doctor_profile (user_id, ...) SELECT id, full_name, ... FROM users WHERE NOT EXISTS (SELECT 1 FROM doctor_profile WHERE user_id = users.id)`. Safe to run on every launch until the first row is created (the `NOT EXISTS` guard makes it a no-op).
- **"Reveal PDF in Explorer" alongside "Open PDF"** — two buttons in the report editor header. `shell.showItemInFolder(pdfPath)` for the first, `shell.openPath(pdfPath)` for the second. Same pattern as Electron's standard "show in folder" affordance.
- **`finalize_at` is the canonical "report complete" timestamp** — Phase 7's audit UI sorts/groups by `finalized_at`; edits don't move it (D-06).

## Deferred Ideas

- **Patient profile with past history** — user-suggested, but this is a new capability (patient profile page + past-procedure aggregation + chronic-condition tracking). Belongs in its own phase (e.g., Phase 9 v1.1) or folded into Phase 7's Search & History (SRCH-01..03 already covers cross-procedure lookup).
- **Arabic PDF rendering (RPT-06)** — Phase 7 ships the per-doctor language preference (I18N-01), the language picker on the report editor, and the @react-pdf/renderer template path that uses `full_name_ar` + `clinic_name_ar` + bidi `<Text direction="rtl">` wrappers + numeric fragment isolation (Pitfall 8 mitigation). Phase 6 PDF ships English-only per D-10.
- **Auto-translation of report body fields (EN → AR)** — out of v1 scope per REQUIREMENTS Out-of-Scope ("Speech-to-text dictation" defer pattern, no cloud translation service in an offline-only app).
- **Multi-version report history** — D-05 picks 1:1 with audit log as the change trail. A full version-stack with `reports_v2.version` is v1.1 territory if clinic demand materializes.
- **Custom report templates (RPT-08)** — v2 requirement per REQUIREMENTS §Reports. Phase 6 ships a single canonical template.
- **Auto-populated common findings macros (RPT-09)** — v2 requirement. Phase 6 ships free-text fields only.
- **Full-text search across report findings/diagnosis (SRCH-04)** — v2 requirement. Phase 6 fields are plain TEXT; FTS5 index is a Phase 7+ migration.
- **Doctor specialty + qualifications** — D-04 defers; v1.1 if clinics ask.
- **Clinic stamp / letterhead variant** — D-04 defers; v1.1 if regional demand.
- **Role gate on post-finalize edits (strict RPT-04 interpretation)** — D-08 interprets loosely. Adding the `is_first_admin` gate is one WHERE-clause + one renderer flag if clinic policy tightens.

---

*Phase: 6-doctor-profile-report-editor-pdf-generation*
*Context gathered: 2026-08-08*
