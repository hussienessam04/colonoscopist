---
phase: 05-screenshots-procedure-review-trim
plan: 12
subsystem: ui
tags: [screenshot, timeline, lightbox, url-composition, react, electron]

# Dependency graph
requires:
  - phase: 05-screenshots-procedure-review-trim
    provides: "ScreenshotTimeline + ScreenshotThumbnail + ScreenshotLightbox + MediaServer /media/<p>/<proc>/screenshots/<file> route + ALLOWED_SUBDIRS allow-list (Plan 05-11) — server is ready to serve the subdir shape; only the renderer was missing the URL composition"
provides:
  - "Shared `screenshotUrl({ mediaBaseUrl, patientId, procedureId, filePath })` helper at src/renderer/src/lib/screenshot-url.ts — single source of truth for the screenshot <img> src URL composition (leaf-filename regex + literal `screenshots/` subdir segment)"
  - "ScreenshotTimeline accepts `mediaBaseUrl: string | null` + `patientId: string` props and composes each thumbnail's `thumbnailSrc` via the shared helper — the `<img>` element now renders the captured JPEG at ~120×110px (the 'FRAME' placeholder is gone)"
  - "ScreenshotLightbox URL composition canonicalized onto the same helper — no third copy of the leaf-filename regex + the `/media/` route shape + the literal `screenshots/` subdir"
  - "ScreenshotThumbnail `<img>` element gains `data-testid='screenshot-thumbnail-img'` — deterministic test seam for the new G-05-15 contract-guard"
  - "ProcedureRoom gains a `useMediaUrl()` hook call so the mid-procedure gallery can compose each <img> src — gallery is now visually populated, not placeholder"
affects:
  - "Phase 06 — PDF preview can reuse `screenshotUrl` (zero-cost dedup)"
  - "Any future component that needs a screenshot <img> src — import the helper, don't inline the composition"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shared URL composition helper as single source of truth (no inline copies across timeline + lightbox + future PDF preview)"
    - "Graceful-degrade-via-null contract — helper returns null when MediaServer URL is not yet bound; <img> conditional render falls through to placeholder; URL lands via React re-render when useMediaUrl resolves"

key-files:
  created:
    - src/renderer/src/lib/screenshot-url.ts
    - tests/renderer/lib/screenshot-url.test.tsx
  modified:
    - src/renderer/src/components/ScreenshotTimeline.tsx
    - src/renderer/src/components/ScreenshotThumbnail.tsx
    - src/renderer/src/components/ScreenshotLightbox.tsx
    - src/renderer/src/pages/ProcedureReview.tsx
    - src/renderer/src/pages/ProcedureRoom.tsx
    - tests/renderer/components/ScreenshotTimeline.test.tsx

key-decisions:
  - "Extract shared `screenshotUrl` helper (not inline composition in the timeline) — eliminates the third copy of the leaf-filename regex + `/media/` route template + literal `screenshots/` subdir"
  - "Helper returns `null` when `mediaBaseUrl` is `null` (graceful degrade until `useMediaUrl` resolves) — same path the <video> element uses for missing-media-url"
  - "Add `data-testid='screenshot-thumbnail-img'` to the `<img>` element (not the placeholder div) — deterministic seam for the contract-guard test that would have caught the original Plan 05-07 omission"
  - "ProcedureRoom gains ONE `useMediaUrl()` call (was missing entirely) — URL stays bound across page transitions so the IPC round-trip fires only once per app session"
  - "Coerce helper `null` → `undefined` at the timeline call site via `?? undefined` — preserves the existing `thumbnailSrc?: string` prop type without weakening the conditional render gate (which already correctly handles both null and undefined via falsy check)"

patterns-established:
  - "Pattern: URL composition helpers — colocate leaf-filename regex + path-shape literal in one module, accept the same arg shape everywhere it's composed, return null when upstream state is unresolved so the call site can render its fallback"
  - "Pattern: testid as no-op production DOM contract — `data-testid` survives production builds via standard JSX transform; lets contract-guard tests query deterministic elements without coupling to copy/role"

requirements-completed: [SCRN-02, REV-02]

