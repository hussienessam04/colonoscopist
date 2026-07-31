import { BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { logStartup } from './startup-log';

const FILE_PROTOCOL = 'file:';

export function createMainWindow(): BrowserWindow {
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
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, '../preload/index.js'),
    },
  });

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
  return win;
}
