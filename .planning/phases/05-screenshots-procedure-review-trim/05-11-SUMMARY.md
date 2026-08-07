---
phase: 05-screenshots-procedure-review-trim
plan: 11
subsystem: screenshots-procedure-review-trim
tags: [main, renderer, http, path-routing, security, allow-list, lightbox, range-request, screenshots]
gap_closure: true
gap_ids:
  - G-05-14
status: complete

# Dependency graph
requires:
  - phase: 05-screenshots-procedure-review-trim
    plan: 07
    provides: "ScreenshotLightbox modal + /media/ route contract for full-size screenshot rendering"
  - phase: 05-screenshots-procedure-review-trim
    plan: 03
    provides: "MediaServer /media/<p>/<proc>/<file> route + path-escape defense (T-05-08 + T-05-28)"
  - phase: 05-screenshots-procedure-review-trim
    plan: 04
    provides: "MediaServer HTTP Range request support + 9-case security audit"
provides:
  - "MediaServer route accepts the subdir URL shape /media/<p>/<proc>/screenshots/<file> (optional literal segment)"
  - "Defense-in-depth ALLOWED_SUBDIRS allow-list that rejects unknown subdirs with 404 BEFORE filesystem access"
  - "ScreenshotLightbox URL composition includes the literal screenshots/ segment so the on-disk layout matches the URL"
  - "Flat URLs (/media/<p>/<proc>/video.mp4) continue to work — no regression to the <video> element in ProcedureReview"
affects:
  - "Phase 5 UAT step 7 (lightbox shows full-size screenshot) becomes re-runnable end-to-end with the captured JPEG at native resolution"
  - "Future subdir expansions under /media/ route require an explicit ALLOWED_SUBDIRS code change (PR-review surface)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Optional capture group in MEDIA_ROUTE_RE ((?:([a-zA-Z0-9-]+)/)?) makes the subdir segment optional — flat URLs still match (group 3 = undefined), subdir URLs match with it"
    - "Allow-list defense-in-depth (Set<string>) co-located with the regex so a future regex refactor cannot silently expand the route surface"
    - "path.join with empty string is a no-op — subdir='' preserves the flat layout; subdir='screenshots' joins the canonical on-disk path"

key-files:
  created: []
  modified:
    - src/main/recorder/preview-server.ts
    - src/renderer/src/components/ScreenshotLightbox.tsx
    - tests/main/recorder/preview-server.test.ts
    - tests/security/range-request.test.ts
    - tests/renderer/components/ScreenshotLightbox.test.tsx

key-decisions:
  - "Ponytail: extend the existing regex with an optional capture group rather than introducing a second regex — one source of truth for the route shape, one place to update when a new subdir is added."
  - "Ponytail: ALLOWED_SUBDIRS is a ReadonlySet<string> co-located with the regex (same file, same comment block) — co-location makes the subdir surface visible to anyone touching the route, and ReadonlySet prevents accidental mutation from elsewhere."
  - "Ponytail: 404 before filesystem access in the allow-list check (status set + end + return before any path.join) — even a missing-file 404 is a wasted stat; the allow-list short-circuits faster AND proves the rejection is intentional, not coincidental."
  - "Ponytail: lightbox URL composition mirrors the existing ProcedureReview video src (same `mediaBaseUrl + /media/<p>/<proc>/...` shape) — one mental model for the renderer's HTTP composition."
  - "Ponytail: do NOT fix Content-Type to image/jpeg for v1 — the <img> element sniffs the bytes; the cosmetic mismatch is a v1.1 follow-up if Chromium ever tightens MIME enforcement."

patterns-established:
  - "Pattern: any optional URL segment in a strict-regex route gets a defense-in-depth allow-list check before filesystem access — the regex alone is necessary but not sufficient when a future refactor might loosen it."

requirements-completed: [REV-02]

