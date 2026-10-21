# `@cloudmarkup/schemas`

## Responsibility

Own runtime-boundary schemas and machine-readable contract generation shared
across languages and schema-driven interfaces.

## Architecture Document v1

The package exports the strict Zod schema, inferred TypeScript types, canonical
JSON serializer, safe validation error formatting, and the generated Draft
2020-12 JSON Schema at `architecture-document-v1.schema.json`.

Architecture Document v1 is immutable and remains readable. Only schema version
`1` is accepted by its version-specific parser. Unsupported or missing versions
fail closed; migration dispatch belongs to the domain registry. Service
configuration is carried in a closed typed-value record with an explicit catalog
schema ID and version. Provider catalog code must validate the allowed keys and
value kinds for that referenced schema before a service is supported.

Canonical Architecture Document serialization sorts document collections by
stable ID and generated-provenance reference lists by referenced ID, then
recursively sorts object keys. Ordering inside catalog-defined configuration
lists is preserved because the core cannot assume it is incidental.

## Architecture Document v2/v3 and Workload Behavior v1/v2

Architecture Documents v1 and v2 remain immutable readable contracts.
Architecture Document v3 is the current normalized write target. It preserves
the graph contract, carries Workload Behavior v2, and adds independently
versioned Application Contracts v1 and External Resource Reference Document v1
collections bound to the same document and revision identity.

The version-specific v3 parser accepts only schema version `3`; the domain
migration registry owns deterministic v1-to-v2-to-v3 migration. Migration
preserves existing graph/workload facts, maps only equivalent implementation
states, and adds empty new collections without inventing application behavior.

Workload Behavior v2 stores stable workload and binding identities, owning node
references, one of six closed implementation modes, runtime and handler
identifiers where applicable, exact graph and application-contract references,
trigger and downstream bindings, authorization, timeout/retry/idempotency,
observability, tests, reference-only environment/secret bindings, source
ownership, extension points, unresolved requirements, and generator/model
compatibility and provenance. Every object is closed. Raw source, inline
environment values, credentials, secret values, tokens, prompts, callbacks,
shell commands, package scripts, and code ASTs have no schema location.

Normalization sorts every semantically unordered collection by stable identity.
Workload, contract, and external-resource behavior is semantic content; visual
labels and positions remain outside semantic identities.

## Solution, repository, ownership, and evidence contracts

The package exports strict version-1 schemas and canonical normalization for
Repository Snapshot, Observed Solution, Reconciliation Proposal, Solution
Revision Manifest, repository lock/manifest ownership, AI-authored extensions,
generation coverage, Active Issues, and Evidence.

Repository observations remain separate from approved design. Solution Revisions
pin exact source, contract, tool, ownership, coverage, issue, and evidence
references. Evidence establishes one exact level only. Ownership, coverage, and
AI-extension records grant no model, shell, repository, billing, secret,
compiler, cloud, CI, or deployment authority.

## Intent Document v1

The package exports a strict provider-neutral Intent Document schema, inferred
TypeScript types, safe structural error formatting, deterministic normalization
and serialization, and the generated Draft 2020-12 JSON Schema at
`intent-document-v1.schema.json`.

Intent values use a closed version-1 capability taxonomy such as `http-api`,
`object-storage`, `event-queue`, and `key-value-data`. Unknown requirements are
explicit discriminated values linked to stable unresolved-question IDs; the
schema does not manufacture defaults. Prompt provenance contains only
provider-neutral interaction/template identifiers, versions, digests, and
timestamps, never raw prompt bodies or model-provider fields.

Only schema version `1` is accepted. There is no predecessor migration.
Normalization sorts semantically unordered collections, references, and
rationale considerations without deduplicating or repairing invalid input.

## Async Job v1

The package exports the strict provider-neutral Async Job v1 input, output,
record, lifecycle-support, queue-envelope, audit, polling, and handler-outcome
contracts plus `async-job-v1.schema.json`. The 17 family variants distinguish
exact draft, immutable Solution Revision manifest, and organization subjects.
Trusted organization/project ownership stays outside payloads. Large inputs,
checkpoints, outputs, artifacts, and Evidence cross the contract only by bounded
content-addressed references; raw credentials, tokens, provider clients, model
calls, deployment authority, and billing policy have no schema location.

