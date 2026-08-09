---
status: testing
phase: 06-doctor-profile-report-editor-pdf-generation
source: [06-01-SUMMARY.md, 06-02-SUMMARY.md, 06-03-SUMMARY.md]
started: 2026-08-09T02:30:00.000Z
updated: 2026-08-09T02:30:00.000Z
---

## Current Test

number: 2
name: ProfileEditor renders bilingual fields + auto-save on blur
expected: |
  Navigate to Settings → Profile. The page renders 6 labeled inputs: Full name (EN/AR), Clinic name (EN/AR), Address, Phone. Edit any field → blur (Tab or click outside) → "Saving…" indicator appears for ~300ms → "Saved at HH:MM:SS" replaces it. Reopen the page → the value persisted.
awaiting: user response

## Tests

### 1. Cold Start Smoke Test (migration 0004 + wizardBootstrap creates doctor_profile row)
expected: |
  Fresh launch → wizard appears → submit admin credentials → land on Patients List. doctor_profile row created in same transaction as the user row. No migration errors in stdout/stderr. ProfileEditor shows the bilingual EN+AR fields (AR empty for fresh wizard — fill it later).
result: issue
reported: |
  App threw on load with `Error [ERR_REQUIRE_ESM]: require() of ES Module @react-pdf/renderer/lib/react-pdf.js from out/main/index.js not supported`. Root cause: `@react-pdf/renderer` v4 is ESM-only; electron-vite compiled main process to CJS so static `import { Document, pdf } from '@react-pdf/renderer'` became static `require()` at runtime, which Node 20 refuses.

  **Fix applied (commit 59130bd):**
  1. `render-report-pdf.ts` — removed static `import { Document, pdf } from '@react-pdf/renderer'`; replaced with `loadReactPdf()` cached promise that uses `await import('@react-pdf/renderer')`.
  2. `report.tsx` — removed all static `@react-pdf/renderer` imports (Document, Page, Text, View, Image, StyleSheet). Replaced JSX with `React.createElement` calls that take the primitives as a parameter. Now exports a pure factory function `createReportPdfElement(P, input)` that takes primitives at call time.
  3. `render-report-pdf.ts` calls `pdf(createReportPdfElement(reactPdf, input))` — primitives passed by reference after the dynamic import resolves.

  **Verification (post-fix):**
  - `npm run typecheck` exits 0
  - `npm run build` succeeds; `out/main/index.js` has zero `require("@react-pdf/renderer")` calls (only the dynamic `import()` at line 3682)
  - `npm run test:unit` → 579/579 tests pass across 76 files
  - `RUN_SMOKE=1 npm run test:integration:smoke:optin` → 4/4 PDF smoke tests pass (real PDFs render with `%PDF-` magic + size > 5KB + bilingual placeholder text + numeric fragment preservation)

  The app should now boot on a fresh launch. Please re-run Test 1 and confirm.
severity: blocker
status: fixed-via-59130bd

### 2. ProfileEditor renders bilingual fields + auto-save on blur
expected: |
  Navigate to Settings → Profile. The page renders 6 labeled inputs: Full name (EN/AR), Clinic name (EN/AR), Address, Phone. Edit any field → blur (Tab or click outside) → "Saving…" indicator appears for ~300ms → "Saved at HH:MM:SS" replaces it. Reopen the page → the value persisted.
result: pending

### 3. Signature upload accepts PNG + rejects non-image
expected: |
  Click "Upload signature image" → file picker opens (accept="image/png,image/jpeg"). Pick a PNG → "Signature uploaded at HH:MM:SS" appears. Pick a JPEG → same. Pick a .txt or .pdf → toast "Only PNG or JPEG images are accepted" + no IPC fired. Same flow for "Upload logo".
result: pending

### 4. ReportEditor opens draft + 4 textareas auto-save on blur
expected: |
  From ProcedureReview, click "Edit report" (button enabled when procedure.status is completed). Land on ReportEditor with empty Findings / Diagnosis / Recommendations / Procedure details textareas. Type text into any textarea → blur → "Saving…" → "Saved at HH:MM:SS". Reopen ReportEditor → text persisted. The status badge shows "Draft".
result: pending

### 5. Screenshot attach toggle + blue border + drag-reorder
expected: |
  In ReportEditor, the screenshot list shows all procedure screenshots with an "Attach" toggle button. Click Attach → thumbnail gets a blue border + "Attached" state. The Screenshot panel shows attached count. Drag attached thumbnails to reorder → sort_order persists across navigation.
