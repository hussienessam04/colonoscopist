// @vitest-environment happy-dom
// Plan 08-10 regression test — ProcedurePreview renders
// <EmptyStateCard> when procedures.create returns
// {ok: false, code: 'IPC_LICENSE_*'}.
//
// ProcedurePreview depends on `navigator.mediaDevices.enumerateDevices()`
// (via useCaptureDeviceMap). happy-dom doesn't ship that surface, so
// we stub it on `globalThis.navigator` before the page mounts. The stub
// returns [] so the capture list resolves empty — same shape the gate
// rejection would produce.

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../setup';
import { getApi } from '../setup';
import { setRoute } from '@/store/route';
import ProcedurePreview from '@/pages/ProcedurePreview';

// ponytail: stub navigator.mediaDevices BEFORE vitest scopes get set up.
// Vitest doesn't expose beforeAll in this file's import surface (only
// beforeEach is in scope), so we install the polyfill at module load
// time. happy-dom doesn't ship mediaDevices; without this stub
// ProcedurePreview crashes on first render.
{
  const nav = (globalThis as { navigator?: Navigator }).navigator;
  if (nav && !('mediaDevices' in nav)) {
    Object.defineProperty(nav, 'mediaDevices', {
      value: { enumerateDevices: (): MediaDeviceInfo[] => [] },
      configurable: true,
    });
  }
}

beforeEach(() => {
  setRoute({ name: 'procedure-preview', patientId: '00000000-0000-4000-8000-000000000001' });
  // Default the device map mock to a fast-resolving empty list so the
  // page's effect doesn't stall waiting on a mock that never settles.
  getApi().capture.listDevices.mockResolvedValue([]);
  getApi().capture.getDefaultDevice.mockResolvedValue(null);
});

describe('ProcedurePreview — gated-IPC graceful degrade (08-10)', () => {
  it('renders <EmptyStateCard> when procedures.create returns {ok: false, code: IPC_LICENSE_INVALID}', async () => {
    const api = getApi();
    api.procedures.create.mockResolvedValue({ ok: false, code: 'IPC_LICENSE_INVALID' });

    render(<ProcedurePreview />);

    // The Continue to recording button is the gate trigger.
    const btn = await waitFor(() => {
      const el = document.querySelector('[data-testid="continue-to-recording-button"]');
      if (!el) throw new Error('continue button not in DOM');
      return el as HTMLButtonElement;
    });
    fireEvent.click(btn);

    // After the gate rejection, EmptyStateCard appears. No crash —
    // the page stays mounted for the doctor to retry after activating.
    expect(await screen.findByTestId('gated-empty-state')).toBeInTheDocument();
    expect(api.procedures.create).toHaveBeenCalledWith({
      patientId: '00000000-0000-4000-8000-000000000001',
    });
    void vi;
  });
});
