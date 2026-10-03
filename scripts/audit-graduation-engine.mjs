/** Read-only runtime audit. No learner state, catalog, or engine writes.
 * node --import tsx scripts/audit-graduation-engine.mjs > /tmp/graduation-audit.json
 */
import fs from 'node:fs';
import ts from 'typescript';
import { catalog } from '../src/planner/catalog.ts';
import { calculateGraduationProgress } from '../src/planner/graduationProgress.ts';
import { initialState } from '../src/planner/storage.ts';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const source = ts.createSourceFile('graduationProgress.ts', read('../src/planner/graduationProgress.ts'), ts.ScriptTarget.Latest, true);
function initializer(name) {
  let result;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) result = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!result) throw new Error(`Missing audit input: ${name}`);
  return result;
}
const allowlist = Object.fromEntries(initializer('CONDITION_ALLOWLIST').properties.map(property => [property.name.text,
  property.initializer.elements.map(array => array.elements.map(value => value.text).sort())]));
const referenceOnly = initializer('REFERENCE_ONLY_REQUIREMENT_RULES').arguments[0].elements.map(value => value.text);
const safe = (type, keys) => (allowlist[type] ?? []).some(allowed => JSON.stringify(allowed) === JSON.stringify([...keys].sort()));
const count = (rows, key) => Object.fromEntries([...new Set(rows.map(key))].sort().map(value => [value, rows.filter(row => key(row) === value).length]));
const raw = JSON.parse(read('../src/data/planner_catalog_2026.json'));
const results = catalog.programs.filter(p => !p.isCommon).map(program => ({ program,
  result: calculateGraduationProgress([], catalog, program.scopeId, [], 'selected') }));
const requirements = catalog.requirements.map(requirement => {
  const keys = Object.keys(requirement.conditions ?? {}).sort();
  const effectiveKeys = keys.filter(key => key !== 'when' && key !== 'includes_thesis');
  const row = results.flatMap(({ result }) => result.requirements).find(row => row.requirementId === requirement.id);
  return { ...requirement, conditionKeys: keys, effectiveConditionKeys: effectiveKeys,
    rawAllowlistAccepts: safe(requirement.ruleType, keys), effectiveAllowlistAccepts: safe(requirement.ruleType, effectiveKeys),
    emptySelectedThesisProbe: row ? { status: row.status, reason: row.reason } : { status: 'omitted', reason: referenceOnly.includes(requirement.ruleId) ? 'reference-only overlay' : 'thesis card or inactive thesis branch' } };
});
const structured = requirements.filter(r => r.status === 'structured');
const combinationKeys = [...new Set(structured.map(r => `${r.ruleType}:${r.conditionKeys.join(',')}`))].sort();
const combinations = combinationKeys.map(key => {
  const rows = structured.filter(r => `${r.ruleType}:${r.conditionKeys.join(',')}` === key);
  return { key, count: rows.length, rawAllowlistAccepts: rows[0].rawAllowlistAccepts,
    effectiveAllowlistAccepts: rows[0].effectiveAllowlistAccepts, ruleIds: rows.map(r => r.ruleId).sort() };
});
const typeSource = ts.createSourceFile('plannerCatalog.ts', read('../src/planner/plannerCatalog.ts'), ts.ScriptTarget.Latest, true);
const conditionType = typeSource.statements.find(node => ts.isTypeAliasDeclaration(node) && node.name.text === 'RuleConditions');
const declaredConditionKeys = conditionType.type.members.map(node => node.name.text).sort();
const usedConditionKeys = [...new Set(structured.flatMap(r => r.conditionKeys))].sort();
const maps = new Map(catalog.mappings.map(m => [m.mappingId, m]));
const common = new Set(catalog.programs.filter(p => p.isCommon).map(p => p.scopeId));
// Structural candidates only: not a domain allocator or proof of rule coverage.
// Method flags, credits, categories and fields must ALL agree for B.
const signature = m => JSON.stringify([m.category, m.field, m.requirementType, m.curriculumCredits, m.schoolingOnly, m.mediaOnly]);
const allocationCandidates = results.map(({ program }) => {
  const rows = catalog.curriculum.courses.map(course => {
    const eligible = course.mappingIds.map(id => {
      if (!maps.has(id)) throw new Error(`Unknown mapping ${id}`);
      return maps.get(id);
    }).filter(m => common.has(m.scopeId) || m.scopeId === program.scopeId);
    const signatures = new Set(eligible.map(signature));
    const classification = eligible.length === 0 ? 'out_of_scope'
      : eligible.some(m => m.curriculumCredits === null) ? 'unknown_metadata'
        : signatures.size > 1 ? 'C'
        : eligible.length === 1 ? 'A' : 'B';
    return { curriculumCourseId: course.id, canonicalName: course.canonicalName, classification,
      mappingIds: eligible.map(m => m.mappingId), signatures: [...signatures] };
  });
  return { scopeId: program.scopeId, department: program.displayName, counts: count(rows, r => r.classification), rows };
});
const unresolvedOfferings = catalog.offerings.filter(o => !o.curriculumCourseId).map(o => ({
  id: o.id, name: o.name, resolutionStatus: o.resolutionStatus,
  candidates: catalog.curriculum.offeringRelations.find(r => r.offeringId === o.id)?.candidateCurriculumCourseIds ?? [] }));
const report = {
  auditBase: 'ca2aeea81c1ee692c998cd1e4399a9fafc48d23d', schemaVersion: initialState().schemaVersion,
  rawMetadata: raw.metadata, runtimeMetadata: catalog.metadata,
  counts: { requirements: requirements.length, structured: structured.length, unsupported: requirements.length - structured.length,
    ruleTypes: count(structured, r => r.ruleType), conditionCombinations: combinations.length,
    rawRejectedRequirements: structured.filter(r => !r.rawAllowlistAccepts).length,
    effectiveRejectedRequirements: structured.filter(r => !r.effectiveAllowlistAccepts).length,
    curriculumCourses: catalog.curriculum.courses.length, unresolvedOfferingIdentity: unresolvedOfferings.length,
    ambiguousOfferingIdentity: unresolvedOfferings.filter(o => o.candidates.length > 0).length,
    unmatchedOfferingIdentity: unresolvedOfferings.filter(o => o.candidates.length === 0).length },
  allowlist, declaredConditionKeys, usedConditionKeys,
  declaredButAbsentConditions: declaredConditionKeys.filter(key => !usedConditionKeys.includes(key)),
  combinations, requirements,
  emptySelectedThesisProbes: results.map(({ program, result }) => ({ scopeId: program.scopeId, program: program.displayName,
    evaluableCount: result.evaluableCount, unknownCount: result.unknownCount, unknownReasons: result.unknownReasons })),
  manualReviewOfferings: catalog.offerings.filter(o => o.resolutionStatus === 'manual_review').map(o => ({ id: o.id, name: o.name, mappingIds: o.mappingIds })),
  unresolvedOfferings, allocationCandidates,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
