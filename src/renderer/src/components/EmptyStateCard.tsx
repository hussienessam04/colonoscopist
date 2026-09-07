// ponytail: empty-state card for gated-IPC consumers when the gate
// returns {ok: false}. Renders above the LicenseGate modal-aware content
// with a "License required" message + an "Open License settings" button
// that navigates to the License sub-page (Plan 05).
//
// ponytail: default export — every consumer page imports it as
// `import EmptyStateCard from '@/components/EmptyStateCard'`. The named
// export is preserved for tree-shakers that prefer a named import.

import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useRoute } from '@/lib/router';

export function EmptyStateCard({ message }: { message?: string }): JSX.Element {
  const { t } = useTranslation();
  const { navigate } = useRoute();
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 p-8 text-center"
      data-testid="gated-empty-state"
    >
      <p className="text-sm text-[#5C6770]">
        {message ?? t('license.emptyStateMessage')}
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={() => navigate({ name: 'license' })}
        data-testid="gated-empty-state-open-license"
        className="border-[#E0D9C6] bg-white text-[#5C6770] hover:border-[#0E3A47] hover:bg-[#E6EFF1] hover:text-[#0E3A47]"
      >
        {t('license.emptyStateOpenLicense')}
      </Button>
    </div>
  );
}

export default EmptyStateCard;
