---
slug: screenshot-tile-i18n-and-badge-polish
created: 2026-09-06
type: polish
source: ad-hoc user report
---

# Quick Task: ScreenshotTile — `common.attached` i18n + smaller badge + cleaner timestamp

## Bug

Three things are off in the right-rail screenshots grid (visible
in the doctor's screenshot):

1. **"COMMON.ATTACHED" badge label** — the new `ATTACHED` badge I
   added in the previous quick task uses `t('common.attached')` but
   the translation file doesn't have that key. The raw dotted
   path leaks through. Fix: add `common.attached` to EN + AR.

2. **Badge spans the full width of the thumbnail** — the
   `bg-[#0E3A47] px-1.5 py-0.5` rendering pushes the pill
   across the whole top of the thumbnail (looks like a wide
   banner, not a tag). Replace with a small icon-only pill:
   `h-6 w-6 rounded-full bg-[#0E3A47] text-white shadow` with a
   `Check` lucide icon. Reads as a clean "chosen" mark.

3. **Timestamp strip looks orange** — the dark `bg-black/50`
   on top of a JPEG thumbnail bleeds the image's orange tint
   through. Make the strip more opaque + use a small mono pill
   that doesn't try to span the whole bottom:
   `absolute bottom-1 left-1 right-1 rounded bg-black/70 px-1.5
   py-0.5 font-mono text-[10px] text-white text-center`.

## Scope

- `src/renderer/src/i18n/en/translation.json` + AR equivalent —
  add `"attached": "Attached"`.
- `src/renderer/src/components/ScreenshotTimeline.tsx`:
  - Badge: `bg-[#0E3A47] px-1.5 py-0.5 text-[10px] font-semibold
    uppercase tracking-wider text-white shadow` →
    `absolute right-1 top-1 z-20 flex h-6 w-6 items-center
    justify-center rounded-full bg-[#0E3A47] text-white shadow-md`
    + a `<Check className="size-3.5" />` icon.

## Verification

- `tests/renderer/components/ScreenshotTimeline.test.tsx` should
  still pass — the badge's testid (`screenshot-attached-badge`)
  stays, the className changes are visual only.
- Manual: attach a screenshot, verify the badge reads as a
  small ✓ icon at the top-right (not a wide pill), and the
  timestamp strip doesn't bleed the JPG's tint.

## Out of scope

- The bottom-left toggle button (+) — already styled, no change.
- The bottom-right ‹ › move buttons — already styled, no change.
