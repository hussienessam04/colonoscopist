---
phase: 4
slug: recording-timer-device-lost
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-04
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (already wired Phase 1) |
| **Config file** | `vitest.config.ts` (existing) |
| **Quick run command** | `npm run test:unit -- --run recording` |
| **Full suite command** | `npm run test:unit -- --run` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:unit -- --run recording`
- **After every plan wave:** Run `npm run test:unit -- --run`
- **Before `/gsd-verify-work`:** Full suite green + Windows hardware smoke UAT
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | CAPT-04 | T-04-01 | Registry enforces one ffmpeg child per procedureId | unit | `npm run test:unit -- --run recorder/registry` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 1 | CAPT-05 | T-04-02 | mp4 path uses canonical userData-relative form | unit | `npm run test:unit -- --run recorder/ffmpeg-args` | ❌ W0 | ⬜ pending |
| 04-01-03 | 01 | 1 | CAPT-06 | T-04-03 | Stop = 'q\n' on stdin + 5s grace + SIGKILL fallback + fsync | unit | `npm run test:unit -- --run recorder/stop` | ❌ W0 | ⬜ pending |
| 04-01-04 | 01 | 1 | CAPT-07 | — | Timer renders HH:MM:SS from injected `startedAt` | unit (Renderer) | `npm run test:unit -- --run renderer/procedure-room timer` | ❌ W0 | ⬜ pending |
| 04-01-05 | 01 | 1 | CAPT-08 | T-04-04 | Note save rejects empty body via CHECK constraint | unit | `npm run test:unit -- --run procedure-notes/create` | ❌ W0 | ⬜ pending |
| 04-01-06 | 02 | 2 | D-11 | — | Pause kills ffmpeg + Resume spawns new child; finalize runs `ffmpeg -f concat -c copy` | unit | `npm run test:unit -- --run recorder/segments` | ❌ W0 | ⬜ pending |
| 04-01-07 | 02 | 2 | CAPT-09 | T-04-05 | Device-lost → inline banner + .partial.mp4 + sidecar JSON | unit | `npm run test:unit -- --run recorder device-lost` | ❌ W0 | ⬜ pending |
| 04-01-08 | 03 | 3 | D-04 | T-04-06 | Crash recovery scans for orphan .partial.* on launch | unit | `npm run test:unit -- --run recorder/orphans` | ❌ W0 | ⬜ pending |
| 04-01-09 | 03 | 3 | All | — | Real ffmpeg produces playable mp4 (lavfi test source) | integration | `npm run test:integration -- --run recording-smoke` | ❌ W0 | ⬜ pending |
| 04-01-10 | 03 | 3 | All | T-04-07 | audit_log rows fire for each recording.* event | unit | `npm run test:unit -- --run recording/audit` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/main/recorder/recorder.test.ts` — covers all 8 transition tests from RESEARCH.md §Supervisor State Machine
- [ ] `tests/main/recorder/registry.test.ts` — busy-error + procedureId scoping
- [ ] `tests/main/recorder/ffmpeg-args.test.ts` — D-12 args builder; per-preset bitrate matrix (SD=4M, HD=10M, Custom=5M)
- [ ] `tests/main/recorder/concat.test.ts` — segment list file format; -c copy happy path + re-encode fallback
- [ ] `tests/main/recorder/orphans.test.ts` — crash recovery scan + audit row insertion
- [ ] `tests/main/recorder/device-lost.test.ts` — stderr regex matching + .partial.mp4 + sidecar JSON write
- [ ] `tests/main/db/migrations/0002_procedures.test.ts` — schema validation; CHECK constraints enforced
- [ ] `tests/main/ipc/procedures.test.ts` — IPC round-trip for `create / get / list / finalize`
- [ ] `tests/main/ipc/procedure-notes.test.ts` — IPC round-trip for `create / list` + empty-body rejection
- [ ] `tests/main/ipc/recording.test.ts` — IPC round-trip for `start / stop / pause / resume` + ffmpeg child PID handling
- [ ] `tests/renderer/pages/procedure-room-timer.test.tsx` — HH:MM:SS rendering from injected `startedAt`
- [ ] `tests/renderer/pages/procedure-room-notes.test.tsx` — Notes panel save flow + chronological list
- [ ] `tests/integration/recording-smoke.test.ts` — real ffmpeg lavfi → playable mp4 (skipped in CI without ffmpeg-static)
- [ ] Framework: existing Vitest; no new dependencies.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Windows hardware: USB capture device enums + records | CAPT-04/05 | Requires physical USB device + clinic-test bench | Plug EasyCap or webcam → enumerate → Record → 60s → Stop → verify mp4 plays in VLC |
| Windows hardware: device disconnect mid-recording | CAPT-09 | Requires physical disconnect during recording | Start record with real device → unplug USB → confirm inline banner + .partial.mp4 visible |
| Pause/Resume with real device (frame continuity) | D-11 | Requires `ffmpeg -f concat -c copy` verification against actual hardware encoder output | Record 60s → Pause 5s → Resume 60s → Stop → verify final mp4 is contiguous playback |
| Procedure Review placeholder UI smoke | D-05 | Renderer UI cannot be visually confirmed by automated tests alone | Start/Stop a procedure → confirm navigation to `'procedure-review'` placeholder renders |

*If "All phase behaviors have automated verification." is achievable, this section becomes empty.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
