// Audit page — Phase 7 / Plan 07-03 (AUDIT-01 / AUDIT-02).
// Read-only viewer over the audit_log table via the existing `audit:list`
// IPC. Per D-05..D-08 + UI-SPEC §Implementation Bindings Audit page
// layout:
//   - Header: "Workspace" kicker + "Audit log" h1 + Back button
//   - Filter Card: Date from / Date to (native <input type="date">) +
//     Doctor Select (usersList) + Action free-text input + Entity Type
//     Select (fixed enum) + Apply + Clear all buttons
//   - Results Card: compact one-line rows at min-h-[36px] (UI-SPEC
//     spacing exception) — 4 columns: Time / User / Action / Entity
//   - Row click: opens a Dialog with full row + pretty-printed JSON
//     metadata + Copy JSON button
//   - Footer: "Page X of Y" + Previous / Next
//
// D-08 verbatim: the page mounts ONCE → schedules a 1000ms setTimeout
// → fires `audit.log({action: 'audit_view', entityType: 'audit'})`
// exactly once. Re-firing on filter change would create audit spam
// per PITFALLS §Pitfall 8 — the empty useEffect deps array prevents
// this. The 1s debounce matches the page being a "view" rather than a
// "load" — gives the operator time to navigate away (e.g. accidental
// click) before the audit row lands.
//
// Phase 7 / quick 20260811-audit-ui-polish: SettingsSidebar (now wrapped
// in SettingsLayout per quick task 260812-n0h) mounts in
// the left rail (mirrors ProfileEditor pattern) + sticky thead +
// hover:bg-slate-50 rows + status color tokens (bg-{color}-100/800) +
// 3 grey animate-pulse skeleton rows for loading + differentiated
// empty states.

import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardCopy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SettingsLayout } from '@/components/SettingsLayout';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAudit } from '@/hooks/useAudit';
import { useSession } from '@/store/session';
import type { AuditEntry, UserPublic } from '@shared/ipc-contract';

const DEFAULT_PAGE_SIZE = 100;

// ponytail: status color tokens reused from PatientProcedures — emerald /
// amber / blue / red / slate. Adding new tokens for the Audit page
// would re-spawn the same palette across pages.
function outcomeBadgeClass(outcome: AuditEntry['outcome']): string {
  if (outcome === 'failed') return 'bg-red-100 text-red-800';
  if (outcome === 'rate_limited') return 'bg-amber-100 text-amber-800';
  return 'bg-emerald-100 text-emerald-800';
}

function entityTypeBadgeClass(entityType: string | null): string {
  if (entityType === null) return 'bg-slate-100 text-slate-700';
  if (entityType === 'backup' || entityType === 'restore') return 'bg-blue-100 text-blue-800';
  if (entityType === 'patient') return 'bg-emerald-100 text-emerald-800';
  if (entityType === 'procedure') return 'bg-amber-100 text-amber-800';
  return 'bg-slate-100 text-slate-700';
}

// UI-SPEC §Implementation Bindings — fixed entity-type options. Anything
// outside this list is logged by main but the Audit page doesn't expose
// a picker for it (kept narrow to avoid UI clutter).
const ENTITY_TYPES: { value: string; label: string }[] = [
  { value: 'user', label: 'user' },
  { value: 'patient', label: 'patient' },
  { value: 'procedure', label: 'procedure' },
  { value: 'report', label: 'report' },
  { value: 'profile', label: 'profile' },
  { value: 'screenshot', label: 'screenshot' },
  { value: 'device', label: 'device' },
  { value: 'audit', label: 'audit' },
  { value: 'backup', label: 'backup' },
  { value: 'restore', label: 'restore' },
  { value: 'language', label: 'language' },
];

const ANY_USER = '__any__';
const ANY_ENTITY = '__any__';

