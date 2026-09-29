import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createDevelopmentManifest, loadPlannerTargets, renderTargetConfig } from './planner-targets.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = `${root}/extension/hosei-planner-import`;
const output = `${root}/extension/hosei-planner-import-dev`;
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true, filter: entry => !entry.includes('/tests') });
const targets = await loadPlannerTargets();
const productionManifest = JSON.parse(await readFile(`${source}/manifest.json`, 'utf8'));
await writeFile(`${output}/manifest.json`, `${JSON.stringify(createDevelopmentManifest(productionManifest, targets), null, 2)}\n`);
await writeFile(`${output}/planner-target-config.js`, renderTargetConfig(targets, ['prod', 'dev']));
