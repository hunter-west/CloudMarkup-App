# `@cloudmarkup/model-gateway`

Provider-neutral, versioned AI proposal and candidate boundary. It owns strict
operation dispatch, reviewed prompt registration, configurable role routing,
provider adapter contracts, input redaction, output/grounding/ownership
validation, safe metadata-only logging, normalized usage delivery, deterministic
fake adapters, and the provider-neutral commercial lifecycle around a supplied
invocation callback.

The deterministic fake remains the default. The optional Amazon Bedrock Runtime
adapter requires explicit configuration and uses AWS SDK v3 Converse or
ConverseStream. It uses the SDK default credential chain, one reviewed Region,
exact configured model/profile targets, SDK `maxAttempts: 1`, schema-only native
structured output or one forced schema-only response tool, explicit
abort/timeouts, safe content-free request metadata, and normalized usage. No
current model ID or provider price is embedded as live authority; incomplete,
unevaluated, expired, killed, cross-Region, or pricing-unavailable configuration
fails closed.

The tool-schema path preserves the original response schema and deliberately
omits Bedrock's `strict` flag: that flag requests provider Structured Outputs,
which the approved Claude Sonnet 5 and Opus 5 model cards do not support. The
gateway still validates the full strict schema and all deterministic authority
checks locally. Reviewed adaptive-thinking capabilities explicitly project
`thinking.type: adaptive`; adaptive thinking supports the forced response tool.
No extra tool is callable and no returned reasoning is consumed or retained.
Both Converse transports reject extra/unknown tools, mismatched stream block
indices, truncated responses and oversized response-channel bytes. These are
synthetic-tested transport corrections, not model evaluation or live activation.
See the primary
[AWS Structured Outputs guide](https://docs.aws.amazon.com/bedrock/latest/userguide/structured-output.html),
[AWS adaptive thinking guide](https://docs.aws.amazon.com/bedrock/latest/userguide/claude-messages-adaptive-thinking.html),
and
[Anthropic thinking/tool compatibility](https://platform.claude.com/docs/en/build-with-claude/thinking).

The package has no repository mutation, filesystem write, shell, compiler,
package-manager, payment, provider control-plane, customer-cloud, or deployment
authority. A production host may invoke `ModelIntentCommercialServiceV1` only
under the canonical fenced runtime/commercial workflow: atomic quota/concurrency
and cache-inclusive capacity claim; store-issued runtime and commercial
execution leases/revisions; trusted-time reservation intent/receipt with
read-only recovery that refreshes stored receipts in recovery-only mode;
reservation-pinned pricing/normalization; trusted-time dispatch denial without a
generic accounting expiration mutation or clock-only credit release; a separate
persisted dispatch intent; authenticated receipt or fixed reconciliation; and
atomic replay-drained runtime telemetry outbox state. Its async job handler
resolves immutable input and publishes a proposal reference; it does not add
another provider path. The normalized usage recorder and workflow/outbox stores
have no credit authority.

Every model response is untrusted. A successful gateway invocation means only
that one bounded response passed its strict schema and gateway checks. It does
not accept a proposal, apply an operation, install a dependency, write a file,
establish Evidence, publish a repository, compile, plan, apply, or deploy. A
commercially wrapped invocation may reserve and settle only through the
canonical injected authority and never through model output.

`ReviewOnlySolutionProposalPlannerV1` coordinates review-only proposals. It
accepts only a strict planning request containing approved Intent, current
Architecture, bounded catalog/validation/target metadata, explicit Graph Command
and policy allowlists, and optional approved repository evidence. It stages
proposals on a detached candidate, revalidates grounding and provenance, runs
every declared deterministic rule category, produces Active Issues, and returns
`writeAuthority: "none"`. Invalid post-schema candidates go through an injected
restricted-retention port and at most two digest-bound repairs.

Planning output can describe architecture, complete Workload/Application
Contract changes, typed external resources, questions, coverage, tests,
evidence-bound reconciliation, rationale, and rejected alternatives. It cannot
return final source/IaC files or apply anything. The deterministic fake supplies
this proposal shape for local development and CI.

Candidate generation admits an optional, strict `generationContext` to
application and IaC generation requests while keeping earlier version-1 requests
parse-compatible. A generation coordinator is expected to require the context
and its canonical digest. The context binds requested behavior, the exact
extension and target slot, runtime/language, official schema and catalog slices,
owned/protected paths and resource addresses, dependency/provider/resource
allowlists, sanitized existing files, validation expectations, and deterministic
limits. Application context is accepted only for an exact `ai-assisted-custom`
Workload extension point. IaC context remains candidate-only and conveys no
compiler, plan, apply, or deployment authority.

Candidate bundles now expose bounded, source-grounded `assumptions`,
`unresolvedItems`, and `expectedTests`. Repair requests may rebind the exact
generation context and prior candidate metadata; repairs cannot change or hide
them, including blocking questions. Candidate paths, content digests, byte and
count limits, dependencies, validation expectations, and metadata references are
revalidated after every response. Invalid generation and repair output is
retained only through the injected restricted diagnostic store, never written to
the repository or promoted to canonical design.

## Assistant workflow

The package exports strict Assistant operation, workflow, review, progress,
credit, authorization, and commercial-composition contracts.
`ReviewOnlySolutionProposalPlannerV1` accepts only trusted allow-lists and
limits; `SeamlessAssistantWorkflowCoordinatorV1` invokes only through the
canonical fenced runtime/commercial lifecycle, distinguishes coordinator-owned
trusted expiry proof from externally verified callback-origin no-dispatch
attestation and compensated authenticated post-dispatch release, and replays
duplicate idempotency keys without a second invocation or charge.

Assistant batches apply only to detached candidates through deterministic domain
logic. Each operation and the final batch are validated atomically.
Whole-document replacement, unknown operations/fields, stale preconditions,
ungrounded repository claims, unsupported services/ports/policies, and limit
mismatches fail closed. Review records retain safe model/prompt/evidence
provenance, issue/progress history, credit estimate/use, and human-readable plus
technical diffs. Accept, reject, and edit are explicit authorized review
operations with `writeAuthority: "none"`; this package has no repository,
compiler, payment, GitHub, cloud, or deployment tool.

## Evaluation and runtime controls

The package exports a frozen 21-case synthetic dataset, a deterministic scoring
policy covering all 19 required dimensions, strict adapter and observation
contracts, and `runFrozenDeterministicModelEvaluationV1`. Frozen runs use pinned
times, fake observations, stable content digests, and only their exact synthetic
route/model/profile/prompt/response-schema/catalog tuples. A substituted tuple
fails closed. Optional model-judge scores remain explicitly non-authoritative
and cannot change deterministic pass. Current evaluator execution hardcodes
`activationRecommendation: "hold"` and `capabilityActivated: false`. The
contract's reserved `eligible-for-reviewed-beta` value requires a future
separately reviewed, resolver-verified host recommendation authority and cannot
be emitted now.

`FrozenSyntheticModelEvaluationAdapterV1` and the frozen CLI are
harness-contract smoke: their expectation-shaped observations verify schema,
authority, aggregation, and replay behavior, but are not validator Evidence. The
downstream `pnpm check:e2e:assistant-evaluation` gate uses concrete synthetic
candidates and repository fixtures, actual deterministic
assistant/import/generation/IaC/security/repair pipelines, and case-specific
Evidence digests. Repository cases materialize exact frozen fixture bytes,
verify snapshot checksum/size/path/`sourceMode`, and reject digest/path/source-
mode mutation. The gate invokes the canonical workflow validator through the
host Node executable with shell execution disabled, keeping that digest-bound
CI-validity probe separate from application-plus-Terraform generation-chain
Evidence. It exact-matches execution-derived issue severity and requires every
declared safety outcome and generation target to bind to passing probe groups;
evidence-removal mutations prove missing coverage fails. Its web companion
renders the actual `AssistantWorkspace` for Guided/Professional semantic, issue,
progress, credit, keyboard, and screen- reader parity. It remains network-free,
fake model-only, non-deploying, and unable to recommend or activate a
capability.

`runModelEvaluationDatasetV1` is an injectable deterministic-adapter boundary.
Its live contracts describe exact unexpired opt-in authority, trusted evaluation
policy and runtime policy identity/version, the cycle-free
`runtimeControlConfigurationDigest`, allow-listed
case/model/prompt/schema/catalog bindings, and bounded invocation, concurrency,
input/output/total-token, credit, and estimated-cost limits. The planned total
token bound includes input, output, cache-read, and cache-write units. The
configuration digest excludes the final policy digest and report-instance data;
the final policy binds the exact report one-way. These records are necessary but
not execution authority.

Every direct `runModelEvaluationDatasetV1({ mode: "live" })` call throws
`model-evaluation.live-execution-port-required` before invoking an adapter or
optional judge. A future separately reviewed host-owned port must atomically
join a trusted-time fenced runtime lease and cache-inclusive capacity claim;
reservation intent/receipt plus read-only recovery; a reservation-pinned
`ModelCommercialDispatchIntentV1` and `ModelCommercialHostInvocationReceiptV1`
plus reconciliation and runtime outbox evidence; and deterministic validator
Evidence. Strict observations carry only digests, safe error codes,
deterministic measurements, and usage or commercial projections; raw prompts,
responses, repository content, candidates, and secret-shaped values fail closed.

`ModelRuntimeControlServiceV1` rejoins those evaluated identities to exact
routing, entitlement, commercial, tenant, idempotency, cache, limit, suspension,
and kill-switch authority. Trusted host time defines windows plus authority,
commercial, and lease expiry. Before resolving current authority or inspecting
state, `ModelRuntimeHostEvidenceVerifierV1` authenticates one exact host-issued
`ModelRuntimeInputEvidenceV1`. Its digest binds tenant/user/operation/input,
requested counts and allow-lists, redaction/sanitization, source ownership,
verifier provenance, and no credential/deployment/shell/tool/URL authority. The
admission request, fingerprint, callback context, and terminal replay all bind
that same record. Unissued, substituted, cross-tenant, under-reported,
secret-bearing, or unredacted Evidence cannot reach state, commercial, model, or
telemetry work. Read-only `inspect` returns the decision snapshot and
`snapshotDigest`; one atomic `claim` rechecks that digest while acquiring
request quota, active concurrency, optional authority-digest capacity, the
initial telemetry outbox, and the fenced `ModelRuntimeExecutionLeaseV1` with
`acquiredAt`, `executionLeaseId`, `expiresAt`, `fencingToken`, `recoveryOnly`,
and `revision`. The store exposes `inspect`, `claim`, `assertExecutionLease`,
`checkpointPendingAndRelease`, `completeAndRelease`, and `release`. Ordinary
claimed execution calls `ModelRuntimeCanonicalCommercialPortV1.execute`. A
recovery-only lease calls only `ModelRuntimeCanonicalCommercialPortV1.recover`,
which cannot reserve missing work or invoke and always refreshes canonical
accounting status even for a stored receipt. Exact replay adds nothing. Active
concurrency lease IDs are atomically unique within an organization until
release, and verified release restores active concurrency only.

`liveAuthorityUsage` includes current `activeConcurrentJobs` plus cumulative
`reservedInvocations`, `reservedInputTokens`, `reservedOutputTokens`,
`reservedCacheReadTokens`, `reservedCacheWriteTokens`, `reservedTotalTokens`,
`reservedCreditUnits`, and `reservedEstimatedMicroUsd`. The total must equal the
exact sum of the four component token reservations. Runtime `release` restores
only current active concurrency; accepted invocation, token, credit, and cost
reservations remain cumulative authority-digest capacity fields, not accounting.

Canonical accounting scopes equal caller-visible opaque reservation and
idempotency IDs by verified organization/project/user identity, so one tenant
cannot alias or mutate another tenant's lifecycle. The commercial workflow
exposes the exact technical bindings: `ModelCommercialWorkflowExecutionLeaseV1`,
store `claimExecution`, `compareAndSet`, and `releaseExecution`; record
`revision`, `ModelCommercialReservationIntentV1`,
`ModelCommercialReservationReceiptV1`, `ModelCommercialDispatchIntentV1`, and
`ModelCommercialHostInvocationReceiptV1`; trusted `reservationOccurredAt`; and
`ModelCommercialPricingAuthorityV1` with pricing/normalization catalog digests
and route pins. `ModelCommercialReservationAccountingStatusV1` is the closed
`active`/`denied`/`expired`/`released`/`settled` status stored in the receipt;
`ModelCommercialReservationRecoveryResultV1` returns only `found` with that
status or `not-found`.

`ModelCommercialAccountingPort.recoverExistingReservation` is read/replay-only,
and coordinator `recover(request)` always uses it—even for a stored receipt—to
refresh only matching canonical accounting status and can neither reserve
missing work nor invoke. The accounting port has no generic `expire` mutation;
`expired` is only a canonical read/recovery status from a future authenticated
accounting process, and trusted time alone cannot release credits.
`ModelCommercialCoordinatorPreDispatchProofV1` is coordinator-owned
not-dispatched Evidence derived only from the persisted dispatch intent, trusted
host expiry, and authenticated coordinator knowledge that the callback did not
start; clock expiry alone is insufficient. Callback-origin no-dispatch claims
require `ModelCommercialPreDispatchNoUsageAttestationV1` verified by
`ModelCommercialHostAttestationPortV1`. Authenticated priced post-dispatch
failure may release customer credits while recording measured usage as
compensated; it is not no-dispatch proof. Unknown or unsafe post-dispatch
evidence is discarded and maps to closed safe reconciliation codes.

Returned sanitized evidence is rechecked against request, policy, route, and
live output bounds and must carry host-owned digests proving allow-listed
operations and source ownership. Runtime claim and pending/terminal state commit
atomically with deterministic content-free `ModelRuntimeTelemetryOutboxEntryV1`
records. `listPendingOutbox` and `acknowledgeOutbox` let replay drain stable
event IDs idempotently. Post-execution operational events also require
host-authenticated authority bound to the exact executed request, decision,
terminal digest, tenant/user/operation, safe reasons, and source Evidence;
forged, cross-tenant, unexecuted, and substituted claims fail closed before one
audit/metric pair is atomically appended to that execution's outbox. Workflow,
capacity, reservation, dispatch, and outbox records are coordination evidence
only: they cannot price, reserve, settle, release credits, change a balance, or
replace canonical usage. These controls are required building blocks, but no
current atomic host composition turns them into a live evaluator
execution/receipt/validator port.

The private first-seed preparation path has an explicit
`ModelProviderHostSeedInvocationV3` with a static V3 descriptor. The pure
`buildBedrockHostSeedConverseRequestV3` and `countHostSeedV3` use the existing
complete Converse framing and current-authority HTTP fence. A count receipt
requires a successful HTTP response; an attempted or rejected handler call is
insufficient. V1/V2 readers and inference entry points remain separate. The
explicit `invokeHostSeedV3` transport requires a final HTTP handler and uses the
existing SDK framing and response normalization. The private host must also
authenticate runtime, canonical credits and platform spending. Durable
dispatch/outcome composition remains unfinished.

The explicit first-seed response reader requires exact V3 descriptor/V2 request
provenance and an unaccepted base-bound patch for the user-owned seed. It reuses
the existing candidate, dependency, evidence and repair checks. Known provider
usage records the one physical send without inventing V1 routing metadata;
missing or invalid usage remains unknown. These pure readers do not authorize
dispatch, apply patches, validate a build or settle credits.

Latency, tokens, credits, and estimated cost in evaluation aggregates are
observation-only projections. They do not create or replace the canonical usage
or commercial ledger. Reports keep deterministic regressions separate from
optional judge scores and always set `capabilityActivated: false`.

Run the normal deterministic report with:

```powershell
pnpm eval:model:deterministic
```

The command verifies the generated dataset mirror, runs only the frozen fake
boundary, and accepts no adapter, provider, or live-mode arguments. The Bedrock
adapter is not a live-evaluation execution port. Direct live-mode unit tests
exercise denial only; no provider-backed evaluator adapter/judge invocation or
live command/CI entry point exists.

The explicit inspectModelLiveSequenceAttemptsV4 reader shares finite lineage
checks with V3 while requiring actual-attempt observation metadata for known
outcomes. It rejects reused usage/attempt references, unrelated workflows or
intents within a case, and reused platform reservations. lineageComplete is
metadata only and never final financial truth. Its authenticated durable host
and complete two-slot canonical accounting bridge remain unfinished.
