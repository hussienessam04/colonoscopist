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

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Search, Settings as SettingsIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import PageSizeSelector from '@/components/PageSizeSelector';
import PatientRow from '@/components/PatientRow';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useRoute } from '@/lib/router';
import { useSession } from '@/store/session';
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

  // Phase 2 — debounce refetch on the search + MRN inputs only.
  useEffect(() => {
    const handle = setTimeout(() => {
      void refetch();
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, mrn, includeDeleted, page, pageSize]);

  async function refetch(): Promise<void> {
    setLoading(true);
    try {
      const res = await window.api.patients.list({
        search: search || undefined,
        mrn: mrn || undefined,
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

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const canRestore = currentUser?.isFirstAdmin ?? false;

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-6xl flex flex-col gap-4">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{t('patient.pageTitle')}</h1>
            <p className="text-sm text-muted-foreground">
              {t('patient.total', { count: total })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              title={t('common.settings')}
              data-testid="settings-trigger"
              onClick={() => navigate({ name: 'settings-hub' })}
            >
              <SettingsIcon className="size-4 mr-1" aria-hidden="true" />
              {t('common.settings')}
            </Button>
            <Button onClick={() => navigate({ name: 'patient-new' })}>
              <Plus className="size-4 mr-1" /> {t('patient.newPatient')}
            </Button>
          </div>
        </header>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('patient.searchByName')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
              <div className="flex flex-col gap-1">
                <Label htmlFor="patient-search">{t('patient.searchByName')}</Label>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    id="patient-search"
                    className="pl-8"
                    placeholder={t('patient.searchPlaceholder')}
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
                <Label htmlFor="patient-mrn">{t('patient.mrnExact')}</Label>
                <Input
                  id="patient-mrn"
                  value={mrn}
                  onChange={(e) => {
                    setMrn(e.target.value);
                    setPage(1);
                  }}
                  data-testid="filter-mrn"
                />
              </div>
              <div className="flex items-center gap-2 sm:pb-1">
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
                <Label htmlFor="patient-include-deleted" className="text-sm">
                  {t('patient.showDeleted')}
                </Label>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">{t('patient.filtersResults')}</CardTitle>
            <PageSizeSelector
              value={pageSize}
              onChange={(n) => {
                setPageSize(n);
                setPage(1);
              }}
            />
          </CardHeader>
          <CardContent className="p-0">
            <div className="rounded-md">
              <table className="w-full">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
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
                      <td colSpan={6} className="px-3 py-8 text-center text-sm text-muted-foreground">
                        {t('common.loading')}
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-sm text-muted-foreground">
                        {t('patient.resultsEmpty')}
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
          <span className="text-muted-foreground">
            {t('common.page')} {page} {t('common.of')} {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              {t('common.previous')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
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