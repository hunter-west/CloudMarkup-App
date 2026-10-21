# ADR-0035: Deterministic AI evaluation and runtime admission

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Accepted
- **Date:** 2026-08-23
- **Owners:** Cloud Markup engineering
- **Supersedes:** None
- **Superseded by:** None

## Context

Cloud Markup has strict provider-neutral model schemas, reviewed routing,
commercial reservations, grounded proposal and repository interpretation,
deterministic generation/validation, Active Issues, and a review-only Assistant
workflow. Those controls constrain individual requests, but they do not yet
provide one versioned evidence set that demonstrates a model/profile/prompt can
be enabled for beta, nor one pre-invocation admission boundary that composes all
runtime limits consistently.

Quality, safety, cost, latency, entitlements, model routes, and provider
capabilities change independently. Optional model-judge opinions can help
diagnose language quality, but cannot replace deterministic schema, domain,
grounding, ownership, security, generation, or validator evidence. Live
evaluation also creates real provider usage and must never be an implicit CI
side effect.

## Decision

Cloud Markup will use frozen, synthetic, versioned evaluation datasets and
digest-bound evaluation reports. Every case is scored first by deterministic
dimension evaluators. Optional model-judge scores are stored separately,
explicitly marked non-authoritative, and cannot change a deterministic pass.
Current evaluator execution hardcodes `activationRecommendation: "hold"` and
`capabilityActivated: false`. The report contract reserves
`eligible-for-reviewed-beta` only for a future separately reviewed, resolver-
verified host recommendation authority; no current path may emit it or recommend
beta. Reports bind an independent evaluation-policy digest that includes the
exact frozen dataset identity, version, digest, and scoring policy; the
downstream runtime policy binds the exact immutable report in one direction so
the authorities cannot form an unconstructible digest cycle. Every required
dimension must be targeted by the dataset and have applicable deterministic
Evidence in the report; empty applicability never passes.

Normal CI runs only deterministic fake adapters against the exact frozen
dataset/policy and synthetic route/model/profile/prompt/schema/catalog tuples.
Substituting any otherwise well-formed tuple or self-rehashed dataset fails
closed before adapter or judge invocation. Any future live evaluation authority
must be operator-approved and pin environment, evaluation policy, runtime policy
identity/version, `runtimeControlConfigurationDigest`, dataset/case digests,
model route, prompt/schema/catalog provenance, maximum cases, tokens, credits,
estimated cost, concurrency, and expiry. The configuration digest binds every
runtime control and report-independent evaluation requirement while excluding
the final runtime-policy digest plus report-instance pins and derived results.
The final policy then binds the exact immutable report one-way. This cycle-free
authority is disabled by default, absent from normal CI, and cannot run in an
unapproved environment.

Authority is necessary but not sufficient. Direct
`runModelEvaluationDatasetV1({ mode: "live" })` execution must fail with
`model-evaluation.live-execution-port-required` before any adapter or optional
judge call. A future separately reviewed host-owned port must atomically join
runtime admission, a canonical commercial reserve/settle/release receipt, and
deterministic validator Evidence before an adapter can receive authority or a
live report can be produced. The providerless contracts do not implement that
port.

Before any beta model invocation, one provider-neutral runtime admission layer
must rejoin existing plan/feature entitlement, routing/evaluation, commercial,
job, and tenant authorities, including the exact prompt, response schema,
catalog, evaluation policy, and runtime policy used by the request. It enforces
per-user, organization, and feature request limits; concurrent jobs;
prompt/repository/file/graph/output/repair limits; dependency/provider/module
allowlists; administrative suspension; kill switches; and tenant-safe
idempotency/cache keys. Trusted service time—not a caller-selected timestamp—
defines decision freshness, request windows, state capture, authority expiry,
commercial expiry checks, and execution-lease expiry.

Each invocation also requires strict host-issued `ModelRuntimeInputEvidenceV1`,
authenticated through durable verifier state before current-authority
resolution, runtime `inspect`, commercial handling, or model callback. Its
digest binds organization, project, user, operation, input digest, every
requested resource count/size/token/repair projection and
dependency/provider/module allow-list, sanitization and secret redaction,
source-ownership Evidence, verifier identity/version, and literal absence of
credential, deployment, shell, tool, or URL authority. The admission request
binds that exact digest. Unissued, substituted, cross-tenant, secret-bearing,
unredacted, or under-reported Evidence fails before mutable state or model use.
The authenticated record is included in the request fingerprint, passed exactly
to the callback, and reauthenticated for terminal replay without another
invocation or charge.

The tenant-first store first uses read-only `inspect` to return the decision
snapshot and `snapshotDigest`; atomic `claim` rechecks that digest before it
acquires idempotency, request quota, active concurrency, optional live-authority
capacity, the initial telemetry outbox, and a store-issued
`ModelRuntimeExecutionLeaseV1` containing `acquiredAt`, `executionLeaseId`,
`expiresAt`, `fencingToken`, `recoveryOnly`, and `revision`. Subsequent
`assertExecutionLease`, `checkpointPendingAndRelease`, `completeAndRelease`, and
`release` transitions require that exact lease and revision as applicable. A
duplicate in progress cannot invoke; an exact terminal duplicate replays; and a
changed duplicate conflicts. A `recoveryOnly: true` lease can call only
`ModelRuntimeCanonicalCommercialPortV1.recover`, which cannot reserve missing
work or invoke a model; ordinary claimed execution calls
`ModelRuntimeCanonicalCommercialPortV1.execute`. Release is conservative: it
returns only verified active-concurrency capacity. Active concurrency lease
identities are atomically unique within an organization until release. Accepted
request counts and cumulative live-authority capacity remain consumed, while an
exact replay adds nothing.

For live evaluation, the same atomic transition maintains a conservative
capacity fence keyed by the exact live-authority digest. It tracks current
`activeConcurrentJobs` alongside cumulative projected maximum invocations,
input, output, cache-read, cache-write, and total tokens, credits, and estimated
cost across independent requests. `reservedTotalTokens` must equal the sum of
`reservedInputTokens`, `reservedOutputTokens`, `reservedCacheReadTokens`, and
`reservedCacheWriteTokens`. This fence cannot price, reserve, settle, release
credits, or change a balance. It is admission and idempotency state—not a second
token counter, credit counter, estimator, usage record, or commercial ledger.

Canonical accounting keys opaque reservation and idempotency identities by the
verified organization/project/user scope, so equal caller-visible identifiers in
different tenants cannot alias balances or lifecycle mutations.

The canonical commercial workflow pins the approved route and every planned
call's pricing and credit-normalization versions. Its store issues
`ModelCommercialWorkflowExecutionLeaseV1` through `claimExecution`, requires
`compareAndSet({ expectedRevision, lease, record })` for state transitions, and
uses `releaseExecution` only to release fenced execution ownership. Before it
asks accounting to reserve, it persists a digest-authenticated
`ModelCommercialReservationIntentV1` under that lease/revision. It then persists
the returned `ModelCommercialReservationReceiptV1` with exact
`ModelCommercialReservationAccountingStatusV1`. If an intent exists without a
receipt, `recoverExistingReservation` returns only
`ModelCommercialReservationRecoveryResultV1` through a read/replay-only lookup
before any ordinary unexpired execution may use the same intent to reserve;
recovery-only execution never falls back to reserve. Recovery-only execution
always performs that lookup—even when a receipt is stored—and replaces it only
with the matching refreshed canonical accounting status; missing or mismatched
canonical state fails closed. `ModelCommercialAccountingPort` exposes no generic
`expire` mutation. `expired` remains a canonical read/recovery status that a
future authenticated accounting process may report. Trusted host time is
rechecked before reservation and immediately before dispatch, including
commercial and execution-lease expiry, but time alone can only deny dispatch; it
cannot release credits. Callback/provider timestamps remain bounded
observations; they cannot select pricing, normalization, authorization, or
expiry policy.

Before an external callback can start, the lease owner separately persists a
`ModelCommercialDispatchIntentV1` with compare-and-swap. Once that intent
exists, a crash, timeout, or unknown outcome cannot authorize another
invocation. A host-owned `ModelCommercialCoordinatorPreDispatchProofV1` may
combine the persisted dispatch intent, trusted host expiry, and the
coordinator's authenticated knowledge that the callback did not begin. Trusted
time alone is not release Evidence. A callback-origin no-dispatch claim requires
a `ModelCommercialPreDispatchNoUsageAttestationV1` verified by
`ModelCommercialHostAttestationPortV1`. Authenticated, priced post-dispatch
failure with no useful output may release customer credits while recording
measured provider usage as compensated; that path does not claim no dispatch.
Unknown or invalid post-dispatch outcomes retain the reservation and enter a
fixed safe reconciliation state with closed codes, bounded opaque IDs, and
evidence digests instead of raw provider metadata.

Runtime claim and pending/terminal transitions atomically record their
deterministic content-free `ModelRuntimeTelemetryOutboxEntryV1` intents. The
store exposes `listPendingOutbox` and `acknowledgeOutbox`; stable event IDs
derive from immutable request, decision, event-kind/ordinal, and source-evidence
bindings, so ordinary execution and exact replay drain the same intents
idempotently. Post-execution operational events additionally require a
host-authenticated authority that binds the exact executed request, decision,
terminal digest, tenant, operation, safe reason codes, and source Evidence.
Unexecuted, forged, cross-tenant, or substituted claims fail closed; the
resulting audit/metric pair is atomically appended to that execution's outbox.
Workflow, lease, reservation-intent/receipt, dispatch-intent, reconciliation,
and outbox records establish ownership, replay, and delivery evidence only.
Canonical accounting remains the sole credit reservation/settlement/release and
usage-ledger authority.

The layer rechecks returned output bytes and tokens against the admitted
request, runtime policy, route, and live authority. Retained sanitized output
also requires host-owned Evidence digests for allow-listed-operation validation
and source ownership; model output cannot author those assertions. It emits
bounded safe audit and metric records for admission, denial, commercial
lifecycle, route, inference/generation/repair/validation outcomes, grounding and
safety failures, usage/cost, credits, and evaluation regression. Caller-supplied
outcome kinds and metric source/unit combinations are closed allow-lists, with
regression bound separately to exact report evidence. Records contain stable
codes, counts, digests, and opaque references—not raw prompts, responses,
repository bodies, candidate files, secrets, credentials, or unrestricted
errors.

This decision does not activate a model, allow arbitrary URLs/tools/shell,
broaden package/provider/module support, apply a proposal, mutate a repository,
run a compiler, access GitHub, mutate payment state, use customer credentials,
plan/apply, create a change set, or deploy.

## Consequences

### Positive

- Beta activation can require reproducible evidence instead of an informal
  prompt demo or one model's opinion.
- Runtime denial, concurrency, commercial usage, retries, and safety events use
  one reviewable boundary without duplicating commercial accounting.
- Deterministic regressions remain visible even when optional judge prose or
  model versions change.
- Synthetic CI remains credential-free, network-free, and reproducible.

### Negative

- Dataset, score-policy, report, and runtime-policy versions become
  compatibility responsibilities.
- Frozen cases require deliberate maintenance as catalogs, prompts, validators,
  and generation profiles evolve.
- Production request windows, fenced leases/revisions, reservation and dispatch
  intents/receipts, conservative cache-inclusive capacity fences, recovery,
  reconciliation, telemetry outbox delivery, and report retention require
  separately reviewed durable adapters and alerts.
- No database migration is required for the additive contracts. Rollback engages
  the existing kill switch or removes the downstream runtime-policy reference
  while retaining immutable reports and canonical commercial events.

### Follow-up

- Preserve this accepted boundary while final Prompt 38 repository verification
  completes; gate failure is a Prompt 38 blocker, not authority to weaken it.
- Define capability activation and rollback procedures before changing any route
  from candidate to beta-active.
- Add production durable input-Evidence issuance/verification, a tenant-first
  atomic store, tenant-scoped canonical accounting adapter, and idempotent
  outbox drainer with compare-and-swap, reservation recovery, recovery-only
  leases, crash recovery, and operational alerts without weakening commercial or
  sensitive-data boundaries.
- Add controlled production expiration only through ADR-0010 accounting
  authority with verifiable predispatch or reconciliation Evidence; do not add a
  generic clock-driven expiration mutation.
- Design and review the atomic live-evaluation host port carrying fenced runtime
  admission, the reservation intent/receipt and recovery-only commercial
  protocol, dispatch/reconciliation/outbox evidence, and deterministic validator
  Evidence before permitting any direct live adapter or judge call.

## Alternatives considered

### Use model-judge scoring as the quality gate

Rejected because another model cannot establish schema validity, groundedness,
domain correctness, source ownership, validator success, or absence of forbidden
authority. It may remain optional diagnostic evidence.

### Put runtime limits directly in each model feature

Rejected because planning, repository interpretation, application generation,
and IaC extension generation would drift on denial, retries, concurrency,
commercial handling, safe errors, and metrics.

### Add a separate evaluation credit counter

Rejected because ADR-0010 already establishes the canonical reservation and
append-only usage ledger. Evaluation must use that lifecycle rather than create
another balance or token authority.

### Run live evaluations in normal CI

Rejected because CI must be deterministic and credential-free, and a routine
test run cannot silently consume provider budget or expose repository content.

## References

- [ADR-0010](0010-ai-credits-usage-ledger.md)
- [ADR-0025](0025-canonical-solution-repository-and-evidence-contracts.md)
- [ADR-0026](0026-provider-neutral-durable-async-job-framework.md)
- [ADR-0034](0034-provider-neutral-model-gateway.md)
- [AI evaluation and runtime controls](../architecture/AI_EVALUATION_AND_RUNTIME_CONTROLS.md)
- [ModelGateway](../architecture/MODEL_GATEWAY.md)
- [Security principles](../architecture/SECURITY_PRINCIPLES.md)
- [Testing strategy](../architecture/TESTING_STRATEGY.md)
- Prompt 38 plan
