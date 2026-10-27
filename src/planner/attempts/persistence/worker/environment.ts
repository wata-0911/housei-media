import {prepareMigrationEnvironment} from '../../migration/source';
// Same six exact files as the synchronous environment, no dev fixture imports.
import catalog from '../../../../data/planner_catalog_2026.json?raw';
import curriculum from '../../../../data/planner_curriculum_2026.json?raw';
import official from '../../../../data/planner_official_mapping_overrides_2026.json?raw';
import manual from '../../../../data/planner_manual_mapping_overrides_2026.json?raw';
import rows from '../../../../../scripts/inputs/curriculum-rows-2026.json?raw';
import equivalences from '../../../../../scripts/inputs/curriculum-equivalences-2026.json?raw';
export function loadWorkerEnvironment(){return prepareMigrationEnvironment({
 'src/data/planner_catalog_2026.json':catalog,'src/data/planner_curriculum_2026.json':curriculum,
 'src/data/planner_official_mapping_overrides_2026.json':official,'src/data/planner_manual_mapping_overrides_2026.json':manual,
 'scripts/inputs/curriculum-rows-2026.json':rows,'scripts/inputs/curriculum-equivalences-2026.json':equivalences,
});}
