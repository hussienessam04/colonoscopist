---
status: testing
phase: 06-doctor-profile-report-editor-pdf-generation
source: [06-01-SUMMARY.md, 06-02-SUMMARY.md, 06-03-SUMMARY.md]
started: 2026-08-09T02:30:00.000Z
updated: 2026-08-09T02:30:00.000Z
---

## Current Test

number: 5
name: Screenshot attach toggle + blue border + drag-reorder
expected: |
  In ReportEditor, the screenshot list shows all procedure screenshots with an "Attach" toggle button. Click Attach → thumbnail gets a blue border + "Attached" state. The Screenshot panel shows attached count. Drag attached thumbnails to reorder → sort_order persists across navigation.
awaiting: user response — BLOCKED on G-06-3/4/5/6/7 fixes per user direction

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
result: issue
reported: |
  Drag-reorder still does not work — the order stays the same. The pointer-event fix (commit 3bef4bc) made the wrapper correctly receive pointer events, but `elementFromPoint` + `closest('[data-screenshot-id]')` either returns null (cursor over the IMG or the button overlays), or the source-id is the same as target-id (no reorder fired), or the `lastDroppedFrom` guard prevents the second call from re-ordering.

  User requested pause of UAT to address the previously-recorded gaps + this reorder issue + capture-button removal + Print button — then resume.
severity: major
status: paused — block on G-06-3/4/5/6/7 fixes before resuming

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
passed: 4
issues: 5 (G-06-3 image preview, G-06-4 PDF layout, G-06-5 reorder, G-06-6 capture button, G-06-7 print button — all open for plan-phase round)
pending: 8
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
  status: failed
  reason: |
    User reported: After uploading signature/logo, only a text status ("Uploaded at HH:MM:SS") appears — the actual uploaded image is never rendered as a preview. The doctor has no visual confirmation that the right file was uploaded, and cannot quickly see what their signature looks like in the rendered PDF header.
  severity: minor
  test: 3
  artifacts:
    - src/renderer/src/pages/ProfileEditor.tsx (renders status text via `signatureAt` / `logoAt`; no `<img>` preview)
    - src/main/ipc/profile.ts (returns only `{ signaturePath, logoPath }` — no data URL or Buffer for renderer preview)
  missing:
    - ProfileEditor `<img src={profile.signaturePath}>` + `<img src={profile.logoPath}>` (resolved via MediaServer `/media/<userId>/<file>` route OR a new `api.profile.getAssetDataUrl({ kind })` IPC that returns a base64 data URL)
    - onUpload success refresh the profile so the preview is immediately visible
- gap_id: G-06-4
  truth: |
    The report PDF renders with: header (logo + clinic name top-left, signature + doctor name top-right), patient block, procedure block (date + duration + doctor), Findings / Diagnosis / Recommendations body sections, attached screenshots (small inline thumbnails, ~120×100px, embedded in body — not separate full-page screenshots), footer (clinic name + doctor signature image + page number).
  status: failed
  reason: |
    User reported: The current PDF renders as only one page with diagnoses and findings stacked, attached screenshots appear small (~120×100px) rather than as their own full-page figures, and the footer is text-only — needs the doctor's signature image instead of (or alongside) "Page X of Y".

    Current implementation: Plan 06-03 Task 2 renders one full <Page size="LETTER"> with header/body/footer + one extra <Page> per attached screenshot (each at 100% page width with "Fig. N" caption). The user wants screenshots to be SMALLER inline thumbnails in the body (not separate full-page figures), and wants the footer to include the doctor's signature image. Additionally the current report shows only one page even when no screenshots are attached — this matches the layout but the user calls it "only one page" because the visual single page doesn't reflect the requested multi-page flow.

    Reread of CONTEXT.md D-11: "Per attached screenshots: one screenshot per page with 'Fig. N' caption ordered by sort_order ASC". The plan was "one page per screenshot" but the user wants "small inline thumbnails in body" — that's a UX preference that supersedes the plan. The D-11 SPEC's "one page per screenshot" is one valid interpretation; the user's "inline thumbnails" is the other.
  severity: major
  test: 4 (deferred — only reachable after Test 8 PDF render)
  artifacts:
    - src/main/pdf/report.tsx (one full <Page> per screenshot; current layout)
    - src/main/pdf/embed-image.ts (image helpers; unchanged)
  missing:
    - Change the report template to render attached screenshots as inline thumbnails in a grid/strip BELOW the body sections (each ~120×100px, with a small caption "Fig. N") instead of as separate full-page figures
    - Add a signature image to the footer (left or right side) using `readImageBox(signatureBox.buffer, ...)` — the doctor's signature appears on every page
    - Footer layout: clinic name (left) + signature image (center, small) + page number (right) — or keep clinic name + signature + "Page X of Y"
    - Confirm screenshots grid does not overflow the page (limit to 3-4 per row to stay under the body)
    - Update tests/main/pdf/render-report-pdf.test.ts + tests/integration/pdf-smoke.test.ts to reflect the new layout
    - Re-run RUN_SMOKE=1 to validate the new PDF visually

