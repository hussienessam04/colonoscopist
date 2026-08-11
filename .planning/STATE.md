---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: milestone
current_plan: 07-05
status: complete
stopped_at: Phase 07 Plan 5 complete
paused_at: —
last_updated: "2026-08-11T04:50:00.000Z"
last_activity: 2026-08-11
last_activity_desc: Phase 7 Plan 5 complete — BackupRestore page + picker IPC channels
progress:
  total_phases: 7
  completed_phases: 6
  total_plans: 40
  completed_plans: 39
---

**Current Plan:** 07-05
**Total Plans in Phase:** 6
**Last Activity:** 2026-08-11
**Last Activity Description:** Phase 7 Plan 5 complete — BackupRestore page + picker IPC channels
**Status:** Phase 7 in progress
**Paused At:** —

**Progress:** [█████████░] 83%

# State: Colonoscopist

**Project:** Colonoscopist
**Initialized:** 2026-07-31
**Mode:** yolo
**Granularity:** standard
**Workflow:** research, plan_check, verifier, nyquist_validation, auto_advance, code_review, ui_phase all enabled.
**Models:** inherit (subagents use the active session model — required for non-Anthropic Opencode runtimes).

## Current Focus

**Phase 6 Plan 06-02 (Renderer Surfaces): COMPLETE.** All 10 task commits land end-to-end: `lib/debounce.ts` closure primitive, `useAutoSave` hook (trigger-explicit debounced save state machine with optional override value to bypass closure-staleness race), `useDoctorProfile` + `useReport` + `useAttachedScreenshots` + `useProcedureScreenshots` SWR-style hooks, `ProfileEditor.tsx` (6 bilingual fields + signature/logo upload with client-side magic-byte PNG/JPEG sniff — defense in depth on top of the main-side sniff), `ReportEditor.tsx` (4 textareas + screenshot attach + Finalize + post-finalize "Finalized · last edited by <X>" badge + Open PDF + Re-render PDF buttons), `ScreenshotTimeline` extended with 3 optional props (attachedIds / onToggleAttach / onReorder with native HTML5 drag-and-drop), App.tsx wired `profile-edit` + `report-editor` route cases, SettingsSidebar gained the Profile nav entry + SettingsHub renders a clinic-name preview card, ProcedureReview gained the Generate/Edit report CTA + post-finalize PDF leaf. **559/559 tests pass across 72 files** (up from 543/68 — +16 tests + 4 new files). All 3 contract checks pass: ipc-contract / no-any / security-baseline. 4 deviations documented in 06-02-SUMMARY.md (useAutoSave cleanup-effect dep-array bug, useAutoSave trigger override value, optional-chain guards on window.api in new SWR hooks + ReportEditor, MockApi setup gains profile + reports namespaces). Plan 06-03 (full PDF clinical layout + finalize → regenPdf → Open PDF + Reveal in Explorer + EN smoke test) builds on this foundation. Phase 6 PDF renders English-only per D-10 (RPT-06 bidi/RTL deferred to Phase 7 i18n).

**Phase 6 Plan 06-01 (Tracer): COMPLETE** (archived). Migration 0004 + 3 repos + IPC contract extension + preload + Route union + 5 zod validators + 15 IPC handlers (every state-change audited) + 6 paths helpers + `@react-pdf/renderer ^4.5.1` + thin Node bridge + 23 Wave-0 repo tests. All 3 contract checks pass. 4 deviations documented. Foundation for Plan 06-02 + 06-03.

**Phase 5 — Screenshots + Procedure Review + Trim: COMPLETE.** All 4 plans + 7 gap-closure plans (05-05/06/07/08/09/10/11/12) executed; 520/520 tests pass across 65 files (no regressions from prior phases). 6/6 phase requirements (SCRN-01/02 + REV-01..04) shipped end-to-end:

