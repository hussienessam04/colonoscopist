// State-based router shell. On mount: auth.status() decides wizard vs login (per D-01 + Fix 4).
// Re-fetches status when window regains focus so wizard->login transition survives a hot reload.

import { useEffect } from 'react';
import { useRoute } from '@/lib/router';
import { session, useSession } from '@/store/session';
import Wizard from './pages/Wizard';
import Login from './pages/Login';

export default function App(): JSX.Element {
  const { route, navigate } = useRoute();
  const { status, loading } = useSession();

  useEffect(() => {
    void session.refresh();
  }, []);

  // First-launch routing: auth.status() returns hasUsers=false on a fresh DB.
  useEffect(() => {
    if (loading || !status) return;
    if (route.name === 'wizard' || route.name === 'login') {
      if (!status.hasUsers) {
        if (route.name !== 'wizard') navigate({ name: 'wizard' });
      } else {
        // has users — if not signed in, force login
        if (!status.authenticated && route.name !== 'login') {
          navigate({ name: 'login' });
        }
      }
    }
  }, [status, loading, route, navigate]);

  if (loading || !status) {
    return (
      <main className="min-h-screen grid place-items-center bg-slate-50">
        <p className="text-sm text-slate-500">Loading…</p>
      </main>
    );
  }

  switch (route.name) {
    case 'wizard':
      return <Wizard />;
    case 'login':
    case 'patients':
    case 'patient-new':
    case 'patient-edit':
    case 'patient-detail':
    case 'settings-users':
      // Patients + settings are wired in Task 3; for now any non-wizard route
      // lands on the login screen.
      return <Login />;
  }
}
