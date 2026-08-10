---
status: testing
phase: 06-doctor-profile-report-editor-pdf-generation
source: [06-01-SUMMARY.md, 06-02-SUMMARY.md, 06-03-SUMMARY.md]
started: 2026-08-09T02:30:00.000Z
updated: 2026-08-09T02:30:00.000Z
---

## Current Test

number: 10
name: ProcedureReview "Generate report" / "Edit report" CTA navigates
expected: |
  On a completed procedure, the right-rail Report section shows a "Generate report" or "Edit report" button. Click it → navigates to ReportEditor for that procedure. The button is disabled (or hidden) while procedure.status === 'recording'.
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
result: pass

### 5. Screenshot attach toggle + blue border + drag-reorder
expected: |
  In ReportEditor, the screenshot list shows all procedure screenshots with an "Attach" toggle button. Click Attach → thumbnail gets a blue border + "Attached" state. The Screenshot panel shows attached count. Drag attached thumbnails to reorder → sort_order persists across navigation.
result: pass

### 6. Finalize button locks state + shows "Finalized · last edited by <X>" badge
expected: |
  In ReportEditor with a draft, click "Finalize report (auto-generates PDF)" → success toast → status badge flips to "Finalized · last edited by <admin name>". Findings/Diagnosis remain editable (per CONTEXT.md D-07 — any signed-in doctor can edit after finalize). procedure_id / doctor_id / finalized_at are NOT editable. PDF file is automatically generated (per G-06-9).
result: pass

### 7. Re-render PDF button works after post-finalize edit
expected: |
  After finalize, edit a textarea → blur → the inline save indicator updates → click "Re-render PDF" → success toast → the PDF file at `<userData>/data/reports/<reportId>.pdf` updates (modify time changes; size changes if body content changed).
result: pass

### 8. Open PDF launches OS default viewer
expected: |
  Post-finalize, click "Open PDF" → the OS default PDF viewer opens with the file. The PDF shows: header with logo top-left + clinic name, signature top-right + doctor name + procedure date; patient block (Name/MRN/DOB/Gender); procedure block (Date + Duration HH:MM:SS + Doctor); Findings / Diagnosis sections; attached screenshots each on their own page with "Fig. N" caption; footer with "Page X of Y" + clinic name. MRN: 12345 displays as 12345 (no bidi reversal — Phase 6 PDF is English-only per D-10).
result: pass

### 9. Reveal in Explorer highlights PDF in OS file manager
expected: |
  Post-finalize, click "Reveal in Explorer" → Windows Explorer opens with the PDF file selected/highlighted in `<userData>/data/reports/`. The OS default viewer does NOT launch (this is the "show in folder" affordance, not the "open" affordance).
result: pass

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
passed: 9
issues: 0 (all gaps resolved; 3 tests pending)
pending: 3
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

- gap_id: G-06-3
  truth: |
    ProfileEditor renders the uploaded signature image and clinic logo as visible previews (not just a status text "Uploaded at HH:MM:SS"). Re-rendering after navigation shows the persisted image.
  status: resolved
  resolved_by: 8728ec5
  resolved_at: 2026-08-09
- gap_id: G-06-4
  truth: |
    The report PDF renders with: header (logo + clinic name top-left, signature + doctor name top-right), patient block, procedure block (date + duration + doctor), Findings / Diagnosis / Recommendations body sections, attached screenshots (small inline thumbnails, ~120×100px, embedded in body — not separate full-page screenshots), footer (clinic name + doctor signature image + page number).
  status: resolved
  resolved_by: 8728ec5
  resolved_at: 2026-08-09
- gap_id: G-06-5
  truth: |
    Dragging an attached screenshot thumbnail reorders the attached list. The new order persists across navigation (sort_order saved to DB).
  status: resolved
  resolved_by: 8728ec5
  resolved_at: 2026-08-09
- gap_id: G-06-6
  truth: |
    The ReportEditor's screenshot timeline does NOT show a "+Capture" button. Capture is a procedure-room feature (Plan 05's <ScreenshotTimeline onCapture> prop), not a report-editor feature. The report editor should show only the attach/reorder/delete affordances.
  status: resolved
  resolved_by: 8728ec5
  resolved_at: 2026-08-09
- gap_id: G-06-7
  truth: |
    The ReportEditor has a "Print" button (post-finalize) that calls `window.print()` on the renderer, opening the OS print dialog. The user can also "Save as PDF" via the OS print dialog. This is the desktop-browser standard for a "print to PDF" affordance.
  status: resolved
  resolved_by: 8728ec5
  resolved_at: 2026-08-09

- gap_id: G-06-8
  truth: |
    Clicking the ‹ / › buttons on an attached screenshot thumbnail swaps it with its left/right neighbour in the attached list. The new order persists across navigation (sort_order saved to DB).
  status: resolved
  resolved_by: 3fe7645
  resolved_at: 2026-08-09