Solution Revision subjects bind the manifest record identity, revision identity,
and manifest digest. Every Evidence-producing input declares an exact
environment; application-source generation and GitHub export may use
`multi-environment` or `unknown` when appropriate. Retries and durable
checkpoints preserve the exact input digest. Persisted user-interaction state
binds an awaited request and any durable response to its exact checkpoint and
handler version. An active request must target the latest checkpoint, while a
received response remains auditable as a resumed handler records newer
checkpoints. Terminal records may retain an outstanding request, but polling
exposes only an active request's opaque interaction ID and request time, never
checkpoint, handler, or response references. Explicit expected child sets make
orchestration completion deterministic. Retry scheduling authority lives on
completed-attempt dispositions; polling exposes only its derived next retry
time. Aggregate referenced output must fit both measured and configured limits,
with unique artifact and Evidence identities. Draft work cannot emit
reproducible Evidence, Evidence record references cannot expire, and expired
artifacts remain identifiable for audit.

## Contract artifacts

`check:artifacts` rebuilds the package and verifies all 36 generated Draft
2020-12 JSON Schemas plus canonical v1/v2/v3 Architecture and Intent fixture
snapshots byte-for-byte. That set includes `model-evaluation-v1.schema.json`,
which publishes the frozen evaluation, report, providerless live-authority,
host-issued input Evidence, runtime-control policy/admission, cache-inclusive
live-capacity state, safe audit, metric, and regression records as one versioned
artifact. Its reserved-total invariant covers input, output, cache-read, and
cache-write tokens. Current evaluator execution hardcodes
`activationRecommendation: "hold"` and `capabilityActivated: false`. The schema
retains `eligible-for-reviewed-beta` only for a future separately reviewed,
resolver-verified host recommendation authority; it does not publish that
authority. Schema availability does not make live execution available: the
evaluator still requires a separately reviewed atomic host port joining runtime
admission, commercial receipts, and validator execution. `generate:artifacts` is
the only supported way to refresh checked-in artifacts after review.

The additive `model-live-evaluation-sequence-v3.schema.json` artifact registers
seven distinct metadata records: definition, approval, issued plan, complete
selection, prepared input, dispatch and outcome. Only the two frozen repair
cases and their two ordered repair slots are supported. V1/V2 parsers and the
existing generated artifacts retain their prior bytes and meaning. JSON Schema
describes strict transport structure; canonical digest checks, frozen-case
identity, cross-record chronology and authentic current authority additionally
require the Zod schemas, finite projection and private host. A valid metadata
record is not proof of approval, actual model execution, validation or payment.
The V3 SQL proposal and host integration remain outside runtime registration.

The additive model-live-sequence-attempt-v4.schema.json artifact supplies strict
dispatch-intent, observed-attempt and stage-outcome records over the unchanged
V3 parent sequence. Pre-HTTP records cannot assert a completed attempt. Known
stage outcomes bind observed usage without prematurely settling the whole
workflow. Current host authentication and final canonical settlement remain
separate. Existing V1/V2/V3 artifacts and readers retain their bytes and
meaning.

The Zod-only `ModelLiveSeedInvocationDescriptorV3` describes static first-seed
routing before CountTokens and input issuance. It excludes the final routing
decision, counted credit cap and redundant capability-evaluation fields, while
the exact capability digest still pins configured evaluation metadata. Its
required organization/project/user/job scope and high-effort repair route are
separate from V1 descriptors. Historical parsers reject it; existing JSON
artifacts remain byte-compatible. This descriptor grants no model authority.

## Graph Command v1

The package exports strict Zod schemas and inferred TypeScript types for every
supported graph command plus the generated Draft 2020-12 JSON Schema at
`graph-command-v1.schema.json`. Every command carries schema version `1`, stable
command and inverse IDs, origin, exact document identity, and typed
operation-specific preconditions. Batches contain one or more non-batch
commands, have a bounded size, and cannot nest.

`release-generated-resource` requires the caller to declare whether the resource
must be `removed` or `retained`; omission and unknown dispositions are schema
errors. Adding a required field needs a new contract version with an explicit
migration or rejection path.

The schema validates structure only. Exact-snapshot preconditions, ownership,
reference counts, containment, atomicity, and inversion safety are deterministic
domain responsibilities.

## Non-goals

Schemas do not replace deterministic domain validation, contain provider
behavior, or silently reinterpret unsupported versions. The package does not
define provider services, planner behavior, prompts, model calls, persistence,
provider-specific graph behavior, repository scanning or synchronization, source
or IaC generation, customer CI/CD, cloud evidence collection, compilation, or
deployment.

## Generated artifact storage

Checked JSON artifacts use compact JSON with a trailing newline; edit their
typed producers and regenerate them. Exact generator drift checks and complete
parsed contract tests protect their content. Pretty-print a local copy for
inspection. Canonical document serialization and its versioned hashes are
unchanged.
