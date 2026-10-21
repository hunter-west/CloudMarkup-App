# ADR-0017: Version workload behavior separately from source generation and build execution

- **Status:** Accepted
- **Date:** 2026-07-31
- **Owners:** CloudCanvas product and engineering
- **Supersedes:** None
- **Superseded by:** None

## Context

The Architecture Document is CloudCanvas's typed, versioned source of truth for
deployment-affecting intent. Its first version describes infrastructure nodes,
relationships, generated-resource provenance, environments, and visual state,
but it cannot express how a workload is expected to react to a trigger, call a
downstream dependency, expose an operation, or obtain runtime configuration.

That omission prevents deterministic future starter-source generation from being
revision-bound. Inferring behavior from AWS resource types or connection labels
would be ambiguous: one Lambda can have several triggers and several downstream
dependencies, the same target can support different operations, and
heterogeneous event inputs may require an explicit dispatcher. Storing source,
prompts, shell commands, or package scripts in the architecture graph would
instead turn a declarative contract into an unsafe programming or build system.

Application source generation, dependency resolution, workload testing, binary
packaging, IaC rendering, export assembly, and deployment also have different
trust and reproducibility requirements. Combining them would weaken the closed,
credential-free deterministic compiler boundary established by ADR-0003 and the
export-without-deploy boundary established by ADR-0005.

## Decision

Architecture Document v2 includes an independently versioned Workload Behavior
v1 collection. A workload record is owned by one stable architecture node and
contains only closed, declarative implementation intent:

- a stable workload identity and owning node reference;
- one of `infrastructure-only`, `user-provided`, `generated-starter`, or
  `external-artifact`, together with explicit source ownership;
- runtime family and handler or entrypoint intent where applicable;
- named operations and references to input/output contracts;
- trigger and downstream-action bindings to stable architecture edge IDs;
- environment bindings and secret references without secret values;
- bounded error, timeout, retry, and explicit dispatch assumptions; and
- unresolved implementation requirements.

The contract is schema-closed. It cannot contain raw source code, credentials,
secret values, access tokens, raw AI prompts, arbitrary shell commands,
package-manager scripts, or a code AST. Provider-specific compatibility and
connection configuration remain in versioned provider rules and graph edges; the
workload contract binds to those stable edges rather than copying or guessing
their configuration.

Workload behavior is semantic input. Its normalized content participates in
revision/content hashes because it may affect infrastructure readiness,
generated source, build output, or export contents. Display-only layout remains
non-semantic. Workload, operation, and binding identities are opaque and stable;
renaming a display label cannot recreate them or change infrastructure
addresses.

Architecture Document v1 remains immutable and readable. Deterministic v1 to v2
migration creates an empty Workload Behavior v1 collection. It never infers a
runtime, handler, event type, dispatcher, environment binding, secret,
operation, or source-ownership mode. Unsupported future versions fail with an
explicit version diagnostic.

Multiple inbound triggers are allowed only when the graph, provider rules, and
workload behavior agree. Each trigger keeps its own edge configuration and
provenance. Heterogeneous input contracts require an explicitly supported
dispatcher behavior; no source generator may guess an event type. Guided mode
recommends separate workloads when an explicit dispatcher is unavailable.

Future application handling is split into three boundaries:

1. A deterministic starter-source generator consumes one immutable architecture
   revision, Workload Behavior version, provider catalog version, and pinned
   template/runtime version. It produces reviewable application-source artifacts
   and a manifest; it does not render IaC, fetch credentials, deploy, or invent
   arbitrary business logic.
2. An isolated workload build/test/package service consumes declared source,
   pinned toolchain/dependency inputs, and generation manifests. It produces
   content-addressed test/package evidence and built workload artifacts; it does
   not mutate the architecture revision or deploy.
3. Terraform/CloudFormation compilation remains source-free and consumes only
   immutable infrastructure contracts. Export assembly may combine separately
   produced IaC, supported application source, and built artifacts under one
   revision-bound manifest without executing any of them.

The detailed source-ingestion, regeneration/merge, runtime/template support,
dependency/network, external-artifact verification, and artifact-retention
policies are deliberately not decided here. They require later accepted
contracts before generation or build execution is implemented.

