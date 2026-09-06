// useReport + useAttachedScreenshots + useProcedureScreenshots.
// Three SWR-style hooks for the ReportEditor page.
//
// useReport loads the report row for the procedure on mount or
// procedureId change. setLocal is local-only (no IPC); the parent
// composes useAutoSave to persist via api.reports.updateDraft /
// updateFinalized.
//
// useAttachedScreenshots loads the report_screenshots join rows for
// the given reportId. attach/detach/reorder call IPC + optimistically
// patch local state, then refresh from the source of truth.
//
// useProcedureScreenshots loads the procedure's full screenshot list
// (the union of attached + unattached) — the ReportEditor feeds the
// ScreenshotTimeline from this list so the doctor can attach new ones.
//
// ponytail: no useReducer, no Zustand — useState + useEffect per hook.

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Report,
  ReportScreenshot,
  Screenshot,
} from '@shared/ipc-contract';

// Quick task 20260812-redesign-report — the editor's editable set is
// the 8 procedure-type-specific box columns. The renderer only writes
// the boxes; procedure_type / instrument / premedication_override have
// dedicated IPC channels with their own guards.
export type ReportEditableFields = Pick<
  Report,
  | 'esophagus'
  | 'stomach'
  | 'pylorus'
  | 'duodenum'
  | 'colon'
  | 'ileum'
  | 'conclusion'
  | 'recommendation'
>;

export type UseReportResult = {
  report: Report | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setLocal: (patch: Partial<ReportEditableFields>) => void;
};

export function useReport({ procedureId }: { procedureId: string | null }): UseReportResult {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!procedureId) {
      setReport(null);
      setLoading(false);
      return;
    }
    if (refreshInFlightRef.current) return refreshInFlightRef.current;
    const promise = (async (): Promise<void> => {
      setLoading(true);
      try {
        // ponytail: optional-chain so a mid-render mutation of
        // `window.api` (cascade pollution from a prior test's stashed
        // microtask) cannot crash the render. The hook stays
        // callable from tests that haven't seeded the `reports`
        // namespace — the row stays null and the editor renders the
        // empty state.
        const row = await window.api.reports?.getOrCreate?.({ procedureId });
        setReport(row ?? null);
      } finally {
        setLoading(false);
        refreshInFlightRef.current = null;
      }
    })();
    refreshInFlightRef.current = promise;
    return promise;
  }, [procedureId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setLocal = useCallback((patch: Partial<ReportEditableFields>): void => {
    setReport((prev) => (prev === null ? prev : { ...prev, ...patch }));
  }, []);

  return { report, loading, refresh, setLocal };
}

export type UseAttachedScreenshotsResult = {
  attached: ReportScreenshot[];
  loading: boolean;
  refresh: () => Promise<void>;
  attach: (screenshotId: number) => Promise<void>;
  detach: (screenshotId: number) => Promise<void>;
  reorder: (orderedIds: number[]) => Promise<void>;
};

export function useAttachedScreenshots({
  reportId,
}: {
  reportId: string | null;
}): UseAttachedScreenshotsResult {
  const [attached, setAttached] = useState<ReportScreenshot[]>([]);
  const [loading, setLoading] = useState(false);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!reportId) {
      setAttached([]);
      setLoading(false);
      return;
    }
    if (refreshInFlightRef.current) return refreshInFlightRef.current;
    const promise = (async (): Promise<void> => {
      setLoading(true);
      try {
        // ponytail: optional-chain guard mirrors useReport.refresh —
        // tests that haven't seeded the `reports` namespace leave the
        // attached list empty without throwing.
        const rows = (await window.api.reports?.listScreenshots?.({ id: reportId })) ?? [];
        // Stable sort by sortOrder ASC so the renderer's "newest first"
        // assumption doesn't drift if main returns rows in insert order.
        const sorted = [...rows].sort((a, b) => a.sortOrder - b.sortOrder);
        setAttached(sorted);
      } finally {
        setLoading(false);
        refreshInFlightRef.current = null;
      }
    })();
    refreshInFlightRef.current = promise;
    return promise;
  }, [reportId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const attach = useCallback(
    async (screenshotId: number): Promise<void> => {
      if (!reportId) return;
      await window.api.reports.attachScreenshot({
        id: reportId,
        screenshotId,
        sortOrder: attached.length,
      });
      await refresh();
    },
    [reportId, attached.length, refresh],
  );

  const detach = useCallback(
    async (screenshotId: number): Promise<void> => {
      if (!reportId) return;
      await window.api.reports.detachScreenshot({ id: reportId, screenshotId });
      await refresh();
    },
    [reportId, refresh],
  );

  const reorder = useCallback(
    async (orderedIds: number[]): Promise<void> => {
      if (!reportId) return;
      await window.api.reports.reorderScreenshots({
        id: reportId,
        orderedIds,
      });
      await refresh();
    },
    [reportId, refresh],
  );

  return { attached, loading, refresh, attach, detach, reorder };
}

export type UseProcedureScreenshotsResult = {
  screenshots: Screenshot[];
  loading: boolean;
  refresh: () => Promise<void>;
};

export function useProcedureScreenshots({
  procedureId,
}: {
  procedureId: string | null;
}): UseProcedureScreenshotsResult {
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [loading, setLoading] = useState(false);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!procedureId) {
      setScreenshots([]);
      setLoading(false);
      return;
    }
    if (refreshInFlightRef.current) return refreshInFlightRef.current;
    const promise = (async (): Promise<void> => {
      setLoading(true);
      try {
        // ponytail: optional-chain guard mirrors useReport.refresh —
        // tests that haven't seeded the `screenshots` namespace leave
        // the list empty without throwing.
        const rows = (await window.api.screenshots?.list?.({ procedureId })) ?? [];
        // ASC by timestampInVideoMs matches the timeline + the order the
        // doctor expects to scroll through clinical findings.
        const sorted = [...rows].sort(
          (a, b) => a.timestampInVideoMs - b.timestampInVideoMs,
        );
        setScreenshots(sorted);
      } finally {
        setLoading(false);
        refreshInFlightRef.current = null;
      }
    })();
    refreshInFlightRef.current = promise;
    return promise;
  }, [procedureId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { screenshots, loading, refresh };
}