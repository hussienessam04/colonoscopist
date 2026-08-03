// Settings → Users (admin only). Per D-02 + D-03 + SET-04.
// Lists users, allows add / reset PIN / remove (admin cannot remove themselves).
import { useEffect, useState } from 'react';
import { ArrowLeft, MoreHorizontal, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useRoute } from '@/lib/router';
import { useSession } from '@/store/session';
import { SettingsSidebar } from '@/components/SettingsSidebar';
import { relativeTime } from '@/lib/format';
import { toast } from 'sonner';
import { IpcErrorException } from '@shared/errors';
import { userInput } from '@shared/validators';
import type { UserPublic } from '@shared/ipc-contract';

type AddUserForm = z.infer<typeof userInput>;
type PinForm = { pin: string; confirmPin: string };

const pinSchema = z
  .object({
    pin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits'),
    confirmPin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits'),
  })
  .refine((d) => d.pin === d.confirmPin, { message: 'PINs must match', path: ['confirmPin'] });

export default function SettingsUsers(): JSX.Element {
  const { navigate } = useRoute();
  const { currentUser } = useSession();
  const [users, setUsers] = useState<UserPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<UserPublic | null>(null);
  const [removeTarget, setRemoveTarget] = useState<UserPublic | null>(null);

  const isAdmin = currentUser?.isFirstAdmin ?? false;

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    void refresh();
  }, [isAdmin]);

  async function refresh(): Promise<void> {
    setLoading(true);
    try {
      const list = await window.api.auth.usersList();
      setUsers(list);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load users';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  if (!isAdmin) {
    return (
      <main className="min-h-screen grid place-items-center bg-slate-50">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Admin only</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Settings → Users is available to the first admin only.
            </p>
            <Button variant="outline" onClick={() => navigate({ name: 'patients' })}>
              Back to patients
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  async function handleAdd(values: AddUserForm): Promise<void> {
    try {
      const created = await window.api.users.create({ fullName: values.fullName, pin: values.pin });
      toast.success(`${created.fullName} added.`);
      setAddOpen(false);
      await refresh();
    } catch (err) {
      if (err instanceof IpcErrorException) {
        toast.error(err.ipc.message);
        return;
      }
      const msg = err instanceof Error ? err.message : 'Add failed';
      toast.error(msg);
    }
  }

  async function handleResetPin(values: PinForm): Promise<void> {
    if (!resetTarget) return;
    try {
      await window.api.users.resetPin({ userId: resetTarget.id, newPin: values.pin });
      toast.success(`${resetTarget.fullName}'s PIN reset.`);
      setResetTarget(null);
    } catch (err) {
      if (err instanceof IpcErrorException) {
        toast.error(err.ipc.message);
        return;
      }
      const msg = err instanceof Error ? err.message : 'Reset failed';
      toast.error(msg);
    }
  }

  async function handleRemove(): Promise<void> {
    if (!removeTarget) return;
    try {
      await window.api.users.remove({ userId: removeTarget.id });
      toast.success(`${removeTarget.fullName} removed.`);
      setRemoveTarget(null);
      await refresh();
    } catch (err) {
      if (err instanceof IpcErrorException) {
        toast.error(err.ipc.message);
        return;
      }
      const msg = err instanceof Error ? err.message : 'Remove failed';
      toast.error(msg);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-6xl flex flex-col gap-4">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Settings · Users</h1>
            <p className="text-sm text-muted-foreground">Add or remove staff; reset PINs.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate({ name: 'patients' })}>
              <ArrowLeft className="size-4 mr-1" />
              Back
            </Button>
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="size-4 mr-1" />
                  Add user
                </Button>
              </DialogTrigger>
              <AddUserDialog onSubmit={handleAdd} onCancel={() => setAddOpen(false)} />
            </Dialog>
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <SettingsSidebar activeTab="users" />

          <div className="rounded-md border bg-card">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Last login</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-8 text-center text-sm text-muted-foreground">
                      Loading…
                    </td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-8 text-center text-sm text-muted-foreground">
                      No users yet.
                    </td>
                  </tr>
                ) : (
                  users.map((u) => {
                    const isSelf = currentUser?.id === u.id;
                    return (
                      <tr key={u.id} className="border-b last:border-b-0">
                        <td className="px-3 py-2 text-sm font-medium">
                          {u.fullName}
                          <span className="ml-2 text-xs text-muted-foreground">
                            {u.isFirstAdmin ? 'Admin' : 'Staff'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-sm text-muted-foreground">
                          {relativeTime(u.lastLoginAt)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" aria-label={`Actions for ${u.fullName}`}>
                                <MoreHorizontal className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => setResetTarget(u)}>
                                Reset PIN
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => setRemoveTarget(u)}
                                disabled={isSelf}
                                title={isSelf ? 'You cannot remove yourself' : undefined}
                                data-testid={`remove-${u.id}`}
                              >
                                Remove
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Reset PIN dialog */}
      {resetTarget && (
        <Dialog open={true} onOpenChange={(v) => (!v ? setResetTarget(null) : undefined)}>
          <ResetPinDialog user={resetTarget} onSubmit={handleResetPin} onCancel={() => setResetTarget(null)} />
        </Dialog>
      )}

      <ConfirmDialog
        open={removeTarget !== null}
        title="Remove user?"
        description={removeTarget ? `${removeTarget.fullName} will lose access.` : ''}
        confirmLabel="Remove"
        cancelLabel="Cancel"
        destructive
        onConfirm={() => void handleRemove()}
        onCancel={() => setRemoveTarget(null)}
      />
    </main>
  );
}

function AddUserDialog({
  onSubmit,
  onCancel,
}: {
  onSubmit: (values: AddUserForm) => Promise<void>;
  onCancel: () => void;
}): JSX.Element {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AddUserForm>({
    resolver: zodResolver(userInput),
    defaultValues: { fullName: '', pin: '' },
  });

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Add user</DialogTitle>
        <DialogDescription>Create a new staff PIN. They will appear on the sign-in screen.</DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-2">
          <Label htmlFor="addFullName">Full name</Label>
          <Input id="addFullName" autoComplete="name" {...register('fullName')} aria-invalid={!!errors.fullName} />
          {errors.fullName && (
            <p role="alert" className="text-sm text-destructive">{errors.fullName.message}</p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="addPin">4-digit PIN</Label>
          <Input
            id="addPin"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            autoComplete="off"
            {...register('pin')}
            aria-invalid={!!errors.pin}
          />
          {errors.pin && (
            <p role="alert" className="text-sm text-destructive">{errors.pin.message}</p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button type="submit">Add user</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function ResetPinDialog({
  user,
  onSubmit,
  onCancel,
}: {
  user: UserPublic;
  onSubmit: (values: PinForm) => Promise<void>;
  onCancel: () => void;
}): JSX.Element {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PinForm>({
    resolver: zodResolver(pinSchema),
    defaultValues: { pin: '', confirmPin: '' },
  });

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Reset PIN for {user.fullName}</DialogTitle>
        <DialogDescription>Choose a new 4-digit PIN.</DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-2">
          <Label htmlFor="resetPin">New PIN</Label>
          <Input
            id="resetPin"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            autoComplete="off"
            {...register('pin')}
            aria-invalid={!!errors.pin}
          />
          {errors.pin && (
            <p role="alert" className="text-sm text-destructive">{errors.pin.message}</p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="resetConfirmPin">Confirm PIN</Label>
          <Input
            id="resetConfirmPin"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            autoComplete="off"
            {...register('confirmPin')}
            aria-invalid={!!errors.confirmPin}
          />
          {errors.confirmPin && (
            <p role="alert" className="text-sm text-destructive">{errors.confirmPin.message}</p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button type="submit">Reset PIN</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