result: pending

### 6. Finalize button locks state + shows "Finalized · last edited by <X>" badge
expected: |
  In ReportEditor with a draft, click "Finalize" → success toast → status badge flips to "Finalized · last edited by <admin name>". Findings/Diagnosis/Recommendations remain editable (per CONTEXT.md D-07 — wider post-finalize edits; no role gate per D-08). procedure_id / doctor_id / finalized_at are NOT editable.
result: pending

### 7. Re-render PDF button works after post-finalize edit
expected: |
  After finalize, edit a textarea → blur → the inline save indicator updates → click "Re-render PDF" → success toast → the PDF file at `<userData>/data/reports/<reportId>.pdf` updates (modify time changes; size changes if body content changed).
result: pending

### 8. Open PDF launches OS default viewer
expected: |
  Post-finalize, click "Open PDF" → the OS default PDF viewer opens with the file. The PDF shows: header with clinic logo top-left + clinic name, signature top-right + doctor name + procedure date; patient block (Name/MRN/DOB/Gender); procedure block (Date + Duration HH:MM:SS + Doctor); Findings / Diagnosis / Recommendations sections; attached screenshots each on their own page with "Fig. N" caption; footer with "Page X of Y" + clinic name. MRN: 12345 displays as 12345 (no bidi reversal — Phase 6 PDF is English-only per D-10).
result: pending

### 9. Reveal in Explorer highlights PDF in OS file manager
expected: |
  Post-finalize, click "Reveal in Explorer" → Windows Explorer opens with the PDF file selected/highlighted in `<userData>/data/reports/`. The OS default viewer does NOT launch (this is the "show in folder" affordance, not the "open" affordance).
result: pending

### 10. ProcedureReview "Generate report" / "Edit report" CTA navigates
expected: |
  On a completed procedure, the right-rail Report section shows a "Generate report" or "Edit report" button. Click it → navigates to ReportEditor for that procedure. The button is disabled (or hidden) while procedure.status === 'recording'.
result: pending

### 11. SettingsHub Profile card + sidebar entry navigate to ProfileEditor
expected: |
  Click header Settings → land on SettingsHub. See a "Doctor profile" card with a clinic-name preview. Click it → ProfileEditor. Also: the sidebar shows a "Profile" nav entry → click it → ProfileEditor. The active highlight moves to "Profile".
result: pending

### 12. AR columns on doctor_profile accept + persist Arabic text
expected: |
  In ProfileEditor, fill "Full name (AR)" with Arabic text (e.g., "د. ليلى") + "Clinic name (AR)" with Arabic text → blur → "Saved at HH:MM:SS". Reopen → AR fields persist. Note: PDF does NOT use these AR fields in Phase 6 (deferred to Phase 7) — only the EN fields land in the PDF header.
result: pending

## Summary

total: 12
passed: 0
issues: 1 (fixed via commit 59130bd — awaiting user re-confirmation)
pending: 11
skipped: 0

## Gaps

```yaml
- gap_id: G-06-1
  truth: |
    The Electron app boots successfully without runtime errors. Migration 0004 applies on first launch (idempotent), and the wizardBootstrap creates a doctor_profile row in the same transaction as the users row.
  status: failed
  reason: |
    User reported: App threw ERR_REQUIRE_ESM on load. @react-pdf/renderer v4 ships as ES Module only; the main process is compiled to CommonJS by electron-vite, so `require('@react-pdf/renderer')` at runtime fails. App does not start, blocking all downstream tests.
  severity: blocker
  test: 1
  artifacts:
    - src/main/pdf/render-report-pdf.ts (now: lazy dynamic-imports @react-pdf/renderer)
    - src/main/pdf/report.tsx (now: exports pure factory `createReportPdfElement(P, input)` with zero static @react-pdf/renderer imports)
    - out/main/index.js (now: zero `require("@react-pdf/renderer")` calls; only the dynamic `import()` at line 3682)
  missing: []
  fixed_in: 59130bd
  fixed_at: 2026-08-09
  fix_verification:
    - typecheck passes (0 errors)
    - 579/579 unit tests pass
    - 4/4 PDF smoke tests pass with RUN_SMOKE=1
    - build succeeds with no chunk splitting (single out/main/index.js, no @react-pdf/renderer static require)
```
```