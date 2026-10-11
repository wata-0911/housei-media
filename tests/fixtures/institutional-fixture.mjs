import { yi01InstitutionalInput, yi02InstitutionalRegistry } from '../../src/planner/institutional/yi01.ts';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** Synthetic evidence only; never included in a shipped catalog. No annual offerings. */
export function institutionalFixture(names = ['同名科目', '同名科目', '科目Ⅰ', '科目Ⅱ', '科目A', '科目B', '科目(1)', '科目(2)']) {
  const registry = structuredClone(yi02InstitutionalRegistry);
  registry.scopes = [{ ...registry.scopes[0], id: id(1), officialScopeLabel: 'fixture_scope', faculty: yi01InstitutionalInput.mappingRows.find(r => r.status === 'safe').legacySnapshot.faculty, department: yi01InstitutionalInput.mappingRows.find(r => r.status === 'safe').legacySnapshot.department, course: yi01InstitutionalInput.mappingRows.find(r => r.status === 'safe').legacySnapshot.course }];
  registry.institutionalCourses = [];
  registry.placements = [];
  // This expected binding is captured during fixture definition, before callers
  // can corrupt its independent registry. Never rebuild it inside validation.
  const baseline = { baselineVersion: 1, auditedCommit: 'synthetic-fixture', registrySha256: 'synthetic-fixture',
    curriculumCrosswalkSha256: 'synthetic-fixture', sourceRevisionId: registry.sourceRevision.id, sourceDigest: registry.sourceRevision.sha256,
    curriculumVersions: registry.curriculumVersions.map(v => ({ issuanceRequestId: v.issuanceRequestId, id: v.id, sourceRevisionId: v.sourceRevisionId })),
    institutionalCourses: [], placements: [] };
  const input = { auditVersion: 1, sourceDigest: registry.sourceRevision.sha256, legacyDigests: { ...registry.legacyDigests },
    curriculumRows: [], mappingRows: [], officialRows: [], notes: [], codes: [], offerings: [] };
  const originalCC = yi01InstitutionalInput.curriculumRows.find(r => r.status === 'safe');
  const originalMapping = yi01InstitutionalInput.mappingRows.find(r => r.status === 'safe');
  const originalRow = yi01InstitutionalInput.officialRows[0];
  for (const [index, name] of names.entries()) {
    const oldId = `curriculum:${id(index + 100)}`;
    const cc = { ...structuredClone(originalCC), oldCurriculumCourseId: oldId, canonicalName: name,
      candidateStableIds: [oldId], adoptedStableId: oldId, mappingIds: [], scopeIds: [id(1)], evidenceIds: [], peerCurriculumCourseIds: [], legacyEquivalence: null };
    // The first identity has two roles in the SAME version/scope, with 4 and 2 credits.
    for (let role = 0; role < (index === 0 ? 2 : 1); role++) {
      const mappingId = id(index * 10 + role + 200);
      const evidenceId = `fixture-row-${index}-${role}`;
      const credits = role === 0 ? 4 : 2;
      const row = { ...structuredClone(originalRow), evidenceId, scope: 'fixture_scope', officialLabel: name, canonicalName: name,
        curriculumCredits: credits, category: '専門教育', field: null, requirementType: role ? 'スクーリング選択必修' : '必修',
        requiredMethod: role ? 'schooling' : null, methodMarker: role ? 'Ⓢ' : null, methodEvidenceKind: role ? 'table_heading' : null };
      const mapping = { ...structuredClone(originalMapping), oldMappingId: mappingId, oldCurriculumCourseId: oldId,
        canonicalName: name, scopeId: id(1), candidateStableIds: [oldId], adoptedStableId: oldId, officialEvidenceIds: [evidenceId],
        sameNameCodeCandidateEvidenceIds: [], mainCodeEvidenceIds: [], teacherCodeEvidenceIds: [], mainCodes: [], legacyOfferingIds: [] };
      mapping.legacySnapshot = { ...mapping.legacySnapshot, mappingId, scopeId: id(1), source: { page: row.printedPage, url: null },
        curriculumCredits: credits, category: row.category, field: row.field, requirementType: row.requirementType, eligibleYears: row.eligibleYears, schoolingOnly: role === 1 };
      cc.mappingIds.push(mappingId); cc.evidenceIds.push(evidenceId);
      input.mappingRows.push(mapping); input.officialRows.push(row);
      registry.placements.push({ id: `hosei:cp:${id(index * 10 + role + 300)}`, issuanceRequestId: `yi-02:placement:${mappingId}`,
        oldMappingId: mappingId, curriculumVersionId: registry.curriculumVersions[0].id, scopeId: id(1), placementRoleKey: `${row.table}:${evidenceId}`, evidenceId });
      baseline.placements.push({ id: `hosei:cp:${id(index * 10 + role + 300)}`, issuanceRequestId: `yi-02:placement:${mappingId}`,
        oldMappingId: mappingId, curriculumVersionId: baseline.curriculumVersions[0].id, scopeId: id(1),
        placementRoleKey: `${originalRow.table}:${evidenceId}`, evidenceId });
    }
    input.curriculumRows.push(cc);
    registry.institutionalCourses.push({ id: oldId, issuanceRequestId: `yi-01:adopt:${oldId}`, oldCurriculumCourseId: oldId, evidenceIds: cc.evidenceIds });
    baseline.institutionalCourses.push({ id: oldId, issuanceRequestId: `yi-01:adopt:${oldId}`,
      oldCurriculumCourseId: oldId, evidenceIds: [...cc.evidenceIds], canonicalName: name });
  }
  return { input, registry, baseline };
}
