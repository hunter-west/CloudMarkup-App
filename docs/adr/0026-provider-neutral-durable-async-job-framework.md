# ADR-0026: Provider-neutral durable asynchronous job framework

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Accepted
- **Date:** 2026-08-15
- **Owners:** CloudCanvas engineering
- **Supersedes:** None
- **Refines:** ADR-0001, ADR-0003, ADR-0005, ADR-0010, ADR-0017, ADR-0021,
  ADR-0022, and ADR-0025
- **Superseded by:** None

## Context

CloudCanvas needs long-running coordination for model proposals, deterministic
generation and compilation, isolated verification, diagrams, exports, repository
workflows, and future plan/deployment/drift evidence. The current API has
queued-only validation, generation, and export placeholders, but no shared
lifecycle, checkpoint, retry, cancellation, worker, or orchestration authority.

If each capability invents its own queue record, retries could switch revisions,
duplicate reservations or artifacts, leak tenant context through payloads, or
overstate a successful task as Evidence. A framework that owns entitlement,
billing, compiler, repository, or deployment meaning would violate existing
boundaries just as seriously.

## Decision

CloudCanvas uses one strict Async Job v1 contract and deterministic lifecycle.
It covers intent extraction; architecture, workload/contract, and graph/workload
operation proposals; IaC compilation; application source generation and
build/test/package; static validation; diagram rendering; combined packaging;
GitHub export; plan, deployment, smoke/integration, and drift Evidence; and
billing/usage reconciliation.

### Authority and immutable inputs

A job coordinates work; it is never the authority for designed meaning,
repository observation, generated ownership, Evidence, entitlement, credits,
payment, or deployment. Handlers return bounded references and proposals.
Existing deterministic domain operations, artifact publication, and Evidence
validation remain the authorities that accept those results.

Durable generation, compilation, application, diagram, packaging, export, and
Evidence-producing inputs bind an exact Solution Revision manifest identity and
digest. Attempts and retries reuse the unchanged input digest. Superseding work
creates or identifies a different job; the older record remains auditable.
Draft-only analysis binds an exact draft version, strong ETag, and content
digest, and cannot publish Solution-Revision Evidence.

### State, recovery, and orchestration

The states are `queued`, `running`, `awaiting-user-input`, `succeeded`,
`failed`, `canceled`, `expired`, and `superseded`. A versioned transition table
fails closed. Running cancellation is a durable request that wins over a later
success transition; already completed terminal work is not rewritten as
canceled. Failure classification is transient or permanent. Bounded attempts use
deterministic backoff, stable idempotency, leases, heartbeats, and exact durable
checkpoint references.

Expired worker leases enter orphan reconciliation. Safe resumable jobs return to
the queue from their latest validated checkpoint; unsafe or exhausted work fails
with a redacted permanent result. Awaiting-input state binds one interaction ID
and durable response reference to the exact checkpoint and handler version. A
resume preserves the immutable initial `queuedAt`, stores durable `receivedAt`,
and uses the latter only as queue availability. Parent orchestration predeclares
a nonempty authoritative expected-child set with preallocated child IDs.
Evaluation fails closed unless the complete repository child set matches
exactly. For `cancel-remaining`, the local coordinator cancels exact queued
siblings, requests exact running siblings, persists those outcomes, and then
fails the parent; stale deliveries are fenced or drained.

### Tenancy, idempotency, billing hooks, and limits

External authentication and authorization middleware verifies current
membership, permission, and object ownership before constructing trusted job
context. That context carries only the exact actor, correlation ID, and
organization/project ownership; payload schemas never supply authoritative
tenant identity. Cancellation requires the exact verified creating principal.
Every status, mutation, queue, checkpoint, artifact, and publication access
verifies the stored organization/project relationship and hides cross-tenant
guesses.

Creation idempotency is scoped by authorized organization, actor, operation,
caller key digest, and exact request digest. `JobService` derives the key digest
from the validated raw key and the request digest from the canonical validated
create request, rejecting any supplied mismatch. The raw key is never persisted.
The claim is established before entitlement and reservation hooks. An unfinished
replay returns the in-progress result; completed and denied replays return their
original outcomes. A different request colliding on the key fails. Duplicate
calls do not evaluate, reserve, enqueue, or charge twice.

Entitlement and optional reservation are application ports invoked before
queueing expensive work. They may deny work, and their complete safe normalized
outcomes plus opaque references are durable and immutable. A trusted stale-claim
reconciler is exact-ownership scoped and never reruns either hook. It completes
only from already durable approvals and an immutable creation plan; missing
decisions, expiry, or invalid parent/dependency authority fail closed to denial.
Opaque references remain available for external commercial reconciliation. The
job framework owns neither plan policy nor balances, prices, grants, settlement,
Stripe, ModelGateway, or provider usage. Reservation settlement, release, and
expiration stay at the existing commercial boundary. Denied creation produces no
job row: claim denial and its separate claim-linked audit event are stored
atomically. The job-event relation retains a job foreign key and stores events
only for existing jobs.

