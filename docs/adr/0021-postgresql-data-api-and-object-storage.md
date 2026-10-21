# ADR-0021: PostgreSQL metadata and versioned object storage

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Accepted
- **Date:** 2026-08-02
- **Owners:** CloudCanvas engineering
- **Supersedes:** None
- **Superseded by:** None

## Context

Milestone M2 needs tenant-isolated project metadata, mutable draft pointers,
immutable revision records, job state, integrations, audit history, and later
billing/usage aggregates. Architecture Documents and generated artifacts are too
large and sensitive to duplicate in ordinary relational rows. CloudCanvas also
needs one local development path and a cost-proportional production path.

Aurora PostgreSQL Serverless v2 with the RDS Data API and a local PostgreSQL
driver expose meaningfully different client and transaction mechanics. The Data
API also has bounded response and row sizes, reinforcing the rule that document
and artifact bodies do not belong in query results. S3 supplies opaque object
version identifiers and conditional writes, but it cannot participate in a
PostgreSQL transaction.

## Decision

Use PostgreSQL for transactional metadata and an object-store interface for
Architecture Documents, revision payloads, generated code, diagrams, reports,
and combined artifacts.

- Production metadata uses Aurora PostgreSQL Serverless v2 through the RDS Data
  API. Development and integration tests use local PostgreSQL through
  `node-postgres`.
- One parameterized PostgreSQL repository implementation sits above a small
  executor contract. The local executor passes positional parameters to
  PostgreSQL. The Data API executor converts those positions to named Data API
  parameters and owns its different begin/commit/rollback protocol. Neither
  driver type leaks into application or domain interfaces.
- Every tenant repository method receives a trusted principal context or an
  explicit authorized organization scope. Tenant queries repeat principal,
  membership, organization, and resource ownership predicates. Object keys and
  route identifiers never prove authorization.
- S3 is the production object adapter. Buckets must have versioning enabled.
  Writes use content-addressed keys and `If-None-Match: *`; metadata records the
  exact object version, SHA-256 digest, byte size, media type, owner, purpose,
  and lifecycle. Filesystem and in-memory adapters implement the same contract
  for local development and tests.
- Database and object-store writes use a staged publication protocol. The object
  is written as `staged`; one database transaction records a
  `publication-pending` object reference and the owning metadata; the object is
  marked `published`; then a small database transition publishes the metadata.
  Reads expose only published references. Failure before the database commit
  attempts to discard the staged version. Failure after it leaves an explicit
  recoverable pending record that an idempotent reconciler can finish or a
  grace-period sweeper can remove when unreferenced.
- SQL migrations are ordered, checksum-pinned, forward-only, transactional, and
  protected by a PostgreSQL advisory lock. Static reviewed DDL is not assembled
  from runtime identifiers. Runtime query values are always parameterized.
- Prompt 21 reserves the canonical organization entitlement and usage-ledger
  table names at storage contract version `0`. It exposes no billing repository
  or behavior. Prompts 24A-24C must evolve those tables in place when their
  versioned domain contracts are accepted.

This decision does not authorize platform provisioning, deployment, Cognito,
workflow execution, Stripe behavior, AI, or customer-IaC compilation.

## Consequences

### Positive

- Application/domain code remains independent of PostgreSQL clients, the AWS
  SDK, S3, and Data API transaction details.
- Local and production adapters run the same repository SQL and migration
  contract.
- Large content cannot accidentally exceed Data API result limits or enter
  normal metadata logs.
- Immutable content hashes, object versions, database uniqueness, and staged
  recovery make retries explainable and idempotent.
- Prompt 24 retains one storage lineage instead of adding parallel entitlement
  or usage schemas.

### Negative

- The Data API parameter/result codec and transaction lifecycle need their own
  tests even though repositories are shared.
- Cross-store publication is eventually finalized rather than atomically
  committed; pending reconciliation and staged-object sweeping are operational
  responsibilities.
- S3 versioning, lifecycle rules, encryption, backup/restore, and recovery
  monitoring must be configured before production.
- Forward-only migrations require paired database/object backups for operator
  rollback rather than destructive down migrations.

### Follow-up

- Prompt 21 implements adapters, migrations, seeds, contract tests, failure
  injection, and an opt-in local PostgreSQL integration suite.
- The M2 platform prompt must provision versioned encrypted S3 and Aurora/Data
  API resources with least-privilege access, retention, backup, and alarms.
- Before production, define pending-publication reconciliation cadence, orphan
  grace periods, restore drills, data retention, and regional recovery targets.
- Prompts 24A-24C must replace storage version `0` with accepted entitlement and
  append-only usage contracts through additive migrations.

## Alternatives considered

### Store Architecture Documents and artifacts in PostgreSQL

Rejected because large rows increase query, backup, and Data API response risk,
and make it easier for sensitive bodies to enter metadata access paths.

### Use separate repository implementations for local PostgreSQL and Data API

Rejected initially because duplicated SQL would drift in tenant predicates,
idempotency, and migration behavior. Reconsider only if measured Data API
constraints require a materially different access pattern; the application
interfaces remain unchanged.

### Write database metadata before object content

Rejected because a failed object write would expose metadata that names missing
content. The staged-object-first protocol leaves only safely hidden pending
metadata after post-commit failures.

### Add complete billing and usage tables now

Rejected because Prompts 24A-24C own those contracts. Only canonical table
ownership and storage version `0` are reserved here.

## References

- [System Overview](../architecture/SYSTEM_OVERVIEW.md)
- [Domain Model](../architecture/DOMAIN_MODEL.md)
- [Billing and Usage](../architecture/BILLING_AND_USAGE.md)
- [Security Principles](../architecture/SECURITY_PRINCIPLES.md)
- [Testing Strategy](../architecture/TESTING_STRATEGY.md)
- PostgreSQL and object-store persistence plan
- [RDS Data API limitations](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api.limitations.html)
- [S3 conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)
- [S3 versioning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/versioning-workflows.html)
