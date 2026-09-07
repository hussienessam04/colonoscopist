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
// ponytail: the params (filters + page + pageSize) are captured via
// refs so the refresh callback identity stays stable across renders.
// The parent (Audit page) rebuilds the `filters` object every render
// — using `filters` as a useEffect dep would cause a re-fire loop.
// `page` + `pageSize` are also captured via refs (and added to the
// useEffect deps array) so prev/next clicks re-fire the IPC without
// the stale-closure trap of reading them directly inside the
// useCallback closure (which would always see the FIRST render's
// page=1, regardless of subsequent state updates).

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
  // Lazy refs — keep the refresh callback identity stable while still
  // reading the latest params. page + pageSize MUST be refs (not direct
  // closure captures) because useCallback([]) would otherwise lock them
  // to the first render's values — clicking Next would update React state
  // but the IPC would re-fetch page=1 forever.
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const pageRef = useRef(page);
  pageRef.current = page;
  const pageSizeRef = useRef(pageSize);
  pageSizeRef.current = pageSize;

  const refresh = useCallback(async (): Promise<void> => {
    if (refreshInFlightRef.current) return refreshInFlightRef.current;
    const promise = (async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const res = await window.api.audit.list({
          ...filtersRef.current,
          page: pageRef.current,
          pageSize: pageSizeRef.current,
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

  // ponytail: refresh identity stays stable; `page` and `pageSize` are
  // direct deps so the IPC refetches when the user clicks prev/next.
  // The lazy refs above keep the actual call reading the latest values,
  // not the stale closure. (Regression from 260907-lk4: removing the
  // page/pageSize refs broke prev/next because refresh's closure
  // captured the FIRST render's page=1.)
  useEffect(() => {
    void refresh();
  }, [refresh, page, pageSize]);

  return { rows, total, loading, error, refresh };
}
