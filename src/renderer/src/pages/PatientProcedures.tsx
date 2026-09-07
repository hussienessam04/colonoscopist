// PatientProcedures page — quick task 20260811 (polish + filters + new procedure).
//
// Replaces the Phase 7 accordion expansion that lived inside PatientsList
// with a dedicated page reachable from "View procedures" on PatientRow.
//
// Surface (per 20260811-polish plan):
//   - Header: kicker + h1 + Back button + [+ New Procedure] button.
//     The New button navigates to { name: 'procedure-preview', patientId }
//     and reuses the existing Phase 3-05 route — no router or main-side
//     change.
//   - Patient header Card: avatar with initials (derived from fullName,
//     no library) + name + MRN/DOB/gender as muted small text.
//   - Filter Card: text search + date range (native input type=date) +
//     status multi-select via Radix Popover + Checkbox list. Apply +
//     Clear buttons commit/reset the pending filter state. Mirrors the
//     PatientList filter UX (Apply is the commit gate; typing does
//     NOT auto-filter) but kept compact (single-row layout).
//   - Procedures Card: sticky thead inside a max-h-[60vh] scrollable
//     container; hover:bg-[#E6EFF1] rows; status badge tokens via
//     Tailwind utility classes (bg-emerald-100 / bg-amber-100 /
//     bg-blue-100 / bg-red-100) — NO new color tokens; ghost icon
//     buttons for actions; 3-row skeleton (animate-pulse divs) while
//     loading; differentiated empty state for "no match" vs "no
//     procedures yet".
//
// Filter logic (client-side only — `proceduresRepo.list` is untouched):
//   - text search matches procedure.id OR formatProcedureDate(startedAt)
//     (case-insensitive substring).
//   - dateFrom/To use Date.parse(from/To) (local midnight on a yyyy-mm-dd
//     input string). toMs += 86_400_000 for inclusive end per Phase 7
//     D-02 pattern.
//   - status filter is an empty = no constraint OR a subset of
//     ['completed','partial','recording','crashed'].
//
// ponytail: plain useState + useEffect — no SWR hook for the list since
// no shared state between pages; one-shot fetch on mount. useMemo on the
// filtered list is stdlib; clear/apply are committed state setters (no
// debounce needed — Apply commits the cutoff).

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, FileText, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import EmptyStateCard from '@/components/EmptyStateCard';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useRoute } from '@/lib/router';
import { safeInvoke } from '@/lib/ipc-result';
import { formatProcedureDate } from '@/lib/format';
import type { Patient, Procedure, ProcedureStatus, Report } from '@shared/ipc-contract';

type ProcedureWithReport = { procedure: Procedure; report: Report | null };

const STATUSES: readonly ProcedureStatus[] = [
  'completed',
  'partial',
  'recording',
  'crashed',
];

function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter((p) => p.length > 0);
  if (parts.length === 0) return '';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

function statusBadgeClass(status: ProcedureStatus): string {
  switch (status) {
    case 'completed':
      return 'bg-emerald-100 text-emerald-800 border-transparent';
    case 'partial':
      return 'bg-amber-100 text-amber-800 border-transparent';
    case 'recording':
      return 'bg-blue-100 text-blue-800 border-transparent';
    case 'crashed':
      return 'bg-red-100 text-red-800 border-transparent';
  }
}

function statusLabelKey(status: ProcedureStatus): string {
  switch (status) {
    case 'completed':
      return 'procedure.completedLabel';
    case 'partial':
      return 'procedure.partialLabel';
    case 'recording':
      return 'procedure.recordingLabel';
    case 'crashed':
      return 'procedure.crashedLabel';
  }
}

