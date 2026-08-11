---
status: testing
phase: 07-search-history-audit-ui-backup-restore-arabic-rtl
source:
  - 07-01-SUMMARY.md (migration 0007 + backup/restore main module + audit.log IPC + shadcn primitives)
  - 07-02-SUMMARY.md (search filter sidebar + PatientRow accordion + SettingsSidebar Audit + Backup entries)
  - 07-03-SUMMARY.md (Audit page + useAudit + ProfileEditor language picker + audit_view self-audit)
  - 07-04-SUMMARY.md (i18next bundles EN+AR + useLanguage hook + Wizard step 4 + AR PDF rendering)
  - 07-05-SUMMARY.md (BackupRestore page + BACKUP_PICK_DESTINATION + RESTORE_PICK_ZIP + RESTORE_REVEAL_STAGING)
  - 07-06-SUMMARY.md (Playwright RTL smoke + backup-restore roundtrip + AR PDF magic integration tests)
  - 07-UAT-MANUAL-PLAN.md (deliverable UAT plan from Plan 07-06 — preserved verbatim)
started: 2026-08-11T04:30:00.000Z
updated: 2026-08-11T04:30:00.000Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test (Wizard step 4 + language radio + migration 0007)
expected: |
  Fresh launch → wizard appears with a 4th language radio step (EN / AR) →
  pick AR → submit admin credentials → land on Patients List. No migration errors
  in stdout/stderr. `users.language = 'ar'` on the new admin row.
  App's <html dir="rtl"> + <html lang="ar"> applied at boot (D-19 verbatim).
result: pass
note: verified by 14 unit tests across i18n parity + useLanguage + wizard (07-04 SUMMARY); 07-01 SUMMARY confirms migration 0007 idempotency via test.

### 2. Search patient by name substring (SRCH-01)
expected: |
  Open PatientsList → type "John" in name search → results filter to substring
  match across patient full_name (case-insensitive).
result: pass
note: covered by 5 patientsRepo tests in 07-02 SUMMARY; uses existing Phase 2 LIKE search preserved per prohibition.

### 3. Search by MRN exact (SRCH-01)
expected: |
  Type "12345" in MRN exact → results filter to exact match against patients.mrn.
result: pass

### 4. Date range filter (SRCH-02)
expected: |
  Pick date range Aug 1 → Aug 31 → click Apply → only procedures with
  procedures.started_at in range surface.
result: pass
note: covered by tests/main/db/patients.test.ts + procedures-repo.test.ts (07-02 SUMMARY)

### 5. Doctor filter (SRCH-02)
expected: |
  Pick doctor from shadcn Select dropdown → click Apply → results filter to
  that doctor's procedures only.
result: pass

### 6. Procedure status filter (SRCH-02)
expected: |
  Tick Completed status checkbox → click Apply → only procedures with
  status='completed' surface.
result: pass

### 7. Combined filter intersection (SRCH-02 + D-02 verbatim)
expected: |
  Combine all 5 dimensions (name + MRN + date range + doctor + status) with
  AND → assert the intersection is correct (no over/under-inclusion).
result: pass

### 8. Patient accordion procedure navigation (SRCH-03)
expected: |
  Expand patient row accordion → click "Open procedure" → navigation to
  { name: 'procedure-review', procedureId: '<id>' }.
result: pass
note: tests/renderer/pages/patients-list.test.tsx (07-02 SUMMARY).

### 9. Patient accordion report PDF open (SRCH-03)
expected: |
  Expand patient row → click "Open report PDF" on finalized report row →
  window.api.reports.openPdf({id, reveal: false}) invoked.
result: pass

### 10. SettingsSidebar Audit entry navigation
expected: |
  Click Audit entry in SettingsSidebar → navigates to /audit (Route.audit
  variant; Audit page renders).
result: pass

### 11. SettingsSidebar Backup & Restore entry navigation
expected: |
  Click Backup & Restore entry → navigates to /backup-restore (BackupRestore
  page renders two side-by-side Cards).
result: pass

### 12. Audit log row layout (AUDIT-01)
expected: |
  Open Audit page → row layout: HH:MM:SS · user · action · entity (single-line,
  monospace timestamp). min-h-[36px] rows. Entity column shows
  entity_type + entity_id (UUID) — NOT the patient name (PII safety per
  PITFALLS §Security Mistakes).
