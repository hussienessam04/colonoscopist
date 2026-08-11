// Phase 7 / Plan 07-06 — Procedure Review page RTL smoke (I18N-03 ship gate).
// Right-edge overflow check under document.documentElement.dir = 'rtl'.
// ProcedureReview requires a procedureId in the URL; we pass a UUID-shaped
// placeholder so the page mounts even when the data is missing.
import { test } from '@playwright/test';
import { smokeRoute } from './_helpers';

test('ProcedureReview renders without RTL overflow', async ({ page }) => {
  const fakeProcedureId = '00000000-0000-0000-0000-000000000001';
  await smokeRoute(page, `/procedure-review?id=${fakeProcedureId}`, 'procedure-review');
});
