# AI evaluation and runtime controls

## Purpose and status

The deterministic evaluator defines the provider-neutral evidence and admission
boundary required before architecture planning, repository interpretation,
application generation, or IaC-extension generation may be considered for beta
activation. It does not activate or recommend a capability. Current evaluator
execution hardcodes `activationRecommendation: "hold"` and
`capabilityActivated: false`, even when deterministic scores pass. The report
contract reserves `eligible-for-reviewed-beta` only for a future separately
reviewed, resolver- verified host recommendation authority; no current path may
emit it. The existing capability registry remains the activation authority.

Normal evaluation CI is deterministic, synthetic, credential-free and
network-free. Its command never invokes the checked-in Bedrock adapter and
rejects direct live mode before adapter or judge invocation. The in-memory
evaluation, telemetry, rate, concurrency, lease and idempotency adapters are
reference fixtures, not production persistence or live execution authority.
Separate API-hosted admission, receipt and validator implementations now exist;
their presence does not promote an evaluation report. The functional beta route
is governed separately by
[ADR-0055](../adr/0055-functional-beta-infrastructure-assistant.md) and
[current status](../PUBLIC_STATUS.md).

## Frozen dataset

The separate memory-only preview design is documented in proposed
[ADR-0045](../adr/0045-memory-only-ai-previews.md). It does not change the
current evaluation hold or make reference admission stores production-ready. Its
metadata-only delivery recovery must reuse the exact original runtime and
commercial admission; neither acknowledgement timeout nor missing content may
authorize a second invocation. Private evaluation promotion still requires its
exact runtime admission and content-free operational evidence; the active beta
route does not silently supply that authority.

The canonical source is `frozenModelEvaluationDatasetV1` in
`@cloudmarkup/model-gateway`. The checked-in JSON under `evals/datasets-v1` is a
generated mirror with an exact drift check. It contains 21 synthetic cases: the
requested repository-import and ambiguous-source scenario is split into two
cases so deterministic facts and model inference cannot be scored as the same
authority.

The cases cover supported serverless and authenticated-notes paths; unsupported
event-driven image and private/VPC requests; existing external resources; vague,
conflicting, excessive, adversarial, secret-shaped, credential, and deployment
requests; novice language with professional constraints; deterministic and
ambiguous repository interpretation; designed/observed drift; supported and
AI-custom application generation; Terraform and CloudFormation extensions;
forbidden packages, providers, modules, and provisioners; and repair success and
exhaustion.

Every case is content-addressed, synthetic-only, and exercises Guided and
Professional preferences against the same semantic authority. Unsupported VPC
and image-processing cases retain the historical dataset's exact catalog and
capability bindings. Later catalog support does not change their frozen expected
results or upgrade their evidence.

### Eventing dataset v3

`frozenEventingEvaluationDatasetV3` supplements the unchanged version-1 baseline
with ten digest-bound event proposal cases. Four accepted cases correspond to
the infrastructure-supported templates: asynchronous image upload, scheduled
workflow, SNS fan-out, and SQS consumer with DLQ. Six rejected cases require the
exact deterministic finding for recursive S3 notification, wrong SQS
event-source direction, missing generated permission, FIFO/DLQ mismatch,
unsupported filter, and unbounded retry intent.

The eventing evaluator is a closed expectation function over frozen synthetic
typed designs. It has no provider, network, credential, model, repository,
compiler, or graph-mutation access. The normal `pnpm eval:model:deterministic`
runner requires this report, the event-application report below, and the
existing networking report to pass alongside the version-1 evaluation, while
continuing to emit only the canonical version-1 safe summary and an activation
hold.

The version-3 prompt templates explicitly retain application handler generation
for the successor event-application dataset and contain no handler source.
Passing this historical dataset therefore proves only regression coverage for
infrastructure proposal classification.

### Event-application dataset v4

`frozenEventingApplicationEvaluationDatasetV4` adds twelve digest-bound cases:
one accepted typed-design proposal for each of the six complete curated
application patterns and one rejected case for each of recursive S3
notification, wrong SQS direction, missing generated permission, FIFO/DLQ
mismatch, an unsupported filter, and unbounded retry.

Every accepted case asks only for reviewed Workload and typed event-contract
facts with explicit dispatch. Model output contains no handler source, arbitrary
business transform, IAM authority, command, credential, or deployment intent.
The deterministic application generator, isolated build runner, domain and
provider validation, and compiler remain the authorities for source, tests,
artifacts, policies, and readiness. Evaluation success cannot upgrade
`generated-starter` or `custom-implementation-required` to
`complete-supported-pattern`.

