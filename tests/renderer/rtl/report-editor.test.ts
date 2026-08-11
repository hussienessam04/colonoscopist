// Phase 7 / Plan 07-06 — Report Editor page RTL smoke (I18N-03 ship gate).
// Right-edge overflow check under document.documentElement.dir = 'rtl'.
// ReportEditor requires a procedureId in the URL; we pass a UUID-shaped
// placeholder so the page mounts even when the data is missing.
import { test } from '@playwright/test';
import { smokeRoute } from './_helpers';

test('ReportEditor renders without RTL overflow', async ({ page }) => {
  const fakeProcedureId = '00000000-0000-0000-0000-000000000002';
  await smokeRoute(page, `/report-editor?procedureId=${fakeProcedureId}`, 'report-editor');
});
