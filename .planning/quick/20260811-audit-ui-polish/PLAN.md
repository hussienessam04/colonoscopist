---
slug: audit-ui-polish
created: 2026-08-11
type: bugfix+polish
source: ad-hoc user report (4 issues)
---

# Quick Task: Audit UI — Fix crash/NaN bugs + add SettingsSidebar + polish + add tests

## Bug 1 — "Time is always NaN" (and related snake_case contract violation)

**Root cause:** `src/main/ipc/audit.ts:49` does `return auditRepo.list(filter)` directly. The repo returns `AuditListRow[]` (snake_case: `user_id`, `entity_type`, `entity_id`, `metadata: string|null`, `created_at`, `outcome: string`). The IPC contract `AuditEntry` is camelCase (`userId`, `entityType`, `entityId`, `metadata: Record|null`, `createdAt`, `outcome: 'ok'|'failed'|'rate_limited'`). The renderer accesses `row.createdAt` etc. — gets `undefined` — `new Date(undefined).getHours()` returns NaN → "NaN:NaN:NaN".

The existing test mocks use the camelCase shape (`ROW` constant in Audit.test.tsx), so the tests pass while production breaks. Classic contract-mismatch-with-mocked-tests bug.

Symptoms:
- Time column: "NaN:NaN:NaN"
- User column: every row shows the current user's name (fallback)
- Entity column: "undefined undefined" for every row
- Detail Dialog: "Invalid Date" + escaped JSON string (not pretty-printed object)
- Copy JSON button: copies escaped JSON, not the intended object

## Bug 2 — "App crashes if I press an action row"

The dialog opens but renders broken data. While it doesn't throw, the **detail dialog opens with corrupted fields** (Invalid Date + double-escaped JSON) which makes the page effectively unusable — the user perceives this as "the app crashed". The actual crash sources after the snake_case fix are minimal, but two real crash sources remain:

1. **JSON.parse on malformed metadata** — if a row's `metadata` column has invalid JSON (e.g. truncated), `JSON.parse(row.metadata)` throws inside the IPC handler. Need a try/catch with a defensive fallback (log + return the raw string with a `_parseError: true` flag, or strip the row).

2. **`outcome` value outside the contract union** — older audit rows may have `outcome` strings like `'rate_limited'` that don't match the literal union. After the snake_case fix, the union is enforced at the type level but at runtime the IPC just passes the string through. The Detail Dialog renders `<dd>{detail.outcome}</dd>` — no crash, but if any renderer code does `outcome === 'rate_limited'` (it doesn't currently), it'd silently miss. Solution: normalize the runtime value via a small helper that maps unknown outcomes to 'ok'.

## Bug 3 — "EntityType filter doesn't actually filter"

**Root cause:** `src/main/db/audit.ts` SQL: `WHERE (@from IS NULL OR created_at >= @from) AND (@to IS NULL OR created_at <= @to) AND (@action IS NULL OR action = @action) AND (@userId IS NULL OR user_id = @userId)`. There's NO `entity_type` clause. The renderer's `audit.list` sends `entityType` but main ignores it. The filter UI looks like it works (selects an option) but the result list isn't filtered.

## Bug 4 — "Navbar not exist on Audit page"

Same as ProfileEditor — `Audit.tsx` doesn't mount `<SettingsSidebar />` while every other Settings page does. Add `<SettingsSidebar activeTab="audit" />` in the left rail.

## Scope (smallest working diff)

### 1. `src/main/ipc/audit.ts` — fix snake_case → camelCase mapping

Replace:
```ts
ipcMain.handle(IPC.AUDIT_LIST, (_e, raw) => {
  const filter = auditFilterInput.parse(raw ?? {});
  return auditRepo.list(filter);
});
```
With:
```ts
ipcMain.handle(IPC.AUDIT_LIST, (_e, raw) => {
  const filter = auditFilterInput.parse(raw ?? {});
  const { rows, total } = auditRepo.list(filter);
  // ponytail: map snake_case DB rows → camelCase IPC contract.
  // The audit_log table stores metadata as a JSON-encoded TEXT column
  // (nullable). Parse defensively — a corrupt row should NOT crash the
  // handler; fall back to the raw string with an `_parseError` flag so
  // the UI can surface "this row has malformed metadata" instead of the
  // whole audit page failing to load.
  return {
    rows: rows.map(toAuditEntry),
    total,
  };
});

function toAuditEntry(row: AuditListRow): AuditEntry {
  let metadata: Record<string, unknown> | null = null;
  if (row.metadata !== null) {
    try {
      const parsed = JSON.parse(row.metadata);
      metadata = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      metadata = { _parseError: true, _raw: row.metadata };
    }
  }
  // ponytail: clamp outcome to the contract union — older rows may have
  // unconstrained strings.
  const outcome: AuditEntry['outcome'] =
    row.outcome === 'failed' || row.outcome === 'rate_limited'
      ? row.outcome
      : 'ok';
  return {
    id: row.id,
    userId: row.user_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    metadata,
    outcome,
    createdAt: row.created_at,
  };
}
```

### 2. `src/main/db/audit.ts` — add `entityType` filter to SQL

- Extend `AuditListInput` type: `entityType?: string;`
- Update both `list` and `count` prepared statements to add `AND (@entityType IS NULL OR entity_type = @entityType)`.
- Pass `entityType` through `list.all({...})` and `count.get({...})`.

### 3. `src/main/ipc/audit.ts` — pass `entityType` through

The `safeParse(auditFilterInput, raw)` already extracts `entityType` per the validators (verified in `src/shared/validators.ts` line 162). Just make sure it's passed into `auditRepo.list(filter)` (it already is — `filter` is the full object).

