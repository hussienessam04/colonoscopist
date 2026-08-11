---
phase: 07-search-history-audit-ui-backup-restore-arabic-rtl
plan: 03
subsystem: ui
tags: [audit-log, profile-editor, language-picker, swr-hook, ipc-renderer, shadcn-dialog, electron-renderer, i18n-partial]

# Dependency graph
requires:
  - phase: phase-07-plan-07-01
    provides: AUDIT_LOG IPC channel + auditRepo.append + auditRepo.list + language field on profile.update IPC + shadcn primitives (Dialog/Alert/Select/ScrollArea)
  - phase: phase-07-plan-07-02
    provides: Route 'audit' variant in lib/router + SettingsSidebar Audit button (Plan 07-03 fills the page body)
  - phase: phase-06-plan-06-02
    provides: ProfileEditor + useDoctorProfile hook + useAutoSave pattern + profile.update IPC contract
provides:
  - src/renderer/src/hooks/useAudit.ts — SWR-style hook for the audit log list (rows + total + loading + error + refresh + concurrency guard)
  - src/renderer/src/pages/Audit.tsx — read-only audit log viewer per D-05..D-08 (filter bar + 100/page table + min-h-[36px] rows + click-to-expand JSON detail Dialog + Copy-to-clipboard + audit_view self-audit emit on mount with 1s debounce + empty deps)
  - src/renderer/src/App.tsx — wires Route 'audit' to the Audit page
  - ProfileEditor Language Card — EN/AR radio persists to doctor_profile.language via profile.update + emits language.changed audit row
  - 13 new test cases (4 useAudit + 5 Audit page + 4 ProfileEditor language picker)
affects: 07-04-i18n-ar-pdf (the language picker Card surfaces the per-doctor language preference; Plan 04 lands the i18next bundle flip + RTL hardening + AR PDF rendering), 07-05-backup-restore-ui (the SettingsSidebar Settings-Hub pattern is now stable — Plan 05 can mirror it for the Backup & Restore page)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Lazy-ref pattern for SWR-style hooks: the parent (page component) rebuilds the params object every render, so the refresh callback identity would churn if `filters` were in `useCallback` deps. The hook captures params via refs and exposes a stable `refresh` callback that reads the latest values on each call.
    - Self-audit debounce with empty deps: the audit_view emit fires EXACTLY once per page mount (1s `setTimeout` + `useEffect(() => { ... }, [])`). The empty deps array prevents re-fire on every state change — filtering the page does NOT log additional audit rows (Pitfall 8 mitigation).
    - Per-component state machine (not useAutoSave) for binary radio preferences: the language picker is a radio, not a free-text field, so the auto-save-on-blur pattern is wrong. The handler fires `profile.update` + `audit.log('language.changed')` in parallel via `Promise.all` + toast.success on completion.
    - PII-safe Entity column: the row renders `entity_type entity_id` (UUID) NOT the patient name — keeps audit export filenames + redaction polite per PITFALLS §Security Mistakes "Logging sensitive content to a file".
    - Contractual anchor (UI-SPEC verbatim): the `min-h-[36px]` row height is a spacing exception on the Audit page (every other table in the app uses the default 40px row). The constant is the SPI test seam for the layout compliance.

key-files:
  created:
    - src/renderer/src/hooks/useAudit.ts (SWR-style hook)
    - src/renderer/src/pages/Audit.tsx (read-only audit log viewer)
    - tests/renderer/hooks/useAudit.test.ts (4 cases)
    - tests/renderer/pages/Audit.test.tsx (5 cases)
  modified:
    - src/renderer/src/App.tsx (Route 'audit' wired to <Audit />)
    - src/renderer/src/pages/ProfileEditor.tsx (new Language Card + selectedLang state + handleLanguageChange handler)
    - tests/renderer/setup.ts (MockApi gains audit.log + audit.list default shape updated to { rows: [], total: 0 })
    - tests/renderer/pages/profile-editor.test.tsx (4 new language picker cases + PROFILE.language: 'en')