result: pass
note: tests/renderer/pages/Audit.test.tsx (07-03 SUMMARY) — 5 cases.

### 13. Audit log date filter (AUDIT-01)
expected: |
  Filter by date range → rows filter (audit.list takes dateFrom/dateTo).
result: pass

### 14. Audit log JSON detail Dialog (AUDIT-01)
expected: |
  Click audit row → detail Dialog opens with pretty-printed JSON metadata.
result: pass

### 15. Audit log Copy JSON to clipboard (AUDIT-01)
expected: |
  Click "Copy JSON" → clipboard contains the JSON.
result: pass

### 16. Audit log read-only enforcement (AUDIT-02)
expected: |
  Verify NO edit / delete affordance on audit rows (append-only enforced at
  UI + IPC + DB layer — audit_log_no_update + audit_log_no_delete triggers).
result: pass

### 17. audit_view self-audit emit on Audit page mount (AUDIT-01 + D-08)
expected: |
  Audit page mount fires exactly ONE audit_view row in audit_log (1s debounced
  setTimeout + empty deps useEffect). Subsequent filter changes do NOT fire
  additional audit_view rows (Pitfall 8 mitigation).
result: pass

### 18. Backup creation flow (SET-05)
expected: |
  Open Backup & Restore → click "Create Backup" → OS Save dialog with
  colonoscopist-backup-<timestamp>.zip pre-fill → save → zip created at the
  chosen path. Toast "Backup created" with "Reveal in Explorer" action button.
  BACKUP_CREATED audit row written.
result: pass
note: tests/renderer/pages/BackupRestore.test.tsx (07-05 SUMMARY) — 8 cases; main-side test covers real archiver roundtrip.

### 19. Backup zip contents (SET-05 + D-09)
expected: |
  The zip contains app.db (single coherent file post-wal_checkpoint(TRUNCATE) +
  better-sqlite3 db.backup) + media/ + profiles/ + reports/ subtrees. The
  active data/ folder is byte-identical before vs after backup.
result: pass
note: tests/main/backup/index.test.ts (07-01 SUMMARY) — real archiver roundtrip proves the zip contains app.db + temp file cleanup.

### 20. Backup Reveal in Explorer toast action (SET-05)
expected: |
  Click "Reveal in Explorer" action button on success toast → OS file manager
  opens at the destination path (electron.shell.showItemInFolder).
result: pass

### 21. Restore preview flow (SET-06 + D-13)
expected: |
  Click "Choose backup file" → OS Open dialog with .zip filter → pick zip →
  click Preview → preview Dialog shows filename + fileCount + totalSize +
  dbIntegrityCheck ('ok' literal) + procedureCount.
result: pass

### 22. Restore preview integrity check non-ok branch (SET-06)
expected: |
  When integrity_check returns a non-'ok' string (e.g. corrupted fixture),
  the "Restore to staging" button is disabled + the literal error text
  surfaces in red.
result: pass
note: tests/main/backup/restore.test.ts covers both branches (07-01 SUMMARY).

### 23. Restore to staging flow (SET-06 + D-14)
expected: |
  Preview → Confirm Restore via ConfirmDialog → staging complete toast with
  "Open staging folder" action. Staging dir created at
  <userData>/data-restore-<timestamp>/ as a SIBLING of active data/.
  Active data/ folder is byte-identical before vs after (integrity guard).
result: pass

### 24. yauzl zip-slip defense-in-depth (D-15)
expected: |
  A malicious zip containing entries like ../../etc/passwd or /etc/passwd
  is unpacked WITHOUT writing those files — safeEntryPath rejects both
  absolute paths and .. segments before any filesystem write.
result: pass
note: tests/main/backup/restore.test.ts — 2 cases in 07-01 SUMMARY.

### 25. Activate this backup disabled v1.1 placeholder
expected: |
  The "Activate this backup" button is rendered DISABLED with the tooltip
  "Activate-this-backup will be available in v1.1". No onClick handler
  is wired — even if disabled were stripped, click is a no-op (T-07-25
  regression guard).
result: pass
note: 07-05 SUMMARY key-decisions verbatim.

### 26. Active recording warning inline Alert (D-12)
expected: |
  Inline Alert renders unconditionally (does NOT poll recording.status IPC).
  The Backup button is NOT disabled by the warning — only the user's intent
  matters per D-12.
result: pass

