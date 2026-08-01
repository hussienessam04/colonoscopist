// PIN entry — 4-digit, type=password, back arrow per D-08, 10s idle clear,
// inline error messages for IPC_AUTH_FAILED / IPC_RATE_LIMITED / IPC_LOCKED /
// IPC_ENCRYPTION_UNAVAILABLE per D-07 + Fix 3.
// Live countdown for rate-limit + Locked badge per UAT G-2-3.

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { IpcErrorException } from '@shared/errors';
import type { UserPublic } from '@shared/ipc-contract';

type Props = {
  user: UserPublic;
  onBack: () => void;
  onSuccess: (user: UserPublic) => void;
};

export default function PinEntry({ user, onBack, onSuccess }: Props): JSX.Element {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [enterDisabled, setEnterDisabled] = useState(false);
  const [locked, setLocked] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // per D-08 — back arrow ALWAYS clears the PIN.
  function clearPin(): void {
    setPin('');
    setError(null);
    setEnterDisabled(false);
    setSecondsLeft(0);
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }

  // 10s idle timer clears the PIN field.
  function armIdleTimer(): void {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      setPin('');
    }, 10_000);
  }

  // Live countdown for IPC_RATE_LIMITED — decrements every second until 0.
  function startCountdown(retryAt: number): void {
    if (countdownRef.current) clearInterval(countdownRef.current);
    const tick = (): void => {
      const remaining = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining <= 0 && countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
        setError(null);
      }
    };
    tick();
    countdownRef.current = setInterval(tick, 1000);
  }

  useEffect(() => {
    inputRef.current?.focus();
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  function handlePinChange(value: string): void {
    setPin(value);
    setEnterDisabled(false);
    armIdleTimer();
  }

  async function submit(): Promise<void> {
    if (pin.length !== 4 || submitting || locked || secondsLeft > 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await window.api.auth.login({ userId: user.id, pin });
      if (result.ok) {
        if (idleTimer.current) clearTimeout(idleTimer.current);
        onSuccess(result.user);
        return;
      }
      // LoginResult tagged union.
      if (result.code === 'IPC_AUTH_FAILED') {
        setError('Incorrect PIN');
        setPin('');
        setEnterDisabled(true);
        inputRef.current?.focus();
      } else if (result.code === 'IPC_RATE_LIMITED') {
        const retryAt = result.retryAt ?? Date.now() + 1000;
        startCountdown(retryAt);
        setError('Try again in');
      } else if (result.code === 'IPC_LOCKED') {
        setLocked(true);
        setError('Account locked — contact admin');
      } else {
        setError('Sign-in failed');
      }
    } catch (err) {
      // IPC_ERROR_UNAVAILABLE rises as a generic Error with the code attached.
      if (err instanceof IpcErrorException && err.ipc.code === 'IPC_ENCRYPTION_UNAVAILABLE') {
        setError('Encryption unavailable — see logs');
      } else {
        const msg = err instanceof Error ? err.message : 'Sign-in failed';
        setError(msg);
      }
      setPin('');
      inputRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submit();
    }
  }

  const enterDisabledNow = pin.length !== 4 || submitting || enterDisabled || locked || secondsLeft > 0;

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={() => {
          clearPin();
          onBack();
        }}
        className="self-start inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        aria-label="Back to user list"
      >
        <ArrowLeft className="size-4" />
        Back
      </button>

      <div className="flex flex-col items-center gap-2 text-center">
        <h2 className="text-lg font-semibold">Sign in as {user.fullName}</h2>
        <p className="text-xs text-muted-foreground">Enter your 4-digit PIN</p>
      </div>

      {locked && (
        <div
          role="status"
          aria-label="Account locked"
          className="inline-flex items-center justify-center gap-1.5 self-center rounded-md bg-destructive px-2.5 py-1 text-xs font-medium text-destructive-foreground"
          data-testid="locked-badge"
        >
          <Lock className="size-3.5" />
          Locked
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="pin" className="sr-only">PIN</Label>
        <Input
          id="pin"
          ref={inputRef}
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          autoComplete="off"
          value={pin}
          onChange={(e) => handlePinChange(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-invalid={!!error}
          disabled={locked}
        />
        {error && (
          <p role="alert" className="text-sm text-destructive text-center">
            {error}
            {secondsLeft > 0 && (
              <span className="ml-1 font-semibold tabular-nums" data-testid="countdown">{secondsLeft}s</span>
            )}
          </p>
        )}
      </div>

      <Button
        type="button"
        onClick={() => void submit()}
        disabled={enterDisabledNow}
      >
        {submitting ? 'Signing in…' : 'Enter'}
      </Button>
    </div>
  );
}