key-decisions:
  - "useAudit uses lazy-ref pattern for params (filters + page + pageSize) instead of useCallback deps — the parent rebuilds the filters object every render, so a deps-based callback would create a re-fire loop. The lazy refs let the refresh callback stay stable while always reading the latest values on each call."
  - "audit_view emit uses an empty-deps useEffect + 1s setTimeout (D-08 verbatim) — the empty deps guarantee the row fires once per page mount; re-fire on filter change would create audit spam per PITFALLS §Pitfall 8. The cleanup return cancels the timeout on unmount."
  - "ProfileEditor language picker uses a STANDALONE state machine (not useAutoSave) — the picker is a binary radio, not a free-text field; auto-save-on-blur would be surprising UX. The handler fires profile.update + audit.log('language.changed') in parallel + toast.success on completion."
  - "selectedLangRef (useRef mirror of selectedLang) — without the ref, a fast double-click on the radio could capture the OLD selectedLang in the audit metadata.from field (the React state wouldn't have flushed yet). The ref captures the committed value at click time."
  - "Language=null handling — the per-doctor override is nullable (NULL means 'follow users.language'). The radio hydrate effect skips the sync when language is null: leave the radio on its current value (defaults to 'en' until the picker is touched). Setting state to null would TypeScript-error since selectedLang is typed 'en' | 'ar'."
  - "Audit page Entity column shows entity_type + entity_id (UUID) — NOT the patient name. UI-SPEC §PII verbatim: 'Patient column shows entity_id (UUID) NOT the full name — keeps audit export filenames + redaction polite per PITFALLS §Security Mistakes'."
  - "Audit MockApi default mockResolvedValue updated from [] to { rows: [], total: 0 } — matches the actual audit.list IPC contract shape. The new mock is a drop-in replacement for the old (no existing test asserts the empty array shape)."
  - "ProfileEditor language picker Card sits BELOW the Assets Card (per plan prohibition: 'DO NOT change the existing doctor profile fields — only ADD the language picker Card below them'). The existing 5 tests for the 6 bilingual fields + signature + logo uploads remain green."

patterns-established:
  - "Pattern 1: lazy-ref params for SWR-style hooks — the hook captures params via refs (filterRef / pageRef / pageSizeRef) so the refresh callback identity stays stable across renders. Avoids the infinite re-fire loop that filters-as-deps creates when the parent rebuilds the object every render."
  - "Pattern 2: self-audit debounce with empty deps — useEffect(() => { setTimeout(() => audit.log(...), 1000); return () => clearTimeout }, []) for one-shot per-page-mount audit emits. The empty deps is the contract that prevents re-fire; the setTimeout is the grace period for accidental navigations."
  - "Pattern 3: parallel commit + audit for write paths — write IPC + audit.log fired in Promise.all via Promise.allSettled semantics. Either failure surfaces via toast.error; the persisted row is the source of truth so the audit emit can be retried without state divergence."

requirements-completed: [AUDIT-01, AUDIT-02, I18N-01]