- Mid-procedure screenshot capture via `S` hotkey + canvas snapshot from `<img>` MJPEG preview (SCRN-01)
- Screenshots persisted under `<userData>/data/media/patients/<p>/<proc>/screenshots/<ts>.jpg` + indexed in `screenshots` table with FK ON DELETE CASCADE; mid-procedure gallery in ProcedureRoom fed by useScreenshotIntake.screenshots (SCRN-02)
- Procedure Review screen with `<video>` + Scrubber (pointer events + setPointerCapture) + pause markers from `procedure_segments` (REV-01)
- Clickable screenshot timeline seeks `<video>` to thumbnail timestamp; per-thumbnail inline annotation; Toast-undo delete; 24×24 solid-red × discoverability baseline; ScreenshotLightbox modal at native 1280-px resolution via the existing `/media/` route; seek-on-click + expand-icon are independent affordances; timeline thumbnails now render the actual captured JPEGs at ~120×110px in BOTH ProcedureReview and ProcedureRoom (G-05-15 closed: shared `screenshotUrl` helper + `mediaBaseUrl`/`patientId` prop wiring + ScreenshotLightbox URL composition canonicalized; the "FRAME" placeholder is gone) (REV-02)
- Post-recording screenshot capture via `<video>` + canvas snapshot (`+Capture` button on ProcedureReview); `useProcedures` SWR-style hook + D-13 capture gate (REV-03)
- Non-destructive trim via ffmpeg `-ss before -i -c copy` (5-min SIGTERM timeout); restore re-points `<video>` to original; long-lived MediaServer on `127.0.0.1:<random>` with `/media/` route + HTTP Range request support + 9-case security audit (REV-04). The trim subprocess uses Node's default Windows command-line construction — the `windowsVerbatimArguments: true` flag that was incorrectly truncating userData paths at the first space (G-05-11) is removed; the spawn matches the recording + concat canonical pattern (recorder.ts:290 + recorder.ts:1045). 2 contract-guard tests lock the spawn options shape against regression. Trim UX now has frame-level visual feedback (G-05-12): Scrubber renders one blue dot per captured screenshot at its percent position + a tick scale (5s short, 10s long) below the track when trimMode is on; TrimControls renders in-frame + out-frame JPEG previews above the In/Out labels sourced via `captureScreenshot(videoRef)` at `inMs`/`outMs` via the `captureFrame` seam; 4 contract-guard tests lock the new visual surface.

`/gsd-verify-work 5` is the next manual step (Windows hardware smoke per `05-UAT.md`); code-ship + merge unblocked at 520/520 tests green. Pre-existing test cascade pollution from `procedure-room-timer.test.tsx` was fixed in 05-04 commit `165649e`. Plan 06 (Doctor Profile + Report Editor + PDF) follows Phase 5 verification — can reuse the new `screenshotUrl` helper from `@/lib/screenshot-url` for the PDF preview without composing a 4th copy of the URL shape.

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-07-31)

**Core value:** A gloved, busy doctor can hit Record on a procedure, capture findings as screenshots during the case, and walk out with a signed PDF report ready for the patient — with zero internet dependency between recordings.

## Phases

| # | Phase | Requirements | Status |
|---|-------|--------------|--------|
| 1 | Scaffold (electron-vite + security baseline + native rebuild) | 4 | complete |
| 2 | Database + Migrations + Patient CRUD + Audit + Auth | 10 | complete |
| 3 | Capture Device Enumeration + Live Preview + Quality Presets | 6 | complete (8/8 plans; UAT 29/29 pass) |
| 4 | Recording (ffmpeg child + timer + device-lost handling) | 6 | complete (4/4 plans; UAT 20/20 pass; +UI enhancements) |
| 5 | Screenshots + Procedure Review + Trim | 6 | complete (12/12 plans: 4 base + 8 gap-closure rounds 05-05..05-12; phase_status: complete pending Windows hardware smoke per 05-UAT.md) |
| 6 | Doctor Profile + Report Editor + PDF Generation | 9 | pending |
| 7 | Search & History + Audit UI + Backup/Restore + Arabic/RTL | 8 | pending |
| 8 | Licensing (Ed25519 signed .lic + 14-day trial + activation) | 4 | pending |

## Phase 3 sub-plans

| Plan | Title | Status |
|------|-------|--------|
| 03-01 | Main foundation: DirectShow enumeration + canonicalization + session-scoped IPC + preload + media permission + canonicalize test | complete |
| 03-02 | Renderer: useVideoPreview/useCaptureDeviceMap + Procedure Room + Settings Capture with reactive preview + no-device audit hook + previousRoute Finish | complete |
| 03-03 | Validation: moved test files + security-baseline + scope guards + integration suite + Windows hardware smoke UAT | complete |
| 03-04 | Gap closure: Settings → Capture entry from Patient List header (DropDownMenu, role-aware, G-03-1 + G-03-2) | complete |
| 03-05 | Gap closure: Settings hub page (replaces DropDownMenu, G-03-3) + PatientRow Open Procedure Room entry (G-03-4) | complete |
| 03-06 | Gap closure: presetHints() defensive guard for malformed custom preset (G-03-5) + shared SettingsSidebar mounted on all three Settings pages with active-tab highlight (G-03-6) | complete |
| 03-07 | Gap closure: drop getPreset() wrapper at main boundary to match declared `Promise<QualityPreset \| null>` contract (G-03-7) + saved custom-preset renderer hydration regression test | complete |
| 03-08 | Gap closure: make ProcedureRoom Stop/Finish cleanup tests deterministic under `npm run test:unit` (Electron-as-Node ABI) by awaiting getUserMedia `.then` (G-03-8) + integration contract pins hook release ordering | complete |

## Open Questions / Decisions to Make in Planning

- **Phase 4:** Confirm segmentation vs single-file write for the procedure mp4 (segmentation protects against >2h corruption; single file is simpler). Default: single file with `-movflags +faststart`, segmented if user pushback.
- **Phase 6:** Confirm `@react-pdf/renderer` RTL bidi handling in a smoke test during plan-phase; if insufficient, plan a small HTML→PDF fallback for the AR report path only.
- **Phase 8:** Decide re-activation policy for hardware changes (NIC swap). Default: vendor regenerates `.lic` on email request; N re-activations per year (deferred to LIC-06 in v2).

