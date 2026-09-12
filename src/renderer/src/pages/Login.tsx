// Two-step login (per D-05/D-06/D-07/D-08):
//   Step 1: list users (avatar + name + last-login); tap row -> step 2.
//   Step 2: PIN entry; on success -> patients route.
// "Forgot admin PIN?" affordance renders <RecoveryFilePicker /> per D-04 + Fix 7.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import UserPicker from '@/components/UserPicker';
import PinEntry from '@/components/PinEntry';
import RecoveryFilePicker from '@/pages/RecoveryFilePicker';
import { useRoute } from '@/lib/router';
import { session } from '@/store/session';
import type { UserPublic } from '@shared/ipc-contract';

export default function Login(): JSX.Element {
  const { t } = useTranslation();
  const { navigate } = useRoute();
  const [users, setUsers] = useState<UserPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<UserPublic | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await window.api.auth.usersList();
      if (cancelled) return;
      setUsers(list);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onPinSuccess(_user: UserPublic): Promise<void> {
    await session.setAfterLogin();
    setSelected(null);
    navigate({ name: 'patients' });
  }

  return (
    <main className="min-h-screen grid place-items-center bg-slate-50 p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('auth.title')}</CardTitle>
          <CardDescription>
            {selected ? t('auth.pinDescription') : t('auth.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground text-center">{t('auth.loadingUsers')}</p>
          ) : selected ? (
            <PinEntry
              user={selected}
              onBack={() => setSelected(null)}
              onSuccess={onPinSuccess}
            />
          ) : users.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center">
              {t('auth.noUsers')}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {users.map((u) => (
                <UserPicker key={u.id} user={u} onSelect={setSelected} />
              ))}
              <div className="flex justify-center pt-2">
                <RecoveryFilePicker />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
