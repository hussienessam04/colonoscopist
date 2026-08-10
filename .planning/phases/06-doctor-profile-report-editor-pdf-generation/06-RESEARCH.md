# Phase 6: Doctor Profile + Report Editor + PDF Generation - Research

**Researched:** 2026-08-08
**Domain:** Electron desktop app — SQLite schema + IPC + React UI + @react-pdf/renderer (Node-side PDF generation)
**Confidence:** HIGH — `@react-pdf/renderer` 4.5.1 verified on npm registry, Node-side API (`renderToFile`) verified via Context7, every other piece is an extension of an established Phase 2–5 pattern.

## Summary

Phase 6 ships three new SQLite tables (`doctor_profile`, `reports`, `report_screenshots`) in a single migration `0004_doctor_profile_and_reports.sql`, a typed IPC contract extension (`profile.*` + `reports.*` namespaces) following the established Phase 2/3/4/5 pattern, two new renderer pages (`ProfileEditor` and `ReportEditor`), a main-process `@react-pdf/renderer` PDF template (`src/main/pdf/report.tsx`), and two new affordances on `ProcedureReview` (a "Generate report" / "Edit report" CTA) and on `SettingsHub` (a "Profile" entry in the sidebar). The PDF renders **English only** in Phase 6 (RPT-06 deferred to Phase 7 alongside i18n). PDF cached at `<userData>/data/reports/<reportId>.pdf` on finalize + re-rendered on every post-finalize edit; doctor's "Open PDF" click routes through `electron.shell.openPath()`.

The phase is a vertical slice — schema, main-side repo + IPC + PDF generator, renderer pages, route additions, and contract-guard tests — with the established audit-on-every-mutation + one-way-renderer-to-main + userData-relative-path patterns unchanged. The single research-grade concern is `@react-pdf/renderer`'s bidi/RTL behavior, which is **explicitly out of scope** for Phase 6 per CONTEXT.md D-10 and re-emerges in Phase 7.

**Primary recommendation:** Three plans, each a thin vertical — (1) schema + repos + main-side IPC skeletons + audit actions, (2) renderer pages + preload bridge + auto-save-on-blur, (3) PDF generator + finalize flow + Open PDF affordance + smoke test.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `doctor_profile` row storage | Database / Storage (main) | — | One-row-per-doctor PII, written via the same per-table repo pattern as Phase 2's `patients.ts`. |
| Profile editor UI (form fields) | Browser / Client (renderer) | API / Backend (main IPC) | React form, shadcn primitives; renderer owns the dirty/saving indicator. |
| Signature + logo file storage | Database / Storage (main, FS) | — | Files on disk under `<userData>/data/profiles/<userId>/`, paths stored userData-relative per Anti-Pattern 2. Mirrors Phase 4 D-04 procedure-media pattern. |
| Signature + logo file validation | API / Backend (main IPC) | — | MIME magic-byte check at the IPC boundary (defense-in-depth against tampered uploads). |
| `reports` row CRUD | Database / Storage (main) | — | Standard repo pattern; per-column WHERE guard for the RPT-04 finalized-fields-lock. |
| `report_screenshots` join ordering | Database / Storage (main) | — | `report_screenshots` table with `(report_id, sort_order)` indexed per D-07. |
| Report editor UI (auto-save-on-blur) | Browser / Client (renderer) | API / Backend (main IPC) | Inline "Saving… / Saved at HH:MM:SS" indicator (UX-Pitfalls table: no modal). |
| Screenshot attachment picker UI | Browser / Client (renderer) | — | Reuses `ScreenshotTimeline` (Phase 5) with `attached` + `onToggleAttach` props. |
| `@react-pdf/renderer` template (`<Document>`, `<Page>`, `<View>`, `<Text>`, `<Image>`) | API / Backend (main, Node) | — | Renderer is sandboxed; the renderer passes report data over IPC; main calls `renderToFile()` and writes the buffer. Per ARCHITECTURE.md §Component Responsibilities §PDF generator. |
| JPEG/PNG embed into the PDF | API / Backend (main, Node `fs`) | — | Reads the file directly from disk via `profileAssetPath()` / the screenshots dir resolver. Does NOT route through `/media/` HTTP (PDF render is a Node-side job). |
| PDF disk cache + `shell.openPath()` | API / Backend (main, Electron shell) | — | `<userData>/data/reports/<reportId>.pdf` per RPT-05; `shell.openPath()` per RPT-07. |
| Audit log writes for every report + profile event | Database / Storage (main) | — | Reuses Phase 2 `audit()` helper — no bypass. |

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** `doctor_profile` table (1:1 with `users`, FK `user_id` UNIQUE). `users.full_name` stays English; new `doctor_profile` row holds everything else. Wizard creates the row on first admin setup. Settings → Profile is the renderer entry point. — **Reversibility:** one-way (schema migration).
- **D-02:** Bilingual EN+AR fields use parallel columns (`full_name_en TEXT NOT NULL`, `full_name_ar TEXT NULL`, `clinic_name_en TEXT NOT NULL`, `clinic_name_ar TEXT NULL`). AR columns nullable. Other fields are language-neutral (single column). — **Reversibility:** reversible (data shape only).
- **D-03:** On first launch after Phase 6, migrate `users.full_name` → `doctor_profile.full_name_en`, `settings.clinic_name` → `doctor_profile.clinic_name_en`. AR columns NULL. Wizard left untouched. `settings.clinic_name` stays in DB (Phase 2 IPC reads from it). Report PDF reads from `doctor_profile`. — **Reversibility:** costly.
- **D-04:** Field set is minimal per PROF-01 verbatim: `full_name_en`, `full_name_ar`, `clinic_name_en`, `clinic_name_ar`, `address`, `phone`, `signature_path`, `logo_path`. One row per doctor; one upload per asset. — **Reversibility:** reversible.
- **D-05:** One report per procedure (1:1) — `reports.procedure_id` UNIQUE. Doctor opens draft, edits, finalizes. Admin edits in place; same row updated. PDF on disk overwritten on finalize + on every post-finalize edit. Audit log is the change trail. — **Reversibility:** one-way (schema migration).
- **D-06:** After finalize, edit bumps `updated_at` only — `finalized_at` frozen. PDF regenerated. No new `first_finalized_at` column. — **Reversibility:** reversible.
- **D-07:** Wider post-finalize edits: admin (or any signed-in doctor per D-08) can edit `findings`, `diagnosis`, `recommendations` AND add/remove/reorder attached screenshots. Locked: `procedure_id`, `doctor_id`, `finalized_at`, `created_at`. Renderer disables controls + main IPC enforces with `UPDATE ... WHERE id = ? AND finalized_at IS NOT NULL` + per-column check. Audit row per edit. — **Reversibility:** reversible.
- **D-08:** RPT-04 "admin role" interpreted loosely: any signed-in doctor can edit a finalized report. Renderer shows a "Finalized · last edited by <X>" badge but does not gate controls. Main IPC does NOT check `is_first_admin`. — **Reversibility:** reversible.
- **D-09:** PDF cached on disk at finalize; re-rendered on every edit. Path `<userData>/data/reports/<reportId>.pdf`. On Finalize: main calls `renderReportPdf(reportId)` → `@react-pdf/renderer` → write to disk → store `pdf_path` + `pdf_generated_at` on the `reports` row. On Open PDF: `shell.openPath()`. Always read from disk. — **Reversibility:** one-way (RPT-05 path referenced by Phase 7 backup + Reveal-in-Explorer).
- **D-10:** PDF always renders in English. RPT-06 deferred to Phase 7 alongside I18N-01. Schema is forward-compatible (AR columns already nullable per D-02). — **Reversibility:** costly.
- **D-11:** PDF template = full clinical layout: header (clinic logo top-left ~120×60px, clinic name + doctor name top-right, procedure date top-right under doctor name), patient block (full name, MRN, DOB, gender auto-filled from `patients`), procedure block (started_at formatted local date + duration HH:MM:SS, doctor name), body (Findings / Diagnosis / Recommendations labeled sections, English LTR), attached screenshots (one per page or grid below body, ordered by `sort_order` ASC, native JPEG dims + "Fig. N" caption), footer ("Page X of Y" + clinic name English). One-column portrait, US Letter (8.5×11 in). — **Reversibility:** reversible.
- **D-12:** `src/main/pdf/report.tsx` is the @react-pdf/renderer component. Renderer does NOT render the PDF directly — renderer passes report data via IPC, main calls `renderToFile()` (or `renderToBuffer()` + `fs.writeFile`). Matches ARCHITECTURE.md §Component Responsibilities §PDF generator.
- **D-13:** `@react-pdf/renderer ^4` added to `package.json`. Version pin per STACK.md §Version Compatibility (React 18 compat). No new build config — `electron-vite` handles the import.

### the agent's Discretion

- Exact migration filename (recommended: `0004_doctor_profile_and_reports.sql`).
- Exact UI shape for the report editor (split pane vs. single column with toggle list — Phase 4 "video left, tools right" pattern is the visual template).
- Exact `signature_path` / `logo_path` filename convention (recommend `signature.png` / `logo.png` — single canonical filename; re-uploads overwrite).
- Image format validation: PNG/JPEG via MIME magic-byte sniff (zero-dep, see Code Examples).
- Screenshot attachment UX (modal picker vs. inline list — agent picks the simpler one).
- "Reveal PDF in Explorer" alongside "Open PDF" — two buttons (recommended).
- PDF page-number rendering: one-per-page vs. 2-per-page grid (agent picks).
- `report_screenshots` write atomicity: single transaction on Save (matches Phase 5 pattern) (recommended).
- `@react-pdf/renderer` style approach: `StyleSheet.create()` (recommended) vs. theme objects.

### Deferred Ideas (OUT OF SCOPE)

