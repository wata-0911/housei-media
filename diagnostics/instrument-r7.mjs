import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const original = resolve(process.argv[2] || 'tests/authority-r7.browser.mjs');
const output = resolve(process.argv[3] || 'tests/authority-r7.phase.browser.mjs');
let text = readFileSync(original, 'utf8');
const anchor = 'for (const schema of [23, 24]) test(`R7 schema${schema} real backup survives same and separate origins`';
const at = text.indexOf(anchor);
if (at < 0) throw new Error('Fixed R7 schema23/24 test anchor not found');
const prefix = text.slice(0, at);
let body = text.slice(at);
const sourceAt = body.indexOf('  const source = await sourcePage.evaluate(');
const destinationAt = body.indexOf('  const destination = await destinationPage.evaluate(');
if (sourceAt < 0 || destinationAt < sourceAt) throw new Error('R7 browser evaluate anchors changed');
let source = body.slice(0, destinationAt);
let destination = body.slice(destinationAt);
function once(value, before, after) {
  const first = value.indexOf(before);
  if (first < 0 || value.indexOf(before, first + before.length) >= 0) throw new Error(`Expected one match: ${before}`);
  return value.replace(before, after);
}
const marker = `const mark = label => console.log('F01_PHASE ' + label + ' ' + Date.now());`;
source = once(source, '  const sourcePage = await sourceContext.newPage();', `  const sourcePage = await sourceContext.newPage();\n  sourcePage.on('console', m => { if (m.text().startsWith('F01_PHASE ')) console.log(m.text()); });`);
source = once(source, '    const m = await import(\'/bundle.mjs\');', `    const m = await import('/bundle.mjs');\n    ${marker}`);
for (const [label, statement] of [
  ['source-load', 'await api.load();'],
  ['source-initial-save', 'await api.save(schema === 23 ? await api.prepareMigration(primary) : await api.prepareSave(), true);'],
  ['source-command-save', 'await api.save(await api.prepareSave(), true);'],
  ['source-backup', 'const raw = await api.createBackup();'],
  ['source-restore-preview', 'const preview = await api.prepareRestore(raw);'],
  ['source-restore-save', 'await api.save(preview, true, preview.adoptionSha256);'],
  ['source-fresh-load', 'await fresh.load();'],
  ['source-rebackup', 'const output = await fresh.createBackup();'],
]) source = once(source, statement, `mark('${label}-start'); ${statement} mark('${label}-end');`);
source = once(source, '  const destinationPage = await destinationContext.newPage();', `  const destinationPage = await destinationContext.newPage();\n  destinationPage.on('console', m => { if (m.text().startsWith('F01_PHASE ')) console.log(m.text()); });`);
destination = once(destination, '    const m = await import(\'/bundle.mjs\');', `    const m = await import('/bundle.mjs');\n    ${marker}`);
for (const [label, statement] of [
  ['destination-load', 'await api.load();'],
  ['destination-restore-preview', 'const preview = await api.prepareRestore(raw);'],
  ['destination-restore-save', 'await api.save(preview, true, preview.adoptionSha256);'],
  ['destination-fresh-load', 'await fresh.load();'],
  ['destination-rebackup', 'const output = await fresh.createBackup();'],
]) destination = once(destination, statement, `mark('${label}-start'); ${statement} mark('${label}-end');`);
body = source + destination;
writeFileSync(output, prefix + body);
