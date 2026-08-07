// @vitest-environment happy-dom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '../setup';
import { getApi } from '../setup';
import { useScreenshotIntake } from '@/hooks/useScreenshotIntake';
import type { Screenshot } from '@shared/ipc-contract';

const procedureId = 'proc-1';
const screenshots: Screenshot[] = [
  {
    id: 1,
    procedureId,
    timestampInVideoMs: 1_000,
    filePath: 'data/media/patients/pat-1/proc-1/screenshots/1000.jpg',
    annotation: null,
    createdAt: 1_000,
  },
  {
    id: 2,
    procedureId,
    timestampInVideoMs: 2_000,
    filePath: 'data/media/patients/pat-1/proc-1/screenshots/2000.jpg',
    annotation: null,
    createdAt: 2_000,
  },
];

function renderIntake() {
  return renderHook(() =>
    useScreenshotIntake({
      procedureId,
      sourceRef: { current: null },
      isRecording: false,
      startedAt: null,
    }),
  );
}

describe('useScreenshotIntake delete UX (G-05-13)', () => {
  it('remove(id) filters the local screenshots array and does NOT call the delete IPC (G-05-13)', async () => {
    const api = getApi();
    api.screenshots.list.mockResolvedValue(screenshots);
    const { result } = renderIntake();
    await waitFor(() => expect(result.current.screenshots).toHaveLength(2));

    expect(result.current.remove).toBeTypeOf('function');
    act(() => result.current.remove(1));

    expect(result.current.screenshots).toHaveLength(1);
    expect(result.current.screenshots.some((row) => row.id === 1)).toBe(false);
    expect(api.screenshots.delete).not.toHaveBeenCalled();
  });

  it('remove(id) for an unknown id is a no-op (G-05-13)', async () => {
    const api = getApi();
    api.screenshots.list.mockResolvedValue(screenshots);
    const { result } = renderIntake();
    await waitFor(() => expect(result.current.screenshots).toHaveLength(2));
    const before = result.current.screenshots;

    expect(result.current.remove).toBeTypeOf('function');
    act(() => result.current.remove(9_999));

    expect(result.current.screenshots).toHaveLength(2);
    expect(result.current.screenshots).toEqual(before);
  });

  it('refresh() re-fetches from IPC and replaces local state (G-05-13)', async () => {
    const api = getApi();
    api.screenshots.list.mockResolvedValue(screenshots);
    const { result } = renderIntake();
    await waitFor(() => expect(result.current.screenshots).toHaveLength(2));

    expect(result.current.remove).toBeTypeOf('function');
    act(() => result.current.remove(1));
    expect(result.current.screenshots).toHaveLength(1);

    api.screenshots.list.mockResolvedValue([...screenshots]);
    expect(result.current.refresh).toBeTypeOf('function');
    await act(async () => result.current.refresh());

    expect(result.current.screenshots).toHaveLength(2);
    expect(api.screenshots.list).toHaveBeenCalledTimes(2);
    expect(api.screenshots.list).toHaveBeenLastCalledWith({ procedureId });
  });
});