Versioned policy bounds inline metadata, referenced payload bytes, runtime,
attempts, output bytes, artifact count, and checkpoint count. Large payloads,
checkpoint state, outputs, and artifacts use content-addressed object
references. Normal records, queue envelopes, audit summaries, and user-visible
errors contain no secrets, raw credentials, private keys, access tokens, raw
prompts/responses, or unrestricted architecture bodies.

### Adapters and delivery

Provider-neutral repository, queue, handler, clock, audit, entitlement, and
reservation ports support a deterministic in-process adapter for development and
tests. Deterministic fake handlers cover all 16 families but implement none of
their future external behavior. AWS-facing interfaces map the same contracts to
future Step Functions, SQS, Lambda, and CodeBuild adapters without importing AWS
SDK types into domain code. This decision composes no AWS client and provisions
no resource.

`JobService.poll` is the typed v1 status-delivery contract; Prompt 25 adds no
generic HTTP endpoint. A future authenticated server-sent-events adapter may
publish the same versioned transition cursor and polling representation. It
cannot create a second status authority or make event delivery required for
correctness.

The repository contract atomically commits every lifecycle compare-and-swap with
its deterministic audit-outbox entry, job creation with its creation events, and
claim denial with a distinct claim-linked denial event. Immediate publication is
best effort; deterministic event IDs, idempotent delivery, durable
pending/published markers, and an exact-ownership-scoped outbox reconciler close
sink failures. Every recovery query filters exact ownership before applying its
limit. Queue publication remains a separate record-before-publish projection
with its own bounded reconciler.

Migration 0010 reserves immutable job identities, preserves expected-child
referential integrity, keeps attempt identity immutable, enforces monotonic job
and attempt record-version transitions, and stores normalized creation decisions
and audit delivery state. The runtime adapter is deterministic in-memory test
evidence only; no production database adapter is claimed. The migration checksum
is `05face90ac08f89ba6d08799d0fea1ca921577ea9afce22038309c606a7a6071` while
final SQL hardening is completed.

## Consequences

### Positive

- Every async capability shares one tested lifecycle and exact revision pin.
- Idempotency, cancellation, crash recovery, audit, and commercial hooks become
  reviewable instead of handler-specific conventions.
- Local tests can exercise orchestration without external services.
- Future AWS adapters can vary delivery mechanics without changing job meaning.

### Negative

- The contract, transition table, migrations, polling compatibility, and
  checkpoint retention become durable compatibility responsibilities.
- Cross-store artifact/checkpoint publication still needs reconciliation.
- Parent/child and reservation recovery require operational monitoring before
  production composition.

## Non-goals

This decision does not invoke or configure models, compilers, source generators,
build tools, diagram renderers, cloud providers, Stripe, GitHub, plan/apply,
deployment, smoke tests, drift collection, or repository synchronization. It
does not provision Step Functions, SQS, Lambda, CodeBuild, databases, buckets,
or credentials. Deterministic fake handlers are test/development evidence only.

## Compatibility, security, and rollback

Async contracts are strict, versioned, bounded, and future-version rejecting.
Existing specialized API job records remain explicit v1 compatibility
projections until a separately reviewed removal. Persisted changes are additive
and checksum-pinned. Rollback restores paired metadata and object versions; old
job records remain readable and are never coerced into a different revision or
family.

Queue payloads, handler output, tool failures, repository metadata, and external
identifiers are untrusted. Schema validation, exact tenant/resource ownership,
optimistic record versions, content digests, output limits, error redaction, and
final-action reauthorization fail closed. No job state transition grants cloud
or repository credentials or deployment permission.

## Alternatives considered

### Separate queue model per feature

Rejected because state, retry, idempotency, tenant, checkpoint, and billing
behavior would drift and make cross-family orchestration unsafe.

### Put tenant identity in each job payload

Rejected because untrusted payload data cannot establish authorization. Trusted
context and stored ownership remain separate.

### Retry against the current draft or latest revision

Rejected because it destroys reproducibility and can charge or publish output
for work the user did not request.

### Let the framework own credit accounting or Evidence truth

Rejected because commercial accounting and Evidence validation already have
separate versioned authorities. Hooks and exact references preserve those
boundaries.

## References

- [System overview](../architecture/SYSTEM_OVERVIEW.md)
- [Authorization model](../architecture/AUTHORIZATION_MODEL.md)
- [Billing and usage](../architecture/BILLING_AND_USAGE.md)
- [Solution, repository, and continuous-evidence contracts](../architecture/SOLUTION_REPOSITORY_AND_EVIDENCE.md)
- [Security principles](../architecture/SECURITY_PRINCIPLES.md)
- [Testing strategy](../architecture/TESTING_STRATEGY.md)
- Execution plan
