// @vitest-environment happy-dom
// useAudit — SWR-style hook for the Audit page (Phase 7 / Plan 07-03).
// Mirrors the useProcedures / useDoctorProfile test pattern.

import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import '../setup';
import { getApi } from '../setup';
import { useAudit } from '@/hooks/useAudit';
import type { AuditEntry } from '@shared/ipc-contract';

const ROW: AuditEntry = {
  id: 1,
  userId: '00000000-0000-4000-8000-000000000001',
  action: 'login',
  entityType: 'user',
  entityId: '00000000-0000-4000-8000-000000000001',
  metadata: { ip: '127.0.0.1' },
  outcome: 'ok',
  createdAt: 1_700_000_000_000,
};

const ROW2: AuditEntry = {
  id: 2,
  userId: null,
  action: 'audit_view',
  entityType: 'audit',
  entityId: null,
  metadata: null,
  outcome: 'ok',
  createdAt: 1_700_000_005_000,
};

describe('useAudit', () => {
  it('returns rows + total after the list IPC resolves', async () => {
    const api = getApi();
    api.audit.list.mockResolvedValue({ rows: [ROW, ROW2], total: 2 });
    const { result } = renderHook(() =>
      useAudit({ filters: { action: 'login' }, page: 1, pageSize: 100 }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toEqual([ROW, ROW2]);
    expect(result.current.total).toBe(2);
    expect(result.current.error).toBeNull();
    expect(api.audit.list).toHaveBeenCalledWith({
      action: 'login',
      page: 1,
      pageSize: 100,
    });
  });

  it('refresh() re-fetches from IPC and replaces rows', async () => {
    const api = getApi();
    api.audit.list
      .mockResolvedValueOnce({ rows: [ROW], total: 1 })
      .mockResolvedValueOnce({ rows: [ROW, ROW2], total: 2 });
    const { result } = renderHook(() => useAudit({ filters: {}, page: 1 }));
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.rows).toHaveLength(2);
    expect(api.audit.list).toHaveBeenCalledTimes(2);
  });

  it('returns error message when the IPC rejects', async () => {
    const api = getApi();
    api.audit.list.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useAudit({ filters: {}, page: 1 }));
    await waitFor(() => expect(result.current.error).toBe('boom'));
    expect(result.current.rows).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('forwards date-range + userId + entityType filters to the IPC', async () => {
    const api = getApi();
    api.audit.list.mockResolvedValue({ rows: [], total: 0 });
    const from = Date.parse('2026-01-01T00:00:00Z');
    const to = Date.parse('2026-01-31T23:59:59.999Z');
    renderHook(() =>
      useAudit({
        filters: {
          from,
          to,
          userId: '00000000-0000-4000-8000-000000000099',
          entityType: 'patient',
        },
        page: 2,
        pageSize: 50,
      }),
    );
    await waitFor(() => expect(api.audit.list).toHaveBeenCalled());
    expect(api.audit.list).toHaveBeenCalledWith({
      from,
      to,
      userId: '00000000-0000-4000-8000-000000000099',
      entityType: 'patient',
      page: 2,
      pageSize: 50,
    });
  });

  // Regression: 260907-lk4 follow-up. The previous fix removed the
  // page/pageSize lazy refs but kept `useCallback([], ...)` for refresh,
  // so the closure captured the FIRST render's page=1. Prev/next clicks
  // updated React state but the IPC re-fetched page=1 forever. This test
  // locks the contract: a re-render with a different `page` MUST trigger
  // a new IPC call with the new page number.
  it('re-renders with a new page number re-fetches the IPC with the new page (regression)', async () => {
    const api = getApi();
    api.audit.list
      .mockResolvedValueOnce({ rows: [ROW], total: 250 })
      .mockResolvedValueOnce({ rows: [ROW2], total: 250 });
    const { result, rerender } = renderHook(
      ({ page }: { page: number }) => useAudit({ filters: {}, page, pageSize: 100 }),
      { initialProps: { page: 1 } },
    );
    // Initial mount fetches page=1.
    await waitFor(() => expect(api.audit.list).toHaveBeenCalledTimes(1));
    expect(api.audit.list.mock.calls[0]?.[0]).toMatchObject({ page: 1 });
    await waitFor(() => expect(result.current.rows).toEqual([ROW]));

    // User clicks Next → parent re-renders with page=2.
    await act(async () => {
      rerender({ page: 2 });
    });
    // The hook must have re-fetched with page=2 (NOT the stale page=1
    // captured in the useCallback closure).
    await waitFor(() => expect(api.audit.list).toHaveBeenCalledTimes(2));
    expect(api.audit.list.mock.calls[1]?.[0]).toMatchObject({ page: 2 });
    await waitFor(() => expect(result.current.rows).toEqual([ROW2]));
  });

  // Companion regression: changing pageSize also re-fetches.
  it('re-renders with a new pageSize re-fetches the IPC with the new pageSize (regression)', async () => {
    const api = getApi();
    api.audit.list
      .mockResolvedValueOnce({ rows: [ROW], total: 250 })
      .mockResolvedValueOnce({ rows: [ROW2], total: 250 });
    const { rerender } = renderHook(
      ({ pageSize }: { pageSize: number }) =>
        useAudit({ filters: {}, page: 1, pageSize }),
      { initialProps: { pageSize: 100 } },
    );
    await waitFor(() => expect(api.audit.list).toHaveBeenCalledTimes(1));
    expect(api.audit.list.mock.calls[0]?.[0]).toMatchObject({
      page: 1,
      pageSize: 100,
    });

    // PageSizeSelector changes from 100 → 50.
    await act(async () => {
      rerender({ pageSize: 50 });
    });
    await waitFor(() => expect(api.audit.list).toHaveBeenCalledTimes(2));
    expect(api.audit.list.mock.calls[1]?.[0]).toMatchObject({
      page: 1,
      pageSize: 50,
    });
  });
});
