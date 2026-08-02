---
phase: 3
slug: capture-enumeration-live-preview
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-02
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.1.9 (Electron-as-Node runner via `scripts/run-vitest.cjs`) |
| **Config file** | none — vitest defaults; per-test setup via `tests/main/setup.ts` and `tests/renderer/setup.ts` |
| **Quick run command** | `npm run test:unit -- tests/main/capture tests/renderer/hooks` |
| **Full suite command** | `npm run test:unit` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:unit -- tests/main/capture tests/renderer/hooks`
- **After every plan wave:** Run `npm run test:unit`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | CAPT-01 | T-3-01 / A5 | Spawn dshow enumeration; canonicalize output | unit (mock spawn) | `npm run test:unit -- tests/main/capture/devices.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 1 | CAPT-10 | T-3-01 | Canonical name round-trips through ffmpeg arg | unit | `npm run test:unit -- tests/main/capture/canonicalize.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-03 | 01 | 1 | SET-02 | — | `autoDetectPreset()` SD/HD regex classification | unit | `npm run test:unit -- tests/main/capture/auto-detect-preset.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-04 | 01 | 1 | CAPT-02, SET-01, SET-02 | T-3-02 | `settings` k/v read/write round-trip for default + matrix | unit | `npm run test:unit -- tests/main/capture/preset-repo.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-05 | 01 | 1 | AUDIT-01 | T-3-04 | Every `capture.*` mutation writes canonical-name audit row | integration | `npm run test:unit -- tests/main/capture/audit-trace.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-06 | 01 | 1 | — | T-3-05 | Security baseline preserved (permissions: ['media'] added) | smoke | `npm run test:unit -- tests/shell/security-baseline.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 1 | CAPT-03 | T-3-03 | `useVideoPreview` starts/stops MediaStream on mount/unmount | unit (happy-dom) | `npm run test:unit -- tests/renderer/hooks/use-video-preview.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-02 | 02 | 1 | CAPT-03 | T-3-03 | `useVideoPreview` rejects all four error classes to local state | unit | `npm run test:unit -- tests/renderer/hooks/use-video-preview.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-03 | 02 | 1 | D-01, D-07, D-02 | T-3-04 | Procedure Room renders controls + empty state | component | `npm run test:unit -- tests/renderer/pages/procedure-room.test.tsx` | ❌ W0 | ⬜ pending |
| 03-02-04 | 02 | 1 | D-09, D-10 | T-3-04 | Settings → Capture renders live preview pane | component | `npm run test:unit -- tests/renderer/pages/settings-capture.test.tsx` | ❌ W0 | ⬜ pending |
| 03-03-01 | 03 | 2 | All | — | Vitest full suite + typecheck green | suite | `npm run test:unit && npm run typecheck` | ✅ existing | ⬜ pending |
| 03-03-02 | 03 | 2 | CAPT-01..03 | A5 | Manual smoke test on Windows bench enumerates + previews | manual | `/gsd-verify-work 3` UAT | n/a | ⬜ pending |

---

## Wave 0 Requirements

- [ ] `tests/main/capture/devices.test.ts` — covers CAPT-01 (mock spawn) + CAPT-10 (canonical round-trip)
- [ ] `tests/main/capture/canonicalize.test.ts` — covers CAPT-10 (NFC + trim + collapse-spaces + zero-width strip)
- [ ] `tests/main/capture/auto-detect-preset.test.ts` — covers SET-02 (SD regexes + HD regexes + fallback)
- [ ] `tests/main/capture/preset-repo.test.ts` — covers CAPT-02 + SET-01 + SET-02 (settings k/v read/write)
- [ ] `tests/main/capture/audit-trace.test.ts` — covers AUDIT-01 for every capture.* event
- [ ] `tests/renderer/hooks/use-video-preview.test.ts` — covers CAPT-03 (start/stop on unmount + error states)
- [ ] `tests/renderer/pages/procedure-room.test.tsx` — covers D-01 (Last used label) + D-07 (Start/Stop/Finish) + D-02 (empty state)
- [ ] `tests/renderer/pages/settings-capture.test.tsx` — covers D-09 (live preview pane) + D-10 (no refresh button)
- [ ] `tests/shell/security-baseline.test.ts` — extend Phase 1 to assert `permissions: ['media']` is present
- [ ] Framework install: not needed (Vitest + jsdom + happy-dom already installed)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live preview renders real USB capture device on Windows | CAPT-01, CAPT-03 | dshow is Windows-only; this is a Mac dev env | Plug EasyCap/HDMI capture into Windows machine; launch app; verify device appears in Settings → Capture and Procedure Room dropdowns; click Start Preview; verify live preview renders. Repeat for HDMI capture. |
| Phase 4 ffmpeg arg round-trip | CAPT-10 | Phase 4 not yet shipped; manual verification deferred | Defer to Phase 4 UAT — `verify ffmpeg accepts the exact canonical name ffmpeg receives` |
| Auto-detect heuristic real-device match | SET-02 | Regex needs real device-name corpus | Plug EasyCap; verify SD preset auto-selected on first save. Plug HDMI capture; verify HD preset. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
