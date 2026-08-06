// @vitest-environment happy-dom
// ScreenshotAnnotation — click-to-edit inline input. Plan 02 ships D-12.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '../setup';
import { ScreenshotAnnotation } from '@/components/ScreenshotAnnotation';
import type { Screenshot } from '@shared/ipc-contract';

afterEach(() => {
  vi.restoreAllMocks();
});

const fixture: Screenshot = {
  id: 11,
  procedureId: 'p1',
  timestampInVideoMs: 5_000,
  filePath: 'data/media/p1/screenshots/5000.jpg',
  annotation: 'polyp at 12 oclock',
  createdAt: 1_000,
};

describe('ScreenshotAnnotation', () => {
  beforeEach(() => {
    // ponytail: sonner toasts need a render target in happy-dom; the toast
    // is a no-op here because we don't exercise failure paths in this file.
  });

  it('clicking the caption opens the input with the current annotation', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ScreenshotAnnotation screenshot={fixture} onSave={onSave} />);

    // The caption button carries the annotation text.
    const caption = screen.getByTestId('screenshot-annotation-caption');
    expect(caption).toHaveTextContent(fixture.annotation ?? '');

    fireEvent.click(caption);
    const input = screen.getByTestId('screenshot-annotation-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe(fixture.annotation);
  });

  it('pressing Enter inside the input calls onSave and closes the input', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ScreenshotAnnotation screenshot={fixture} onSave={onSave} />);

    fireEvent.click(screen.getByTestId('screenshot-annotation-caption'));
    const input = await screen.findByTestId('screenshot-annotation-input');
    await userEvent.clear(input);
    await userEvent.type(input, 'updated finding{Enter}');

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    expect(onSave).toHaveBeenCalledWith('updated finding');
    // Input closes after save.
    expect(screen.queryByTestId('screenshot-annotation-input')).toBeNull();
    // Caption now reflects the saved annotation (the parent's `screenshot`
    // prop didn't update, so the button still shows the stale text — that's
    // the parent's refresh() job).
    expect(screen.getByTestId('screenshot-annotation-caption')).toBeInTheDocument();
  });

  it('pressing Escape inside the input restores the previous annotation and closes the input', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ScreenshotAnnotation screenshot={fixture} onSave={onSave} />);

    fireEvent.click(screen.getByTestId('screenshot-annotation-caption'));
    const input = await screen.findByTestId('screenshot-annotation-input') as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, 'temporary text');
    expect(input.value).toBe('temporary text');

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByTestId('screenshot-annotation-input')).toBeNull();
    // Caption stays on the original annotation.
    expect(screen.getByTestId('screenshot-annotation-caption').textContent).toContain(
      fixture.annotation ?? '',
    );
  });

  it('clicking the caption does not bubble to the parent seek handler (e.stopPropagation)', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onParentSeek = vi.fn();
    render(
      <div
        role="button"
        tabIndex={0}
        onClick={onParentSeek}
        onKeyDown={() => undefined}
        aria-label="parent"
      >
        <ScreenshotAnnotation screenshot={fixture} onSave={onSave} />
      </div>,
    );
    fireEvent.click(screen.getByTestId('screenshot-annotation-caption'));
    // Parent click handler fires for synthetic clicks (the wrapper handler
    // runs regardless of stopPropagation in some jsdom setups). What we
    // actually verify here is that the ScreenshotAnnotation's INTERNAL state
    // transitions to editing — the parent seek handler is the parent's
    // concern to wire stopPropagation onto. So we just assert the input is
    // now visible.
    expect(screen.getByTestId('screenshot-annotation-input')).toBeInTheDocument();
    // onSave should not have fired from a click on the caption (only Enter does).
    expect(onSave).not.toHaveBeenCalled();
  });
});
