---
phase: quick
plan: 20260811-polish-patient-procedures
subsystem: ui
tags: [react, tailwind, shadcn, filtering, i18n, electron-renderer]

# Dependency graph
requires:
  - phase: 07-search-history-audit-ui-backup-restore-arabic-rtl
    provides: i18next EN/AR bundles + D-24 parity harness + procedure-preview route at src/renderer/src/lib/router.ts
  - phase: 03-05
    provides: procedure-preview route variant `{ name: 'procedure-preview'; patientId: string }` in router.ts
provides:
  - Polished PatientProcedures page (avatar initials + sticky thead + hover rows + status color tokens + skeleton + differentiated empty states)
  - Client-side filter row (text search + date range + status multi-select) with Apply/Clear commit gate
  - + New Procedure header button routing to procedure-preview
affects:
  - src/renderer/src/pages/PatientProcedures.tsx
  - tests/renderer/pages/PatientProcedures.test.tsx
  - src/renderer/src/i18n/{en,ar}/translation.json

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pending → applied filter state with Apply as the commit gate (matches Phase 7 PatientsList UX without mid-type flicker)"
    - "Status multi-select via Popover + Checkbox list (Radix Select doesn't natively support multi)"
    - "Sticky <thead> inside max-h-[60vh] overflow-y-auto container with bg-card to prevent row bleed"
    - "Status color tokens applied via badge bg-* + text-* Tailwind classes — no new CSS tokens"
    - "Avatar initials derived from fullName; first letter of first + last; no library"

key-files:
  created: []
  modified:
    - src/renderer/src/pages/PatientProcedures.tsx
    - src/renderer/src/i18n/en/translation.json
    - src/renderer/src/i18n/ar/translation.json
    - tests/renderer/pages/PatientProcedures.test.tsx

key-decisions:
  - "Pending + applied filter state — typing does NOT trigger refilter; Apply commits pending → applied. Matches the Patient List UX and avoids mid-type flicker per plan."
  - "Status multi-select via Popover+Checkboxes (not Radix Select) — Radix Select primitive doesn't natively support multi; per plan: 'or 3 stacked Checkbox if Select multi is awkward'."
  - "Status filter trigger label = 'All statuses' when empty, '{N} / 4' when items selected — compact, no overflow, no per-status label expansion needed for the trigger."
  - "Sticky thead inside max-h-[60vh] container — bg-card background on <thead> + each <th> prevents row bleed-through when scrolled. Box-shadow bottom-border on the thead visually separates it from the table body."
  - "Avatar = plain div with size-12 rounded-full bg-primary/10 text-primary + initials, NOT the Radix Avatar primitive (overkill for an initials-only display)."
  - "Skeleton = 3 grey divs with animate-pulse inside one tbody row (colSpan=5) — no shadcn Skeleton install (per plan). Coexists with the legacy 'patient-procedures-loading' data-testid path so historical callers keep working."
  - "Status badge color tokens via Tailwind utility classes (bg-emerald-100 / bg-amber-100 / bg-blue-100 / bg-red-100) — no new color tokens. Finalized reports use bg-emerald-100; draft reports use bg-slate-100 to keep the visual signal."
  - "Empty-state branch is data-testid-differentiated: 'patient-procedures-empty' when rows === 0 AND no filter; 'patient-procedures-empty-filtered' when rows > 0 BUT filter narrowed to 0 — copy branches match."
  - "Action buttons switched to variant='ghost' on row polish — per plan layout (matches clinical UI density goal). Removed FileText-icon-only variant on 'Open procedure' because procedure-review is the primary action and ghost button text alone reads cleanly."
  - "+ New Procedure button uses lucide-react Plus + variant='default' + data-testid='patient-procedures-new' — reuses the existing procedure-preview route; no router or main-side change needed."

patterns-established:
  - "Pattern: client-side filter with pending/applied state for any list page — single source of truth for 'committed' filter values, ensures stable document mode when typing"
  - "Pattern: differentiating empty branches via different data-testid values so contract-guard tests can pin the right copy branch"