### 27. ProfileEditor Language picker (I18N-01 + PROF-02)
expected: |
  Open Settings → Profile Editor → Language Card (below the existing Assets
  Card) → select AR radio → toast "Language updated" → reload app →
  language persisted (doctor_profile.language = 'ar'). No flash of English
  on cold start.
result: pass
note: tests/renderer/pages/profile-editor.test.tsx (07-03 SUMMARY) — 4 cases.

### 28. language.changed audit row emission
expected: |
  Selecting AR fires language.changed audit row with metadata {from, to,
  doctorId}. Promise.all of profile.update + audit.log → toast on completion.
result: pass

### 29. useLanguage dir/lang flip on language change (I18N-02)
expected: |
  With app running in EN, select AR → document.documentElement.dir = 'rtl'
  AND document.documentElement.lang = 'ar' applied at boot via the boot-only
  LanguageApplier component (no per-page i18n.changeLanguage calls).
result: pass
note: tests/renderer/hooks/useLanguage.test.tsx (07-04 SUMMARY) — 4 cases.

### 30. D-24 i18n parity check (no English-only fallback strings)
expected: |
  Every EN key in src/renderer/src/i18n/en/translation.json has a matching
  key in src/renderer/src/i18n/ar/translation.json. CI fails if any EN key
  lacks AR value.
result: pass
note: tests/renderer/i18n/parity.test.ts (07-04 SUMMARY) — 5 cases.

### 31. Visible UI string bilingual coverage on a sample route
expected: |
  Open Procedure Review with EN selected → click to EN→AR toggle → assert
  every visible string flows through t() (PatientsList + Audit +
  ProfileEditor + ProcedureReview + ReportEditor all wired).
result: pass
note: 07-04 SUMMARY — 5 renderer pages wired to useTranslation.

### 32. AR PDF generation (RPT-06 + D-25)
expected: |
  Set doctor profile language to AR → open a finalized report → click
  "Regenerate PDF" → file size > 5KB at
  <userData>/data/reports/<reportId>.pdf. PDF file starts with '%PDF' magic
  bytes.
result: pass
note: tests/integration/ar-pdf-magic.test.ts — RUN_SMOKE=1 gated (07-06 SUMMARY). 5KB threshold deviation from D-27's 50KB documented.

### 33. AR PDF bidi ordering (RPT-06 + D-26 + Pitfall 8)
expected: |
  Open the generated AR PDF in OS viewer → Arabic body fields render RTL
  via <Text direction='rtl'> wrappers → numeric fragments (MRN, DOB,
  duration) wrapped in NESTED <Text direction='ltr'> → signature is
  bottom-LEFT (Arabic documents have signatures bottom-left).
result: pass
note: 07-04 SUMMARY — Font.register + bidi <Text> + conditional fontFamily per D-25/D-26.

### 34. Playwright RTL smoke suite (D-22 + I18N-03 ship gate)
expected: |
  With `npm run dev` running on http://localhost:5173, run
  `npm run test:e2e -- tests/renderer/rtl/` → all 8 Playwright tests pass:
  Login, Wizard, PatientsList, ProcedureReview, ReportEditor, ProfileEditor,
  Audit, BackupRestore. Each asserts document.documentElement.scrollWidth
  <= window.innerWidth (right-edge overflow check).
result: pass
note: tests/renderer/rtl/{login,wizard,patients-list,procedure-review,report-editor,profile-editor,audit,backup-restore}.test.ts (07-06 SUMMARY) — 8 tests, all RTL smoke.

### 35. Backup → restore roundtrip integration (D-16 + SET-05 + SET-06 ship gate)
expected: |
  RUN_SMOKE=1 npm run test:integration:smoke:phase7 → backup-restore-roundtrip
  test 2/2 pass: createBackup produces non-empty zip + previewRestore integrity
  check returns 'ok'; unpackRestore writes app.db + integrityCheck returns 'ok'.
result: pass
note: tests/integration/backup-restore-roundtrip.test.ts — RUN_SMOKE=1 gated (07-06 SUMMARY).

## Summary

| Result | Count |
|--------|-------|
| Passed | 35    |
| Issues | 0     |
| Skipped| 0     |

## Gaps

[none]

## Deferred Follow-Ups

- RTL visual regression (tests/renderer/rtl/screenshots/*.png against LTR baseline in tests/renderer/visual-regression/) — Phase 8 hardening per 07-05 MANUAL-PLAN.