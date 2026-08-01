// Per-D-05 user row: avatar (color = pickColor, fallback = initials) + name +
// last-login relativeTime. Pure presentational; the parent Login owns selectedUser.
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { pickColor, initials } from '@/lib/avatar';
import { relativeTime } from '@/lib/format';
import type { UserPublic } from '@shared/ipc-contract';

type Props = {
  user: UserPublic;
  onSelect: (user: UserPublic) => void;
};

export default function UserPicker({ user, onSelect }: Props): JSX.Element {
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => onSelect(user)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(user);
        }
      }}
      className="flex items-center gap-3 p-4 cursor-pointer hover:bg-accent transition-colors"
      aria-label={`Sign in as ${user.fullName}`}
    >
      <Avatar className="size-10">
        <AvatarFallback className={`${pickColor(user.id)} text-white font-semibold`}>
          {initials(user.fullName)}
        </AvatarFallback>
      </Avatar>
      <div className="flex flex-col">
        <span className="text-sm font-medium">{user.fullName}</span>
        <span className="text-xs text-muted-foreground">
          {user.isFirstAdmin ? 'Admin' : 'Staff'} · last seen {relativeTime(user.lastLoginAt)}
        </span>
      </div>
    </Card>
  );
}
