import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import CourseSearch from '../src/components/planner/search/CourseSearch.tsx';
import {catalog} from '../src/planner/catalog/catalog.ts';
import {createCreditClassifier} from '../src/planner/planning/annualPlan.ts';

const render = offerings => renderToStaticMarkup(createElement(CourseSearch, {
  catalog, offerings, classify:createCreditClassifier(catalog,null), selectedScopeId:null,
  addedIds:new Set(), disabled:false, onAdd:()=>{}, onAddPublicCourse:()=>{},
}));
const text = html => html.replace(/<[^>]*>/g,'');

test('147-A search label and described help distinguish the 2026 numbering namespace',()=>{
  const html=render([]);
  assert.match(html,/<label[^>]*for="course-query"[^>]*>科目名・シラバス科目ナンバリング・クラスコード・開講区分・期<\/label>/);
  assert.match(html,/<input[^>]*id="course-query"[^>]*aria-describedby="course-search-help"/);
  assert.match(html,/<p id="course-search-help"[^>]*>[^<]*シラバス科目ナンバリング・クラスコード・開講区分・期も対象です。/);
  assert.ok(text(html).includes('ナンバリングとクラスコードは2026年参照カタログの値です。'));
  assert.ok(text(html).includes('単位修得試験・リポート提出用の5桁コードは検索・表示の対象外です。'));
});

for(const code of ['HSS100TA','LAW200TB','LANe100TA'])test(`147-A result labels preserve the actual ${code} value`,()=>{
  const offering=catalog.offerings.find(o=>o.subjectCode===code&&o.method==='correspondence');
  assert.ok(offering);const html=render([offering]);
  assert.ok(text(html).includes(`シラバス科目ナンバリング（2026年参照カタログ）：${code} / クラスコード：${offering.classCode??'—'}`));
  assert.ok(!text(html).includes('科目コード：'));
  assert.ok(!text(html).includes(' / クラス：'));
  if(code==='HSS100TA')assert.ok(!text(html).includes('03406'));
});

test('147-A class-code wording preserves the actual opening code',()=>{
  const offering=catalog.offerings.find(o=>o.classCode!==null);assert.ok(offering);
  assert.ok(text(render([offering])).includes(` / クラスコード：${offering.classCode}`));
});

test('147-A null numbering/class values retain em-dash display',()=>{
  const offering={...catalog.offerings[0],subjectCode:null,classCode:null};
  assert.ok(text(render([offering])).includes('シラバス科目ナンバリング（2026年参照カタログ）：— / クラスコード：—'));
});

test('147-A empty strings retain the existing nullish-display behavior',()=>{
  const offering={...catalog.offerings[0],subjectCode:'',classCode:''};
  assert.ok(text(render([offering])).includes('シラバス科目ナンバリング（2026年参照カタログ）： / クラスコード：'));
});