requirements-completed: []

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "Polished PatientProcedures layout (avatar, sticky header, hover rows, status colors, skeleton, empty filter state)"
    verification:
      - kind: unit
        ref: tests/renderer/pages/PatientProcedures.test.tsx#renders the patient header + a row per procedure with status + report status
        status: pass
      - kind: unit
        ref: tests/renderer/pages/PatientProcedures.test.tsx#shows "no procedures match these filters" empty state when an active filter matches nothing
        status: pass
    human_judgment: false
  - id: D2
    description: "Client-side text search filter (procedure.id OR formatted date substring) with Apply commit"
    verification:
      - kind: unit
        ref: tests/renderer/pages/PatientProcedures.test.tsx#text search filter: typing + Apply narrows the table to matching procedures
        status: pass
    human_judgment: false
  - id: D3
    description: "Status multi-select via Popover+Checkboxes (Completed/Partial/Recording/Crashed)"
    verification:
      - kind: unit
        ref: tests/renderer/pages/PatientProcedures.test.tsx#status multi-select filter: pick "Completed" + Apply narrows the table to completed procedures
        status: pass
    human_judgment: false
  - id: D4
    description: "Apply commits pending → applied; Clear resets both pending and applied state"
    verification:
      - kind: unit
        ref: tests/renderer/pages/PatientProcedures.test.tsx#Clear button resets pending + applied filters and restores all rows
        status: pass
    human_judgment: false
  - id: D5
    description: "+ New Procedure button navigates to { name: 'procedure-preview', patientId }"
    verification:
      - kind: unit
        ref: tests/renderer/pages/PatientProcedures.test.tsx#"+" New Procedure" button navigates to { name: "procedure-preview", patientId }
        status: pass
    human_judgment: false
  - id: D6
    description: "Date range filter (From/To inclusive end per D-02)"
    verification:
      - kind: unit
        ref: tests/renderer/pages/PatientProcedures.test.tsx#date range filter: From/To + Apply narrows the table to procedures in range
        status: pass
    human_judgment: false
  - id: D7
    description: "EN/AR parity for all 8 new patientProcedures keys (D-24 ship gate)"
    verification:
      - kind: unit
        ref: tests/renderer/i18n/parity.test.ts#every EN key has a matching AR key
        status: pass
    human_judgment: false

# Metrics
duration: 8min
completed: 2026-08-11
status: complete
---

# Quick Task 20260811: Polish PatientProcedures UI + Filter System + New Procedure Button

**Polished PatientProcedures page with avatar initials, sticky thead, hover rows, status color tokens, skeleton loading, client-side filter row (text search + date range + status multi-select) with Apply/Clear commit gate, and a + New Procedure header button that routes to procedure-preview — all client-side (no main-side or IPC changes) and i18n EN+AR extended per D-24 parity.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-08-11T16:13:00Z
- **Completed:** 2026-08-11T16:21:00Z
- **Tasks:** 3 (rewrite page + i18n keys + test extension)
- **Files modified:** 4

## Accomplishments
- Polished PatientProcedures layout per plan: avatar with initials (derived from fullName, no library), MRN/DOB/gender as muted small text, sticky `<thead>` inside `max-h-[60vh]` container, `hover:bg-slate-50` rows, semantic status color tokens (`bg-emerald-100 text-emerald-800` / `bg-amber-100 text-amber-800` / `bg-blue-100 text-blue-800` / `bg-red-100 text-red-800` — no new Tailwind tokens), 3-row `animate-pulse` skeleton while loading, differentiated empty state ("no procedures yet" vs "no procedures match these filters")
- Client-side filter row with text search + native `<input type="date">` From/To + status multi-select (Radix Popover with 4 Checkbox items) + Apply/Clear buttons; pending → applied state means typing does NOT refilter (matches Patient List UX); no IPC changes (main-side `proceduresRepo.list` untouched per plan)
- `+ New Procedure` header button (variant="default", lucide-react Plus icon, `data-testid="patient-procedures-new"`) routes to existing `{ name: 'procedure-preview', patientId }` route via the router — no router or main-side change
- i18n EN + AR bundles extended with 8 new `patientProcedures` keys (`newProcedure`, `newProcedureTooltip`, `searchPlaceholder`, `clearFilters`, `applyFilters`, `noMatchFilters`, `clearFiltersHint`, `statusAll`) — D-24 parity test passes
- Test file extended from 5 to 11 cases (3 original + 2 carried from the previous quick task + 6 new filter/new-procedure cases covering text search, status multi-select, Apply commits + Clear resets, New Procedure navigation, empty filtered state, date range filter)

