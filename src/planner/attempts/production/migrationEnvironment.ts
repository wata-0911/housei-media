import { prepareMigrationEnvironment } from '../migration/source';
// Loaded only when #196 needs to inspect a migrated schema23 source.
const raw = import.meta.glob('../../../data/planner_*2026.json', {query:'?raw',import:'default',eager:true});
const inputs = import.meta.glob('../../../../scripts/inputs/curriculum-*-2026.json', {query:'?raw',import:'default',eager:true});
export function loadProductionMigrationEnvironment() {
  const files = Object.fromEntries(Object.entries({...raw,...inputs}).map(([path,value]) => [path.startsWith('../../../data/') ? 'src/data/'+path.slice('../../../data/'.length) : path.slice('../../../../'.length),value as string]));
  return prepareMigrationEnvironment(files);
}