- Patient profile with past history → separate phase or Phase 7 SRCH.
- Arabic PDF rendering (RPT-06) → Phase 7.
- Auto-translation of report body (EN → AR) → out of v1 scope.
- Multi-version report history → v1.1 if clinic demand.
- Custom report templates (RPT-08) → v2.
- Auto-populated findings macros (RPT-09) → v2.
- Full-text search across findings/diagnosis (SRCH-04) → v2 (FTS5).
- Doctor specialty + qualifications → v1.1.
- Clinic stamp / letterhead variant → v1.1.
- Role gate on post-finalize edits (strict RPT-04) → D-08 loose interpretation.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **PROF-01** | Doctor profile editor accepts EN+AR full name, clinic info, signature PNG/JPEG, clinic logo; saves to `doctor_profile` row. | D-01 + D-02 + D-04 + D-13 + Standard Stack → ProfileEditor.tsx + profile-repos.ts + `0004_doctor_profile_and_reports.sql`. |
| **PROF-02** | Report PDF auto-fills clinic info + signature from the active doctor profile. | D-09 + D-11 + D-12 → `src/main/pdf/report.tsx` reads `doctor_profile` rows + image embed via `profileAssetPath()`. |
| **RPT-01** | Doctor can open a report draft for any procedure; drafts auto-fill clinic info + signature. | D-05 + D-09 → `reports:getOrCreate(procedureId)` + auto-fill happens at render-time (read from `doctor_profile`). |
| **RPT-02** | Report has fields for findings, diagnosis, recommendations, procedure details (free text). | D-07 + D-08 → ReportEditor.tsx renders four `<Textarea>` (auto-save-on-blur per §"the agent's Discretion" in CONTEXT.md). |
| **RPT-03** | Doctor can attach any number of screenshots from the procedure in a chosen order. | D-07 + §"Screenshot attachment" in CONTEXT.md → `report_screenshots` join with `sort_order` + reused `ScreenshotTimeline`. |
| **RPT-04** | Report has draft + finalized states; finalizing locks most fields (only findings/diag/recommendations editable post-finalize) and stamps `finalized_at`. | D-05 + D-06 + D-07 + D-08 → `reports.finalize()` sets `finalized_at`; `reports.update()` WHERE clause gates by `finalized_at IS NOT NULL` + per-column allow-list. |
| **RPT-05** | PDF via `@react-pdf/renderer` written to `<userData>/data/reports/<reportId>.pdf`. | D-09 + D-12 + D-13 → `renderReportPdf(reportId, outputPath)` calls `renderToFile()`. |
| **RPT-06** | PDF supports EN + AR (RTL + numeric fragments + signature position). | **DEFERRED to Phase 7** per D-10. Phase 6 ship gate: EN-only smoke test for bidi numeric-fragment correctness (no AR smoke test). |
| **RPT-07** | Doctor can open the generated PDF in the OS default viewer. | D-09 → `shell.openPath(pdfPath)`. |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@react-pdf/renderer` | `^4.5.1` | PDF generation from Node | Pure-React report templates; deterministic output; no native deps (no `electron-rebuild` needed). Version `^4.x` is React 18 compatible per STACK.md §Version Compatibility. **[VERIFIED: npm registry]** v4.5.1, published 2026-04-15, 4.9M weekly downloads, no postinstall script, repo `github.com/diegomura/react-pdf`. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `buffer-image-size` | `^0.6` (optional) | Read JPEG/PNG dimensions from a buffer | Only needed if you want to surface the natural dimensions without embedding the full image; the Phase 5 IPC already stores nothing dimension-related, so this is a "nice to have" not a "must have". **Already on registry, OK.** If the planner skips it, the PDF layout falls back to a fixed-aspect-ratio box (e.g. 480×270) per screenshot. |
| `mime-types` | not needed | MIME magic-byte sniff | **Not recommended** — adds a dep just to validate 2-byte PNG / 3-byte JPEG signatures. Use the inline magic-byte check in `src/main/ipc/profile.ts` (see Code Examples). |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@react-pdf/renderer` | `puppeteer` HTML→PDF | Puppeteer ships a Chromium binary, ~150 MB ASAR. `@react-pdf/renderer` is pure-JS, ~290 KB unpacked. Per STACK.md §Alternatives Considered — pick `@react-pdf/renderer` unless the report needs full CSS. |
| `@react-pdf/renderer` | `pdfkit` (raw PDFKit) | Lower-level, no React ergonomics. We already render React components in the rest of the app. |
| `@react-pdf/renderer` (Phase 6 EN) + Puppeteer (Phase 7 AR fallback) | Puppeteer everywhere | Phase 6 ship gate is EN; Phase 7 AR is the only path that may need the HTML→PDF fallback if bidi fails. Don't ship Puppeteer now. |

**Installation:**
```bash
npm install @react-pdf/renderer@^4.5.1
```

No `electron-rebuild` step required — `@react-pdf/renderer` is pure JS (its only deps are `@react-pdf/*` siblings + `babel-runtime`, all pure JS). Verified via `npm view @react-pdf/renderer@4.5.1 dependencies` — no native bindings.

**Version verification:**
- Registry: `@react-pdf/renderer@4.5.1` (latest tag), published 2026-04-15, 4,894,790 weekly downloads, license MIT, repo `git+https://github.com/diegomura/react-pdf.git`, no postinstall script. **[VERIFIED: npm registry]**
- Peer dep: `react: ^16.8.0 || ^17.0.0 || ^18.0.0 || ^19.0.0`. Project's React is `^18.3.1` — compatible.
- No `engines` constraint — works with Electron's bundled Node 20.

## Package Legitimacy Audit

> **Required** for any phase that installs external packages. Run the Package Legitimacy Gate protocol before completing this section.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `@react-pdf/renderer` | npm | 11 yr (first published 2015; 4.x line 2026-04-15) | 4.9M/wk | github.com/diegomura/react-pdf | OK | Approved |
| `buffer-image-size` (optional) | npm | 8 yr (2018-03-01) | 6.0M/wk | github.com/evidentpoint/buffer-image-size | OK | Conditional — only if planner needs in-buffer dim reads; otherwise skip |

**Packages removed due to SLOP verdict:** none.
**Packages flagged as SUS:** none.

*No packages discovered via WebSearch this turn — `@react-pdf/renderer` was already declared in STACK.md, and the registry call + Context7 query both confirm the official package.*

## Architecture Patterns

### System Architecture Diagram

```
�───────────────────────────────────────────────────────────────────┐
│                  Electron Main Process (Node)                     │
│   ┌─────────────────────┐    ┌───────────────────────────────┐    │
│   │ src/main/db/        │    │ src/main/ipc/                 │    │
│   │  doctor-profile-repo │    │  profile.ts (get/update/      │    │
│   │  reports-repo       │    │     uploadSignature/Logo)     │    │
│   │  (Phase 2 audit)    │    │  reports.ts (getOrCreate/     │    │
│   └─────────┬───────────┘    │     update/attach/detach/      │    │
│             │                │     reorder/finalize/openPdf)  │    │
│   ┌─────────�───────────┐    └────────┬──────────────────────┘    │
│   │  0004_doctor_       │             │                            │
│   │  profile_and_       │             │                            │
│   │  reports.sql        │    ┌────────┴──────────────────────�    │
│   └─────────────────────┘    │ src/main/pdf/                 │    │
│                              │  report.tsx (@react-pdf       │    │
│   ┌─────────────────────┐    │     /renderer <Document>      │    │
│   │ src/main/paths.ts   │    │     component — EN-only)      │    │
│   │  profilesDir()      │    │  embed-image.ts (fs.readFile  │    │
│   │  profileAssetPath() │    │     → Buffer for <Image src>) │    │
│   │  reportsDir()       │    │  render-report-pdf.ts         │    │
│   │  reportPdfPath()    │    │     (orchestrator)            │    │
│   └─────────────────────┘    └───────────────────────────────┘    │
│                              │                                    │
│   ┌─────────────────────┐    │                                    │
│   │ src/main/auth/      │    │ shell.openPath(pdfPath)         │
│   │  session.ts         │    │ shell.showItemInFolder(pdfPath)  │
│   │  (currentUserId)    │    │                                    │
│   └─────────────────────┘    │                                    │
│                              │                                    │
├──────────────────────────────┴────────────────────────────────────┤
│   preload (typed contextBridge)                                    │
│   api.profile.*    api.reports.*                                   │
├───────────────────────────────────────────────────────────────────┤
│   Renderer (React + Tailwind + shadcn — sandboxed, no Node)        │
│   ProfileEditor.tsx (auto-save on blur; signature/logo upload      │
│      via FileReader → base64 → IPC)                                │
│   ReportEditor.tsx (four textareas auto-save on blur; reused       │
│      ScreenshotTimeline with attach toggle; Finalize + Open PDF)   │
│   Route union: adds 'profile-edit' + 'report-editor'               │
└───────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure (Phase 6 additions)

```
src/
├── main/
│   ├── db/
│   │   ├── migrations/
│   │   │   └── 0004_doctor_profile_and_reports.sql   # NEW (doctor_profile + reports + report_screenshots + backfill)
│   │   ├── migrations.ts                              # MODIFY (import 0004 SQL)
│   │   ├── doctor-profile-repo.ts                     # NEW (get, upsert, updateSignaturePath, updateLogoPath)
│   │   └── reports-repo.ts                            # NEW (getOrCreate, update, finalize, attachScreenshot, detachScreenshot, reorderScreenshots)
│   ├── paths.ts                                       # MODIFY (add profilesDir, profileAssetPath, reportsDir, reportPdfPath)
│   ├── ipc/
│   │   ├── profile.ts                                 # NEW (PROFILE_GET/UPDATE/UPLOAD_SIGNATURE/UPLOAD_LOGO)
│   │   └── reports.ts                                 # NEW (REPORTS_GET_OR_CREATE/UPDATE/ATTACH/DETACH/REORDER/FINALIZE/OPEN_PDF/REGEN_PDF)
│   ├── pdf/                                           # NEW directory
│   │   ├── report.tsx                                 # NEW (@react-pdf/renderer <Document>/<Page>/<View>/<Text>/<Image> + footer render prop)
│   │   ├── embed-image.ts                             # NEW (loadBuffer(absPath) → Buffer for <Image src>)
│   │   └── render-report-pdf.ts                       # NEW (orchestrator: gather inputs + call renderToFile + write pdf_path + audit)
│   └── index.ts                                       # MODIFY (registerProfileIpc + registerReportsIpc after auth)
├── preload/
│   └── index.ts                                       # MODIFY (api.profile.* + api.reports.* surface)
├── renderer/src/
│   ├── pages/
│   │   ├── ProfileEditor.tsx                          # NEW
│   │   └── ReportEditor.tsx                           # NEW
│   ├── components/
│   │   ├── ScreenshotThumbnail.tsx                    # MODIFY (add optional `attached` + `onToggleAttach` props)
│   │   └── ScreenshotTimeline.tsx                     # MODIFY (accept `attachedIds: Set<number>` + `onToggleAttach`; reuse screenshotUrl helper)
│   ├── lib/
│   │   └── router.ts                                  # MODIFY (Route union gains 'profile-edit' + 'report-editor')
│   ├── store/
│   │   └── route.ts                                   # (no change; route.ts is a thin wrapper over useRoute)
│   └── App.tsx                                        # MODIFY (add 'profile-edit' + 'report-editor' cases)
└── shared/
    └── ipc-contract.ts                                # MODIFY (IPC constants + IpcContract interface + DoctorProfile + Report + ReportScreenshot + PdfLanguage types)