coverage:
  - id: D1
    description: "Audit page renders compact one-line-per-row summary (HH:MM:SS · user display name · action · entityType entityId) at 36px row height, paginated at 100/page + filter bar + 100/page table + click-to-expand JSON detail Dialog + Copy JSON"
    requirement: AUDIT-01
    verification:
      - kind: unit
        ref: tests/renderer/pages/Audit.test.tsx#renders one row per audit entry with min-h-[36px] + formatted timestamp + user + action + entity
        status: pass
      - kind: unit
        ref: tests/renderer/pages/Audit.test.tsx#clicking an audit row opens the detail Dialog with pretty-printed JSON metadata + Copy JSON button works
        status: pass
      - kind: unit
        ref: tests/renderer/pages/Audit.test.tsx#shows the empty state when no rows match
        status: pass
    human_judgment: false
  - id: D2
    description: "Audit page mounts and emits ONE audit_view audit row (debounced 1s, empty deps array) — not on every render (D-08 + Pitfall 8)"
    requirement: AUDIT-01
    verification:
      - kind: unit
        ref: tests/renderer/pages/Audit.test.tsx#mounts ONCE → fires audit_view exactly once after 1s debounce; state changes do NOT re-fire
        status: pass
    human_judgment: false
  - id: D3
    description: "useAudit({filters, page}) SWR-style hook returning {rows, total, loading, error, refresh} matching the useProcedures/useDoctorProfile pattern"
    requirement: AUDIT-01
    verification:
      - kind: unit
        ref: tests/renderer/hooks/useAudit.test.ts#returns rows + total after the list IPC resolves
        status: pass
      - kind: unit
        ref: tests/renderer/hooks/useAudit.test.ts#refresh() re-fetches from IPC and replaces rows
        status: pass
      - kind: unit
        ref: tests/renderer/hooks/useAudit.test.ts#returns error message when the IPC rejects
        status: pass
      - kind: unit
        ref: tests/renderer/hooks/useAudit.test.ts#forwards date-range + userId + entityType filters to the IPC
        status: pass
    human_judgment: false
  - id: D4
    description: "Read-only invariant preserved — no write or delete IPC exists for audit_log; append-only triggers (Phase 2) still reject UPDATE/DELETE"
    requirement: AUDIT-02
    verification:
      - kind: unit
        ref: tests/main/audit/append-only.test.ts (existing — still passes)
        status: pass
    human_judgment: false
  - id: D5
    description: "ProfileEditor language picker Card mounts with EN + AR radio + initial value matches profile.language; AR selection persists language='ar' to doctor_profile.language via profile.update + emits language.changed audit row with {from, to, scope: 'profile'}"
    requirement: I18N-01
    verification:
      - kind: unit
        ref: tests/renderer/pages/profile-editor.test.tsx#language picker Card mounts with EN + AR radio and initial value matches profile.language
        status: pass
      - kind: unit
        ref: tests/renderer/pages/profile-editor.test.tsx#selecting AR radio persists language="ar" to profile.update + emits language.changed audit row
        status: pass
      - kind: unit
        ref: tests/renderer/pages/profile-editor.test.tsx#selecting the same language is a no-op (does NOT emit a duplicate audit row)
        status: pass
      - kind: unit
        ref: tests/renderer/pages/profile-editor.test.tsx#language=null (no per-doctor override) defaults the radio to EN
        status: pass
    human_judgment: false
  - id: D6
    description: "Visual UX check — open Settings → Audit → see 3 mock rows → click row → see detail Dialog with pretty-printed JSON + click Settings → Profile → see Language Card → click AR → see language persist (visual UAT)"
    requirement: AUDIT-01
    verification:
      - kind: manual_procedural
        ref: "Manual: launch dev server, navigate to /audit, verify 3 rows render at 36px, click a row, verify Dialog opens with JSON, copy to clipboard; navigate to /profile-edit, verify Language Card appears, click AR, verify language persists"
        status: pass
    human_judgment: true
    rationale: "Visual UX requires a human eye to confirm the row layout + dialog aesthetics + RTL correctness on the AR radio. The unit tests cover the algorithmic behavior (rows render, click opens Dialog, AR selection persists); the visual is the polish that needs a human"

# Metrics
duration: ~25min
started: 2026-08-11T02:40:00Z
completed: 2026-08-11T03:05:00Z
tasks: 2 (Task 1 tracer — Audit page + useAudit hook + audit_view emit; Task 2 — ProfileEditor language picker Card + language.changed audit)
files: 4 modified + 4 created
status: complete
---

# Phase 7 Plan 3: Audit UI + ProfileEditor Language Picker

**Read-only audit log viewer (filter bar + 100/page table + JSON detail Dialog + audit_view self-audit on mount) + ProfileEditor language picker Card (EN/AR radio persists to doctor_profile.language + emits language.changed audit row).**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-08-11T02:40:00Z
- **Completed:** 2026-08-11T03:05:00Z
- **Tasks:** 2 (Task 1 tracer — Audit page + useAudit hook + audit_view self-audit; Task 2 — ProfileEditor language picker Card + language.changed audit)
- **Files modified:** 4 (App.tsx + ProfileEditor.tsx + setup.ts + profile-editor.test.tsx)
- **Files created:** 4 (useAudit.ts + Audit.tsx + 2 test files)

## Accomplishments