## Phase 3 decisions (locked at discuss-phase)

- **Q-A (auto-detect audit metadata):** First save writes `{ deviceName, preset, matched: 'sd-pattern-EasyCap' | ... }`; subsequent reads + manual saves write `{ deviceName, preset }` only. Absence of `matched` means not a first auto-detect save.
- **Q-B (Finish button route):** `useRoute()` tracks `previousRoute`; Finish navigates to `previousRoute ?? { name: 'patients' }`. Plan 03-02 wires this.
- **Q-C (Settings preview state persistence):** Settings → Capture preview state is component-local React state. Only explicit Save calls `capture.setDefaultDevice` / `capture.setPreset`. Plan 03-02 wires this.

## Plan 03-01 key decisions

- **Skipped `@types/ffmpeg-static`** — npm stub; ffmpeg-static v5 ships its own types.
- **`webPreferences.permissions` is not in Electron 32's `WebPreferences` type.** Resolved by adding the literal text via `as Electron.WebPreferences` cast (for the grep gate) AND wiring `session.setPermissionRequestHandler` (for actual camera access).
- **First-save audit metadata via `MatchedPattern`** — merged getPreset + auto-detect + audit into one call. First save emits `matched`; subsequent reads / manual saves do not.
- **`noDeviceAudit` requires a session** — gates against unauthenticated audit pollution.
- **`presetRepo` canonicalizes on write AND on read** — defensive; corrupt row → empty value, not crash.

## Plan 03-07 key decisions (gap closure)

- **Fix at main, not contract.** The contract was already correct; only main drifted. Reshaping the contract would have touched renderer mocks + tests across multiple plans. The one-line change at the main boundary restores the declared shape with zero renderer churn.
- **Static-analysis contract over runtime Electron assertion.** Sufficient for BLOCKER 4-class shape checks; no native-module runtime needed.
- **Audit branches unchanged.** The local `getOrAutoDetectPreset` typed return keeps `matched?` so Q-A audit metadata still emits on first-save. Only the IPC return expression drops the wrapper. This decoupling is what makes the fix safe — Q-A is preserved with zero drift.

## Plan 03-08 key decisions (gap closure)

- **Fix the test, not the hook.** The hook's release ordering is correct; the flake is in the test's wait pattern. Refactoring `release()` to be more "test-friendly" would have introduced churn for the sake of a flake that's better fixed at the test boundary.
- **5s safety-net timeout retained.** Documented in `tests/renderer/pages/procedure-room.test.tsx` (commit `2b3add2`); the explicit `.then` await is the primary fix, but the timeout guarantees the test doesn't hang if a future refactor breaks the `.then` chain entirely.

## Requirements traceability (Phase 5)

- **SCRN-01**: 05-01 (migration 0003 + screenshots IPC + capture lib + Scrubber + ScreenshotTimeline + ProcedureRoom S/hotkey) + 05-05 (CORS header + crossOrigin='anonymous' on <video>/<img>)
- **SCRN-02**: 05-01 (persistence under <userData>/data/media/patients/<p>/<proc>/screenshots/<ts>.jpg) + 05-07 (mid-procedure gallery in ProcedureRoom + delete discoverability) + 05-10 (pure local-state remove() + event-driven re-sync via screenshotToastStore.subscribeCommitted) + 05-12 (shared screenshotUrl helper + ScreenshotTimeline mediaBaseUrl/patientId wiring + ProcedureRoom useMediaUrl() so the gallery renders the captured JPEGs)
- **REV-01**: 05-01 (Scrubber pointer events + setPointerCapture) + 05-02 (pause markers from procedure_segments) + 05-03 (trim handles + useMediaUrl hook) + 05-04 (HTTP Range request support + Scrubber clampCurrent guard)
- **REV-02**: 05-01 (click-to-seek + per-thumbnail timestamp label + Toast-undo delete) + 05-02 (inline annotation input) + 05-07 (24×24 × discoverability + expand affordance + ScreenshotLightbox modal at native 1280-px resolution) + 05-11 (MediaServer route accepts literal `screenshots/` subdir segment + ScreenshotLightbox URL composition includes it) + 05-12 (timeline thumbnails render the captured JPEGs at ~120×110px in both ProcedureReview and ProcedureRoom — no more "FRAME" placeholder; shared screenshotUrl helper + ScreenshotLightbox canonicalized onto it)
- **REV-03**: 05-01 (post-recording +Capture via <video> + canvas snapshot) + 05-02 (useProcedures SWR-style hook + StatusBadge) + 05-04 (DestructivePartialAlert + D-13 partial-status gate on +Capture)
- **REV-04**: 05-03 (trim handles + ffmpeg subprocess + applyTrim + Restore + MediaServer `/media/` route + PROCEDURES_TRIM/RESTORE handlers + TrimControls + useTrim/useMediaUrl hooks) + 05-04 (HTTP Range request support + 9-case security audit + DestructivePartialAlert extraction + TrimControls 30-min cap + Scrubber clampCurrent + useMediaUrl retry()) + 05-08 (drop windowsVerbatimArguments: true from trim spawn) + 05-09 (Scrubber screenshot markers + tick scale + TrimControls in/out frame previews)

