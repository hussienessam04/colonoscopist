#!/usr/bin/env node
// UAT helper: dump audit_log rows + PII grep using better-sqlite3 under
// Electron's Node ABI. Run via: node scripts/uat-audit.cjs
// (the npm script uat-audit sets ELECTRON_RUN_AS_NODE=1).

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

const db = new Database(dbPath, { readonly: true, fileMustExist: true });

const total = db.prepare('SELECT COUNT(*) c FROM audit_log').get().c;
console.log('rows:', total);
console.log('actions:', db.prepare('SELECT action, COUNT(*) c FROM audit_log GROUP BY action').all());
console.log('--- last 20 ---');
for (const r of db.prepare('SELECT created_at, action, entity_type, entity_id, user_id, metadata FROM audit_log ORDER BY created_at DESC LIMIT 20').all()) {
  console.log(r.created_at, r.action, r.entity_type, r.entity_id, JSON.stringify(r.metadata));
}
console.log('--- PII grep (must be 0) ---');
const meta = db.prepare('SELECT metadata FROM audit_log').all().map((r) => r.metadata || '');
const hits = meta.filter((s) => /TR|EXACT|555-|severe headache|headache/i.test(s));
console.log('metadata rows with PII-like substrings:', hits.length);
if (hits.length > 0) {
  console.log('hits:');
  for (const h of hits) console.log(' ', h);
}
db.close();
