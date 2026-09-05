---
phase: 08-licensing-ed25519-signed-lic-14-day-trial-activation-flow
plan: 10
subsystem: license
tags: [fix, renderer-handling, gated-ipc, gap-closure]
gap_closure: true
gap_ids: [G-08-4]
requires: [08-03]
provides: [safeInvoke-helper, EmptyStateCard-component, renderer-graceful-degrade]
status: complete
---

# Phase 8 Plan 10: safeInvoke + EmptyStateCard + 8 Consumer Wires — SUMMARY

Closes G-08-4 (Phase 8 UAT Test 3 blocker): gated IPC consumers
(PatientsList, PatientForm, PatientProcedures, ProcedurePreview,
ProcedureReview, ReportEditor, ProfileEditor + useProcedures hook) no
longer crash to a white screen when `main/license/gate.ts` returns
`{ok: false, code: 'IPC_LICENSE_*'}` — the renderer branches on the
discriminated union via a centralized `safeInvoke<T>` helper and renders
a shared `<EmptyStateCard>` placeholder while the `<LicenseGate>` modal
stays interactable on top.

## One-liner

Centralized `safeInvoke<T>(p)` + shared `<EmptyStateCard>` make the
discriminated-union check structurally required across all 8 gated-IPC
consumers — the bug cannot reoccur in call sites that wrap with the
helper.

## Files Touched (10)

Created:
- `src/renderer/src/lib/ipc-result.ts` — `safeInvoke<T>(p)` helper that returns `T | null` based on the discriminated union + defensive catch.
- `src/renderer/src/components/EmptyStateCard.tsx` — "License required — open Settings → License to activate" + "Open License settings" button that navigates to `{name: 'license'}`.
- `tests/renderer/lib/ipc-result.test.ts` — 5 helper unit tests (success / license_invalid / license_expired / throw / null).
- `tests/renderer/pages/procedure-preview.test.tsx` — regression test (no prior test file existed for this page).
- `tests/renderer/hooks/use-procedures.test.tsx` — regression tests for the hook's `gated` flag (no prior test file existed).

Modified (8 gated-IPC consumers + 6 page tests):
- `src/renderer/src/pages/PatientsList.tsx` — wrap `patients.list`; `gated` state + EmptyStateCard above the table.
- `src/renderer/src/pages/PatientForm.tsx` — wrap both `patients.get` calls; gated short-circuit (no navigation away).
- `src/renderer/src/pages/PatientProcedures.tsx` — wrap `patients.get` + `procedures.list`; EmptyStateCard above the patient header.
- `src/renderer/src/pages/ProcedurePreview.tsx` — wrap `procedures.create`; gated error within the existing side panel.
- `src/renderer/src/pages/ProcedureReview.tsx` — wrap `patients.get` + propagate `proceduresGated` from useProcedures; combined `gated = patientGated || proceduresGated` flag; EmptyStateCard inside the left rail.
- `src/renderer/src/pages/ReportEditor.tsx` — wrap `patients.get`, `procedures.get`, `profile.getAssetDataUrl`, `reports.getPdfBlob`; gated flag in the patient/procedure effects; EmptyStateCard inside the document article.
- `src/renderer/src/pages/ProfileEditor.tsx` — wrap `profile.getAssetDataUrl` (4 kinds); detect gate shape directly on the page (the `useDoctorProfile` hook is unchanged per plan files_modified list); EmptyStateCard inside SettingsLayout.
- `src/renderer/src/hooks/useProcedures.ts` — wrap the 4 parallel fetches via `safeInvoke`; expose new `gated: boolean` in the result shape.
- `tests/renderer/pages/patients-list.test.tsx`, `patient-form.test.tsx`, `PatientProcedures.test.tsx`, `ProcedureReview.test.tsx`, `report-editor.test.tsx`, `profile-editor.test.tsx` — added `— gated-IPC graceful degrade (08-10)` describe blocks with regression tests per consumer.

i18n:
- `src/renderer/src/i18n/en/translation.json` — added `license.emptyStateMessage` + `license.emptyStateOpenLicense`.
- `src/renderer/src/i18n/ar/translation.json` — same keys (AR mirror per Phase 7 D-20).