Both event datasets are closed synthetic classifiers. Their reports are not
Evidence, catalog readiness, a Solution Revision, graph-mutation authority,
model activation authority, or permission for live model execution.

## Evaluation authority and scoring

Each frozen case pins the required operation and model-role class. A run binds
that requirement to an exact tuple containing capability and route registry
digests, model configuration and optional inference profile, prompt ID/version/
digest, response-schema digest, catalog digest, operation, and role. Every case
result rejoins one tuple in the report, every tuple is used, and the ordered
tuple set, result set, dataset, policy, baseline, regressions, and report are
all digest-bound. Deterministic mode accepts only the frozen synthetic fake
tuples; a substituted route, model, prompt, schema, or catalog tuple is rejected
even when it satisfies the general tuple schema.

The default evaluation-policy digest binds the exact frozen dataset ID, version,
and digest together with the scoring policy and frozen operational normalization
denominators: 100 credits, 10,000 estimated micro-USD, 1,000 milliseconds of
latency, and 5,000 tokens. Evaluation policy—not an adapter—selects those
denominators; any adapter-selected substitution is rejected before scoring. Each
lower-is-better operational dimension has an 8,000-basis-point threshold, and a
schema-valid observation above it fails. Values from 81% through 100% of a
denominator are threshold breaches while remaining within that denominator.

Deterministic execution rejects a schema-valid, self-rehashed dataset or a
substituted policy before adapter or judge invocation. Every case must target
the mandatory schema, security, operational, and shared-UI dimensions; the union
of cases must cover every required dimension; and a report needs applicable
deterministic Evidence for each dimension. A zero-applicable dimension cannot
pass.

The 19 deterministic dimensions cover:

- strict schema validity, requirement coverage, unsupported services/fields, and
  graph/Workload/External Resource rules;
- repository grounding, stable IDs, user-owned files, security/policy, and
  deterministic compiler preference;
- application build/test and Terraform/CloudFormation parse, validation, and
  security results;
- issue clarity/severity, unresolved-behavior honesty, bounded repair without
  rule weakening, CI workflow validity, and shared UI semantics; and
- latency, normalized token usage, canonical credit projections, and estimated
  cost.

Deterministic counts, directions, thresholds, evidence digests, and pass states
are authoritative. The selected route provider family must match the report's
fake-versus-live execution evidence; non-fake evidence requires the exact live
execution class and authority digest. Optional model-judge scores are separately
labeled `non-authoritative` and cannot change a deterministic result,
regression, or the mandatory `hold` activation recommendation. Latency and
commercial measurements are safe projections: they do not create a usage record,
reservation, settlement, token counter, credit balance, or cost ledger.

## Runtime admission sequence

One `ModelRuntimeControlServiceV1` boundary composes trusted routing, a fenced
runtime store, and the canonical commercial lifecycle:

1. Strictly parse the runtime policy, request, full routing request and selected
   decision, exact evaluation report/tuple, cache key when enabled, optional
   live authority, proposed admission decision, host-issued input Evidence, and
   one trusted service time.
2. Before authority resolution or runtime-state inspection, rehash and
   authenticate the exact `ModelRuntimeInputEvidenceV1` through the durable host
   verifier. Its digest binds organization, project, user, operation, input,
   every requested count/byte/token/repair projection and dependency/provider/
   module allow-list, sanitization and secret-redaction facts, source-ownership
   Evidence, verifier identity/version, and literal absence of credential,
   deployment, shell, tool, or URL authority. The admission request binds that
   Evidence digest; any under-report, substitution, unissued record,
   cross-tenant reuse, sensitive value, or unverifiable claim fails before the
   resolver, `inspect`, commercial handling, or model callback.
3. Rejoin tenant, user, project, plan, feature, operation, role, route, model,
   prompt ID/version/digest, response-schema digest, catalog digest,
   evaluation-policy/report/result-set, capability/route registries, input,
   idempotency, runtime policy, and commercial identities.
4. Enforce plan/feature entitlement, administrative suspension, global and
   capability kill switches, model/role/route and package/provider/module
   allowlists, and prompt/repository/file/node/edge/output/repair ceilings.
5. Use host `nowText` to define decision freshness, authority/commercial/lease
   expiry, state capture, and request windows. The host-issued decision must not
   be from the future and must remain unexpired; the store snapshot's
   `capturedAt` must equal the current trusted instant at claim. Caller
   timestamps and counters are not authority.
