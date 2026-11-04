# Isolated native grade-import host

Internal, unconnected host for `g03-native-one-row/v1`. No PlannerPage,
production entry, old Planner state, graduation, migration, or backup connection.
The distinct string format exclusively occupies the existing isolated
`hosei-yi06-isolated-v1/authority/current` slot. Existing databases (including
missing/undefined current keys) cannot be initialized as empty hosts.

`createGradeImportHost` takes trusted infrastructure dependencies; none are UI
inputs. `initialize/load → preview → prepare → confirm → commit` uses private
live-object registries. Only `prepare` publishes IDs, after T1 durable reservation
and strict reread. T2 atomically saves ledger, the complete decision receipt,
operation bindings, reservations, authority and outcome, then strictly rereads
under the common exclusive Lock. Pure `canCommit=false` and test-only allocation
markers retain their meaning. No displayed JSON, bare operation or digest is a
save credential.

One archive / one original row / new only; explicit activation is optional and
atomic with import. A second adoption, corrections and multiple rows are refused
as a whole. Historical years and missing Offerings are accepted without inferred
university identity. Raw JSON, revisions, null/0, details and their order remain
in the unmodified pure ledger. A host record proves local lineage, not university
authenticity or protection from arbitrary same-origin code.

T1 burns survive cancellation and failed T2. Host reservations H are distinct
from committed ledger floor F; only F reaches pure functions. A receipt seals one
intent's decision; successful exact retries use `acknowledge`, with no writes or
new IDs. `outcome_unknown` irreversibly stops that controller. A new controller's
strict load and explicit `recover` must determine the result; no automatic resend
or rollback. Unused grants never revive live tickets after restart.

Limits: 8 MiB host JSON, 128 grants, one adoption batch, 20,000 host IDs (the
current grant limit is tighter). Exhaustion refuses further work, without
truncating history or reclaiming burns. Unsupported Web Locks / IDB inventory
fail closed. Durability is scoped to the intact local lineage; browser storage
clear, device/OS failure, recovery backup and cross-device lineage are not solved.

Tests: `npm run test:grade-import-host`, `typecheck:grade-import-host`, and
`test:grade-import-host-browser`. Browser tests require separately provisioned
Playwright/Chromium via `PLANNER_PLAYWRIGHT_MODULE`. Optional
`G03_PR4_REFERENCE` points to the immutable PR4 source checkout to additionally
exercise that actual adapter against this string record; it is never a product
dependency. All fixtures are synthetic and use isolated profiles/origins.
