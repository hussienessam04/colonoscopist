// Phase 8 / Plan 08-06 — License sub-page RTL smoke (I18N-03 ship gate).
// Right-edge overflow check under document.documentElement.dir = 'rtl'.
// Mirrors the pattern from tests/renderer/rtl/backup-restore.test.ts.
import { test, expect } from '@playwright/test';
import { smokeRoute } from './_helpers';

test('License page renders correctly in RTL', async ({ page }) => {
  await smokeRoute(page, '/license', 'license');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('dir', 'rtl');
  await expect(html).toHaveAttribute('lang', 'ar');
});