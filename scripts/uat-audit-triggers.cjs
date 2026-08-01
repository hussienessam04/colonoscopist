#!/usr/bin/env node
// UAT helper: prove audit_log triggers refuse UPDATE / DELETE.
// Run via: node scripts/run-uat-audit-triggers.cjs

const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');

const candidates = [
  path.join(process.env.APPDATA || '', 'Colonoscopist', 'data', 'app.db'),
  path.join(process.env.HOME || '', 'Library', 'Application Support', 'Colonoscopist', 'data', 'app.db'),
  path.join(process.env.HOME || '', '.config', 'Colonoscopist', 'data', 'app.db'),
];
const dbPath = candidates.find((p) => p && fs.existsSync(p));
if (!dbPath) {
  console.error('Could not find app.db in any userData location.');
  console.error('Tried:', candidates);
  process.exit(1);
}

const db = new Database(dbPath);
const before = db.prepare('SELECT COUNT(*) c FROM audit_log').get().c;
console.log('audit_log rows before:', before);

const tests = [
  { label: 'UPDATE audit_log SET action=...', sql: "UPDATE audit_log SET action = 'hacked' WHERE rowid = 1" },
  { label: 'DELETE FROM audit_log', sql: 'DELETE FROM audit_log WHERE rowid = 1' },
];

let pass = 0;
let fail = 0;
for (const t of tests) {
  try {
    db.exec(t.sql);
    console.log(`✗ ${t.label}  →  UPDATE/DELETE succeeded (BAD)`);
    fail += 1;
  } catch (err) {
    if (/audit_log is append-only/.test(String(err.message))) {
      console.log(`✓ ${t.label}  →  ABORT (${err.code})`);
      pass += 1;
    } else {
      console.log(`? ${t.label}  →  unexpected error: ${err.message}`);
      fail += 1;
    }
  }
}

const after = db.prepare('SELECT COUNT(*) c FROM audit_log').get().c;
console.log('audit_log rows after :', after, '(must equal before)');
db.close();

console.log(`\n${pass}/${pass + fail} trigger checks passed`);
process.exit(fail === 0 ? 0 : 1);
