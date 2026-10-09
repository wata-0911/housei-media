/** Read-only synthetic audit. --write regenerates the checked-in report only. */
import { writeFileSync } from 'node:fs';
import { scenarios, calculateScenario } from '../tests/fixtures/unresolved-condition-scenarios.mjs';
import { projectUnresolvedConditions } from '../src/planner/unresolvedConditions.ts';

const escape = value => String(value ?? '—').replaceAll('|', '\\|').replaceAll('\n', ' ');
const table = rows => rows.map(row => `| ${row.map(escape).join(' | ')} |`).join('\n');
const inventory = new Map();
const counts = [];
for (const s of scenarios()) {
  const p = calculateScenario(s), q = projectUnresolvedConditions(p, { ...s, importedRows: s.rows });
  const profile = s.name.split('/').at(-1);
  counts.push([s.program.displayName, profile, p.unknownCount, q.learner.length,
    q.automatic.filter(x => x.owner === 'university').length, q.automatic.filter(x => x.owner === 'developer').length,
    q.delegated.length, q.excluded.length, `${p.coverageSummary.supported}/${p.coverageSummary.partial}/${p.coverageSummary.unknown}`, p.importedWarnings.length]);
  const record = (id, label, reason, owner, disposition, existing, sourceRefs = []) => {
    const requirementId = id.replace(/^(requirement|card|reference):/, '');
    const rule = s.catalog.requirements.find(r => r.id === requirementId);
    const key = JSON.stringify([id, reason, owner, disposition, existing]);
    const value = inventory.get(key) ?? { id, requirementId, ruleId: rule?.ruleId ?? '—', ruleType: rule?.ruleType ?? '—',
      label, reason, owner, disposition, existing, sourceRefs, scenarios: new Set(), scopes: new Set() };
    value.scenarios.add(profile); value.scopes.add(s.program.displayName); inventory.set(key, value);
  };
  for (const item of [...q.learner, ...q.automatic]) for (const target of item.targets) record(target.id, target.label, target.reason, item.owner,
    item.owner === 'learner' ? `入力案内（${item.id}）` : '保留維持・別枠', item.action, target.sourceRefs);
  for (const item of q.delegated) {
    const row = p.requirements.find(r => r.requirementId === item.requirementId);
    record(`requirement:${item.requirementId}`, item.label, item.reason, 'developer', '重複説明をカードへ集約・内部保留維持', item.cardId, row.sourceRefs);
  }
  for (const item of q.excluded) {
    const row = p.requirements.find(r => r.requirementId === item.requirementId);
    record(`requirement:${item.requirementId}`, row.label, row.reason, 'developer', '他学科・他コースのため確認一覧から除外', item.reason, row.sourceRefs);
  }
  for (const notice of p.importedWarnings) record(`import-notice:${notice.sourceRowIds.join(',')}:${notice.kind}`, notice.rawName, notice.reason,
    'developer', `既存の公式成績警告に維持（${notice.kind}）`, 'importedGraduationNotices / officialGraduationFacts');
}
const entries = [...inventory.values()];
const result = `# Issue #56 再現可能なunknown棚卸し\n\n基準dev: bd67f5646d3d28da3c7749dff42ac1b775fce934。6学科（日本文学科3コース）、168ケース。生成: node --import tsx scripts/audit-unresolved-conditions.mjs --write\n\n` +
  `入力定義は tests/fixtures/unresolved-condition-scenarios.mjs。A=新規、B=2026/1年次/空、C=修得済み、D=2年次編入未入力、E=編入確認済み（一般24/S7・外国語体育なし）、F=学士免除確認済み、G=旧課程、H=公式照合保留（選択可能候補あり）、I=Planner未照合/単位不明、J=卒論3選択。追加ケースで課程未確認・放送大学6・履修中/計画中・公式aggregate0/null/4・S証拠nullを確認。いずれも合成データ。\n\n` +
  `## 変更前後の件数\n\n内部unknownは変更前=変更後。Aは利用者操作数、B/Cは大学/実装等の個別条件数。D集約/除外は内部個別ルール数。coverageはsupported/partial/unknown（変更前=変更後）。importは別の公式警告数で合算しない。\n\n` +
  table([['学科・コース','ケース','内部unknown（前=後）','A 操作','B 大学','C 実装等','D カード集約','D 他scope除外','coverage（前=後）','import'], Array(10).fill('---'), ...counts]) +
  `\n\n## 全発生経路一覧\n\n各行はID×理由×表示先/解決主体の組。複数ケースで同じ組はscope/ケース欄に列挙する。同じreasonだけで要件を統合しない。全行でstatus解除なし。表示除外は制度要件の解決を意味しない。\n\n` +
  table([['requirementId / 発生元','ruleId / ruleType','対象scope','発生ケース','reason','公式根拠','既存処理・操作先','解決主体','安全性・対応'],Array(9).fill('---'),
    ...entries.map(e=>[e.id,`${e.ruleId} / ${e.ruleType}`,[...e.scopes].join('、'),[...e.scenarios].join('、'),e.reason,
      e.sourceRefs.map(r=>`${r.title}${r.page ? ` ${r.page}` : ''}${r.url ? ` (${r.url})` : ''}`).join(' / ') || '公式成績行・既存算入診断',
      e.existing,({learner:'利用者',university:'大学',developer:'開発者・根拠確認'})[e.owner],`解除せず：${e.disposition}`])])+'\n';
if (process.argv.includes('--write')) writeFileSync(new URL('../docs/planner-unresolved-conditions-inventory-2026.md', import.meta.url), result);
console.log(JSON.stringify({ scenarios: counts.length, inventoryRows: entries.length, baselineB: counts.filter(row => row[1] === 'B') }, null, 2));
