---
phase: 5
slug: screenshots-procedure-review-trim
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-06
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (existing; Phase 1 wired) |
| **Config file** | `vitest.config.ts` (existing) |
| **Quick run command** | `npm run test:unit -- --run review-trim` |
| **Full suite command** | `npm run test:unit -- --run` |
| **Estimated runtime** | ~45 seconds |

---

## Sampling Rate

- **After every task commit:** `npm run test:unit -- --run review-trim`
- **After every plan wave:** `npm run test:unit -- --run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 45 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | SCRN-01, SCRN-02 | T-05-01 | Screenshot timestamp validated ≥ 0; JPEG byte-size capped ≤ 5 MB | unit | `npm run test:unit -- --run screenshots/add` | ⬜ W0 | ⬜ pending |
| 05-01-02 | 01 | 1 | REV-02 | T-05-02 | Click thumbnail seeks `<video>` to `timestamp_in_video / 1000` | unit (renderer) | `npm run test:unit -- --run renderer/ScreenshotTimeline click-seek` | ⬜ W0 | ⬜ pending |
| 05-01-03 | 01 | 1 | D-13 | T-05-03 | Trim rejects `procedure.status === 'partial'` | unit | `npm run test:unit -- --run ipc/procedures trim-partial` | ⬜ W0 | ⬜ pending |
| 05-01-04 | 01 | 1 | D-08 | T-05-04 | Trim args emit `-ss BEFORE -i -c copy` | unit | `npm run test:unit -- --run recorder/buildTrimArgs` | ⬜ W0 | ⬜ pending |
| 05-02-01 | 02 | 2 | SCRN-02 | T-05-05 | FK ON DELETE CASCADE removes screenshots when procedure deleted | unit | `npm run test:unit -- --run migrations/0003` | ⬜ W0 | ⬜ pending |
| 05-02-02 | 02 | 2 | REV-01 | T-05-06 | Review `<video>` loads mp4 via localhost HTTP | unit (renderer) | `npm run test:unit -- --run renderer/Scrubber` | ⬜ W0 | ⬜ pending |
| 05-02-03 | 02 | 2 | REV-03 | T-05-07 | Post-recording screenshot via canvas snapshot | unit (renderer) | `npm run test:unit -- --run renderer/capture-screenshot` | ⬜ W0 | ⬜ pending |
| 05-03-01 | 03 | 3 | REV-04 | T-05-08 | Trim ffmpeg subprocess produces playable trimmed mp4 | unit | `npm run test:unit -- --run recorder/trim` | ⬜ W0 | ⬜ pending |
| 05-03-02 | 03 | 3 | REV-04 | T-05-09 | `applyTrim` updates `video_path` + sets `video_path_original` (first trim only) | unit | `npm run test:unit -- --run db/procedures-repo trim` | ⬜ W0 | ⬜ pending |
| 05-03-03 | 03 | 3 | REV-04 | T-05-10 | `restoreFromOriginal` re-points `video_path`; idempotent | unit | `npm run test:unit -- --run db/procedures-repo restore` | ⬜ W0 | ⬜ pending |
| 05-04-01 | 04 | 4 | Integration | T-05-11 | Range request attack rejected (path outside userData root) | unit (security) | `npm run test:unit -- --run preview-server/media-route` | ⬜ W0 | ⬜ pending |
| 05-04-02 | 04 | 4 | Integration | T-05-12 | Real ffmpeg trim produces a playable mp4 from a lavfi-generated source | integration | `npm run test:integration -- --run trim-smoke` | ⬜ W0 | ⬜ pending |
| 05-UAT-01 | 05 | UAT | SCRN-01..02, REV-01..04 | — | End-to-end: record → review → screenshot → trim → restore | manual | Windows hardware smoke | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/main/db/migrations/0003_screenshots_and_trim.test.ts` — schema validation; CHECK constraints enforced; FK ON DELETE CASCADE verified.
- [ ] `tests/main/db/screenshots-repo.test.ts` — `add`, `listByProcedure`, `delete`, `updateAnnotation`.
- [ ] `tests/main/db/procedures-repo.test.ts` (extend) — `updateVideoPath(id, newPath, originalPath?)`, `restoreFromOriginal(id)`.
- [ ] `tests/main/recorder/ffmpeg-args.test.ts` (extend) — `buildTrimArgs` parameter matrix; rejects `outMs <= inMs`.
- [ ] `tests/main/recorder/trim.test.ts` — spawn fake ffmpeg child; assert exit-code-0 path updates row + audit; assert exit-code-non-zero throws.
- [ ] `tests/main/recorder/preview-server.test.ts` (extend) — `/media/<patientId>/<procedureId>/<file>` route serves the mp4 with `Accept-Ranges: bytes`; rejects paths outside the userData root (security).
- [ ] `tests/main/ipc/screenshots.test.ts` — IPC round-trip for `add / list / delete / updateAnnotation`; rejects oversized JPEG bytes; rejects bad procedureId.
- [ ] `tests/main/ipc/procedures.test.ts` (extend) — `trim` + `restore` round-trip; trim rejects partial; restore rejects missing `video_path_original`.
- [ ] `tests/renderer/lib/capture-screenshot.test.ts` — canvas snapshot from `<img>` and `<video>` mocks; max-edge downscale; toBlob quality=0.85.
- [ ] `tests/renderer/components/Scrubber.test.tsx` — drag handles clamp `inMs < outMs`; click-to-seek; pause markers render from `procedure_segments`.
- [ ] `tests/renderer/components/ScreenshotTimeline.test.tsx` — click thumbnail seeks video; delete-with-undo Toast appears; memoization prevents sibling re-renders (React DevTools Profiler or a render-counter).
- [ ] `tests/integration/trim-smoke.test.ts` — real ffmpeg: lavfi source → trim → ffprobe validates moov atom + duration.

*Existing infrastructure covers the rest (Vitest + better-sqlite3 test DBs from Phase 1/2/4 + ffmpeg-static from Phase 4).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| End-to-end record → review → screenshot → trim → restore on real webcam | SCRN-01..02, REV-01..04 | Real USB capture card hardware; no headless equivalent | 1. Plug webcam. 2. Run `npm run dev`. 3. Pick device. 4. Record 30s. 5. Stop. 6. Land on Procedure Review. 7. Click screenshot thumbnail → video seeks. 8. Trim 5s off start + 5s off end → Apply. 9. Verify trimmed mp4 plays. 10. Restore → verify original plays. |
| Visual feedback latency (timer ticks, scrubber follows) | REV-01 | Visual; no automated equivalent | 1. Mid-recording, observe timer ticks once per second. 2. Post-recording, observe scrubber position syncs to `<video>`. |
| Drag-handle UX (clamps, snaps, cut-region shading) | REV-04 | Pointer interaction; no headless equivalent | 1. Open Review in Trim mode. 2. Drag handles → cut region shades red. 3. Drag handle past its opposite → clamps. 4. Release → preview plays the trimmed range. |

*All other phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 45s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending