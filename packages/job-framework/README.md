# `@cloudmarkup/job-framework`

## Responsibility

This package is the provider-neutral application framework for durable Cloud
Markup asynchronous jobs. It composes the public async-job schemas and
deterministic domain lifecycle with injectable application ports. It owns no
provider adapter, HTTP route, database, cloud queue, model, compiler, repository
integration, deployment behavior, or billing policy.

The package supplies:

- durable repository, FIFO queue, handler, clock/ID, audit,
  orchestration-decision, entitlement-decision, and optional credit-reservation
  extension points;
- local-development in-memory repository, queue, decision-journal, and fake
  handler adapters;
- an idempotent creation coordinator, tenant-safe status polling, cancellation,
  progress/heartbeat/checkpoint support, worker execution, retry/requeue, orphan
  reconciliation, exact parent/child orchestration, stale-creation recovery,
  queued-publication recovery, and audit-outbox reconciliation; and
- optimistic record-version compare-and-swap plus durable audit-outbox evidence
  at every audited job or terminal creation-claim mutation boundary.

Tenant identity is accepted only through verified trusted context supplied by
the caller. Request payloads do not select an organization or principal.
Organization and project ownership must match exactly. Cross-tenant reads and
status polling return the same not-found result as an absent job. Every
reconciliation query receives exact trusted ownership and filters by that scope
before applying its limit; an out-of-tenant row cannot consume a bounded page.

`JobService` derives the SHA-256 idempotency-key digest from the validated raw
key and the request digest from the canonical validated create request. Any
caller-supplied digest mismatch fails closed. The raw idempotency key is never
stored in a job or creation claim.

Job records are the authority; queue messages are disposable projections. A
trusted scheduler may reconstruct due envelopes from queued records after a
record-before-publish crash. Queue publication is idempotent by job and attempt,
and workers fence stale deliveries with input digest and record version.

## Orchestration

Parents predeclare exact child job IDs. Child creation cannot dynamically append
or replace that set. The worker evaluates the complete repository child set and
durably records a typed, idempotent orchestration decision before acknowledging
a terminal child delivery. `fail-parent` fails the parent. `cancel-remaining`
deterministically cancels exact queued nonterminal siblings, requests
cancellation for exact running siblings, persists those mutations before failing
the parent, and fences or drains stale queue deliveries. A missing or changed
child fails closed. `continue-and-report` waits for all expected children to
become terminal before the parent may continue.

## Resume and recovery

The initial `queuedAt` is immutable lineage. Awaiting-input resume stores a
durable `receivedAt` and uses that value as the next queue-envelope availability
time without rewriting the original queue timestamp. The interaction, response
object reference, checkpoint, and handler registration remain exactly bound.

A trusted, ownership-scoped reconciler handles stale unfinished creation claims
from their immutable creation plan and already durable normalized entitlement
and reservation decisions. It never reruns either commercial hook. Missing
decisions, expiry, or invalid parent/dependency authority fail closed to a safe
denial; a fully authorized claim may complete. Opaque commercial references
remain available for separate external commercial reconciliation.

Every lifecycle mutation uses repository `saveWithAudit` to atomically commit
the job compare-and-swap and its deterministic outbox entry. Creation completion
atomically commits the terminal claim, new job, and creation events; denial
atomically commits the terminal claim and a distinct claim-linked event. Sink
delivery is best effort, deterministic, and idempotent. Pending entries remain
durable until an ownership-scoped reconciler publishes and marks them published.

Migration 0010 persists pending/published audit delivery, reserves immutable job
identities, keeps attempt identities immutable, and enforces monotonic job and
attempt record-version transitions. The runtime implementation remains
in-memory; no production repository adapter is provided.

## Status polling and future event streaming

`JobService.poll` is the implemented local polling boundary. It returns one safe
tenant-authorized status projection plus the current opaque transition cursor.
Durable user-response references remain redacted from that projection.
`JobEventCursorSource` is intentionally an interface-only placeholder for a
future authenticated server-sent-events path. A future HTTP adapter may resume
from an opaque cursor, enforce organization authorization on every reconnect,
bound buffering and retention, and fall back to polling. This package does not
open sockets, implement SSE, expose an event log, or promise cursor durability.

## Commercial boundary

Entitlement evaluation and an optional credit reservation are injected decisions
that run before queue publication. Their complete safe normalized outcomes and
opaque references are durable and immutable on the winning creation claim.
Duplicate creation and stale-claim recovery do not repeat the hooks. This
package does not own plans, balances, grants, pricing, charging, settlement,
release, expiration, Stripe, provider usage, or customer-credit policy.
Reservation implementations remain responsible for their own idempotency,
commercial state, and external reconciliation.

## Fake execution boundary

Fake handlers are deterministic test/local-development adapters. They never call
models, compilers, cloud APIs, Stripe, GitHub, deployment tools, arbitrary
commands, or customer code. They emit bounded synthetic reference outputs
appropriate to the requested job family and store no artifact bytes.

AWS types in `framework-aws-ports.ts` are interface-only seams suitable for
future Step Functions, SQS, Lambda, and CodeBuild adapters. They import no AWS
SDK and perform no provider operation.

## Non-goals

- HTTP routes, SSE runtime delivery, authentication, or authorization policy
- production database, object-storage, queue, or AWS adapters
- model, compiler, cloud, GitHub, Stripe, repository, CI/CD, or deployment calls
- customer-source execution, arbitrary commands, callbacks, or runtime modules
- plan, balance, pricing, charging, settlement, or refund ownership
- storing secrets, raw source, artifacts, provider payloads, or model output
