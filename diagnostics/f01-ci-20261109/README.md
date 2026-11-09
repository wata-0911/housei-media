# F01 fixed-tree CI package (prepared, NOT RUN)

Candidate 91126d7e7fe4d48430035beae02557e5477d5d71 / tree 937006e2c9d859b542fd9f7242604c1d5219319d is the immutable source under test. Diagnostic changes are additions only in this directory and one dedicated workflow. The existing CI is unchanged. No push/run was performed during preparation.

The independent audit ZIP SHA256 is 898b805b91e38b33c6b455b17ba0c16d53d466b53c078478f0c2162f5dad24a5. Its REPORT, reproduction procedure and gate-results were reviewed. Its Node22/24 PASS is background evidence, not a result of this workflow.

## Execution and cost

15 matrix jobs: two Node jobs (22.23.4, 24.13.0), eleven Node22 browser phases (core/r2/r3/r4/r5/r6/r7/r8/ac/abc/capacity), two Node24 browser phases (ac/abc), then one 2-minute verdict. Ubuntu24.04 label, action commit pins, exact Node patch versions. Maximum parallelism 2; each matrix job has a 60-minute hard limit, each suite a 30-minute subprocess limit. Upper bound 902 runner-minutes, usually expected much lower; no cost/performance assertion before actual runs. Jobs use standard hosted runner RAM, Node heap cap4GiB. Chromium native/process memory is outside the Node heap cap. No deliberate OOM allocation. Artifact retention7 days. Snapshot cap40/job, HTML256KiB each; full suite logs retained. This is a diagnostic budget, not production capacity acceptance.

Project npm ci uses unchanged package-lock. Playwright is ABSENT from that lock; claiming a lock-pinned browser version would be false. The isolated browser dependency is exact playwright1.62.1, matching existing candidate CI. npm registry integrity checks apply; generated runtime package metadata, OS image version and browser version are logged. Ubuntu image is a hosted label, not immutable VM pin. No secrets, repository token write scope or deployment commands.

Each suite gets time -v RSS and exit/elapsed logs. cgroup memory.peak/events are recorded when accessible, may include the whole job and do not isolate browser RSS. Browser snapshot instrumentation wraps launch/context close without changing expectations/timeouts. Snapshot collection errors are recorded separately and do not convert tests into PASS. Hard runner cancellation/OOM may prevent final upload; GitHub job logs then remain necessary evidence. Upload uses always() on normal failures.

## Native coverage

All existing authority admission/remediation/remediation-UI/r2/r2-UI/r3/r4/r5/r6/r7/r8 suites, AC and ABC run unfiltered with original timeouts. ABC must report exactly17 tests/pass17/skip0/cancel0. B1 officialfalse/true are inside it. Existing r5/r7/r8 cross-origin and r2/r3 writer/tab simulations keep their original distinctions; they are not proof against an arbitrary uncooperative process. Node test:planner contains F02-GEO and R1 cases. No F01_R6_SMALL reduction is enabled.

Existing r3 covers migration file size boundaries and standard v2; r4 logs typed-array long tasks/refusals; r5/r6/r7/r8 cover large reservation sets/restore/ordered history. New capacity.browser.mjs adds exact Japanese UTF8 16MiB±1 file/lexical boundaries, 32MiB±1 lexical boundaries, native oversized-record refusal, loss of edit/backup permission, record hash preservation and test-only external checkpoint reset followed by ordered reload/backup. That reset is not product auto-repair or an explicit restore success. Existing suites supply normal explicit restore/Undo evidence.

Full valid16MiB migration and full valid32MiB authority acceptance remain NOT_RUN: lexical success alone cannot certify a replayable plan of that size. Physical OOM, mobile/Safari/Firefox and arbitrary external writer are NOT_RUN. Long tasks are measured without a fabricated latency threshold; performance acceptance requires interpreting actual evidence. New Attempt geography S2/S6 unique_safe_placement_required holds and F03/F04 public gates remain separate.

## Launch later

Use the external ZIP README and push-diagnostic.py from the package. They verify bundle SHA, branch absence, remote dev/PR-head fixed values, candidate parents/tree and the additions-only diagnostic delta. Only the new diagnostic ref is non-force pushed. Existing dirty worktrees are not checked out/reset/cleaned. If any fixed ref moved, STOP; preserve this audited candidate and ask management about a later integration. No automated merge, PR update, rebase, new Work or independent audit is started.