## Requirements traceability (Phase 3)

- **CAPT-01**: 03-01 (enumerateDshowDevices) + 03-02 (renderer call) + 03-03 (devices.test.ts) + 03-04 (Patient List entry point for Settings → Capture dropdown) + 03-05 (SettingsHub page sidebar entry for Capture)
- **CAPT-02**: 03-01 (presetRepo + IPC) + 03-02 (Settings → Capture UI) + 03-07 (IPC contract fix — saved preset hydration)
- **CAPT-03**: 03-02 (useVideoPreview hook + Settings preview pane + Procedure Room hero) + 03-04 (Patient List entry point makes the existing D-09 live preview reachable) + 03-05 (SettingsHub page makes the existing Capture page reachable AND PatientRow Open Procedure Room entry makes Procedure Room reachable) + 03-06 (presetHints defensive guard unblocks ProcedureRoom open on corrupt preset rows) + 03-08 (deterministic cleanup tests)
- **CAPT-10**: 03-01 (canonicalizeName + 15 tests)
- **SET-01**: 03-01 (REP) + 03-02 (Settings → Capture device picker) + 03-04 (header DropDownMenu surfaces it for every doctor) + 03-05 (SettingsHub sidebar surfaces it as a Button instead of transient DropDownMenu) + 03-06 (shared SettingsSidebar keeps the Capture entry visible on every Settings sub-page)
- **SET-02**: 03-01 (qualityPresetSchema + autoDetectPreset) + 03-02 (Settings → Capture preset UI) + 03-07 (IPC contract fix — saved preset hydration in production renderer)
- **SET-04**: 03-02 (SettingsUsers admin gate) + 03-04 (header DropDownMenu admin gate on Users item) + 03-05 (SettingsHub sidebar Users admin gate) + 03-06 (SettingsSidebar Users admin gate inherited by all three Settings pages)

## Workflow Notes

- Auto-mode was requested. The `gsd-project-researcher` and `gsd-roadmapper` subagent types are not installed in this OpenCode runtime (`unknown_agent: true`); the orchestrator produced all four research files + this roadmap inline, using the user's brief as the primary input and the templates as the structure.
- All `gsd-tools` CLI commands (`query init.new-project`, `query commit`, `query config-set`, `query generate-claude-md`) ran successfully against the `gsd-tools.cjs` binary.
- During 03-07 execution, the `better-sqlite3` Node 24 native binding was rebuilt via `electron-rebuild` (environmental fix; the verifier had already flagged this as out-of-scope).

## Continuity

- Last commit: `feat(05-12): production fix for G-05-15 timeline thumbnails (extract screenshotUrl helper + wire ScreenshotTimeline + canonicalize ScreenshotLightbox + plumb ProcedureReview/ProcedureRoom)`
- Auto-chain flag: `workflow._auto_chain_active = false` (user-controlled; not auto-advancing).
- All 8 Phase 3 plans have `*-SUMMARY.md`; phase-level verification can be re-run.
- All 12 Phase 5 plans have `*-SUMMARY.md`; phase-level verification can be re-run. ROADMAP.md Phase 5 row updated to "12/12 plans executed" on next gsd-tools roadmap.update-plan-progress call.
- 05-12 closed G-05-15 — the captured JPEGs now render in the timeline at ~120×110px in both ProcedureReview (post-recording review) and ProcedureRoom (mid-procedure gallery). UAT Test 3 (Capture 2 screenshots from playback) and Test 7 (mid-procedure gallery) become re-runnable end-to-end with the actual clinical images visible.

## Phase 5 sub-plans