## Consequences

### Positive

- Future starter output can be deterministic, reviewable, revision-bound, and
  independent of display labels or UI mode.
- One workload can model several explicit triggers and downstream actions
  without treating AWS resource type as application behavior.
- Secrets and source remain outside the architecture graph while references and
  ownership remain auditable.
- IaC compilation retains its current closed, credential-free trust boundary.
- User-provided, generated, infrastructure-only, and externally built workloads
  can share one readiness model without claiming equivalent source ownership.
- Export manifests can bind infrastructure and application artifacts without
  making either renderer execute the other.

### Negative

- Architecture Document v2, migration, validation, normalization, and hashing
  add a public compatibility surface.
- Runtime/handler facts can temporarily overlap provider node configuration and
  require deterministic consistency validation until a later contract removes
  that duplication.
- Documents migrated from v1 remain intentionally incomplete; users must make
  implementation decisions rather than receiving guessed behavior.
- Generation and packaging require later services, manifests, isolation, and
  reproducibility policy rather than reusing the IaC compiler process.
- Multiple-trigger support is conservative until explicit event contracts and
  dispatcher templates are reviewed.

### Follow-up

- Implement Prompt 29A as deterministic Lambda starter-source generation over
  this contract, without arbitrary business-logic generation.
- Implement Prompt 32A as isolated workload build, test, and package execution.
- Define content-addressed source ingestion, ownership/regeneration behavior,
  runtime/template support, dependency/network policy, external artifact
  verification, and export retention before either prompt is implemented.
- Extend export and GitHub manifests to carry supported application source and,
  where authorized, built Lambda artifacts alongside rather than inside IaC.
- Add later event-driven templates only for reviewed trigger contracts and
  explicitly supported dispatchers.

## Alternatives considered

### Infer workload behavior from infrastructure edges

Rejected because an edge describes infrastructure compatibility, not handler
semantics, operation intent, event-contract compatibility, or source ownership.
Inference would become provider-specific and ambiguous with multiple triggers.

### Store application source in the Architecture Document

Rejected because source is large, runtime-specific, merge-sensitive, and an
unsafe fit for the versioned infrastructure graph. It would also expand schema,
security, hashing, review, and migration responsibilities into a programming
language repository.

### Put source generation and packaging in the IaC compiler

Rejected because it would mix different toolchains and trust boundaries,
threaten deterministic infrastructure rendering, and pressure the compiler to
gain filesystem execution, dependency, or network capabilities.

### Delay all workload intent until source generation

Rejected because backend/persistence contracts and stable hashes would then be
finalized without the semantic input generation must consume, causing a larger
and riskier later document migration.

## Compatibility, security, and rollback

The v1 document schema remains accepted, and migration is additive and
inference-free. The schema registry selects versions explicitly; unknown
versions fail closed. If Workload Behavior v1 proves insufficient, a new
workload contract version and deterministic document migration are required; the
accepted v1 contract is not rewritten in place.

The schema's closed shape prevents executable/source/secret fields from being
silently accepted. Secret references are identifiers only. No new network,
credential, model, deployment, arbitrary-command, or extension execution path is
introduced. Removing the v2 write path before release is mechanically possible
while retaining v1 reads, but any stored v2 document must continue to receive an
explicit supported or unsupported-version result rather than being coerced to
v1.

## References

- [Domain model](../architecture/DOMAIN_MODEL.md)
- [System overview](../architecture/SYSTEM_OVERVIEW.md)
- [Testing strategy](../architecture/TESTING_STRATEGY.md)
- [User workflows](../product/USER_WORKFLOWS.md)
- [Build sequence](../PUBLIC_STATUS.md)
- Execution plan (private historical evidence, omitted from this distribution)
- [ADR-0001](0001-versioned-architecture-graph.md)
- [ADR-0003](0003-deterministic-compiler-boundary.md)
- [ADR-0004](0004-aws-first-provider-strategy.md)
- [ADR-0005](0005-export-without-deploy.md)
- [ADR-0006](0006-guided-professional-shared-semantics.md)
- [ADR-0011](0011-separate-platform-and-customer-iac.md)