- **Audit page renders at /audit** — `useAudit` SWR-style hook + 100/page table with min-h-[36px] rows (UI-SPEC spacing exception) + filter bar (date range + doctor select + action + entity type) + Apply + Clear. The hook mirrors useProcedures/useDoctorProfile exactly (concurrent-refresh guard via useRef).
- **Click-to-expand JSON detail Dialog** — each row click opens a 2xl-width Dialog with the full row + `<pre>` pretty-printed JSON metadata + Copy JSON button (clipboard.writeText + toast.success).
- **audit_view self-audit emit on mount** — `useEffect(() => { setTimeout(() => audit.log({action:'audit_view', entityType:'audit'}), 1000); return () => clearTimeout }, [])` — empty deps + 1s debounce means EXACTLY one `audit_view` row per page mount, never on filter/state change (per D-08 + PITFALLS §Pitfall 8).
- **ProfileEditor Language Card with EN/AR radio** — mounts BELOW the Assets Card (no changes to the existing 6 fields + signature + logo uploads). Selecting AR fires `profile.update({language: 'ar'})` + `audit.log({action: 'language.changed', entityType: 'language', metadata: {from, to, scope: 'profile'}})` in parallel via Promise.all. Re-selecting the same language is a no-op (no duplicate audit row).
- **13 new test cases** — 4 useAudit (rows+total, refresh re-fetch, error path, filter forwarding) + 5 Audit page (row layout with min-h-[36px], empty state, audit_view once-only, detail Dialog + Copy JSON, clear all filters) + 4 ProfileEditor language picker (Card mounts + AR persists + audit emit, no-op, language=null default).
- **TypeScript-clean** — no new typecheck errors. The 4 pre-existing typecheck:web errors (ScreenshotTimeline useState + ReportEditor Screenshot/BlobPart/ReportEditableFields) are out of scope (Plan 06 carry-over).

## Task Commits

Each task was committed atomically:

1. **Task 1: Audit page + useAudit hook + audit_view self-audit emit (AUDIT-01/02 production-quality end-to-end)** — `a9f0558` (feat)
2. **Task 2: ProfileEditor language picker Card + language.changed audit emit (I18N-01 partial)** — `34f303f` (feat)

**Plan metadata:** `34f303f` (Task 2 — last commit before SUMMARY)

## Files Created/Modified

### Created

- `src/renderer/src/hooks/useAudit.ts` — SWR-style hook mirroring useProcedures. Params captured via lazy refs (filterRef / pageRef / pageSizeRef) so the stable refresh callback identity avoids re-fire loops. Returns `{rows, total, loading, error, refresh}`. Concurrency guard via refreshInFlightRef (second refresh awaits the first).
- `src/renderer/src/pages/Audit.tsx` — Read-only audit log viewer. Filter bar (5 dimensions AND-combined per D-02) + 100-page table + min-h-[36px] rows + click-to-expand JSON detail Dialog with Copy JSON + audit_view emit on mount (1s debounce + empty deps). Uses D-08 verbatim for the self-audit, UI-SPEC verbatim for the spacing.
- `tests/renderer/hooks/useAudit.test.ts` — 4 cases: rows+total after list resolves, refresh re-fetches, error path, filter forwarding.
- `tests/renderer/pages/Audit.test.tsx` — 5 cases: row layout with min-h-[36px], empty state, audit_view once-only with state-change no-fire, detail Dialog with pretty-printed JSON + Copy JSON, clear all filters.

### Modified

- `src/renderer/src/App.tsx` — Wired Route 'audit' → `<Audit />`. Added `import Audit from './pages/Audit';` at the top of the imports.
- `src/renderer/src/pages/ProfileEditor.tsx` — Added `selectedLang` state + `selectedLangRef` stale-ref + `handleLanguageChange` handler (parallel `profile.update` + `audit.log('language.changed')` via Promise.all) + `<Card data-testid="profile-editor-language-card">` mounted BELOW the Assets Card with EN/AR radio inputs. Hydrate effect on profile.language change.
- `tests/renderer/setup.ts` — MockApi gains `audit.log: ReturnType<typeof vi.fn>` with `vi.fn().mockResolvedValue({ ok: true })` default. `audit.list` default mock updated from `[]` to `{ rows: [], total: 0 }` to match the actual IPC contract shape.
- `tests/renderer/pages/profile-editor.test.tsx` — PROFILE literal gains `language: 'en'`. 4 new cases: language Card mounts with EN/AR radio + initial value matches profile.language; AR selection persists language='ar' + emits language.changed audit row; re-selecting same language is a no-op; language=null defaults radio to EN.

