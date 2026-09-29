import { readFile } from 'node:fs/promises';

const requiredKeys = ['prod', 'dev'];
const requiredFields = ['origin', 'plannerPath', 'buttonLabel'];

export async function loadPlannerTargets(configUrl = new URL('../extension/hosei-planner-import/planner-targets.config.json', import.meta.url)) {
  const targets = JSON.parse(await readFile(configUrl, 'utf8'));
  for (const key of requiredKeys) {
    if (!targets[key] || requiredFields.some(field => typeof targets[key][field] !== 'string')) throw new Error(`Invalid Planner target configuration for ${key}.`);
    const url = new URL(targets[key].origin);
    if (url.origin !== targets[key].origin || url.protocol !== 'https:' || !targets[key].plannerPath.startsWith('/')) throw new Error(`Invalid Planner target configuration for ${key}.`);
  }
  return targets;
}

export function renderTargetConfig(targets, keys) {
  const selected = Object.fromEntries(keys.map(key => [key, targets[key]]));
  if (Object.values(selected).some(target => !target)) throw new Error('Unknown Planner target.');
  return `// Generated from planner-targets.config.json. Do not edit.\n(() => {\n  globalThis.HoseiPlannerTargetDefinitions = Object.freeze(${JSON.stringify(selected, null, 2)});\n  globalThis.HoseiPlannerEnabledTargetKeys = Object.freeze(${JSON.stringify(keys)});\n})();\n`;
}

export function createDevelopmentManifest(productionManifest, targets) {
  const origins = ['prod', 'dev'].map(key => `${targets[key].origin}/*`);
  return {
    ...productionManifest,
    name: `${productionManifest.name} (dev)`,
    description: `${productionManifest.description} 開発用Planner確認版です。`,
    host_permissions: origins,
    content_scripts: productionManifest.content_scripts.map(script => ({ ...script, matches: origins })),
    action: { ...productionManifest.action, default_title: `${productionManifest.action.default_title} (dev)` },
  };
}
