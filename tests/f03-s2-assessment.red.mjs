// An intentionally failing integration requirement. Run explicitly, outside
// GREEN suites. Caller-created IDs are NOT an authorized workaround.
import test from 'node:test';
import {createPlannerAttemptSession} from '../src/planner/attempts/production/session.ts';
import {emptyAuthority} from '../src/planner/attempts/persistence/contracts.ts';
import assert from 'node:assert/strict';
test('BLOCKED_DEP: new media assessment must obtain a session-issued nested ID before save/reload',async()=>{
 let record=emptyAuthority();const store={read:async()=>structuredClone(record),commit:async(e,n)=>{assert.deepEqual(e,record);record=structuredClone(n);}};
 const locks={request:async(_n,_o,run)=>run()},api=createPlannerAttemptSession(store,locks);
 await api.load();await api.save(await api.prepareSave(),true);
 const a=api.add('hosei:cp:13f6e301-6356-4670-a2cc-e285d49d343e',JSON.stringify({plannedYear:2027,method:'media',status:'in_progress'})).attempts[0];
 // No ID is supplied: the requested public API behavior is allocation by the
 // authority session. Current F01 deliberately rejects it; preserve this RED.
 api.progress(a.id,'media',JSON.stringify({totalLessons:null,lessons:[],assessments:[{type:'final',label:'new',scheduledDate:null,completed:false}]}));
 await api.save(await api.prepareSave(),true);
 await createPlannerAttemptSession(store,locks).load();
});