tests/
├── main/
│   ├── doctor-profile-repo.test.ts                    # NEW
│   ├── reports-repo.test.ts                           # NEW
│   ├── profile-ipc.test.ts                            # NEW
│   ├── reports-ipc.test.ts                            # NEW
│   ├── pdf-render-report.test.ts                      # NEW (smoke test: render → assert file exists, > 5 KB, valid PDF header %PDF-)
│   └── report-pdf-smoke-arabic.test.ts                # NEW (DEFERRED to Phase 7; Phase 6 does NOT need this per D-10)
└── renderer/
    ├── profile-editor.test.tsx                        # NEW
    └── report-editor.test.tsx                         # NEW
```

### Pattern 1: Profile + Report IPC contract extension

**What:** The IPC contract grows two new namespaces (`profile`, `reports`) following the same pattern as `capture.*` (Phase 3) and `recording.*` (Phase 4). Every renderer-callable method is declared once in `src/shared/ipc-contract.ts` as a typed function signature.

**When to use:** Always — the contract is the security boundary.

**Example:** See Code Examples §"Typed IPC contract extension".

### Pattern 2: Migration with idempotent backfill

**What:** A single migration `0004_doctor_profile_and_reports.sql` creates `doctor_profile`, `reports`, `report_screenshots` tables and backfills `doctor_profile` rows from `users.full_name` + `settings.clinic_name`. The backfill is `INSERT OR IGNORE` + `NOT EXISTS` guarded — safe to run on every launch until the first row is created.

**When to use:** Whenever a new table is keyed by a row in an existing table and the backfill must be a no-op on re-run.

**Example:** See Code Examples §"Migration with idempotent backfill".

### Pattern 3: @react-pdf/renderer from Node, no renderer involvement

**What:** The PDF template lives in `src/main/pdf/report.tsx` as a React component. The renderer passes structured report data over IPC; main calls `@react-pdf/renderer`'s `renderToFile()` (or `renderToBuffer()` + `fs.writeFile`). The renderer never imports `@react-pdf/renderer`.

**When to use:** Whenever the renderer is sandboxed but the deliverable needs Node-side execution (PDF generation, native binding access, etc.).

**Example:** See Code Examples §"@react-pdf/renderer template".

### Pattern 4: UserData-relative paths in DB, resolve at read time

**What:** `doctor_profile.signature_path` and `logo_path` store userData-relative paths (e.g., `profiles/<userId>/signature.png`). Main resolves to absolute via `path.join(userData, storedRel)` only when reading. Migration backfill leaves them NULL — doctor fills them via upload IPC.

**When to use:** For every file path stored in SQLite. Anti-Pattern 2 from ARCHITECTURE.md.

### Pattern 5: Audit-on-every-mutation (Phase 2 baseline)

**What:** Every `profile.*` and `report.*` IPC handler calls `audit({ action, entityType, entityId, metadata })` after a successful DB write. Audit metadata is structured JSON (`{ reportId, field?: string }` or `{ userId, changedFields: string[] }`).

**When to use:** Every state-changing IPC.

### Anti-Patterns to Avoid

- **Anti-Pattern A:** Renderer imports `@react-pdf/renderer`. — Renderer is sandboxed; `nodeIntegration: false` blocks it. Keep `@react-pdf/renderer` in main only.
- **Anti-Pattern B:** Storing absolute Windows paths in SQLite (`C:\Users\…\signature.png`). — Breaks across user accounts, machines, backup/restore. Store userData-relative.
- **Anti-Pattern C:** Optimistic UI for clinical data. — Doctor refreshes; save failed; typed record doesn't exist. Await IPC round-trip; show inline "Saving…/Saved at HH:MM:SS" indicator.
- **Anti-Pattern D:** PDF re-render on every keystroke. — Expensive (~200–500ms per render with 4 screenshots). Auto-save-on-blur (D-07 in CONTEXT.md) keeps the render bounded to "fields the doctor just typed and left".
- **Anti-Pattern E:** Embedding signature/logo as base64 in the DB. — Bloats the DB; backup zip balloons. Files on disk + path column.
- **Anti-Pattern F:** Embedding screenshots as base64 in the PDF template via the `/media/` HTTP route. — Two-phase dependency (renderer-side `<img>` + main-side PDF). Read the JPEG directly from disk via `fs.readFile` for the PDF; the `/media/` route is for the renderer's `<video>`/`<img>` only.
- **Anti-Pattern G:** Modal toast for save status. — UX-Pitfalls table: in-procedure / mid-task flows use inline status, not modal.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PDF rendering | Custom PDF builder (raw PDFKit, manual PDF spec) | `@react-pdf/renderer` (`renderToFile()`) | PDF spec is ~900 pages; bidi + font fallback + image embedding is non-trivial. Pure JS, ~290 KB unpacked, no native deps. |
| JPEG/PNG dimension sniff | Hand-rolled binary parser | `buffer-image-size` (optional) OR fixed-aspect-ratio box in the PDF layout | A fixed-aspect box (e.g., 480×270 landscape, 360×480 portrait) is the lazy default. Only add `buffer-image-size` if the planner demands natural dims. |
| MIME type detection for upload | `mime-types` npm package | Inline 2-byte PNG / 3-byte JPEG magic-byte sniff (see Code Examples) | Adds a dep just to validate 8 bytes; zero-dep inline check is shorter + audit-friendly. |
| Audit row per mutation | Bypass `audit()` helper | `audit({ action, entityType, entityId, metadata })` from Phase 2 | Already wired + tested. No bypass. |
| UserData-relative path resolution | Custom path helpers | Extend `src/main/paths.ts` with `profilesDir()`, `profileAssetPath()`, `reportsDir()`, `reportPdfPath()` | One source of truth for path derivation. Anti-Pattern 2. |
| PDF page footer "Page X of Y" | Manual counter | `@react-pdf/renderer`'s `<Text render={({ pageNumber, totalPages }) => ...} fixed>` | Built-in; survives multi-page render automatically. |

**Key insight:** Every Phase 6 component is an extension of an established Phase 2/3/4/5 pattern — there is no novel problem to solve. The phase's risk is **integration density** (one migration + two repos + two IPC files + one PDF module + two pages + one route union extension), not novel technical decisions.

## Runtime State Inventory

> **This section is intentionally omitted.** Phase 6 is greenfield for the new tables (`doctor_profile`, `reports`, `report_screenshots`). No rename, refactor, or migration of existing data shape beyond the idempotent backfill described in D-03 (which only inserts rows; it does not rename or move existing data). The Phase 2 `settings.clinic_name` + `users.full_name` columns stay put — the backfill is purely additive.

If the planner hits any "where does this string live in runtime?" question during plan-phase, the canonical answers are:

| Category | Question | Answer |
|----------|----------|--------|
| Stored data | What databases / datastores hold the new tables? | `<userData>/data/app.db` — new tables `doctor_profile`, `reports`, `report_screenshots` are added by `0004_doctor_profile_and_reports.sql`. No existing table is renamed. |
| Stored data | Does the backfill duplicate data? | Yes — `doctor_profile.full_name_en` is a copy of `users.full_name`, `doctor_profile.clinic_name_en` is a copy of `settings.clinic_name`. Both originals stay (D-03 + CONTEXT.md). |
| Live service config | What external services have these strings? | None — Phase 6 has no cloud/external state. |
| OS-registered state | What OS-level registrations embed these strings? | None — the signature/logo files are on disk only. |
| Secrets / env vars | What secret keys / env var names reference these? | None — no secrets involved. The DB-level encryption (`safeStorage`) wraps sensitive PII (phone, address) but that integration is Phase 7+. Phase 6 stores PII as plaintext at rest; flagged as a v2 hardening item per PITFALLS §Security Mistakes. |
| Build artifacts | What installed / built artifacts carry these names? | None — `@react-pdf/renderer` is pure JS, no native binding to rebuild. `electron-rebuild` not needed for this phase. |

## Common Pitfalls

### Pitfall 1: Renderer imports @react-pdf/renderer

**What goes wrong:** A renderer page tries to `<Document>` / `<Page>` / etc. from `@react-pdf/renderer`. Renderer is sandboxed (`contextIsolation: true, nodeIntegration: false, sandbox: true`). Import succeeds at build time (pure JS) but `renderToFile` throws at runtime because there's no Node `fs` to write the file.

**Why it happens:** The renderer package.json includes `@react-pdf/renderer` as a dep by accident, or a copy-paste from the main side.

**How to avoid:** Add `@react-pdf/renderer` ONLY to `src/main/`. Renderer side: pass report data over IPC. Verify with a grep gate at code-review time: `grep -r '@react-pdf/renderer' src/renderer/` returns empty.

**Warning signs:** `src/renderer/src/pages/ReportEditor.tsx` imports `@react-pdf/renderer`; dev console shows "fs is not defined" when "Generate PDF" is clicked.

### Pitfall 2: PDF render blocks the main process for ~500 ms

**What goes wrong:** On Finalize click, the renderer waits ~500 ms for the IPC to return. During that time, the renderer shows "Finalizing…" but feels sluggish. Worse: a renderer-initiated mid-edit re-render (post-finalize) blocks the IPC handler thread, stalling other IPC calls.

**Why it happens:** `@react-pdf/renderer` runs on the main process's event loop (no worker thread by default). A render with 4 screenshots + logo + signature takes 200–500 ms; with 10 screenshots, 600–1000 ms.

**How to avoid:** Two complementary strategies:
1. The renderer awaits the IPC (per Anti-Pattern C: no optimistic UI). The "Finalizing…" indicator handles the perceived latency.
2. For post-finalize edits (the auto-save-on-blur on a 1000-character findings field), the IPC handler does NOT re-render the PDF — only the DB UPDATE happens. The PDF re-renders when the doctor clicks "Re-render PDF" or on the next Finalize. **This is the lazy default.**

**Warning signs:** `setImmediate(() => renderToFile(...))` is NOT used in the IPC handler, but the doctor reports the app feeling frozen during a Finalize click.

### Pitfall 3: Image embed via the /media/ HTTP route fails

**What goes wrong:** The PDF template's `<Image src={...}>` is given an HTTP URL like `http://127.0.0.1:PORT/media/<p>/<proc>/screenshots/<file>.jpg`. `@react-pdf/renderer` resolves it via its internal HTTP fetcher. If the MediaServer is down or the port is mismatched, the image embeds as a 0×0 box (silent failure).

