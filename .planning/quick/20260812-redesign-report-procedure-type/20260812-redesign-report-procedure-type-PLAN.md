---
task: >-
  Redesign the procedure report end-to-end: per-report procedure-type toggle
  (colon vs upper-GI) with procedure-type-specific text boxes
  (esophagus/stomach/pylorus/duodenum for upper-GI; colon/ileum for colon),
  always-on conclusion + recommendation boxes, global saved-text-templates
  library for each box, and a new PDF layout matching the supplied sample
  (header band from settings, instrument selector from used-devices,
  editable premedication defaulted from settings, patient name/age/date/MRN
  block, boxes column + screenshots column, signature + footer band).
  procedure_type is set on first report-edit and is IMMUTABLE thereafter
  ("can't be edited — once colon, always colon").
task_count: 8
mode: quick
type: execute
files_modified:
  - src/main/db/migrations/0010_report_procedure_type_and_templates.sql (NEW)
  - src/main/db/migrations.ts
  - src/main/db/reports-repo.ts
  - src/main/db/report-templates-repo.ts (NEW)
  - src/main/ipc/reports.ts
  - src/main/ipc/report-templates.ts (NEW)
  - src/main/pdf/render-report-pdf.ts
  - src/shared/ipc-contract.ts
  - src/shared/validators.ts
  - src/preload/index.ts
  - src/renderer/src/hooks/useReport.ts
  - src/renderer/src/hooks/useReportTemplates.ts (NEW)
  - src/renderer/src/pages/ReportEditor.tsx
  - src/renderer/src/i18n/en/translation.json
  - src/renderer/src/i18n/ar/translation.json
  - tests/main/db/reports-repo.test.ts
  - tests/main/db/report-templates-repo.test.ts (NEW)
  - tests/main/ipc/reports.test.ts
  - tests/renderer/pages/report-editor.test.tsx
autonomous: true
---

<objective>
Complete report redesign per the supplied sample (Upper GI Endoscopy Report
in AR/EN). Two user-facing capabilities that don't exist today, plus a layout
overhaul across the editor and the rendered PDF:

1. **Procedure type toggle on the report** — `procedure_type` column on
   `reports` (`'colon' | 'upper_gi'`). The doctor picks ONCE on first open
   and the choice is locked afterwards ("can't be edited — once colon, always
   colon"). The column is set at `getOrCreate` time. The renderer exposes a
   segmented control that is editable only when every box is empty;
   any non-empty box freezes it.

   Boxes shown by type:

   | type      | anatomy boxes                       | shared boxes              |
   | --------- | ----------------------------------- | ------------------------- |
   | `colon`   | `colon`, `ileum`                    | `conclusion`, `recommendation` |
   | `upper_gi`| `esophagus`, `stomach`, `pylorus`, `duodenum` | `conclusion`, `recommendation` |

2. **Global saved-text-templates library** — a single shared
   `report_text_templates` table (workstation-wide, no per-doctor scope)
   with rows `{ id, scope, label, body, created_at, updated_at }`.
   `scope` is one of the 8 box keys above. Each box renders a small
   "Templates" dropdown with two affordances: "Insert template" (picks
   one to paste into the textarea at the caret) and "Save current as
   template" (prompts for a label, writes a row keyed to that scope).
   Templates are visible/editable per scope on a dedicated "Saved
   templates" page accessible from Settings.

3. **Layout overhaul** (editor + PDF) — match the supplied sample:

   ```
   ┌──────────────────────────────────────────────────────────────┐
   │ HEADER BAND (uploaded header image from settings)           │
   ├──────────────────────────────────────────────────────────────┤
   │ Instrument: [dropdown from used-devices]                    │
   │ Premedication: [text input, default from settings, editable]│
   ├──────────────────────────────────────────────────────────────┤
   │ Procedure type: ( ) Colon   ( ) Upper GI     ← locked once used│
   │                                                              │
   │ Name: ___   Age: __   Date: ___   MRN: __                   │
   ├──────────────────────────────┬───────────────────────────────┤
   │ [anatomy boxes per type]     │  Attached screenshots         │
   │ [conclusion]                 │  (timeline, drag-reorder)     │
   │ [recommendation]             │                               │
   ├──────────────────────────────┴───────────────────────────────┤
   │ Signature: <uploaded signature image>                        │
   │ Dr <doctor full name>                                        │
   ├──────────────────────────────────────────────────────────────┤
   │ FOOTER BAND (uploaded footer image from settings)           │
   └──────────────────────────────────────────────────────────────┘
   ```

   The `findings` / `diagnosis` / `recommendations` / `procedure_details`
   columns on `reports` are dropped — the new 8 boxes replace them.
</objective>

<context>
@.planning/PROJECT.md
@AGENTS.md
@src/main/db/migrations/0004_doctor_profile_and_reports.sql
@src/main/db/migrations/0009_profile_header_footer_devices_premedication.sql
@src/main/db/migrations.ts
@src/main/db/reports-repo.ts
@src/main/db/doctor-profile-repo.ts
@src/main/db/used-devices-repo.ts
@src/main/ipc/reports.ts
@src/main/ipc/profile.ts
@src/main/pdf/render-report-pdf.ts
@src/shared/ipc-contract.ts
@src/shared/validators.ts
@src/preload/index.ts
@src/renderer/src/hooks/useReport.ts
@src/renderer/src/pages/ReportEditor.tsx
@src/renderer/src/pages/ProfileEditor.tsx
@src/renderer/src/i18n/en/translation.json
@src/renderer/src/i18n/ar/translation.json
@.planning/quick/260812-ns0-in-profile-under-assets-lets-add-header-/260812-ns0-PLAN.md
@.planning/quick/260812-ns0-in-profile-under-assets-lets-add-header-/260812-ns0-SUMMARY.md
</context>

<must_haves>
- New migration 0010 — drops 4 old `reports` columns (`findings`, `diagnosis`,
  `recommendations`, `procedure_details`); adds 8 new TEXT NOT NULL DEFAULT ''
  columns (`esophagus`, `stomach`, `pylorus`, `duodenum`, `colon`, `ileum`,
  `conclusion`, `recommendation`); adds `procedure_type` TEXT NOT NULL DEFAULT
  'colon' CHECK(procedure_type IN ('colon','upper_gi')); creates
  `report_text_templates` table (id, scope, label, body, created_at, updated_at;
  idx on scope).
- `reportsRepo` rewritten: ReportRow gains the 8 box columns + procedure_type;
  `updateDraft` / `updateFinalized` accept the new field set; a new
  `setProcedureType(id, type)` enforces the once-only invariant (UPDATE sets
  procedure_type only where the current value is 'colon' AND all 8 box
  columns are empty; else throws IPC_VALIDATION with a clear message).
- `reportTemplatesRepo` (NEW): `listByScope(scope)`, `add({ scope, label,
  body })`, `remove(id)`. Idempotent on (scope, label) collision — add
  throws IPC_VALIDATION with a useful message.
- `Report` IPC type replaces `findings`/`diagnosis`/`recommendations`/
  `procedureDetails` with the 8 box fields + `procedureType` + `instrument`
  (TEXT NULL) + `premedicationOverride` (TEXT NULL). `instrument` is a
  used_devices.id pointer; `premedicationOverride` overrides the profile
  default per report.
- 6 new IPC channels on the existing `reports` namespace: `setProcedureType`,
  `setInstrument`, `setPremedicationOverride`, plus a new namespace
  `reportTemplates: { listByScope, add, remove, listAll }`.
- Validators: replace `reportUpdateSchema` with the 8-box schema; new
  `reportProcedureTypeInput` (id + procedure_type); new
  `reportInstrumentInput` (id + instrument|null); new
  `reportPremedicationOverrideInput` (id + text|null); new
  `reportTemplateAddInput` (scope + label + body); new
  `reportTemplateIdInput` (id); new `reportTemplateScopeInput` (scope).
- `useReport` extended with `setProcedureType`, `setInstrument`,
  `setPremedicationOverride` mutations (SWR-style: optimistic update + IPC
  + rollback on throw).
- `useReportTemplates({ scope })` NEW — list / add / remove / listAll.
- `ReportEditor.tsx` rewritten top-to-bottom per the layout above. Procedure
  type segmented control editable only when all 8 boxes are empty. Each box
  has a "Templates" dropdown (Insert / Save current). Instrument dropdown
  fed by `useUsedDevices`. Premedication text input pre-filled from
  `useDoctorProfile().profile.premedication`. Signature + footer band from
  profile data URLs.
- `render-report-pdf.ts` rewritten to match the supplied sample layout —
  header band → instrument row → premedication row → patient block →
  boxes column + screenshots column → signature → footer band. Bilingual
  labels when the doctor's language is 'ar'.
- i18n parity: new keys in `en` + `ar` for every new label.
- All existing tests pass; new tests cover `reportTemplatesRepo` + the new
  IPC channels + the editor's procedure-type lock + the template dropdown
  Insert / Save flows.
</must_haves>

<decisions>
- **Where procedure_type lives**: column on `reports` (per-report), NOT on
  `procedures`. The recorder doesn't differentiate today; per-report lets
  us ship without touching the recording flow.
- **Immutability**: set once at first edit, locked after. Renderer-side
  rule (segmented control disabled when any box is non-empty). Repo-side
  guard in `setProcedureType` — UPDATE WHERE procedure_type='colon' AND
  every box column = ''. Empty check is the surrogate for "never set".
- **Old box columns**: drop in migration 0010. Findings→conclusion is the
  closest semantic match but the user said "change completely" — clean
  slate is what they asked for. (Existing finalized reports keep their
  on-disk PDF; the row's box columns go to ''.)
- **Saved templates**: GLOBAL (workstation-wide). One library, no
  per-doctor split. The user picked Global over Per-Doctor.
- **Instrument**: a `reports.instrument` TEXT column (used_devices.id UUID).
  NULL until the doctor picks from the dropdown. The settings UI already
  has used-devices CRUD (quick 260812-ns0).
- **Premedication**: settings → per-report override. `reports
  .premedication_override` TEXT NULL. When NULL, render the profile
  default; when non-NULL, render the override.
- **PDF rebuild**: full rewrite — the existing layout is too far from the
  supplied sample to patch. Keep the same React-PDF primitives.
</decisions>

<execution_waves>
**Wave 1 — Schema + repos (no UI yet, no tests yet)**
1. Migration 0010 + migrations.ts registration
2. reports-repo rewrite (ReportRow + setProcedureType + updateDraft +
   updateFinalized with 8 box columns + instrument + premedicationOverride)
3. report-templates-repo (NEW)
4. IPC contract type extension (Report shape, new namespaces)
5. Validators

**Wave 2 — IPC + preload**
6. reports.ts IPC handlers — add setProcedureType, setInstrument,
   setPremedicationOverride; rewrite updateDraft/updateFinalized for the
   new field set
7. report-templates.ts IPC handler (NEW)
8. preload/index.ts registration

**Wave 3 — Renderer hooks**
9. useReport — extend with mutations
10. useReportTemplates (NEW)

**Wave 4 — UI rewrite**
11. ReportEditor.tsx full rewrite per the layout above

**Wave 5 — PDF + i18n**
12. render-report-pdf.ts full rewrite
13. en + ar translation.json keys

**Wave 6 — Tests**
14. reports-repo.test.ts update (new columns + setProcedureType guard)
15. report-templates-repo.test.ts (NEW)
16. reports IPC tests (new handlers)
17. report-editor.test.tsx (procedure-type lock + templates dropdown)
18. Run typecheck + all unit tests
</execution_waves>

<verification>
- `npm run typecheck` exits 0
- `npm run test:unit` exits 0 with all existing tests passing + new
  tests passing
- Manual smoke: open a colon procedure report, type into a box, observe
  procedure-type toggle becomes locked; toggle to upper_gi on a fresh
  draft, observe the anatomy boxes switch
- Manual smoke: type into a box, "Save current as template" → "Insert
  template" in another box of the same scope pastes the saved text
- Manual smoke: render PDF, verify it matches the supplied sample layout
</verification>