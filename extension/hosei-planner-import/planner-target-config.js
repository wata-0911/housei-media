// Production extension uses only the audited production Planner.
(() => {
  globalThis.HoseiPlannerTargetDefinitions = Object.freeze({
    prod: Object.freeze({ origin: 'https://hosei-tsukyo-media.com', plannerPath: '/planner', buttonLabel: 'Plannerで確認' }),
  });
})();
