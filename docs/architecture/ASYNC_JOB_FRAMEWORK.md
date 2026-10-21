# Provider-neutral asynchronous job framework

## Status and authority

Async Job v1 is the provider-neutral coordination contract for bounded work that
cannot safely complete inside one request. The typed contract, deterministic
domain lifecycle, and durable repository are the job-state authorities. A queue
delivery, worker process, audit event, or HTTP response is a projection of that
record and cannot independently change job meaning.

A successful job means only that its handler returned a schema-valid bounded
result. It does not accept an AI proposal, mutate an Architecture or Workload
Document, establish generation coverage, create Evidence, spend credits, publish
a repository, compile customer IaC, or authorize cloud activity. Those decisions
remain with their existing deterministic domain, commercial, repository,
compiler, Evidence, and authorization boundaries.

## Family and subject matrix

The table describes framework reference handlers used in deterministic tests.
Production registrations and enabled host compositions belong to the API and
[current status](../PUBLIC_STATUS.md); fake reference handlers do not describe
the entire deployed application.

| Family                            | Exact subject                                                   | Framework reference handler |
| --------------------------------- | --------------------------------------------------------------- | --------------------------- |
| Intent extraction                 | Draft ID, version, strong ETag, digest                          | Deterministic fake only     |
| Architecture proposal             | Draft ID, version, strong ETag, digest                          | Deterministic fake only     |
| Workload/contract proposal        | Draft ID, version, strong ETag, digest                          | Deterministic fake only     |
| Graph/workload operation proposal | Draft ID, version, strong ETag, digest                          | Deterministic fake only     |
| Static validation                 | Exact draft or Solution Revision plus environment               | Deterministic fake only     |
| IaC compilation                   | Solution Revision manifest identity and digest plus environment | Deterministic fake only     |
| Application-source generation     | Solution Revision manifest identity and digest plus environment | Deterministic fake only     |
| Application build/test/package    | Solution Revision manifest identity and digest plus environment | Deterministic fake only     |
| Diagram rendering                 | Solution Revision manifest identity and digest                  | Deterministic fake only     |
| Combined export packaging         | Solution Revision manifest identity and digest                  | Deterministic fake only     |
| GitHub repository export          | Solution Revision manifest identity and digest plus environment | Deterministic fake only     |
| GitHub repository import          | Project, installation/repository, exact commit, selected paths  | Fake-backed import handler  |
| Customer-owned plan Evidence      | Solution Revision plus environment                              | Deterministic fake only     |
| Deployment Evidence               | Solution Revision plus environment                              | Deterministic fake only     |
| Smoke/integration Evidence        | Solution Revision plus environment                              | Deterministic fake only     |
| Drift Evidence                    | Solution Revision plus environment                              | Deterministic fake only     |
| Billing/usage reconciliation      | Organization-scoped batch                                       | Deterministic fake only     |

Draft analysis is explicitly non-reproducible. It cannot return an Evidence
reference that masquerades as Solution-Revision Evidence. Every durable
generation, compilation, package, export, repository, or Evidence job keeps the
same immutable Solution Revision manifest identity and digest across attempts.
Selecting a newer revision requires a different job. Superseded jobs remain
readable and auditable.

## Trusted context and data placement

External authentication and authorization middleware verifies the current
principal, membership, permissions, object ownership, and commercial permission
before constructing a trusted job context. That context carries only the exact
actor, correlation ID, and organization/project ownership; it is not a cached
membership or permission set. Cancellation requires the same verified principal
that created the job. Handler input never supplies authoritative organization or
principal identity. A trusted internal queue envelope repeats the stored
organization/project scope so the consumer can fail closed when delivery and
record disagree. All bounded reconciliation queries accept exact trusted
ownership and filter by it before applying a limit.

`JobService` derives the idempotency-key digest from the validated raw key and
the request digest from the canonical validated create request. It rejects
caller-supplied digest mismatches, and the raw key is never stored.

Normal job records contain bounded metadata and content-addressed object
references. Large inputs, checkpoints, outputs, and artifacts live in the
authorized object store. Records and queue messages do not contain object-store
keys, download URLs, repository tokens, cloud credentials, private keys, access
tokens, raw model prompts/responses, or unrestricted architecture bodies. Object
resolution repeats tenant ownership, purpose, digest, size, availability, and
expiry checks.

## Lifecycle, attempts, and cancellation

The states are `queued`, `running`, `awaiting-user-input`, `succeeded`,
`failed`, `canceled`, `expired`, and `superseded`. Deterministic lifecycle
operations carry the expected record version, current attempt or lease identity
where applicable, and occurrence time. Preconditions fail closed. The lifecycle
returns the next record and transition evidence; the application layer appends
bounded audit events through its injected audit port.

- A worker acquires a bounded lease before starting an attempt. Heartbeats,
  progress, checkpoints, and completion must match the current attempt and
  lease.
- A cancel command fences current work by advancing the durable record. A stale
  completion cannot win after cancellation. Terminal results are not rewritten
  by a later cancellation request.
- Permanent failures finish the job. Transient failures use bounded
  deterministic exponential backoff and never change the input or Solution
  Revision.
- Expired leases are reconciled as orphaned attempts. A resumable handler may
  requeue from the latest compatible durable checkpoint; unsafe, incompatible,
  runtime-exhausted, or attempt-exhausted work fails with a sanitized result.
- Expiry and supersession fence future execution but retain attempts,
  checkpoints, outputs, and audit history.
