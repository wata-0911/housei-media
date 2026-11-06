// Synthetic 24-cell input. No learner data. Term abbreviations: Shiori 2026 p.133.
import { extractRows } from '../../shared/grade-import/extractor.js';
export function mediaCells(name, term = 'メ', year = '2024', earned = '2', slot = 0) {
  const cells = Array(24).fill('');
  Object.assign(cells, { 1: name, 2: '2', 5: earned, 6: earned });
  ['' + year, term, '', '2', 'A'].forEach((value, i) => { cells[14 + slot * 5 + i] = value; });
  return cells;
}
export function mediaInput(rows = [mediaCells('健康・スポーツ科学概論'), mediaCells('経営学特講')]) {
  return { schemaVersion: 1, source: 'hosei_web_learning_grade_table', capturedAt: '2026-11-06T00:00:00.000Z', courses: extractRows(rows) };
}