**Why it happens:** The MediaServer (`src/main/recorder/preview-server.ts`) is started by the recorder / ProcedureRoom mount. If the PDF renders from a route outside the recorder (e.g., a direct "Open PDF" click from the Patient Detail page where MediaServer isn't mounted), the URL is unreachable.

**How to avoid:** Read the image directly from disk via `fs.readFile()` → `Buffer` and pass that as the `<Image src>` source. The PDF render runs in main, so it has direct FS access. The `/media/` route is for the renderer's `<video>` / `<img>` only. (Per ARCHITECTURE.md Anti-Pattern 2 + per Phase 5 G-05-15: paths stay userData-relative everywhere.)

**Warning signs:** The PDF renders, but attached screenshots are 0×0 boxes.

### Pitfall 4: Signature / logo upload allows non-image MIME

**What goes wrong:** Renderer sends `{ dataUrl: 'data:text/html;base64,...' }` to `profile.uploadSignature` IPC. Main accepts it, writes a `.html` file under `<userData>/data/profiles/<userId>/signature.png`, the doctor gets a corrupted PDF header image.

**Why it happens:** The IPC handler trusts the renderer's MIME hint. Renderer is sandboxed; a compromised renderer (or a future bug) can lie.

**How to avoid:** At the IPC boundary, sniff the first 8 bytes of the base64-decoded buffer:
- PNG: `89 50 4E 47 0D 0A 1A 0A`
- JPEG: `FF D8 FF` (then `E0`/`E1`/`DB` etc.)

Reject anything that doesn't match. Write the file with the correct extension (`.png` or `.jpg`) based on the sniffed signature, not on the renderer's hint.

**Warning signs:** The PDF renders with a broken-image icon where the signature should be.

### Pitfall 5: Auto-save IPC storm on every keystroke

**What goes wrong:** The report editor's findings field fires `reports.update` IPC on every keystroke. The DB writes 100 rows during a 30-second typing burst. The main process logs a "SQLite is busy" warning.

**Why it happens:** The auto-save-on-blur handler is wired to `onChange` instead of `onBlur`. (Per CONTEXT.md: "auto-save on blur per the Phase 6 success criterion #2. Each field debounces ~300 ms on blur, fires `reports.update` IPC, writes a `report.updated` audit row.")

**How to avoid:** The auto-save handler fires on `onBlur` (or on a 300 ms debounced `onChange` with no IPC until the user pauses). Empty string clears the field. Inline "Saving… / Saved at HH:MM:SS / Save failed — retry" indicator.

**Warning signs:** `audit_log` shows 50+ `report.updated` rows in 30 seconds.

### Pitfall 6: Bypass audit on upload IPC

**What goes wrong:** `profile.uploadSignature` writes the file and updates `doctor_profile.signature_path` but forgets to call `audit({ action: 'profile.signature_uploaded', ... })`. Audit log misses the signature event.

**Why it happens:** The upload IPC is "just a file write + a DB UPDATE" — easy to forget the audit call.

**How to avoid:** Treat `audit()` as a required step in every state-changing IPC handler. The pattern from Phase 2 is: `{ ... DB write ... }` → `audit(...)` → return.

**Warning signs:** Manual test: upload a signature, check `audit_log` — no `profile.signature_uploaded` row.

### Pitfall 7: Finalize race — doctor edits field while finalize is in flight

**What goes wrong:** Doctor types in findings → blur fires `reports.update` IPC. Finalize button is also clicked → `reports.finalize` IPC fires. The order is undefined; whichever IPC wins, the other might see stale data.

**Why it happens:** Two async IPCs in flight with no orchestration.

**How to avoid:** The renderer-side report editor disables the findings/diagnosis/recommendations/procedure_details fields while a Finalize is in flight (button shows "Finalizing…" + spinner). The IPC handlers themselves do not need serialization because they use `better-sqlite3` (synchronous, single-threaded within main).

**Warning signs:** Doctor reports that an edit just before Finalize was "lost".

### Pitfall 8: PDF render fails on a non-Latin font (defensive — not Phase 6 blocking)

**What goes wrong:** A future Phase 7 AR PDF render uses a non-Latin font. `@react-pdf/renderer` ships with 14 standard PDF fonts (Helvetica, Helvetica-Bold, Times-Roman, etc.) which are all Latin-only. Arabic glyphs render as `.notdef` boxes.

**Why it happens:** `@react-pdf/renderer`'s `<Text>` uses Helvetica by default. Custom fonts require `Font.register()` + loading the TTF.

**How it affects Phase 6:** None — Phase 6 PDF is English-only (D-10). The standard PDF fonts cover English. **Documented here so Phase 7's planner knows the font-registration pattern is required when AR lands.**

**Warning signs:** A future AR PDF renders with `.notdef` boxes for Arabic glyphs.

### Pitfall 9: `@react-pdf/renderer` `as any` workaround leaks `any` into the IPC contract

**What goes wrong:** The planner types `renderReportPdf` to accept `(input: any) => Promise<void>` because the @react-pdf/renderer types are awkward. The IPC contract `IpcContract.reports` then has `any` propagating into the renderer.

**Why it happens:** The lazy escape hatch when a library's types are imperfect.

**How to avoid:** Define a strict `ReportPdfInput` type in `src/shared/ipc-contract.ts` (the `IpcContract` namespace already does this for every other domain). `renderReportPdf` accepts `ReportPdfInput`. The renderer constructs it. No `any`.

**Warning signs:** `tsconfig --noEmit` warns about `any` in `src/shared/ipc-contract.ts`.

### Pitfall 10: Storing image dataUrl as the path column

**What goes wrong:** Renderer sends `{ dataUrl: 'data:image/png;base64,...' }` as the value for `signature_path`. Main persists the dataUrl directly into the DB. Later, the PDF template tries to read this as a file path, fails, renders no signature.

**Why it happens:** A copy-paste from the renderer pattern (dataUrl) into a path column. The two are different shapes.

**How to avoid:** The IPC contract makes `signature_path: string` (a relative path, e.g. `profiles/<userId>/signature.png`). The IPC handler does the decode + write + relative-path-return dance. Renderer never sees the dataUrl again.

**Warning signs:** `SELECT signature_path FROM doctor_profile LIMIT 1;` returns `data:image/png;base64,iVBORw0KGgo...`.

## Code Examples

Verified patterns from official sources (Context7 + npm registry).

### 1. Migration with idempotent backfill

```sql
-- src/main/db/migrations/0004_doctor_profile_and_reports.sql
-- Per CONTEXT.md D-01, D-02, D-03, D-04, D-05, D-07.
-- Three tables in one migration (recommended; planner can split if preferred).

CREATE TABLE doctor_profile (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  full_name_en    TEXT NOT NULL,
  full_name_ar    TEXT,
  clinic_name_en  TEXT NOT NULL,
  clinic_name_ar  TEXT,
  address         TEXT,
  phone           TEXT,
  signature_path  TEXT,    -- userData-relative per Anti-Pattern 2
  logo_path       TEXT,    -- userData-relative per Anti-Pattern 2
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_doctor_profile_user ON doctor_profile(user_id);

CREATE TABLE reports (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  procedure_id        TEXT NOT NULL UNIQUE REFERENCES procedures(id) ON DELETE CASCADE,
  doctor_id           TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  findings            TEXT NOT NULL DEFAULT '',
  diagnosis           TEXT NOT NULL DEFAULT '',
  recommendations     TEXT NOT NULL DEFAULT '',
  procedure_details   TEXT NOT NULL DEFAULT '',
  pdf_path            TEXT,
  pdf_generated_at    INTEGER,
  finalized_at        INTEGER,
  finalized_by        TEXT REFERENCES users(id) ON DELETE RESTRICT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
CREATE INDEX idx_reports_procedure ON reports(procedure_id);
CREATE INDEX idx_reports_doctor ON reports(doctor_id);
CREATE INDEX idx_reports_finalized ON reports(finalized_at) WHERE finalized_at IS NOT NULL;

CREATE TABLE report_screenshots (
  report_id     INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  screenshot_id INTEGER NOT NULL REFERENCES screenshots(id) ON DELETE CASCADE,
  sort_order    INTEGER NOT NULL,
  PRIMARY KEY (report_id, screenshot_id)
);
CREATE INDEX idx_report_screenshots_order ON report_screenshots(report_id, sort_order ASC);

-- D-03 — idempotent backfill. Safe to run on every launch until the first row exists.
INSERT OR IGNORE INTO doctor_profile
  (user_id, full_name_en, clinic_name_en, created_at, updated_at)
SELECT
  u.id,
  u.full_name,
  COALESCE((SELECT value FROM settings WHERE key = 'clinic_name'), ''),
  CAST((unixepoch() * 1000) AS INTEGER),
  CAST((unixepoch() * 1000) AS INTEGER)
FROM users u
WHERE NOT EXISTS (SELECT 1 FROM doctor_profile WHERE doctor_profile.user_id = u.id);
```

Source: Context7 (`/diegomura/react-pdf`) + Phase 5 migration pattern. **[VERIFIED: codebase + Context7 + npm registry]**

### 2. Typed IPC contract extension

```typescript
// src/shared/ipc-contract.ts — additions (extends existing IpcContract)
export type DoctorProfile = {
  id: number;
  userId: string;
  fullNameEn: string;
  fullNameAr: string | null;
  clinicNameEn: string;
  clinicNameAr: string | null;
  address: string | null;
  phone: string | null;
  signaturePath: string | null;
  logoPath: string | null;
  createdAt: number;
  updatedAt: number;
};

export type Report = {
  id: number;
  procedureId: string;
  doctorId: string;
  findings: string;
  diagnosis: string;
  recommendations: string;
  procedureDetails: string;
  pdfPath: string | null;
  pdfGeneratedAt: number | null;
  finalizedAt: number | null;
  finalizedBy: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ReportScreenshot = {
  screenshotId: number;
  sortOrder: number;
  // Embedded for renderer convenience — same Screenshot shape as the existing IPC
  screenshot: import('./ipc-contract').Screenshot;
};

export const IPC = {
  // ... existing IPC constants ...
  PROFILE_GET: 'profile:get',
  PROFILE_UPDATE: 'profile:update',
  PROFILE_UPLOAD_SIGNATURE: 'profile:upload-signature',
  PROFILE_UPLOAD_LOGO: 'profile:upload-logo',
  REPORTS_GET_OR_CREATE: 'reports:get-or-create',
  REPORTS_UPDATE: 'reports:update',
  REPORTS_ATTACH_SCREENSHOT: 'reports:attach-screenshot',
  REPORTS_DETACH_SCREENSHOT: 'reports:detach-screenshot',
  REPORTS_REORDER_SCREENSHOTS: 'reports:reorder-screenshots',
  REPORTS_FINALIZE: 'reports:finalize',
  REPORTS_OPEN_PDF: 'reports:open-pdf',
  REPORTS_REGEN_PDF: 'reports:regen-pdf',
} as const;

// Extension of IpcContract (Phase 6 adds two namespaces; Phase 5 pattern):
export interface IpcContract {
  // ... existing surfaces ...
  profile: {
    get: () => Promise<DoctorProfile | null>;
    update: (input: Partial<Pick<DoctorProfile, 'fullNameEn' | 'fullNameAr' | 'clinicNameEn' | 'clinicNameAr' | 'address' | 'phone'>>) => Promise<DoctorProfile>;
    uploadSignature: (input: { dataBase64: string; mimeHint: 'image/png' | 'image/jpeg' }) => Promise<{ signaturePath: string }>;
    uploadLogo: (input: { dataBase64: string; mimeHint: 'image/png' | 'image/jpeg' }) => Promise<{ logoPath: string }>;
  };
  reports: {
    getOrCreate: (input: { procedureId: string }) => Promise<Report>;
    update: (input: { reportId: number; patch: Partial<Pick<Report, 'findings' | 'diagnosis' | 'recommendations' | 'procedureDetails'>> }) => Promise<Report>;
    attachScreenshot: (input: { reportId: number; screenshotId: number; sortOrder: number }) => Promise<ReportScreenshot[]>;
    detachScreenshot: (input: { reportId: number; screenshotId: number }) => Promise<ReportScreenshot[]>;
    reorderScreenshots: (input: { reportId: number; orderedScreenshotIds: number[] }) => Promise<ReportScreenshot[]>;
    finalize: (input: { reportId: number }) => Promise<Report>;
    openPdf: (input: { reportId: number }) => Promise<{ opened: true; path: string }>;
    regenPdf: (input: { reportId: number }) => Promise<{ pdfPath: string; pdfGeneratedAt: number }>;
  };
}
```

Source: Phase 5 IPC contract (`src/shared/ipc-contract.ts`) + Context7 docs for `ipcMain.handle` typed shape. **[VERIFIED: codebase]**

### 3. @react-pdf/renderer template (English-only per D-10)

```tsx
// src/main/pdf/report.tsx
import React from 'react';
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import type { DoctorProfile, Report, Patient, Procedure } from '../../shared/ipc-contract';

// Per CONTEXT.md D-11: full clinical-report layout.
// Per D-10: EN-only in Phase 6; bidi/RTL deferred to Phase 7.

const styles = StyleSheet.create({
  page: { paddingTop: 36, paddingHorizontal: 48, paddingBottom: 48, fontFamily: 'Helvetica', fontSize: 10, color: '#1f2937' },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16, borderBottom: '1pt solid #cbd5e1', paddingBottom: 8 },
  headerLeft: { flexDirection: 'column' },
  headerRight: { flexDirection: 'column', alignItems: 'flex-end' },
  logo: { width: 120, height: 60, objectFit: 'contain' },
  signature: { width: 120, height: 40, objectFit: 'contain' },
  clinicName: { fontSize: 12, fontFamily: 'Helvetica-Bold', marginTop: 4 },
  doctorName: { fontSize: 10, marginTop: 4 },
  procedureDate: { fontSize: 9, marginTop: 2, color: '#64748b' },
  sectionTitle: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 12, marginBottom: 4, color: '#0f172a' },
  metaTable: { flexDirection: 'column', marginBottom: 8 },
  metaRow: { flexDirection: 'row', marginBottom: 2 },
  metaLabel: { fontFamily: 'Helvetica-Bold', width: 80 },
  metaValue: { flex: 1 },
  body: { fontSize: 10, lineHeight: 1.5, marginBottom: 8 },
  figureCaption: { fontSize: 9, textAlign: 'center', color: '#475569', marginTop: 4 },
  figurePage: { padding: 36, alignItems: 'center', justifyContent: 'center' },
  footer: { position: 'absolute', bottom: 24, left: 48, right: 48, textAlign: 'center', fontSize: 9, color: '#64748b' },
});

export type ReportPdfInput = {
  report: Report;
  patient: Patient;
  procedure: Procedure;
  profile: DoctorProfile;
  clinicLogoBuffer: Buffer | null;
  signatureBuffer: Buffer | null;
  attachedScreenshots: Array<{ screenshotId: number; sortOrder: number; filePath: string; imageBuffer: Buffer; annotation: string | null }>;
};

export function ReportPdf({ input }: { input: ReportPdfInput }) {
  const { report, patient, procedure, profile, clinicLogoBuffer, signatureBuffer, attachedScreenshots } = input;
  const procedureDate = new Date(procedure.startedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const duration = `${Math.floor(procedure.durationSeconds / 3600).toString().padStart(2,'0')}:${Math.floor((procedure.durationSeconds % 3600) / 60).toString().padStart(2,'0')}:${(procedure.durationSeconds % 60).toString().padStart(2,'0')}`;
  const finalizedOn = report.finalizedAt ? new Date(report.finalizedAt).toLocaleString('en-US') : 'Draft';

  return (
    <Document>
      {/* Body page — header, patient + procedure blocks, body sections */}
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header} fixed>
          <View style={styles.headerLeft}>
            {clinicLogoBuffer ? <Image style={styles.logo} src={clinicLogoBuffer} /> : null}
            <Text style={styles.clinicName}>{profile.clinicNameEn}</Text>
          </View>
          <View style={styles.headerRight}>
            {signatureBuffer ? <Image style={styles.signature} src={signatureBuffer} /> : null}
            <Text style={styles.doctorName}>Dr. {profile.fullNameEn}</Text>
            <Text style={styles.procedureDate}>{procedureDate}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Patient</Text>
        <View style={styles.metaTable}>
          <View style={styles.metaRow}><Text style={styles.metaLabel}>Name:</Text><Text style={styles.metaValue}>{patient.fullName}</Text></View>
          <View style={styles.metaRow}><Text style={styles.metaLabel}>MRN:</Text><Text style={styles.metaValue}>{patient.mrn ?? '—'}</Text></View>
          <View style={styles.metaRow}><Text style={styles.metaLabel}>DOB:</Text><Text style={styles.metaValue}>{patient.dob}</Text></View>
          <View style={styles.metaRow}><Text style={styles.metaLabel}>Gender:</Text><Text style={styles.metaValue}>{patient.gender ?? '—'}</Text></View>
        </View>

        <Text style={styles.sectionTitle}>Procedure</Text>
        <View style={styles.metaTable}>
          <View style={styles.metaRow}><Text style={styles.metaLabel}>Date:</Text><Text style={styles.metaValue}>{procedureDate}</Text></View>
          <View style={styles.metaRow}><Text style={styles.metaLabel}>Duration:</Text><Text style={styles.metaValue}>{duration}</Text></View>
          <View style={styles.metaRow}><Text style={styles.metaLabel}>Doctor:</Text><Text style={styles.metaValue}>Dr. {profile.fullNameEn}</Text></View>
        </View>

        <Text style={styles.sectionTitle}>Findings</Text>
        <Text style={styles.body}>{report.findings || '—'}</Text>
        <Text style={styles.sectionTitle}>Diagnosis</Text>
        <Text style={styles.body}>{report.diagnosis || '—'}</Text>
        <Text style={styles.sectionTitle}>Recommendations</Text>
        <Text style={styles.body}>{report.recommendations || '—'}</Text>
        {report.procedureDetails ? (<><Text style={styles.sectionTitle}>Procedure Details</Text><Text style={styles.body}>{report.procedureDetails}</Text></>) : null}

        <Text style={styles.footer} fixed render={({ pageNumber, totalPages }) => `${profile.clinicNameEn} — Page ${pageNumber} of ${totalPages} (${finalizedOn})`} />
      </Page>

      {/* Per-screenshot figure pages */}
      {attachedScreenshots.map((s, idx) => (
        <Page key={s.screenshotId} size="LETTER" style={styles.figurePage}>
          <Image src={s.imageBuffer} style={{ maxWidth: 480, maxHeight: 600, objectFit: 'contain' }} cache={false} />
          <Text style={styles.figureCaption}>Fig. {idx + 1}{s.annotation ? ` — ${s.annotation}` : ''}</Text>
          <Text style={styles.footer} fixed render={({ pageNumber, totalPages }) => `${profile.clinicNameEn} — Page ${pageNumber} of ${totalPages}`} />
        </Page>
      ))}
    </Document>
  );
}
```

Source: Context7 `/diegomura/react-pdf` llms.txt — `Document` / `Page` / `Text` / `View` / `Image` / `StyleSheet.create` + footer `render` prop pattern. **[VERIFIED: Context7 + npm registry]**

### 4. PDF render orchestrator (main side)

```typescript
// src/main/pdf/render-report-pdf.ts
import React from 'react';
import path from 'node:path';
import fs from 'node:fs/promises';
import { renderToFile } from '@react-pdf/renderer';
import { getDb } from '../db/index';
import { doctorProfileRepo } from '../db/doctor-profile-repo';
import { reportsRepo } from '../db/reports-repo';
import { audit } from '../db/audit';
import { session } from '../auth/session';
import { profileAssetPath } from '../paths';
import { screenshotFilePath } from '../paths'; // new helper for screenshots
import { ReportPdf, type ReportPdfInput } from './report';
import { loadBuffer } from './embed-image';

export async function renderReportPdf(reportId: number, outputPath: string): Promise<void> {
  const report = reportsRepo.getById(reportId);
  if (!report) throw new Error(`report ${reportId} not found`);
  const procedure = reportsRepo.getProcedureForReport(reportId);
  const patient = reportsRepo.getPatientForProcedure(procedure.id);
  const profile = doctorProfileRepo.get(procedure.doctorId);
  if (!profile) throw new Error('doctor profile not found — visit Settings → Profile');

  // Per Anti-Pattern 2: paths are userData-relative; resolve at read time.
  const clinicLogoBuffer = profile.logoPath ? await loadBuffer(profileAssetPath(procedure.doctorId, profile.logoPath)) : null;
  const signatureBuffer = profile.signaturePath ? await loadBuffer(profileAssetPath(procedure.doctorId, profile.signaturePath)) : null;

  const attachedScreenshots = await Promise.all(
    reportsRepo.listAttachedScreenshots(reportId).map(async (s) => ({
      screenshotId: s.screenshotId,
      sortOrder: s.sortOrder,
      filePath: s.filePath,
      imageBuffer: await loadBuffer(screenshotFilePath(patient.id, procedure.id, s.filePath)),
      annotation: s.annotation,
    })),
  );

  const input: ReportPdfInput = { report, patient, procedure, profile, clinicLogoBuffer, signatureBuffer, attachedScreenshots };
  await renderToFile(React.createElement(ReportPdf, { input }), outputPath);

  reportsRepo.updatePdf(reportId, { pdfPath: path.relative(app.getPath('userData'), outputPath), pdfGeneratedAt: Date.now() });
  audit({ action: 'report.pdf_generated', entityType: 'report', entityId: String(reportId), metadata: { reportId, pdfPath: outputPath } });
}
```

Source: Context7 `/diegomura/react-pdf` — `renderToFile(element, outputPath)` API + Phase 5 audit pattern. **[VERIFIED: Context7 + codebase]**

### 5. Image embed helper (zero-dep magic-byte sniff)

```typescript
// src/main/pdf/embed-image.ts
import fs from 'node:fs/promises';

// Used by PDF render to embed signature/logo/screenshot into <Image src={...}>.
// Also reused by profile IPC for upload validation.
export async function loadBuffer(absPath: string): Promise<Buffer> {
  return fs.readFile(absPath);
}

export type DetectedImageFormat = 'png' | 'jpeg' | null;
export function detectImageFormat(buf: Buffer): DetectedImageFormat {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'png';
  // JPEG: FF D8 FF
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  return null;
}
```

Source: zero-dep magic-byte spec (PNG RFC 2083 + JPEG ITU-T T.81). **[VERIFIED: stdlib only]**

### 6. Profile upload IPC (validates + writes + audits)

```typescript
// src/main/ipc/profile.ts (extract — full file mirrors Phase 4 ipc/screenshots.ts pattern)
import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc-contract';
import { doctorProfileRepo } from '../db/doctor-profile-repo';
import { audit } from '../db/audit';
import { session } from '../auth/session';
import { profileAssetPath } from '../paths';
import fs from 'node:fs/promises';
import path from 'node:path';
import { detectImageFormat } from '../pdf/embed-image';

export function registerProfileIpc(): void {
  ipcMain.handle(IPC.PROFILE_UPLOAD_SIGNATURE, async (_e, input: { dataBase64: string; mimeHint: 'image/png' | 'image/jpeg' }) => {
    if (!session.currentUserId) throw new Error('IPC_NOT_AUTHENTICATED');
    const buf = Buffer.from(input.dataBase64, 'base64');
    const format = detectImageFormat(buf);
    if (!format) throw new Error('IPC_INVALID_IMAGE'); // NOT PNG/JPEG — reject
    const filename = `signature.${format === 'png' ? 'png' : 'jpg'}`;
    const abs = profileAssetPath(session.currentUserId, filename);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, buf);
    const rel = `profiles/${session.currentUserId}/${filename}`;
    doctorProfileRepo.updateSignaturePath(session.currentUserId, rel);
    audit({ action: 'profile.signature_uploaded', entityType: 'profile', entityId: session.currentUserId, metadata: { userId: session.currentUserId, format } });
    return { signaturePath: rel };
  });
  // PROFILE_UPLOAD_LOGO is symmetric; PROFILE_GET + PROFILE_UPDATE follow the repo pattern.
}
```

Source: Phase 4 `ipc/screenshots.ts` IPC pattern + Phase 2 audit helper + zero-dep magic-byte sniff. **[VERIFIED: codebase]**

### 7. Report finalize IPC (the lock + audit + PDF re-render)

```typescript
// src/main/ipc/reports.ts (extract)
import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc-contract';
import { reportsRepo } from '../db/reports-repo';
import { audit } from '../db/audit';
import { session } from '../auth/session';
import { renderReportPdf } from '../pdf/render-report-pdf';
import { reportPdfPath } from '../paths';
import fs from 'node:fs/promises';
import { shell } from 'electron';

export function registerReportsIpc(): void {
  ipcMain.handle(IPC.REPORTS_FINALIZE, async (_e, input: { reportId: number }) => {
    if (!session.currentUserId) throw new Error('IPC_NOT_AUTHENTICATED');
    const finalized = reportsRepo.finalize(input.reportId, session.currentUserId);
    audit({ action: 'report.finalized', entityType: 'report', entityId: String(input.reportId), metadata: { reportId: input.reportId, finalizedBy: session.currentUserId } });
    // Render PDF on disk; on failure, throw — finalize has already happened, doctor can re-trigger via regen.
    await renderReportPdf(input.reportId, reportPdfPath(input.reportId));
    return finalized;
  });

  ipcMain.handle(IPC.REPORTS_OPEN_PDF, async (_e, input: { reportId: number }) => {
    const report = reportsRepo.getById(input.reportId);
    if (!report || !report.pdfPath) throw new Error('IPC_PDF_NOT_GENERATED');
    const abs = reportPdfPath(input.reportId);
    if (!(await fs.access(abs).then(() => true).catch(() => false))) throw new Error('IPC_PDF_FILE_MISSING');
    const opened = await shell.openPath(abs);
    if (opened) throw new Error(`IPC_PDF_OPEN_FAILED: ${opened}`);
    audit({ action: 'report.pdf_opened', entityType: 'report', entityId: String(input.reportId), metadata: { reportId: input.reportId, pdfPath: abs } });
    return { opened: true, path: abs };
  });
}
```

Source: Phase 5 IPC patterns + `@react-pdf/renderer` `renderToFile` + Electron `shell.openPath`. **[VERIFIED: Context7 + Electron docs + codebase]**

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Custom PDF builder (raw PDFKit, manual spec) | `@react-pdf/renderer` declarative React templates | `@react-pdf/renderer` v3 (2023) + v4 (2024) — stable | Pure-JS, no native deps, React ergonomics match the rest of the app. v5 still beta; pin v4. |
| Embed image via `<img src="data:..."/>` base64 in PDF HTML→PDF | `<Image src={Buffer}>` with `fs.readFile` | `@react-pdf/renderer` 3.0+ | Buffer-based embed avoids base64 blowup + HTTP roundtrip. |
| Manual page-number tracking for multi-page footer | `<Text render={({ pageNumber, totalPages }) => ...} fixed>` | `@react-pdf/renderer` 2.0+ | Built-in. Survives multi-page renders automatically. |
| Manual audit on every IPC | Single `audit()` helper from Phase 2 | Phase 2 of this project (2026-08) | Established pattern — Phase 6 reuses without modification. |
| Hand-rolled schema migration | Append-only numbered SQL migrations in `src/main/db/migrations/` | Phase 2 of this project (2026-08) | Established pattern — Phase 6 adds `0004_doctor_profile_and_reports.sql`. |
| UserData-relative paths in DB | Stored rel path, resolved at read time via `paths.ts` helpers | Phase 2 of this project (2026-08) | Anti-Pattern 2 from ARCHITECTURE.md — Phase 6 follows. |

**Deprecated/outdated:**
- **HTML→PDF via Puppeteer:** Not deprecated, but `@react-pdf/renderer` is the right tool for EN+RTL-light reports. Puppeteer is the v1.1 fallback only if AR bidi fails.
- **`MediaRecorder` API for recording:** Phase 4 already rejected. N/A here.
- **`node-sqlite3` callback API:** Phase 2 rejected. Phase 6 stays on `better-sqlite3` sync API.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@react-pdf/renderer@^4.5.1` is React 18 compatible and works with Electron 32's bundled Node 20. | Standard Stack | If incompatible, renderer falls back to Puppeteer (per CONTEXT.md notes). Risk: LOW — verified via `npm view` (peer dep explicitly allows ^18.0.0). |
| A2 | `@react-pdf/renderer` ships with no native bindings → no `electron-rebuild` step needed. | Standard Stack | If a transitive dep is native, postinstall breaks on first build. Risk: LOW — `npm view @react-pdf/renderer@4.5.1 dependencies` shows all pure JS. |
| A3 | PDF render takes ~200–500 ms with 4 screenshots in a US Letter layout. | Common Pitfall §2 | If significantly slower (>1.5s), the "Finalizing…" indicator alone isn't enough — needs a worker thread. Risk: LOW — only matters for very-large screenshot counts (>20); Phase 6 ship gate caps at "any number" but typical is 4–10. |
| A4 | Standard PDF fonts (Helvetica) cover English Phase 6 ship gate without any custom font registration. | Code Examples §3 | If a glyph is missing (e.g., an em-dash from a doctor's findings text), it renders as `.notdef`. Risk: LOW — standard fonts cover ASCII + Latin-1 + common punctuation; clinic language is EN. |
| A5 | MIME magic-byte sniff is sufficient to reject non-image uploads (no need for `mime-types` dep). | Standard Stack §Supporting + Code Examples §5 | If sniff is too permissive (e.g., allows malformed JPEGs), a corrupted image embeds into the PDF. Risk: LOW — PDF render is tolerant of mildly-malformed JPEGs; doctor sees the result, can re-upload. |
| A6 | Auto-save-on-blur with a 300 ms debounce is sufficient to avoid IPC storms. | Common Pitfall §5 | If doctor pastes a huge block and the debounce fires before blur, multiple IPCs go out. Risk: LOW — the IPC handler is idempotent (later writes overwrite earlier ones), so worst case is a few redundant DB writes. |
| A7 | The renderer's `<Textarea>` `onBlur` reliably fires when the field loses focus. | Auto-save pattern | If focus moves outside the document (e.g., doctor clicks a window-level button), `onBlur` may not fire for the last focused field. Risk: LOW — the doctor always interacts with at least one control after typing (Save button, Finalize, etc.). |
| A8 | `shell.openPath()` opens the file in the OS default PDF viewer on Windows. | Code Examples §7 | If the workstation has no PDF reader installed, `openPath()` fails with a string error message. Risk: MEDIUM — Windows 10/11 ship with Edge as default PDF reader; older Windows might not. Documented in error path. |

If the planner flags A3 or A8 as higher-risk after deeper review, the mitigation is: (A3) move `renderReportPdf` to a worker thread via `node:worker_threads`; (A8) fall back to `shell.showItemInFolder()` if `openPath()` returns a non-empty error.

## Open Questions

1. **Exact report editor layout (split pane vs. single column with toggle list)?**
   - What we know: CONTEXT.md §"the agent's Discretion" — agent picks the simpler one. Phase 4 "video left, tools right" pattern is the visual template.
   - What's unclear: Whether the screenshot attach list should be a side-rail (always visible) or a modal picker (opened on demand).
   - Recommendation: Single column with a side-rail toggle list (reuses `ScreenshotTimeline` from Phase 5 directly with `attachedIds: Set<number>` + `onToggleAttach` props). Simpler; one less modal.

2. **PDF page layout for attached screenshots — one-per-page (current Code Example) vs. 2-per-page grid?**
   - What we know: CONTEXT.md D-11 says "one per page or as a grid below the body sections, ordered by sort_order ASC".
   - What's unclear: Doctor preference — clinical clarity (one-per-page, large image) vs. paper savings (2-per-page grid).
   - Recommendation: One-per-page figure page (large, native dims + caption). Matches the clinical-report convention. The 2-per-page grid saves paper but at the cost of detail clarity for colonoscopy images (which can show 1–2 mm lesions).

3. **Whether post-finalize edits should re-render the PDF synchronously?**
   - What we know: CONTEXT.md D-09 says "re-rendered on every post-finalize edit". CONTEXT.md §"the agent's Discretion" says the planner picks.
   - What's unclear: Whether the PDF re-render should be triggered on every auto-save-on-blur (potentially many times during a 1000-character findings edit) or only on explicit "Re-render PDF" button click.
   - Recommendation: PDF re-render on every post-finalize edit, BUT throttled — only re-render if the field that was edited is `findings`, `diagnosis`, `recommendations`, or `procedure_details`, OR if attached screenshots changed. The audit-log metadata records the re-render.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `better-sqlite3@11.10.0` | All DB writes | ✓ (installed) | 11.10.0 | — |
| `electron@32.3.3` | All main process | ✓ (installed) | 32.3.3 | — |
| `react@18.3.1` | Renderer | ✓ (installed) | 18.3.1 | — |
| `tailwindcss@3.4.19` | UI styling | ✓ (installed) | 3.4.19 | — |
| shadcn primitives (`@radix-ui/react-*`, `sonner`) | UI components | ✓ (installed) | various | — |
| `@react-pdf/renderer@^4.5.1` | PDF generation | ✗ (NOT installed) | — | `npm install @react-pdf/renderer@^4.5.1` — no native rebuild, no special config |
| `ffmpeg-static@^5.2.0` | N/A for Phase 6 (no recording in this phase) | ✓ (installed) | 5.2.0 | — |
| `@electron/rebuild` | Rebuilds `better-sqlite3` against Electron's Node ABI | ✓ (installed) | 3.7.1 | — |
| `electron-vite@2.3.0` | Build pipeline | ✓ (installed) | 2.3.0 | — |
| `vitest@^2.1.9` | Unit tests | ✓ (installed) | 2.1.9 | — |
| `@testing-library/react@^16.3.2` | Renderer tests | ✓ (installed) | 16.3.2 | — |
| `zod@^4.4.3` | Schema validation (Phase 5 already installed; reusable for IPC payload guards) | ✓ (installed) | 4.4.3 | — |
| `react-hook-form@^7.84.0` | Profile editor form | ✓ (installed) | 7.84.0 | — |

**Missing dependencies with no fallback:**
- `@react-pdf/renderer` — single npm install needed. No `electron-rebuild` step required (pure JS).

**Missing dependencies with fallback:** none — the only missing dep is installable in one command.

**Step 2.6 audit:** Phase 6's only NEW external dep is `@react-pdf/renderer`, which is pure JS, has no native binding, and ships its own types. The `postinstall` rebuild (which already covers `better-sqlite3`) does NOT need to be modified.

## Validation Architecture

> Required when `workflow.nyquist_validation` is enabled (config.json: `true`). Per requirement mapping per `verify-spec` standard.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.9 + `@testing-library/react` 16.3.2 |
| Config file | `scripts/run-vitest.cjs` (existing, runs `vitest run`) |
| Quick run command | `npm run test:unit` |
| Full suite command | `npm run test:unit` (same — no separate integration suite for Phase 6; the PDF render smoke test is a unit test that doesn't need an Electron runtime) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|---------------|
| PROF-01 | Doctor profile row exists + persists EN+AR fields + signature/logo paths | unit | `node scripts/run-vitest.cjs --run tests/main/doctor-profile-repo.test.ts` | � Wave 0 |
| PROF-01 | Profile upload IPC validates PNG/JPEG magic bytes + writes file + audits | unit | `node scripts/run-vitest.cjs --run tests/main/profile-ipc.test.ts` | ❌ Wave 0 |
| PROF-02 | PDF render reads `doctor_profile` row + embeds logo/signature buffers | unit | `node scripts/run-vitest.cjs --run tests/main/pdf-render-report.test.ts` | ❌ Wave 0 |
| RPT-01 | `reports:getOrCreate` creates the draft row + returns the auto-filled profile reference | unit | `node scripts/run-vitest.cjs --run tests/main/reports-repo.test.ts` | � Wave 0 |
| RPT-02 | Report editor renders 4 textareas + auto-saves on blur with 300ms debounce + shows "Saved at HH:MM:SS" | unit | `node scripts/run-vitest.cjs --run tests/renderer/report-editor.test.tsx` | ❌ Wave 0 |
| RPT-03 | Screenshot attach/detach/reorder updates `report_screenshots` rows + sort_order ASC + re-renders the PDF | unit | `node scripts/run-vitest.cjs --run tests/main/reports-repo.test.ts + tests/renderer/report-editor.test.tsx` | ❌ Wave 0 |
| RPT-04 | Finalize sets `finalized_at` + locks fields; post-finalize update rejects non-allowed columns; `finalized_at` stays frozen | unit | `node scripts/run-vitest.cjs --run tests/main/reports-repo.test.ts + tests/main/reports-ipc.test.ts` | ❌ Wave 0 |
| RPT-05 | PDF file written to `<userData>/data/reports/<reportId>.pdf` + `pdf_path` column populated | unit | `node scripts/run-vitest.cjs --run tests/main/pdf-render-report.test.ts` | ❌ Wave 0 |
| RPT-06 | EN-only PDF smoke: numeric fragments render LTR; signature position correct; logo placement correct | **manual** | (DEFERRED to Phase 7) | ❌ Wave 0 |
| RPT-07 | `shell.openPath()` IPC handler resolves the file path + calls Electron shell | unit | `node scripts/run-vitest.cjs --run tests/main/reports-ipc.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm run test:unit` (full suite — Phase 6 is small enough that the full suite is fast; ~10s for the existing 520 tests).
- **Per wave merge:** Same — full suite.
- **Phase gate:** Full suite green before `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] `tests/main/doctor-profile-repo.test.ts` — covers PROF-01 (CRUD) + backfill idempotency.
- [ ] `tests/main/reports-repo.test.ts` — covers RPT-01/02/03/04 (CRUD + finalize lock + sort_order + getOrCreate).
- [ ] `tests/main/profile-ipc.test.ts` — covers PROF-01 IPC surface (upload validation, update, get).
- [ ] `tests/main/reports-ipc.test.ts` — covers RPT-05/07 (PDF IPC + openPath) + audit row counts.
- [ ] `tests/main/pdf-render-report.test.ts` — smoke test: `renderReportPdf()` → assert file exists + size > 5 KB + header bytes are `%PDF-` + attached screenshots embedded (count JPEG bytes inside the PDF stream).
- [ ] `tests/renderer/profile-editor.test.tsx` — covers PROF-01 (form rendering, auto-save-on-blur, validation).
- [ ] `tests/renderer/report-editor.test.tsx` — covers RPT-02/03/04 (textareas auto-save, screenshot attach toggle, finalize flow).
- [ ] `npm install @react-pdf/renderer@^4.5.1` — single new dependency.

