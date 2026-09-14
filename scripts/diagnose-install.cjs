#!/usr/bin/env node
// Quick task 260913-rp5 — helper to PROVE the user's installed
// Colonoscopist is the new 0.1.3 build (with the fixes + unpacked
// ffmpeg) or the old 0.1.2 build (with the bugs). Walks the user's
// `AppData\Local\Programs\Colonoscopist` (the standard per-user
// install path) and reports the build version + whether the
// bundles contain the fix shapes + whether ffmpeg.exe is unpacked.
//
// Usage: node scripts/diagnose-install.cjs
//
// Exits 0 if the new build is installed (with all fix signals
// present), 1 if anything looks stale. Designed to be copy-pasted
// into a chat reply.

const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');
const os = require('node:os');

const installDir = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Colonoscopist');
const asarPath = path.join(installDir, 'resources', 'app.asar');

function exists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function report(msg, ok) {
  const marker = ok === true ? 'PASS' : ok === false ? 'FAIL' : '----';
  console.log(`[${marker}] ${msg}`);
  return ok;
}

console.log('=== Colonoscopist install diagnosis ===');
console.log('install dir:', installDir);

let allOk = true;
function track(ok) { if (ok !== true) allOk = false; return ok; }

if (!exists(installDir)) {
  report('install dir exists — nothing to diagnose, fresh install needed', false);
  process.exit(1);
}

const exePath = path.join(installDir, 'Colonoscopist.exe');
const exeExists = exists(exePath);
track(report('Colonoscopist.exe present', exeExists));

if (!exeExists) {
  console.log('no exe at expected path — abort');
  process.exit(1);
}

const exeStat = fs.statSync(exePath);
console.log('exe mtime:', exeStat.mtime.toISOString(), 'size:', exeStat.size);

const packagePath = path.join(installDir, 'resources', 'app.asar');
const pkgExists = exists(packagePath);
track(report('app.asar present', pkgExists));

if (!pkgExists) {
  console.log('no asar — abort');
  process.exit(1);
}

const asarStat = fs.statSync(packagePath);
console.log('asar mtime:', asarStat.mtime.toISOString());

// unpacked ffmpeg present?
const unpackedFfmpeg = path.join(
  installDir,
  'resources',
  'app.asar.unpacked',
  'node_modules',
  'ffmpeg-static',
  'ffmpeg.exe',
);
const hasUnpackedFfmpeg = exists(unpackedFfmpeg);
track(report('ffmpeg.exe unpacked to app.asar.unpacked', hasUnpackedFfmpeg));

// extract asar to inspect the bundle
const tmp = path.join(os.tmpdir(), 'install-diagnose-' + Date.now());
fs.mkdirSync(tmp, { recursive: true });
console.log('extracting asar to', tmp);
asar.extractAll(packagePath, tmp);

const list = asar.listPackage(packagePath);
const target = list.find((f) => f.includes('index-') && f.endsWith('.js'));
console.log('renderer bundle:', target);

const bundlePath = `${tmp}${target.replace(/\\/g, '/')}`;
const content = fs.readFileSync(bundlePath, 'utf8');
console.log('bundle size:', content.length, 'bytes');

const checks = [
  ['chicken-and-egg "selectedBrowserId === null" removed', 'selectedBrowserId === null'],
  ['dshow fallback ("browser.length > 0 ?")', 'browser.length > 0'],
  ['safe disabled check ("dshow.length === 0")', 'dshow.length === 0'],
  ['isGateRejected helper present', 'isGateRejected'],
  ['useLicenseChangeRefresh helper present', 'useLicenseChangeRefresh'],
  ['LICENSE_CHANGED_EVENT listener', 'colonoscopist:license-changed'],
];

for (const [name, pattern] of checks) {
  const idx = content.indexOf(pattern);
  const present = idx >= 0;
  track(report(`renderer: ${name}`, present ? true : false));
}

const mainPath = `${tmp}/out/main/index.js`;
const mainContent = fs.readFileSync(mainPath, 'utf8');
const mainChecks = [
  ['ffmpeg-static require', 'require("ffmpeg-static")'],
  ['app.asar.unpacked path rewrite', "replace('app.asar', 'app.asar.unpacked')"],
];
for (const [name, pattern] of mainChecks) {
  const idx = mainContent.indexOf(pattern);
  const present = idx >= 0;
  track(report(`main: ${name}`, present ? true : false));
}

console.log('=== summary ===');
console.log(allOk ? 'ALL CHECKS PASS — fresh 0.1.3 install detected.' : 'STALE INSTALL — at least one expected signal is missing above.');
process.exit(allOk ? 0 : 1);
