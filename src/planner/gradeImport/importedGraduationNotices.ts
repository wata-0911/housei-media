import type { ImportedCourseAchievement, ImportedStudyRecord } from './gradeImportApply';
import type { ImportedAchievementWarning } from './importedAchievementCalculations';
import { officialFactCreditState, type DerivedOfficialGraduationFacts } from '../graduation/officialGraduationFacts';
import { REPEATABLE_HOLD_MESSAGES } from '../graduation/officialRepeatableEvidence';

export type ImportedGraduationNotice = ImportedAchievementWarning & {
  kind: 'allocation_held' | 'credits_unknown' | 'schooling_confirmation' | 'out_of_scope' | 'repeatable_limit';
  sourceRowIds: string[];
};

/** Presentation only. Allocation and diagnostic facts remain untouched. */
export function importedGraduationNotices(official: DerivedOfficialGraduationFacts, rows: ImportedCourseAchievement[], records: ImportedStudyRecord[]): ImportedGraduationNotice[] {
  const notices: ImportedGraduationNotice[] = [];
  for (const fact of official.facts) {
    // A duplicate group's aggregate is null. Inspect the retained source values,
    // never sum/max them or mistake an all-zero group for earned credit.
    const creditState = officialFactCreditState(fact);
    if (creditState.allZero) continue;
    const repeatableReason = fact.diagnostics.flatMap(code => REPEATABLE_HOLD_MESSAGES[code] ?? []).join(' ');
    const notice = {
      rawName: fact.canonicalName ?? rows.find(row => row.id === fact.sourceRowIds[0])?.rawName ?? '',
      sourceRowIds: fact.sourceRowIds,
      reason: repeatableReason || `公式実績の算入条件: ${fact.diagnostics.join(' / ')}`,
    };
    if (repeatableReason) {
      notices.push({ ...notice, kind: 'allocation_held' });
    } else if (fact.repeatableEvidence?.excessCredits) {
      const proof = fact.repeatableEvidence;
      notices.push({ ...notice, kind: 'repeatable_limit', reason: `公式修得${proof.earnedTotal}単位・独立した修得${proof.attempts.length}回のうち、卒業算入${proof.countedCredits}単位。上限${proof.limitCourses}回${proof.limit}単位を超える${proof.excessCredits}単位は他区分へ算入しません。` });
    } else if (!creditState.hasPositive) {
      notices.push({ ...notice, kind: 'credits_unknown', reason: `修得単位が不明です。${notice.reason}` });
    } else if (fact.allocation.kind === 'unknown') {
      notices.push({ ...notice, kind: 'allocation_held' });
    } else if (fact.allocation.kind === 'out_of_scope') {
      notices.push({ ...notice, kind: 'out_of_scope', reason: 'out_of_scope: 選択中の所属・共通要件に対応する制度上の割当がないため、自動除外しています。' });
    } else if (fact.diagnostics.includes('schooling_evidence_requires_confirmation')) {
      notices.push({ ...notice, kind: 'schooling_confirmation', reason: 'schooling_evidence_requires_confirmation: 通常の卒業単位は算入済みです。スクーリング算入の根拠を確認してください。' });
    }
  }
  const sourceIds = new Set(rows.map(row => row.id));
  for (const record of records) {
    if (!sourceIds.has(record.sourceCourseId ?? '')) notices.push({ rawName: record.rawName, sourceRowIds: [], kind: 'credits_unknown', reason: 'curriculum_identity_unresolved: 公式科目行がない旧形式の実績です。内訳から修得合計を推測していません。' });
  }
  return notices;
}
