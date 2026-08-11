// Phase 7 / Plan 07-06 — Playwright RTL smoke per-route (D-22 + I18N-03 ship gate).
//
// Configuration: 8 per-route tests under tests/renderer/rtl/. Each test
// boots the renderer with document.documentElement.dir = 'rtl' and
// asserts the right-edge overflow invariant (document.documentElement
// .scrollWidth <= window.innerWidth). One Chromium project. Screenshot
// capture for visual regression baseline.
//
// Base URL: Playwright defaults to http://localhost:5173 (electron-vite
// dev server). Tests can override via E2E_BASE_URL env var.
//
// The static layout overflow invariant tolerates an empty-data render —
// no fixture data is needed. The check is on document.documentElement,
// not on specific rows.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/renderer/rtl',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list']],
  use: {
    headless: true,
    viewport: { width: 1366, height: 768 }, // UI-SPEC §Spacing minimum
    launchOptions: { args: ['--no-sandbox'] },
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
