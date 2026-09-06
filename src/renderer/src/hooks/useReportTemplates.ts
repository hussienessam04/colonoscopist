// useReportTemplates — SWR-style hook for the saved-text-templates
// library. Quick task 20260812-redesign-report — the editor renders a
// per-box dropdown of saved snippets; the hook keeps the list in
// local React state and proxies add/remove to the IPC surface.
//
// ponytail: no useReducer, no Zustand — useState + useEffect per the
// rest of the project hooks (useReport, useDoctorProfile).

import { useCallback, useEffect, useState } from 'react';
import type { ReportTemplate } from '@shared/ipc-contract';

export type UseReportTemplatesResult = {
  templates: ReportTemplate[];
  add: (input: { scope: ReportTemplate['scope']; label: string; body: string }) => Promise<ReportTemplate>;
  remove: (id: string) => Promise<{ ok: true }>;
};

export function useReportTemplates({
  scope,
}: {
  scope: ReportTemplate['scope'] | null;
}): UseReportTemplatesResult {
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);

  const refresh = useCallback(async (): Promise<void> => {
    if (scope === null) {
      setTemplates([]);
      return;
    }
    // ponytail: optional-chain so a mid-render mutation of
    // `window.api` (cascade pollution from a prior test's stashed
    // microtask) cannot crash the render. The list stays empty when
    // the namespace is missing.
    const rows = (await window.api.reportTemplates?.listByScope?.({ scope })) ?? [];
    setTemplates(Array.isArray(rows) ? rows : []);
  }, [scope]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = useCallback(
    async (input: {
      scope: ReportTemplate['scope'];
      label: string;
      body: string;
    }): Promise<ReportTemplate> => {
      const created = await window.api.reportTemplates?.add?.(input);
      await refresh();
      return created;
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string): Promise<{ ok: true }> => {
      const result = await window.api.reportTemplates?.remove?.({ id });
      await refresh();
      return result ?? { ok: true };
    },
    [refresh],
  );

  return { templates, add, remove };
}