// @vitest-environment happy-dom
// Plan 08-10 regression test — useProcedures exposes `gated: true` when
// any of its four parallel IPC calls returns the gate shape. The hook's
// success path is exercised by ProcedureReview.test.tsx; this file only
// exercises the gate-rejection branch.

import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import '../setup';
import { getApi } from '../setup';
import { useProcedures } from '@/hooks/useProcedures';

describe('useProcedures — gate-rejected branch (08-10)', () => {
  it('exposes gated=true when procedures.get returns {ok: false} (no crash)', async () => {
    const api = getApi();
    api.procedures.get.mockResolvedValue({ ok: false, code: 'IPC_LICENSE_INVALID' });
    api.procedures.listSegments.mockResolvedValue([]);
    api.procedureNotes.list.mockResolvedValue([]);
    api.screenshots.list.mockResolvedValue([]);

    const { result } = renderHook(() => useProcedures('proc-1'));

    await waitFor(() => expect(result.current.gated).toBe(true));
    // Page didn't crash on undefined reads.
    expect(result.current.procedure).toBeNull();
    expect(result.current.segments).toEqual([]);
    expect(result.current.notes).toEqual([]);
    expect(result.current.screenshots).toEqual([]);
    void act;
  });

  it('exposes gated=true when screenshots.list returns {ok: false} (any of the four branches flips gated)', async () => {
    const api = getApi();
    api.procedures.get.mockResolvedValue({
      id: 'proc-1',
      patientId: 'pat-1',
      doctorId: 'doc-1',
      startedAt: 0,
      endedAt: null,
      durationSeconds: 0,
      status: 'completed',
      videoPath: 'data/media/x.mp4',
      videoPathOriginal: null,
      presetSummary: { kind: 'sd', resolution: '720x480', framerate: 30, bitrate: '4M' },
      audioDeviceName: null,
      createdAt: 0,
    });
    api.procedures.listSegments.mockResolvedValue([]);
    api.procedureNotes.list.mockResolvedValue([]);
    // The gate rejects on the screenshots channel — gated still flips.
    api.screenshots.list.mockResolvedValue({ ok: false, code: 'IPC_LICENSE_EXPIRED' });

    const { result } = renderHook(() => useProcedures('proc-1'));

    await waitFor(() => expect(result.current.gated).toBe(true));
  });
});
