#!/usr/bin/env python3
"""Read-only verification of YI-01 audit artifacts against the pinned catalog.

Run from any directory: python3 docs/planner-yi-01/verify.py
Requires only Python's standard library. Does not write runtime data.
"""
import collections
import csv
import hashlib
import json
from pathlib import Path
import re
import subprocess
import unicodedata

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
STATES = ('safe', 'ambiguous', 'conflict', 'unmatched')

def read(path):
    return json.loads(path.read_text(encoding='utf-8'))

def unique(rows, key):
    ids = [r[key] for r in rows]
    assert len(ids) == len(set(ids)), f'duplicate {key}'
    return set(ids)

def norm(s):
    # Preserve Roman numerals as subject variants; NFKC is comparison-only.
    for i, c in enumerate('ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ'):
        s = s.replace(c, chr(0xe000 + i))
    return re.sub(r'\s', '', unicodedata.normalize('NFKC', s))

summary = read(HERE / 'summary.json')
assert summary['baseCommit'] == 'f6da38b7a968302b184d38bbcb328feb30a9c6c6'
assert summary['stateSchemaVersion'] == 22
assert summary['graduationCheckComplete'] is False
assert summary['sourceLinksReverified'] is False
assert len(summary['visualPagesReviewed']) == 52
for path, digest in summary['legacyDigests'].items():
    assert hashlib.sha256((ROOT / path).read_bytes()).hexdigest() == digest, path
catalog = read(ROOT / 'src/data/planner_catalog_2026.json')
cur = read(ROOT / 'src/data/planner_curriculum_2026.json')
source = read(ROOT / 'scripts/inputs/curriculum-rows-2026.json')['rows']
cc = read(HERE / 'curriculum-crosswalk.json')['rows']
ms = read(HERE / 'mapping-crosswalk.json')['rows']
physical = read(HERE / 'official-rows.json')['rows']
codes = read(HERE / 'official-codes.json')['rows']
notes = read(HERE / 'official-notes.json')['rows']
legacy = read(HERE / 'legacy-relations.json')
assert (len(cc), len(ms), len(physical), len(codes), len(legacy['offeringEdges'])) == (321, 502, 502, 578, 686)
assert len(catalog['courses']) == len(legacy['legacyCourseRelations']) == 209
ccids = unique(cc, 'oldCurriculumCourseId')
mapids = unique(ms, 'oldMappingId')
assert ccids == unique(cur['courses'], 'id')
assert mapids == unique(catalog['mappings'], 'mappingId') == unique(source, 'mappingId')
assert unique(legacy['offeringEdges'], 'offeringId') == unique(catalog['offerings'], 'id')
assert unique(legacy['legacyCourseRelations'], 'legacyCourseId') == unique(catalog['courses'], 'id')
evidence = unique(physical, 'evidenceId') | unique(codes, 'evidenceId') | unique(notes, 'evidenceId')
assert len(evidence) == len(physical) + len(codes) + len(notes)
physicalById = {r['evidenceId']: r for r in physical}
bySource = {r['mappingId']: r for r in source}
byCatalog = {r['mappingId']: r for r in catalog['mappings']}
byCC = {r['oldCurriculumCourseId']: r for r in cc}
byProgram = {r['scopeId']: r for r in catalog['programs']}
allClaims = [m for c in cc for m in c['mappingIds']]
assert len(allClaims) == 502 and set(allClaims) == mapids
assert len(allClaims) == len(set(allClaims)), 'current CC/Mapping is a partition'
usedPhysical = []
for m in ms:
    sourceRow = bySource[m['oldMappingId']]
    assert m['legacySnapshot'] == byCatalog[m['oldMappingId']]
    assert m['oldMappingId'] in byCC[m['oldCurriculumCourseId']]['mappingIds']
    assert m['scopeId'] in byCC[m['oldCurriculumCourseId']]['scopeIds']
    program = byProgram[m['scopeId']]
    for key in ['faculty', 'department', 'course']:
        assert sourceRow[key] == program[key]
    assert len(m['officialEvidenceIds']) == 1
    p = physicalById[m['officialEvidenceIds'][0]]
    usedPhysical.append(p['evidenceId'])
    assert p['printedPage'] == sourceRow['sourcePage'] == m['legacySnapshot']['source']['page']
    assert norm(p['canonicalName']) == norm(m['canonicalName']) == norm(sourceRow['canonicalName'])
    for key in ['curriculumCredits', 'category', 'field', 'requirementType', 'eligibleYears']:
        assert p[key] == sourceRow[key] == m['legacySnapshot'][key], (m['oldMappingId'], key)
    assert m['officialRowMatchStatus'] == 'safe'
    assert m['placementStatus'] == ('conflict' if m['status'] == 'conflict' else 'safe')
    assert bool(m['differences']) == (m['status'] == 'conflict')
    assert m['mainCodeEvidenceIds'] == [c['evidenceId'] for c in codes if c['scope'] != 'teacher_only'
        and c['evidenceId'] in m['mainCodeEvidenceIds']]
    for cid in m['mainCodeEvidenceIds']:
        row = next(c for c in codes if c['evidenceId'] == cid)
        assert row['scope'] != 'teacher_only'
        assert row['credits'] == p['curriculumCredits']
    assert set(m['officialEvidenceIds'] + m['mainCodeEvidenceIds'] + m['teacherCodeEvidenceIds']) <= evidence
    assert m['sourceDigest'] == summary['sourceDigest']
    assert m['legacyDigest'] == summary['legacyDigests']['src/data/planner_catalog_2026.json']