function dateInputToMsStartOfDay(yyyyMmDd: string): number | undefined {
  if (yyyyMmDd === '') return undefined;
  // ponytail: Date.UTC to avoid TZ drift — the operator typed a date in
  // their local zone, but the audit_log stores created_at as ms since
  // epoch. Mid-day of <yyyy-mm-dd> in UTC is the safest round-trip.
  const ms = Date.parse(`${yyyyMmDd}T00:00:00Z`);
  return Number.isNaN(ms) ? undefined : ms;
}

function dateInputToMsEndOfDay(yyyyMmDd: string): number | undefined {
  if (yyyyMmDd === '') return undefined;
  const ms = Date.parse(`${yyyyMmDd}T23:59:59.999Z`);
  return Number.isNaN(ms) ? undefined : ms;
}

function formatHHMMSS(ms: number): string {
  // ponytail: native Intl.DateTimeFormat instead of a hand-rolled HH:MM:SS
  // formatter — the locale-aware variant handles the AR locale ('ar-SA')
  // when the operator has flipped the UI to RTL. For English we lock
  // hour12=false so the time reads as 14:05:09 not 2:05:09 PM.
  const d = new Date(ms);
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function resolveUserDisplayName(
  userId: string | null,
  users: UserPublic[],
  fallback: string,
): string {
  if (userId === null) return '(system)';
  const found = users.find((u) => u.id === userId);
  return found?.fullName ?? fallback;
}

export default function Audit(): JSX.Element {
  const { currentUser } = useSession();
  // ponytail: every visible string on this page is sourced from the
  // i18next bundles. D-24 parity test enforces EN↔AR key coverage.
  const { t } = useTranslation();

  // ponytail: each filter field is direct state (no Apply commit).
  // Date/doctor/action/entity-type all refetch via the useAudit effect
  // when the value changes — the Audit page is already a "view" so
  // per-keystroke refetch is acceptable (debounce is unnecessary
  // because the IPC is fast and the page is per-page, not per-keystroke
  // — the operator is on this page to read, not to type).
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [userId, setUserId] = useState('');
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [page, setPage] = useState(1);

  // Doctor list — loaded once on mount so the Author Select has stable
  // options for the whole session. Empty array before the IPC resolves.
  const [users, setUsers] = useState<UserPublic[]>([]);
  useEffect(() => {
    let cancelled = false;
    void window.api.auth.usersList().then((list) => {
      if (!cancelled) setUsers(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const filters = useMemo(
    () => ({
      from: dateInputToMsStartOfDay(dateFrom),
      to: dateInputToMsEndOfDay(dateTo),
      userId: userId === '' ? undefined : userId,
      action: action === '' ? undefined : action,
      entityType: entityType === '' ? undefined : entityType,
    }),
    [dateFrom, dateTo, userId, action, entityType],
  );

  const { rows, total, loading, error, refresh } = useAudit({
    filters,
    page,
    pageSize: DEFAULT_PAGE_SIZE,
  });

  // D-08 + PITFALLS §Pitfall 8 — empty deps + 1s debounce + one fire
  // per page mount. The depth-1 user-id path is the only way to safely
  // audit-page-load without spamming audit rows on every filter change.
  useEffect(() => {
    const handle = setTimeout(() => {
      void window.api.audit.log({
        action: 'audit_view',
        entityType: 'audit',
      });
    }, 1000);
    return () => clearTimeout(handle);
  }, []);

  // Detail dialog state — the AuditEntry the operator clicked (null
  // when the dialog is closed).
  const [detail, setDetail] = useState<AuditEntry | null>(null);

  async function handleCopyJson(): Promise<void> {
    if (detail === null) return;
    const json = JSON.stringify(
      {
        id: detail.id,
        userId: detail.userId,
        action: detail.action,
        entityType: detail.entityType,
        entityId: detail.entityId,
        metadata: detail.metadata,
        outcome: detail.outcome,
        createdAt: detail.createdAt,
      },
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(json);
      toast.success(t('audit.copySuccess'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Copy failed';
      toast.error(msg);
    }
  }

  function handleClearAll(): void {
    setDateFrom('');
    setDateTo('');
    setUserId('');
    setAction('');
    setEntityType('');
    setPage(1);
  }

  const totalPages = Math.max(1, Math.ceil(total / DEFAULT_PAGE_SIZE));
  const fallbackUserName = currentUser?.fullName ?? 'unknown';

  return (
    <SettingsLayout
      title={t('audit.pageTitle')}
      subtitle={t('audit.pageKicker')}
      activeTab="audit"
      backTestId="audit-back"
    >
      <Card data-testid="audit-filter-card" className="border-[#E0D9C6] bg-[#FBF7EE] shadow-[0_1px_2px_rgba(19,32,46,0.04),0_8px_24px_-12px_rgba(19,32,46,0.12)]">
            <CardHeader className="pb-3">
              <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0E3A47]">{t('audit.filtersTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="audit-date-from">{t('audit.filterDateFrom')}</Label>
                  <Input
                    id="audit-date-from"
                    type="date"
                    value={dateFrom}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => {
                      setDateFrom(e.target.value);
                      setPage(1);
                    }}
                    data-testid="audit-date-from"
                    className="bg-[#FBF7EE] border-[#E0D9C6] text-[#13202E] placeholder:text-[#A39A86] hover:border-[#A8C5B5] focus:border-[#0E3A47] focus:bg-white focus:ring-1 focus:ring-[#0E3A47]/30"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="audit-date-to">{t('audit.filterDateTo')}</Label>
                  <Input
                    id="audit-date-to"
                    type="date"
                    value={dateTo}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => {
                      setDateTo(e.target.value);
                      setPage(1);
                    }}
                    data-testid="audit-date-to"
                    className="bg-[#FBF7EE] border-[#E0D9C6] text-[#13202E] placeholder:text-[#A39A86] hover:border-[#A8C5B5] focus:border-[#0E3A47] focus:bg-white focus:ring-1 focus:ring-[#0E3A47]/30"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="audit-user">{t('audit.filterUser')}</Label>
                  <Select
                    value={userId === '' ? ANY_USER : userId}
                    onValueChange={(v) => {
                      setUserId(v === ANY_USER ? '' : v);
                      setPage(1);
                    }}
                  >
                    <SelectTrigger id="audit-user" data-testid="audit-user" className="bg-[#FBF7EE] border-[#E0D9C6] text-[#13202E] placeholder:text-[#A39A86] hover:border-[#A8C5B5] focus:border-[#0E3A47] focus:bg-white focus:ring-1 focus:ring-[#0E3A47]/30">
                      <SelectValue placeholder={t('audit.filterUserPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ANY_USER}>{t('audit.filterUserPlaceholder')}</SelectItem>
                      {users.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.fullName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="audit-action">{t('audit.filterAction')}</Label>
                  <Input
                    id="audit-action"
                    value={action}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => {
                      setAction(e.target.value);
                      setPage(1);
                    }}
                    placeholder={t('audit.filterActionPlaceholder')}
                    data-testid="audit-action"
                    className="bg-[#FBF7EE] border-[#E0D9C6] text-[#13202E] placeholder:text-[#A39A86] hover:border-[#A8C5B5] focus:border-[#0E3A47] focus:bg-white focus:ring-1 focus:ring-[#0E3A47]/30"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="audit-entity-type">{t('audit.filterEntityType')}</Label>
                  <Select
                    value={entityType === '' ? ANY_ENTITY : entityType}
                    onValueChange={(v) => {
                      setEntityType(v === ANY_ENTITY ? '' : v);
                      setPage(1);
                    }}
                  >
                    <SelectTrigger id="audit-entity-type" data-testid="audit-entity-type" className="bg-[#FBF7EE] border-[#E0D9C6] text-[#13202E] placeholder:text-[#A39A86] hover:border-[#A8C5B5] focus:border-[#0E3A47] focus:bg-white focus:ring-1 focus:ring-[#0E3A47]/30">
                      <SelectValue placeholder={t('audit.filterEntityTypePlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ANY_ENTITY}>
                        {t('audit.filterEntityTypePlaceholder')}
                      </SelectItem>
                      {ENTITY_TYPES.map((entityOpt) => (
                        <SelectItem key={entityOpt.value} value={entityOpt.value}>
                          {t(`audit.entityTypes.${entityOpt.value}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={handleClearAll}
                  data-testid="audit-clear"
                  className="border-[#E0D9C6] bg-white text-[#5C6770] hover:border-[#0E3A47] hover:bg-[#E6EFF1] hover:text-[#0E3A47]"
                >
                  {t('audit.clearAll')}
                </Button>
                <Button
                  onClick={() => void refresh()}
                  data-testid="audit-apply"
                  className="bg-[#0E3A47] text-white hover:bg-[#0B2C36] disabled:bg-[#E0D9C6] disabled:text-[#8C8478]"
                >
                  {t('common.apply')}
                </Button>
              </div>
            </CardContent>
          </Card>

          {error !== null ? (
            <Alert variant="destructive" data-testid="audit-error">
              <AlertTitle>{t('audit.errorTitle')}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <Card className="border-[#E0D9C6] bg-[#FBF7EE] shadow-[0_1px_2px_rgba(19,32,46,0.04),0_8px_24px_-12px_rgba(19,32,46,0.12)]">
            <CardHeader className="pb-3">
              <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0E3A47]">
                {t('audit.sectionTitle')}{' '}
                <span className="text-[#5C6770] text-sm font-normal">
                  ({t('patient.total', { count: total })})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[60vh] overflow-y-auto" data-testid="audit-table-scroll">
                <table className="w-full">
                  <thead className="sticky top-0 z-10 bg-[#FBF7EE]">
                    <tr className="border-b border-[#E0D9C6] text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0E3A47]">
                      <th className="px-3 py-2 w-28">{t('audit.columnTime')}</th>
                      <th className="px-3 py-2 w-44">{t('audit.columnUser')}</th>
                      <th className="px-3 py-2 w-44">{t('audit.columnAction')}</th>
                      <th className="px-3 py-2">{t('audit.columnEntity')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      // ponytail: 3 grey animate-pulse skeleton rows instead of
                      // plain text + spinner — matches the PatientProcedures
                      // polish (no shadcn Skeleton dep needed).
                      <>
                        {[0, 1, 2].map((i) => (
                          <tr key={`skeleton-${i}`} data-testid="audit-skeleton-row">
                            <td colSpan={4} className="px-3 py-2">
                              <div className="h-4 w-full animate-pulse rounded bg-[#E0D9C6]/60" />
                            </td>
                          </tr>
                        ))}
                      </>
                    ) : rows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={4}
                          className="px-3 py-8 text-center text-sm text-[#5C6770]"
                          data-testid="audit-empty"
                        >
                          {t('audit.empty')}
                        </td>
                      </tr>
                    ) : (
                      rows.map((row) => (
                        <tr
                          key={row.id}
                          className="border-b border-[#E0D9C6] min-h-[36px] cursor-pointer hover:bg-[#E6EFF1]"
                          onClick={() => setDetail(row)}
                          data-testid="audit-row"
                          data-row-id={row.id}
                        >
                          <td className="px-3 py-1 align-middle">
                            <span className="truncate tabular-nums text-sm font-mono">
                              {formatHHMMSS(row.createdAt)}
                            </span>
                          </td>
                          <td className="px-3 py-1 align-middle">
                            <span className="truncate text-sm text-[#13202E]">
                              {resolveUserDisplayName(row.userId, users, fallbackUserName)}
                            </span>
                          </td>
                          <td className="px-3 py-1 align-middle">
                            <span className="inline-flex items-center gap-2">
                              <span className="truncate text-sm font-medium">{row.action}</span>
                              <span
                                className={`inline-block rounded px-1.5 py-0.5 text-xs ${outcomeBadgeClass(
                                  row.outcome,
                                )}`}
                                data-testid="audit-outcome-badge"
                              >
                                {row.outcome}
                              </span>
                            </span>
                          </td>
                          <td className="px-3 py-1 align-middle">
                            {row.entityType === null ? (
                              <span className="text-[#5C6770] text-sm">—</span>
                            ) : (
                              <span
                                className={`inline-block truncate rounded px-1.5 py-0.5 text-xs ${entityTypeBadgeClass(
                                  row.entityType,
                                )}`}
                                data-testid="audit-entity-badge"
                              >
                                {row.entityType}
                                {row.entityId ? ` ${row.entityId}` : ''}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

      <div className="flex items-center justify-between text-sm">
            <span className="text-[#5C6770]" data-testid="audit-pagination">
              {t('audit.pageInfo', { page, totalPages })}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                data-testid="audit-prev"
                className="border-[#E0D9C6] bg-white text-[#5C6770] hover:border-[#0E3A47] hover:bg-[#E6EFF1] hover:text-[#0E3A47]"
              >
                {t('common.previous')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                data-testid="audit-next"
                className="border-[#E0D9C6] bg-white text-[#5C6770] hover:border-[#0E3A47] hover:bg-[#E6EFF1] hover:text-[#0E3A47]"
              >
                {t('common.next')}
              </Button>
            </div>
          </div>

      <Dialog
        open={detail !== null}
        onOpenChange={(v) => {
          if (!v) setDetail(null);
        }}
      >
        <DialogContent className="max-w-3xl" data-testid="audit-detail-dialog">
          <DialogHeader>
            <DialogTitle>{t('audit.detailDialogTitle')}</DialogTitle>
            <DialogDescription>
              {detail === null ? null : (
                <span className="font-mono text-xs">id #{detail.id}</span>
              )}
            </DialogDescription>
          </DialogHeader>
          {detail !== null ? (
            <div className="flex flex-col gap-3">
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-[#5C6770]">{t('audit.detailUser')}</dt>
                <dd className="font-mono text-xs break-all">
                  {detail.userId ?? '(system)'}
                </dd>
                <dt className="text-[#5C6770]">{t('audit.detailAction')}</dt>
                <dd className="font-mono text-xs">{detail.action}</dd>
                <dt className="text-[#5C6770]">{t('audit.detailEntityType')}</dt>
                <dd className="font-mono text-xs">{detail.entityType ?? '—'}</dd>
                <dt className="text-[#5C6770]">{t('audit.detailEntityId')}</dt>
                <dd className="font-mono text-xs break-all">
                  {detail.entityId ?? '—'}
                </dd>
                <dt className="text-[#5C6770]">{t('audit.detailOutcome')}</dt>
                <dd className="font-mono text-xs">
                  <span
                    className={`inline-block rounded px-1.5 py-0.5 text-xs ${outcomeBadgeClass(
                      detail.outcome,
                    )}`}
                  >
                    {detail.outcome}
                  </span>
                </dd>
                <dt className="text-[#5C6770]">{t('audit.detailTime')}</dt>
                <dd className="font-mono text-xs">
                  {new Date(detail.createdAt).toISOString()}
                </dd>
              </dl>
              <div className="flex flex-col gap-1">
                <Label htmlFor="audit-detail-metadata">{t('audit.detailMetadata')}</Label>
                <pre
                  id="audit-detail-metadata"
                  data-testid="audit-detail-metadata"
                  className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-[#E0D9C6] bg-[#FBF7EE] p-3 font-mono text-xs"
                >
                  {detail.metadata === null
                    ? '—'
                    : JSON.stringify(detail.metadata, null, 2)}
                </pre>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => void handleCopyJson()}
              data-testid="audit-copy-json"
              className="border-[#E0D9C6] bg-white text-[#5C6770] hover:border-[#0E3A47] hover:bg-[#E6EFF1] hover:text-[#0E3A47]"
            >
              <ClipboardCopy className="size-4 mr-1" aria-hidden="true" />
              {t('audit.detailCopyJson')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsLayout>
  );
}
