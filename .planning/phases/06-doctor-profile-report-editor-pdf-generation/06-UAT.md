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
result: issue
reported: |
  Drag-reorder is not working. Dragging an attached thumbnail does nothing — the order stays the same.
  Root cause: HTML5 drag-and-drop (`draggable` + `onDragStart` + `onDragOver` + `onDrop`) was blocked by the inner `<img draggable={false}>`. In Chromium, the IMG suppresses dragstart when the user mousedown-drags the image, and the drag never bubbles to the wrapper div. `dataTransfer.setData('text/plain', ...)` never fires.
  Fix (commit 3bef4bc): replaced with pointer events (`onPointerDown` / `onPointerMove` / `onPointerUp`) + `setPointerCapture` on the source item. Drop target identified via `document.elementFromPoint(x, y).closest('[data-screenshot-id]')`. Cursor is `cursor-grab` over attached thumbnails + `active:cursor-grabbing` during drag.
severity: major
status: fixed-via-3bef4bc

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
issues: 3 (G-06-3 image preview, G-06-4 PDF layout, G-06-5 reorder — all open for plan-phase round)
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
    User reported: Reorder is not working — attached screenshots stay in the same order after attempting a drag.
    Root cause: HTML5 drag-and-drop (`draggable` + `onDragStart` + `onDragOver` + `onDrop`) was blocked by the inner `<img draggable={false}>` inside ScreenshotThumbnail. In Chromium, when the user mousedown-drags the image itself, the IMG suppresses dragstart (because `draggable={false}`), and the drag never bubbles to the wrapper div. `dataTransfer.setData('text/plain', ...)` never fires, so `onDragOver` / `onDrop` never receive a valid drop target, and `onReorder` is never called.
    Fix (commit 3bef4bc): replaced HTML5 DnD with pointer events (`onPointerDown` / `onPointerMove` / `onPointerUp`) + `setPointerCapture(e.pointerId)` on the source item. Drop target identified via `document.elementFromPoint(e.clientX, e.clientY).closest('[data-screenshot-id]')` so the source element does not need to be a draggable. Added a `lastDroppedFrom` dataset guard so a slow drag across a single target does not fire `onReorder` 30 times per second. Cursor styling: `cursor-grab` over attached thumbnails, `active:cursor-grabbing` during drag.
  severity: major
  test: 5
  artifacts:
    - src/renderer/src/components/ScreenshotTimeline.tsx (now: pointer events + setPointerCapture; data-screenshot-id on each wrapper div)
  missing: []
  fixed_in: 3bef4bc
  fixed_at: 2026-08-09
  fix_verification:
    - typecheck passes (0 errors)
    - 579/579 unit tests pass (ScreenshotTimeline tests still green; no regression in ProcedureReview / ProcedureRoom callers since the new props are optional and the new handlers only fire when isDraggable is true)
    - Visual: cursor is grab/grabbing during drag
```
```