6. Use read-only `inspect` to obtain `ModelRuntimeStateSnapshotV1` and its
   `snapshotDigest`. In one tenant-first atomic `claim`, recheck that digest and
   acquire idempotency, per-user/organization/feature request quota, active
   concurrency, optional live-authority capacity, and the initial telemetry
   outbox. The store issues the sole `ModelRuntimeExecutionLeaseV1` with
   `acquiredAt`, `executionLeaseId`, `expiresAt`, `fencingToken`,
   `recoveryOnly`, and `revision`. `claim`, `assertExecutionLease`,
   `checkpointPendingAndRelease`, `completeAndRelease`, and `release` require
   that exact lease/revision as applicable. In-progress duplicates cannot
   invoke, terminal duplicates replay, and changed duplicates conflict. Active
   concurrency lease IDs are atomically unique within an organization until
   release. Ordinary claimed execution calls
   `ModelRuntimeCanonicalCommercialPortV1.execute`; a recovery-only lease can
   call only `ModelRuntimeCanonicalCommercialPortV1.recover`, which cannot
   reserve missing work or invoke a model.
7. For live evaluation, track current `activeConcurrentJobs` and accumulate
   conservative projected maxima under the exact authority digest: invocation
   count; input, output, cache-read, cache-write, and total tokens; credits; and
   estimated micro-USD. An exact replay adds nothing. Verified lease release
   returns only active concurrency; accepted request counts and cumulative live
   capacity are not replenished.
8. Scope otherwise equal opaque reservation/idempotency identities by verified
   organization/project/user identity so cross-tenant lookup or mutation fails
   closed. Enter the canonical commercial lifecycle. Its store issues
   `ModelCommercialWorkflowExecutionLeaseV1` through `claimExecution`, requires
   `compareAndSet({ expectedRevision, lease, record })`, and uses
   `releaseExecution` only for fenced execution ownership. Under that lease and
   revision, persist `ModelCommercialReservationIntentV1` before calling
   canonical reserve and persist `ModelCommercialReservationReceiptV1` with
   exact `ModelCommercialReservationAccountingStatusV1` afterward. If an intent
   exists without a receipt, `recoverExistingReservation` returns only
   `ModelCommercialReservationRecoveryResultV1` through a read/replay-only
   lookup first. Recovery-only execution always repeats that lookup, even for a
   stored receipt, to refresh the matching canonical status; it cannot fall back
   to a new reservation. `ModelCommercialAccountingPort` has no generic `expire`
   mutation. Its `expired` status can arrive only as canonical read/recovery
   state from a future authenticated accounting process. Trusted host time is
   checked before reservation and immediately before dispatch, but clock expiry
   alone denies dispatch rather than releasing credits. The accepted reservation
   pins the route and every planned call's pricing and credit-normalization
   versions; callback or provider timestamps cannot select pricing,
   authorization, or expiry.
9. Before invoking the callback, separately persist
   `ModelCommercialDispatchIntentV1` under the fenced lease/revision. Once
   persisted, any crash or uncertain outcome cannot invoke again.
   `ModelCommercialCoordinatorPreDispatchProofV1` combines that persisted
   intent, trusted host expiry, and authenticated coordinator knowledge that the
   callback did not start; time alone is not release Evidence. A callback-origin
   no-dispatch claim instead requires
   `ModelCommercialPreDispatchNoUsageAttestationV1` verified by
   `ModelCommercialHostAttestationPortV1`. Authenticated, priced post-dispatch
   failure with no useful output may release customer credits while retaining
   measured usage as compensated; it does not claim no dispatch. Unknown or
   invalid post-dispatch outcomes retain the reservation and map to fixed safe
   reconciliation codes, bounded opaque IDs, and evidence digests.
10. Pass the exact authenticated input Evidence—not caller reconstruction—to the
    invocation callback, and bind it into admission identity and replay
    fingerprinting. A terminal replay must rejoin the same request, decision,
    trusted authorities, and complete input Evidence and cannot invoke or charge
    again.
11. Recheck returned output bytes/tokens against the admitted request, runtime
    policy, selected route, and live authority. Require host-validator Evidence
    digests for allow-listed operations and source ownership; reject missing,
    malformed, sensitive, or oversized evidence.
12. Commit each claim and each pending/terminal result together with its
    deterministic content-free `ModelRuntimeTelemetryOutboxEntryV1` records.
    `listPendingOutbox` and `acknowledgeOutbox` drain the same stable event IDs
    idempotently during ordinary execution and exact terminal replay, then
    verified active concurrency releases once. Post-execution operational
    outcomes require a separately host-authenticated authority binding the exact
    executed request, decision, terminal digest, tenant/user/operation, event
    kind, safe reason codes, and source Evidence. Bare, forged, cross-tenant,
    unexecuted, or substituted claims fail closed; their audit/metric pair is
    appended atomically to the same durable outbox and replayed without
    duplicate publication.

