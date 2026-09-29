// Targets are loaded by planner-target-config.js before this file.
(() => {
  const targets = () => {
    const definitions = globalThis.HoseiPlannerTargetDefinitions;
    if (!definitions || typeof definitions !== 'object') throw new Error('Planner target definitions are unavailable.');
    return definitions;
  };
  let enabledTargetKeys = ['prod'];
  const configure = keys => {
    if (!Array.isArray(keys) || keys.length === 0 || keys.some(key => !Object.hasOwn(targets(), key))) throw new Error('Invalid Planner targets.');
    enabledTargetKeys = [...keys];
  };
  globalThis.HoseiPlannerTarget = Object.freeze({
    targets: () => targets(),
    fragmentKey: 'hosei-import',
    configure,
    enabled: () => enabledTargetKeys.map(key => ({ key, ...targets()[key] })),
    get: key => targets()[key],
  });
})();