- gap_id: G-06-5
  truth: |
    Dragging an attached screenshot thumbnail reorders the attached list. The new order persists across navigation (sort_order saved to DB).
  status: failed
  reason: |
    User reported: Reorder is not working — attached screenshots stay in the same order after attempting a drag. (First fix attempt 3bef4bc replaced HTML5 DnD with pointer events + setPointerCapture, but the reorder STILL doesn't fire. The pointer-event handler in the wrapper is competing with the ScreenshotThumbnail's own onClick/onPointerDown handlers, and the elementFromPoint lookup returns the IMG (which has `draggable={false}` from earlier) or one of the overlay buttons instead of the wrapper div, so the closest('[data-screenshot-id]') lookup either fails or returns the source itself.)
  severity: major
  test: 5
  artifacts:
    - src/renderer/src/components/ScreenshotTimeline.tsx (pointer-event reorder handler)
    - src/renderer/src/components/ScreenshotThumbnail.tsx (its own onClick handler + nested buttons that absorb pointer events)
  missing:
    - replace the pointer-event-based reorder with a simpler affordance that does not require nested-element coordination:
      * Option A: Move Up / Move Down buttons on each attached thumbnail (no drag needed; works around the nested-event problem entirely)
      * Option B: Use a "reorder mode" where clicking a thumbnail moves it to the head of the attached list (the report shows the new order immediately)
      * Option C: Drop the manual reorder feature entirely; rely on the natural `timestampInVideoMs ASC` sort (the doctor can re-capture screenshots in different order if needed). Simpler, removes a footgun.

- gap_id: G-06-6
  truth: |
    The ReportEditor's screenshot timeline does NOT show a "+Capture" button. Capture is a procedure-room feature (Plan 05's <ScreenshotTimeline onCapture> prop), not a report-editor feature. The report editor should show only the attach/reorder/delete affordances.
  status: failed
  reason: |
    User reported: The +Capture button is still present in the report editor's screenshot timeline. Capture is a procedure-room concern (the doctor records the procedure, then later opens the report to attach screenshots to it). Showing +Capture in the report editor is confusing — clicking it tries to capture from the current video position but the doctor is editing a finalized report, not in a recording session.
  severity: minor
  test: 5
  artifacts:
    - src/renderer/src/components/ScreenshotTimeline.tsx (renders the <Button onClick={onCapture}>+ Capture</Button> unconditionally at the end of the row)
    - src/renderer/src/pages/ReportEditor.tsx (passes onCapture to ScreenshotTimeline — should not)
  missing:
    - Either make `onCapture` prop optional in ScreenshotTimelineProps (default: button hidden) — or have ReportEditor NOT pass `onCapture` so the button is suppressed
    - the ScreenshotTimeline signature already has `onCapture: () => void` as required; change to `onCapture?: () => void` and render the button only when defined
    - add a test that verifies the +Capture button does NOT appear when `onCapture` is undefined

- gap_id: G-06-7
  truth: |
    The ReportEditor has a "Print" button (post-finalize) that calls `window.print()` on the renderer, opening the OS print dialog. The user can also "Save as PDF" via the OS print dialog. This is the desktop-browser standard for a "print to PDF" affordance.
  status: failed
  reason: |
    User reported: No print button in the PDF editor. The user wants a "Print" button alongside "Open PDF" + "Reveal in Explorer" so they can print the report directly without opening the PDF in an external viewer first. The standard desktop-app pattern is to call `window.print()` on the renderer, which opens the OS print dialog and lets the user pick the printer or "Save as PDF".
  severity: minor
  test: 8 (after PDF renders)
  artifacts:
    - src/renderer/src/pages/ReportEditor.tsx (Open PDF + Reveal in Explorer buttons exist; no Print button)
  missing:
    - add a "Print" button in the report editor header (post-finalize only) that calls `window.print()`
    - the renderer can render the PDF inline in a hidden `<iframe>` (object URL) so the OS print dialog has something to print — or just open the PDF in the OS viewer and let the user print from there
    - simpler: open the existing PDF via the `Open PDF` button (already does this) and document that the OS viewer provides the Print affordance
    - or: add a "Print" button that calls `window.print()` on the rendered ReportEditor DOM (no iframe needed; the browser prints whatever is on screen)
    - recommendation: simplest = add a "Print" button that calls `window.print()` and let the user pick "Save as PDF" from the OS dialog (Chromium print dialog has a "Save as PDF" destination)
```
```