The reference snapshot exposes the live fence as `liveAuthorityUsage`, keyed by
`authorityDigest`, with `activeConcurrentJobs` and cumulative
`reservedInvocations`, `reservedInputTokens`, `reservedOutputTokens`,
`reservedCacheReadTokens`, `reservedCacheWriteTokens`, `reservedTotalTokens`,
`reservedCreditUnits`, and `reservedEstimatedMicroUsd`. The total-token field
must equal the exact sum of input, output, cache-read, and cache-write
reservations. The fenced execution lease and compare-and-swap revision establish
who may transition the request; the persisted reservation intent/receipt and
dispatch intent establish whether reservation recovery or reinvocation remains
safe.

Runtime request/capacity records and commercial workflow, lease,
reservation-intent/receipt, dispatch-intent, reconciliation, and
telemetry-outbox records are coordination evidence. They cannot price, reserve,
settle, release credits, change a balance, or replace canonical usage. Only the
existing commercial accounting authority can do those things, so Prompt 38 adds
no second token/credit/cost counter or ledger. Production persistence must
provide a tenant-first durable atomic store and idempotent outbox drainer
equivalent to these fail-closed semantics.

## Live evaluation boundary

`mode: "live"` is a providerless contract boundary, not an executable adapter
seam. A live composition would require an unexpired, explicitly opted-in
authority for a development or staging organization that binds the exact
evaluation policy, runtime policy identity/version, and
`runtimeControlConfigurationDigest`; dataset and allowed case digests; exact
model/prompt/schema/catalog tuples; concurrency; invocation count;
input/output/total tokens, with the planned total including cache-read and
cache-write units; canonical credits; estimated cost; and an unengaged kill
switch. The configuration digest covers every runtime control and
report-independent evaluation requirement, excluding only the final policy
digest and report-instance pins/derived results. This avoids a
policy→report→authority→policy digest cycle. The completed runtime policy binds
the exact report one-way, and admission requests/decisions then bind that final
policy digest.

Those authority records are necessary but not sufficient. The current
`runModelEvaluationDatasetV1({ mode: "live" })` path always throws
`model-evaluation.live-execution-port-required` before any adapter or optional
judge call, even when every declared authority and budget is valid. Contracts
can describe a future live run, but they cannot spend, execute, validate, or
produce a live report by themselves.

A future separately reviewed host-owned execution port must atomically combine:

- trusted-time runtime admission with the exact final policy/report, a
  store-issued fenced lease/revision, and atomic request, concurrency, and
  cache-inclusive authority-digest capacity acquisition;
- a canonical commercial receipt binding the reservation intent/receipt and
  read-only recovery result; reservation-pinned pricing/normalization; the
  persisted dispatch intent, coordinator proof, or verified external
  not-dispatched attestation; normalized usage/cost; safe reconciliation; and
  atomic outbox state; and
- deterministic validator execution Evidence, including host-owned
  allow-listed-operation and source-ownership results.

Only that host port could pass one exact digest-bound remaining authority to an
adapter and accept its result. Provider-backed live evaluation remains absent
from normal tests, builds, checks, and CI. Normal evaluation commands reach only
the deterministic fake runner and its exact frozen tuples; tests assert that
direct live mode invokes neither adapter nor judge.

## Safe evidence and operations

Audit and metric records use bounded IDs, digests, counts, stable reason codes,
units, and authority labels. They cover request, denial, reservation,
settlement, release, model route, import inference, generation and repair
results, validator and groundedness failures, estimated cost, credits, safety
issues, and evaluation regressions. The caller-supplied operational-outcome
surface is limited to inference, generation, repair, validator, groundedness,
and safety events with digest-only host evidence. Evaluation regression uses a
separate exact report/result binding. Credit, estimated-cost, token, and latency
metrics accept only their canonical commercial or normalized-usage source and
unit; callers cannot relabel arbitrary values as those authorities.

These records exclude raw prompts, responses, repository excerpts, candidate
files, source, secrets, credentials, URLs, unrestricted diagnostics, and
customer content. Strict outcome recording cannot grant arbitrary URL, tool,
shell, package-manager, compiler, repository, GitHub, payment, credential,
cloud, plan/apply, change-set, or deployment authority.

