const asar = require('@electron/asar');
const all = asar.listPackage('dist/win-unpacked/resources/app.asar');
const target = all.find(f => f.includes('index-') && f.endsWith('.js'));
console.log('target:', target);
if (target) {
  const buf = asar.extractFile('dist/win-unpacked/resources/app.asar', target);
  const content = buf.toString('utf8');
  const idx = content.indexOf('browser.length === 0');
  console.log('"browser.length === 0" at:', idx);
  if (idx >= 0) console.log('  context:', content.slice(Math.max(0, idx - 80), idx + 250));
  const idx2 = content.indexOf('selectedBrowserId === null');
  console.log('"selectedBrowserId === null" at:', idx2);
  if (idx2 >= 0) console.log('  context:', content.slice(Math.max(0, idx2 - 80), idx2 + 250));
}
