// Generate a test Ed25519 keypair for local license signing.
const fs = require('node:fs');

(async () => {
  const ed = await import('@noble/ed25519');
  const { sha512 } = await import('@noble/hashes/sha2.js');
  ed.hashes.sha512 = sha512;

  const skRaw = ed.keygen();
  // v3: keygen() returns { secretKey, publicKey } (not a Promise, not raw bytes)
  const sk = skRaw.secretKey;
  const pk = skRaw.publicKey;
  console.log('sk type:', sk?.constructor?.name, 'byteLength:', sk?.byteLength);
  const skHex = Buffer.from(sk).toString('hex');
  const pkHex = Buffer.from(pk).toString('hex');
  const skCsv = Array.from(sk).join(',');
  const pkCsv = Array.from(pk).join(',');

  fs.mkdirSync('secrets', { recursive: true });
  fs.writeFileSync('secrets/ed25519.private', skCsv);
  fs.writeFileSync('secrets/ed25519.public', pkHex);
  console.log('PK_HEX=' + pkHex);
  console.log('SK_HEX=' + skHex);
  console.log('Saved secrets/ed25519.private (csv) + secrets/ed25519.public (hex)');
})();
