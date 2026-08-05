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
import SettingsCapture from './pages/SettingsCapture';
import SettingsHub from './pages/SettingsHub';
import ProcedureRoom from './pages/ProcedureRoom';
import ProcedureReview from './pages/ProcedureReview';

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
    case 'settings-hub':
      return <SettingsHub />;
    case 'settings-users':
      return <SettingsUsers />;
    case 'settings-capture':
      return <SettingsCapture />;
    case 'procedure-room':
      return <ProcedureRoom />;
    case 'procedure-review':
      return <ProcedureReview procedureId={route.procedureId} />;
    default:
      // The only unhandled variant is `patient-detail`, preserved in the
      // Route union for backward-compat with persisted deep-links + audit
      // payloads, but never dispatched by App in Phase 3+ (the patient
      // surface is the Procedure Room, reached from PatientRow). Persisted
      // deep-links that still carry 'patient-detail' fall through to the
      // Patient List so the renderer never re-renders the Phase 1
      // placeholder.
      return <PatientsList />;
  }
}