### 4. `src/renderer/src/pages/Audit.tsx` — add SettingsSidebar + UI polish

Layout restructure:
```tsx
<div className="mx-auto grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
  <SettingsSidebar activeTab="audit" />
  <div className="flex flex-col gap-4">
    <header>...</header>
    <Card data-testid="audit-filter-card">...</Card>
    {error ? <Alert>...</Alert> : null}
    <Card>...</Card>
    <div>{t('audit.pageInfo', ...)}</div>
  </div>
</div>
```

Polish details (mirroring PatientProcedures from previous quick task):
- **Header**: tighter spacing, sticky breadcrumb-style "Settings → Audit" kicker
- **Filter card**: 5-column grid → single horizontal flex row (tighter); Apply + Clear buttons align right
- **Table**: sticky `<thead>` inside `max-h-[60vh] overflow-y-auto` container; hover:bg-slate-50 on rows; row key set to `row.id` (already there)
- **Entity column**: badge (not plain text) with color tokens (`bg-slate-100 text-slate-700` default, `bg-emerald-100 text-emerald-800` for backup.created, etc. — keep simple, don't add too many tokens)
- **Action column**: monospace text-sm (already there)
- **Empty state**: differentiate "no rows yet" vs "no rows match these filters" (already split per i18n)
- **Loading state**: skeleton rows (3 grey animate-pulse divs) instead of plain text + spinner
- **Detail Dialog**: max-w-3xl (not 2xl), tabs-like structure for the dl (Time/User/Action/Entity/Metadata)
- **Back button**: stays in header (existing pattern)

### 5. `src/renderer/src/i18n/{en,ar}/translation.json`

Reuse existing keys where possible. Add:
- `audit.errorTitle` — "Failed to load audit log"
- `audit.outcomes.ok` / `failed` / `rate_limited` — already shown via raw string, but a typed map for color tokens helps
- `audit.tooManyHint` — already exists

(Add to both EN + AR for parity.)

### 6. `tests/renderer/pages/Audit.test.tsx` — add tests for all 4 bugs

New cases (alongside the 5 existing):

1. **snake_case→camelCase mapping (Bug 1)** — override `api.audit.list` to return snake_case data (`user_id`, `entity_type`, `entity_id`, `metadata: '{"ip":"127.0.0.1"}'`, `created_at`). Render → assert time column has HH:MM:SS format (no NaN), user column shows 'Dr. Karim' (resolved name), entity column shows 'user <uuid>'.
2. **detail dialog renders parsed metadata (Bug 1)** — same setup, click row → assert `<pre>` shows pretty-printed `'ip'` not escaped JSON.
3. **malformed metadata doesn't crash (Bug 2.1)** — override list to return a row with `metadata: 'not-valid-json'` → click row → assert dialog opens (no crash) and shows the `_parseError` fallback.
4. **entityType filter actually filters (Bug 3)** — spy on `auditRepo.list` (main side), render Audit with entityType='backup', assert the IPC handler received the filter (already tested by mocking list). Better: assert the SQL was called with the right param. Since we can't easily test main-side SQL from renderer tests, add a NEW test in `tests/main/db/audit.test.ts` that seeds 3 rows with different entity_types, calls `auditRepo.list({entityType: 'backup'})`, asserts only backup rows return.
5. **SettingsSidebar mounts (Bug 4)** — render Audit → assert the sidebar button list mounts with `data-active="true"` on the Audit button.
6. **invalid outcome coerces to 'ok' (Bug 2.2)** — override list to return `outcome: 'something-weird'` → assert dialog renders 'ok' (or whatever the coerced value is).
7. **filter + clear + apply (UI polish)** — already covered by existing test, but add a test for "filter persists across re-render" — change filter, navigate away, come back → filter still applied (current page state is preserved).

### 7. New test: `tests/main/db/audit.test.ts`

End-to-end main-side test for entityType filter:
- Seed 3 audit rows with different entity_types (user, backup, patient).
- Call `auditRepo.list({entityType: 'backup'})` → assert only the backup row returns.
- Call `auditRepo.list({})` → assert all 3 return.

Plus a regression test for the JSON.parse defensive fallback in the IPC handler (covered indirectly by the renderer test #3 above — no main-side test needed for the mapping function itself since it's pure).

## Non-scope (do NOT touch)

- `useAudit.ts` — no changes (hook contract already correct).
- `useSession` — no changes.
- `Wizard.tsx`, `SettingsSidebar.tsx`, `SettingsHub.tsx` — no changes.
- The `metadata` JSON shape stored in audit_log — the IPC handler is tolerant of both new (Record) and old (potentially malformed string) formats.
- The existing 5 Audit tests stay green.

## Acceptance

- `npm run typecheck` clean (node + web)
- `npm run test:unit -- tests/renderer/pages/Audit.test.tsx tests/main/db/audit.test.ts` passes
- `npm run test:unit` — no new failures
- `npm run test:unit -- tests/renderer/i18n/parity.test.ts` passes (any new EN keys mirrored in AR)

## Style

Ponytail — reuse existing patterns:
- SettingsSidebar layout copied from PatientProcedures / SettingsCapture / SettingsUsers
- Status color tokens: Tailwind `bg-{color}-100 text-{color}-800` — NO new color tokens beyond what PatientProcedures uses (emerald-100/800, amber-100/800, blue-100/800, red-100/800, slate-100/800)
- Sticky table header: same `max-h-[60vh] overflow-y-auto` pattern as PatientProcedures
- Avatar initials: N/A (no avatar on Audit page)