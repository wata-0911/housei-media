# Internal B1 full-host backup / R0 isolated restore

Unconnected to production/UI. `createGradeImportBackupController` takes trusted
IDBFactory, Web Locks, exact origin and localStorage for the **same bucket**.
No caller store/allocator/record/proposal JSON is accepted as live authority.

- `exportBackup()` reads the canonical native host under the common exclusive
  Lock, dispatches the unchanged v1/v2 full verifier, packages the exact raw,
  round-trips B1, and rereads the native raw before returning a File.
- `prepareRestore(file)` captures intrinsic File bytes/name, inspects the whole
  bounded B1, checks origin/native DB/old LS, and returns private confirmation
  targets. Review `targetsJson`, including history, H/F counts and trust limits.
- `confirmRestore(intent, JSON.stringify({targetSha256: intent.targetSha256,
  confirmed:true, reason}))` seals one judgment. Plain/cross-owner/copied tokens
  cannot commit. A changed reason is a conflict, not a retry.
- `commitRestore(proposal)` rechecks everything under the same required Lock.
  Only DB absence allows creation. The versionchange transaction requires
  oldVersion=0, creates the store and puts decoded A exactly once, with no new
  UUID. Cancellation/environment/LS are checked again at the put boundary.
  Existing DBs (including missing/undefined/foreign current) are never replaced.
  Exact same valid A allows read-only `already_present`.
- Successful creation waits for transaction termination and full native reread
  under the Lock. The controller retires. Use a fresh host controller afterwards.
- Terminal abort is known-not-committed. Post-submit cancellation/post-read
  failure/uncertain completion stops with `outcome_unknown`. No automatic retry,
  delete, rollback or repair. A fresh controller's `queryRestore(file)` returns
  `already_present`, `not_present`, or `conflict_or_unresolved` without writes.

B1 is `hosei-grade-import-host-backup` version1, not an Attempt backup or new
hostVersion. UTF16LE canonical base64 protects every JS code unit, including
noncanonical outer spelling. G01a raw/DTO, all revisions, journal, H/F, grants,
receipts/outcomes, legacyBaseRaw and policies remain unchanged inside A.
24MiB file, 64KiB metadata, depth8 and encoding preflights are independent of
historical graph limits. The portable module name avoids conflating this new
host consumer with the existing Planner backup subsystem in dependency guards.

Checksum/full replay proves content consistency, **not issuer authenticity**,
latestness, university identity or absence of unknown burns on another device.
R0 is for a same-origin isolated profile/storage partition. It does not prove
that a supposedly empty bucket has never been erased. Source hostId/provenance
remain source assertions, not destination genesis evidence. No private ticket
is restored; unused grants remain permanent restrictions only. Cancel reasons,
pending source/confirmations and unpublished session burns were not persisted
by v1/v2 and cannot be recovered from a file.

R0 has no durable restore receipt. `already_present` proves A exists **now**,
not that a particular restore operation succeeded in the past. Old grade
receipts and outcomes retain their exact original meaning and read-only ack.
No existing-host replacement, rollback, lineage merge or origin rewriting.

Build provenance (F-01): `producer.revision` is the actual clean checkout
commit containing this exporter, injected by `vite.config.js` through
`scripts/grade-import-backup-revision.mjs`. No product-source SHA constant,
runtime Git/network, caller option or SHA environment override exists.
Unbundled Node imports, Vite dev, unavailable Git, missing exporter source,
dirty/untracked/hidden-index/ignored source or invalid stamp fail B1 packing
with `revision_unavailable`; inspection and R0 remain available. Vite checks
source again at buildStart and generateBundle and aborts if a qualified source
changes. Run `npm run check:grade-import-backup-revision` as the strict release
gate before `npm run build`; the normal product build may proceed with B1 export
explicitly disabled when no revision can be established. This candidate is
uncommitted: it has NO actual exporter commit stamp.

Only the tests import `tests/grade-import-backup/revision-fixture.mjs`, whose
synthetic revision is marked `test-only` and requires a separate compile-time
test flag. Production settings always replace that flag with false and never
import the helper or read an environment SHA. The stamp lives in module-local
`import.meta` compile-time replacements, not globals or controller arguments.
A test revision in B1 is test data, not a claim that such a Git commit exists.
Node suites bundle the codec with this explicit test setting; browser fixtures
use the same isolated esbuild setting. Direct tsx imports cannot issue B1.

PR CI uses the checked-out HEAD (normally the synthetic merge commit under
`pull_request`), including exporter sources, NOT the PR head SHA relabelled as
the merge build. CI runs the strict checkout gate, the normal build and a native
Vite-bundle gate with `G03_REQUIRE_CLEAN_EXPORTER=1`. Vercel's default npm build
uses the same Vite resolver; `VERCEL_GIT_COMMIT_SHA` alone is never proof of a
clean source tree. If Git/required blobs are unavailable, export stays disabled.
Use a verified clean Git checkout to build any exporter-enabled artifact; do not
substitute a provider variable or copy a test define into deployment config.

After committing, in a fresh clean checkout with Node22 and dependencies,
run the strict revision gate, the production build, then
`G03_REQUIRE_CLEAN_EXPORTER=1 PLANNER_PLAYWRIGHT_MODULE=<module> npm run test:grade-import-backup-revision-browser`.
The latter builds the regular APIs with actual Vite production settings and
issues a B1 through the native controller in a synthetic empty host, comparing
its revision to independently read `git rev-parse HEAD`. Set
`G03_REVISION_EVIDENCE` to an existing external artifact directory to preserve
stamp/result/B1 evidence. Recheck source cleanliness afterwards. This real
clean-commit gate has NOT been run for the uncommitted candidate.

Inspection verifies only the 40-hex producer field's shape and the B1 integrity
contract, with full replay. It does not authenticate that the producer really
built that commit. Earlier B1 files remain inspectable/restorable; their
producer assertions are not retroactively certified. Build provenance assumes
a trusted build pipeline and a checkout isolated from concurrent/malicious
writers; it is not a signature, reproducible-binary attestation or authenticity
proof for grade history.

Creation uses a versionchange transaction without an explicit strict durability
hint, as in the existing adapter. It is not the strict readwrite CAS path. Full
content reread/process restart does not establish physical power-loss safety.
Normal/maximum/history tests record instrumented times and sampled heap, not a
public performance acceptance. General recovery UI and quarantine are later
work. Do not expose this internal harness as completed public recovery UX.
