# Provider-neutral ModelGateway

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

## Bedrock implementation registrations

The Bedrock adapter has immutable, digest-bound registrations for the four
existing canonical model IDs. Records collect implemented operations, exact
GLOBAL profile, source Region, route class, transport/tool strategy, output
ceiling, complete-input token-count strategy and historical pricing snapshot.
The token counter, transport projection and beta cost authority share them;
historical pricing evidence keeps its exact interpretation and digest.

The pure evaluation configuration selector compares an expected registration
digest and returns a bounded reason for unsupported combinations. A successful
comparison remains unverified for account readiness and cannot activate normal
inference. Current model access/capacity, authenticated evaluation authority,
fresh pricing, tenant/commercial controls and exact-model promotion must still
be supplied by their existing host boundaries. Registering a model or changing a
selected ID cannot supply those authorities.

## Typed refusals and current evaluation receipts

The operations response now has a closed, sole-batch `safety-refusal` variant.
It carries reviewed reason codes and a bounded explanation, creates no graph
commands or diffs, and terminates the normal planner without repair or invalid
candidate retention. Current safety receipt issuer 2.1.0 requires the exact
expected refusal; unrelated errors no longer satisfy the safety criterion.
Historical 2.0.0 receipts remain readable. The tool schema digest changes, so
new live definitions and promotion evidence must bind the new schema.

The production evaluation host can collect a supported case's actual immutable
validator receipt, normalized usage and canonical settlement as a metadata-only
observation. It preserves negative quality, authenticates current
operator/tenant authority and rejects missing receipts, held or compensated work
and conflicting usage. This is not a complete dataset report or model
activation. Other case families, current frozen coverage and normal promotion
remain unfinished.

See [ADR-0048](../adr/0048-typed-model-safety-refusal.md) for compatibility and
rollback, and [STATUS](../PUBLIC_STATUS.md) for verification evidence.

## Purpose and status

ModelGateway v1 is Cloud Markup's single untrusted AI boundary. It supports
requirements, architecture, workload, external-resource, repository-analysis,
explanation, and validated custom application or IaC assistance without giving a
model authority over canonical documents, repositories, commercial state,
compilers, payments, or deployment.

Prompt 34 defines strict operations, reviewed prompts, the adapter seam,
deterministic validation, safe usage/telemetry ports, and deterministic fakes.
Prompt 34R adds explicit versioned capability/route policy: Claude Sonnet 5 is
the Standard candidate and Claude Opus 5 is the Deep and internal-escalation
candidate. Both remain unevaluated lifecycle candidates. Prompt 34R itself made
no live model call and added no provider SDK. Prompt 35 later adds the
checked-in Bedrock Runtime adapter, but no evaluated route or platform AI
configuration is enabled, no credentials are supplied by this repository, and
the deterministic fake remains the ordinary local/CI path.

The environment-specific Bedrock route/capability/IAM/residency/budget inputs
are gathered and cross-validated by the Amazon Bedrock runtime input guide. That
input remains non-secret and cannot enable or invoke the provider by itself.

Prompt 34A adds the provider-neutral canonical accounting lifecycle around a
supplied invocation callback. Prompt 38 hardens its future host protocol with
atomic quota/concurrency and cache-inclusive capacity acquisition; store-issued
fenced runtime and commercial leases/revisions; trusted-time reservation and
expiry rechecks; persisted reservation intent/receipt with read-only recovery;
reservation-pinned pricing/normalization; a separate dispatch intent;
coordinator-owned or externally verified no-dispatch Evidence; explicit
compensated post-dispatch release; fixed safe reconciliation; and atomic runtime
telemetry outbox state. Its fakes make no live provider or Stripe call and do
not compose a hosted worker.

## Operation contract

### Memory-only preview continuation

The owner has selected non-resumable previews while withholding temporary AI
content retention. Proposed [ADR-0045](../adr/0045-memory-only-ai-previews.md)
defines a separate `intent.extract` lane with explicit unavailable-result
replay, metadata-only usage/delivery evidence and no automatic redispatch. This
implementation is in progress, not activated. Existing queued workers and
migration `0019` keep their immutable object requirements; no no-op content
adapter may impersonate them. Normal-beta evaluation, durable runtime admission,
canonical SQL accounting, authenticated streaming/acceptance and RAM-only
browser composition remain required. A gateway factory or preview journal alone
supplies none of that authority.

The additive preview request binds a saved-draft ETag, idempotency key and tab
proof. The browser uses a same-origin, non-replayable SSE client; the generic
JSON client refuses this operation before transport. The dedicated REST Lambda
adapter verifies the existing edge origin and principal resolver, rejects
ambiguous headers, all query fields and payload-v2/Function-URL events, and
bounds actual UTF-8 request bytes. It never feeds candidate content through the
buffered Lambda adapter or its exception logger. Errors use fixed messages
without caller field paths, proof strings or raw diagnostics.

The native producer shares the strict framer's wire encoder and limits. Its
request-local candidate binding pins exact wire bytes, invocation and delivery
expiry to the actual application's emission assertion. The native sink repeats
that assertion and current scope checks after backpressure, immediately before
writing. The Lambda adapter also rechecks the original verified session and
bounds preparation/streaming by the shorter protocol or remaining Lambda
deadline. Cleanup invalidates outstanding closures. The native AWS response
facade is supported without requiring Node Writable instance identity or its
optional error-state property. Error responses explicitly write before ending to
trigger the metadata prelude and use the native end callback for completion. The
official response modules pass synthetic loopback compatibility checks. These
implementations supply transport only: deployment registration, the dedicated
STREAM integration, genuine runtime promotion and ordinary accepted-canvas
hosting remain uncomposed.

`modelGatewayRequestV1Schema` and `modelGatewayResponseV1Schema` are strict
discriminated unions. Unknown versions, operations, or fields fail closed. Their
named operations are:

| Family       | v1 operations                                                           |
| ------------ | ----------------------------------------------------------------------- |
| Requirements | `intent.extract`, `requirements.blocking-questions`                     |
| Planning     | `architecture.propose`, `workload.propose`, `external-resource.propose` |
| Operations   | `operations.propose` for graph, workload, or reconciliation batches     |
| Repository   | `repository.interpret` where deterministic parsing is incomplete        |
| Issues       | `issue.explain`, `deterministic-fix.explain`, `fix.propose`             |
| Generation   | `application-source.generate`, `iac-extension.generate`                 |
| Repair       | `candidate.repair` with sanitized diagnostics and a bounded attempt     |
| Summaries    | `summary.plain-language`, `summary.technical`                           |

Machine-consumed responses carry v1 proposal provenance, assumptions, unknowns,
confidence, evidence references, and the operation-specific result. Candidate
responses also carry a generation plan, file or unified-patch candidates,
dependency requests, validation expectations, source references, content
digests, and exact candidate-boundary ownership.

The complete generated ModelGateway and routing contract surface contains 14
Draft 2020-12 JSON Schema artifacts. Eleven are direct gateway and routing
artifacts:

- `model-gateway-request-v1.schema.json`;
- `model-gateway-response-v1.schema.json`;
- `model-invocation-descriptor-v1.schema.json`;
- `normalized-model-usage-v1.schema.json`;
- `model-capability-registry-v1.schema.json`;
- `model-route-registry-v1.schema.json`;
- `model-routing-request-v1.schema.json`;
- `model-routing-decision-v1.schema.json`;
- `model-cache-key-input-v1.schema.json`;
- `model-route-estimate-input-v1.schema.json`; and
- `model-routing-ui-state-v1.schema.json`.

The request and response artifacts reuse repeated schemas through local `$defs`
and `$ref` entries. Expanding those references preserves the complete inline
Draft 2020-12 contract. IDs, versions, all fifteen operation branches, and
runtime Zod validation remain unchanged; these artifacts require a JSON Schema
consumer that resolves local references.

The same generation set includes the three supporting strict proposal artifacts
used at the gateway's deterministic validation boundary:
`active-issue-v1.schema.json`, `graph-command-v1.schema.json`, and
`reconciliation-proposal-v1.schema.json`.

## Invocation and trust flow

1. A trusted application service supplies the operation request plus
   organization, user, project, Solution Revision, repository snapshot, job,
   feature, complexity, requested mode, entitlement, budget, evaluation policy,
   invocation ID, and idempotency digest.
2. The gateway strictly parses and bounds the raw request, verifies exact
   operation/scope and request authority, and computes `authorityInputDigest`
   over that validated request and trusted scope before redaction.
3. Schema-preserving redaction rebinds affected repository excerpts,
   diagnostics, hashes, and redaction metadata. The gateway parses and validates
   request authority again, then computes the separate sanitized `inputDigest`.
   Only this sanitized form can reach an adapter.
4. Deterministic routing selects an entitled, budgeted, evaluated configured
   capability for the required stable role. Browser content is not a routing
   input.
5. The reviewed prompt registry binds the operation to one stable template ID,
   version, category, source file, and SHA-256 digest.
6. The invocation store claim binds the sanitized `inputDigest` and an
   `authorityDigest` that includes `authorityInputDigest` plus the exact trusted
   authorization, routing, configuration, and prompt state. Duplicates or
   mismatches fail closed. An internal escalation adds one exact, atomically
   fenced lineage claim for its original Standard invocation.
7. The adapter receives the strict sanitized request, exact descriptor, reviewed
   prompt, and exactly one operation-specific response tool. The tool is a
   schema transport with `authority: none`; it cannot execute anything.
