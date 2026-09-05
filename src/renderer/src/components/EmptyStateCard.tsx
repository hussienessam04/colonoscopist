// ponytail: empty-state card for gated-IPC consumers when the gate
// returns {ok: false}. Renders above the LicenseGate modal-aware content
// with a "License required" message + an "Open License settings" button
// that navigates to the License sub-page (Plan 05).

import { useTranslation } from 'react-i18next';
import { useRoute } from '@/lib/router';

export function EmptyStateCard({ message }: { message?: string }): JSX.Element {
  const { t } = useTranslation();
  const { navigate } = useRoute();
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 p-8 text-center"
      data-testid="gated-empty-state"
    >
      <p className="text-sm text-muted-foreground">
        {message ?? t('license.emptyStateMessage')}
      </p>
      <button
        type="button"
        onClick={() => navigate({ name: 'license' })}
        className="text-sm font-medium text-primary underline"
        data-testid="gated-empty-state-open-license"
      >
        {t('license.emptyStateOpenLicense')}
      </button>
    </div>
  );
}
