// LicenseGate — boot-time activation modal (LIC-03).
//
// Per CONTEXT D-05 + RESEARCH §Pattern 5:
//   1. On every mount, fetch the current LicenseStatus via
//      useLicenseStatus().
//   2. If state is `unactivated` or `expired`, render the activation
//      modal ABOVE the route children — the modal sits in a Dialog so
//      the user has to dismiss it explicitly.
//   3. The modal has two buttons:
//      a. "Activate now" — navigates to the License sub-page after
//         dismissing (sets the sessionStorage flag so the modal does
//         not immediately re-show on the sub-page mount).
//      b. "Continue in trial" — only shown when state is `unactivated`.
//         For `expired`, the button is omitted entirely (the trial is
//         already over).
//   4. The sessionStorage flag `license.modal.dismissed === '1'`
//      suppresses the modal for the rest of the session. Per CONTEXT
//      agent discretion — a doctor who clicked "Continue in trial"
//      should not see the modal again until the next launch or until
//      expiry.
//
// Threat-model notes (from Plan 08-05's threat model):
//   T-08-U01: the modal is cosmetic; the IPC gate (Plan 03) is the
//             actual enforcement. Even if the modal is hidden, gated
//             IPC channels are unreachable without a valid license.
//   T-08-U02: manipulating the sessionStorage flag only re-triggers /
//             hides the modal — it does not grant license validity.
//
// Per-plan verbatim: file is mounted ABOVE the switch in App.tsx so
// the modal appears above every authenticated route when status is
// `unactivated` or `expired`. The `wizard` and `login` routes are
// exempt: they are first-launch entry points and gating them with
// the activation modal is contradictory (see G-08-3).

import { useState, type ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';
import { useRoute } from '@/lib/router';
import { useLicenseStatus } from '@/hooks/useLicenseStatus';

const SESSION_STORAGE_KEY = 'license.modal.dismissed';

export function LicenseGate({ children }: { children: ReactNode }): JSX.Element {
  const { status } = useLicenseStatus();
  const { route, navigate } = useRoute();
  const { t } = useTranslation();
  const [dismissedThisSession, setDismissedThisSession] = useState(
    () => sessionStorage.getItem(SESSION_STORAGE_KEY) === '1',
  );

  // ponytail: short-circuit on four early-return cases — status not
  // loaded yet, already dismissed this session, license state is
  // fine, OR the active route is `wizard` / `login` (first-launch
  // entry points; gating them with the activation modal is
  // contradictory UX — see G-08-3). The showModal predicate stays a
  // single boolean so the JSX reads naturally without nesting
  // ternaries.
  const showModal =
    !dismissedThisSession &&
    status !== null &&
    (status.state === 'unactivated' || status.state === 'expired') &&
    route.name !== 'wizard' &&
    route.name !== 'login';

  function dismiss(): void {
    sessionStorage.setItem(SESSION_STORAGE_KEY, '1');
    setDismissedThisSession(true);
  }

  function activate(): void {
    dismiss();
    navigate({ name: 'license' });
  }

  const bodyText =
    status?.state === 'expired'
      ? t('license.modalExpiredBody')
      : t('license.modalUnactivatedBody');
  const showContinueTrial = status?.state === 'unactivated';

  return (
    <>
      {children}
      <Dialog open={showModal}>
        <DialogContent data-testid="license-gate-modal">
          <DialogHeader>
            <DialogTitle>{t('license.modalTitle')}</DialogTitle>
            <DialogDescription>{bodyText}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            {showContinueTrial ? (
              <Button
                variant="outline"
                onClick={dismiss}
                data-testid="license-gate-continue-trial"
              >
                {t('license.continueTrial')}
              </Button>
            ) : null}
            <Button onClick={activate} data-testid="license-gate-activate-now">
              {t('license.activateNow')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default LicenseGate;
