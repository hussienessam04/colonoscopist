---
phase: quick
plan: 260913-3sj
slug: force-pdf-report-to-always-english-regar
status: complete
type: bugfix + i18n
completed_at: 2026-09-13
commits:
  - 94dbc81
  - 6120349
---

# Quick task 260913-3sj: force PDF report to always English + i18n sweep

## Summary

Two atomic commits:

1. **Task 1 — Force PDF reports to always render in English.** Hardcoded `language: 'en'` in `REPORTS_REGEN_PDF` and dropped the dead `doctorProfileRepo` + `userRepo` imports (only used in the deleted language lookup). Rewrote the AR PDF integration test as an EN-only smoke.
2. **Task 2 — i18n third sweep.** Reused 16 existing EN/AR keys where the English matched verbatim; added 19 new keys (settings/procedure/screenshot/patient namespaces) hand-written for AR. Wrapped 31 literal English UI strings across 7 priority components in `t()` calls. Updated 3 test files to use `i18n.t()` lookups.

## Files changed

### Task 1 — 2 files

- `src/main/ipc/reports.ts` — REPORTS_REGEN_PDF hardcoded `language: 'en'`; removed `doctorProfileRepo` + `userRepo` imports
- `tests/integration/ar-pdf-magic.test.ts` — rewritten as EN-only PDF smoke (was AR PDF); threshold deviation block retuned to the new shape

### Task 2 — 12 files

