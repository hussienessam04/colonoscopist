// Patient List — default landing after login.
// Per PAT-02 + PAT-04: search + MRN exact + show-deleted toggle + page-size + soft-delete.
// Per Fix 6: every patients.list call writes a patient_list audit row in main.
// Per Plan 03-04 (G-03-1 / G-03-2): header Settings is a DropdownMenu so every
// authenticated doctor reaches the existing Settings → Capture page; Users stays
// admin-gated via currentUser.isFirstAdmin.
// Per Plan 03-05 (G-03-3): the DropdownMenu was replaced with a single Button
// that opens the new SettingsHub page; per-section admin gating now lives on
// the hub's sidebar.
import { useEffect, useState } from 'react';
import { Plus, Search, Settings as SettingsIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
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
  const [rows, setRows] = useState<Patient[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [mrn, setMrn] = useState('');
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<Patient | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Debounced search refetch.
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

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-48 flex flex-col gap-1">
            <Label htmlFor="search">Search by name</Label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                id="search"
                className="pl-8"
                placeholder="Last name or full name…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </div>
          </div>
          <div className="w-40 flex flex-col gap-1">
            <Label htmlFor="mrn">MRN (exact)</Label>
            <Input
              id="mrn"
              value={mrn}
              onChange={(e) => {
                setMrn(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="flex items-center gap-2 pb-2">
            <Checkbox
              id="includeDeleted"
              checked={includeDeleted}
              onCheckedChange={(v) => {
                setIncludeDeleted(v === true);
                setPage(1);
              }}
            />
            <Label htmlFor="includeDeleted" className="text-sm">
              Show deleted
            </Label>
          </div>
          <div className="pb-2">
            <PageSizeSelector value={pageSize} onChange={(n) => { setPageSize(n); setPage(1); }} />
          </div>
        </div>

        <div className="rounded-md border bg-card">
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
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-sm text-muted-foreground">
                    No patients yet — click + New patient to add the first one.
                  </td>
                </tr>
              ) : (
                rows.map((p) => (
                  <PatientRow
                    key={p.id}
                    patient={p}
                    canRestore={canRestore}
                    onEdit={handleEdit}
                    onDelete={(p) => setConfirmDelete(p)}
                    onRestore={handleRestore}
                  />
                ))
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
