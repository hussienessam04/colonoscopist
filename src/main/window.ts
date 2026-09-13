import { app, BrowserWindow, nativeImage, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { logStartup } from './startup-log';

const FILE_PROTOCOL = 'file:';
const DEV_SERVER_URL = 'http://localhost:5173';

// ponytail: lazy icon lookup. Resolution order:
//   1. .ico in packaged build (process.resourcesPath — electron-builder
//      copies buildResources/icon.ico → resources/icon.ico by default)
//   2. SVG candidates in renderer output (also serves as favicon)
// SVG fallback covers `npm run dev` (app.isPackaged === false) AND any
// packaged build where the .ico is missing/corrupt. Falls back to
// undefined if everything is missing — Electron uses its built-in default
// icon in that case.
// Sizes baked into the .ico: 16/24/32/48/64/128 (see scripts/build-icon.mjs).
function resolveAppIcon(): Electron.NativeImage | undefined {
  const candidates: string[] = [];
  if (app.isPackaged) {
    // electron-builder default: buildResources/icon.ico → resources/icon.ico
    candidates.push(path.join(process.resourcesPath, 'icon.ico'));
  }
  candidates.push(
    path.join(__dirname, '../renderer/icon.svg'),
    path.join(__dirname, '../renderer/assets/icon.svg'),
  );
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const img = nativeImage.createFromPath(candidate);
      if (!img.isEmpty()) return img;
    }
  }
  logStartup('icon-missing');
  return undefined;
}

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
    // App icon — Health Icons "gastroenterology" (CC0 / public domain).
    // vite copies src/renderer/public/ → <renderer-output>/ at build time,
    // so this path resolves in both dev and prod. SVG window icons render
    // via Chromium in Electron 32+. Bail to no-icon if the file is missing
    // (e.g. someone deletes it) so the app still launches.
    icon: resolveAppIcon(),
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
