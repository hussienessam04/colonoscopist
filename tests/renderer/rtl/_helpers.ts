// Phase 7 / Plan 07-06 — Shared helper for the per-route RTL smoke
// tests under tests/renderer/rtl/. Each test follows the pattern from
// RESEARCH.md Pattern 7: init script flips document.documentElement.dir
// to 'rtl' + lang to 'ar' BEFORE the page loads; the route loads; we
// wait for the static layout to settle; we assert
// document.documentElement.scrollWidth <= window.innerWidth (the
// right-edge overflow check from D-22 verbatim); we capture a
// full-page screenshot for the visual regression baseline.
//
// The baseURL (http://localhost:5173 by default; override via
// E2E_BASE_URL) targets the electron-vite dev server. Tests tolerate
// an empty-data render — the overflow check is on the document body,
// not on specific rows, so a 404 or an empty Patient List still gives
// us a stable DOM to measure.
import { type Page, expect } from '@playwright/test';

/**
 * Navigate to a route with document.documentElement.dir = 'rtl' + lang = 'ar'
 * applied BEFORE the first script runs. Asserts no right-edge overflow and
 * captures a full-page screenshot for the visual regression baseline.
 *
 * @param page  Playwright Page
 * @param path  URL path (e.g. '/login', '/patients')
 * @param name  Filename stem for the screenshot (e.g. 'login')
 */
export async function smokeRoute(page: Page, path: string, name: string): Promise<void> {
  await page.addInitScript(() => {
    document.documentElement.dir = 'rtl';
    document.documentElement.lang = 'ar';
  });
  await page.goto(path);
  // ponytail: prefer 'domcontentloaded' over 'networkidle' — electron-vite
  // dev server keeps a long-poll HMR socket open that prevents networkidle
  // from firing. domcontentloaded + a small render settle is enough for
  // the static layout overflow check.
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(250);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `route ${path} has right-edge overflow of ${overflow}px in RTL`).toBeLessThanOrEqual(0);
  await page.screenshot({
    path: `tests/renderer/rtl/screenshots/${name}--rtl.png`,
    fullPage: true,
  });
}
