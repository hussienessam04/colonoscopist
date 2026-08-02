// State-based router — no external routing library.
// Routes are a tagged union; current/previous state lives in store/route.ts.

export type Route =
  | { name: 'wizard' }
  | { name: 'login' }
  | { name: 'patients' }
  | { name: 'patient-new' }
  | { name: 'patient-edit'; id: string }
  | { name: 'patient-detail'; id: string }
  | { name: 'settings-users' }
  | { name: 'settings-capture' }
  | { name: 'procedure-room'; patientId?: string };

export const initialRoute: Route = { name: 'login' };

export { getRoute, setRoute, navigate, useRoute } from '@/store/route';
