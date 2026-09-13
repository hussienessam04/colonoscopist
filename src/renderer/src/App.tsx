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
import SettingsStorage from './pages/SettingsStorage';
import SettingsHub from './pages/SettingsHub';
import ProcedureRoom from './pages/ProcedureRoom';
import ProcedurePreview from './pages/ProcedurePreview';
import ProcedureReview from './pages/ProcedureReview';
import ProfileEditor from './pages/ProfileEditor';
import ReportEditor from './pages/ReportEditor';
// Phase 7 / Plan 07-03 — AUDIT-01 / AUDIT-02: read-only audit log
// viewer (Route.audit). The page body lands here; the route variant
// was added in Plan 07-02 so the SettingsSidebar's navigate() call
// compiles.
import Audit from './pages/Audit';
// Phase 7 / Plan 07-05 — SET-05 + SET-06: Backup & Restore page
// (Route.backup-restore). Same Story as Audit — the route variant
// landed in Plan 07-02; the page body lands here. Two side-by-side
// Cards per UI-SPEC §Implementation Bindings Backup & Restore layout.
import BackupRestore from './pages/BackupRestore';
// Quick task 20260811 — Patient procedures page reached from the
// PatientRow dropdown's "View procedures" item. The route variant
// landed in the same quick task.
import PatientProcedures from './pages/PatientProcedures';
// Phase 8 / Plan 08-05 — License sub-page (LIC-03) + boot-time
// <LicenseGate> modal (LIC-03 first-launch prompt per CONTEXT D-05).
// The modal is mounted ABOVE the route switch so it fires on
// `state: 'unactivated'` or `state: 'expired'` regardless of which
// authenticated route is active.
import LicenseGate from '@/components/LicenseGate';
import License from './pages/License';
// Quick task 20260912-q4g — Settings → About card (app name,
// version, developer contact). Mirrors License.tsx pattern.
import SettingsAbout from './pages/SettingsAbout';
// Quick task 20260913-5b0 — Settings → Diagnostics (workstation
// info + log path + license state). Mirrors SettingsAbout pattern.
import SettingsDiagnostics from './pages/SettingsDiagnostics';

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

  // Phase 8 / Plan 08-05 — LIC-03: wrap the route render in
  // <LicenseGate> so the boot-time activation modal appears above
  // EVERY authenticated route when status is `unactivated` or
  // `expired`. LicenseGate reads license.status() internally — the
  // modal surfaces immediately on first paint.
  let routeElement: JSX.Element;
  switch (route.name) {
    case 'wizard':
      routeElement = <Wizard />;
      break;
    case 'login':
      routeElement = <Login />;
      break;
    case 'patients':
      routeElement = <PatientsList />;
      break;
    case 'patient-new':
      routeElement = <PatientForm mode="create" />;
      break;
    case 'patient-edit':
      routeElement = <PatientForm mode="edit" patientId={route.id} />;
      break;
    case 'settings-hub':
      routeElement = <SettingsHub />;
      break;
    case 'settings-users':
      routeElement = <SettingsUsers />;
      break;
    case 'settings-capture':
      routeElement = <SettingsCapture />;
      break;
    case 'procedure-preview':
      routeElement = <ProcedurePreview />;
      break;
    case 'procedure-room':
      routeElement = <ProcedureRoom />;
      break;
    case 'procedure-review':
      routeElement = <ProcedureReview procedureId={route.procedureId} />;
      break;
    case 'profile-edit':
      routeElement = <ProfileEditor />;
      break;
    case 'report-editor':
      routeElement = (
        <ReportEditor procedureId={route.procedureId} reportId={route.reportId} />
      );
      break;
    case 'audit':
      routeElement = <Audit />;
      break;
    case 'backup-restore':
      routeElement = <BackupRestore />;
      break;
    case 'settings-storage':
      // Quick task 20260912-shared-database-optional —
      // Settings → Storage page (opt-in shared DB across
      // devices). Admin-only (toggling the shared DB affects
      // every record on this workstation); the sidebar button
      // is disabled for non-admins.
      routeElement = <SettingsStorage />;
      break;
    case 'license':
      routeElement = <License />;
      break;
    case 'settings-about':
      // Quick task 20260912-q4g — Settings → About (app name +
      // developer contact + version). Admin-irrelevant (every
      // doctor sees it), so no gate beyond authentication.
      routeElement = <SettingsAbout />;
      break;
    case 'settings-diagnostics':
      // Quick task 20260913-5b0 — Settings → Diagnostics
      // (workstation bundle for vendor support). Every doctor
      // sees it; the IPC channel is EXEMPT from the license
      // gate so an expired clinic can still copy the bundle.
      routeElement = <SettingsDiagnostics />;
      break;
    case 'patient-procedures':
      routeElement = <PatientProcedures patientId={route.patientId} />;
      break;
    default:
      // The only unhandled variant is `patient-detail`, preserved in the
      // Route union for backward-compat with persisted deep-links + audit
      // payloads, but never dispatched by App in Phase 3+ (the patient
      // surface is the Procedure Room, reached from PatientRow). Persisted
      // deep-links that still carry 'patient-detail' fall through to the
      // Patient List so the renderer never re-renders the Phase 1
      // placeholder.
      routeElement = <PatientsList />;
      break;
  }

  return <LicenseGate>{routeElement}</LicenseGate>;
}
