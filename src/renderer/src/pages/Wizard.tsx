// First-launch wizard. Per D-01: collects full name + clinic name + 4-digit PIN +
// confirmation, submits to auth.wizard, then logs the admin in so the user lands on
// the Patient List. Wizard is the only path that creates the admin.

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { useRoute } from '@/lib/router';
import { session } from '@/store/session';
import { wizardInput } from '@shared/validators';

type FormValues = z.infer<typeof wizardInput>;

export default function Wizard(): JSX.Element {
  const { navigate } = useRoute();
  const [submitting, setSubmitting] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(wizardInput),
    defaultValues: { fullName: '', clinicName: '', pin: '', confirmPin: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      const result = await window.api.auth.wizard({
        fullName: values.fullName,
        clinicName: values.clinicName,
        pin: values.pin,
        confirmPin: values.confirmPin,
      });
      // per Plan 02-01 deviation #6 — wizardBootstrap does NOT log the user in.
      // Log the new admin in immediately so they land on the patient list.
      const loginResult = await window.api.auth.login({ userId: result.userId, pin: values.pin });
      if (!loginResult.ok) {
        toast.error('Wizard succeeded but auto-login failed. Please sign in manually.');
        await session.refresh();
        navigate({ name: 'login' });
        return;
      }
      await session.setAfterLogin();
      toast.success('Welcome — clinic ready.');
      navigate({ name: 'patients' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Wizard failed';
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <main className="min-h-screen grid place-items-center bg-slate-50 p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Set up your clinic</CardTitle>
          <CardDescription>
            First-time setup — create the admin PIN. This PIN unlocks the app and lets you add other staff.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-2">
              <Label htmlFor="fullName">Your full name</Label>
              <Input
                id="fullName"
                autoComplete="name"
                {...register('fullName')}
                aria-invalid={!!errors.fullName}
              />
              {errors.fullName && (
                <p role="alert" className="text-sm text-destructive">
                  {errors.fullName.message ?? 'Full name is required'}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="clinicName">Clinic name</Label>
              <Input
                id="clinicName"
                autoComplete="organization"
                {...register('clinicName')}
                aria-invalid={!!errors.clinicName}
              />
              {errors.clinicName && (
                <p role="alert" className="text-sm text-destructive">
                  {errors.clinicName.message ?? 'Clinic name is required'}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="pin">4-digit PIN</Label>
              <Input
                id="pin"
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={4}
                autoComplete="off"
                {...register('pin')}
                aria-invalid={!!errors.pin}
              />
              {errors.pin && (
                <p role="alert" className="text-sm text-destructive">
                  {errors.pin.message ?? 'PIN must be exactly 4 digits'}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="confirmPin">Confirm PIN</Label>
              <Input
                id="confirmPin"
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={4}
                autoComplete="off"
                {...register('confirmPin')}
                aria-invalid={!!errors.confirmPin}
              />
              {errors.confirmPin && (
                <p role="alert" className="text-sm text-destructive">
                  {errors.confirmPin.message ?? 'PINs must match'}
                </p>
              )}
            </div>

            <Button type="submit" disabled={submitting} className="mt-2">
              {submitting ? 'Setting up…' : 'Finish setup'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
