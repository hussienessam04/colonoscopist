// Patient List — default landing after login.
// Per PAT-02 + PAT-04: search + MRN exact + show-deleted toggle + page-size + soft-delete.
// Per Fix 6: every patients.list call writes a patient_list audit row in main.
// Per Plan 03-04 (G-03-1 / G-03-2): header Settings is a DropdownMenu so every
// authenticated doctor reaches the existing Settings → Capture page; Users stays
// admin-gated via currentUser.isFirstAdmin.
// Per Plan 03-05 (G-03-3): the DropdownMenu was replaced with a single Button
// that opens the new SettingsHub page; per-section admin gating now lives on
// the hub's sidebar.
//
// Quick task 20260811 — PatientList filter sidebar + per-row accordion
// expansion were reverted; procedures surface moved to a dedicated page
// reached from the patient row dropdown.
//
// Quick task 20260811-patients-list-polish — refined visual density:
//   - Header: "PATIENTS" kicker + ghost icon-only Settings + prominent
//     `size="lg"` New Patient
//   - Search surface collapsed into a single horizontal flex row
//     (no outer Card wrapper) — matches Phase 7 RESEARCH.md Pattern 1
//   - Active filter chips (search / MRN) render below the row when set;
//     click × clears that filter
//   - Results: sticky thead inside max-h-[60vh] + hover:bg-[#E6EFF1] rows
//     + 3 grey animate-pulse skeleton rows for loading (no shadcn Skeleton
//     dep — same pattern as Audit + PatientProcedures)
//   - Empty state differentiates "no patients yet" (with CTA → patient-new)
//     vs "no patients match filters"
//   - Pagination footer uses "Showing {start}-{end} of {total}" format

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Search, Settings as SettingsIcon, UserPlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import EmptyStateCard from '@/components/EmptyStateCard';
import PageSizeSelector from '@/components/PageSizeSelector';
import PatientRow from '@/components/PatientRow';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useRoute } from '@/lib/router';
import { useSession } from '@/store/session';
import { safeInvoke } from '@/lib/ipc-result';
import { toast } from 'sonner';
import type { Patient } from '@shared/ipc-contract';

const DEBOUNCE_MS = 250;