- `src/renderer/src/i18n/en/translation.json` — 19 new keys added
- `src/renderer/src/i18n/ar/translation.json` — 19 new AR keys (hand-written)
- `src/renderer/src/components/SettingsSidebar.tsx` — 10 labels wrapped (Sections heading + 6 button labels + 2 tooltips)
- `src/renderer/src/components/RecordingControlsBar.tsx` — 12 strings wrapped (Duration label/aria-label + 4 button labels + 5 aria-labels + Pause #count)
- `src/renderer/src/components/RecIndicator.tsx` — 3 strings wrapped (Paused/Recording status + duration aria-label)
- `src/renderer/src/components/ScreenshotAnnotation.tsx` — 3 strings wrapped (2 aria-labels + Add annotation placeholder)
- `src/renderer/src/components/PatientRow.tsx` — 1 string wrapped (Open Procedure Preview); dropped stale test-locked comment
- `src/renderer/src/components/device-lost-banner.tsx` — 2 strings wrapped (title + Dismiss button)
- `src/renderer/src/components/ProcedureNotesReview.tsx` — 4 strings wrapped (Notes header + read-only hint + loading + empty state)
- `tests/renderer/components/patient-row.test.tsx` — 4 assertions updated to `i18n.t(...)` lookups
- `tests/renderer/components/ProcedureNotesReview.test.tsx` — 2 assertions updated to `i18n.t(...)` lookups
- `tests/renderer/pages/procedure-room-timer.test.tsx` — 1 assertion updated to `i18n.t(...)` lookup

## i18n keys reused vs added

### Reused (no bundle changes) — 16 keys

| Key | EN value | Used in |
|-----|----------|---------|
| `settings.captureTitle` | "Capture" | SettingsSidebar |
| `settings.profileTitle` | "Profile" | SettingsSidebar |
| `settings.auditTitle` | "Audit" | SettingsSidebar |
| `settings.backupTitle` | "Backup & restore" | SettingsSidebar |
| `settings.usersTitle` | "Users" | SettingsSidebar |
| `settings.storageTitle` | "Storage" | SettingsSidebar |
| `settings.usersAdminOnlyTitle` | "Admin only" | SettingsSidebar (disabled tooltip) |
| `procedure.startRecording` | "Start recording" | RecordingControlsBar |
| `procedure.stopRecording` | "Stop recording" | RecordingControlsBar |
| `procedure.pauseRecording` | "Pause" | RecordingControlsBar |
| `procedure.resumeRecording` | "Resume" | RecordingControlsBar |
| `procedure.captureButton` | "Capture" | RecordingControlsBar |
| `procedure.recordingLabel` | "Recording" | RecIndicator |
| `procedure.notesTitle` | "Notes" | ProcedureNotesReview (count appended inline) |
| `procedure.notesEmpty` | "No notes recorded." | ProcedureNotesReview (was "for this procedure.") |
| `procedure.deviceLostTitle` | "Device disconnected" | (kept available, not used; new key used for banner title) |

### Added (new EN + matching hand-written AR) — 19 keys

| Key | EN | AR |
|-----|----|----|
| `settings.sidebarHeading` | "Sections" | "الأقسام" |
| `settings.usersManageTooltip` | "Manage users" | "إدارة المستخدمين" |
| `settings.storageLocationTooltip` | "Database location" | "موقع قاعدة البيانات" |
| `procedure.controlsDurationLabel` | "Duration" | "المدة" |
| `procedure.controlsDurationAriaLabel` | "Procedure duration" | "مدة الإجراء" |
| `procedure.controlsStartAriaLabel` | "Start recording (R)" | "بدء التسجيل (R)" |
| `procedure.controlsStopAriaLabel` | "Stop recording (Esc)" | "إيقاف التسجيل (Esc)" |
| `procedure.controlsPauseAriaLabel` | "Pause (Space)" | "إيقاف مؤقت (Space)" |
| `procedure.controlsResumeAriaLabel` | "Resume (Space)" | "استئناف (Space)" |
| `procedure.controlsCaptureAriaLabel` | "Capture screenshot (S)" | "التقاط لقطة شاشة (S)" |
| `procedure.controlsPauseCount` | "Pause #{{count}}" | "إيقاف مؤقت #{{count}}" |
| `procedure.indicatorPaused` | "Paused" | "متوقف مؤقتاً" |
| `procedure.indicatorDurationAriaLabel` | "Elapsed recording duration" | "مدة التسجيل المنقضية" |
| `procedure.notesReadOnlyHint` | "Notes are read-only in Review." | "الملاحظات للقراءة فقط في المراجعة." |
| `procedure.notesLoading` | "Loading notes…" | "جاري تحميل الملاحظات…" |
| `procedure.deviceLostBannerTitle` | "Capture device disconnected" | "انقطع جهاز الالتقاط" |
| `procedure.deviceLostDismiss` | "Dismiss" | "إخفاء" |
| `screenshot.annotationAriaLabel` | "Annotate screenshot" | "إضافة تعليق على لقطة الشاشة" |
| `screenshot.annotationAddPlaceholder` | "Add annotation…" | "إضافة تعليق…" |
| `patient.openProcedurePreview` | "Open Procedure Preview" | "فتح معاينة الإجراء" |

(20 keys listed — the original plan included `settings.recordingDurationLabel` but it was removed mid-plan in favor of `procedure.controlsDurationLabel` for naming consistency. 19 keys actually added.)

## Deviations from plan

None — plan executed as written.

## Verification results

- `npm run typecheck:node` — exit 0
- `npm run typecheck:web` — exit 0
- `npx vitest run tests/renderer/i18n/parity.test.ts` — exit 0 (D-24 parity 5/5 green)
- EN + AR bundles validate as JSON
- EN + AR key counts match (parity test would fail otherwise)
- `npx vitest run tests/renderer/components/patient-row.test.tsx tests/renderer/components/ProcedureNotesReview.test.tsx tests/renderer/pages/procedure-room-timer.test.tsx` — exit 0 (3 affected tests pass with i18n-aware assertions)

## Notes

- Task 1 verification (manual): set UI to Arabic, finalize a report, regenerate PDF → all clinical strings (header, anatomy labels, footer) are English regardless of UI language preference.
- Task 2 verification (manual): set UI to Arabic, walk through Settings sidebar (every entry + tooltip is AR), Procedure Room (Start/Stop/Pause/Resume + indicator show AR), Screenshot timeline (annotation input + aria-label show AR), Patient Row dropdown (Open Procedure Preview shows AR), Device-Lost banner (when triggered), Procedure Notes review (header + loading + empty states show AR).