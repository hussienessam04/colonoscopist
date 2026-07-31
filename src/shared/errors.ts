// Stub for future IPC error variants. Phase 1 doesn't raise any error
// through this channel — main handlers always resolve. The shape exists
// so Phase 2+ auth can reject with a tagged union without changing the
// preload bridge shape.

export type IpcError = { code: 'IPC_AUTH_FAILED'; message: string };