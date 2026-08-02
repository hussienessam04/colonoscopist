// State-based router shell. On mount: auth.status() decides wizard vs login (per D-01 + Fix 4).
// Other routes (patients / patient-new / patient-edit / patient-detail / settings-users) require
// the user to be authenticated; otherwise the router falls back to login.

import { useEffect } from 'react';
import { useRoute } from '@/lib/router';
import { session, useSession } from '@/store/session';
import Wizard from './pages/Wizard';
import Login from './pages/Login';
import PatientsList from './pages/PatientsList';
import PatientForm from './pages/PatientForm';
import SettingsUsers from './pages/SettingsUsers';
import ProcedureRoom from './pages/ProcedureRoom';

export default function App(): JSX.Element {
  const { route, navigate } = useRoute();
  const { status, loading, currentUser } = useSession();

  useEffect(() => {
    void session.refresh();
  }, []);

  // First-launch + auth gating.
  useEffect(() => {
    if (loading || !status) return;
    if (route.name === 'wizard' || route.name === 'login') {
      if (!status.hasUsers) {
        if (route.name !== 'wizard') navigate({ name: 'wizard' });
        return;
      }
      if (!status.authenticated && route.name !== 'login') {
        navigate({ name: 'login' });
        return;
      }
    } else {
      // Authenticated-only routes — bounce to login if not signed in.
      if (!status.authenticated) {
        navigate({ name: 'login' });
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

  if (status.authenticated && !currentUser) {
    return (
      <main className="min-h-screen grid place-items-center bg-slate-50">
        <p className="text-sm text-slate-500">Loading user…</p>
      </main>
    );
  }

  switch (route.name) {
    case 'wizard':
      return <Wizard />;
    case 'login':
      return <Login />;
    case 'patients':
      return <PatientsList />;
    case 'patient-new':
      return <PatientForm mode="create" />;
    case 'patient-edit':
      return <PatientForm mode="edit" patientId={route.id} />;
    case 'patient-detail':
      // Skeleton route — Phase 4 owns the procedure timeline.
      return (
        <main className="min-h-screen grid place-items-center bg-slate-50">
          <p className="text-sm text-slate-500">Patient detail (Phase 4) — id: {route.id}</p>
        </main>
      );
    case 'settings-users':
      return <SettingsUsers />;
    case 'settings-capture':
      return (
        <main className="min-h-screen bg-slate-50 p-6">
          <div className="mx-auto max-w-5xl">
            <h1 className="text-2xl font-semibold">Settings · Capture</h1>
            <p className="text-sm text-muted-foreground">
              Choose a default capture device and verify its quality preset.
            </p>
          </div>
        </main>
      );
    case 'procedure-room':
      return <ProcedureRoom />;
  }
}
