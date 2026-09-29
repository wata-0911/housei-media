// Keep every Planner origin here. When the dev deployment URL changes, update only this file.
(() => {
  const targets = Object.freeze({
    prod: Object.freeze({ origin: 'https://hosei-tsukyo-media.com', plannerPath: '/planner', buttonLabel: 'Plannerで確認' }),
    dev: Object.freeze({ origin: 'https://housei-media-egvrrjm8y-htms-projects-5d66bc0c.vercel.app', plannerPath: '/planner', buttonLabel: 'Planner(dev)で確認' }),
  });
  let enabledTargetKeys = ['prod'];
  const configure = keys => {
    if (!Array.isArray(keys) || keys.length === 0 || keys.some(key => !Object.hasOwn(targets, key))) throw new Error('Invalid Planner targets.');
    enabledTargetKeys = [...keys];
  };
  globalThis.HoseiPlannerTarget = Object.freeze({
    targets,
    fragmentKey: 'hosei-import',
    configure,
    enabled: () => enabledTargetKeys.map(key => ({ key, ...targets[key] })),
    get: key => targets[key],
  });
})();
