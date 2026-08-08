// @vitest-environment happy-dom
// useAutoSave — the save state machine that ProfileEditor + ReportEditor
// compose. The tests below lock the four behaviors the editors rely on:
// idle → saving → saved on resolve; idle → saving → error on reject;
// no auto-fire on value change; cleanup cancels pending debounce on
// unmount.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import '../setup';
import { useAutoSave } from '@/hooks/useAutoSave';

afterEach(() => {
  vi.useRealTimers();
});

describe('useAutoSave', () => {
  it('trigger() with a resolving onSave transitions idle → saving → saved', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useAutoSave({ value: { a: 1 }, onSave, debounceMs: 100 }),
    );
    expect(result.current.status).toBe('idle');
    act(() => result.current.trigger());
    // After 100ms the debounce fires the wrapped fn which setStatus('saving')
    // synchronously inside the awaited microtask.
    await act(async () => {
      vi.advanceTimersByTime(100);
      // Let the microtask queue drain so the awaited onSave resolves.
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('saved');
    expect(result.current.savedAt).not.toBeNull();
  });

  it('trigger() with a rejecting onSave transitions idle → saving → error', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() =>
      useAutoSave({ value: { a: 1 }, onSave, debounceMs: 100 }),
    );
    act(() => result.current.trigger());
    await act(async () => {
      vi.advanceTimersByTime(100);
      // Drain the rejection microtask.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('error');
  });

  it('does NOT auto-fire on value change without trigger()', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ v }: { v: { a: number } }) =>
        useAutoSave({ value: v, onSave, debounceMs: 100 }),
      { initialProps: { v: { a: 1 } } },
    );
    expect(result.current.status).toBe('idle');
    // Mutate value (simulates a keystroke landing in the editor).
    rerender({ v: { a: 2 } });
    rerender({ v: { a: 3 } });
    vi.advanceTimersByTime(500);
    expect(onSave).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  it('unmount cancels the pending debounce (no late setStatus on an unmounted hook)', () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() =>
      useAutoSave({ value: { a: 1 }, onSave, debounceMs: 100 }),
    );
    act(() => result.current.trigger());
    unmount();
    vi.advanceTimersByTime(500);
    expect(onSave).not.toHaveBeenCalled();
  });
});