export default function PatientProcedures({ patientId }: { patientId: string }): JSX.Element {
  const { navigate } = useRoute();
  const { t } = useTranslation();

  const [patient, setPatient] = useState<Patient | null>(null);
  const [rows, setRows] = useState<ProcedureWithReport[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  // Plan 08-10 / G-08-4 — gate-rejected flag. When the patients.get or
  // procedures.list IPC returns {ok:false}, render the empty state
  // card instead of crashing on undefined destructure below.
  const [gated, setGated] = useState(false);

  // Real pagination (was: pageSize=200 once, no Next/Previous — silent
  // data loss above 200 procedures per patient).
  // ponytail: pageSize is a constant — no PageSizeSelector on this page.
  const PAGE_SIZE = 25;
  const [page, setPage] = useState(1);

  // Filter state — pending inputs are committed to "applied" only on Apply.
  const [pendingSearch, setPendingSearch] = useState('');
  const [pendingDateFrom, setPendingDateFrom] = useState('');
  const [pendingDateTo, setPendingDateTo] = useState('');
  const [pendingStatus, setPendingStatus] = useState<ProcedureStatus[]>([]);

  const [appliedSearch, setAppliedSearch] = useState('');
  const [appliedDateFrom, setAppliedDateFrom] = useState('');
  const [appliedDateTo, setAppliedDateTo] = useState('');
  const [appliedStatus, setAppliedStatus] = useState<ProcedureStatus[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        // Plan 08-10 / G-08-4 — branch on null (gate-rejection) before
        // destructuring the success shape.
        const p = await safeInvoke(window.api.patients.get(patientId));
        if (cancelled) return;
        if (p === null) {
          setGated(true);
          setLoading(false);
          return;
        }
        setPatient(p);
        // Real pagination — procedures.list already accepts page + pageSize.
        const procs = await safeInvoke(
          window.api.procedures.list({
            patientId,
            page,
            pageSize: PAGE_SIZE,
          }),
        );
        if (cancelled) return;
        if (procs === null) {
          setGated(true);
          setLoading(false);
          return;
        }
        // Parallel report lookup per procedure (null is valid — no
        // report exists yet for fresh recordings).
        const reports = await Promise.all(
          procs.rows.map((proc) =>
            window.api.reports.getByProcedure({ procedureId: proc.id }),
          ),
        );
        if (cancelled) return;
        setRows(
          procs.rows.map((procedure, idx) => ({
            procedure,
            report: reports[idx] ?? null,
          })),
        );
        setTotal(procs.total);
        setGated(false);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to load';
        toast.error(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId, page, PAGE_SIZE, navigate, t]);

  // Auto-clamp the page when total shrinks below the current page
  // (e.g. after deleting the last procedure on page 5).
  useEffect(() => {
    if (total === 0 && page !== 1) {
      setPage(1);
      return;
    }
    if (total > 0 && page > Math.ceil(total / PAGE_SIZE)) {
      setPage(Math.ceil(total / PAGE_SIZE));
    }
  }, [total, page]);

  const filteredRows = useMemo(() => {
    const searchTrim = appliedSearch.trim().toLowerCase();
    const fromMs = appliedDateFrom !== '' ? Date.parse(appliedDateFrom) : null;
    const toMs =
      appliedDateTo !== '' ? Date.parse(appliedDateTo) + 86_400_000 : null;
    return rows.filter(({ procedure }) => {
      if (searchTrim !== '') {
        const idMatch = procedure.id.toLowerCase().includes(searchTrim);
        const dateMatch = formatProcedureDate(procedure.startedAt)
          .toLowerCase()
          .includes(searchTrim);
        if (!idMatch && !dateMatch) return false;
      }
      if (fromMs !== null && procedure.startedAt < fromMs) return false;
      if (toMs !== null && procedure.startedAt > toMs) return false;
      if (appliedStatus.length > 0 && !appliedStatus.includes(procedure.status))
        return false;
      return true;
    });
  }, [rows, appliedSearch, appliedDateFrom, appliedDateTo, appliedStatus]);

  const filtersActive =
    appliedSearch.trim() !== '' ||
    appliedDateFrom !== '' ||
    appliedDateTo !== '' ||
    appliedStatus.length > 0;

  function togglePendingStatus(status: ProcedureStatus): void {
    setPendingStatus((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status],
    );
  }

  function handleApply(): void {
    setAppliedSearch(pendingSearch);
    setAppliedDateFrom(pendingDateFrom);
    setAppliedDateTo(pendingDateTo);
    setAppliedStatus(pendingStatus);
  }

  function handleClear(): void {
    setPendingSearch('');
    setPendingDateFrom('');
    setPendingDateTo('');
    setPendingStatus([]);
    setAppliedSearch('');
    setAppliedDateFrom('');
    setAppliedDateTo('');
    setAppliedStatus([]);
  }

  function statusTriggerLabel(): string {
    if (appliedStatus.length === 0) return t('patientProcedures.statusAll');
    return `${appliedStatus.length} / ${STATUSES.length}`;
  }

  function handleOpenProcedure(procedureId: string): void {
    navigate({ name: 'procedure-review', procedureId });
  }

  async function handleOpenReport(reportId: string): Promise<void> {
    try {
      await window.api.reports.openPdf({ id: reportId, reveal: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to open PDF';
      toast.error(msg);
    }
  }

  const initials = patient !== null ? deriveInitials(patient.fullName) : '';

  // ponytail: empty results collapse to 0 pages instead of the misleading
  // "Page 1 of 1" — the range footer falls back to "No procedures" copy.
  const totalPages = total === 0 ? 0 : Math.ceil(total / PAGE_SIZE);
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

  return (
    <main className="min-h-screen bg-[#F7F1E6] p-6 font-sans text-[#13202E]">
      <div className="mx-auto max-w-6xl flex flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E0D9C6] pb-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8C8478]">
              {t('patientProcedures.pageKicker')}
            </p>
            <h1 className="text-2xl font-medium tracking-tight text-[#13202E]">
              {t('patientProcedures.pageTitle')}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => navigate({ name: 'patients' })}
              data-testid="patient-procedures-back"
              className="border-[#E0D9C6] bg-white text-[#5C6770] hover:border-[#0E3A47] hover:bg-[#E6EFF1] hover:text-[#0E3A47]"
            >
              <ArrowLeft className="size-4 mr-1" aria-hidden="true" />
              {t('patientProcedures.backToList')}
            </Button>
            <Button
              variant="default"
              onClick={() =>
                navigate({ name: 'procedure-preview', patientId })
              }
              title={t('patientProcedures.newProcedureTooltip')}
              data-testid="patient-procedures-new"
              className="bg-[#0E3A47] text-white hover:bg-[#0B2C36]"
            >

              {t('patientProcedures.newProcedure')}
            </Button>
          </div>
        </header>

        {gated ? (
          <EmptyStateCard />
        ) : null}

        <Card
          data-testid="patient-procedures-header"
          className="border-[#E0D9C6] bg-[#FBF7EE] shadow-[0_1px_2px_rgba(19,32,46,0.04),0_8px_24px_-12px_rgba(19,32,46,0.12)]"
        >
          <CardContent className="flex items-center gap-4 py-4">
            <div
              className="size-12 shrink-0 rounded-full bg-[#E6EFF1] text-[#0E3A47] flex items-center justify-center font-semibold text-lg"
              data-testid="patient-procedures-avatar"
              aria-hidden="true"
            >
              {initials}
            </div>
            <div className="flex flex-col gap-1 min-w-0">
              <h2 className="text-lg font-semibold truncate">
                {patient === null
                  ? t('patientProcedures.loadingPatient')
                  : patient.fullName}
              </h2>
              {patient !== null ? (
                <p className="text-sm text-[#5C6770] flex flex-wrap gap-x-5 gap-y-1">
                  <span>
                    <span className="font-medium text-foreground">
                      {t('patient.mrnExact')}:
                    </span>{' '}
                    {patient.mrn}
                  </span>
                  <span>
                    <span className="font-medium text-foreground">DOB:</span>{' '}
                    {patient.dob}
                  </span>
                  <span>
                    <span className="font-medium text-foreground">Gender:</span>{' '}
                    {patient.gender ?? '—'}
                  </span>
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card className="border-[#E0D9C6] bg-[#FBF7EE] shadow-[0_1px_2px_rgba(19,32,46,0.04),0_8px_24px_-12px_rgba(19,32,46,0.12)]">
          <CardContent className="py-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[180px]">
                <Search
                  className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-[#5C6770] pointer-events-none"
                  aria-hidden="true"
                />
                <Input
                  className="pl-8 bg-[#FBF7EE] border-[#E0D9C6] text-[#13202E] placeholder:text-[#A39A86] hover:border-[#A8C5B5] focus:border-[#0E3A47] focus:bg-white focus:ring-1 focus:ring-[#0E3A47]/30"
                  placeholder={t('patientProcedures.searchPlaceholder')}
                  value={pendingSearch}
                  onChange={(e) => setPendingSearch(e.target.value)}
                  data-testid="patient-procedures-search"
                />
              </div>
              <input
                type="date"
                value={pendingDateFrom}
                onChange={(e) => setPendingDateFrom(e.target.value)}
                aria-label={t('patient.filtersDateFrom')}
                data-testid="patient-procedures-date-from"
                className="h-10 rounded-md border border-[#E0D9C6] bg-[#FBF7EE] px-3 text-sm text-[#13202E] hover:border-[#A8C5B5] focus-visible:outline-none focus-visible:border-[#0E3A47] focus-visible:ring-1 focus-visible:ring-[#0E3A47]/30"
              />
              <input
                type="date"
                value={pendingDateTo}
                onChange={(e) => setPendingDateTo(e.target.value)}
                aria-label={t('patient.filtersDateTo')}
                data-testid="patient-procedures-date-to"
                className="h-10 rounded-md border border-[#E0D9C6] bg-[#FBF7EE] px-3 text-sm text-[#13202E] hover:border-[#A8C5B5] focus-visible:outline-none focus-visible:border-[#0E3A47] focus-visible:ring-1 focus-visible:ring-[#0E3A47]/30"
              />
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="min-w-[140px] justify-between border-[#E0D9C6] bg-white text-[#5C6770] hover:border-[#0E3A47] hover:bg-[#E6EFF1] hover:text-[#0E3A47]"
                    data-testid="patient-procedures-status"
                  >
                    <span className="truncate">{statusTriggerLabel()}</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-56 p-2"
                  align="end"
                  data-testid="patient-procedures-status-menu"
                >
                  <div className="flex flex-col gap-1">
                    {STATUSES.map((status) => {
                      const checked = pendingStatus.includes(status);
                      return (
                        <label
                          key={status}
                          className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-pointer hover:bg-[#E6EFF1]"
                          data-testid={`patient-procedures-status-option-${status}`}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => togglePendingStatus(status)}
                            data-testid={`patient-procedures-status-${status}`}
                          />
                          <span>{t(statusLabelKey(status))}</span>
                        </label>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
              <div className="flex items-center gap-2 ml-auto">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClear}
                  data-testid="patient-procedures-clear"
                  className="border-[#E0D9C6] bg-white text-[#5C6770] hover:border-[#0E3A47] hover:bg-[#E6EFF1] hover:text-[#0E3A47]"
                >
                  {t('patientProcedures.clearFilters')}
                </Button>
                <Button
                  size="sm"
                  onClick={handleApply}
                  data-testid="patient-procedures-apply"
              className="bg-[#0E3A47] text-white hover:bg-[#0B2C36]"
            >
              <Plus className="size-4 mr-1" aria-hidden="true" />
              {t('patientProcedures.newProcedure')}
            </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-[#E0D9C6] bg-[#FBF7EE] shadow-[0_1px_2px_rgba(19,32,46,0.04),0_8px_24px_-12px_rgba(19,32,46,0.12)]">
          <CardContent className="p-0">
            <div className="max-h-[60vh] overflow-y-auto border border-[#E0D9C6]">
              <table className="w-full">
                <thead className="sticky top-0 bg-[#FBF7EE] z-10 shadow-[0_1px_0_0_hsl(var(--border))]">
                  <tr className="border-b text-left text-xs uppercase text-[#8C8478]">
                    <th className="px-3 py-2 bg-[#FBF7EE] text-[#8C8478] text-xs uppercase tracking-[0.18em]">
                      {t('patientProcedures.columnStarted')}
                    </th>
                    <th className="px-3 py-2 bg-[#FBF7EE] text-[#8C8478] text-xs uppercase tracking-[0.18em]">
                      {t('patientProcedures.columnStatus')}
                    </th>
                    <th className="px-3 py-2 bg-[#FBF7EE] text-[#8C8478] text-xs uppercase tracking-[0.18em]">
                      {t('patientProcedures.columnDuration')}
                    </th>
                    <th className="px-3 py-2 bg-[#FBF7EE] text-[#8C8478] text-xs uppercase tracking-[0.18em]">
                      {t('patientProcedures.columnReport')}
                    </th>
                    <th className="px-3 py-2 bg-[#FBF7EE] text-[#8C8478] text-xs uppercase tracking-[0.18em] text-right">
                      {t('patientProcedures.columnActions')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr data-testid="patient-procedures-skeleton-row">
                      <td colSpan={5} className="px-3 py-3">
                        <div className="flex flex-col gap-2">
                          <div className="h-6 rounded bg-[#E0D9C6]/60 animate-pulse" />
                          <div className="h-6 rounded bg-[#E0D9C6]/60 animate-pulse" />
                          <div className="h-6 rounded bg-[#E0D9C6]/60 animate-pulse" />
                        </div>
                      </td>
                    </tr>
                  ) : filteredRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-3 py-8 text-center text-sm text-[#5C6770]"
                        data-testid={
                          filtersActive
                            ? 'patient-procedures-empty-filtered'
                            : 'patient-procedures-empty'
                        }
                      >
                        {filtersActive && rows.length > 0 ? (
                          <div className="flex flex-col gap-1 items-center">
                            <span>{t('patientProcedures.noMatchFilters')}</span>
                            <span className="text-xs">
                              {t('patientProcedures.clearFiltersHint')}
                            </span>
                          </div>
                        ) : (
                          t('patientProcedures.proceduresEmpty')
                        )}
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map(({ procedure, report }) => (
                      <tr
                        key={procedure.id}
                        className="border-b border-[#E0D9C6] last:border-b-0 hover:bg-[#E6EFF1]"
                        data-testid={`patient-procedure-row-${procedure.id}`}
                      >
                        <td className="px-3 py-2 text-sm">
                          {formatProcedureDate(procedure.startedAt)}
                        </td>
                        <td className="px-3 py-2 text-sm">
                          <Badge
                            className={statusBadgeClass(procedure.status)}
                            data-testid={`patient-procedure-status-${procedure.id}`}
                          >
                            {t(statusLabelKey(procedure.status))}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-sm text-[#5C6770]">
                          {t('patientProcedures.minutesShort', {
                            count: Math.round(procedure.durationSeconds / 60),
                          })}
                        </td>
                        <td className="px-3 py-2 text-sm">
                          {report !== null ? (
                            <Badge
                              className={
                                report.status === 'finalized'
                                  ? 'bg-emerald-100 text-emerald-800 border-transparent'
                                  : 'bg-slate-100 text-slate-700 border-transparent'
                              }
                              data-testid={`patient-procedure-report-status-${procedure.id}`}
                            >
                              {report.status === 'finalized'
                                ? t('patient.reportStatusFinalized')
                                : t('patient.reportStatusDraft')}
                            </Badge>
                          ) : (
                            <span
                              className="text-xs text-[#5C6770]"
                              data-testid={`patient-procedure-no-report-${procedure.id}`}
                            >
                              {t('patientProcedures.noReport')}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleOpenProcedure(procedure.id)}
                              data-testid={`patient-procedure-open-${procedure.id}`}
                              className="text-[#5C6770] hover:bg-[#E6EFF1] hover:text-[#0E3A47]"
                            >
                              {t('patientProcedures.openProcedure')}
                            </Button>
                            {report !== null && report.pdfPath !== null ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void handleOpenReport(report.id)}
                                data-testid={`patient-procedure-open-pdf-${procedure.id}`}
                                className="text-[#5C6770] hover:bg-[#E6EFF1] hover:text-[#0E3A47]"
                              >
                                <FileText className="size-3.5 mr-1" aria-hidden="true" />
                                {t('patientProcedures.openPdf')}
                              </Button>
                            ) : null}
                          </div>
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
          <span
            className="text-[#5C6770]"
            data-testid="patient-procedures-pagination-range"
          >
            {total === 0
              ? t('patientProcedures.paginationRangeEmpty')
              : total === 1
                ? t('patientProcedures.paginationRangeOne')
                : t('patientProcedures.paginationRange', {
                    start: rangeStart,
                    end: rangeEnd,
                    total,
                  })}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              data-testid="patient-procedures-prev"
              className="border-[#E0D9C6] bg-white text-[#5C6770] hover:border-[#0E3A47] hover:bg-[#E6EFF1] hover:text-[#0E3A47]"
            >
              {t('common.previous')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              data-testid="patient-procedures-next"
              className="border-[#E0D9C6] bg-white text-[#5C6770] hover:border-[#0E3A47] hover:bg-[#E6EFF1] hover:text-[#0E3A47]"
            >
              {t('common.next')}
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}