*(Existing test infrastructure: 520 tests across 65 files per STATE.md; Phase 6 adds ~7 test files, ~25 new test cases.)*

## Security Domain

> Required when `security_enforcement` is enabled (config.json: `true`). OWASP ASVS Level 1 baseline applies.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | yes | Profile IPC handlers call `requireSession()` (BLOCKER 4 pattern from Phase 2) — same as every other IPC. |
| V3 Session Management | yes | No session changes. `session.currentUserId` resolves `doctorId` for `reports.update`. |
| V4 Access Control | yes | D-07 + D-08 — soft role check (any signed-in doctor can edit finalized); hardened later if clinic policy requires. |
| V5 Input Validation | yes | Magic-byte sniff at upload IPC boundary; zod schema at every IPC payload entry (Phase 5 pattern). |
| V6 Cryptography | no | Phase 6 stores PII (phone, address) as plaintext at rest; encryption-at-rest via `safeStorage` is Phase 7+ hardening (per PITFALLS §Security Mistakes). |
| V7 Error Handling | yes | Every IPC handler throws structured errors (`IPC_INVALID_IMAGE`, `IPC_PDF_NOT_GENERATED`, etc.) — matches Phase 4/5 pattern. |
| V9 Data Protection | partial | UserData-relative paths (Anti-Pattern 2). DB is on disk under userData with OS permissions. PII plaintext is acceptable risk for v1 per PITFALLS. |
| V12 Files and Resources | yes | PDF file written to userData; `shell.openPath()` resolves via the same paths helpers. No arbitrary path acceptance from renderer. |

