import type { IpcContract } from '@shared/ipc-contract';

declare global {
  interface Window {
    api: IpcContract;
  }
}

export {};
