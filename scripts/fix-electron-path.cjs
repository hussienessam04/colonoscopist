#!/usr/bin/env node
// Fix-up: some npm install paths (notably `npm install --ignore-scripts`)
// leave electron's `path.txt` in the wrong location (dist/ instead of the
// package root). electron's index.js reads it from the package root, so
// `require('electron')` throws "Electron failed to install correctly".
// This script normalizes the file: writes `electron.exe` (or the
// versioned folder name when present) to node_modules/electron/path.txt
// and removes the stale dist/path.txt.
//
// Run after any electron install that did not complete the postinstall.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'node_modules', 'electron');
const distPathTxt = path.join(root, 'dist', 'path.txt');
const rootPathTxt = path.join(root, 'path.txt');

if (!fs.existsSync(root)) {
  console.log('no electron module — skipping');
  process.exit(0);
}

const distPath = path.join(root, 'dist');
let content = 'electron.exe';
if (fs.existsSync(distPath)) {
  const entries = fs.readdirSync(distPath);
  const versionedDir = entries.find((e) => /^electron-v\d+\.\d+\.\d+-/.test(e));
  if (versionedDir) {
    // Standard install layout: dist/electron-vX.Y.Z-<platform>-<arch>/electron.exe
    content = path.join(versionedDir, 'electron.exe');
  } else if (fs.existsSync(path.join(distPath, 'electron.exe'))) {
    // Flat layout from manual zip extraction: dist/electron.exe
    content = 'electron.exe';
  }
}

fs.writeFileSync(rootPathTxt, content, 'utf8');
if (fs.existsSync(distPathTxt)) {
  fs.unlinkSync(distPathTxt);
}

console.log(`electron path.txt -> ${content}`);
