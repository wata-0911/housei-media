> Historical recovery-baseline provenance only. The current approval/reservation candidate deliberately disables known publication and unreserved raw-save entry points; see docs/calendar/reservation-staged-rollout.md.

# Provided-source baseline

Date: 2026-11-03.

The user supplied GAS① and GAS② source after reviewing the earlier historical-source candidate. This package is built directly from the individually identified, normalized and redacted supplied files below. No live GAS project, deployment, settings, Drive file, calendar or LINE message was changed or tested.

- `GAS1.current.redacted.gs`: supplied generator/Drive-save/legacy metadata/LINE/publication source. SHA-256: `114f84a6bffe629973451c5122e912934ce5740e2968f3041fb984cdfd3e2d8e`.
- `GAS2.current.redacted.gs`: supplied existing response helper and read-only doPost bridge. SHA-256: `fb1e36a813f9c4e3337165e4e18c46b0b8ed5757782e676d1cfe8ca0af2238dc`.

Actual Calendar/Drive identifier literals were replaced by redaction markers in the shared source. Private original/unredacted inputs are not included. There were no embedded real secret values in these supplied sources: the read key and LINE token are accessed through Script Properties.

The supplied GAS① title-escaping block is correct. It escapes HTML and restores only the intentional br tag. The candidate retains that block unchanged, rather than applying the earlier historical-recovery repair.

## Baseline-preserving integration

- Original save function body is retained byte-equivalently; only its name is changed to the private `calendarDraftLegacySave_`. It still creates the same PNG filename format, writes the same six legacy properties, clears approval/publication timestamps, and returns the same original fields.
- A new public `saveDraftToDrive` wrapper validates the configured folder/PNG, serializes the original save and sync-outbox record, then sends after releasing the lock. It adds explicit saved/queued/synced fields without claiming remote success from Drive save alone.
- Existing getDraftInfo, calendar retrieval/formatting, calendar rendering/title escaping, LINE notification and publication function bodies remain unchanged. No publication-stop guard is inserted.
- GAS② retains its original read authentication, legacy fallback, public response fields and errors. The new action has separate authentication and a canonical snapshot.

## Known source-completeness and scope limits

The supplied source alone does not define CONFIG, findFileByNameInFolder_, formatYearMonth_, or sendLinePushMessageAsMultipleBubbles. They may live in other project files or represent unfinished features; their values/implementations were not invented. The input being identified and compared does not prove it matches the deployed version or includes every project file and trigger.

The existing source-side legacy save/publication workflow is not transactional or version-bound. The new sync outbox is metadata, not a replacement for that workflow. Later approval/publication changes are not synchronized by this draft-creation protocol. See README for the owner-side checks needed before any application.
