// State-based router — no external routing library.
// Routes are a tagged union; current/previous state lives in store/route.ts.

export type Route =
  | { name: 'wizard' }
  | { name: 'login' }
  | { name: 'patients' }
  | { name: 'patient-new' }
  | { name: 'patient-edit'; id: string }
  | { name: 'patient-detail'; id: string }
  | { name: 'settings-hub' }
  | { name: 'settings-users' }
  | { name: 'settings-capture' }
  | { name: 'procedure-preview'; patientId: string; procedureId?: string }
  | { name: 'procedure-room'; patientId: string; procedureId: string }
  | { name: 'procedure-review'; procedureId: string }
  // Phase 6 / Plan 01 — Doctor profile editor (PROF-01) + report editor
  // (RPT-01..05). `report-editor` carries the optional `reportId` so the
  // renderer can navigate with the resolved id after `getOrCreate` —
  // avoids a second round-trip on every report editor mount.
  | { name: 'profile-edit' }
  | { name: 'report-editor'; procedureId: string; reportId?: string }
  // Phase 7 / Plan 07-02 — D-05 + D-11: SettingsSidebar visual entries for
  // Audit (Plan 07-03 fills the page) + Backup & Restore (Plan 07-05 fills
  // the page). The route variants exist NOW so the sidebar's `navigate()`
  // calls compile; the page bodies land in the later plans. No admin gate
  // per UI-SPEC §Implementation Bindings — every doctor sees them.
  | { name: 'audit' }
  | { name: 'backup-restore' }
  // Quick task 20260811 — Patient procedures surface moved out of the
  // Patient List accordion (reverted) into its own page, reached via
  // "View procedures" on the patient actions dropdown.
  | { name: 'patient-procedures'; patientId: string }
  // Phase 8 / Plan 05 — License sub-page (LIC-03). Reached via
  // SettingsSidebar; the boot-time <LicenseGate> modal navigates here
  // on the 'Activate now' button click. The route carries no params.
  | { name: 'license' };

export const initialRoute: Route = { name: 'login' };

export { getRoute, setRoute, navigate, useRoute } from '@/store/route';