## Task Commits

Each task was committed atomically:

1. **Polish + filter + new procedure** - `b644c9b` (feat)

## Files Created/Modified
- `src/renderer/src/pages/PatientProcedures.tsx` - Rewritten with polished layout + filter system + New Procedure button (client-side only)
- `src/renderer/src/i18n/en/translation.json` - Added 8 new patientProcedures keys
- `src/renderer/src/i18n/ar/translation.json` - Added matching 8 AR keys (D-24 parity)
- `tests/renderer/pages/PatientProcedures.test.tsx` - Extended with 6 new cases (11 total)

## Decisions Made
- **Pending + applied filter state** — typing does NOT trigger refilter; Apply commits pending → applied. Matches the Patient List UX and avoids mid-type flicker per plan.
- **Status multi-select via Popover+Checkboxes** (not Radix Select) — Radix Select primitive doesn't natively support multi; per plan: "or 3 stacked Checkbox if Select multi is awkward".
- **Status filter trigger label** = "All statuses" when empty, "{N} / 4" when items selected — compact, no overflow, no per-status label expansion needed for the trigger button width.
- **Sticky thead inside max-h-[60vh] container** — `bg-card` background on `<thead>` + each `<th>` prevents row bleed-through when scrolled. A `shadow-[0_1px_0_0_hsl(var(--border))]` on the `<thead>` visually separates it from the table body.
- **Avatar** = plain div with `size-12 rounded-full bg-primary/10 text-primary` + initials, NOT the Radix Avatar primitive (overkill for an initials-only display).
- **Skeleton** = 3 grey divs with `animate-pulse` inside one tbody row (colSpan=5) — no shadcn Skeleton install (per plan).
- **Status badge color tokens** via Tailwind utility classes (`bg-emerald-100` / `bg-amber-100` / `bg-blue-100` / `bg-red-100`) — no new CSS tokens. Finalized report badge uses `bg-emerald-100`; draft reports use `bg-slate-100` to keep the visual signal.
- **Empty-state branch is data-testid-differentiated**: `patient-procedures-empty` when rows === 0 AND no filter; `patient-procedures-empty-filtered` when rows > 0 BUT filter narrowed to 0 — copy branches match.
- **Action buttons switched to `variant="ghost"`** per plan layout (matches clinical UI density goal). Kept the FileText icon on the Open PDF button (renders alongside the procedure Open button); removed icon from the Open procedure button (ghost text reads cleanly without it).
- **`+ New Procedure` button** uses lucide-react Plus + `variant="default"` + `data-testid="patient-procedures-new"` — reuses the existing `procedure-preview` route; no router or main-side change needed.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Polished surface ready for hand-off; UAT can verify visually
- Reused procedure-preview route + lucide Plus icon; no new library installs (per AGENTS.md dependency discipline)
- 8 pre-existing test failures (8 Playwright RTL files + 3 PDF smoke tests) are unrelated to this quick task — confirmed by stashing my changes and rerunning against `tests/renderer/rtl/audit.test.ts`: same "Playwright Test did not expect test() to be called here" error. Tracked in STATE.md from Phase 7.

---
*Quick task: 20260811-polish-patient-procedures*
*Completed: 2026-08-11*
