import { cp, mkdir, rm, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = `${root}/extension/hosei-planner-import`;
const output = `${root}/extension/hosei-planner-import-dev`;
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true, filter: entry => !entry.includes('/tests') });
await rename(`${output}/manifest.dev.json`, `${output}/manifest.json`);
await rm(`${output}/planner-target-config.js`);
await rename(`${output}/planner-target-config.dev.js`, `${output}/planner-target-config.js`);
