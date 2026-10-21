# ADR-0046: Immediate active project-content erasure with retained lifecycle metadata

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Proposed
- **Date:** 2026-09-08
- **Owners:** Cloud Markup engineering
- **Supersedes:** None

## Context

The owner selected: “Erase project content immediately; let backups expire under
their configured retention.” This resolves the beta content-retention choice.
Technical activation remains subject to implementation and verification under
the completion plan. It does not authorize current live deletion, account-wide
erasure or changes to protected financial/security records.

The authenticated project API already records an authorized, idempotent deletion
request and denies later editing/export authority. Object writes can outlive a
request; merely listing and deleting current keys could report a false
completion if an earlier upload subsequently finishes. Historical S3 versions,
delete markers and unpublished/orphaned bytes also require removal. Async jobs
and financial reconciliation can still require their recovery objects.

Existing immutable graph/revision, export and commercial contracts remain
authoritative. This decision adds a platform persistence adapter; it changes no
graph command, catalog version, compiler contract or customer deployment.

## Proposed implementation

Close a permanent project write-admission scope once its canonical deletion
request exists. Every production object body writer must register before
external I/O and record its verified completion afterward. A failed provider
response or failed completion recording leaves an uncertain/in-flight journal
entry. Time alone never clears it. The journal stores metadata, not bodies.

Retain active project content until all registered writes are complete,
canonical async jobs and export reconciliation are terminal, and credit holds
are settled/released through their existing authoritative workflows. This is
safe processing time, not a discretionary content-retention window. Deletion
does not invent terminal outcomes, refund credits or erase financial evidence.

A dedicated platform worker derives exact organization/project prefixes from the
stored request and fixed bucket configuration. Before and after each bounded S3
operation it rechecks that authority. It erases every returned version and
delete marker, verifies exact responses and fresh absence, and retries from the
first remaining page. It does not follow caller-provided keys.

Only after absence verification may one database transaction mark object
metadata deleted, write an immutable completion receipt, clear mutable
project/environment labels and finish the project tombstone. Database guards
reject late object publication and inconsistent receipts. Repeated and
concurrent cleanup converges on the same receipt; partial failure stays pending.

The current storage namespace contains the existing outer and inner
`v1/organizations` components. Preserve it exactly. A storage-layout change
requires separate compatibility and migration evidence, never an assumed key
normalization.

## Retained scope

Active source documents, drafts, immutable revision bodies, generated files,
artifacts, Evidence and job snapshot bodies in the project's three S3 namespaces
are erased. Mutable project/environment labels are cleared. Immutable billing,
authorization, security and provenance metadata remains, including IDs, hashes
and revision/export descriptors, under existing access controls. Exact
production minimum periods and broader metadata de-identification remain
separate decisions. This is not a promise to erase every descriptive database
field or the account itself.

Backups expire under their configured retention. Restored backups must not
reopen a deleted project's authority; restoration acceptance must reapply the
deletion ledger before user access. Customer downloads, external GitHub copies
and customer cloud resources are outside this worker's deletion scope.

## Deployment and trust boundaries

Prepare one beta-only Lambda and disabled EventBridge schedule within the
existing four-stack dependency order. Both the runtime flag and schedule stay
disabled; release policy rejects early activation. The owner-managed bootstrap
owns its fixed role. Application delivery imports it as immutable.

IAM permits version listing only under the three project namespaces, exact
version deletion, own-log writes, beta RDS Data API access and the existing beta
database secret. There is no object body read/upload, AI, Stripe, GitHub, backup
or customer-cloud permission. The reused database credential has admin rights:
application SQL guards, not IAM table-level isolation, enforce the database
mutation scope. A later restricted database role may reduce that trust surface
without weakening the fences.

Activation requires all body writers to use the fence, old writer instances to
drain, current migration and role verification, uncertain-write recovery,
deletion-time job/credit reconciliation and genuine hosted absence checks. These
are currently unfinished. Migration rollback cannot undo erased bytes; disable
scheduling to pause work, retain receipts/fences and never reopen them.

In particular, the current export execution authority requires an active project
and the deletion metadata guard rejects new lifecycle snapshot publication. A
pending job will not settle merely by waiting after deletion. The missing
deletion coordinator must derive and persist valid canonical
cancellation/financial outcomes through a separately reviewed recovery path,
without reopening ordinary writes or granting execution authority.

## Alternatives and consequences

- Age-based bucket expiry cannot prove immediate project erasure or prevent
  later uploads, so it is insufficient.
- Deleting all project database rows would destroy required accounting and
  immutable provenance; it is outside the selected content policy.
- Waiting an estimated upload timeout cannot establish that an external write
  has stopped. Durable uncertainty deliberately blocks completion and requires a
  recovery path, adding operational work.
- A dedicated role bounds object permissions while preserving provider-neutral
  domain logic. PostgreSQL/S3 specifics stay in delivery/persistence adapters.

Migrations 0033/0034 are additive; historical migration bytes stay unchanged.
Required evidence includes genuine PostgreSQL concurrency/denial/replay cases,
S3 version/marker and partial-failure cases, host/schema/source binding,
immutable role and disabled schedule synthesis, real Lambda bundling, release
activation rejection and the current aggregate gates. The continuation record
separates completed evidence from missing hosted acceptance.
