// Produce a tampered .lic by flipping one byte in the embedded license.json.
// Original signature is kept → verify will report SIGNATURE_MISMATCH.
const fs = require('node:fs');
const path = require('node:path');
const yauzl = require('yauzl');
const archiverMod = require('archiver'); // legacy v7 API on this older install? try require first
const { promisify } = require('node:util');

(async () => {
  const src = process.argv[2] || 'b83a958f6b4e.lic';
  const dst = process.argv[3] || src.replace(/\.lic$/, '.tampered.lic');

  // Read entries from the source zip
  const entries = {};
  await new Promise((resolve, reject) => {
    yauzl.fromBuffer(fs.readFileSync(src), { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(err || new Error('zipfile null'));
      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        zipfile.openReadStream(entry, (e, stream) => {
          if (e) return reject(e);
          const chunks = [];
          stream.on('data', (c) => chunks.push(c));
          stream.on('end', () => {
            entries[entry.fileName] = Buffer.concat(chunks);
            zipfile.readEntry();
          });
          stream.on('error', reject);
        });
      });
      zipfile.on('end', resolve);
      zipfile.on('error', reject);
    });
  });

  const origJson = entries['license.json'];
  const origSig = entries['license.sig'];
  if (!origJson || !origSig) throw new Error('source .lic missing license.json or license.sig');

  // Flip byte index 14 (inside the `"test-vendor-1"` value string per Plan 01 deviation #1;
  // changing the byte keeps the JSON parseable but invalidates the Ed25519 signature).
  const tamperedJson = Buffer.from(origJson);
  tamperedJson[14] = tamperedJson[14] ^ 0x01; // flip a single bit
  console.log(`Flipped byte 14: 0x${origJson[14].toString(16)} → 0x${tamperedJson[14].toString(16)}`);
  console.log(`Original JSON: ${origJson.toString('utf8')}`);
  console.log(`Tampered JSON: ${tamperedJson.toString('utf8')}`);

  const archiver = archiverMod.default || archiverMod;
  // archiver v8 ESM: use ZipArchive
  let archive;
  if (typeof archiver === 'function') {
    archive = archiver('zip', { zlib: { level: 9 } });
  } else if (archiver.ZipArchive) {
    archive = new archiver.ZipArchive({ zlib: { level: 9 } });
  } else {
    throw new Error('unsupported archiver export shape: ' + Object.keys(archiver));
  }

  const output = fs.createWriteStream(dst);
  archive.pipe(output);
  archive.append(tamperedJson, { name: 'license.json' });
  archive.append(origSig, { name: 'license.sig' }); // keep the original signature → SIGNATURE_MISMATCH
  await archive.finalize();
  await new Promise((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
  });
  console.log(`Wrote ${dst}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