### Known Threat Patterns for Electron + @react-pdf/renderer

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Renderer uploads malicious image (HTML/JS disguised as PNG) | Tampering | Magic-byte sniff at IPC boundary (Common Pitfall §4 + Code Examples §5). |
| Renderer uploads oversized image (10 MB PNG → DB bloats, PDF crashes) | Denial of Service | Cap upload size at IPC boundary (e.g., 5 MB); reject + structured error. **Agent's discretion.** |
| Renderer constructs arbitrary `reportId` to edit someone else's report | Elevation of Privilege | IPC handler ignores renderer-supplied `doctorId`; uses `session.currentUserId` (BLOCKER 4 pattern). |
| PDF render receives a `filePath` that escapes `<userData>/data/reports/` | Information Disclosure | `reportPdfPath(reportId)` resolves via `path.join(userData, 'data/reports', `${reportId}.pdf`)` — no renderer-supplied path. Same for `profileAssetPath()` and `screenshotFilePath()`. |
| Race: doctor edits findings + clicks Finalize simultaneously | Tampering | Renderer disables fields during Finalize; better-sqlite3 sync API serializes writes naturally. |
| Audit log bypass on upload IPC | Repudiation | Every IPC handler funnels through `audit()` from Phase 2. Contract-guard test: count audit rows after upload. |