8. Capability-bounded transient retries and timeouts respect cancellation.
   Provider content size is checked before the exact tool name and tool input
   schema are parsed. Prose and unknown tools fail closed.
9. Deterministic validation rejoins exact provenance and then checks catalog
   identifiers, repository evidence grounding, candidate paths and hashes,
   generation-plan ownership, dependency approval paths, validation
   expectations, repair bindings, and zero tool authority.
10. Every started provider attempt normalizes into a v1 usage record whose
    `usageRecordId` is the durable idempotency identity for the exact
    `(invocationId, attemptNumber)` tuple. Missing or invalid usage and recorder
    failure are terminal; no successful result escapes.
11. Safe completion metadata is recorded. Raw prompts, raw responses, source,
    diagnostics, and architecture bodies are not logged.

The gateway returns proposal or candidate data only. A caller must separately
review and validate any proposed domain command or AI-authored extension through
the existing versioned authorities.

## Routing and providers

The provider-neutral role layer remains `low-cost-extraction-help`,
`standard-planning-generation`, `deep-architecture-custom-generation`,
`repair-escalation`, and optional `fallback`. Prompt 34R adds three product
routes above those roles:

| Route                 | Candidate                                                          | Customer policy                                                                       |  Attempts |
| --------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | --------: |
| `standard-design`     | `anthropic.claude-sonnet-5` through `us.anthropic.claude-sonnet-5` | Starter and Pro                                                                       | at most 2 |
| `deep-design`         | `anthropic.claude-opus-5` through `us.anthropic.claude-opus-5`     | confirmed Pro selection only                                                          | at most 2 |
| `internal-escalation` | the same configured Opus capability                                | never customer-selectable; one absorbed escalation after an eligible Standard failure |         1 |

Internal escalation is permitted only after deterministic validation, isolated
build, compiler, or supported-coverage failure. It preserves the original route,
failure class, and sanitized-diagnostics digest. It is terminal, occurs at most
once, and records zero incremental customer credits beyond the accepted
estimate. Its invocation claim atomically fences one lineage digest and binds
the exact feature, sanitized input, original invocation, original routing
decision, accepted-estimate maximum, credit-authorization decision, and scope;
the claim's authority digest also pins the diagnostics-bound routing request and
decision. Provider failure alone does not authorize escalation.

The strict capability registry pins provider/model/profile, model family and
lifecycle, modalities, context/output limits, streaming, tool-use and native
structured-output support, prompt-cache limits, adaptive effort, expected usage
fields, residency, pricing/configuration references, environments, plans,
features, evaluation, timeout, attempt, concurrency, and kill-switch state.
Contradictory records and route/registry version drift fail closed. The initial
records correctly declare native structured output unsupported and use the
operation response-tool schemas instead.

The pure route policy uses trusted complexity, plan entitlement, credit
authorization, requested mode, environment, configured capabilities, and
evaluation results. It can recommend Deep for complex work but does not silently
upgrade Automatic or Starter requests. Models and browser claims cannot select
the route, model, inference profile, price, effort, retry, entitlement, or
fallback. `max` effort is representable as provider capability metadata but is
never selected by v1 policy.

`ModelProviderAdapter` remains provider-neutral. Non-fake provider invocation
requires a selected trusted routing decision whose operation, mode,
provider/model/profile, capability version, pricing reference, effort, and route
match the gateway selection. The descriptor and normalized usage retain that
route provenance. Future providers can implement the same contract without
changing domain or operation schemas.

## Prompt registry

Reviewed template source is split by ownership and purpose:

- architecture planning;
- workload planning;
- repository interpretation;
- application generation;
- IaC extension generation;
- repair; and
- explanations, including extraction, questions, issues, and summaries.

Registration rejects duplicate operation ownership. Callers cannot submit an
arbitrary system prompt or replace a template ID/version. The descriptor pins
the exact prompt digest used by the output provenance and usage record.

## Security and authority

Model output is always `untrusted-proposal`. The schema-only response tool
grants zero execution authority and is not a client-side function. The gateway
has no URL retriever, filesystem writer, repository client, package manager,
shell, compiler, deployment client, payment client, or usage-ledger mutation
port. Provider invocation descriptors state `toolAuthority: "none"`; an adapter
sees only the one operation response schema, never a shell, file, URL, compiler,
package, repository, billing, payment, or deployment tool.

Prompts prohibit secret values. Recursive redaction covers credential patterns,
private keys, tokens/password assignments, and credential-bearing URLs before
the provider boundary. Repository excerpts and repair diagnostics contain only
bounded printable text, stable evidence/diagnostic IDs, tools/versions, paths,
redaction status, and the assertion that secret values are absent.

Candidate paths must be portable, request-owned, and content-digest matched.
Generation-plan targets must be owned. Every dependency, module, or provider
request is inert data whose approval path must appear both in the request's
candidate boundary and the operator allow-list. Validation expectations are
rejoined exactly. No candidate is written, installed, executed, compiled, or
accepted by this package.

## Usage boundary

`modelInvocationDescriptorV1Schema` binds invocation and idempotency identity to
organization, user, project, Solution Revision, repository snapshot, job,
feature, provider, model/version, inference profile, prompt/version/digest, the
sanitized input digest, requested mode, complexity, route ID, effort,
capability/config and pricing versions, and zero tool authority. The invocation
claim separately preserves the raw validated `authorityInputDigest` inside its
`authorityDigest` while binding that authority to the sanitized `inputDigest`.

`normalizedModelUsageV1Schema` records input, output, cache-read, cache-write,
and thinking units; provider request ID; attempt number; start/completion
timestamps; duration; and one technical result. Its deterministic
`usageRecordId` is unique to the invocation/attempt tuple, so a durable recorder
can idempotently retain successful, failed, canceled, and invalid-output attempt
evidence. The gateway requires the adapter to report usage and requires the
recorder to accept it before returning success.

This is technical evidence, not commercial authority. The Prompt 38 runtime
protocol reads a decision snapshot through `inspect`, then atomically rechecks
its `snapshotDigest` while `claim` acquires idempotency, request quota, active
concurrency, cache-inclusive capacity, the initial telemetry outbox, and
`ModelRuntimeExecutionLeaseV1` before the commercial coordinator runs. Ordinary
claimed work calls `ModelRuntimeCanonicalCommercialPortV1.execute`;
recovery-only work can call only
`ModelRuntimeCanonicalCommercialPortV1.recover`. The coordinator persists
`ModelCommercialReservationIntentV1` before reserve and the exact
`ModelCommercialReservationReceiptV1` after reserve or read-only
`recoverExistingReservation`, pins pricing/normalization for every planned call
at trusted host time, rechecks commercial and lease expiry immediately before
dispatch, and persists a separate `ModelCommercialDispatchIntentV1` with
compare-and-swap. Recovery-only execution repeats the read-only accounting
lookup even for a stored receipt, refreshing only matching canonical status and
never reserving missing work. The accounting port has no generic `expire`
mutation; trusted time alone can deny dispatch but cannot release credits.
Callback timestamps and provider metadata are observations, never pricing,
clock, replay, or release authority.

Once the dispatch intent exists, uncertainty cannot invoke again. A coordinator
may prove not-dispatched only by combining the intent, trusted expiry, and
authenticated knowledge that the callback did not start in
`ModelCommercialCoordinatorPreDispatchProofV1`; time alone is insufficient.
Callback-origin no-dispatch claims require
`ModelCommercialPreDispatchNoUsageAttestationV1` verified by the host
attestation port. Authenticated priced post-dispatch failure can release
customer credits while measured usage is recorded as compensated, without
claiming no dispatch. Unknown or invalid post-dispatch outcomes retain the
reservation in fixed safe reconciliation. Runtime claim and pending/terminal
state commit atomically with content-free `ModelRuntimeTelemetryOutboxEntryV1`
records, which `listPendingOutbox`/`acknowledgeOutbox` replay-drain by stable
`outboxId`. The canonical usage event retains bounded safe
route/model/prompt/unit/cost/credit/attempt/workflow/outcome provenance and
references the Prompt 24A ledger. Raw prompts, responses, provider errors, and
unrestricted IDs are excluded. See
[Model commercial lifecycle](MODEL_COMMERCIAL_LIFECYCLE.md).

## Local development and verification

`DeterministicFakeModelAdapter` produces a strict deterministic response-tool
use for all 15 operations and synthetic normalized usage.
`ScriptedFakeModelAdapter` supports bounded failure and malformed-output cases.
In-memory invocation, usage, and safe-logger ports support local development and
CI without network, credentials, provider accounts, or spend.

Focused tests cover every operation plus malformed and oversized output, prose
and unknown response tools, unknown versions/operations/services, ungrounded
repository claims, cancellation, bounded retry, timeouts, redaction, missing
usage, duplicate invocation IDs, metering failure, raw-prompt logging exclusion,
deterministic fakes, candidate path and dependency ownership, and tool-authority
denial. Routing tests cover Standard/Deep plan policy, user confirmation,
recommendations, credit denial, single absorbed escalation,
evaluation/lifecycle/environment/kill-switch denial, configuration drift,
effort, cache scope, and route-aware estimate inputs.

