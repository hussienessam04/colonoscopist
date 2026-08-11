// Phase 7 / Plan 07-06 — Patients List RTL smoke (I18N-03 ship gate).
// Right-edge overflow check under document.documentElement.dir = 'rtl'.
import { test } from '@playwright/test';
import { smokeRoute } from './_helpers';

test('PatientsList renders without RTL overflow', async ({ page }) => {
  await smokeRoute(page, '/patients', 'patients-list');
});
