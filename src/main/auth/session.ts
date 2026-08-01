// In-memory session (AUTH-04). No persistence across reboot.
// Per D-05 + AUTH-04.

let currentUserId: string | null = null;

export const session = {
  get currentUserId(): string | null {
    return currentUserId;
  },
  set(userId: string): void {
    currentUserId = userId;
  },
  clear(): void {
    currentUserId = null;
  },
};