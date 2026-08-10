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
// Phase 7 / Plan 07-02 — SRCH-01..03 + D-01..D-03: cross-cutting Patient List
// filter sidebar lives in the left rail. Inputs are non-blocking — Apply
// triggers refetch (per D-01 verbatim). Five filter dimensions are
// AND-combined per D-02:
//   1. Search by name (substring; Phase 2 — debounced refetch)
//   2. MRN exact (Phase 2 — debounced refetch)
//   3. Date range (from / to against procedures.started_at; Apply only)
//   4. Doctor (Select against usersList; Apply only)
//   5. Procedure status (multi-select: completed/partial/recording; Apply only)
import { useEffect, useRef, useState } from 'react';
import { Plus, Search, Settings as SettingsIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import PageSizeSelector from '@/components/PageSizeSelector';
import PatientRow from '@/components/PatientRow';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useRoute } from '@/lib/router';
import { useSession } from '@/store/session';
import { toast } from 'sonner';
import type { Patient, Procedure, ProcedureStatus, Report, UserPublic } from '@shared/ipc-contract';

const DEBOUNCE_MS = 250;

type SidebarFilters = {
  dateFrom: string;
  dateTo: string;
  doctorId: string;
  status: ProcedureStatus[];
};

const EMPTY_SIDEBAR: SidebarFilters = {
  dateFrom: '',
  dateTo: '',
  doctorId: '',
  status: [],
};

const STATUS_OPTIONS: { value: ProcedureStatus; label: string }[] = [
  { value: 'completed', label: 'Completed' },
  { value: 'partial', label: 'Partial' },
  { value: 'recording', label: 'Recording' },
];

const ANY_DOCTOR = '__any__';