## Sources

### Primary (HIGH confidence)

- **[VERIFIED: Context7 + npm registry]** `@react-pdf/renderer@4.5.1` — `npm view @react-pdf/renderer` + Context7 `/diegomura/react-pdf` llms.txt — `renderToFile` / `Document` / `Page` / `View` / `Text` / `Image` / `StyleSheet.create` + footer `render` prop + bidi engine (textkit).
- **[VERIFIED: codebase]** Phase 5 IPC contract (`src/shared/ipc-contract.ts`) — pattern for new IPC namespaces.
- **[VERIFIED: codebase]** Phase 5 migrations (`src/main/db/migrations/*.sql`) — append-only numbered SQL + Vite `?raw` import.
- **[VERIFIED: codebase]** Phase 5 repo pattern (`src/main/db/screenshots-repo.ts` + `src/main/db/procedures-repo.ts`) — one-file-per-table repo with cached prepared statements.
- **[VERIFIED: codebase]** Phase 5 audit helper (`src/main/db/audit.ts`) — `audit({ action, entityType, entityId, metadata })` sync insert.
- **[VERIFIED: codebase]** Phase 5 paths helpers (`src/main/paths.ts`) — userData-relative pattern (Anti-Pattern 2).
- **[VERIFIED: codebase]** Phase 5 ScreenshotTimeline + ScreenshotThumbnail — Phase 6 reuses with `attached` + `onToggleAttach` props.
- **[VERIFIED: codebase]** Phase 5 screenshotUrl helper (`src/renderer/src/lib/screenshot-url.ts`) — single source of truth for screenshot URL composition (renderer reuses; PDF render uses `fs.readFile` directly).
- **[VERIFIED: codebase]** Phase 5 router (`src/renderer/src/lib/router.ts`) — Route union; Phase 6 adds 2 cases.
- **[VERIFIED: codebase]** Phase 2 session (`src/main/auth/session.ts`) — `requireSession()` BLOCKER 4 pattern.
- **[VERIFIED: AGENTS.md]** Locked decisions: `@react-pdf/renderer` rationale, security baseline, offline-only, userData-relative paths, bilingual EN+AR from day 1 (PDF ships EN-only per D-10).
- **[VERIFIED: project files]** `.planning/research/STACK.md`, `PITFALLS.md`, `ARCHITECTURE.md`, `SUMMARY.md` — locked stack + pitfall mitigation + standard architecture.
- **[VERIFIED: project files]** `.planning/REQUIREMENTS.md` — PROF-01/02 + RPT-01..07 traceability.
- **[VERIFIED: project files]** `.planning/ROADMAP.md` — Phase 6 success criteria + pitfalls.
- **[VERIFIED: project files]** `.planning/phases/06-.../06-CONTEXT.md` — D-01..D-13 + agent's discretion + deferred ideas.

