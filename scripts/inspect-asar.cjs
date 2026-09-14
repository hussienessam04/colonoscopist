const asar = require('@electron/asar');
const fs = require('fs');
const path = require('path');
const os = require('os');

const archivePath = 'dist/win-unpacked/resources/app.asar';
const list = asar.listPackage(archivePath);
const target = list.find((f) => f.includes('index-') && f.endsWith('.js'));
console.log('target:', target);

const tmpDir = path.join(os.tmpdir(), 'asar-extract-' + Date.now());
fs.mkdirSync(tmpDir, { recursive: true });
console.log('extracting to', tmpDir);
asar.extractAll(archivePath, tmpDir);

const bundlePath = `${tmpDir}${target.replace(/\\/g, '/')}`;
const content = fs.readFileSync(bundlePath, 'utf8');

const checks = [
  { name: 'disabled: browser.length === 0', pattern: 'disabled: browser.length === 0' },
  { name: 'old chicken-and-egg (selectedBrowserId === null)', pattern: 'selectedBrowserId === null' },
  { name: 'dshow fallback in picker', pattern: 'browser.length > 0' },
  { name: 'selectedCanonical union (lookup ?? value)', pattern: 'lookup(selectedBrowserId) ?? selectedBrowserId' },
  { name: 'isGateRejected helper', pattern: 'isGateRejected' },
  { name: 'useLicenseChangeRefresh helper', pattern: 'useLicenseChangeRefresh' },
  { name: 'ffmpeg path rewrite', pattern: "replace('app.asar'" },
];

for (const c of checks) {
  const idx = content.indexOf(c.pattern);
  console.log(c.name, idx >= 0 ? 'PRESENT @ ' + idx : 'MISSING');
}

const ab = content.indexOf("disabled: browser.length === 0");
if (ab >= 0) {
  console.log('---disabled context---');
  console.log(content.slice(ab - 200, ab + 250));
}