export default function PatientsList(): JSX.Element {
  const { navigate } = useRoute();
  const { currentUser } = useSession();
  const [rows, setRows] = useState<Patient[]>([]);
  const [total, setTotal] = useState(0);
  // Phase 2 surface — search + MRN are direct state that debounce-refetch
  // (per Phase 2 PAT-02 / PAT-04 behavior preserved).
  const [search, setSearch] = useState('');
  const [mrn, setMrn] = useState('');
  // Phase 7 surface — date range, doctor, and status are pending until
  // Apply (per D-01 verbatim "all inputs non-blocking"). The applied
  // `appliedFilters` only updates on Apply / Clear.
  const [pendingFilters, setPendingFilters] = useState<SidebarFilters>(EMPTY_SIDEBAR);
  const [appliedFilters, setAppliedFilters] = useState<SidebarFilters>(EMPTY_SIDEBAR);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<Patient | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [doctors, setDoctors] = useState<UserPublic[]>([]);
  const [expandedPatientId, setExpandedPatientId] = useState<string | null>(null);
  const [proceduresByPatient, setProceduresByPatient] = useState<Record<string, Procedure[]>>({});
  const [reportsByProcedure, setReportsByProcedure] = useState<Record<string, Report | null>>({});

  // ponytail: load the doctor list once on mount so the sidebar Select has
  // stable options for the whole session. The IPC call is cheap; caching
  // it here is cheaper than re-fetching on every Apply.
  useEffect(() => {
    let cancelled = false;
    void window.api.auth.usersList().then((list) => {
      if (!cancelled) setDoctors(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Phase 2 — debounce refetch on the search + MRN inputs only. Date
  // range, doctor, and procedure status are Apply-only (per D-01 verbatim)
  // so the doctor can change multiple values and fire once.
  useEffect(() => {
    const handle = setTimeout(() => {
      void refetch();
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, mrn, includeDeleted, page, pageSize]);

  // Apply / Clear commit changes via setAppliedFilters + setSearch +
  // setMrn. The refetch must use the NEW state, not the closure-captured
  // stale one — the only way to guarantee that is via a useEffect that
  // runs AFTER React processes the state update. First render is skipped
  // to avoid double-fetching on mount (the search/mrn debounce above
  // already triggers the first call 250ms after mount).
  const isFirstAppliedRender = useRef(true);
  useEffect(() => {
    if (isFirstAppliedRender.current) {
      isFirstAppliedRender.current = false;
      return;
    }
    void refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedFilters]);

  async function refetch(): Promise<void> {
    setLoading(true);
    try {
      const res = await window.api.patients.list({
        search: search || undefined,
        mrn: mrn || undefined,
        dateFrom: appliedFilters.dateFrom || undefined,
        dateTo: appliedFilters.dateTo || undefined,
        doctorId: appliedFilters.doctorId || undefined,
        procedureStatus:
          appliedFilters.status.length > 0 ? appliedFilters.status : undefined,
        includeDeleted,
        page,
        pageSize,
      });
      setRows(res.rows);
      setTotal(res.total);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load patients';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  function handleApply(): void {
    setPage(1);
    setAppliedFilters(pendingFilters);
  }

  function handleClear(): void {
    setPage(1);
    setSearch('');
    setMrn('');
    setAppliedFilters(EMPTY_SIDEBAR);
    setPendingFilters(EMPTY_SIDEBAR);
  }

  function toggleStatus(value: ProcedureStatus): void {
    setPendingFilters((prev) => {
      const has = prev.status.includes(value);
      return {
        ...prev,
        status: has ? prev.status.filter((s) => s !== value) : [...prev.status, value],
      };
    });
  }

  async function handleToggleExpand(patient: Patient): Promise<void> {
    if (expandedPatientId === patient.id) {
      setExpandedPatientId(null);
      return;
    }
    setExpandedPatientId(patient.id);
    if (!proceduresByPatient[patient.id]) {
      try {
        const procs = await window.api.procedures.list({ patientId: patient.id });
        setProceduresByPatient((prev) => ({ ...prev, [patient.id]: procs.rows }));
        // Look up the report for each procedure in parallel (returns null when
        // no report exists yet — that's a valid state per D-03).
        const reportEntries = await Promise.all(
          procs.rows.map(async (p) => {
            const r = await window.api.reports.getByProcedure({ procedureId: p.id });
            return [p.id, r] as const;
          }),
        );
        setReportsByProcedure((prev) => {
          const next = { ...prev };
          for (const [procId, r] of reportEntries) next[procId] = r;
          return next;
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to load procedures';
        toast.error(msg);
      }
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

  function handleOpenProcedure(procedureId: string): void {
    navigate({ name: 'procedure-review', procedureId });
  }

  async function handleOpenReport(reportId: string): Promise<void> {
    try {
      await window.api.reports.openPdf({ id: reportId, reveal: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to open report PDF';
      toast.error(msg);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const canRestore = currentUser?.isFirstAdmin ?? false;

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-6xl flex flex-col gap-4">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Patients</h1>
            <p className="text-sm text-muted-foreground">{total} total</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              title="Settings"
              data-testid="settings-trigger"
              onClick={() => navigate({ name: 'settings-hub' })}
            >
              <SettingsIcon className="size-4 mr-1" aria-hidden="true" />
              Settings
            </Button>
            <Button onClick={() => navigate({ name: 'patient-new' })}>
              <Plus className="size-4 mr-1" /> New patient
            </Button>
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          {/* Left rail — filter sidebar (D-01 verbatim). Mirrors SettingsHub's
              visual density: 18rem column + Card with CardHeader + CardContent. */}
          <Card className="h-fit" data-testid="patient-filter-sidebar">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Search &amp; filter</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="filter-search">Search by name</Label>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    id="filter-search"
                    className="pl-8"
                    placeholder="Last name or full name…"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                    data-testid="filter-search"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="filter-mrn">MRN (exact)</Label>
                <Input
                  id="filter-mrn"
                  value={mrn}
                  onChange={(e) => {
                    setMrn(e.target.value);
                    setPage(1);
                  }}
                  data-testid="filter-mrn"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="filter-date-from">From</Label>
                  <Input
                    id="filter-date-from"
                    type="date"
                    value={pendingFilters.dateFrom}
                    onChange={(e) =>
                      setPendingFilters((prev) => ({ ...prev, dateFrom: e.target.value }))
                    }
                    data-testid="filter-date-from"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="filter-date-to">To</Label>
                  <Input
                    id="filter-date-to"
                    type="date"
                    value={pendingFilters.dateTo}
                    onChange={(e) =>
                      setPendingFilters((prev) => ({ ...prev, dateTo: e.target.value }))
                    }
                    data-testid="filter-date-to"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="filter-doctor">Doctor</Label>
                <Select
                  value={pendingFilters.doctorId || ANY_DOCTOR}
                  onValueChange={(v) =>
                    setPendingFilters((prev) => ({
                      ...prev,
                      doctorId: v === ANY_DOCTOR ? '' : v,
                    }))
                  }
                >
                  <SelectTrigger id="filter-doctor" data-testid="filter-doctor">
                    <SelectValue placeholder="Any doctor" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY_DOCTOR}>Any doctor</SelectItem>
                    {doctors.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.fullName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label>Procedure status</Label>
                {STATUS_OPTIONS.map((opt) => {
                  const checked = pendingFilters.status.includes(opt.value);
                  return (
                    <div key={opt.value} className="flex items-center gap-2">
                      <Checkbox
                        id={`filter-status-${opt.value}`}
                        checked={checked}
                        onCheckedChange={() => toggleStatus(opt.value)}
                        data-testid={`filter-status-${opt.value}`}
                      />
                      <Label htmlFor={`filter-status-${opt.value}`} className="text-sm font-normal">
                        {opt.label}
                      </Label>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-2 pt-2">
                <Checkbox
                  id="filter-include-deleted"
                  checked={includeDeleted}
                  onCheckedChange={(v) => {
                    setIncludeDeleted(v === true);
                    setPage(1);
                  }}
                />
                <Label htmlFor="filter-include-deleted" className="text-sm">
                  Show deleted
                </Label>
              </div>
              <div className="flex items-center gap-2 pt-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={handleClear}
                  data-testid="filter-clear"
                >
                  Clear filters
                </Button>
                <Button
                  className="flex-1"
                  onClick={handleApply}
                  data-testid="filter-apply"
                >
                  Apply filters
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Right column — results table (existing surface, with per-row
              accordion expansion). PageSizeSelector stays at the table top so
              the existing test surface (`page-size-selector`) keeps working. */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-end">
              <PageSizeSelector
                value={pageSize}
                onChange={(n) => {
                  setPageSize(n);
                  setPage(1);
                }}
              />
            </div>
            <div className="rounded-md border bg-card">
              <table className="w-full">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="w-8 px-2 py-2" />
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">DOB</th>
                    <th className="px-3 py-2">Gender</th>
                    <th className="px-3 py-2">MRN</th>
                    <th className="px-3 py-2">Phone</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-8 text-center text-sm text-muted-foreground">
                        Loading…
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-8 text-center text-sm text-muted-foreground">
                        No patients match the current filters.
                      </td>
                    </tr>
                  ) : (
                    rows.map((p) => {
                      const isExpanded = expandedPatientId === p.id;
                      return (
                        <PatientRow
                          key={p.id}
                          patient={p}
                          canRestore={canRestore}
                          expanded={isExpanded}
                          onToggleExpand={() => void handleToggleExpand(p)}
                          procedures={proceduresByPatient[p.id] ?? []}
                          reportsByProcedure={reportsByProcedure}
                          onEdit={handleEdit}
                          onDelete={(pp) => setConfirmDelete(pp)}
                          onRestore={handleRestore}
                          onOpenProcedure={handleOpenProcedure}
                          onOpenReport={(reportId) => void handleOpenReport(reportId)}
                        />
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete patient?"
        description={
          confirmDelete
            ? `${confirmDelete.fullName} will be archived. An admin can restore from Settings.`
            : ''
        }
        confirmLabel={deleting ? 'Archiving…' : 'Archive'}
        cancelLabel="Cancel"
        destructive
        onConfirm={() => {
          if (confirmDelete) void handleDelete(confirmDelete);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </main>
  );
}
