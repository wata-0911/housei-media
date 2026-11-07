import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog} from '../src/planner/catalog/catalog.ts';
import {initialState,loadState,STORAGE_KEY} from '../src/planner/backup/storage.ts';
import {validateState} from '../src/planner/validation.ts';
import {deriveCurriculumCourseProgress} from '../src/planner/progress/curriculumCourseProgress.ts';
import {officialRow} from './fixtures/unresolved-condition-scenarios.mjs';
for(const amount of [0,null])test(`F02-R2 regular future T4 remains a projection with official ${amount}`,()=>{
 const s=initialState(),offering=catalog.offerings.find(o=>o.id==='b6a158b9-465e-48fd-91b3-3c281cf17ea4');
 s.items=[{offeringId:offering.id,status:'planned',courseCreditContribution:4,plannedYear:null,plannedTerm:null,studyYear:null,earnedOrder:null}];s.importedCourseAchievements=[officialRow(catalog.curriculum.courses.find(c=>c.id===offering.curriculumCourseId),amount)];
 assert.equal(validateState(s,catalog),true);const raw=JSON.stringify(s),loaded=loadState({getItem:k=>k===STORAGE_KEY?raw:null},catalog);assert.equal(loaded.error,null);
 const c=deriveCurriculumCourseProgress(loaded.state.items,catalog,loaded.state.importedCourseAchievements).courses[0];assert.equal(c.completion,amount===null?'unknown':'incomplete');assert.equal(c.projectedCompletion,'complete');assert.equal(c.earnedCredits,0);assert.equal(c.projectedCredits,4);assert.equal(JSON.stringify(s),raw);
});