# Coverage metadata (#1602) — one entry per shipped deliverable.
coverage:
  - id: D1
    description: "MediaServer regex extended to accept optional subdir segment + ALLOWED_SUBDIRS allow-list + handler updated to join subdir into resolved path"
    requirement: REV-02
    verification:
      - kind: unit
        ref: tests/main/recorder/preview-server.test.ts#serves a file under the screenshots/ subdir with the literal segment in the URL (G-05-14)
        status: pass
      - kind: unit
        ref: tests/main/recorder/preview-server.test.ts#returns 404 for an unknown subdir (allow-list defense — G-05-14)
        status: pass
    human_judgment: false
  - id: D2
    description: "MediaServer subdir route serves 206 Partial Content for Range requests (Chromium <video> seek across screenshots)"
    requirement: REV-02
    verification:
      - kind: unit
        ref: tests/security/range-request.test.ts#10. Range request against /media/<p>/<proc>/screenshots/<file> serves 206 (G-05-14)
        status: pass
      - kind: unit
        ref: tests/security/range-request.test.ts#11. Range request against an unknown subdir returns 404 (allow-list defense-in-depth — G-05-14)
        status: pass
    human_judgment: false
  - id: D3
    description: "ScreenshotLightbox URL composition includes the literal screenshots/ segment so MediaServer resolves the actual on-disk path"
    requirement: REV-02
    verification:
      - kind: unit
        ref: tests/renderer/components/ScreenshotLightbox.test.tsx#renders the full-size <img> via /media/ route when screenshot is supplied — G-05-10 (URL updated to /media/p1/proc1/screenshots/5000.jpg)
        status: pass
    human_judgment: false

# Metrics
duration: 6 min
completed: 2026-08-07
status: complete
---

# Phase 5 Plan 11: Lightbox Full-Size Fix (G-05-14) Summary

**Two contract halves landed together: MediaServer `/media/<p>/<proc>/screenshots/<file>` route (with `ALLOWED_SUBDIRS` allow-list) + ScreenshotLightbox URL composition (literal `screenshots/` segment). Click expand → lightbox renders the captured JPEG at native ~1280×720 resolution.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-08-07T19:09:29Z
- **Completed:** 2026-08-07T19:15:00Z
- **Tasks:** 2
- **Files modified:** 5 (2 production, 3 test files; no new files)

## Accomplishments

- `MEDIA_ROUTE_RE` extended with optional `(?:([a-zA-Z0-9-]+)\/)?` capture group 3. Flat URLs (`/media/<p>/<proc>/video.mp4`) still match (group 3 = `undefined`); subdir URLs (`/media/<p>/<proc>/screenshots/<file>`) match with it.
- `ALLOWED_SUBDIRS: ReadonlySet<string> = new Set(['screenshots'])` added next to the regex with a comment documenting the defense-in-depth posture. The handler returns 404 BEFORE `path.join` when an unknown subdir is requested.
- Handler at lines 453-469 reads `subdir = match[3] ?? ''` and joins it into the resolved path. `path.join(root, ..., '', file)` is a no-op for the empty-string subdir, so flat URLs continue to resolve exactly as before — no regression to the `<video>` element.
- `ScreenshotLightbox.tsx` URL composition updated to include the literal `screenshots/` segment: `${mediaBaseUrl}/media/${patientId}/${procedureId}/screenshots/${fileName}`. The `fileName` extraction regex is unchanged — it still strips the userData prefix and returns just the leaf filename (`<ts>.jpg`).
- Header comments on both files updated to document the new URL shape + the allow-list rationale.
- 4 new test assertions + 1 updated assertion across 3 test files. The 2 preview-server tests + 2 range-request tests are RED-first (fail against unfixed production code with real assertion errors, not collection errors). The 1 ScreenshotLightbox test updates the URL composition assertion to the new shape.

## Task Commits

Each task was committed atomically:

1. **Task 1: Wave 0 contract-guard tests (G-05-14)** — `6f2a620` (test)
2. **Task 2: MediaServer regex + handler subdir support + ScreenshotLightbox URL composition** — `7f5b0f3` (feat)

**Plan metadata:** this file is committed with `docs(05-11): complete plan 11 - lightbox full-size fix (G-05-14)`.

_Note: Wave 0 RED-first per Plan 07 convention. Task 1 commits failing assertions (proves the contract is real, not vacuous); Task 2 flips the production code GREEN. Two of the five assertions pass coincidentally in RED state (the unknown-subdir 404s for the wrong reason — the route regex rejects the URL shape, not the allow-list); they remain GREEN after the fix and prove the allow-list is load-bearing._

## Files Created/Modified

- `src/main/recorder/preview-server.ts` — `MEDIA_ROUTE_RE` extended with optional subdir capture group; `ALLOWED_SUBDIRS` allow-list added; handler extracts subdir, runs the allow-list check, and joins subdir into the resolved path
- `src/renderer/src/components/ScreenshotLightbox.tsx` — URL composition updated to include the literal `screenshots/` segment; header comment updated to document the new shape
- `tests/main/recorder/preview-server.test.ts` — 2 new tests in the `MediaServer` describe block: subdir GET serves 200 + 1024 bytes; unknown subdir returns 404 even with the fixture present on disk
- `tests/security/range-request.test.ts` — 2 new tests: Range request against the subdir URL returns 206 + Content-Range; Range request against an unknown subdir returns 404 (allow-list runs BEFORE Range parse)
- `tests/renderer/components/ScreenshotLightbox.test.tsx` — URL composition test updated to assert the new URL shape with `screenshots/` segment

