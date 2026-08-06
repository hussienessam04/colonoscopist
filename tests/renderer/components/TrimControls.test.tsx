// @vitest-environment happy-dom
// TrimControls — right-rail trim action panel.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '../setup';
import { TrimControls } from '@/components/TrimControls';

beforeEach(() => {
  // Setup installs mockApi() + the initialRoute + session.reset().
});

describe('TrimControls', () => {
  const baseProps = {
    status: 'completed' as const,
    videoPathOriginal: 'video.mp4',
    inMs: 2_000,
    outMs: 10_000,
    trimMode: true,
    setTrimMode: vi.fn(),
    applying: false,
    restoring: false,
    apply: vi.fn().mockResolvedValue(undefined),
    restore: vi.fn().mockResolvedValue(undefined),
  };

  it('renders the Apply + Restore buttons when trimMode=true', () => {
    render(<TrimControls {...baseProps} />);
    expect(screen.getByTestId('trim-apply')).toBeInTheDocument();
    expect(screen.getByTestId('trim-restore')).toBeInTheDocument();
  });

  it('shows the in/out labels when trimMode=true', () => {
    render(<TrimControls {...baseProps} />);
    expect(screen.getByTestId('trim-range-labels')).toBeInTheDocument();
    expect(screen.getByTestId('trim-in-label')).toHaveTextContent('00:00:02');
    expect(screen.getByTestId('trim-out-label')).toHaveTextContent('00:00:10');
  });

  it('disables Apply when status is partial (D-13 partial gate)', () => {
    render(<TrimControls {...baseProps} status="partial" />);
    expect(screen.getByTestId('trim-apply')).toBeDisabled();
  });

  it('disables Restore when videoPathOriginal is null (no prior trim)', () => {
    render(<TrimControls {...baseProps} videoPathOriginal={null} />);
    expect(screen.getByTestId('trim-restore')).toBeDisabled();
  });

  it('disables Apply when inMs >= outMs (invalid range)', () => {
    render(<TrimControls {...baseProps} inMs={10_000} outMs={10_000} />);
    expect(screen.getByTestId('trim-apply')).toBeDisabled();
  });

  it('disables both buttons while applying=true / restoring=true', () => {
    const { rerender } = render(<TrimControls {...baseProps} applying={true} />);
    expect(screen.getByTestId('trim-apply')).toBeDisabled();
    // ponytail: rerender mutates the existing tree rather than appending
    // a second copy (the cleanup would otherwise collide on the same
    // testid). Both buttons are present in trimMode=true.
    rerender(<TrimControls {...baseProps} restoring={true} />);
    expect(screen.getByTestId('trim-restore')).toBeDisabled();
  });

  it('calls apply when Apply button is clicked', () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    render(<TrimControls {...baseProps} apply={apply} />);
    fireEvent.click(screen.getByTestId('trim-apply'));
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('calls restore when Restore button is clicked', () => {
    const restore = vi.fn().mockResolvedValue(undefined);
    render(<TrimControls {...baseProps} restore={restore} />);
    fireEvent.click(screen.getByTestId('trim-restore'));
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it('hides the in/out range + buttons when trimMode=false', () => {
    render(<TrimControls {...baseProps} trimMode={false} />);
    expect(screen.queryByTestId('trim-apply')).toBeNull();
    expect(screen.queryByTestId('trim-restore')).toBeNull();
    expect(screen.queryByTestId('trim-range-labels')).toBeNull();
  });

  it('calls setTrimMode when the toggle button is clicked', () => {
    const setTrimMode = vi.fn();
    render(<TrimControls {...baseProps} trimMode={false} setTrimMode={setTrimMode} />);
    fireEvent.click(screen.getByTestId('trim-mode-toggle'));
    expect(setTrimMode).toHaveBeenCalledWith(true);
  });
});
