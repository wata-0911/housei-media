# Read-only state JSON replay (stage 2)

`replay/replayStateJson.ts` accepts a primitive string at runtime, scans privately
owned JSON and embedded migration source/correction JSON, then calls the existing
`replayState` version dispatch. No stringify fallback. No replay cache, iteration
sampling, digest-only validation, or changed codec/newPlan/Command implementation.
The existing source re-decoding, pinned raw-six-file checks, catalog compatibility,
schema24 pinned master/target evidence, ordered Command execution, complete
state re-encoding/equality, ID reservation, removal/Undo and receipt checks remain.
The source/context is reconstructed inside replay, never supplied as a main-realm
object or accepted on the basis of a digest label. schema23's compatible target
catalog remains part of the old integrity contract; this does not attest to a
host controller's current target or saved checkpoint.

The result is a frozen, bounded `ReplaySummary`: schema, counts, recomputed graph
and retained digests, and the literal `read-only-replay` kind. These digests report
the completed full verification; they do not replace it. There is no full state,
Workspace, source archive, reservation list, controller handle, preview token,
source certificate, host witness, storage/adoption permission or new ID.
Successful integrity replay does not mean saved, adopted, issuer authenticated,
learner applicability confirmed or official source links reverified.

`createReplayClient().replay(raw, signal?)` uses one fresh Dedicated module Worker
per job, terminated at settlement. `cancel()`/AbortSignal terminates it and rejects
with `cancelled`. There is no synchronous fallback. At most one job per facade;
concurrent calls fail `busy`. Other facades may run independently. The caller keeps
the input; neither this API nor failure/termination rewrites any persisted original.
There is no production Planner UI consumer. This stage performs no persistence.

## State policy (independent of Graph/backup/storage capacity)

| resource | inclusive maximum |
|---|---:|
| outer raw UTF-8 bytes | 64 MiB |
| container depth, root=0 | 72 |
| object/array containers, including embedded source JSON | 500,000 |
| JSON values including roots and embedded source JSON | 2,000,000 |
| object fields including embedded source JSON | 1,500,000 |
| one decoded key/value string | 24 MiB |
| decoded key/value bytes, including embedded source JSON | 64 MiB |
| commands | 10,000 |
| corrections | 128 |
| estimated structural work units | 250,000,000 |

Main first checks primitive type and UTF-16 length (only a lower bound on UTF-8
bytes). Strings at most floor(64MiB/3) UTF-16 units fit by a safe UTF-8 upper bound.
Longer strings get an exact, cancellable byte scan yielding every 65,536 units
before any Worker is started or message posted. Main performs no JSON structure
scanner, parse, stringify, context construction or replay. Worker checks exact UTF-8 and all structural budgets before
native outer parse. Embedded source/corrections are scanned before the existing
migration decoder tokenizes them. Native parse has no reviver. Decoded duplicate
keys, non-finite/-0/unsafe integer Numbers are rejected without normalization.
The scanner is a separate state copy of the audited Graph scanner, with independent
constants/accounting; Graph's parser/profile/capture registrations are untouched.
Scanner output itself has no certificate and never escapes through this API.

Work = `(aggregate values + ceil(aggregate string bytes/16) + 100000 + ownerBound²)
* (commands+1) * (corrections+1 for schema23, otherwise 1)`.
ownerBound counts final owned records plus add_record Commands, including records
later deleted. Charging the entire input each round conservatively includes past
payloads, receipts, original source and catalog, rather than looking only at the
final graph or number of Commands. The fixed charge covers repeated bundled
context work; the quadratic owner term covers competing legacy owner scans.
This is an admission heuristic, not an exact CPU instruction/heap bound. The old
algorithms still have data-dependent costs. Client enforces a 30s startup timeout
and 5 minute job timeout by termination, always failure. A caller directly using
the synchronous JSON API has no termination guarantee.

