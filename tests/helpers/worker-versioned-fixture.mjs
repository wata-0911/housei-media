import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {backupDigest} from '../../src/planner/backup/plannerBackupCompatibility.ts';
import {previewLegacyRule2Migration} from '../../src/planner/attempts/persistence/legacyPreview.ts';
import {replayState,replayStateRule2} from '../../src/planner/attempts/persistence/codec.ts';
import {replayFixture} from '../fixtures/replay-state-fixture.mjs';
const cache=new Map();
export async function versionedFixture(schema=24,variant='small'){
 const key=schema+variant;if(!cache.has(key))cache.set(key,(async()=>{
  let raw,state,workspace,required,archived;
  if(variant==='small'){const f=await replayFixture(schema,'normal',1);raw=f.raw;state=f.state;workspace=f.workspace;required=(await replayState(state)).requiredReservations;}
  else{const archive=JSON.parse(gunzipSync(readFileSync(new URL('../fixtures/persistence-rule1-pr1-audit.json.gz',import.meta.url))));const f=archive.fixtures.find(f=>f.name===`${schema}-${variant}`);if(!f)throw Error('fixture_missing:'+key);archived={state:f.state2,r2:f.required2};raw=f.state1Raw;state=JSON.parse(raw);workspace=f.workspace;required=f.required1;}
  const preview=await previewLegacyRule2Migration(raw);
  const legacy={raw,revision:1,committed:[await backupDigest(state)],issuedIds:required??(await replayState(state)).requiredReservations};
  if(preview.status!=='preview')return {raw,state,workspace,legacy,preview};
  const modern=preview.candidate,replay=await replayStateRule2(modern),coverage={policyVersion:2,kind:'native-v2',baselineStateSha256:null};
  const authority={raw:JSON.stringify(modern),revision:1,committed:[await backupDigest(modern)],issuedIds:replay.requiredReservations,format:'hosei-attempt-authority',authorityVersion:2,reservationCoverage:coverage};
  const backup=await seal({format:'hosei-attempt-backup',backupVersion:4,createdAt:'2026-11-02T00:00:00.000Z',state:modern,reservedIds:replay.requiredReservations,reservationCoverage:coverage});
  return {raw,state,workspace,legacy,preview,modern,replay,authority,backup,archived};
 })());return structuredClone(await cache.get(key));
}
export async function seal(value){const {sha256,...body}=value;void sha256;return {...body,sha256:await backupDigest(body)};}
