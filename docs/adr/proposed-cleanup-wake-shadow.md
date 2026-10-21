# Proposed: Retained cleanup wake shadow with canonical SQL recovery

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- Status: Proposed; numbering and acceptance belong to integration review
- Date: 2026-10-02
- Owners: CloudMarkup platform engineering
- Related: [ADR 0046](0046-project-content-erasure.md), implementation plan

## Context

The minute beta cleanup schedule prevents useful Aurora idle periods. Removing
it also removes recovery after SQL commit but before notification. Queues and a
24-hour stream cannot establish permanent coverage. The selected erasure policy
requires canonical intent, closed write admission, settled work and an exact
immutable receipt. Preparation must preserve those guarantees.

## Proposal

Prepare an optional shadow adapter with version-1 immutable deletion bindings in
a retained, encrypted beta DynamoDB table. Publish after confirmed SQL commit.
Failed observation preserves the API outcome. The unchanged minute SQL worker
can mirror pending requests and continues cleanup even if the ledger is
unavailable. This fallback is mandatory: post-commit publication does not prove
atomic cross-store admission or idle-safe coverage.

Four base-table partitions, strong pages and persisted cursors bound dispatch.
Streams accelerate it; periodic ledger dispatch recovers missed hints without
querying SQL when empty. SQS messages carry only a wake ID. An advisory lease
limits duplicates but never grants erasure authority. The worker rechecks exact
SQL intent, invokes the existing cleanup fence and removes a wake only after
matching SQL receipt readback. Expired messages, lost acknowledgments and failed
cleanup leave the wake. Export, job, credit and uncertain-write blockers retain
their existing owners; elapsed time never invents a terminal/financial outcome.

IaC is beta-only preparation, absent by default. Runtime flags, mappings and the
new schedule stay disabled. Two future roles are imported immutable; no IAM or
invocation grants are synthesized. The ledger has no TTL/GSI, retains on removal
and has 14-day PITR. Pending metadata remains until canonical completion;
backups expire under that proposed configuration. Live creation, access,
retention and activation require separate owner approval.

## Alternatives and limits

Minute SQL recovery alone is simplest but prevents idle savings. SQS/Streams or
post-commit DynamoDB alone lose coverage across missed publication and retention
expiry. A SQL outbox still polls Aurora; CDC requires an active source and more
infrastructure. A future locked PREPARED/COMMITTED journal with durable
precommit publication could establish coverage, but adds an admission
dependency, migration and coordinated abort recovery. That protocol and idle
suppression are a later decision, not enabled here.

## Consequences and verification

No public HTTP, graph/compiler, released SQL migration, storage-prefix or
erasure policy changes. AWS behavior stays behind API adapter ports; domain code
remains provider-neutral. Metadata contains validated IDs, versions and
timestamps, with no keys, labels or bodies. Future worker permissions must scope
ledger/queue, existing erasure and Data API access; the dispatcher needs no
SQL/S3 permission. Proposed roles remain unprovisioned.

Focused synthetic tests cover commit ambiguity, missed/partial delivery,
duplicates, mismatched receipts, empty ledgers, backlog pagination and retained
blockers. Native concurrency, cloud IAM/trigger acceptance, restore recovery and
complete release gates remain required. Synthetic ports do not prove genuine
PostgreSQL or AWS behavior.

Rollback disables shadow observers, workers and new triggers with the minute SQL
schedule enabled. Retain ledger, queues, fences and receipts; never reopen
admission or undo erased bytes. Reconsider only with complete coverage and
canonical reconciliation evidence.