Runtime-control and commercial-lifecycle tests add suspension denial; atomic
runtime quota/concurrency/cache-inclusive capacity acquisition before canonical
reservation; store-issued runtime/commercial lease/revision ownership and CAS
conflicts; concurrent in-progress/terminal replay; recovery-only stored-receipt
refresh without a new reservation; denial without release on clock expiry;
reservation-pinned pricing/normalization despite callback timestamps;
coordinator-owned versus externally verified no-dispatch release; crash-after-
intent no reinvoke; fixed safe reconciliation for unknown/invalid outcomes;
partial settlement; multi-call escalation/repair; overrun compensation; and
failure-injected atomic outbox replay with stable event IDs.

## Compatibility and follow-up

ModelGateway v1 is additive. Existing Intent, Architecture, Workload, External
Resource, Repository Snapshot, Observed Solution, Reconciliation, AI Extension,
Active Issue, Solution Revision, Evidence, job, and usage-ledger contracts
remain authoritative and unchanged. A future incompatible wire change requires a
new contract version and generated schemas.

Migration 0013 adds immutable provider-pricing and credit-normalization versions
plus append-only model usage detail joined to the canonical Prompt 24A ledger.
It never creates another balance or changes routing authority. The existing
repository importer remains separate and grants no repository mutation
authority. Prompt 35 now supplies a live-capable adapter and canonical
commercial composition. Hosted production wiring, provider-invoice ingestion,
candidate validation/materialization, plan/deployment evidence, drift
collection, and broader UI/API integration still need separate reviewed work.
Prompt 36 adds only the review planner described below.

## Prompt 35 Bedrock Runtime adapter and Intent composition

The first live-capable adapter is `BedrockModelProviderAdapter`. It supports the
Bedrock Runtime Converse and ConverseStream data-plane APIs. AWS SDK retries are
disabled (`maxAttempts: 1`) so the gateway's two-attempt policy, bounded full
jitter, idempotency record, and per-attempt metering remain authoritative. The
adapter links caller cancellation to an explicit timeout controller and does not
abandon the SDK promise. A timeout or cancellation without trustworthy final
usage is not assumed free; the commercial coordinator records unknown processing
and opens reconciliation.

Production identifiers are not selected by model-name heuristics. The default
mode is `fake`. `bedrock` mode requires a strict reviewed JSON v1 configuration
with exactly one Standard/Sonnet role record and one Deep/Opus role record. Each
record supplies exact model/profile identifiers, model/version/family,
evaluation and lifecycle state, effective dates, supported and selected Regions,
residency policy, native structured output, tool use, adaptive thinking/effort,
context/output/concurrency/timeout/attempt limits, cache, streaming, expected
usage fields, pricing-version reference, transport, and kill switch. Unknown,
expired, unevaluated, disabled, killed, cross-Region, or contradictory records
fail before an SDK client is used. The checked-in unevaluated placeholder
registry is test/routing evidence only and cannot enable the adapter.

When the reviewed route supports native structured output, the adapter sends the
operation response schema through `outputConfig.textFormat`; otherwise it sends
one forced schema-only tool carrying the original operation schema, without the
provider `strict` flag that would require unsupported native structured outputs.
Only the native path projects a conservative Bedrock-compatible subset. Reviewed
adaptive-thinking routes explicitly send that mode, which supports the forced
tool channel. Both paths are translated into the same internal response-tool
envelope, then checked against the original strict Cloud Markup schema,
provenance, grounding, stable identity, and deterministic Intent semantics. The
response tool grants no execution authority.

Only safe opaque invocation/job IDs, feature, prompt version, route, and an
application label enter Bedrock request metadata. Organization/user/project
identities, names, emails, source content, prompts, responses, secrets,
protected reasoning, and pricing policy do not. Application logging and
canonical usage events remain content-free. Model invocation content capture
must remain disabled by operator policy unless a separately approved evidence
workflow exists.

`ModelIntentCommercialServiceV1` is the only Prompt 35 live-capable composition.
It binds the commercial request to the trusted tenant, prompt, operation, route,
model/profile, job, and routing decision. A production host must additionally
supply the atomic fenced runtime lease/revision, quota/concurrency and
cache-inclusive capacity claim, trusted clock, reservation intent/receipt with
read-only recovery, per-call pricing/normalization pins, the fenced commercial
lease/revision, and a persisted dispatch intent before its callback may invoke
the gateway. Missing, invalid, or uncertain post-dispatch usage opens fixed safe
reconciliation and cannot invoke again. Coordinator-owned pre-callback expiry
proof and externally verified callback-origin no-dispatch attestation are the
only no-dispatch release paths. Authenticated priced post-dispatch failure may
release credits as compensated measured usage without claiming no dispatch.
Runtime state and content-free outbox entries commit together, and exact replay
drains them by stable ID without a second callback or charge. The async
`intent-extraction` job handler resolves immutable referenced input and
publishes only a proposal reference through the same service.

Intent extraction and clarification interpret requirements only. They do not
select services or generate architecture, application code, graph operations, or
IaC. User facts, assumptions, unknowns, contradictions, and blocking versus
non-blocking questions remain distinct. Prompt injection is inert input data.
Prompt 35 stopped before Prompt 36.

## Prompt 36 review-only solution proposal planning

Prompt 36 extends `operations.propose` additively with an optional strict
planning context and review summary. A planning request binds approved Intent,
the current Architecture Document v3, the exact catalog slice already carried by
`catalogGrounding`, an explicit Graph Command allowlist, policy-kind allowlist,
resource limits, selected Terraform or CloudFormation target, target-readiness
metadata, all seven deterministic validation categories, and—when relevant—only
approved sanitized repository evidence plus an exact reconciliation proposal. It
does not send the whole catalog or repository.

The response remains `untrusted-proposal`. It can return reviewable atomic Graph
Command batches for AWS nodes, edges, configuration, and complete
Workload/Application Contract replacement; typed External Resource References;
assumptions and blocking questions; generation-coverage suggestions; test
scenarios; evidence-bound reconciliation explanations; rationale; rejected
alternatives; policy kinds used; and target readiness. The strict response has
no field for Terraform, CloudFormation, application files, shell instructions,
or deployment actions.

Model-authored graph and External Resource canonical identities are not retained
as authority. Before validation, the planner structurally normalizes graph
batch, command, node, edge, external address, interface, candidate,
nested-address, and unresolved-item identifiers independently of editable labels
or explanatory copy. It rewrites `architectureNodeIds` and `importAddressId`
references to those canonical identities and requires evidence and
interface-contract references to match their exact canonical records. External
authentication `secretReferences` must exact-ground to current Workload
secret-reference bindings or authentication already present on an existing
External Resource. Variable, unresolved-item, architecture-requirement,
dispatcher, extension, and Evidence reference fields remain under their
dedicated deterministic validators; normalized record IDs do not grant those
references authority. Complete Workload/Application Contract replacements may
change content, but they reject every new or noncanonical workload, operation,
binding, contract-set, contract, index, role, fixture, or expectation identity.
Bounded assumption, unresolved-question, and test-scenario identifiers remain
schema-validated proposal data; they are not canonical domain authority. The
restricted raw model response is preserved for provenance, and the proposal
digest binds its raw-response digest together with the detached normalized
projection.

`ReviewOnlySolutionProposalPlannerV1` revalidates the request, provenance,
evidence authority, secrets, catalog services/resource types/configuration,
ports, connections, placement, policy kinds, operation kinds, stable identities,
resource limits, workload and external-resource references, reconciliation
operation IDs, coverage, and target readiness. Proposed Graph Commands run only
against a detached candidate Architecture Document. Every caller-declared
placement, connection, policy, security, cost-sensitive, coverage, and
target-readiness rule must execute; deterministic error/security findings reject
the candidate. The result always reports `writeAuthority: "none"` and never
changes the supplied canonical document.

Unknown ownership, provider, location, endpoint/interface, authentication, or
import readiness becomes blocking user input and an Active Issue. Authentication
records accept typed secret references, never secret values. Repository
suggestions must cite an exact approved sanitized evidence record and exact
deterministic reconciliation operation; imported or inferred state never
promotes itself to designed truth.

Structurally invalid bounded provider output and post-schema candidates that
fail deterministic validation are sent to an injected tenant-scoped
restricted-retention port with canonical candidate bytes, a digest, and safe
diagnostics. Repair is optional and capped at two repair requests after the
initial attempt. Each repair binds the previous proposal digest and safe
diagnostics and receives a distinct deterministic invocation identity.
Exhaustion returns a rejected review result; no partial candidate is applied.

The deterministic fake now produces the same planning summary and conservative
generation coverage without network, credentials, or spend. Prompt 36 adds no
public API, hosted worker, database migration, live-provider invocation,
repository mutation, compiler execution, artifact generation, cloud plan, or
deployment.

## Prompt 36A candidate generation and repair

Prompt 36A activates the existing strict `application-source.generate`,
`iac-extension.generate`, and `candidate.repair` operations only through
`@cloudmarkup/ai-extension-generation`. Supported catalog behavior still routes
to the deterministic compiler or application generator. A model candidate is
allowed only for an explicit `ai-assisted-custom` workload or an approved target
extension slot; it cannot regenerate, replace, or shadow deterministic files or
compiler-owned resource addresses.

The generation request carries only the relevant immutable Solution Revision,
requested behavior, exact owned paths, runtime/language, allowed dependencies,
providers and resources, catalog and official-schema slices, source references,
validation expectations, and protected deterministic path/address metadata.
Sanitized existing file bodies are included only for exact editable owned paths
needed to preserve user ownership, never for protected files. Each user-owned
body is rebound to its exact Solution Revision ownership, content digest, and
size, and the gateway permits only a patch with that exact base digest. It
carries no secret value, credential, entire catalog, or arbitrary repository.
The strict response describes bounded complete files or patches, dependency
requests, source references, assumptions, unresolved items, expected tests, and
exact model/prompt/version provenance. Solution-contract references carry the
exact canonical contract-record digest. The gateway writes no file.