- gap_id: G-06-9
  truth: |
    Clicking the "Finalize" button auto-triggers a PDF render. The doctor's workflow is: edit fields → click Finalize → PDF is ready immediately, no extra "Re-render PDF" click needed. The "Re-render PDF" button can still exist for post-finalize edits (already implemented) but is not the primary path.
  status: resolved
  resolved_by: 3fe7645
  resolved_at: 2026-08-09
- gap_id: G-06-10
  truth: |
    The ReportEditor UI does NOT render "Recommendations" and "procedure details" fields. The final PDF report contains only the doctor-relevant fields: Findings, Diagnosis, and (optionally) attached screenshots. Recommendations + procedure_details are not part of the v1 report.
  status: resolved
  resolved_by: 3fe7645
  resolved_at: 2026-08-09
- gap_id: G-06-11
  truth: |
    Clicking the "Print" button opens the generated PDF in the OS default PDF viewer. The viewer has a built-in print preview + dialog that lets the user print directly. The PDF shown in the viewer is exactly what the report looks like.
  status: resolved
  resolved_by: ad6ca0d
  resolved_at: 2026-08-09
  fix_notes: |
    Two attempts:
      1. (e13007d) new `getPdfBlob` IPC + blob: URL iframe + `contentWindow.print()` — fragile in Electron (iframe contentWindow null races, blob URL revoke timing, sandbox issues). User reported "PDF not ready — click Re-render PDF first" error toast.
      2. (ad6ca0d) switch to the simpler `api.reports.openPdf({ id, reveal: false })` IPC which invokes `shell.openPath()`. The OS default PDF viewer (Adobe Reader / Edge / Chrome's built-in) handles the rest, including a built-in print preview + dialog. The Print button label is now "Print (opens PDF)" to set the expectation. The PrintPreview iframe + getPdfBlob IPC remain in place — they're no longer wired to the Print button but the IPC + preload bridge stay available for any future preview-in-renderer use cases.
  severity: major
  test: 8
  artifacts:
    - src/renderer/src/pages/ReportEditor.tsx (handlePrint now calls openPdf IPC; Print button label updated to "Print (opens PDF)")
  missing: []
  manual_verification_steps:
    - Restart the app, navigate to a finalized report
    - Click "Print (opens PDF)" — the OS default PDF viewer opens with the report
    - Use the viewer's toolbar/file menu to invoke Print (Ctrl+P usually) — the OS print dialog shows the PDF as the print source with a live preview
- gap_id: G-06-12
  truth: |
    The ReportEditor UI matches the rendered PDF layout: header (logo + clinic name + signature + doctor name + procedure date), patient block, procedure block (date + duration + doctor), Findings / Diagnosis sections, attached screenshots thumbnail grid, footer (signature image + doctor name + clinic name + page number). The doctor sees a faithful preview of the PDF as they edit.
  status: resolved
  resolved_by: 3fe7645
  resolved_at: 2026-08-09

- gap_id: G-06-9
  truth: |
    Clicking the "Finalize" button auto-triggers a PDF render. The doctor's workflow is: edit fields → click Finalize → PDF is ready immediately, no extra "Re-render PDF" click needed. The "Re-render PDF" button can still exist for post-finalize edits (already implemented) but is not the primary path.
  status: failed
  reason: |
    User reported: "remove Recommendations and procedure details after finalize report generate the pdf automaticlly" — i.e. when the user clicks Finalize, the PDF should auto-generate without an extra button click.

    Current implementation: Finalize calls `api.reports.finalize({ id: report.id })` and refreshes the report row. The PDF render is a separate `api.reports.regenPdf({ id })` call. The doctor has to click "Re-render PDF" to actually produce the file.

    Fix: after `api.reports.finalize` resolves, automatically call `api.reports.regenPdf` (and refresh the report so the new pdfPath populates). Sequential — finalize first (so the report row has status='finalized' + finalized_at), then regenPdf (so the PDF is for a finalized report).
  severity: minor
  test: 6
  artifacts:
    - src/renderer/src/pages/ReportEditor.tsx (the `handleFinalize` callback; currently calls only finalize, not regenPdf)
  missing:
    - `handleFinalize` should `await api.reports.finalize(...)` then `await api.reports.regenPdf(...)` then `useReport.refresh()` so the buttons (Open PDF, Reveal, Print) immediately show the generated PDF
    - consider a single IPC `api.reports.finalizeAndRenderPdf({ id })` that does both atomically in main (one transaction-style wrapper) so the renderer doesn't need to coordinate two round-trips; cleaner contract

- gap_id: G-06-10
  truth: |
    The ReportEditor UI does NOT render "Recommendations" and "procedure details" fields. The final PDF report contains only the doctor-relevant fields: Findings, Diagnosis, and (optionally) attached screenshots. Recommendations + procedure_details are not part of the v1 report.
  status: failed
  reason: |
    User reported: "remove Recommendations and procedure details after finalize" — interpreted as "remove these two fields from the editor + PDF". Recommendations is a clinical recommendation that the doctor would write AFTER diagnosis, and procedure_details duplicates information already on the procedure row (procedure type, equipment used, etc.). The user wants the editor + PDF to be lean — only Findings + Diagnosis as the body, plus attached screenshots.

    Current implementation: ReportEditor has 4 textareas (findings, diagnosis, recommendations, procedureDetails); all 4 are written to the `reports` row. The PDF renders all 4 as body sections.

    Fix: drop the recommendations + procedureDetails state from the editor UI; keep the columns in the `reports` table for backward compat + future re-introduction but stop persisting new values; remove the two textareas from the editor; remove the two body sections from the PDF template.
  severity: minor
  test: 4 (deferred — edit flow)
  artifacts:
    - src/renderer/src/pages/ReportEditor.tsx (4 textareas)
    - src/main/pdf/report.tsx (Recommendations + procedureDetails sections)
  missing:
    - remove the recommendations + procedureDetails textareas from the editor
    - remove the Recommendations + procedureDetails body sections from the PDF template
    - update the IPC contract + validators to mark these fields as optional/deprecated (or drop them entirely)
    - the DB columns stay for now (no migration needed — they're nullable TEXT); just stop surfacing them in the editor/PDF

- gap_id: G-06-11
  truth: |
    Clicking the "Print" button shows a print preview of the actual generated PDF report. The user sees the PDF rendered inline (so they can verify it looks right) and then confirms the print via the OS print dialog.
  status: failed
  reason: |
    User reported: "in print there is no preview" — the current `window.print()` calls the OS print dialog immediately with the on-screen DOM as the print target. There's no PDF preview because the OS dialog is too far from the user's mental model ("print the report I just generated").

    Current implementation: `handlePrint` calls `window.print()`. The OS print dialog shows whatever DOM is currently on screen (the ReportEditor with textareas, the Print button, etc.) — not the actual generated PDF.

    Fix options:
      A. Open the generated PDF in a hidden `<iframe>` via the MediaServer's `/media/<reportId>/<file>.pdf` route (or a new `/reports/<reportId>.pdf` route), then call `iframe.contentWindow.print()`. The OS print dialog shows the actual PDF.
      B. Use Electron's `webContents.print({ silent: false })` with the PDF as the print target. The OS print dialog has the PDF as the source.
      C. Simplest: open the PDF in the OS viewer (via `api.reports.openPdf`); the user prints from there. Already exists as the "Open PDF" button.
  severity: minor
  test: 8 (after PDF renders)
  artifacts:
    - src/renderer/src/pages/ReportEditor.tsx (the `handlePrint` callback)
  missing:
    - implement option A: an `<iframe>` mounted in the report editor (hidden) that loads the generated PDF via a `blob:` URL, then call `iframe.contentWindow.print()` on Print click. The OS print dialog shows the PDF as the source.
    - or implement option B: shell.openPath opens the PDF; user prints from the OS viewer. Already implemented as "Open PDF" button. The Print button can redirect to Open PDF if no iframe is feasible.
    - or: simplest = "Print" → "Open PDF" + on-print confirm. Combine the two buttons into one.
    - recommendation: option A (iframe + blob URL + contentWindow.print()) is the cleanest "print the PDF" affordance — the user sees the PDF in the print dialog preview, not the on-screen DOM.

- gap_id: G-06-12
  truth: |
    The ReportEditor UI matches the rendered PDF layout: header (logo + clinic name + signature + doctor name + procedure date), patient block, procedure block (date + duration + doctor), Findings / Diagnosis sections, attached screenshots thumbnail grid, footer (signature image + doctor name + clinic name + page number). The doctor sees a faithful preview of the PDF as they edit.
  status: failed
  reason: |
    User reported: "make the pdf editor ui match the report" — the editor is a form with labels + textareas, not a clinical-report layout. The doctor has to imagine what the final PDF will look like. The user wants the editor to render the report in the same shape as the PDF (header + body sections + footer + screenshot grid) so the editing experience matches the artifact.

    Current implementation: ReportEditor renders labeled `<Textarea>`s in `<Card>`s, side-by-side with the ScreenshotTimeline. The PDF renders header + patient/procedure blocks + 3 body sections + screenshot thumbnails + footer. They look completely different.

    Fix: redesign the ReportEditor to render the report inline (header + patient/procedure blocks + Findings textarea + Diagnosis textarea + screenshot grid + footer). Each editable field is rendered as a contentEditable area or a positioned `<textarea>` over the rendered layout. The doctor sees the final shape as they type.
  severity: major
  test: 4 (deferred — edit flow)
  artifacts:
    - src/renderer/src/pages/ReportEditor.tsx (current form-based layout; needs to become a render-matches-PDF layout)
  missing:
    - rewrite the ReportEditor JSX to render the same visual shape as the PDF (header + patient/procedure blocks + Findings + Diagnosis + screenshots + footer)
    - editable textareas positioned over the rendered content, or inline contentEditable spans that commit on blur
    - or: a "Preview" tab/mode that shows the rendered PDF in a sandboxed iframe, and an "Edit" tab with the form. Toggle via tabs/button.
    - or: the simplest = a side-by-side editor + preview, where the preview is the rendered PDF via MediaServer `/media/<reportId>/<file>.pdf` loaded in an iframe. Edits on the left update the preview on the right.
```
```