| Plan | Title | Status |
|------|-------|--------|
| 05-01 | Screenshot capture pipeline: migration 0003 + screenshots IPC + capture lib + Scrubber + ScreenshotTimeline + ProcedureRoom S/hotkey + ProcedureReview replacement | complete (39/39 unit tests pass) |
| 05-02 | Right-rail polish: pause markers on scrubber (D-11) + inline annotation + Notes accordion (D-09) + StatusBadge + useProcedures SWR hook | complete (Plan 02 tests + Plan 01 regression = 67 tests pass) |
| 05-03 | Trim handles on scrubber + ffmpeg trim subprocess + applyTrim + Restore + PreviewServer `/media/` route + PROCEDURES_TRIM/RESTORE handlers + MediaServer + TrimControls + useTrim/useMediaUrl hooks | complete (49 new unit tests pass; trim-smoke opt-in via RUN_SMOKE=1) |
| 05-04 | Integration hardening: MediaServer HTTP Range request support + 9-case security audit + DestructivePartialAlert extraction + TrimControls 30-min cap + Scrubber clampCurrent + useMediaUrl retry() + ProcedureReview placeholder Card + 3 pre-existing test cascade-pollution fixes + VERIFICATION.md + Windows hardware smoke UAT.md | complete (484/484 tests pass across 62 files; phase_status: complete pending Windows hardware smoke per UAT.md) |
| 05-05 | Gap closure (G-05-3): CORS header on MediaServer + PreviewServer + crossOrigin='anonymous' on <video>/<img> + tests for access-control-allow-origin + strict toBlob stub | complete |
| 05-06 | Gap closure (G-05-5): relativeVideoPath returns filename only (writer side fix) + trim error enriched with resolved stat path + procedure status + dir listing + contract-guard test + end-to-end trim/restore round-trip test + JSDoc on videoFilePath + restoreFromOriginal | complete (491/491 tests pass across 62 files; 3 new contract-guard tests; no regressions) |
| 05-07 | Gap closure (G-05-8/9/10): ProcedureRoom mid-procedure gallery in right aside + 24×24 solid-red × delete button at top-1 right-1 with focus-visible:ring-2 + dedicated expand affordance on ScreenshotThumbnail/ScreenshotTimeline via new onOpen prop + new ScreenshotLightbox modal via shadcn Dialog + existing /media/ route serving full-size JPEG + Toast-undo parity across gallery/timeline/lightbox | complete (499/499 tests pass across 63 files; 8 new contract-guard tests; no regressions) |
| 05-08 | Gap closure (G-05-11): drop `windowsVerbatimArguments: true` from trim spawn so Node's default Windows quoting handles the userData path with embedded spaces (matching recorder.ts:290 + recorder.ts:1045 canonical pattern); rewrite stale header comment that falsely claimed the flag "mirrors concat.ts"; 2 contract-guard tests in trim.test.ts lock the spawn options shape (no verbatim flag + stdio array + shell !== true + single-argv input element) | complete (501/501 tests pass across 63 files; 2 new contract-guard assertions; no regressions) |
| 05-09 | Gap closure (G-05-12): Scrubber accepts `screenshots?: Screenshot[]` prop + renders one blue dot per captured screenshot at `pctFor(s.timestampInVideoMs, durationMs)` left percent (z-1 + `bg-blue-500/70` distinguishes from slate pause markers); Scrubber wraps track in flex-col wrapper that renders a tick scale strip BELOW the track when `trimMode === true` + durationMs > 0 (5s interval ≤60s, 10s > 60s); TrimControls accepts OPTIONAL `screenshots` + `videoRef` + `captureFrame` props (captureFrame is the test seam — production wires seek + capture round-trip, tests pass synchronous async stub); when `trimMode === true` + captureFrame supplied, CardContent renders `<img data-testid='trim-in-preview'>` + `<img data-testid='trim-out-preview'>` above the existing In/Out labels; `captureInFlightRef` guards concurrent captures per handle; ProcedureReview defines `captureFrameForTrim` at module scope (1-second seeked timeout + resolve null on failure) and passes `screenshots={screenshots}` + `videoRef={videoRef}` + `captureFrame={captureFrameForTrim}` to `<TrimControls>`; 4 contract-guard tests | complete (505/505 tests pass across 63 files; 4 new contract-guard assertions; no regressions) |
| 05-10 | Gap closure (G-05-13): pure local-state `remove(id)` on useScreenshotIntake + useProcedures; event-driven re-sync via `screenshotToastStore.subscribeCommitted` → useProcedures `refresh()` on match; ProcedureRoom + ProcedureReview handlers call remove BEFORE enqueueDelete (Undo triggers refresh); `screenshotToastStore.commitDelete` now fires `toast.error` via dynamic `import('sonner')` on IPC failure instead of silent `console.error`; 4 new contract-guard tests in useScreenshotIntake.test.ts (3) + procedure-room-timer.test.tsx (1) + ProcedureReview.test.tsx (3 new in dedicated `ProcedureReview gallery delete (G-05-13)` describe block — actually total 7 in 3 files) | complete (511/511 tests pass across 64 files; 7 new contract-guard assertions; no regressions) |
| 05-11 | Gap closure (G-05-14): extend `MEDIA_ROUTE_RE` with optional `(?:([a-zA-Z0-9-]+)\/)?` capture group 3 + add `ALLOWED_SUBDIRS: ReadonlySet<string> = new Set(['screenshots'])` allow-list defense-in-depth (404 BEFORE filesystem access); handler reads `subdir = match[3] ?? ''` and joins it into the resolved path (`''` is a no-op for `path.join` so flat URLs continue to work); ScreenshotLightbox URL composition updated to include the literal `screenshots/` segment: `${mediaBaseUrl}/media/${patientId}/${procedureId}/screenshots/${fileName}`; 4 new contract-guard tests (2 in preview-server + 2 in range-request) + 1 updated ScreenshotLightbox URL composition assertion | complete (515/515 tests pass across 64 files; 4 new contract-guard assertions; no regressions) |
| 05-12 | Gap closure (G-05-15): extract shared `screenshotUrl({ mediaBaseUrl, patientId, procedureId, filePath })` helper at `src/renderer/src/lib/screenshot-url.ts` — single source of truth for the screenshot `<img>` src (leaf-filename regex + literal `screenshots/` subdir + `/media/` route shape) — returns `null` when `mediaBaseUrl` is `null` for graceful degrade; ScreenshotTimeline adds `mediaBaseUrl: string \| null` + `patientId: string` props and composes each thumbnail's `thumbnailSrc` via the helper (the `<img>` element mounts at ~120×110px — no more 'FRAME' placeholder); ScreenshotLightbox canonicalized onto the same helper (no third copy of the leaf-filename regex); ScreenshotThumbnail gains `data-testid="screenshot-thumbnail-img"` for the new contract-guard test seam; ProcedureRoom gains a `useMediaUrl()` hook call so the mid-procedure gallery is visually populated; 1 new contract-guard test (timeline `<img>` src composition) + 4 new helper tests (null-safety + happy-path + Windows backslash + forward-slash leaf extraction) | complete (520/520 tests pass across 65 files; 5 new contract-guard assertions; no regressions) |
| 07-04 | i18next bundles (en/ar) + useLanguage hook flips `<html dir>` on change + Wizard step 4 (language radio submits users.language) + 5-page useTranslation wiring (PatientsList + Audit + ProfileEditor + ProcedureReview + ReportEditor) + AR PDF via Font.register(NotoSansArabic) + bidi `<Text direction='rtl'>` wrappers + numeric fragment `<Text direction='ltr'>` isolation per Pitfall 8 + D-24 parity check Vitest + RUN_SMOKE=1 integration smoke (file > 50KB + PDF magic bytes) | complete (649/652 tests pass across 88 files; 14 new tests + 5 pre-existing PDF smoke failures unrelated to Phase 7; 4 auto-fixed bugs: unused useState, dead STATUS_OPTIONS, ReportEditableFields missing fields, ProcedureReview race condition) |
| 07-05 | BackupRestore page (two side-by-side Cards per UI-SPEC §Implementation Bindings) + 3 new picker IPC channels (BACKUP_PICK_DESTINATION / RESTORE_PICK_ZIP / RESTORE_REVEAL_STAGING) wrapping Electron dialog APIs + zod .strict() validators with bounded strings + restore preview Dialog with integrity check display (green Passed / red Failed:) + v1.1 activate placeholder (DISABLED button + tooltip) + inline D-12 warning Alert (warn but don't block) + ConfirmDialog gating Restore to staging + 8 test cases covering all 6 must-have truths + AGENTS.md prohibition contract (renderer never sends a data/ path) | complete (657/660 tests pass across 89 files; 8 new tests; 3 pre-existing PDF smoke failures unrelated to Plan 05; 3 auto-fixed: duplicated `{{` typo + `shell.openPath` is async (TS2339) + unused AlertTitle import). BackupRestore uses pre-existing `backup.*` i18n keys from Plan 07-04 — no new translation work needed. |

---
*State last updated: 2026-08-08 after 05-12-PLAN.md completed (G-05-15 closed: timeline thumbnails broken — `ScreenshotTimeline.tsx` was silently dropping `thumbnailSrc` since Plan 05-07 (placeholder fall-through was masking the missing wiring); Plan 12 extracted the URL composition into a shared `screenshotUrl` helper, wired `mediaBaseUrl` + `patientId` props through ScreenshotTimeline + ProcedureReview + ProcedureRoom, canonicalized ScreenshotLightbox onto the same helper (no third copy), added `data-testid="screenshot-thumbnail-img"` for the new contract-guard test, and gave ProcedureRoom its first `useMediaUrl()` call so the mid-procedure gallery is visually populated; 1 new ScreenshotTimeline contract-guard test + 4 new `screenshotUrl` helper tests; 520/520 tests across 65 files)*

## Session

**Last session:** 2026-08-11T04:05:00.000Z
**Stopped at:** Phase 07 Plan 4 complete
**Resume file:** .planning/phases/07-search-history-audit-ui-backup-restore-arabic-rtl/07-04-SUMMARY.md

## Performance Metrics

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 05 P05 | 5 min | 2 tasks | 5 files |
| Phase 05 P06 | 7 min | 2 tasks | 5 files (recorder.ts + trim.ts + paths.ts + procedures-repo.ts + trim.test.ts) |
| Phase 05 P07 | 25 min | 3 tasks | 6 files (ScreenshotThumbnail.tsx + ScreenshotTimeline.tsx + ProcedureRoom.tsx + ScreenshotLightbox.tsx [new] + ProcedureReview.tsx + 2 test files; 1 new test file) |
| Phase 05 P08 | 5 min | 2 tasks | 2 files (trim.ts + trim.test.ts; one-key production fix + 2 contract-guard tests) |
| Phase 5 P9 | 8min | 3 tasks | 5 files (Scrubber.tsx + TrimControls.tsx + ProcedureReview.tsx + 2 test files) |
| Phase 05 P10 | 8 min | 2 tasks | 8 files |
| Phase 05 P11 | 6 min | 2 tasks | 5 files (preview-server.ts + ScreenshotLightbox.tsx + 3 test files) |
| Phase 05 P12 | 6 min | 3 tasks | 8 files (screenshot-url.ts [new] + ScreenshotTimeline.tsx + ScreenshotThumbnail.tsx + ScreenshotLightbox.tsx + ProcedureReview.tsx + ProcedureRoom.tsx + 2 test files; 1 new test file) |
| Phase 07 P04 | ~45 min | 2 tasks + 1 fix commit | 8 created + 12 modified + 1 TTF binary (i18n bundles + useLanguage + Wizard step 4 + AR PDF + 5-page useTranslation wiring) |
| Phase 07 P05 | ~25 min | 1 task (tracer) | 2 created (BackupRestore.tsx + 8-case test file) + 8 modified (IPC contract + validators + backup IPC + restore IPC + preload + App.tsx + setup.ts + .planning/SUMMARY.md) |

## Decisions

- [Phase ?]: G-05-3: CORS header (Access-Control-Allow-Origin: *) on every MediaServer + PreviewServer response path via a single setHeader call as the FIRST line of each onHttpRequest handler — covers 200/206/416/404/403/405
- [Phase ?]: G-05-3: capture-screenshot test contract guard — strict toBlob stub in withCrossOriginSource block mimics Chromium's tainted-canvas null-return so a future re-permissive-monkey-patch regression fails the suite
- [Phase ?]: G-05-3: crossOrigin='anonymous' on the <video> in ProcedureReview + the live MJPEG <img> in ProcedureRoom; pair with the server header so Chromium issues CORS-mode requests and canvas.drawImage does not taint
- [Phase 5 P06]: G-05-5: Fix the writer (recorder.relativeVideoPath returns 'video.mp4'), NOT the resolver — keeps the contract surface explicit and avoids a defensive resolver that masks contract drift
- [Phase 5 P06]: G-05-5: Export `__relativeVideoPathForTest` for direct contract assertion — minimum code for maximum assertion strength vs standing up the full Recorder.start() pipeline with stubs
- [Phase 5 P06]: G-05-5: Enriched source-missing error keeps raw stored value separate from resolved stat path — future debugging sees both halves of the contract-drift symptom immediately
- [Phase 5 P07]: G-05-8/9/10: Inline SVG Maximize2 instead of lucide-react Maximize2 import — saves a new dep for a 4-path icon used in exactly one place (ponytail: stdlib first)
- [Phase 5 P07]: G-05-9: expand affordance on top-LEFT, × on top-RIGHT — two independent affordances visually separated (red=destructive, slate=expand) so a gloved clinician can target them without ambiguity
- [Phase 5 P07]: G-05-8: Mid-procedure gallery surfaces WITHOUT a ProcedureRoom page-level state change — the existing useScreenshotIntake hook already populates `screenshots[]`; the gallery is just a consumer of existing state. No new IPC, no new hook surface
- [Phase 5 P07]: G-05-8: handleScreenshotDelete in ProcedureRoom mirrors ProcedureReview.handleDelete but drops the `void refresh().then(...)` — the room's gallery re-renders from the hook's local state directly, so the toast store's pending entry is the source of truth for "deleted" from the user's POV
- [Phase 5 P07]: G-05-9/10: Test guard for discoverability uses className.contains() for the discoverable tokens (h-6 w-6 bg-red-600) — DOM presence alone is insufficient; a 16×16 grey glyph would still be in the DOM and pass a button-exists test
- [Phase 5 P08]: G-05-11: Match recorder.ts:290 (recording) + recorder.ts:1045 (concat) instead of inventing a new spawn options shape — trim joins them as a third canonical spawn with the same `{ stdio: [...] }` options
- [Phase 5 P08]: G-05-11: Contract-guard test reads `spawnMock.mock.calls[0][2]` (the third arg to spawn = the options object) — catches regressions that the argv-only assertions miss. Asserts verbatim-flag absence + stdio array + shell !== true + single-argv input element (no caller-side pre-quoting)
- [Phase 5 P08]: G-05-11: Drop `expect(inputArg).toContain(' ')` from the second contract-guard test — the assertion locks the G-05-11 failure mode (caller-side pre-quoting) without coupling the test to the host's tmp-dir shape (CI runners typically have no spaces in their usernames)
- [Phase ?]: G-05-12: videoRef OPTIONAL on TrimControls — making it required would break the 9 pre-existing tests that never pass it
- [Phase ?]: G-05-12: captureFrame test seam — production wires the seek + capture round-trip via captureFrameForTrim; tests pass a synchronous async stub returning 'AAAA' that RTL findBy* resolves immediately
- [Phase ?]: G-05-12: module-scope captureFrameForTrim in ProcedureReview — stable identity across renders means TrimControls' useEffect doesn't re-fire on every parent re-render (dependency-array stability matters for capture-bound effects)
- [Phase ?]: G-05-12: Scrubber wrapper testid conditional on trimMode (NOT testId fallback) — preserves screen.getByTestId('scrubber-track') resolution against the inner track. Plan text would have caused duplicate-id errors in RTL
- [Phase ?]: G-05-13: pure local-state remove() on both screenshot-owning hooks — smallest correct fix; no IPC, no useReducer, just a setScreenshots filter
- [Phase ?]: G-05-13: event-driven re-sync via screenshotToastStore.subscribeCommitted → useProcedures refresh() on match — success is a no-op refetch; failure restores the row
- [Phase ?]: G-05-13: dynamic import('sonner') inside commitDelete's catch block keeps the store decoupled from the rendering layer at module init
- [Phase ?]: G-05-14: optional capture group in MEDIA_ROUTE_RE (one source of truth for the route shape) — flat URLs continue to match (group 3 = undefined), subdir URLs match with it
- [Phase ?]: G-05-14: ALLOWED_SUBDIRS as ReadonlySet<string> co-located with the regex — ReadonlySet prevents accidental mutation; co-location makes the subdir surface visible to anyone touching the route
- [Phase ?]: G-05-14: 404 before filesystem access in the allow-list check — short-circuits the missing-file stat AND proves the rejection is intentional, not coincidental
- [Phase ?]: G-05-14: no Content-Type fix for v1 — the <img> sniffs the bytes, so the cosmetic video/mp4 mismatch is a v1.1 follow-up if Chromium ever tightens MIME enforcement
- [Phase 5 P12]: G-05-15: Extract shared `screenshotUrl` helper (NOT inline composition in the timeline) — eliminates the third copy of the leaf-filename regex + `/media/` template + literal `screenshots/` subdir. The helper returns `null` when `mediaBaseUrl` is `null` (graceful degrade until `useMediaUrl` resolves) — same path the `<video>` element uses for missing-media-url. Phase 6's PDF preview reuses this without a 4th copy
- [Phase 5 P12]: G-05-15: Coerce helper `null` → `undefined` at the timeline call site via `?? undefined` — preserves the existing `thumbnailSrc?: string` prop type without weakening the conditional render gate (`thumbnailSrc && !errored` correctly handles both null and undefined via the falsy check). No prop-signature change needed
- [Phase 5 P12]: G-05-15: `data-testid="screenshot-thumbnail-img"` on the `<img>` element (not the placeholder div) — stable test seam for the contract-guard test, copy-independent (vs. the placeholder's `aria-label="Thumbnail pending"`), no-op for production users (React strips testids from production DOM via the standard JSX transform)
- [Phase 5 P12]: G-05-15: ProcedureRoom gains ONE `useMediaUrl()` call (was missing entirely) — the hook stays bound across page transitions (existing design from Plan 05-03) so the IPC round-trip fires only once per app session. No new IPC, no new state
- [Phase 7 P04]: useLanguage mounted ONCE at boot via `<LanguageApplier />` inside main.tsx — D-19 verbatim. Single source of truth for document direction; no per-page i18n.changeLanguage calls would fragment the direction state across renders
- [Phase 7 P04]: AR PDF bidi isolation via nested `<Text direction>` wrappers — outer Text with direction='rtl' for the Arabic body, inner Text with direction='ltr' for numeric fragments (MRN, DOB, duration). The pattern is the only @react-pdf/renderer-supported way to render bidi text correctly; CSS logical direction is not supported by the renderer
- [Phase 7 P04]: Font.register with module-scope once-per-process guard (`_notoArabicRegistered: boolean`) — re-registration on every PDF render is wasteful + can throw under load. The guard is a simple boolean flag in render-report-pdf.ts
- [Phase 7 P04]: AR translation values are hand-written per D-20 verbatim — no machine translation. Every EN key has a matching AR value; the D-24 parity test in CI prevents the half-translated drift class
- [Phase 7 P04]: NotoSansArabic TTF bundled at src/main/pdf/fonts/NotoSansArabic-Regular.ttf (234 KB subset) — per D-27 verbatim. The full font is ~700KB but the subset covers the Arabic glyph range used by the AR PDF UI. The smaller file size keeps the binary install under the 5MB shipping target (the offline-only mandate forbids a build-time fetch)
- [Phase 7 P04]: src/shared/ipc-contract.ts NOT modified — REPORTS_REGEN_PDF signature is unchanged. Main reads language internally from doctor_profile.language → users.language → 'en' fallback chain (D-26). The renderer stays language-agnostic; the IPC contract stays stable
- [Phase 7 P04]: tailwind.config.ts NOT modified — Tailwind 3.4 native rtl: variants are implicit (no plugin needed). The 'tailwindcss-rtl' plugin is explicitly forbidden per D-23
- [Phase 7 P04]: ReportEditor.tsx ReportEditableFields patch widened to all four fields (recommendations + procedureDetails) — Phase 6 UAT G-06-10 trimmed the editor UI to two fields but the type contract still required all four. The runtime IPC was already accepting the overlay; the typecheck error was the surfacing issue