assert len(usedPhysical) == len(set(usedPhysical)) == 502
for entity, rows in [('CurriculumCourse', cc), ('Mapping', ms)]:
    count = {s: sum(r['status'] == s for r in rows) for s in STATES}
    assert count == summary['classification'][entity]
    assert sum(count.values()) == len(rows)
    for r in rows:
        assert r['ruleVersion'] == 1 and r['historicalContinuityStatus'] == 'unverified'
        assert len(r['candidateStableIds']) == len(set(r['candidateStableIds']))
        assert r['status'] in STATES and r['candidateStableIds']
        if r['status'] == 'safe':
            assert r['adoptedStableId'] == r['candidateStableIds'][0]
            assert len(r['candidateStableIds']) == 1 and r['reason']
            if entity == 'CurriculumCourse':
                assert not r['peerCurriculumCourseIds']
                assert set(r['evidenceIds']) <= evidence
                for mid in r['mappingIds']:
                    assert next(m for m in ms if m['oldMappingId'] == mid)['status'] == 'safe'
        else:
            assert r['adoptedStableId'] is None
for p in physical + codes + notes:
    assert p['pdfPage'] == p['printedPage'] + 2 and p['quality'] == 'image_verified'
for c in codes:
    assert c['codes'] and all(re.fullmatch(r'\d{5}', n) for n in c['codes'])
    assert len(c['rawCells']) >= 3
for o in legacy['offeringEdges']:
    assert set(o['mappingIds']) <= mapids
    rel = o['relation']
    assert rel['offeringId'] == o['offeringId']
    assert set(rel['candidateCurriculumCourseIds']) <= ccids
    assert not any(k in o for k in ['period', 'deliveryCategory', 'academicYear', 'name', 'eligibleYears'])
    if o['legacyCourseId']:
        assert o['legacyCourseId'] in {c['id'] for c in catalog['courses']}
assert norm('監査論Ⅰ') != norm('監査論Ⅱ')
assert norm('経済史A') != norm('経済史Ⅰ')
assert norm('自然地理学概論（1）') != norm('自然地理学概論（2）')
for name, rows, key in [('curriculum', cc, 'oldCurriculumCourseId'), ('mapping', ms, 'oldMappingId')]:
    with (HERE / f'{name}-crosswalk.csv').open(encoding='utf-8', newline='') as f:
        csvrows = list(csv.DictReader(f))
    assert len(csvrows) == len(rows) and {r[key] for r in csvrows} == {r[key] for r in rows}
    assert collections.Counter(r['status'] for r in csvrows) == collections.Counter(r['status'] for r in rows)
# Markdown cell counts and local links. Fragment semantics are checked separately by readers.
for path in HERE.glob('*.md'):
    text = path.read_text(encoding='utf-8')
    assert '\ufffd' not in text and '(cid:' not in text, path
    expected = None
    for line in text.splitlines():
        if line.startswith('|'):
            count = len(re.findall(r'(?<!\\)\|', line))
            if expected is None:
                expected = count
            assert count == expected, (path.name, line)
        else:
            expected = None
    for target in re.findall(r'\]\(([^)]+)\)', text):
        if '://' in target or target.startswith('#'):
            continue
        assert (path.parent / target.split('#')[0]).exists(), (path.name, target)
# Ensure all tracked changes relative to audit base are documentation only.
changed = subprocess.check_output(['git', 'diff', summary['baseCommit'], '--name-only'], cwd=ROOT, text=True).splitlines()
assert all(p.startswith('docs/planner-yi-01/') for p in changed), changed
assert catalog['metadata']['graduationCheckComplete'] is False
assert catalog['metadata']['sourceLinksReverified'] is False
assert 'schemaVersion: 22;' in (ROOT / 'src/planner/plannerCatalog.ts').read_text()
print(json.dumps({'result': 'PASS', 'counts': summary['counts'], 'classification': summary['classification'],
    'officialRowLocatorMatches': 502, 'placementDefinition': summary['placementCorrespondence'],
    'historicalContinuity': 'unverified; no global curriculum/graduation PASS'}, ensure_ascii=False, indent=2))
