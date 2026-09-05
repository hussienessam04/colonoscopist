// Compute the same machine fingerprint that src/main/license/fingerprint.ts produces.
// Output: SHA-256 hex of `cpuModel|diskSerial|mac`.
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);

function getMac() {
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const i of list || []) {
      if (!i.internal && i.mac && i.mac !== '00:00:00:00:00:00') return i.mac;
    }
  }
  return '';
}

async function getDiskSerial() {
  try {
    const { stdout } = await Promise.race([
      exec('wmic', ['diskdrive', 'get', 'serialnumber']),
      new Promise((_, rej) => setTimeout(() => rej(new Error('wmic timeout')), 5000)),
    ]);
    const lines = String(stdout).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^SerialNumber/i.test(l));
    if (lines.length) return lines.join(',');
  } catch {}
  // PowerShell fallback
  try {
    const { stdout } = await Promise.race([
      exec('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_DiskDrive | Select-Object -ExpandProperty SerialNumber"]),
      new Promise((_, rej) => setTimeout(() => rej(new Error('powershell timeout')), 5000)),
    ]);
    const lines = String(stdout).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length) return lines.join(',');
  } catch {}
  return '';
}

(async () => {
  const cpuModel = (os.cpus()[0] && os.cpus()[0].model) || '';
  const diskSerial = await getDiskSerial();
  const mac = getMac();
  const parts = `${cpuModel}|${diskSerial}|${mac}`;
  const fp = crypto.createHash('sha256').update(parts, 'utf8').digest('hex');
  console.log('CPU=' + cpuModel);
  console.log('DISK=' + (diskSerial || '<empty-degraded>'));
  console.log('MAC=' + mac);
  console.log('FINGERPRINT=' + fp);
})();
