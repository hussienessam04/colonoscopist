// useAudit — SWR-style hook for the Audit page (Phase 7 / Plan 07-03).
// Mirrors the shape of useProcedures (Phase 5) — single fetch + refresh
// + concurrency guard. The Audit page needs a flat list of rows + a
// total count for pagination; one list call covers both (the IPC
// handler returns { rows, total }).
//
// Default pageSize = 100 per D-05 (Audit page 100/page). Internally
// calls `window.api.audit.list({ ...filters, page, pageSize })` — the
// IPC contract from Plan 07-01.
//
// ponytail: `filters` is captured via a ref (parent rebuilds the object
// every render — using it as a direct useEffect dep would cause a
// re-fire loop). `page` + `pageSize` are stable primitives so they go
// straight into the useEffect deps array — without that, prev/next
// clicks would update React state but the IPC would never re-fire.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuditEntry } from '@shared/ipc-contract';

export type AuditFilters = {
  from?: number; // ms
  to?: number;
  userId?: string;
  action?: string;
  entityType?: string;
};

export type UseAuditResult = {
  rows: AuditEntry[];
  total: number;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

export type UseAuditOptions = {
  filters: AuditFilters;
  page: number;
  pageSize?: number;
};

export function useAudit({ filters, page, pageSize = 100 }: UseAuditOptions): UseAuditResult {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // ponytail: refreshInFlightRef guards against concurrent refresh
  // calls (e.g. fast double-click on Apply). The second awaits the
  // first so the local state stays consistent.
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  // Lazy ref for `filters` only — the parent passes a fresh object
  // every render. page + pageSize are primitives, no ref needed.
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const refresh = useCallback(async (): Promise<void> => {
    if (refreshInFlightRef.current) return refreshInFlightRef.current;
    const promise = (async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const res = await window.api.audit.list({
          ...filtersRef.current,
          page,
          pageSize,
        });
        setRows(res.rows);
        setTotal(res.total);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load audit log');
      } finally {
        setLoading(false);
        refreshInFlightRef.current = null;
      }
    })();
    refreshInFlightRef.current = promise;
    return promise;
  }, []);

  // ponytail: refresh identity stays stable, but `page` and `pageSize`
  // are direct deps so the IPC refetches when the user clicks prev/next
  // (regression fix — without these deps, the hook never re-fetched on
  // page changes; the lazy-ref pattern was hiding the bug).
  useEffect(() => {
    void refresh();
  }, [refresh, page, pageSize]);

  return { rows, total, loading, error, refresh };
}
