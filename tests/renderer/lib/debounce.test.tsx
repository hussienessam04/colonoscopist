// @vitest-environment happy-dom
// debounce — the closure-based primitive that useAutoSave composes.
// Two tests cover the cancellation semantics that the state machine
// relies on.

import { describe, expect, it, vi } from 'vitest';
import '../setup';
import { debounce } from '@/lib/debounce';

describe('debounce', () => {
  it('only the last call within the window invokes fn', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d.call('a');
    d.call('b');
    d.call('c');
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('c');
    vi.useRealTimers();
  });

  it('cancel() prevents the pending invocation from firing', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d.call('a');
    d.cancel();
    vi.advanceTimersByTime(500);
    expect(fn).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});