Every response is reparsed and rebound to its request before restricted
materialization. The coordinator rejects unsafe or unowned paths, case/Unicode
collisions, excessive bytes, files, or resources, unapproved dependencies,
providers, or resource types, secret-shaped content, stale base digests,
ungrounded references, and deterministic-path or address collisions. Candidate
bytes live only in an injected tenant-scoped content-addressed restricted store;
review records, Evidence, Active Issues, ordinary logs, and repair diagnostics
contain digests and bounded sanitized metadata instead of source bytes.

Application candidates then use the additive Prompt 32A AI-custom profile and
must preserve the deterministic scaffold, canonical bindings, fixed runtime,
owned extension points, generated unit/contract tests, and empty blocking
behavior before level-5 build/test/security Evidence can pass. Terraform
candidates are parsed as HCL and use the approved offline static-validation
command matrix against an exact protected baseline. CloudFormation candidates
are parsed as bounded JSON or long-form YAML with tags, anchors, and aliases
denied, then validated against exact recursively closed reviewed property
schemas, strict intrinsic/reference grammar, exact ownership and limits,
recursive IAM wildcard/`NotAction`/`NotResource` policy controls, and target
readiness. Deterministic CloudFormation support now exists for the exact curated
catalog slice, but it does not authorize arbitrary AI-authored CloudFormation
candidates. Candidate admission still requires its own exact reviewed authority
and property-schema coverage.

Repair receives only the previous candidate binding, relevant candidate
sections, and sanitized diagnostics. Every attempt records both the raw model
response digest and the deterministic merged-bundle digest plus the exact
provider, model, prompt template/version/digest, usage record, and idempotency
identity. At most two configured follow-up attempts are metered under distinct
idempotency keys, rerun the complete applicable pipeline, cannot weaken a rule,
and cannot raise the user's accepted estimate for system-required repair.
Exhaustion leaves Active Issues and a rejected candidate. If ModelGateway
rejects structured generation or repair output before safe candidate sections
exist, the coordinator returns a restricted marker and current Active Issue
without another repair; raw output remains only in ModelGateway's restricted
diagnostic store. Review presentation receives the attempts in order as
privacy-safe provenance summaries; it never receives raw provider-attempt
prompts, responses, repair sections, secrets, or unrestricted diagnostics.

The coordinator awaits each bounded live progress publication before proceeding.
Those strictly ordered generation, validation, repair proposal, repair
completion, repair validation, and rejection snapshots form a verifiable live
prefix carrying exact current issues, append-only issue history, and
review/artifact/bundle digests. Completion creates one immutable generation
finalization seal over that full prefix, terminal snapshot and result, and final
Evidence/issues/history counts and digests. Neither live progress nor the seal
has write, repository-write, or deployment authority.

Active Issues use stable authority-derived identities and append-only lifecycle
history. A complete superseding assessment marks a missing issue stale instead
of deleting it. Resolution requires exact current passing Evidence that names
the issue; a claimed AI repair without that Evidence remains only a proposal.

A reviewed deterministic fix may run only through
`applyReviewedDeterministicIssueFix` after the host authorization port allows
the exact `apply-deterministic-fix` action and canonical operation digest bound
to organization/project, review, artifact, source revision, current issue
record/version/digest, and source content/visual hashes. Its Graph Command v1
batch executes through the deterministic domain engine, derives `reviewedBy`
from the allowed decision, and returns the decision ID, exact changes, and an
inverse without persistence. An AI-only fix is rejected and remains a proposal
until a resulting candidate passes validation.

Inspect, edit, accept, reject, and deterministic-fix application require a
host-owned authorization decision derived from verified authentication context
and bound to the exact action, principal, organization/project, review, artifact
digest, and source revision. Model output and request bodies cannot grant this
authority.

The artifact store binds an artifact to exactly one immutable review identity
and digest. Every later action rejoins that binding; edited lineage additionally
uses immutable historical reads to rejoin each predecessor review, artifact,
lifecycle transition, and replay authority rather than trusting only the newest
record.

Authorized inspection returns only exact candidate bytes from the restricted
store. An edit rehashes the owned content, replays the original sanitized
generation context and complete target validator, and creates fresh Evidence,
issues, artifact, and review identity before atomically superseding the exact
current predecessor. The store preserves the predecessor and original model
artifact, requires append-only authorization and per-file edit lineage, and
leaves the predecessor current when validation, lineage, or stale-race checks
fail. The original generation finalization seal is never rewritten. Each
successful edit instead appends an immutable revalidation authority binding the
exact edit decision, cumulative file lineage, parent artifact/review/seal,
validation result, and monotonic Evidence, issue-history, and current-issue
prefixes.

The bounded review component presents the same five stages and controls in
Guided and Professional preferences. Primary issue text is plain English. A
collapsed optional **Technical details** section exposes file/digest/ownership
references, schema pins, tool diagnostics, model/prompt provenance, and exact
deterministic-operation or AI-proposal fix references. The bounded review
context also carries assumptions, unresolved questions, expected tests, and
Evidence as bounded summaries; these fields add no raw model text or candidate
bytes. The strict adapter is mounted on the existing artifact-review route with
host-supplied authorized records and edit/accept callbacks; it rehashes review,
inspection, replay, route, and file authority and exposes no candidate bytes
when they are stale or malformed. Any local edit blocks acceptance until a new
validated candidate digest arrives.

A successful review still has `writeAuthority: "none"`. Accept and reject are
reauthorized against the exact current review and then reread the current
artifact and immutable binding before committing a decision; a concurrent edit
or supersession fails closed. Edited acceptance also rejoins the complete
historical chain and every append-only revalidation authority. Explicit
stale-safe acceptance creates a distinct immutable successor Solution Revision
and exact immutable export input containing the accepted Prompt 24D record,
restricted artifact reference, re-bound Evidence, ordered attempts, ownership
lineage, and user modifications. Both records retain
`deploymentAuthority: "none"`; this operation does not mutate the source
revision or canonical design, write or materialize a repository, assemble
compiler output, invoke a live model, use credentials, plan, apply, create a
change set, or deploy. The model remains an untrusted candidate author; the
deterministic acceptance result grants no automatic canonical-design authority
or customer-cloud capability. Prompt 37 now composes these proposal authorities
through strict scoped workflow ports and the shared review workspace. Production
database/job transport and any repository, compiler, cloud, or deployment
composition remain outside the boundary.

## Prompt 37 seamless reviewed Assistant workflow

`SeamlessAssistantWorkflowCoordinatorV1` wraps one strict
`AssistantOperationBatchV1` flow around the review-only planner. The request
rejoins exact Intent, Solution Revision, catalog, validation, repository
evidence, entitlement, output, plan, and custom-generation limits before host
authorization or model use. Only allow-listed graph and Assistant operation
families are admitted. Whole-document replacement, unknown operation or policy
kinds, ungrounded repository claims, and authority mismatches fail before model
invocation.

The coordinator uses the canonical fenced runtime/commercial workflow: atomic
quota/concurrency and cache-inclusive capacity claim, store-issued leases and
revisions, trusted-time reservation intent/receipt with read-only recovery,
reservation-pinned pricing/normalization, and a separate persisted dispatch
intent. It settles authenticated normalized usage; uses coordinator-owned
pre-callback expiry proof or externally verified callback-origin attestation for
no-dispatch release; and treats authenticated priced post-dispatch failure as
compensated measured usage, not inferred no-dispatch. Exact replay returns
stored state and drains pending safe outbox entries without another invocation
or charge; cancellation after dispatch uncertainty reconciles. Insufficient
credit produces bounded denial without model use. Raw responses remain
restricted; safe review records carry exact model/prompt/evidence provenance
outside semantic design fields.

Assistant operations execute against a detached candidate and validate each
operation plus the final atomic batch. Model-authored structural IDs are
deterministically normalized and references rewritten. Identity-bearing
Workload, contract, or test additions that cannot be reconstructed from trusted
authority fail closed until a reviewer/host supplies canonical IDs. The
coordinator exposes immutable scoped review state, awaited progress, stale-safe
edits, Active Issue history, credit estimates/use, and explicit accept/reject
results with `writeAuthority: "none"`. It has no compiler, repository, GitHub,
payment, cloud, plan/apply, change-set, deployment, or automatic-apply tool.

## Prompt 38 evaluation and runtime admission

Prompt 38 adds a frozen 21-case deterministic evaluation harness and one
fail-closed `ModelRuntimeControlServiceV1` composition. Case results bind their
frozen operation/role requirement to the exact evaluated capability, route,
model/profile, prompt, response schema, and catalog tuple. Deterministic mode
accepts only the exact synthetic fake tuples. The selected route provider family
must agree with the report's fake-versus-live evidence; non-fake evidence
requires the exact live execution class and authority digest. Reports separate
19 deterministic dimensions and regressions from optional non-authoritative
judge scores. Current evaluator execution hardcodes
`activationRecommendation: "hold"` and `capabilityActivated: false`. The
contract's reserved `eligible-for-reviewed-beta` value requires a future
separately reviewed, resolver-verified host recommendation authority and cannot
be emitted now.

Runtime admission rejoins that immutable report with exact prompt, response
schema, catalog, evaluation-policy, and runtime-policy provenance plus routing,
cache, entitlement, commercial, tenant, kill-switch, allowlist, and idempotency
authorities. Trusted host time defines windows and all decision, commercial, and
lease expiry checks. Before authority resolution or state inspection, a durable
host verifier authenticates strict `ModelRuntimeInputEvidenceV1` binding the
exact tenant/user/operation/input, requested counts and allow-lists, redaction,
source ownership, verifier provenance, and literal absence of external
credential/deployment/shell/tool/URL authority. The admission request and
fingerprint bind its digest, and the callback receives the exact authenticated
record. Unissued, substituted, cross-tenant, under-reported, secret-bearing, or
unredacted Evidence fails before state, commercial, model, or telemetry work;
terminal replay reauthenticates the unchanged record without reinvocation or
recharge. Runtime-store `inspect` returns the read-only decision snapshot and
`snapshotDigest`. One tenant-first atomic `claim` rechecks that digest while
acquiring idempotency, request quota, active concurrency, optional
authority-digest live capacity, the initial telemetry outbox, and
`ModelRuntimeExecutionLeaseV1` with `acquiredAt`, `executionLeaseId`,
`expiresAt`, `fencingToken`, `recoveryOnly`, and `revision`. The runtime store
then uses `assertExecutionLease`, `checkpointPendingAndRelease`,
`completeAndRelease`, and `release` with that exact lease/revision. Exact replay
adds nothing. Active concurrency lease IDs are atomically unique within an
organization until release, and verified release restores active concurrency
only—not accepted request counts or cumulative live capacity. Live capacity
includes input, output, cache-read, cache-write, and total tokens;
`reservedTotalTokens` must equal the exact sum of the other four token
reservations.

Canonical accounting keys otherwise equal opaque reservation/idempotency IDs by
verified organization/project/user scope, preventing cross-tenant alias or
lifecycle mutation. Before reserve, the commercial workflow persists
`ModelCommercialReservationIntentV1`; afterward it persists
`ModelCommercialReservationReceiptV1` with exact
`ModelCommercialReservationAccountingStatusV1`. An intent without a receipt is
looked up through read/replay-only `recoverExistingReservation`, which returns
only `ModelCommercialReservationRecoveryResultV1`. Recovery-only execution
always performs that lookup, even with a stored receipt, and persists only the
matching refreshed canonical status. Ordinary claimed work calls
`ModelRuntimeCanonicalCommercialPortV1.execute`;
`ModelRuntimeCanonicalCommercialPortV1.recover` cannot reserve missing work or
invoke. The accounting port exposes no generic `expire` mutation; `expired` can
only arrive as canonical read/recovery status from a future authenticated
accounting process. Before provider dispatch, trusted time and expiry are
rechecked and `ModelCommercialDispatchIntentV1` is persisted. Clock expiry alone
denies dispatch but cannot release credits. Callback timestamps and metadata
carry no authority.

`ModelCommercialCoordinatorPreDispatchProofV1` can establish not-dispatched only
from the persisted intent, trusted expiry, and authenticated coordinator
knowledge that callback start did not occur; time alone is not release Evidence.
Callback-origin no-dispatch Evidence requires
`ModelCommercialPreDispatchNoUsageAttestationV1` plus
`ModelCommercialHostAttestationPortV1` verification. Authenticated, priced
post-dispatch failure with no useful output may release customer credits while
recording measured usage as compensated; it is not no-dispatch proof. Unknown or
invalid post-dispatch outcomes retain the reservation in fixed safe
reconciliation and cannot invoke again. Returned sanitized evidence is rechecked
against admitted, policy, route, and live byte/token bounds and requires
host-owned digests for allow-listed operations and source ownership.

Runtime claim and pending/terminal state commit atomically with deterministic
content-free `ModelRuntimeTelemetryOutboxEntryV1` records. `listPendingOutbox`
and `acknowledgeOutbox` let ordinary execution and exact terminal replay drain
the same stable event IDs. Host-issued operational-outcome authority must bind
the exact executed request, decision, terminal digest, tenant, operation, safe
reason codes, and source Evidence. The store rejects forged, cross-tenant,
unexecuted, or substituted claims and atomically appends each accepted
audit/metric pair to that execution's outbox.

Runtime capacity/workflow/reservation-intent/receipt/dispatch/reconciliation/
outbox records are coordination evidence, not a commercial counter or ledger.
Only canonical accounting can price, reserve, settle, release credits, or change
a balance.

The normal command is deterministic fake-only and rejects provider or live-mode
arguments. Live-evaluation schemas remain providerless contracts for exact case,
environment, model/prompt/schema/catalog, token, credit, cost, concurrency,
expiry, evaluation-policy, and cycle-free `runtimeControlConfigurationDigest`
authority. The digest covers runtime controls and report-independent evaluation
requirements, not the final policy digest or report-instance pins; the final
policy binds the report one-way.

That authority is insufficient to execute. Every direct
`runModelEvaluationDatasetV1({ mode: "live" })` call fails with
`model-evaluation.live-execution-port-required` before invoking an adapter or
judge. A future separately reviewed host port must atomically provide the fenced
runtime lease/revision, recovery-only state, and cache-inclusive capacity claim;
the reservation intent/receipt and read-only recovery result; the
reservation-pinned `ModelCommercialDispatchIntentV1` and
`ModelCommercialHostInvocationReceiptV1` plus reconciliation and runtime outbox
evidence; and deterministic validator Evidence. Prompt 35's Bedrock adapter is
not that evaluator port. Direct live-mode unit tests exercise denial only; no
provider-backed evaluator adapter/judge invocation or live CLI/CI entry point
exists, and no capability is activated. See
[AI evaluation and runtime controls](AI_EVALUATION_AND_RUNTIME_CONTROLS.md).

## Restoration persistence and platform spending guard

These additions are implemented adapters, not a deployed live AI composition.
Migration `0019` and `PostgresModelInvocationStore` implement the existing
`ModelInvocationStore` claim/result contract: exact authorized scope and claim
digests, atomic invocation/idempotency and escalation-lineage fences, immutable
terminal transitions, and replay of an exact verified result-object reference.
Result publication/reads occur outside SQL transactions, avoiding
connection-pool deadlocks, while terminal CAS and published-object
ownership/digest checks remain inside the persistence boundary. SQL stores
bounded metadata only. The separate `ModelRuntimeResultObjectPort` still needs a
reviewed restricted-content storage, retention and deletion implementation; no
prompt or protected reasoning is stored.

Migration `0020` and `PostgresModelPlatformSpendStore` add an append-only,
globally serialized application dispatch ceiling of USD 50 per database-clock
UTC month. This platform micro-USD ledger is separate from customer credits.
Every attempt retains its entire reviewed ceiling, including uncertain or
canceled work; there is no refund/delete API and no allowance per tenant. See
accepted [ADR-0043](../adr/0043-platform-model-dispatch-spending-fence.md).

`PlatformSpendBoundModelProviderAdapter` owns the supplied final HTTP guard and
requires `createDelegate(guardedHandler)` to construct the actual SDK client. It
binds a host-provided cost ceiling to the complete invocation, model/profile and
exact pricing version. Private per-attempt context allows one raw HTTP send; the
handler repeats expiry/month checks after SDK credential/signing work and links
pre-dispatch, month-end and pricing-expiry cancellation deadlines. Delayed
middleware, hidden SDK retries, stale reservations and cross-scope calls cannot
reuse that permission. The cap covers this application's guarded requests, not
unrelated AWS-account usage or a second independently funded environment.

Focused synthetic tests cover transport, codec and query boundaries; dedicated
real PostgreSQL suites exercise concurrent claims/caps, restart/duplicate
replay, cross-tenant denial, immutable rows and direct SQL insertion limits.
Full release verification remains required. Reviewed cost evidence composition,
usable model quotas and evaluation, restricted result objects, durable runtime
admission/accounting composition and the final hosted composition are still
missing prerequisites. Neither migration enables a model route, changes customer
balances or grants provider permissions. A pre-dispatch cap failure is not
fabricated provider usage and does not bypass existing commercial
no-dispatch/reconciliation authority.

### Durable commercial coordination journal

Migration `0022` and `PostgresModelCommercialWorkflowStore` implement the
existing commercial workflow port, not a second credit ledger. Exact verified
tenant, project and principal scope, request/intent digests, database-clock
leases, monotonic fencing and compare-and-swap revisions bind each snapshot.
Immutable dispatch intent and append-only receipt revisions retain recovery
evidence. Recovery-only acquisition cannot create work, and release affects only
the coordination lease, never credits. Canonical accounting remains the sole
reservation, settlement and balance authority.

The store holds bounded metadata, not prompts or model output. Canonical
snapshots are limited to 16 KiB; SQL JSONB text is limited to 32 KiB to leave
room below the Data API row limit. An oversized post-dispatch receipt preserves
the existing dispatch intent and recovers as uncertain rather than invoking
again. Six real PostgreSQL cases remain pending CI; sixteen focused store tests
pass. This adapter does not activate the runtime or supply the missing
accounting, admission/evidence, temporary restricted object or hosted worker
composition.

### Reviewed GLOBAL full-window cost authority

`BedrockGlobalFullWindowCostAuthority` implements the cost-ceiling port for the
exact owner-approved Claude 5 and 4.6 GLOBAL Standard offers in beta account
`000000000000`, source Region `us-east-1`, on `bedrock-runtime`. Sanitized
host-owned evidence binds offer ID/terms digest, observation time, model and
pricing versions, invocation profile, independently observed base/cache rates
and published USD-per-million interpretation. AWS's offer unit is only `Units`;
the currency/denominator is not misrepresented as a field returned by that API.
The model-5 evidence interval is September 5–12, 2026; the separately observed
4.6 interval is September 9–16. Expired or changed evidence fails closed. No
default loader enables it.

The full-window policy does not depend on CountTokens. Its ceiling
conservatively covers 1,048,576 input tokens at the highest applicable
input/cache-write rate plus the full requested output limit, including thinking.
It is not a token estimate. Integer arithmetic rounds up micro-USD. Prompt,
response tool, route and the shared actual SDK request projection are validated;
unknown billable additions, including Guardrails, compaction and server tools,
are denied until separately priced. No cache hit or unused reservation is
refunded by this policy, and each actual retry requires another reservation.

This intentionally coarse first policy allows only a small number of requests
under the USD 50 cap (for example, a 1,024-output-token request reserves about
USD 4.20 for Sonnet or USD 10.51 for Opus). It is safe admission machinery, not
customer pricing, an account-wide AWS billing cap, model invocation evidence or
a composed AI workflow. The runtime/evaluation/commercial/result-storage ports
above remain required. September 9 account checks found nonzero applied 4.6
GLOBAL quotas; model-5 capacity remains unavailable. Access is not execution or
evaluation evidence.

### Exact-request 4.6 input counting

`BedrockConverseInputTokenCounterV1` uses the no-charge CountTokens operation
for the two verified 4.6 foundation models. Its request-local private context
binds the complete shared Converse input, fixed HTTPS endpoint, model route and
original invocation. It checks current authority before signing, at the final
HTTP handoff and after the response; altered bytes are rejected again after
awaited authorization. One context permits one physical HTTP send. Unsupported
billable fields, invalid counts, expiry, revocation and cancellation deny the
attempt. A ten-second deadline bounds counting, including uncooperative waits.
Shared projection 1.1.0 adds explicit automatic tool selection for adaptive 4.6
routes: the actual CountTokens endpoint rejects adaptive thinking with forced
tool selection. Automatic selection retains exactly one schema-only response
tool; plain text and unapproved tools still fail strict local validation. The
complete guarded CountTokens probe succeeds for both approved 4.6 models.

`BedrockGlobalCountedInputCostAuthority` first reuses the full-window resolver's
strict offer, prompt, schema, cache and projection checks. It prices the
verified input count at the maximum reviewed input/cache rate plus all reserved
output/thinking tokens, rounding micro-USD upward. It binds short-lived evidence
to the exact request and repeats counting for every dispatch. The preview
factory creates this authority from explicit reviewed configuration and the same
current runtime/commercial/session/project/baseline/editing-lease closure used
by inference. Counts cannot arrive as browser-provided pricing evidence.

The retained USD 50 ledger and canonical customer credits are unchanged. A count
has at most 30 seconds of dispatch freshness, shortened by its current
authority. The optional `dispatchValidUntil` is checked before reservation,
after the database's global lock, and at the final HTTP handoff after signing
and authorization. It is hashed into the exact reservation claim. Once a request
starts, actual pricing, authority and month boundaries remain its hard response
deadline; count freshness does not abort that response. No bodies or token-count
responses are persisted. Normal request hosting and genuine evaluation/promotion
remain required; these local adapters do not activate a model route. See the
continuation evidence.

## Report-free live evaluation continuation

The isolated V2 implementation follows proposed
[ADR-0047](../adr/0047-report-free-live-model-evaluation.md) and its active
plan. Its policy/request/decision contracts, approval store and migration have
focused unit, real PostgreSQL, type, lint, artifact and security evidence. Full
workstream/root verification remains required. These components do not compose
or activate a live model host.

A definition binds the exact execution tenant/project/user, commercial plan,
development/staging environment, frozen dataset and ordered cases, prepared
invocation input hashes, model/route/prompt/schema/catalog tuples, report-free
runtime policy, budgets and expiry. The configured source and actual frozen
dataset are checked before approval. A definition or digest is never approval.

The private PostgreSQL issuer requires recent verified Cognito authentication, a
configured platform operator and current organization ownership. It records the
exact approved definition in an immutable plan with a maximum 24-hour lifetime.
Current checks authenticate the issued row, original approving operator,
execution membership, active project and permanent project fence, current
configured definition, validity and absence of an immutable revocation. Exact
concurrent approval retries return the original plan; revoked or changed
definitions cannot silently create replacement approval. Revocation remains
available after configuration removal or expiry and cannot restore authority.

Migration 0036 contains bounded metadata only: 40 KiB canonical plan bytes and
48 KiB SQL JSON text leave room below the production database API row limit. It
adds no runtime quota, provider usage, credit or financial ledger. The V2
admission decision shape shares V1's exact safe-outcome validation and omits
final report pins; neither parsing nor an allowed-looking object issues a lease
or permits dispatch. V1 readers continue to reject V2.

The report-independent deterministic checks now share one implementation for
administrative controls, entitlements, allowlists, input/output/repair limits,
request windows, concurrency and cumulative live capacity. The V1 wrapper keeps
its final-report gate; safe error messages and denial ordering are unchanged.
The complete model-gateway gate passes 689 cases. These projections over already
validated metadata cannot authenticate a plan or issue durable execution.

Shared durable admission now has separate V1 and V2 adapters over one SQL
engine. Version-specific codecs preserve strict owned-record reads; only expired
lease collision cleanup may read either validated version. Both execution
classes consume the same request windows and active concurrency. Migration 0037
retains the existing tables, debit and outbox lineage and lease sequence. Its V2
metadata adds a cumulative conservative admission counter, not a credit balance;
release/recovery never refunds it. SQL rechecks exact issued-plan/case bindings
and budgets, while the authenticated plan transaction rechecks current host
operator/configuration before new admission commits.

The issued-plan transaction bridge owns organization then plan locks and
invalidates its callbacks on return. Current approval failures remain sticky,
including caught or unawaited checks. Historical issued metadata permits fenced
recovery after revocation/configuration withdrawal, with current execution
identity, tenant/project authorization and the permanent fence still required.
Every V2 reacquisition is recovery-only. No new provider dispatch or commercial
reservation follows from historical metadata.

Canonical reservation logic now shares one SQL accounting engine behind strict
V1 and V2 host adapters. The live adapter joins an authenticated issued plan to
exact commercial/runtime metadata and requires current approval for new work;
migration 0038 persists the exact bounded routing/workflow/runtime binding and
independently checks the current issued plan in SQL. Both Standard and Deep use
the existing canonical reservation, allocation and usage-ledger tables; no
credit grants or second balance are introduced. Historical recovery rechecks the
current execution tenant while permitting revoked or withdrawn issuance
metadata. V2 terminal parsing has an explicit plan/approval/case envelope over
unchanged common financial integrity checks. The historical V2 reservation
adapter keeps its reservation-only surface. A separate V2 accounting adapter now
authenticates known failed journal usage and releases through the existing
canonical terminal engine. Successful output still requires genuine validator
evidence. These changes do not activate models.

The V2 invocation journal now binds the issued plan, runtime request, canonical
reservation/dispatch and gateway claim. Migration 0039 stores only bounded
usage/generation metadata and output digests. Preparation/claim and output
acceptance require current approval, repeated at transaction commit. Capturing
actual usage after failure or approval withdrawal supports later financial
recovery without permitting redispatch; missing usage remains unknown. Standard
and Deep use the same shared single-primary generation integrity checks while
normal Intent retains its original restrictions and error behavior. This journal
does not yet issue validator evidence or settle credits.

An explicit V2 coordinator now selects live invocation/terminal recovery over
one shared canonical financial algorithm. Fresh callback success is
insufficient: actual journal verification is required before a successful
financial result. Pending validation leaves the original dispatch recoverable
without invoking or reserving again. The PostgreSQL journal authenticates
failed-generation usage, including late receipts after approval withdrawal, with
current execution tenant and exact plan/workflow/runtime/reservation/dispatch
bindings. Missing usage and successful output without validator evidence remain
pending; this read path changes no credits and returns no content. Normal
constructors cannot select live recovery through undeclared options. The V2
reservation adapter still exposes reservation and reservation recovery only. The
separate `PostgresModelLiveCommercialAccounting` adapter uses the same
transaction factory and financial algorithm for exact failed-generation
releases. Shared journal recovery validates claim/callback/usage metadata
without accepting output success as validator evidence. Migration 0040 permits
only failed live-journal releases, repeats exact runtime/issued-plan bindings,
and checks normalized usage against generation metadata before existing
financial and deferred ledger checks. Customer charge is zero; provider cost and
compensation remain recorded. Current execution membership and project authority
are required even when recovering usage after approval withdrawal. Unknown usage
and successful output without validators retain their hold.

The production proposal planner now exposes its actual deterministic assessment
as `evaluateSolutionProposalV1`. It accepts an already generated operations
response without a model, persistence or canonical mutation port, validates the
exact sanitized input/tenant/invocation/routing binding, and runs the same Graph
Command, grounding, ownership, rule-coverage and architecture checks. The
planner delegates with each actual bounded repair context. Returned candidates
and output bodies remain review data in RAM; this function issues neither
durable validator receipts nor commercial authority. Full evaluation still needs
the other operation families and genuine case evidence.

`ModelLiveRuntimeControlServiceV2` now provides explicit execution and
historical recovery over the same internal claimed-execution algorithm as V1.
Strict V2 metadata binds the issued plan/case, authenticated input,
route/cache/environment and one primary commercial call whose capacity covers
the requested output. The normal wrapper retains its V1 report checks and public
signatures. V2 current authority is resolved before execution, by the
runtime-owned final dispatch assertion, and before output acceptance. Historical
recovery has no invocation callback and requires an existing admission plus a
recovery-only lease. Shared lease, accounting, output verification and telemetry
behavior remains common; V2 audit references use actual plan/approval/case
digests. Production host resolution and the platform HTTP connection remain
required; synthetic orchestration tests do not authenticate live evaluation
evidence.

`measureModelRuntimeRequestV1` now derives request measurements from every
strict operation schema and existing semantic/source checks. Repository bytes
are the UTF-8 bytes of every supplied file body or excerpt, including repeated
excerpts and repair patches; repository files are distinct supplied paths. These
values describe supplied content, not unavailable full repository size. File
count is the larger of distinct supplied/declared paths and explicit candidate
capacity. Graph counts cover actual nodes/edges and explicit planning ceilings;
generation resource capacity is additional to supplied graph nodes. Actual
dependency/module/provider declarations are sorted and deduplicated. Repair
limits above the current runtime's two-attempt ceiling are rejected, not
clamped. Returned ownership digests bind validated boundary/source data without
issuing ownership authority.

The API's pure V2 input preparation compares the actual prepared request against
the exact plan case, scope, metadata lifetime, reviewed capability/route/prompt/
response-schema and embedded catalog. It measures the same Converse wire body
used by the adapter, including framing, and retains the full invocation only in
RAM. Its bounded input metadata uses a separate V2 verifier identity and binds
plan/case/invocation/transport digests through its evidence identity. A
current-plan durable transaction now issues and authenticates that record
through `PostgresModelLiveRuntimeHostEvidence`; a constructed record is
insufficient. Caching is currently disabled. Internal escalation is rejected
because real prior-call lineage is not supported by the current V2 journal;
complete evaluation still requires that path.

Reviewed adaptive Sonnet/Opus 4.6 configuration now selects automatic tool
choice, matching the existing CountTokens/final transport contract. The original
Intent issuer measures that exact Sonnet 4.6 request while preserving Sonnet 5
behavior. No historical SQL or public V1 evidence format changes.

The additive SQL0041 table retains only strict bounded metadata, including the
full invocation-scope digest, exact issued-plan/case/input identity and reviewed
invocation/route hashes. Output safety and source-ownership evidence requires
the actual completed journal, its normalized usage/generation, and the exact
earlier issued input and admitted request. Current approval and canonical held
leases are checked in the journal-owned transaction before metadata is exposed
and before commit. Callback mutation and escaped transaction handles are
rejected. The SQL insert guard independently joins the issued plan/current
execution membership, exact case, input and completed journal. It never accepts
bodies or validator quality scores. Historical verification remains scoped to
current execution membership/project authority; it does not authorize new
invocation. No operational-outcome evidence is issued by this adapter.

Explicit V2 Bedrock evaluation configuration now accepts candidate/active
capabilities with their actual evaluation metadata unchanged. Normal V1
configuration and routing retain the active/passed requirements. Pure live
routing/evaluation binds exact plan/case/scope/input/registry/role/policy and
requested token/timeout limits while preserving normal entitlement, credit,
confirmation and capability checks. It disables caching and escalation and
permits one primary attempt. No pure result authenticates operator approval.

`createModelLiveEvaluationGatewayV2` shares the real V1 invocation engine and
requires host authentication before claim and provider entry. It cannot be
enabled through the normal gateway constructor. The API's
`PostgresModelLiveRoutingAuthority` verifies actual issued input and scoped
approval, exact current configuration and current tenant/project access.
Execution, dispatch and output require current approval. Historical recovery
reconstructs the exact original authority but cannot dispatch. The concrete
platform HTTP/runtime lease/credit connection is now composed by the explicit
`createProductionModelLiveExecutionV2` host. Genuine validator receipts remain
required. Explicit V2 commercial preflight and admitted readers now use the
actual issued-plan transaction, current verified principal/session and exact
case/descriptor/policy bindings. Their canonical account, entitlement, immutable
pricing, balance and reservation-count algorithms are shared with normal V1
readers. V2 admission reads require the exact live record, active lease and
original request windows; current approval is checked again before commit.
Normal V1 readers retain their closed Standard Intent preview authority. These
readers issue no credit, admission, dispatch or promotion; outputs remain
detached.

The live factory binds its durable journal to a pure projection of the actual
gateway claim hash and uses the same hash implementation as normal V1. It reads
canonical commercial authority before admission, then uses real V2 runtime and
commercial stores, full-payload CountTokens, the retained monthly platform spend
ledger and the final SDK HTTP guard. Approval, configuration and runtime expiry
are checked again after signing. Both primary routes are tested from fresh SQL
state through synthetic SDK HTTP. The exact versioned Opus 4.6 target selects
automatic tool transport. No injected provider, cost amount, normal activation
or content queue is exposed by the factory.

Final host-prepared runtime/input metadata is still required; the complete
upstream canonical token/estimate preparer belongs to the evaluation runner.
Known failed usage follows actual canonical compensation. Completed generation
without an accepted validator receipt and unknown usage remain pending and
cannot authorize redispatch. Actual receipts and V2 settlement are implemented
below; the HTTP callback connection, remaining validator families, held report
issuance, current normal promotion and production host/editor composition remain
required. The original V1 live runner still fails before invocation. No
synthetic report or test approval may enable normal execution.

The V2 accounting adapter now also handles no-dispatch expiry. It requires the
actual immutable coordinator proof, exact original authority and no live
invocation journal. This is financial recovery after execution expiry, with
current tenant/project authorization; it grants no dispatch or capacity.
Migration 0042 keeps historical migrations and shared canonical pricing/credit
math unchanged. Any registered/claimed journal prevents workflow-only release;
unknown usage and completed generation awaiting validators remain held.

An operations proposal can now be assessed with `assessSolutionProposalV2`
without discarding a completed negative architecture-rule result. It shares
actual command preview, context and source checks with V1 and returns the real
findings and active issues. Missing/incomplete rule execution still fails
closed. V1 keeps its prior valid-result contract and rejects failed designs.
This RAM-only assessment does not issue a validator receipt or grade the
complete evaluation case; the actual scoped journal and all required dimensions
remain necessary before canonical settlement.

The completed-journal metadata callback now exposes the actual detached
canonical workflow under the same plan, tenant, lease and mutation checks.
`projectModelCommercialPendingReviewV2` verifies its active reservation metadata
with the existing intent/receipt algorithms and shares the original response
projection. Its review estimate is real; completed credits and usage remain null
until canonical settlement.

`assessSolutionProposalPreferencesV2` uses that independently authenticated
source with the actual normal planner and Guided/Professional workflow
coordinators. Both consume one exact completed result in RAM and retain normal
authorization and review behavior. It measures their actual progress/review
semantics without provider access, persisted content or an invented charge. A
complete failed design can have equal rejection semantics; this does not convert
it to valid quality. Missing/incomplete validators, cancellation, withdrawn
authorization or substituted source metadata remain unavailable. The host must
reauthenticate completed journal/current approval before issuing any durable
receipt; complete case validation and settlement remain required.

The first concrete case validator covers the frozen prompt-injection/secrets and
deployment/credential-request operations cases. It measures the actual strict
response checks, security-rule findings, current error issue structure and
rejected workflow, plus actual Guided/Professional semantic equality. Issue
clarity here is a deterministic structural criterion: nonempty current
summary/technical detail/affected references, correct error severity and actual
rejection. It is not a language-quality judgment. Unsupported case criteria
remain unavailable. The host reads the actual configured frozen source and
executes the actual validator; caller-authored scores cannot issue receipts.

Migration 0043 adds bounded append-only receipts joined to the completed
invocation, active runtime/workflow/reservation, current approval and issued
input/output safety evidence. Deterministic work runs outside SQL transactions;
current authority is checked again before the receipt commits. Raw output and
normalized proposal digests remain distinct. Migration 0044 now connects actual
receipts to canonical settlement with the internal
`model-evaluation-recorded-v2` scenario. The journal and terminal readers
authenticate the actual receipt, issued case, input/output safety records and
usage; the outcome stores its scoped receipt ID/digest. Historical recovery
retains current tenant authorization after execution approval expires. All
earlier migration bytes and the canonical financial calculation are preserved.
The production HTTP callback now calls the fixed actual case validator.
Migration 0045 adds trusted expiry compensation for completed known usage
without an accepted receipt, preserving the journal and holding unknown usage.
The current host can collect metadata from its actual receipt, normalized usage
and canonical settlement. It accepts assessment 2.1.0 for current quality;
historical 2.0.0 receipts remain readable for financial recovery.

The distinct V2 live observation schema retains actual operational numerators
above their reviewed budget denominators. V1 artifacts and their strict schema
remain unchanged. Neither large operational values nor negative quality are
clamped or promoted into a passing result. SDK latency and the containing
canonical host interval are recorded separately. A complete V2 report/promotion
path and the other evaluation families still require implementation.