## Decisions Made

- **Optional capture group in the regex** is the smallest change to the route contract. Flat URLs continue to match because the `(?:...)?` group is optional; subdir URLs match because the group is greedy when present. One source of truth for the route shape.
- **`ALLOWED_SUBDIRS` co-located with the regex** in the same file makes the subdir surface visible to anyone touching the route. `ReadonlySet<string>` prevents accidental mutation from elsewhere. v1 ships with only `screenshots`; new subdirs are an explicit code change (PR-review surface).
- **404 before filesystem access** in the allow-list check: `res.statusCode = 404; res.end('Not Found'); return;` runs before `path.join`, `existsSync`, `statSync`, and the Range parse. The 404 from a missing file is wasted IO; the 404 from the allow-list is intentional and short-circuits faster.
- **No Content-Type fix for v1.** The `<img>` element sniffs the bytes, so the cosmetic `Content-Type: video/mp4` mismatch (the route serves the same header regardless of extension) does not break the lightbox. A v1.1 follow-up can switch to a per-extension Content-Type lookup if Chromium ever tightens MIME enforcement.
- **No fileName extraction change** in the lightbox. The `replace(/^.*[\\/]/, '')` still strips the userData prefix and returns just the leaf filename (`<ts>.jpg`). The `screenshots/` segment is now a literal in the URL template, not extracted from the filePath — the URL is composed, not derived.

## Deviations from Plan

None — plan executed exactly as written. The contract-guard tests are RED before the production fix and GREEN after; both Wave 0 and the production fix shipped in their prescribed order with the prescribed commit message format. Two of the five new assertions pass coincidentally in RED state (the unknown-subdir 404s because the regex rejects the URL shape, not because the allow-list rejects the subdir name) — this is a feature, not a bug, because those tests remain GREEN after the fix and prove the allow-list is load-bearing when its sibling test (with the fixture present on disk) also passes.

## Issues Encountered

None. The first full-suite run showed 1 transient failure in `tests/renderer/pages/ProcedureReview.test.tsx#disables the +Capture button when status=crashed (D-13)` — a pre-existing test-pollution flake unrelated to this plan. Re-running the full suite (and the file in isolation) shows 515/515 green. The flake is a known inter-test ordering issue in the ProcedureReview suite and is not regressed by the G-05-14 changes.

## Threat Flags

None. The `ALLOWED_SUBDIRS` allow-list is the explicit mitigation for T-05-80 (future refactor loosens the regex) and T-05-84 (future code adds a subdir to the set without audit). The 4 new contract-guard tests lock both halves of the route surface (screenshots works, unknown subdirs 404).

## Next Phase Readiness

G-05-14 is closed. The lightbox renders the full-size captured JPEG at its native resolution via `/media/<p>/<proc>/screenshots/<file>`. The `<img>` GET returns 200 + the JPEG bytes (not 404), so the doctor sees the actual clinical detail, not a broken-image fallback. Flat URLs (`/media/<p>/<proc>/video.mp4`) continue to work — no regression to the `<video>` element in ProcedureReview. The allow-list defense rejects unknown subdirs with 404 before filesystem access. Range requests against the new URL shape return 206.

Phase 5 UAT step 7 (lightbox shows full-size image) is now re-runnable end-to-end. Plan 6 (Doctor Profile + Report Editor + PDF) follows Phase 5 verification.

## Self-Check: PASSED

- All task commits (`6f2a620`, `7f5b0f3`) present in `git log --oneline`.
- All 3 test files modified and collected by vitest (`preview-server.test.ts` 37 tests, `range-request.test.ts` 11 tests, `ScreenshotLightbox.test.tsx` 3 tests).
- Full unit suite: 515 tests pass across 64 files (511 pre-existing + 4 new assertions = 515; the 1 updated ScreenshotLightbox assertion is counted in the 511 since the test existed before — only the assertion string changed).
- `npm run typecheck:node` and `npm run typecheck:web` both pass with no output (clean).
- No new dependencies added — the regex change uses existing regex syntax; the URL composition uses existing template literals; the allow-list uses `Set` (no new import).

---
*Phase: 05-screenshots-procedure-review-trim*
*Completed: 2026-08-07*
