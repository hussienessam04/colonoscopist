// Route store — tracks the current and previous state-based routes.
// Existing renderer pages receive `route` as a compatibility alias for `current`.

import { useSyncExternalStore } from 'react';
import type { Route } from '@/lib/router';

type RouteState = {
  current: Route;
  previous: Route | null;
};

let state: RouteState = {
  current: { name: 'login' },
  previous: null,
};

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): RouteState {
  return state;
}

export function getRoute(): Route {
  return state.current;
}

export function setRoute(next: Route): void {
  state = { current: next, previous: null };
  emit();
}

export function navigate(next: Route): void {
  state = { current: next, previous: state.current };
  emit();
}

export function useRoute(): {
  route: Route;
  current: Route;
  previous: Route | null;
  navigate: (next: Route) => void;
} {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    route: snapshot.current,
    current: snapshot.current,
    previous: snapshot.previous,
    navigate,
  };
}