Primary Active Issue and evaluation-issue text must explain the problem,
severity, and remaining action in plain language. Optional Technical details may
then expose exact operation/graph IDs, owned paths, schema and policy
identities, bounded sanitized validator/tool diagnostics, Evidence digests,
model/prompt provenance, validation deltas, and reviewed exact-fix operations.
Technical detail never replaces the readable issue or weakens the same evidence
and redaction rules.

## Verification

Run the frozen deterministic evaluation with:

```powershell
pnpm eval:model:deterministic
```

The command builds the fixed package boundary, verifies the checked-in dataset
mirror, executes expectation-shaped contract smoke, and prints only a canonical
safe summary whose activation recommendation is fixed to hold. It is not
validator Evidence. Run `pnpm check:e2e:assistant-evaluation` for the separate
input-derived validator-backed fake-model pipelines and actual
`AssistantWorkspace` preference/accessibility parity. That E2E invokes the
canonical workflow validator through the host Node executable with shell
disabled, separately probes application-plus-Terraform generation, exact-matches
execution-derived issue severity, and requires every declared safety outcome and
generation target to bind to passed exact probe groups with removal-mutation
coverage. Neither gate can recommend or activate a capability. See the
[human evaluation scripts](../../evals/HUMAN_TEST_SCRIPTS.md) for manual
requirements, generation, reconciliation, metering, accessibility, security,
regression, and optional-live boundary checks.

## Compatibility and non-goals

The September 2026 service continuation adds a normal-only PostgreSQL admission
store under the API persistence boundary. Additive migration `0027` retains
strictly bounded request/decision/usage-digest metadata, one immutable request
debit, fenced execution ownership and a bounded content-free telemetry outbox.
It is not registered in the production composition and cannot approve an
evaluation, reserve customer credits/platform dollars or invoke a provider.

Its concurrency snapshot counts only DB-unexpired execution authority. This is
not evidence that an old remote call completed: an expired owner cannot write a
checkpoint or terminal result or authorize emission, and reacquiring the same
request is sticky recovery-only. Neither an expired lease nor a failed delivery
refunds the platform USD allowance. This deliberately avoids the reference
store's stale-active-capacity behavior without delegating production authority
to that reference implementation. Current authenticated host checks remain
required outside the persistence scope; database membership/role/project checks
are additional authorization, not session authentication. See proposed
[ADR-0045](../adr/0045-memory-only-ai-previews.md) for the separate preview
lane.

The original deterministic evaluation contract required no database migration.
Existing Architecture, Workload, External Resource, Evidence,
repository-observation, generation, Active Issue, Assistant, routing, job, and
commercial records remain authoritative in their scopes. The evaluation report
is evidence for a later review, not a graph mutation, repository change,
accepted Solution Revision, provider configuration update, or deployment
instruction.

See
[ADR-0035](../adr/0035-deterministic-ai-evaluation-and-runtime-admission.md),
the [ModelGateway boundary](MODEL_GATEWAY.md),
[Security principles](SECURITY_PRINCIPLES.md), and the
[testing strategy](TESTING_STRATEGY.md).

## Exact live score and held report projection (2026-09-11)

V2 scores, case results, regressions and held report metadata now retain exact
operational ratios above 10,000 basis points. Negative aggregate quality is
retained rather than clipping overruns. V1 schemas and generated artifacts are
unchanged. The policy pins the current dataset and the original thresholds and
operational denominators; it changes no canonical credit or USD 50 platform cap.
Policy 2.0.0 digest:
sha256:ac82a8aec02a99b8c2876c8c60edd5f5efa2ccbb2b0a979f453ede89c1ebb7d4. These
unchanged operational thresholds remain too tight for the prior measured
13k-token Intent request; a separately versioned, reviewed policy must be frozen
before any provider call if different thresholds are selected. No result has
been observed and no threshold has been adjusted after provider execution.

The production observation reader joins actual current configured source and
issued-plan bindings to the durable receipt and exact canonical settlement, then
derives V2 case scores. Thirty-nine actual PostgreSQL receipt/settlement cases
pass (70.34 s), with synthetic provider responses. Thirty-nine focused
report/legacy contract cases passed before additional boundary tests. API types
and schema artifact compatibility pass. The full report projection requires all
21 exact cases and every target dimension and rejects changed policy, source,
tuples, missing/duplicate observations and caller grades. It explicitly provides
no issuance, current authority or activation. No completed hosted report has
been created, stored or promoted. Durable report issuance still requires the
remaining real family validators and actual scoped receipts.
