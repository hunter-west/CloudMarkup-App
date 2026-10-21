# ADR-0043: Platform model dispatch spending fence

- **Status:** Accepted
- **Date:** 2026-09-05
- **Owners:** Cloud Markup maintainers
- **Supersedes:** None
- **Superseded by:** None

## Context

The owner approved a USD 50 monthly Bedrock cap and global processing for the
beta restoration. Customer AI credits, per-tenant quota estimates and AWS budget
notifications do not enforce an aggregate application spending ceiling. Retries,
escalations, uncertain provider outcomes and delayed credential/signing work can
otherwise bypass a check made only when an application job starts.

[ADR-0010](0010-ai-credits-usage-ledger.md) remains the customer-credit
authority. [ADR-0034](0034-provider-neutral-model-gateway.md) and
[ADR-0035](0035-deterministic-ai-evaluation-and-runtime-admission.md) still
require untrusted model output, deterministic validation, exact routing and
fenced runtime/commercial authority. This decision adds a separate host dispatch
denial boundary; it does not accept model pricing, activate a route, or
authorize a live evaluation. The restoration's incomplete production composition
remains recorded in [STATUS](../PUBLIC_STATUS.md).

## Decision

Use one append-only platform dispatch reservation ledger in the authoritative
beta PostgreSQL database. Every application-controlled Bedrock request must pass
the following boundary, including retries, repairs and internal escalations:

1. Trusted host pricing supplies a current, exact-invocation cost ceiling in
   integer micro-USD, bound to the complete payload digest, provider, model,
   version, inference profile and reviewed route pricing version/digest. It must
   include system/tool/framing input, cache behavior, output/thinking and every
   billable component. Missing or unbounded cost evidence denies dispatch. No
   production pricing implementation or inferred token/price constant is
   supplied.
2. Migration `0020` records a fresh server-generated dispatch identity and the
   full ceiling. A global transaction advisory lock and insertion trigger
   enforce an all-organization total no greater than `50,000,000` micro-USD. The
   database clock assigns the UTC month after acquiring the lock; no caller
   month or browser-provided amount is authority. Duplicate reservation
   identities never return another dispatch permission.
3. The host creates the actual SDK client with the supplied final guarded HTTP
   request handler. A private asynchronous context authorizes one raw HTTP send,
   not a reusable client permission. The handler checks time/month again after
   credentials and signing; hidden SDK retries, unreserved calls and stale
   contexts fail closed. Short pre-dispatch cancellation and hard UTC-month and
   pricing deadlines propagate through connection waits and streamed processing.
   Database time plus elapsed monotonic time conservatively bounds a slow or
   adjusted host wall clock. A reservation shortened by month-end or pricing
   expiry is not usable for dispatch; an earlier full five-second receipt may
   dispatch only while still fresh and before both boundaries.
4. Reservations are never refunded or deleted by this adapter. Success, failure,
   cancellation and unknown charges retain the full ceiling. A budget denial is
   not fabricated zero provider usage or automatic customer-credit compensation.
   Existing host-attested no-dispatch and canonical commercial reconciliation
   rules still determine customer outcomes.

The cap covers application-controlled dispatches through this one authoritative
ledger, not unrelated AWS-account calls, taxes or other AWS services. Another
application environment cannot independently reuse the USD 50 allowance: it must
share the ledger or receive a separately reviewed aggregate allocation. Runtime
authentication, tenant authorization, concurrency leases, commercial
reservations, pricing review, provider access and deterministic evaluation
remain prerequisites.

Client cancellation is not proof that the provider stopped processing or
billing. The ledger assigns the UTC dispatch-reservation month; it does not
guarantee the month in which AWS posts charges to an invoice. The retained
worst-case ceiling is application admission evidence, not an AWS account-wide
billing stop.

Only bounded identifiers, hashes, ceiling amounts and timing evidence are
stored; no prompt, response, architecture content, secret or protected reasoning
is added. The domain and public API schemas remain unchanged and
provider-neutral. The new boundary is an application adapter, with PostgreSQL
behind its existing SQL port.

## Consequences

### Positive

- Concurrent tenants and separately charged retries cannot each claim an entire
  platform allowance from stale per-tenant state.
- Unknown charges remain conservatively bounded, independent of customer credit
  refunds or missing provider usage.
- Final-transport checks cover delayed middleware and keep migration/accounting
  evidence separate from raw model content.

### Negative

- Conservative ceilings can exhaust the allowance even when actual spend is
  lower, including when a reserved request never reaches the provider.
- The global lock serializes a short admission transaction. All model hosts must
  use the same database and exact guarded SDK construction.
- A request may stop before a planned retry; reserving one attempt does not
  promise sufficient remaining capacity to finish a multi-attempt job.
- Pricing authority, clock/transport correctness and real PostgreSQL concurrency
  remain release-critical; alerts are only supplementary observability.

### Follow-up

- Independent source and architecture review on 2026-09-05 accepted the decision
  after correcting deadline and invoice-posting claims. Activation remains
  separate; accepted historical ADRs are unchanged.
- Run both additive migrations and real PostgreSQL concurrency, duplicate,
  ownership, immutable-row and direct-insert cap tests in the release gate.
- Complete the reviewed cost resolver, durable runtime/commercial workflow
  composition, restricted result-object policy, provider access and evaluation.
  Keep all live model routes disabled until those gates pass.
- Roll back by disabling model invocation and removing host composition, not by
  dropping reservation rows or refunding uncertain charges. The additive table
  may remain for reconciliation and audit.

## Alternatives considered

### AWS budget notification only

Useful for operator visibility but asynchronous notification is not pre-dispatch
admission. Retain it only as an additional alert, not the hard spending stop.

### Reuse customer credits or tenant quota projections

They express different ownership and commercial policies, do not pool all tenant
currency exposure, and can release/compensate independently of provider charges.
They remain necessary but cannot replace this application-wide USD boundary.

### Refund reservations from estimated or missing usage

This improves availability but can undercount billable unknown outcomes. Revisit
only with independently verified provider-cost reconciliation and a new reviewed
release protocol; no such refund API is introduced here.

## References

- [ModelGateway](../architecture/MODEL_GATEWAY.md)
- [Model commercial lifecycle](../architecture/MODEL_COMMERCIAL_LIFECYCLE.md)
- [PostgreSQL and object-storage boundary](0021-postgresql-data-api-and-object-storage.md)
- [Spending wrapper](../../apps/api/src/adapters/model-platform-spend.ts)
- [Final HTTP guard](../../apps/api/src/adapters/model-platform-http-guard.ts)
- [Spending persistence](../../apps/api/src/adapters/persistence/model-platform-spend-store.ts)
- [Additive spending migration](../../apps/api/migrations/0020_model_platform_spend_reservations.sql)
