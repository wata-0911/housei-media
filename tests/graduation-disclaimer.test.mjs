import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import GraduationProgress from '../src/components/planner/graduation/GraduationProgress.tsx';
import { displayScenarios } from './fixtures/graduation-disclaimer.mjs';

for (const scenario of displayScenarios()) test(`disclaimer: ${scenario.name}`, () => {
  const before = structuredClone(scenario.progress);
  const html = renderToStaticMarkup(createElement(GraduationProgress, { ...scenario, onOpenProfile() {} }));
  assert.deepEqual(scenario.progress, before);
  assert.equal(scenario.progress.graduationCheckComplete, false);
  for (const text of ['大学の公式卒業判定ではありません', '対応済み要件の部分的な進捗', 'すべての表示項目が「達成」でも', '未対応・未確認', '公式ポータル', '最新の履修要覧', '教務', '「達成」は卒業全体の達成を意味しません']) assert.ok(html.includes(text), text);
  assert.ok(html.indexOf('大学の公式卒業判定') < html.indexOf('確認が必要な条件'));
  assert.doesNotMatch(html, /role="alert"/);
  if (scenario.name === 'unset') assert.match(html, /プロフィールを開く/);
  if (scenario.name === 'held') {
    assert.ok(scenario.progress.cards.some(r => r.status === 'unknown' && r.reason));
    assert.match(html, /判定保留/);
  }
  if (scenario.name === 'mixed') {
    assert.ok(scenario.progress.cards.some(r => r.status === 'satisfied'));
    assert.ok(scenario.progress.cards.some(r => r.status !== 'satisfied'));
  }
  if (scenario.name === 'all') assert.ok(scenario.progress.cards.every(r => r.status === 'satisfied'));
  for (const row of scenario.progress.cards) {
    if (row.reason) assert.ok(html.includes(row.reason.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')));
    for (const source of row.sourceRefs ?? []) {
      assert.ok(html.includes(source.title));
      if (source.url) assert.ok(html.includes(`href="${source.url.replaceAll('&', '&amp;')}"`));
    }
  }
});
