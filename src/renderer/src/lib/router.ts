// State-based router hook — no external routing library. Per Plan 02-03 D-04 + T-02-REN-04.
// Routes are a tagged union; deep-link URLs are a v2 upgrade.

import { useCallback, useEffect, useState } from 'react';

export type Route =
  | { name: 'wizard' }
  | { name: 'login' }
  | { name: 'patients' }
  | { name: 'patient-new' }
  | { name: 'patient-edit'; id: string }
  | { name: 'patient-detail'; id: string }
  | { name: 'settings-users' };

export const initialRoute: Route = { name: 'login' };

let listeners: Array<(r: Route) => void> = [];
let current: Route = initialRoute;

export function getRoute(): Route {
  return current;
}

export function setRoute(next: Route): void {
  current = next;
  for (const l of listeners) l(next);
}

export function navigate(route: Route): void {
  setRoute(route);
}

export function useRoute(): { route: Route; navigate: (r: Route) => void } {
  const [route, setLocal] = useState<Route>(current);
  useEffect(() => {
    const listener = (r: Route) => setLocal(r);
    listeners.push(listener);
    return () => {
      listeners = listeners.filter((l) => l !== listener);
    };
  }, []);
  const nav = useCallback((r: Route) => setRoute(r), []);
  return { route, navigate: nav };
}
