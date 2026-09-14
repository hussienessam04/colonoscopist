const asar = require('@electron/asar');
const fs = require('fs');
const path = require('path');
const os = require('os');

const archivePath = process.argv[2];
const tmp = path.join(os.tmpdir(), 'inspect-' + Date.now());
fs.mkdirSync(tmp, { recursive: true });
asar.extractAll(archivePath, tmp);

const mainPath = path.join(tmp, 'out', 'main', 'index.js');
console.log('main bundle size:', fs.statSync(mainPath).size, 'bytes');
const c = fs.readFileSync(mainPath, 'utf8');

const refs = [
  ['ffmpeg-static (raw require)', "ffmpeg-static"],
  ['recorder/ffmpeg-path import', "recorder/ffmpeg-path"],
  ['capture/devices import', "capture/devices"],
  ["'app.asar' literal in bundle", "'app.asar'"],
  ['app.asar.unpacked literal', 'app.asar.unpacked'],
];
for (const [name, pattern] of refs) {
  const idx = c.indexOf(pattern);
  console.log(idx >= 0 ? '  PASS' : '  FAIL', '-', name, idx >= 0 ? '@ ' + idx : '');
}

// Find the defaultFfmpegPath function body in the bundle
const ffmpegDefaultIdx = c.indexOf("defaultFfmpegPath");
if (ffmpegDefaultIdx >= 0) {
  console.log('\n=== defaultFfmpegPath body ===');
  console.log(c.slice(ffmpegDefaultIdx, ffmpegDefaultIdx + 400));
}

// Verify: the path rewrite `app.asar` → `app.asar.unpacked` SHOULD be present
console.log('\n=== Path rewrite presence ===');
console.log("contains .replace('app.asar',", c.includes(".replace('app.asar',") ? 'YES' : 'NO');
console.log('contains app.asar.unpacked:', c.includes('app.asar.unpacked') ? 'YES' : 'NO');
