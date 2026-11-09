# Remaining minimum APIs — design only, not implemented

## New nested media assessment

An additive public session operation should accept primitive learner content
and an AttemptId, not a caller assessment ID. A proposed
`addMediaAssessment(attemptId, payloadJson)` would validate owner and payload
before allocating an assessment ID and operation ID from the session allocator.
The original command must record issuance in ordered history so strict replay
can prove its role and chronology after reload and portable restore. An edit
operation keeps that ID; deleted/abandoned IDs remain reserved. A JSON string
field or a reservation entry alone is insufficient.

Before implementation, explicitly version the command/replay issuance policy
and compatibility contract. Test before-allocation validation, collision across
all namespaces, failed/abandoned save, reload, older checkpoint rollback,
portable adoption/order, stale CAS, and preservation of existing raw IDs.
Do not remove `new_assessment_requires_identity_contract` or
`nested_identity_history_requires_review` to enable a partial feature.

## Official association, enrollment and reimport

The present F01 authority can retain schema23 legacy official rows, but cannot
adopt a G03 ledger or append official revisions to closed schema24. A future
slice must first define the reviewed state/schema/command/replay migration.
Keep GradeSourceArchive raw bytes and independent snapshot/row/revision
provenance; bind the adopted row and occurrence to the Attempt owner, method
and year evidence, and an explicit nonempty original slot. Do not synthesize
the slot or trust a display label/fingerprint/hash as an issuer receipt.

A proposed verifier port would consume the actual replay-verified official
adoption/association/enrollment receipt and its revocation/current-source
state from that same F01 authority snapshot. Only this verifier may implement
S1 TrustedEvidenceResolver. University authenticity and host consistency must
be described separately: F01 portable SHA adoption is not issuer authentication.
Until that contract exists, official rows remain retained/unprojected and S1
officialHistory is empty in the saved adapter. Reimport, source replacement,
receipt expiry, same-slot conflicts and different revision causality are NOT_RUN.

## Global official credit subtotal

Expose an explicitly verified F02 official-only calculation result bound to
the same authority checkpoint and scope. The present combined scenario is
not that result. Keep unknown null and explicit0 distinct. Feed this value
once into `Projection.creditEvidence.knownOfficialCredits`; never place an
additive official subtotal on an owner. Raw official4 remains official4 in
retained state; this candidate does not perform production official accounting.

## Follow-up isolation

Run full Planner, native authority and portability/browser tests sequentially
in a separately authorized GitHub Actions diagnostic workflow: fixed candidate
tree, Node22/24 matrix with max-parallel1, npm ci, targeted tests, typecheck,
lint/build, then full Planner and Chromium. Preserve raw logs, exit codes,
artifact hashes, CAS/legacy drift/fault injections and resource timings. Include
iPhone/Safari as a separate real-device gate. No workflow dispatch, push,
independent audit, PR, merge or next Work is started by this candidate.
