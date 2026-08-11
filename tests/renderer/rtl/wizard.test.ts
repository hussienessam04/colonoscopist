// Phase 7 / Plan 07-06 — Wizard page RTL smoke (I18N-03 ship gate).
// Right-edge overflow check under document.documentElement.dir = 'rtl'.
import { test } from '@playwright/test';
import { smokeRoute } from './_helpers';

test('Wizard renders without RTL overflow', async ({ page }) => {
  await smokeRoute(page, '/wizard', 'wizard');
});