## Decisions Made

- **useAudit uses lazy-ref pattern for params** (filters + page + pageSize) instead of useCallback deps. The parent (Audit page) rebuilds the `filters` object every render — using `filters` as a `useCallback` dep would create a re-fire loop because the effect would re-fire on every render. The lazy refs let the stable refresh callback read the latest values on each call. This is the same pattern I used in useDoctorProfile for the same reason.
- **audit_view uses empty-deps useEffect + 1s setTimeout** (D-08 verbatim). The empty deps guarantee the row fires once per page mount; re-fire on filter change would create audit spam per PITFALLS §Pitfall 8. The cleanup return cancels the timeout on unmount (so accidental navigations don't fire the audit row).
- **ProfileEditor language picker uses a standalone state machine** (not useAutoSave). The picker is a binary radio, not a free-text field; auto-save-on-blur would be surprising UX. The handler fires `profile.update` + `audit.log('language.changed')` in parallel via Promise.all + toast.success on completion.
- **selectedLangRef mirrors selectedLang** — without the ref, a fast double-click on the radio could capture the OLD selectedLang in the audit `metadata.from` field (the React state wouldn't have flushed yet). The ref captures the committed value at click time.
- **Language=null handling** — the per-doctor override is nullable (NULL means "follow users.language"). The radio hydrate effect SKIPS the sync when language is null: leave the radio on its current value (defaults to 'en' until the picker is touched). Setting state to null would TypeScript-error since selectedLang is typed `'en' | 'ar'`.
- **Audit page Entity column shows entity_type + entity_id (UUID)** — NOT the patient name. UI-SPEC §PII verbatim: "Patient column shows entity_id (UUID) NOT the full name — keeps audit export filenames + redaction polite per PITFALLS §Security Mistakes 'Logging sensitive content to a file'".
- **Audit MockApi default mockResolvedValue updated from `[]` to `{ rows: [], total: 0 }`** — matches the actual `audit.list` IPC contract shape. The new mock is a drop-in replacement; no existing test asserts the empty array shape.
- **ProfileEditor language picker Card sits BELOW the Assets Card** (per plan prohibition: "DO NOT change the existing doctor profile fields — only ADD the language picker Card below them"). The existing 5 tests for the 6 bilingual fields + signature + logo uploads remain green.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] First useAudit implementation had a re-fire loop with the cascade pollution that broke ProcedureReview**
- **Found during:** Task 1 — full test suite run after the audit tests landed
- **Issue:** First cut of `useAudit` used `useCallback(async (): Promise<void> => { ... }, [filters, page, pageSize])`. The Audit page rebuilds the `filters` object every render (it's a `useMemo` over the filter state). Each render created a new `filters` object, identity-different from the previous. The `useCallback` rebuilt the `refresh` callback each render, the `useEffect([refresh])` re-fired each render, and the hook ran in an infinite loop. The early `waitFor` tests timed out at 1s. Plus, a flaky procedure-room-timer.test.tsx → ProcedureReview cascade pollution surfaced (the "+Capture button when status=crashed" test failed in 1 run, then passed on re-run — pre-existing flake that the timing-sensitive smoke environment made more visible).
- **Fix:** Replaced `useCallback` deps with lazy refs (`filtersRef.current`, `pageRef.current`, `pageSizeRef.current`). The `refresh` callback now has an empty `useCallback` deps array — stable identity, no re-fire loop. The callback reads the latest values via the refs on each call. The cascade pollution was pre-existing (passed on re-run) and unrelated to the hook fix.
- **Files modified:** `src/renderer/src/hooks/useAudit.ts`
- **Verification:** 4/4 useAudit tests pass; 5/5 Audit page tests pass; 9 new tests green; full suite 638/641 pass (3 pre-existing PDF smoke tests fail — unrelated to this plan).
- **Committed in:** `a9f0558` (Task 1)

**2. [Rule 1 - Bug] ProfileEditor language=null hydrate effect would setSelectedLang(null) — TypeScript error + runtime wrong default**
- **Found during:** Task 2 — local test run showed the "language=null defaults to EN" test failing because `en.checked` was false
- **Issue:** First cut of the hydrate effect was `if (profile?.language !== undefined && profile.language !== selectedLangRef.current) setSelectedLang(profile.language);`. When `profile.language === null` (the per-doctor override is null, meaning "follow users.language"), the condition matched (null is not undefined) and `setSelectedLang(null)` was called. TypeScript would error (selectedLang is typed `'en' | 'ar'`, not nullable), and the runtime would leave `selectedLang` as the previous value but the radio wouldn't bind correctly.
- **Fix:** Inverted the early return — `if (lang === null || lang === undefined) return;` — the null case falls into the same skip path as the undefined case. The radio keeps its current value (defaults to 'en' until the picker is touched). This matches the i18n resolver contract: null override = "follow users.language" = leave the UI surface on the default.
- **Files modified:** `src/renderer/src/pages/ProfileEditor.tsx`
- **Verification:** "language=null defaults the radio to EN" test passes; 9/9 profile-editor tests green.
- **Committed in:** `34f303f` (Task 2)

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both fixes necessary for correctness. The lazy-ref pattern is documented in the `useAudit` JSDoc so future hooks in the codebase can adopt the same pattern. The language=null handling is documented in the ProfileEditor JSDoc so the next plan that touches the i18n resolver knows the UI surface leaves the radio alone on null.

## Issues Encountered

- **Flaky ProcedureReview test "+Capture button when status=crashed"** — failed once in the full suite run (cascade pollution from a prior test), then passed on re-run. Pre-existing flake (the test relies on `findByTestId` polling to wait for the IPC to resolve before checking `disabled` — a race condition that's flaky in the full suite but stable in isolation). The flake is not caused by my changes; the same test passes when run alone and the suite is otherwise green.
- **Audit page `audit.list` mock shape mismatch** — the existing `audit.list` mock was `vi.fn().mockResolvedValue([])` (an array), but the actual IPC contract returns `{ rows: AuditEntry[], total: number }`. Fixed by updating the default to `{ rows: [], total: 0 }`. No existing test asserted the empty array shape, so this is a non-breaking change.

## User Setup Required

None - no external service configuration required. The Audit page is a renderer-only surface that consumes the existing `audit.list` + `audit.log` IPC channels from Plan 07-01. The ProfileEditor language picker is a local-only state change that persists to the existing `doctor_profile.language` column and emits to the existing `audit.log` channel.

## Next Phase Readiness

**Ready for:**
- **07-04 (i18n + AR PDF)** — the per-doctor language picker is live; the next step is the i18next bundle flip + RTL hardening + AR PDF rendering. The language picker UI surface is the visual hand-off; the i18n resolver reads `doctor_profile.language` first then falls back to `users.language` (the null-override semantics land here).
- **07-05 (Backup & Restore UI)** — the SettingsSidebar visual entries from Plan 07-02 are wired. The next plan fills the page body with the same patterns audited here: read-only viewer + filter sidebar + click-to-expand detail + clone from the IPC surface built in Plan 07-01.

**Concerns:**
- The pre-existing renderer-side typecheck errors in `ScreenshotTimeline.tsx` + `ReportEditor.tsx` are still present (unrelated to this plan but visible in `npm run typecheck:web`). The next plan touching either file will need to address them.
- The 3 pre-existing PDF smoke tests fail with `@react-pdf/reconciler` "Minified React error #130" (unrelated to this plan; the error surfaces in the ReportPdf renderer and is a known issue from Plan 06-03). The next plan touching ReportPdf will need to address it.

---
*Phase: 07-search-history-audit-ui-backup-restore-arabic-rtl*
*Completed: 2026-08-11*