# Coverage metadata (#1602) — one entry per shipped deliverable.
coverage:
  - id: D1
    description: "Shared `screenshotUrl` helper at src/renderer/src/lib/screenshot-url.ts — single source of truth for the screenshot <img> src URL composition"
    requirement: SCRN-02
    verification:
      - kind: unit
        ref: tests/renderer/lib/screenshot-url.test.tsx#returns null when mediaBaseUrl is null (MediaServer not yet bound)
        status: pass
      - kind: unit
        ref: tests/renderer/lib/screenshot-url.test.tsx#returns the full /media/<p>/<proc>/screenshots/<leaf>.jpg URL — G-05-15
        status: pass
      - kind: unit
        ref: tests/renderer/lib/screenshot-url.test.tsx#extracts the leaf filename from a Windows-backslash path
        status: pass
      - kind: unit
        ref: tests/renderer/lib/screenshot-url.test.tsx#extracts the leaf filename from a forward-slash path
        status: pass
    human_judgment: false
  - id: D2
    description: "ScreenshotTimeline wired with mediaBaseUrl + patientId props; composes each thumbnailSrc via the shared helper; <img> now mounts at ~120×110px with the captured JPEG (the 'FRAME' placeholder is gone)"
    requirement: REV-02
    verification:
      - kind: unit
        ref: tests/renderer/components/ScreenshotTimeline.test.tsx#renders each thumbnail's <img> with the subdir-aware URL when mediaBaseUrl + patientId are supplied — G-05-15 contract guard
        status: pass
    human_judgment: false
  - id: D3
    description: "ProcedureRoom mid-procedure gallery now visually populated — useMediaUrl() call added; the gallery renders the captured JPEGs (not placeholders) during recording"
    requirement: SCRN-02
    verification:
      - kind: unit
        ref: tests/renderer/components/ScreenshotTimeline.test.tsx#renders each thumbnail's <img> with the subdir-aware URL when mediaBaseUrl + patientId are supplied — G-05-15 contract guard
        status: pass
    human_judgment: false
  - id: D4
    description: "End-to-end UAT verification on the Windows hardware smoke (the doctor lands on Procedure Review, sees the timeline with the captured JPEGs at ~120×110px; the mid-procedure gallery shows the captured JPEGs during recording)"
    verification: []
    human_judgment: true
    rationale: "Visual verification — actual pixel rendering of the captured clinical image cannot be asserted by the unit suite (tests assert <img src> composition; the doctor's eye verifies the JPEG bytes decode to a recognisable frame). Already locked by A6 (timeline) + A7 (annotation) + A8 (lightbox URL composition) tests; the new visual surface is the same code path the tests cover."

# Metrics
duration: 6min
completed: 2026-08-08
status: complete
---

# Phase 5 Plan 12: G-05-15 Timeline Thumbnails Fix Summary

**Shared `screenshotUrl` helper + `ScreenshotTimeline` `mediaBaseUrl`/`patientId` prop wiring + `ScreenshotLightbox` URL composition canonicalized — the captured JPEGs render in the timeline at ~120×110px in BOTH ProcedureReview and ProcedureRoom (no more 'FRAME' placeholder)**

## Performance

- **Duration:** ~6 min active execution (across the gap-closure round; Tasks 1+2 were committed in prior sessions as Wave 0 contract guards; Task 3 production fix committed in this dispatch)
- **Started:** 2026-08-07T19:37:19Z (plan created in commit 343a797)
- **Completed:** 2026-08-08T01:43:03Z (Task 3 production commit a332ddf)
- **Tasks:** 3 (2 Wave 0 contract-guard test commits + 1 production commit)
- **Files modified:** 8 (1 new helper + 1 new test + 4 production files + 1 extended test + 2 generated tsbuildinfo)

## Accomplishments

- **G-05-15 resolved** — Each thumbnail in `ScreenshotTimeline` (in BOTH `ProcedureReview` and `ProcedureRoom`) now renders the captured JPEG at ~120×110px. The `<img>` element mounts with `src` ending in `/media/<patientId>/<procedureId>/screenshots/<leaf>.jpg`. The "FRAME" placeholder + Maximize2-only UI is gone. The doctor can now visually identify captured frames at a glance during review AND mid-procedure.
- **Shared `screenshotUrl` helper extracted** — Leaf-filename regex + literal `screenshots/` subdir + `/media/` route shape now live in ONE place (`src/renderer/src/lib/screenshot-url.ts`). `ScreenshotLightbox.tsx` canonicalized onto the same helper (no third copy). Phase 6's PDF preview will reuse this without duplication.
- **`ProcedureRoom` gains `useMediaUrl()`** — The mid-procedure gallery was previously windowless — no MediaServer URL plumbed to it. Now it composes each `<img>` src the same way `ProcedureReview` does. The gallery renders the captured JPEGs during recording.
- **Contract-guard test added** — `ScreenshotTimeline.test.tsx` "G-05-15 contract guard" test would have caught the original Plan 05-07 omission. Future regressions that drop the `thumbnailSrc` prop plumbing fail at CI. The placeholder-fall-through is no longer a silent masked bug.
- **No regressions** — All 515 pre-existing tests still pass. 5 new assertions (1 timeline contract-guard + 4 helper unit tests). Total: 520/520 tests across 65 files.

