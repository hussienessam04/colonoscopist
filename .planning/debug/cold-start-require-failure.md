# Cold Start Runtime Require Failure

**Date:** 2026-08-05
**Phase:** 04-recording-timer-device-lost
**Severity:** blocker
**Status:** resolved (fix applied — verifying)

## Symptom

After `npm run dev`, Electron main process throws unhandled promise rejection at boot:

```
Error: Cannot find module '../db/procedures-repo'
  at buildDefaultDeps (out/main/index.js:2938:47)
  at initRecorder (out/main/index.js:3059:16)
```

The vite build succeeds (37 modules transformed, `out/main/index.js` is 106KB), but Electron runtime fails before the window opens.

## Root Cause

`src/main/recorder/recorder.ts:buildDefaultDeps()` used lazy `require()` calls at lines 1028, 1037, 1048 to import `../db/procedures-repo`, `../db/audit`, and `./ffmpeg-path`. These are dynamic runtime requires that Rollup cannot statically resolve, so the bundler preserves them verbatim in the output bundle.

The relative paths in those requires are correct relative to the **source file** (`src/main/recorder/recorder.ts`):
- `../db/procedures-repo` → `src/main/db/procedures-repo` ✓
- `../db/audit` → `src/main/db/audit` ✓
- `./ffmpeg-path` → `src/main/recorder/ffmpeg-path` ✓

But the **bundled output** is a single file at `out/main/index.js`. Resolving those paths at runtime from that location:
- `../db/procedures-repo` → `out/db/procedures-repo.js` ✗ (file does not exist; everything is inlined into `out/main/index.js`)
- `../db/audit` → `out/db/audit.js` ✗
- `./ffmpeg-path` → `out/main/ffmpeg-path.js` ✗

No actual circular dependency exists between `recorder.ts` and `procedures-repo.ts` / `audit.ts` / `ffmpeg-path.ts`. The lazy `require()` was defensive code (defer module evaluation), but unnecessary.

## Evidence

- `out/main/index.js:2938` runtime require: `const { proceduresRepo: proceduresRepo2 } = require("../db/procedures-repo");`
- `out/main/index.js` is a single 106KB bundled file; no `out/main/db/` or `out/main/recorder/` subdirs exist.
- `src/main/recorder/recorder.ts:1026-1058` had three lazy `require()` calls inside `buildDefaultDeps`.
- Phase 3 worked because no recorder code was shipped. Phase 4's first commit (`2d98717 feat(04-01): wire procedures + recorder skeleton`) introduced the lazy require pattern; the runtime error appears only after that commit.

## Fix

Convert the three lazy `require()` calls to top-level ES imports. The bundler inlines them into the single output file, eliminating the runtime path resolution.

**Before** (recorder.ts:1026-1058):
```ts
export function buildDefaultDeps(overrides: Partial<RecorderDeps> = {}): RecorderDeps {
  const { proceduresRepo } = require('../db/procedures-repo') as typeof import('../db/procedures-repo');
  return {
    ...
    procedures: proceduresRepo as unknown as ProceduresSubRepo,
    audit: (opts) => {
      const { audit } = require('../db/audit') as typeof import('../db/audit');
      ...
    },
    ffmpegPath: () => {
      const { defaultFfmpegPath } = require('./ffmpeg-path') as typeof import('./ffmpeg-path');
      return defaultFfmpegPath();
    },
    ...
  };
}
```

**After**:
```ts
import { proceduresRepo } from '../db/procedures-repo';
import { audit } from '../db/audit';
import { defaultFfmpegPath } from './ffmpeg-path';

export function buildDefaultDeps(overrides: Partial<RecorderDeps> = {}): RecorderDeps {
  return {
    ...
    procedures: proceduresRepo as unknown as ProceduresSubRepo,
    audit: (opts) => {
      audit({ ... });
    },
    ffmpegPath: () => defaultFfmpegPath(),
    ...
  };
}
```

## Verification

- `npm run typecheck:node` clean
- `npm run test:unit` 314/314 pass
- `npm run build` succeeds; `out/main/index.js` no longer contains `require("../db/procedures-repo")` (verified by grep)
- User confirms `npm run dev` boots the app

## Files Modified

- `src/main/recorder/recorder.ts` — 3 imports hoisted + 3 `require()` calls removed from `buildDefaultDeps`

## Suggested Defensive Follow-Up (Optional)

Add a vitest test that runs `vite build` and greps the output for any `require("\.\./db/")` patterns, so future lazy-require additions get caught at CI time. Skip for v1 — current tests + manual boot catch it.