Counted request preparation constructs commercial/admission metadata from the
actual SDK CountTokens result, canonical current prices, normalization,
entitlement and balance, with real read-only capacity inspection. It reuses the
execution denial rules, returns denied decisions without a lease and reserves
nothing. The final descriptor is separately counted after canonical budget
binding. The production factory rechecks all authority before dispatch. A
workflow-specific producer must still create the approved frozen source in RAM;
this preparation does not accept browser model, tenant, price or consent claims.

Graph proposal batches are applied atomically by the domain engine. Their
supported child commands and domain-projected diffs also enter the same
assistant review as workload operations, so a graph-only proposal has explicit
reviewable work. Review creation rejects empty or incomplete coverage, including
legacy graph commands outside the assistant review contract. It never presents a
partially represented candidate for acceptance. It compares the exact normalized
graph command sequence with the review projection. The workflow total operation
ceiling includes both graph and assistant operations; the legacy planner retains
its separate graph allowance. Projection performs no additional graph mutation.

The production operations request builder projects every current AWS service,
target-readiness reason, policy configuration kind and registered deterministic
validation rule from installed provider artifacts. The authenticated host must
supply the saved baseline, explicit Intent approval and canonical bounded
limits; the projection cannot grant any of those authorities. Current production
case validation compares the complete rule and readiness metadata before
execution, so a caller cannot omit security rules or widen readiness. Region/AZ
ambient boundaries retain their exact semantic compiler role without a
standalone IaC resource claim. Request contents remain in RAM; no normal
promotion or preview activation follows merely from successful projection.

## First host-seed repair preparation and attempt records

The private first repair host constructs a strict V2 request containing the
actual fixed-host synthetic, user-owned file, complete sanitized diagnostics and
exact seed/revision/ownership references. It reconstructs RAM content and checks
current tenant/operator/configuration authority around the closed source reads.
A static V3 descriptor binds the real request and authenticated scope before
CountTokens and input issuance. Its final route and counted estimate bind the
issued input afterward, without a digest cycle.

Explicit V3 SDK, full-payload token counting, pricing and platform spending
entry points share the existing algorithms and mandatory final HTTP fence. The
first response reader reuses provenance, candidate, dependency, evidence and
diagnostic checks; user-owned source requires an exact base-bound patch. Known
provider usage records the actual physical send without fabricated final V1
routing. Missing or malformed usage remains unresolved. Response parsing neither
merges a patch nor issues a native validator receipt.

The original V3 dispatch/outcome prototype remains readable. Additive V4 attempt
records separate pre-HTTP canonical dispatch intent from post-HTTP observed
usage. They reference the unchanged V3 plan, selection and input. The finite
projection requires exact observation/outcome joins, one workflow and intent per
case, distinct per-send platform reservations, correct stage ordinals and exact
predecessor references. Its lineageComplete flag does not prove final
accounting.

The successor preparation builder shares authenticated source/count/input
issuance and constructs one commercial request with both pre-issued repair
slots. It calculates each call's canonical cost/credits independently before
summing, preserving rounding. The second call has an explicit uncounted ceiling
and requires a fresh full count before any later dispatch. Approved per-stage
token shares, model context, per-case cost/credit shares and current balance all
bound this metadata. The short count expiry remains separate from the workflow
deadline, which cannot exceed current plan/commercial/configuration authority or
the existing five-minute execution lease.

The current single-call reservation is an intermediate component. The executable
host must reserve one accepted two-slot workflow, issue real dispatch, usage,
validator and outcome records, then settle or recover that workflow after the
case ends. No model inference, migration registration, normal promotion or beta
activation follows from these local contracts. See the stage observation plan
and proposed
[ADR-0050](../adr/0050-preissued-ai-evaluation-sequence-lineage.md).

Strict V4 runtime records now bind the complete two-call commercial list. The
closed host shares current authenticated capacity, claim and recovery
transactions with V3 while reading each actual schema separately. Physical
request limits and aggregate workflow capacity remain distinct. The production
successor prepares that execution and store without claiming a lease or credits.
Unregistered proposal 0064 preserves historical rows and prevents cross-version
reuse of an issued stage. Canonical two-slot reservation and real dispatch,
observation, validation and terminal issuance remain required.

The private V4 canonical reservation host verifies the full two-call list and
actual coordinator estimate, then uses the shared transaction and accounting
algorithms with an explicit version mapping. Unregistered proposal 0065 adds its
SQL binding validator and reservation uniqueness. Recovery returns only an
existing reservation. Production coordinator composition, dispatch and final
settlement remain unfinished.

The closed V4 canonical read ports now reuse current balance, pricing, request
counts and admitted-runtime algorithms. Actual V4 row restoration remains
separate from historical readers. The complete two-call aggregate is bounded by
its prepared request, approved plan and physical per-call limits. Every read
requires current original-tenant, issued-input, plan and configuration
authority.

The explicit seed usage projection keeps physical send number one separate from
canonical repair ordinals one and two, checks actual descriptor/input/usage
bindings and predecessor identity, and preserves known failure usage. It shares
canonical attempt parsing and unit arithmetic. It does not create an observed
receipt, grant delivery, or settle a reservation; the closed host owns those
steps. Thinking included in Bedrock output tokens is not added as another
charge.

### Explicit final-repair transport

A separate V4 static invocation descriptor and prompt consume the V3 successor
request derived from the actual unaccepted first repair. The original owned seed
remains bound. SDK and complete-payload CountTokens entry points reuse the
existing wire framing and final HTTP guard, with disabled caching and strict
channel rejection. The second invocation cannot reuse the predecessor identity.
The host still must authenticate actual issued lineage and current authority.

The final response uses the existing deterministic-host patch response schema.
Its separate reader binds the current candidate digest, reviewed prompt and
scope, then shares the historical provenance, dependency, path, diagnostic and
evidence checks. No parser grants issuance, acceptance, validation or accounting
authority. Historical first-seed readers and prompts retain their identities.
Second-stage issuance, native validation and complete-case settlement still
require executable host composition.

The bounded repair prompt now explicitly supports both V2 first-seed and V3
successor semantics under one authority tuple. First-stage preparation resolves
only exact reviewed patch prompt identities from that tuple. The older
first-only prompts remain readable. Existing approvals cannot silently acquire
the new prompt: its identity and digest must be included when issuing a new
plan.

## Incremental functional beta proposals

Explicit proposal versions 2/3 project Region, supported nongenerated resource
IDs/types/labels and relationships. V3 supports typed catalog configuration in
its output; existing configuration, credentials and source are excluded from
input. Durable architecture-proposal jobs bind current tenant authority, saved
draft preconditions and a separate unsaved local baseline. The isolated SQS
worker owns the bounded model call and cancellation checks. Legacy synchronous
v1 clients remain compatible. See
[ADR-0056](../adr/0056-incremental-beta-diagram-proposals.md).

Opt-in ai-source-draft-v1 export jobs separately project immutable workload
purpose and the same limited graph context. Model output is bounded source data
at host-selected paths, never executed by the host. The ZIP records
review-required ownership and does not change application-build or revision
coverage evidence. See
[ADR-0057](../adr/0057-opt-in-beta-application-source-drafts.md). Neither path
promotes the ordinary evaluation-gated model runtime or grants compiler network,
credential or deployment authority.

Frozen beta evaluation sources retain the exact installed catalog 0.16 snapshot
and service-extension authority. Production planning resolves either that exact
binding or the current 0.17 binding; changed digests and unknown versions fail
closed. Existing evaluation request hashes are unchanged and do not establish
quality evidence for the new FSx family.

## Reviewed beta canvas context (M9, September 30)

Proposal v4 and explicit source v2 use the bounded projection described in
[ADR-0066](../adr/0066-reviewed-canvas-ai-context.md). The server pins catalog
identity, excludes unreviewed/sensitive configuration and sends literal resource
and relationship settings, placement, workload purpose and deterministic draft
finding summaries. Model output remains untrusted; advisory checks never replace
the editor's atomic command and deterministic validation gates. Assessments may
return without changes; blocking questions return without an applicable batch.

Source v2 uses immutable revision context and a distinct producer/prompt/cache
identity, requires a supported Node.js 24 runtime, and packages advisory review
and a test plan. Legacy source v1 remains separately readable and minimized.
Generation does not run or certify generated source. Usage estimates include the
serialized system instructions and response schema. Migration 0082 and its
runtime admit v2 pricing at one credit per USD0.01 of configured provider cost;
replay and settlement keep the reservation's historical price. Retail prices are
not this conversion. See the execution plan for verification and deployment
status.

## Bounded beta list proposals (M9, delivered October 2)

Proposal v5 adds flat string-list settings to reviewed resource creation,
connections and updates, bounded to 16 entries and 256 characters per entry. Its
model catalog advertises only representable literal fields with intersected
bounds and explicit unsupported keys. Server admission checks the exact provider
field's type, enum, list limits and uniqueness. Omitted settings are never
materialized as defaults during partial update validation. The editor retains
atomic commands, complete graph validation, staleness checks and human
acceptance, displaying explicit list values before application. V1–v4 schemas
and prompts remain unchanged; new requests select v5. No paid model probe,
billing conversion change or compiler authority is added. See
[ADR-0086](../adr/0086-bounded-ai-list-proposals.md) and the execution plan for
verification and delivery state.

Prepared v5 requests persist the exact current catalog digest alongside reviewed
context. The worker reauthorizes and checks that binding before model dispatch;
catalog drift requires a fresh request instead of changing queued capabilities
or their input estimate. Legacy preparation contracts retain their behavior.
