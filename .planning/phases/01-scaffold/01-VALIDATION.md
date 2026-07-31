---
phase: 1
slug: scaffold
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-31
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest` (devDep) — Node environment only in Phase 1 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json && node scripts/check-security-baseline.cjs && node scripts/check-no-any.cjs && node scripts/check-ipc-contract.cjs && node scripts/check-no-persistence.cjs && node scripts/check-set04-stub.cjs && npx vitest run` |
| **Full suite command** | Same as quick — Phase 1 has only one smoke test |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** `npx tsc --noEmit && node scripts/check-security-baseline.cjs && node scripts/check-no-any.cjs`
- **After every plan wave:** full suite above
- **Before `/gsd-verify-work`:** Full suite green AND manual `npm run dev` boots the placeholder login
- **Max feedback latency:** ~10s

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01 | 01 | 1 | AUTH-04 | T1 | No persistent session across reboot | static (grep) | `node scripts/check-no-persistence.cjs` | ⬜ W0 | ⬜ pending |
| 01-02 | 01 | 1 | SET-03 | T1 | `dataDir()` resolves to `<userData>/data` | unit (Vitest) | `npx vitest run tests/main/paths.test.ts` | ⬜ W0 | ⬜ pending |
| 01-03 | 01 | 1 | (foundation) | T2 | Native rebuild on install; startup logs binding version | build + smoke | `npm install` + tail boot log | ⬜ W0 | ⬜ pending |
| 01-04 | 01 | 1 | (success #1) | T2 | `webPreferences` has `contextIsolation: true, nodeIntegration: false, sandbox: true` literally | static (grep) | `node scripts/check-security-baseline.cjs` | ⬜ W0 | ⬜ pending |
| 01-05 | 02 | 2 | (success #5) | — | `tsconfig.{node,web}.json` strict + no `any` in IPC paths | static (tsc + grep) | `npx tsc --noEmit` + `node scripts/check-no-any.cjs` | ⬜ W0 | ⬜ pending |
| 01-06 | 02 | 2 | AUTH-01 (foundation) | T2 | `auth:status` round-trips end-to-end | smoke (Vitest) | `npx vitest run tests/shell/auth-status.test.ts` | ⬜ W0 | ⬜ pending |
| 01-07 | 03 | 3 | (success #4) | — | Tailwind + shadcn render placeholder login | build-time | `npm run build` exits 0 + CSS contains utilities | ⬜ W0 | ⬜ pending |
| 01-08 | 03 | 3 | D-01/D-02/D-03 | — | Window dims 1280×800 min, 1920×1080 max | static + smoke | grep dims + manual drag check | ⬜ W0 | ⬜ pending |
| 01-09 | 03 | 3 | D-05/D-07/D-08 | — | Placeholder login UI matches decisions | render (Vitest) | `tests/renderer/Login.test.tsx` asserts banner copy | ⬜ W0 | ⬜ pending |
| 01-10 | 03 | 3 | SET-04 (stub) | T1 | No `users:*` IPC channels (stub only) | static (grep) | `node scripts/check-set04-stub.cjs` | ⬜ W0 | ⬜ pending |

*Threat refs: T1 = no data leaks, T2 = no RCE / wrong arch, T3 = no integrity loss (none in Phase 1).*

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tsconfig.json` + `tsconfig.node.json` + `tsconfig.web.json` — all three with `"strict": true`, `"noImplicitAny": true`
- [ ] `src/shared/ipc-contract.ts` — Phase 1 minimal (one constant + one union type)
- [ ] `src/preload/index.ts` + `src/preload/api.d.ts`
- [ ] `src/main/index.ts` + `src/main/window.ts` + `src/main/paths.ts` + `src/main/ipc/auth.ts` + `src/main/startup-log.ts`
- [ ] `src/renderer/pages/Login.tsx` (D-05/D-07/D-08)
- [ ] `components.json` from `shadcn init`
- [ ] `src/renderer/components/ui/{button,input,label}.tsx` from `shadcn add`
- [ ] `src/renderer/styles/globals.css` with `@tailwind base; @tailwind components; @tailwind utilities;`
- [ ] `scripts/check-security-baseline.cjs`
- [ ] `scripts/check-no-any.cjs`
- [ ] `scripts/check-ipc-contract.cjs`
- [ ] `scripts/check-set04-stub.cjs`
- [ ] `scripts/check-no-persistence.cjs`
- [ ] `vitest.config.ts`
- [ ] `tests/main/paths.test.ts`
- [ ] `tests/shell/auth-status.test.ts`
- [ ] `tests/renderer/Login.test.tsx`
- [ ] CI script `scripts/verify-phase-1.cjs` — runs all of the above plus `npm run build`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `npm run dev` boots a window with the placeholder login visible | (success #4) + D-04 | Window rendering + UI mount requires a real display | `npm run dev`; observe title bar, login placeholder, hint banner |
| Window is draggable to resize, capped at 1920×1080 | D-03 | Manual UI interaction | Drag bottom-right corner past 1920×1080; observe cap |
| Window minimum 1280×800 honored | D-02 | Manual UI interaction | Drag below min; observe snap |
| `[boot] better-sqlite3 binding version: 11.10.0` line in stderr/log | (success #2) | Smoke confirmation | `npm run dev`; inspect stderr + log file |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending