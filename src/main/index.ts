import { app } from 'electron';
import { createMainWindow } from './window';
import { registerAuthIpc } from './ipc/auth';
import { registerUsersIpc } from './ipc/users';
import { registerAuditIpc } from './ipc/audit';
import { getDb, closeDb } from './db';
import { logStartup } from './startup-log';

const APP_NAME = 'Colonoscopist';
const APP_USER_MODEL_ID = 'com.colonoscopist.app';

app.setName(APP_NAME);

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

// per D-01 + AUDIT-01 — DB open + migrations BEFORE any IPC handler registration.
app.whenReady().then(() => {
  getDb();
  registerAuthIpc();
  registerUsersIpc();
  registerAuditIpc();
  createMainWindow();
  logStartup('app-ready');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  closeDb();
});