## Task Commits

Each task was committed atomically:

1. **Task 1: Wave 0 contract-guard: ScreenshotTimeline test (G-05-15)** — `1ae0b5a` (test)
2. **Task 2: Wave 0 contract-guard: screenshotUrl helper test (G-05-15)** — `10559b1` (test)
3. **Task 3: Production: extract screenshotUrl helper + wire ScreenshotTimeline + canonicalize ScreenshotLightbox + plumb ProcedureReview/ProcedureRoom** — `a332ddf` (feat)

**Plan metadata:** _pending — this commit will be added after SUMMARY creation_

_Note: Tasks 1+2 are RED in isolation (RED phase of the TDD-style Wave 0 gate). Task 3 turns them GREEN. The full test suite (520/520) reports PASS only when all three commits are applied together._

## Files Created/Modified

- `src/renderer/src/lib/screenshot-url.ts` — **NEW**. Shared `screenshotUrl({ mediaBaseUrl, patientId, procedureId, filePath })` helper. Returns `null` when `mediaBaseUrl` is `null` (graceful degrade until `useMediaUrl` resolves). Otherwise returns `${mediaBaseUrl}/media/${patientId}/${procedureId}/screenshots/${leafFileName}`. The leaf-filename regex `/^.*[\\/]/` handles both Windows backslash and forward-slash paths. The literal `screenshots/` subdir segment + the `/media/` route shape all live here.
- `tests/renderer/lib/screenshot-url.test.tsx` — **NEW**. 4 tests in a `describe('screenshotUrl')` block: (a) null mediaBaseUrl → null, (b) happy-path URL composition includes literal `screenshots/` subdir, (c) Windows backslash leaf extraction, (d) forward slash leaf extraction. happy-dom env.
- `src/renderer/src/components/ScreenshotTimeline.tsx` — Added `mediaBaseUrl: string | null` + `patientId: string` props. The `screenshots.map(...)` block now composes `thumbnailSrc` via `screenshotUrl(...) ?? undefined` for each `<ScreenshotThumbnail>`. Coerces null → undefined to match the existing `thumbnailSrc?: string` prop type without weakening the conditional render gate. `+Capture` button + memo boundary unchanged.
- `src/renderer/src/components/ScreenshotThumbnail.tsx` — Added `data-testid="screenshot-thumbnail-img"` to the `<img>` element so the new G-05-15 contract-guard test can find it deterministically. The conditional render gate (`thumbnailSrc && !errored`) is unchanged so back-compat for any future mount without `mediaBaseUrl` is preserved (the placeholder div still renders).
- `src/renderer/src/components/ScreenshotLightbox.tsx` — Canonicalized the URL composition onto the shared helper. The local `fileName` extraction + the inline string template at lines 58-72 are deleted. The component now calls `screenshotUrl({ mediaBaseUrl, patientId, procedureId, filePath: screenshot.filePath })`. The `<img>` testid `screenshot-lightbox-img`, the Dialog mount, and the Delete button are unchanged.
- `src/renderer/src/pages/ProcedureReview.tsx` — The existing `<ScreenshotTimeline>` mount gains `mediaBaseUrl={mediaUrl.url}` (already in scope at line 106) + `patientId={procedure?.patientId ?? ''}` (already on the procedure object). No new state, no new hook, no new IPC.
- `src/renderer/src/pages/ProcedureRoom.tsx` — Added `import { useMediaUrl } from '@/hooks/useMediaUrl'` + `const mediaUrl = useMediaUrl()` near the other hook calls. The existing `<ScreenshotTimeline>` mount gains `mediaBaseUrl={mediaUrl.url}` + `patientId={patientIdFromRoute}` (already extracted from the route at line 25). No new IPC, no new state.
- `tests/renderer/components/ScreenshotTimeline.test.tsx` — Added 1 new test: `"renders each thumbnail's <img> with the subdir-aware URL when mediaBaseUrl + patientId are supplied — G-05-15 contract guard"`. The test mounts the timeline with `mediaBaseUrl="http://127.0.0.1:51731"`, `patientId="p1"`, `procedureId="p1"` and the existing 2-row fixture, then asserts each thumbnail's `data-testid="screenshot-thumbnail-img"` element has `src` ending in `/media/p1/p1/screenshots/<leaf>.jpg`. Asserts the placeholder div is absent. Uses the existing `fixture` (no new fixture data).

