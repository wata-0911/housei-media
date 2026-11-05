# F1–F6 synthetic audit reproductions

These repository-contained inputs require no parent directory or external evidence file.
`sourceOverrides` is hydrated on `initialState()` before the existing schema23 decoder.
F3–F6 use the validated schema24 new-plan source (F5 keeps its raw numeric JSON).
Only synthetic learner Attempt/operation UUIDs were replaced, consistently within each file.
Public institutional Course/Placement/source IDs, quantities, official associations and expected findings are retained.
`provenance.json` binds both original and anonymized byte SHA-256 values. Original audit JSONs remain immutable in the audit evidence archive; the final handoff includes their original bytes for optional inspection.

Run `node --import tsx --test tests/work-b-audit-reproductions.test.mjs` for the six RED/GREEN assertions.
Run `npm run test:work-b-final` for exact 192/168 deltas, mutation checks, positive/negative boundaries, and all-eight-program allocations.
Neither source qualification nor this calculation certifies the learner's curriculum applicability.