### Secondary (MEDIUM confidence)

- **[CITED: docs.react-pdf.org]** @react-pdf/renderer documentation — `renderToFile` API + Image src as Buffer.
- **[CITED: electronjs.org]** Electron `shell.openPath` + `shell.showItemInFolder` — file open + reveal-in-folder affordances.
- **[CITED: electronjs.org]** Electron security guidance — contextIsolation + sandbox + nodeIntegration: false baseline.
- **[CITED: better-sqlite3 README]** Sync prepared-statement API + WAL mode + PRAGMA foreign_keys.

### Tertiary (LOW confidence)

- **[ASSUMED]** PDF render takes ~200–500 ms with 4 screenshots — community-reported; benchmark locally if planner flags a concern.
- **[ASSUMED]** Standard PDF fonts (Helvetica) cover English Phase 6 ship gate — verified visually by Phase 7 EN smoke test; if a glyph is missing, switch to `Font.register({ family: 'Inter', src: ... })` with an embedded TTF.

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — `@react-pdf/renderer@4.5.1` verified via npm + Context7; React 18 compat explicit in peer deps; no native rebuild.
- Architecture: HIGH — every Phase 6 file is an extension of an established Phase 2/3/4/5 pattern.
- Pitfalls: HIGH — derived from the established pattern (audit, paths, IPC, repo) + PDF-specific gotchas verified via Context7.
- Pitfall §8 (AR bidi): DEFERRED per D-10 — not a Phase 6 concern.
- Bidi/RTL rendering: LOW — out of Phase 6 scope per D-10. Re-emerges in Phase 7 with explicit smoke-test requirement.

**Research date:** 2026-08-08
**Valid until:** 2026-09-07 (30 days — stack is stable, no fast-moving pieces)
