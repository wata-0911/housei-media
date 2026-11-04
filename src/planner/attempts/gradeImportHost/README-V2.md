# Internal v2 correction host

`createGradeImportHostV2` in controllerV2.ts is unconnected to production/UI.
The existing v1 codec, contracts and allocator are unchanged. The v1 controller
uses the same strengthened observed-raw fence, with its wire format unchanged.
`decodeNativeRecord` reads either closed version; decoding is not qualification.

For an existing v1 native record:

1. `load()` obtains a private native handle. Reading never upgrades storage.
2. `prepareUpgrade(handle)` returns exact confirmation targets.
3. `confirmUpgrade(intent, confirmationJson)` seals an explicit reason and target.
4. `commitUpgrade(proposal)` stores the exact old raw string inside one v2
   record, rereads under the common Lock, and retires this controller.
5. A new controller loads v2. `recoverUpgrade` is a read-only result query.

For one original row, call `preview(handle, sourceRaw)` then
`prepare(preview, activate, candidateRefJson)`. The candidate reference must be
an explicit selection of achievement/revision/observation IDs from the displayed
preview. It is never automatically chosen by this host. Initial empty-ledger
new uses null; corrections require the latest revision of the sole achievement.
Reimports, changed year context, renamed/outside candidates and multiple rows
are unsupported. `confirm`, `commit`, `acknowledge`, `recover`, `cancel` retain
the v1 lifecycle boundaries. The pure test-only allocation/canCommit flags remain
unchanged and confer no save authority.

T1 publishes IDs only after durable reservation and reread. Existing logical
achievement/detail IDs are references, never minted again. H includes all base
and suffix burns; F is solely the committed ledger floor. Old unused grants can
be inspected by read-only recovery but never revive tickets. T2 stores the full
Decision and operation mapping with the ledger in one CAS put. activate=false
retains the prior active head; activate=true adds import and head switch together.
All old quantities remain historical facts; no revision summation/graduation
calculation is performed.

v2 keeps legacyBaseRaw byte-for-byte and verifies it with the pinned v1 dependency
closure. Suffix replay reconstructs every historical ledger prefix and Decision.
Old receipts/outcomes are returned unchanged. New outcomes carry a policy tag and
suffix-local sequence. Authority generation is base generation + suffix event
count; migration itself is represented by the anchor and changed full raw, not a
fake grade operation. Full raw CAS is the write fence.

Any observed unexpected native raw (including a valid other update seen by load)
revokes this controller. Only its exact expected post-write raw is accepted during
readback. Corruption keeps the original first diagnosis; later operations return
session_stopped. Confirmed tx abort remains retryable with the identical judgment;
unknown outcomes stop irreversibly and require a new controller's explicit query.

This format is hostVersion=2, policy g03-revision-import/v2, not a new Attempt
schema, backup version, or N/B/A/U allocation. New behavior must use a new policy
and retain historical verifiers. The 8 MiB aggregate and existing pure resource
limits remain. Wrapping a near-limit v1 record can refuse migration; no truncation
or automatic limit increase occurs. Large-raw replay cost needs further product
performance work before public migration. Backup/restore, legacy Attempt/LS
migration, general UI, partial adoption and cross-device lineage are absent.
