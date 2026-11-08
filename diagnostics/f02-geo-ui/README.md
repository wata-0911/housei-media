# F02-GEO PR #241 isolated browser diagnostic

This branch contains only a diagnostic workflow, a Playwright browser harness, and six synthetic fixtures copied byte-for-byte from the independent Astra audit. It makes no product, product-test, PR, `dev`, or `main` change.

## Immutable target

- Draft PR: <https://github.com/wata-0911/housei-media/pull/241>
- Product commit: `1872d76f8fc4bff172388f3901273d74860ddc8b`
- Product tree: `c1f1b3c29efccb022145c6633026ac699b024ec4`
- Base `dev`: `35b69eddbc7124010137b2b094b919f9ce889e58`
- Diagnostic ref: `refs/heads/diag/f02-geo-pr241-ui-20261108`

The workflow triggers only on a push to that ref. It checks out the product commit and diagnostic commit in different paths, verifies the target tree and fixture hashes, builds the fixed product, then runs actual Chromium on GitHub-hosted Ubuntu with Node 22 and Playwright 1.62.1. The token has read-only contents permission; checkout does not retain credentials. The harness serves only local build output and blocks non-loopback requests. It contains no personal data.

## Measured scenarios

- A: Old Planner backup restore, S0/S2/S6 at 1280/390 px; school-required and professional totals, reload, stored items including explicit zero and IDs.
- B: Native24 four K4 destination attempts, original quantities, hold rows, zero graduation increments, editing zero/null/positive, delete/Undo, reload and IndexedDB authority.
- C: Official22→formal23 R1 and K5 zero/S2 migrations, byte-exact `source.raw`, original rows, preserved zero, IDs, editing, delete/Undo, reload.
- D: R1 regular T4 official and native24; selected required-elective/professional totals 4/4, native edits 0/null/4, delete/Undo.
- E: All cases at 1280/390 px, full-page screenshots, phase log, console errors, page errors, failed/HTTP-error requests, width overflow.

The workflow fails if any measured assertion fails. No scenario is skipped or counted from the independent code-only audit. `test.log` and JSON/PNG evidence are uploaded as an Actions artifact even on failure. A passing run would still require review of the artifacts and separate independent acceptance.

## Local preparation and transfer

The creation environment has no GitHub CLI login; it did **not** push this branch or run GitHub Actions. The supplied bundle is a complete local branch transfer, and the `.patch` is a second review format. On an authorized Mac, perform only hash verification and a diagnostic-branch push; the Mac does not build or execute Chromium:

```bash
shasum -a 256 F02-GEO-PR241-UI-DIAG-20261108.zip
unzip -q F02-GEO-PR241-UI-DIAG-20261108.zip -d f02-geo-ui-diag
cd f02-geo-ui-diag
diag_dir="$(pwd)"
shasum -a 256 -c SHA256SUMS
git -C /path/to/housei-media fetch origin dev
git -C /path/to/housei-media ls-remote origin refs/pull/241/head
git -C /path/to/housei-media bundle verify "$diag_dir/f02-geo-pr241-ui.bundle"
git -C /path/to/housei-media ls-remote --heads origin diag/f02-geo-pr241-ui-20261108
git -C /path/to/housei-media fetch "$diag_dir/f02-geo-pr241-ui.bundle" refs/heads/diag/f02-geo-pr241-ui-20261108
git -C /path/to/housei-media cat-file -t <DIAGNOSTIC_COMMIT_FROM_MANIFEST>
git -C /path/to/housei-media push origin <DIAGNOSTIC_COMMIT_FROM_MANIFEST>:refs/heads/diag/f02-geo-pr241-ui-20261108
```

Stop if `ls-remote` finds the diagnostic branch, if PR #241 has moved, if local hashes differ, or if bundle verification fails. Inspect the workflow and branch diff before the push. The push starts the workflow. It does not create a PR or update PR #241.

## Provenance

- Independent code PASS/UI INCOMPLETE: <https://drive.google.com/file/d/1Sc7dwutDyliJfk-CQJ3UQnPJ_Q5SG3Na/view>, §6.
- Independent prior BLOCKED UI instructions and synthetic fixture manifest: <https://drive.google.com/file/d/11stpzxCaeokw6Up-DPGonrG0xQikwgNg/view>, §7.
- `fixtures/SHA256SUMS` is checked before the browser step.
