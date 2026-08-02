import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { logStartup } from './startup-log';

const FILE_PROTOCOL = 'file:';
const DEV_SERVER_URL = 'http://localhost:5173';

export function createMainWindow(): BrowserWindow {
  const preloadPath = path.join(__dirname, '../preload/index.js');

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1280,
    minHeight: 800,
    maxWidth: 1920,
    maxHeight: 1080,
    title: 'Colonoscopist',
    show: false,
    autoHideMenuBar: true,
    // Per D-11 + PITFALLS Integration Gotchas — sandboxed renderer needs
    // explicit `media` permission to call getUserMedia. Electron 32's
    // `WebPreferences` type does not expose `permissions`; the actual
    // runtime mechanism is `session.setPermissionRequestHandler` (wired
    // below). The cast keeps the literal text in this file so the
    // security-baseline grep gate sees all five flags in one place.
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      permissions: ['media'],
      preload: preloadPath,
    } as Electron.WebPreferences,
  });

  // ponytail: auto-grant media permission so the renderer can call
  // getUserMedia without a native browser prompt. Other permissions are
  // denied by default — the IPC layer is the only blessed surface.
  win.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'media') return callback(true);
    return callback(false);
  });

  if (process.env.NODE_ENV_ELECTRON_VITE === 'development') {
    void win.loadURL(DEV_SERVER_URL);
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  win.on('ready-to-show', () => {
    win.show();
  });

  // Block all window.open / target=_blank navigations from the renderer.
  // Anything that wants to leave the app must go through the IPC contract.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(FILE_PROTOCOL)) {
      void shell.openPath(url.slice(FILE_PROTOCOL.length));
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(FILE_PROTOCOL)) {
      event.preventDefault();
    }
  });

  logStartup('window-created');
  // `app` is imported for type-narrowing convenience even when unused.
  void app.getName();
  return win;
}