The measured synthetic fixture inventory (all 100 Commands) spans schema23 normal
3.26MB / 73,527 values, 500 migrated Attempts 5.58MB / 128,153 values, heavy progress
3.50MB / 90,863 values; schema24 28KB–270KB / 814–18,068 values. Depth is 6–7 and the
largest embedded original file is 637,514 bytes. Budgets leave headroom above these
fixtures and a 32MiB authority record, including original archives and duplicated
source/catalog/history, without reusing Graph's 32MiB profile. Heavy includes
1,000 lessons, 100 assessments and 1,000 reports on one owner. Larger arbitrary
historic states are not proven to fit. Exceeding this optional Worker policy is an
explicit `resource_limit`, with caller original retained, never truncated or
silently retried on the main thread. Existing save/backup/object APIs are unchanged.

## Wire and lifecycle

Every message in either direction is a primitive string. Requests use bounded ASCII
headers, avoiding a second main-thread JSON.stringify of a large raw:

* `hello:<epoch>` → exact JSON `ready` envelope, version 1, epoch.
* `replay:<epoch>:<job>\n<raw>` → one exact success or failure JSON envelope.

Epoch increments for each Worker start, job for each attempted job, across facades
in the loaded client module. Safe-integer exhaustion fails. Worker accepts one
hello and one job; malformed/extra requests emit a fixed invalid marker and close.
Main enforces 4,096 UTF-16 units before response parse, exact keys, fixed enums,
counts, finite times, hashes and bounded Error representation. Wrong epoch/job,
duplicate ready, premature success, nonstring, oversized and unknown fields fail
`protocol` and terminate. Queued callbacks captured before settlement are inert;
a restarted job's Worker and epoch are different. No stale result is re-used.

Failures distinguish `invalid_input`, `resource_limit`, `internal`, `cancelled`,
`startup_failure`, `worker_failure`, `protocol`, `busy`. Input scanner has a typed
error; all existing untyped legacy validation exceptions conservatively remain
internal. No message/regex/allowlist classification: a bug can throw the same
message as a validation refusal. Only this new entry's dedicated input error
type maps to invalid_input/resource_limit. The same-realm JSON API passes through exceptions from existing replay unchanged.
It does not recover identity already consumed by a pre-existing helper catch.
Across the Worker realm, there is no Error identity promise: only a fixed Error
name/redacted message with at most two redacted cause levels; no raw, path, stack,
label, title, source, diagnostic dump or exception message crosses the boundary.
Existing helpers' internal catch/diagnostic contracts are unchanged. A malformed
legacy object shape that triggers an untyped engine fault can conservatively report
internal failure; it cannot produce success. A corrupt graph rejected by an untyped legacy exception may therefore report
internal rather than invalid_input. Classification is not issuer proof.

The Worker import closure has no controller, IndexedDB adapter or commit/Lock
caller. Real browser tests poison ID generation, IndexedDB writes, Lock requests
and fetch. Worker JavaScript runs in the application's ordinary origin and is not
a security sandbox against arbitrary same-origin code/XSS; read-only describes the
module's capabilities/call graph, not a browser-enforced ban on all platform APIs.

## Validation and follow-up

Run `npm run test:attempt-replay` and `npm run test:attempt-replay-browser`.
`tests/helpers/replay-browser.mjs` supplies isolated bundled test pages; production
Planner entry is not changed. Test-only bundles observe internal full results to
compare every state/Workspace/reservation value with the old full replay, while
production Worker returns only a summary. Tests of fault injection/counters are
separate from uninstrumented replay timing. Build also verifies Vite's actual
module Worker URL emission. The standalone performance runner reads the saved
synthetic inventory from `evidence/stage2` after generation.

Stage 3 must place source/session/handle/preview/checkpoint/ID/CAS/Lock/storage
ownership inside one Worker, define scalar intents/tokens and revision checks,
and handle commit crash/timeout as an unknown result requiring DB reconciliation.
No stage-2 result may be promoted into those credentials. CPU/memory optimization,
closed builders and replay reuse need separate validation. Stage 2 is not PR #183
P2 closure, dev integration approval or a Safari/real-device release decision.
