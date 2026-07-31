import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { AuthStatus } from '@shared/ipc-contract';

export default function Login(): JSX.Element {
  const [status, setStatus] = useState<AuthStatus | null>(null);

  useEffect(() => {
    void window.api.auth.status().then(setStatus);
  }, []);

  return (
    <main className="min-h-screen grid place-items-center bg-slate-50 p-6">
      <section className="w-full max-w-sm flex flex-col items-center gap-6">
        <div
          aria-label="Clinic logo placeholder"
          className="w-32 h-32 rounded-lg bg-slate-200 grid place-items-center text-slate-500 text-sm font-medium"
        >
          Clinic Logo
        </div>

        <div className="w-full flex flex-col gap-2">
          <Label htmlFor="pin" className="sr-only">
            PIN
          </Label>
          <Input
            id="pin"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            disabled
            placeholder="Enter PIN"
            autoComplete="off"
          />
        </div>

        <Button disabled className="w-full">
          Enter
        </Button>

        <p className="text-sm text-slate-500 text-center">
          Auth ships in Phase 2 — PIN input is disabled
        </p>

        {status && (
          <pre
            aria-live="polite"
            className="text-xs text-slate-400 font-mono break-all text-center"
          >
            {JSON.stringify(status)}
          </pre>
        )}
      </section>
    </main>
  );
}
