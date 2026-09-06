// scripts/dedupe-procedures.cjs
//
// One-off cleanup for procedures duplicated by the pre-fix
// `proceduresRepo.insert` bug. The bug created two rows per
// recording:
//   - row A (from `procedures.create` IPC): id minted at preview time,
//     status='recording', then `updateFinalized` overwrites it with
//     status='completed' + the canonical videoPath. created_at
//     stamps ~1-2s BEFORE row B.
//   - row B (from recorder's `procedures.insert`): the repo IGNORED
//     the input.id and minted a fresh UUID, status stays 'recording'.
//     created_at stamps ~1-2s AFTER row A.
//
// Strategy: for each (patient_id, started_at) group with >1 row,
// keep the OLDEST row (by created_at) and delete the rest. The oldest
// is the row `procedures.create` minted first; the newer one(s) are
// the recorder's stray insert(s).
//
// Usage: node scripts/dedupe-procedures.cjs [--dry-run]
//   --dry-run  (default) print what would be deleted, do not write
//   (no flag)           actually delete the duplicates
//
// Reads the userData SQLite path via electron's app.getPath('userData')
// by spawning electron in --no-sandbox script mode? No — simpler: read
// from a hard-coded userData path or take it from argv.
//
// For this app the userData path is platform-specific:
//   Windows: %APPDATA%\colonoscopist\data\db.sqlite
//   macOS:   ~/Library/Application Support/colonoscopist/data/db.sqlite
//   Linux:   ~/.config/colonoscopist/data/db.sqlite
//
// Override via --db <path> if needed.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const Database = require('better-sqlite3');

function defaultDbPath() {
  const platform = process.platform;
  if (platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'colonoscopist', 'data', 'db.sqlite');
  }
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'colonoscopist', 'data', 'db.sqlite');
  }
  return path.join(os.homedir(), '.config', 'colonoscopist', 'data', 'db.sqlite');
}

function parseArgs() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || !args.includes('--apply');
  const dbFlagIdx = args.indexOf('--db');
  const dbPath = dbFlagIdx >= 0 ? args[dbFlagIdx + 1] : defaultDbPath();
  return { dryRun, dbPath };
}

function main() {
  const { dryRun, dbPath } = parseArgs();
  if (!fs.existsSync(dbPath)) {
    console.error(`Database not found at: ${dbPath}`);
    console.error('Pass --db <path> to override.');
    process.exit(1);
  }
  const db = new Database(dbPath);
  try {
    // Find groups with >1 row sharing (patient_id, started_at).
    const groups = db.prepare(`
      SELECT patient_id, started_at, COUNT(*) AS c
      FROM procedures
      GROUP BY patient_id, started_at
      HAVING c > 1
    `).all();

    if (groups.length === 0) {
      console.log('No duplicate groups found. Nothing to do.');
      return;
    }

    let totalDeleted = 0;
    const txn = db.transaction(() => {
      for (const g of groups) {
        const rows = db.prepare(`
          SELECT id, status, video_path, created_at
          FROM procedures
          WHERE patient_id = ? AND started_at = ?
          ORDER BY created_at ASC
        `).all(g.patient_id, g.started_at);

        // Keep the first (oldest by created_at), delete the rest.
        const keep = rows[0];
        const del = rows.slice(1);
        for (const r of del) {
          if (dryRun) {
            console.log(`[dry-run] would delete ${r.id} (status=${r.status}, video_path=${r.video_path || '<empty>'}) — keeping ${keep.id}`);
          } else {
            db.prepare(`DELETE FROM procedures WHERE id = ?`).run(r.id);
            console.log(`deleted ${r.id} (status=${r.status}, video_path=${r.video_path || '<empty>'}) — kept ${keep.id}`);
          }
          totalDeleted++;
        }
      }
    });
    txn();

    console.log(`\n${dryRun ? '[dry-run] would delete' : 'deleted'} ${totalDeleted} duplicate row(s) across ${groups.length} group(s).`);
    if (dryRun) {
      console.log('Re-run with --apply to commit the deletes.');
    }
  } finally {
    db.close();
  }
}

main();
