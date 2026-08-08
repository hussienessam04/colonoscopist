// Tiny reusable debounce primitive. The `useAutoSave` hook (Task 2)
// composes this for the save-on-blur state machine.
//
// ponytail: closure + setTimeout. No class, no React, no dependencies.
// The returned object is mutable — `call()` updates the internal
// timeout and `cancel()` clears it without invoking. Both are pure
// control methods; the wrapped `fn` is the only side effect.

export type Debounced<T extends (...args: never[]) => void> = {
  call: (...args: Parameters<T>) => void;
  cancel: () => void;
};

export function debounce<T extends (...args: never[]) => void>(
  fn: T,
  ms: number,
): Debounced<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  return {
    call(...args: Parameters<T>): void {
      if (timeoutId !== null) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        timeoutId = null;
        fn(...args);
      }, ms);
    },
    cancel(): void {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    },
  };
}