- An `awaiting-user-input` outcome binds one interaction ID, exact durable
  checkpoint, handler identity/version, and resume policy. A response is a
  bounded durable object reference bound to that interaction and checkpoint;
  polling redacts it, and a later checkpoint does not rewrite the original
  interaction binding. Resume preserves the initial immutable `queuedAt`, stores
  durable `receivedAt`, and uses `receivedAt` only as the new delivery
  availability time.

User-visible errors are one-line, allow-listed summaries with stable safe codes.
Raw exceptions and provider responses are not copied into normal records or
audit metadata.

## Parent, child, and dependency behavior

Jobs may identify one root, one parent, explicit dependencies, and a versioned
dependency-failure policy. A coordinating parent predeclares a nonempty,
authoritative expected-child set, and every child ID is preallocated before its
creation. Evaluation requires the repository's complete child set to match that
declaration exactly; missing, duplicate, extra, wrong-parent, or wrong-root
children fail closed. Child creation inherits the root tenant, project, and
correlation scope. A child failure cannot disappear inside aggregate success.
The lifecycle returns an explicit typed decision for `fail-parent`,
`cancel-remaining`, or `continue-and-report`. The local worker deterministically
applies `cancel-remaining`: exact queued siblings become canceled, exact running
siblings receive durable cancellation requests, those mutations precede terminal
parent failure, and stale queue deliveries are fenced or drained. Any changed or
missing sibling fails closed.

## Commercial boundary and limits

Creation first establishes the tenant-scoped idempotency claim. Only the winning
claim evaluates the entitlement hook and optional reservation hook. A replay
returns the original creation outcome; a key collision with a different exact
request digest fails. Duplicate requests therefore cannot reserve or charge
twice.

The framework stores complete safe normalized entitlement and reservation
decisions plus opaque references. An unfinished duplicate claim returns
`in-progress` without rerunning hooks; completed and denied duplicates return
their original outcome. A trusted exact-ownership stale-claim reconciler also
never invokes either hook. It completes only from the immutable creation plan
and durable approvals; missing decisions, expiry, or invalid parent/dependency
authority fail closed to denial. Opaque references remain for external
commercial reconciliation. The framework does not own plan definitions,
balances, grants, model prices, reservation settlement, Stripe state, or
usage-ledger authority.

A denied creation has no job row. Its durable claim denial and separate
claim-linked audit outbox event are one atomic repository operation.
`async_job_events` intentionally retains its job foreign key and stores events
only for jobs that exist.

Async Job v1 sets hard ceilings for inline metadata, referenced inputs,
checkpoint bytes/count, attempts, runtime, output bytes, and artifact count.
Deployments may configure lower values but cannot raise v1 ceilings.

## Adapters and delivery

Provider-neutral ports cover repository, queue, clock, ID generation, audit,
handler lookup, entitlement, reservation, error classification, and backoff. The
development adapter is an in-process durable-record simulation with a
deterministic FIFO queue and deterministic fake handlers. It performs no model,
compiler, build-tool, repository, cloud, Stripe, or deployment call.

AWS adapter interfaces describe future mappings for Step Functions, SQS, Lambda,
and CodeBuild without importing an AWS SDK or provisioning resources. They are
ports, not implemented integrations.

`JobService.poll` is the implemented typed status-delivery contract. It returns
one tenant-authorized safe projection, opaque transition cursor, and bounded
next-poll hint. Prompt 25 adds no generic HTTP route. `JobEventCursorSource` is
an interface-only future path for authenticated server-sent events over the same
representation and cursor. A future delivery adapter must retain polling as the
reconciliation path; event delivery cannot become a second source of truth.

## Recovery and operations

Reconciliation scans bounded pages for expired running leases and expired
nonterminal jobs. Each candidate is re-read and changed with optimistic record
version preconditions, making duplicate reconcilers safe. Creation and retry use
record-before-publish ordering. A bounded queued-publication reconciler derives
a fresh envelope from the durable queued record; queue publication is idempotent
by job and attempt, so a publish failure or duplicate delivery cannot change job
meaning.

The repository port requires each lifecycle compare-and-swap and matching
deterministic audit event to commit atomically. Job creation atomically
completes its claim and stores its job events; denial atomically stores a
distinct claim-linked denial event. Immediate sink publication is best effort.
Deterministic event IDs, idempotent delivery and published marking, durable
pending/published state, and an ownership-scoped pending-outbox reconciler
recover delivery. Queue publication remains a separate, recoverable
record-before-publish step.

Migration 0010 reserves immutable job identities before child creation,
preserves expected-child referential integrity, normalizes creation plans and
commercial outcomes, keeps attempt identity immutable, enforces monotonic job
and attempt record-version transitions, stores separate claim/job audit evidence
and pending/published delivery state, and uses tenant-first recovery indexes.
Its exact SHA-256 is
`05face90ac08f89ba6d08799d0fea1ca921577ea9afce22038309c606a7a6071`. The runtime
implementation remains deterministic in-memory evidence; no production database
adapter is claimed.

Operational monitoring is required before production composition for queue age,
lease expiry, retry exhaustion, denied creation, reservation recovery, artifact
expiry, parent/child failure, and audit publication. Prompt 25 supplies
contracts, deterministic local evidence, and adapter interfaces only. It does
not implement the future handlers or external integrations.

## References

- [ADR-0026](../adr/0026-provider-neutral-durable-async-job-framework.md)
- [Solution repository and Evidence](SOLUTION_REPOSITORY_AND_EVIDENCE.md)
- [Authorization model](AUTHORIZATION_MODEL.md)
- [Billing and usage](BILLING_AND_USAGE.md)
- [Security principles](SECURITY_PRINCIPLES.md)
- [Testing strategy](TESTING_STRATEGY.md)