export default function PatientsList(): JSX.Element {
  const { navigate } = useRoute();
  const { currentUser } = useSession();
  // ponytail: useTranslation is the standard react-i18next hook.
  // The Patient List page has the most visible strings on the app —
  // every label, button, and empty-state copy is sourced from the
  // bundles. The D-24 parity test (tests/renderer/i18n/parity.test.ts)
  // enforces that every key added here has a matching AR value.
  const { t } = useTranslation();
  const [rows, setRows] = useState<Patient[]>([]);
  const [total, setTotal] = useState(0);
  // Phase 2 surface — search + MRN are direct state that debounce-refetch
  // (per Phase 2 PAT-02 / PAT-04 behavior preserved).
  const [search, setSearch] = useState('');
  const [mrn, setMrn] = useState('');
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<Patient | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Plan 08-10 / G-08-4 — gate-rejected flag. When the IPC returns the
  // {ok:false, code: 'IPC_LICENSE_*'} shape, we render <EmptyStateCard>
  // instead of crashing on a missing rows/total destructure.
  const [gated, setGated] = useState(false);

  // Phase 2 — debounce refetch on the search + MRN inputs only.
  useEffect(() => {
    const handle = setTimeout(() => {
      void refetch();
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, mrn, includeDeleted, page, pageSize]);

  // Auto-clamp the page when total shrinks below the current page
  // (e.g. after deleting the last patient on page 5). Without this,
  // the table is empty and Previous is the only way out.
  useEffect(() => {
    if (total === 0 && page !== 1) {
      setPage(1);
      return;
    }
    if (total > 0 && page > Math.ceil(total / pageSize)) {
      setPage(Math.ceil(total / pageSize));
    }
  }, [total, pageSize, page]);

  async function refetch(): Promise<void> {
    setLoading(true);
    const res = await safeInvoke(
      window.api.patients.list({
        search: search || undefined,
        mrn: mrn || undefined,
        includeDeleted,
        page,
        pageSize,
      }),
    );
    if (res === null) {
      // Plan 08-10 / G-08-4 — gate rejected the request. Render the
      // empty-state card instead of crashing on undefined access below.
      setRows([]);
      setTotal(0);
      setGated(true);
      setLoading(false);
      return;
    }
    try {
      setRows(res.rows);
      setTotal(res.total);
      setGated(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load patients';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(patient: Patient): Promise<void> {
    setDeleting(true);
    try {
      await window.api.patients.softDelete(patient.id);
      toast.success(`${patient.fullName} archived.`);
      setConfirmDelete(null);
      await refetch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      toast.error(msg);
    } finally {
      setDeleting(false);
    }
  }

  async function handleRestore(patient: Patient): Promise<void> {
    try {
      await window.api.patients.restore(patient.id);
      toast.success(`${patient.fullName} restored.`);
      await refetch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Restore failed';
      toast.error(msg);
    }
  }

  function handleEdit(patient: Patient): void {
    navigate({ name: 'patient-edit', id: patient.id });
  }

  // ponytail: empty results collapse to 0 pages instead of the misleading
  // "Page 1 of 1" — the range footer falls back to "No patients" copy.
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const canRestore = currentUser?.isFirstAdmin ?? false;
  // ponytail: pagination range math collapses to "Showing 1 of 1" when
  // there's a single row — keeps the footer one-liner readable.
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);
  const filtersActive = search !== '' || mrn !== '';

  return (
    <main className="min-h-screen bg-[#F7F1E6] p-6 font-sans text-[#13202E]">
      <div className="mx-auto max-w-6xl flex flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E0D9C6] pb-4">
          <div className="flex flex-col gap-1">
            <p
              className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8C8478]"
              data-testid="patient-page-kicker"
            >
              {t('patient.pageKicker')}
            </p>
            <h1 className="text-2xl font-medium tracking-tight text-[#13202E]">
              {t('patient.pageTitle')}
            </h1>
            <p className="text-sm text-[#5C6770]">
              {filtersActive
                ? `${t('patient.total', { count: total })} · filtered`
                : t('patient.total', { count: total })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              title={t('common.settings')}
              aria-label={t('common.settings')}
              data-testid="settings-trigger"
              onClick={() => navigate({ name: 'settings-hub' })}
            >
              <SettingsIcon className="size-4" aria-hidden="true" />
            </Button>
            <Button
              size="lg"
              onClick={() => navigate({ name: 'patient-new' })}
              data-testid="patient-new-button"
              className="bg-[#0E3A47] text-white hover:bg-[#0B2C36]"
            >
              <Plus className="size-4 mr-2" aria-hidden="true" /> {t('patient.newPatient')}
            </Button>
          </div>
        </header>

        <div className="flex items-center gap-3" data-testid="patient-filter-row">
          <div className="relative flex-1 min-w-0">
            <Label htmlFor="patient-search" className="sr-only">
              {t('patient.searchByName')}
            </Label>
            <Search
              className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-[#5C6770] pointer-events-none"
              aria-hidden="true"
            />
            <Input
              id="patient-search"
              className="pl-8 bg-[#FBF7EE] border-[#E0D9C6] text-[#13202E] placeholder:text-[#A39A86] hover:border-[#A8C5B5] focus:border-[#0E3A47] focus:bg-white focus:ring-1 focus:ring-[#0E3A47]/30"
              placeholder={t('patient.searchPlaceholder')}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              data-testid="filter-search"
            />
          </div>
          <div className="w-44">
            <Label htmlFor="patient-mrn" className="sr-only">
              {t('patient.mrnExact')}
            </Label>
            <Input
              id="patient-mrn"
              className="bg-[#FBF7EE] border-[#E0D9C6] text-[#13202E] placeholder:text-[#A39A86] hover:border-[#A8C5B5] focus:border-[#0E3A47] focus:bg-white focus:ring-1 focus:ring-[#0E3A47]/30"
              placeholder={t('patient.mrnPlaceholder')}
              value={mrn}
              onChange={(e) => {
                setMrn(e.target.value);
                setPage(1);
              }}
              data-testid="filter-mrn"
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <input
              id="patient-include-deleted"
              type="checkbox"
              checked={includeDeleted}
              onChange={(e) => {
                setIncludeDeleted(e.target.checked);
                setPage(1);
              }}
              data-testid="filter-include-deleted"
              className="size-4"
            />
            <Label htmlFor="patient-include-deleted" className="text-sm whitespace-nowrap text-[#13202E]">
              {t('patient.showDeleted')}
            </Label>
          </div>
          <div className="ml-auto shrink-0">
            <PageSizeSelector
              value={pageSize}
              onChange={(n) => {
                setPageSize(n);
                setPage(1);
              }}
            />
          </div>
        </div>

        {filtersActive ? (
          <div className="flex items-center gap-2 flex-wrap" data-testid="patient-filter-chips">
            {search !== '' ? (
              <Badge variant="secondary" data-testid="filter-chip-search" className="gap-1 pr-1">
                <span className="text-xs">
                  Search: <span className="font-mono">{search}</span>
                </span>
                <button
                  type="button"
                  aria-label={t('patient.filterChipRemove')}
                  onClick={() => {
                    setSearch('');
                    setPage(1);
                  }}
                  className="ml-1 rounded-sm hover:bg-[#E0D9C6]/60 size-4 inline-flex items-center justify-center"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </Badge>
            ) : null}
            {mrn !== '' ? (
              <Badge variant="secondary" data-testid="filter-chip-mrn" className="gap-1 pr-1">
                <span className="text-xs">
                  MRN: <span className="font-mono">{mrn}</span>
                </span>
                <button
                  type="button"
                  aria-label={t('patient.filterChipRemove')}
                  onClick={() => {
                    setMrn('');
                    setPage(1);
                  }}
                  className="ml-1 rounded-sm hover:bg-[#E0D9C6]/60 size-4 inline-flex items-center justify-center"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </Badge>
            ) : null}
          </div>
        ) : null}

        {gated ? <EmptyStateCard /> : null}

        <Card className="border-[#E0D9C6] bg-[#FBF7EE] shadow-[0_1px_2px_rgba(19,32,46,0.04),0_8px_24px_-12px_rgba(19,32,46,0.12)]">
          <CardContent className="p-0">
            <div className="max-h-[60vh] overflow-y-auto border border-[#E0D9C6]" data-testid="patient-table-scroll">
              <table className="w-full">
                <thead className="sticky top-0 z-10 bg-[#FBF7EE] shadow-[0_1px_0_0_hsl(var(--border))]">
                  <tr className="border-b text-left text-xs uppercase text-[#8C8478]">
                    <th className="px-3 py-2 bg-[#FBF7EE] text-[#8C8478] text-xs uppercase tracking-[0.18em]">{t('patient.columnName')}</th>
                    <th className="px-3 py-2 bg-[#FBF7EE] text-[#8C8478] text-xs uppercase tracking-[0.18em]">{t('common.dob')}</th>
                    <th className="px-3 py-2 bg-[#FBF7EE] text-[#8C8478] text-xs uppercase tracking-[0.18em]">{t('patient.columnGender')}</th>
                    <th className="px-3 py-2 bg-[#FBF7EE] text-[#8C8478] text-xs uppercase tracking-[0.18em]">{t('common.mrn')}</th>
                    <th className="px-3 py-2 bg-[#FBF7EE] text-[#8C8478] text-xs uppercase tracking-[0.18em]">{t('patient.columnPhone')}</th>
                    <th className="px-3 py-2 bg-[#FBF7EE] text-[#8C8478] text-xs uppercase tracking-[0.18em] text-right">{t('patient.columnActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    // ponytail: 3 grey animate-pulse skeleton rows instead of
                    // plain text + spinner — matches the Audit + PatientProcedures
                    // polish (no shadcn Skeleton dep needed).
                    <>
                      {[0, 1, 2].map((i) => (
                        <tr key={`skeleton-${i}`} data-testid="patient-skeleton-row">
                          <td colSpan={6} className="px-3 py-2">
                            <div className="h-5 w-full animate-pulse rounded bg-[#E0D9C6]/60" />
                          </td>
                        </tr>
                      ))}
                    </>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-3 py-10 text-center text-sm text-[#5C6770]"
                        data-testid={
                          filtersActive ? 'patient-empty-filtered' : 'patient-empty-first'
                        }
                      >
                        {filtersActive ? (
                          <div className="flex flex-col gap-2 items-center">
                            <span className="font-medium">{t('patient.resultsEmpty')}</span>
                            <span className="text-xs">{t('patient.emptyFilteredHint')}</span>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-3 items-center">
                            <UserPlus className="size-8 text-[#5C6770]" aria-hidden="true" />
                            <span className="font-medium">{t('patient.emptyFirst')}</span>
                            <span className="text-xs">{t('patient.emptyFirstHint')}</span>
                            <Button
                              size="lg"
                              onClick={() => navigate({ name: 'patient-new' })}
                              data-testid="patient-empty-cta"
                              className="mt-1 bg-[#0E3A47] text-white hover:bg-[#0B2C36]"
                            >
                              <Plus className="size-4 mr-2" aria-hidden="true" />
                              {t('patient.emptyFirstCta')}
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ) : (
                    rows.map((p) => (
                      <PatientRow
                        key={p.id}
                        patient={p}
                        canRestore={canRestore}
                        onEdit={handleEdit}
                        onDelete={(pp) => setConfirmDelete(pp)}
                        onRestore={handleRestore}
                      />
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
            data-testid="pagination-range"
          >
            {total === 0
              ? t('patient.paginationRangeEmpty')
              : total === 1
                ? t('patient.paginationRangeOne')
                : t('patient.paginationRange', {
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
              className="border-[#E0D9C6] bg-white text-[#5C6770] hover:border-[#0E3A47] hover:bg-[#E6EFF1] hover:text-[#0E3A47]"
            >
              {t('common.previous')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="border-[#E0D9C6] bg-white text-[#5C6770] hover:border-[#0E3A47] hover:bg-[#E6EFF1] hover:text-[#0E3A47]"
            >
              {t('common.next')}
            </Button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete !== null}
        title={t('patient.archiveConfirmTitle')}
        description={
          confirmDelete
            ? t('patient.archiveConfirmBody')
            : ''
        }
        confirmLabel={deleting ? t('patient.archiving') : t('patient.archive')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={() => {
          if (confirmDelete) void handleDelete(confirmDelete);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </main>
  );
}