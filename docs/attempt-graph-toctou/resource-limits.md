# Attempt graph capture depth boundary

Capture rejects object/array nesting deeper than `MAX_ATTEMPT_GRAPH_DEPTH = 64` (root depth 0) with a `non_json_value` diagnostic naming the limit. Unknown fields are bounded before schema validation, so a parsed 10,000-level chain cannot exhaust the JavaScript stack. No RangeError catch-all is used; unexpected native clone errors retain their identity and cause.

The graph schema is closed and contains no recursive references. Its longest container route is graph → removals → ticket → attemptSnapshot → method/actualYear → evidence → ref → evidenceIds (depth 7). Variable-length arrays and digest maps do not add nesting. The 64-level bound leaves ample room above every legal graph shape; schema22/23/24 and backup formats are unchanged. Normal graphs, owner payloads and Undo snapshots still follow the same schema and semantic checks.

The limit applies to untrusted capture. Only module-created recursively frozen JSON nodes can use the existing provenance cache; schema and context are still checked on every snapshot call. No partial successful graph is returned for a rejected input.
