import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../parser/extractor.js';

const api = globalThis.HoseiPlannerGradeExtractor;
const cells = (name, overrides = {}) => Array.from({ length: 24 }, (_, index) => overrides[index] ?? (index === 1 ? name : ''));

test('extracts 24-cell logic and mixed correspondence/schooling courses without finalGrade', () => {
  const logic = cells('論理学', { 2: '4', 5: '4', 7: '○26/06/01', 8: '×26/06/15', 9: '*確認中', 10: '保留', 11: '2026/07/01', 12: '*4', 13: 'D' });
  const economics = cells('経済学', { 2: '4', 5: '4', 14: '2026', 15: '夏期', 16: '2026/08/01', 17: '2', 18: 'C', 19: '2026', 20: '秋期', 21: '2026/10/01', 22: '2', 23: 'A+' });
  const [first, second] = api.extractRows([logic, economics]);
  assert.equal(first.rawName, '論理学'); assert.deepEqual(first.reports.map(report => report.status), ['passed', 'resubmit', 'processing', 'unknown']);
  assert.deepEqual(first.reports.map(report => report.date), ['2026-06-01', '2026-06-15', null, null]);
  assert.equal(first.creditExam.grade, 'D'); assert.equal(first.creditExam.pendingMarker, true); assert.equal('finalGrade' in first, false);
  assert.equal(second.schoolings[0].grade, 'C'); assert.equal(second.schoolings[1].grade, 'A+'); assert.equal(second.schoolings[0].date, '2026-08-01');
});

test('keeps category, malformed rows, empty schoolings, and raw invalid values safely', () => {
  const category = cells('***一般教育人文分野');
  const valid = cells('科目', { 16: '2026/02/30', 17: '単位不明', 18: 'Z' });
  const malformed = valid.slice(0, 23);
  const [course] = api.extractRows([category, malformed, valid]);
  assert.equal(course.categoryRaw, '***一般教育人文分野');
  assert.equal(course.schoolings[0].date, null); assert.equal(course.schoolings[0].rawDate, '2026/02/30');
  assert.equal(course.schoolings[0].credits, null); assert.equal(course.schoolings[0].grade, null);
  assert.deepEqual(course.schoolings[1], { rawYear: '', rawTerm: '', rawDate: '', rawCredits: '', rawGrade: '', year: null, term: null, date: null, credits: null, grade: null });
});

test('normalizes only valid dates and preserves report source text', () => {
  assert.equal(api.date('26/06/01'), '2026-06-01'); assert.equal(api.date('2026年6月1日'), '2026-06-01'); assert.equal(api.date('2026/02/30'), null);
  assert.deepEqual(api.report(''), { raw: '', status: 'none', date: null });
  assert.deepEqual(api.report('○26/06/01'), { raw: '○26/06/01', status: 'passed', date: '2026-06-01' });
});
