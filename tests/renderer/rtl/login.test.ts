// Phase 7 / Plan 07-06 — Login page RTL smoke (I18N-03 ship gate).
// Right-edge overflow check under document.documentElement.dir = 'rtl'.
import { test } from '@playwright/test';
import { smokeRoute } from './_helpers';

test('Login renders without RTL overflow', async ({ page }) => {
  await smokeRoute(page, '/login', 'login');
});