## Requirements Completed

- **LIC-04** — "Renderer-side graceful degrade when a gated IPC returns `{ok:false}`" — closed. Each of the 8 gated-IPC consumers branches on the discriminated union before destructuring the success shape.

## Gap Closed

- **G-08-4** — "PatientsList + 7 other gated-IPC consumers crash on missing destructure when the gate returns `{ok:false}`; modal dismisses + UI white-screens." Fixed by:
  1. Adding the centralized `safeInvoke<T>(p)` helper (commit 1).
  2. Wiring all 8 consumer files to wrap their gated IPC calls + render `<EmptyStateCard>` on null (commit 2).
  3. Adding 8 regression tests (one per consumer) + 5 helper unit tests (commit 3).

## Verification

| Command | Result |
|---------|--------|
| `npm run typecheck:web` | clean for all 10 files I modified (the 7 remaining `error TS` lines are PRE-EXISTING from untracked quick-task `20260812-redesign-report-procedure-type` — outside this plan's scope; gated behind `<files_modified>` of that quick task). |
| `node scripts/run-vitest.cjs --run` on the 9 affected test files | **76 / 76 tests pass** (5 helper + 8 regression + 63 existing). |

## Deviations from Plan

1. **Updated one existing test (`PatientProcedures.test.tsx` "patient not found → navigate away") to assert the new contract**: the original behavior was to navigate to `patients` on null, which is exactly the gap-clo'sure bug. The plan states "render `<EmptyStateCard>` instead of crashing" so the test now asserts `EmptyStateCard` renders + route does NOT change. Test description renamed to `renders <EmptyStateCard> (no navigation away) when patients.get returns null — Plan 08-10 G-08-4 graceful degrade`.

2. **`useDoctorProfile.ts` is NOT wrapped** (out of plan scope per `files_modified`). ProfileEditor detects the gate shape directly on the page (`'ok' in profile && profile.ok === false`) and renders `<EmptyStateCard>` inside `SettingsLayout`. Documented in code: "the useDoctorProfile hook does not branch on the discriminated union (a separate hook file); the page detects the gate shape directly".

3. **`EmptyStateCard` exports BOTH a named export and a default export**. The default export was added mid-implementation when 8 consumers needed `import EmptyStateCard from '@/components/EmptyStateCard'` — keeping the named export as a tree-shakable alternative.

4. **`ProcedurePreview` test polyfill**: happy-dom doesn't ship `navigator.mediaDevices`. The new `procedure-preview.test.tsx` adds a module-level polyfill stub (`{ enumerateDevices: () => [] }`) at import time so `useCaptureDeviceMap` doesn't crash on first render. This was not in the original plan but is necessary for the test to mount.

5. **No main-process changes** — `src/main/license/gate.ts` (Plan 03) and `src/shared/ipc-contract.ts` are unchanged, as required by the plan ("Do NOT change main-process gate contract").

## Plan Compliance

- `safeInvoke` matches the plan's Step 1 implementation verbatim (the discriminated-union check + defensive catch + null → null arm).
- `<EmptyStateCard>` matches the plan's Step 3 contract exactly (the message + open-license button + `data-testid="gated-empty-state"`/`data-testid="gated-empty-state-open-license"` testids).
- 13 new tests pass: 5 helper + 8 regression (one per gated-IPC consumer).

## Atomic Commits

1. `b8110c6` — `fix(08-10): add safeInvoke helper + EmptyStateCard component (closes G-08-4)` — 5 files (helper + EmptyStateCard + 2 i18n keys + helper test).
2. `381f226` — `fix(08-10): wire 8 gated-IPC consumers to use safeInvoke + EmptyStateCard` — 10 files (8 consumers + 1 EmptyStateCard fixup + 1 test update).
3. `dd5fff4` — `test(08-10): safeInvoke helper tests + regression tests per consumer (8 files)` — 8 test files.
4. (this commit) — `docs(08-10): complete Plan 10 - safeInvoke + EmptyStateCard + SUMMARY`.