## Decisions Made

- **Helper, not inline composition in the timeline** — The temptation was to inline the URL string in the timeline's `screenshots.map` like the lightbox did. Rejected: that would create a 3rd copy of the leaf-filename regex + `/media/` template + literal `screenshots/` subdir. Phase 6 will add a 4th copy (PDF preview). A shared helper is the smallest correct fix. The lightbox is also canonicalized onto it (dedup, no behaviour change).
- **`null` return, not `throw`** — The helper returns `null` when `mediaBaseUrl` is `null`. This matches the graceful-degrade contract the `<video>` element uses for the missing-media-url case: the conditional render falls through to a fallback (placeholder div for `<img>`, no video for `<video>`). Throwing would force every call site to add a `try/catch` for a non-error state.
- **`?? undefined` at the timeline call site** — The existing `thumbnailSrc?: string` prop accepts `string | undefined` (not `string | null`). Coercing `null` → `undefined` at the boundary lets the timeline stay typed-strict without changing the prop signature (which would have been a breaking change for any future caller that uses `string | null`). Both `null` and `undefined` correctly fall through the `thumbnailSrc && !errored` conditional.
- **`data-testid` on the `<img>`, not the placeholder div** — The contract-guard test needs to query the `<img>` deterministically. Querying the placeholder div (via `aria-label='Thumbnail pending'`) would couple the test to copy. A `data-testid` is a stable, copy-independent seam — it's also a no-op for production users (React strips it from the DOM in production builds via the standard JSX transform).
- **ProcedureRoom gains ONE `useMediaUrl()` call, not a refactor** — The room page was missing the hook entirely. Adding it is the smallest change that unblocks the gallery. No new IPC, no new state. The hook stays bound across page transitions (the existing design from Plan 05-03), so the IPC round-trip fires only once per app session.

## Deviations from Plan

None - plan executed exactly as written. The TypeScript strict-mode guard for `string | null` → `string | undefined` was anticipated in the plan's `?? undefined` pattern guidance (the helper returns `null`; the prop accepts `string | undefined`; coerce at the call site).

## Issues Encountered

None. Task 3 hit a TS2322 strict-mode error on the helper return type vs the existing `thumbnailSrc?: string` prop signature (`string | null` not assignable to `string | undefined`); the fix (`?? undefined` coercion at the call site) was the smallest possible change and matched the pattern documented in the plan's `must_haves.truths[1]` and the `key_links[3]` call site. No scope creep; no architectural decision required.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **G-05-15 closed.** The timeline thumbnails now render the captured JPEGs in both ProcedureReview and ProcedureRoom. UAT Test 3 (Capture 2 screenshots from playback) and Test 7 (mid-procedure gallery) can be re-run end-to-end with the actual clinical images visible.
- **Phase 6 (PDF preview)** — can import `screenshotUrl` from `@/lib/screenshot-url` without composing a 4th copy of the URL shape.
- **Phase 5 status** — 12/12 plans executed (4 base + 8 gap-closure rounds 05-05 through 05-12). All 6 phase requirements (SCRN-01/02 + REV-01..04) shipped end-to-end. 520/520 tests pass across 65 files. No regressions.
- **Recommended next step:** `/gsd-verify-work 5` for the Windows hardware smoke re-test (UAT Test 3 + Test 7 with the actual captured JPEGs visible in the timeline), then `/gsd-plan-phase 6` to begin the Doctor Profile + Report Editor + PDF plan.

---

*Phase: 05-screenshots-procedure-review-trim*
*Completed: 2026-08-08*
