// Session store — NO zustand dep. Per Plan 02-03 + AUTH-04 + D-02.
// `useSyncExternalStore` keeps the surface tiny; exposes a `session.currentUserId`
// + `clinicName` + `isFirstAdmin` + `isAuthenticated` snapshot plus `refresh()` +
// `signOut()` mutators.

import { useSyncExternalStore } from 'react';
import type { AuthStatus, UserPublic } from '@shared/ipc-contract';

type SessionState = {
  status: AuthStatus | null;
  loading: boolean;
  currentUser: UserPublic | null;
};

let state: SessionState = {
  status: null,
  loading: true,
  currentUser: null,
};

const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): SessionState {
  return state;
}

async function refresh(): Promise<void> {
  if (typeof window === 'undefined' || !('api' in window)) {
    state = { ...state, loading: false };
    emit();
    return;
  }
  const status = await window.api.auth.status();
  // ponytail: tolerate undefined status (e.g. when the mock hasn't been seeded
  // yet for a particular test) — leave loading=false + null currentUser.
  if (!status) {
    state = { status: null, loading: false, currentUser: null };
    emit();
    return;
  }
  let currentUser: UserPublic | null = null;
  if (status.authenticated && status.userId) {
    const users = await window.api.auth.usersList();
    currentUser = users.find((u) => u.id === status.userId) ?? null;
  }
  state = { status, loading: false, currentUser };
  emit();
}

async function signOut(): Promise<void> {
  await window.api.auth.logout();
  await refresh();
}

// Set after wizard or login — refresh then notify.
async function setAfterLogin(): Promise<void> {
  await refresh();
}

export const session = {
  refresh,
  signOut,
  setAfterLogin,
  // ponytail: explicit reset for tests + dev hot-reload.
  reset: () => {
    state = { status: null, loading: true, currentUser: null };
    emit();
  },
};

export function useSession(): {
  status: AuthStatus | null;
  loading: boolean;
  currentUser: UserPublic | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
} {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    status: snapshot.status,
    loading: snapshot.loading,
    currentUser: snapshot.currentUser,
    refresh,
    signOut,
  };
}
