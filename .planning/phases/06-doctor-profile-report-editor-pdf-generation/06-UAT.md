---
status: testing
phase: 06-doctor-profile-report-editor-pdf-generation
source: [06-01-SUMMARY.md, 06-02-SUMMARY.md, 06-03-SUMMARY.md]
started: 2026-08-09T02:30:00.000Z
updated: 2026-08-09T02:30:00.000Z
---

## Current Test

number: 4
name: ReportEditor opens draft + 4 textareas auto-save on blur
expected: |
  From ProcedureReview, click "Edit report" (button enabled when procedure.status is completed). Land on ReportEditor with empty Findings / Diagnosis / Recommendations / Procedure details textareas. Type text into any textarea → blur → "Saving…" → "Saved at HH:MM:SS". Reopen ReportEditor → text persisted. The status badge shows "Draft".
awaiting: user response

## Tests

### 1. Cold Start Smoke Test (migration 0004 + wizardBootstrap creates doctor_profile row)
expected: |
  Fresh launch → wizard appears → submit admin credentials → land on Patients List. doctor_profile row created in same transaction as the user row. No migration errors in stdout/stderr. ProfileEditor shows the bilingual EN+AR fields (AR empty for fresh wizard — fill it later).
result: pass

### 2. ProfileEditor renders bilingual fields + auto-save on blur
expected: |
  Navigate to Settings → Profile. The page renders 6 labeled inputs: Full name (EN/AR), Clinic name (EN/AR), Address, Phone. Edit any field → blur (Tab or click outside) → "Saving…" indicator appears for ~300ms → "Saved at HH:MM:SS" replaces it. Reopen the page → the value persisted.
result: pass

### 3. Signature upload accepts PNG + rejects non-image
expected: |
  Click "Upload signature image" → file picker opens (accept="image/png,image/jpeg"). Pick a PNG → "Signature uploaded at HH:MM:SS" appears. Pick a JPEG → same. Pick a .txt or .pdf → toast "Only PNG or JPEG images are accepted" + no IPC fired. Same flow for "Upload logo".
result: pass

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
passed: 3
issues: 0
pending: 9
skipped: 0

## Gaps

```yaml
- gap_id: G-06-1
  truth: |
    The Electron app boots successfully without runtime errors. Migration 0004 applies on first launch (idempotent), and the wizardBootstrap creates a doctor_profile row in the same transaction as the users row.
  status: resolved
  resolved_by: 59130bd
  resolved_at: 2026-08-09

- gap_id: G-06-2
  truth: |
    Signature + logo upload accepts PNG and JPEG files (writes them to `<userData>/data/profiles/<userId>/`) and rejects any other file type at the client-side sniff BEFORE crossing the IPC boundary.
  status: resolved
  resolved_by: 90390e1
  resolved_at: 2026-08-09
```
```