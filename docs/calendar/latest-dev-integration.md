# Local calendar integration on latest dev

## Pinned sources

- Latest `origin/dev` fetched on 2026-11-04: `10a956d82afedad91b5709998b1ae9079416e851`.
- Original audited candidate base: `b0a0810ca2e90596b857673a5b71f8001079c98a`.
- The supplied `reservation-fixed-source.sha256` identifies 39 audited candidate files. All 39 were verified before copying. None overlapped changes from the candidate base to pinned latest dev.
- The candidate source manifest remains available for comparison. The Function builder and its startup test were adapted for the Node 22/24 runtime matrix, browser/JSDOM suites gained interruption/replacement coverage, and the deployment gate plus API/build/Function tests were tightened to production-only operation on the exact dedicated dev project. Further files added here are local test/CI plumbing and this review note.

## Preservation

The latest dev Planner, grade-import v2, attempt/persistence sources, dependency versions and package lock are retained. The original latest CI remains an exact prefix of the proposed workflow, including grade-import pure, native host and v2 checks and browser checks. Existing npm scripts are unchanged. Calendar-only scripts and a separate CI matrix are additive.

## Production-only deployment gate

The shared frontend-build/API-runtime gate requires VERCEL=1 and VERCEL_ENV=production, plus the exact enabled dev branch, repository owner/slug and matching dedicated project IDs. Preview, absent and unknown environments are denied even with otherwise correct metadata. Production main is denied. Explicit local-test semantics are unchanged: VERCEL must be absent, NODE_ENV must not be production, and CALENDAR_LOCAL_TEST_MODE must be true. Browser test source and execution limitations remain unchanged.

## Proposed CI

Both Node 22 and Node 24 run:

1. Calendar API/server type checking.
2. Assembled GAS reproducibility and synthetic GAS reservation/sync contracts.
3. Mock LINE/GAS API and JSDOM lifecycle contracts.
4. Enabled-project `main` exclusion and `dev` viewer build checks.
5. Official Vercel Function artifact generation for the matching Node major, followed by emitted-JavaScript startup/request contracts without tsx or any TypeScript loader.
6. Chromium mobile/browser contracts with all external requests mocked or blocked.

QA tooling is installed in a separate runner-temporary directory at exact direct versions: `@vercel/node@5.8.6`, `@vercel/build-utils@12.0.0`, `jsdom@26.1.0`, `playwright@1.56.1`. Product dependencies are unchanged. Tool transitives are not lockfile-pinned. Each check preserves its own failure; matrix fail-fast is disabled. No credentials or real data are required.

The Function builder explicitly uses its documented project settings/considerBuildCommand path to skip dependency installation and use a no-op app build because product dependency installation and browser builds are separate CI steps. It still executes the official builder's TypeScript compilation and dependency tracing. Generated manifest runtime must match the executing Node major. This is local artifact compatibility evidence, not a Vercel deployment or live integration test.

## Known local browser limitation

Chromium was attempted both normally and once through the supported execution escalation. Both launches failed before any page test could run because the environment denied Chromium's singleton Unix socket (`socket() failed: Operation not permitted`). Browser cases, including the three new interruption/reload/replacement scenarios, are **blocked, not passed**. Their syntax was validated. Matching JSDOM transport, remount and replacement-identity tests pass locally, but do not execute browser behavior. JSDOM and main/dev compiled bundle tests do not replace real-browser visual/mobile validation. The proposed GitHub Actions browser step remains enabled, but has not been run remotely because commit/push/PR actions are not authorized.

## Boundaries

This package is a local review candidate. No commit, push, PR, merge, deployment, live GAS edits, old-v18 retirement, Vercel setting changes, December image regeneration/migration/approval, LINE notification or automatic publication is performed. Runtime approval remains default-off. Deployment, runtime/secret setup and genuine staging integration still require separately authorized work and the gates in `reservation-staged-rollout.md`.
