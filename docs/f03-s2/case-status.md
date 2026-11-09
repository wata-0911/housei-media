# F03 S2 case status

Scope: synthetic memory authority using the real F01 public session, plus
unchanged S1 pure controls. These are self-verification results, not an
independent audit. Node22.23.4 and Node24.13.0 each ran the same seven S2 tests
with 7 PASS / 0 FAIL / 0 skip / 0 cancel. Counts across runtimes or overlapping
control suites must not be summed into a number of independent requirements.

| Case | Node22 / Node24 | Evidence and limit |
| --- | --- | --- |
| S2-01: new schema24, Offering absent, same-title 2027/28 | PASS / PASS | Distinct Attempt/creation-operation/record owners; numbered video/lesson test, report/exam and learner evaluation; quantity1; save/reload/backup3/explicit portable restore |
| S2-02: edit + delete/Undo | PASS / PASS | Same owned-record ID, latest progress and complete graph survive removal/reload/Undo/save |
| S2-03/1: schema22→23, official partial1 | PASS / PASS | Exact source.raw whitespace/UTF-8, fingerprint and retained official rows; learner status/year/quantity1/report/exam and existing migrated assessment edit; backup2/portable restore |
| S2-03/4: schema22→23, official4 | PASS / PASS | Same retention checks; official4 never changed to manual1. Does not claim a production verified official subtotal |
| S2-04: dirty saved projection | PASS / PASS | Rejects unsaved snapshot without discarding draft or writing authority |
| S2-05: competing writer / reload | PASS / PASS | Full-record CAS conflict; revoked/stale projection rejected; explicit reload adopts saved result |
| S2-06: unsupported new assessment | PASS (rejection) / PASS (rejection) | Current guard preserves graph/authority; this PASS is not feature support |
| New nested assessment issuance requirement | RED / RED | tests/f03-s2-assessment.red.mjs: 0 PASS / 1 FAIL, exit1, new_assessment_requires_identity_contract |
| S1 Z null/empty slot | PASS 4/4 / same | Unchanged original tests on relocated rev3 source; no new official authority |
| S1 frozen slot invariance | PASS 2/2 / same | Original raw/IDs/receipt/order retained |
| S1 independent A–E controls | PASS 41/41 / same | Existing positive/negative synthetic fixtures, unchanged assertions |
| S1 C2 global once-only | PASS 10/10 / same | Global null/0/1/4; no additive per-owner official subtotal |
| S1 added slot/source/owner controls | PASS 19/19 / same | Null/empty slot, different source revisions, owner rebinding and slot conflicts remain fail-closed |
| S1 pure model / legal graph fixtures | PASS 25/25 + 27/27 / same | Original fixture validators and original tests |
| S1 original matrix | 19 GREEN / 11 BLOCKED_DEP on each | All 30 original case statuses retained; no formal case silently promoted |
| S1 original negative | 22 PASS / 1 FAIL on each | Unchanged historical C2 additive assert (0 !== 4), exit1; retained beside accepted non-additive C2 controls |
| F01 authority limited controls | PASS 5/5 / same | R8 reservation order/portable restoration and public load revocation; not all F01 tests |
| F02 completion / GEO / G03 pure preview | PASS 46/46 + 14/14 + 30/30 / same | Lightweight fixed-dev comparisons, not product reimport integration |

## BLOCKED_DEP / NOT_RUN

| Requirement | Status | Missing boundary or reason |
| --- | --- | --- |
| Genuine official same-Attempt association/enrollment | BLOCKED_DEP | F01 learner Command receipts are not official association/enrollment credentials; no verifier that establishes S1 resolver authority |
| Official revision adoption into schema24 / G03 reimport | BLOCKED_DEP / NOT_RUN | Closed official arrays and no public F01 import/reimport command/replay extension; separate G03 string host cannot replace ABC object authority |
| New ID-bearing media assessment create/save/reload | BLOCKED_DEP, executable RED | Session-owned nested identity chronology/replay contract absent. Numbered lesson tests and existing migrated raw assessment IDs are separate supported cases |
| Verified global F02 official subtotal on saved adapter | BLOCKED_DEP | Combined selected-curriculum scenario is not an official-only verified subtotal port; adapter returns null globally and allocation null per owner |
| Official result priority in production saved projection | NOT_RUN / BLOCKED_DEP | No manufactured resolver or fabricated receipt; original rows remain in retained/source, outside officialHistory |
| Actual native IDB, browser CAS, quota/unknown native outcome | NOT_RUN | Memory-host integration only; no Chromium run on the constrained Mac |
| Full Planner5692, Chromium, iPhone/Safari, capacity/RSS/non-cooperating writer | NOT_RUN | Explicit resource/scope constraint; isolated sequential CI diagnostic plan supplied |
| UI/F03 S3/S4 complete integration, independent audit, release | NOT_RUN | Outside this candidate; no subsequent Work/PR/audit automatically started |

The original matrix runner still contains its historical "F01 ... not
merged/connected" reason text. The fixed F01 commit is now merged; the
unchanged matrix's formal receipt/reimport cases are still not connected.
Build/typecheck/lint commands, exact exits and build-provenance details are
recorded in the delivery REPORT and raw logs, separately from this case table.
