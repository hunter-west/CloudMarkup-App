# `@cloudmarkup/domain`

## Responsibility

Own provider-neutral graph semantics, deterministic operations, invariants,
draft and revision rules, findings, and provenance.

Architecture Document v3 is the normalized write target, with explicit
v1-to-v2-to-v3 migration. Semantic projections include Workload Behavior v2,
Application Contracts and external-resource references while excluding labels
and positions. Deterministic validation covers graph identity and references,
generated provenance, workload ownership, bindings and implementation contracts.

Graph Command v1 applies strict versioned node, edge, configuration, position,
containment, adoption, release, and non-nested batch commands. Application is
immutable and deterministic, validates exact document and prior-value
preconditions, emits structured change summaries, and returns either a safe
inverse command or an explicit non-invertible reason. Invalid commands and final
graph invariants throw structured, value-safe errors; an invalid batch exposes
no intermediate document. Commands preserve workload behavior and fail closed
before removing a node or edge that it still references.

Generated nodes and edges cannot be semantically customized until adopted and
cannot be removed through generic deletion. Release removes explicitly declared
provenance dependencies, reports remaining provenance and live graph reference
counts, and deletes only an unadopted generated resource whose two counts are
zero. Every release declares the required `removed` or `retained` disposition;
the engine recomputes that disposition from the current document and fails a
stale mismatch as a precondition before exposing any batch result. Adopted
resources require explicit user-directed deletion and the same dependent checks.

It also exposes provider-neutral Intent IR types, normalized parsing, and
deterministic semantic checks for duplicate identities, broken question and
capability references, invalid numeric ranges, non-monotonic latency, invalid
steady/peak scale, conflicting active decisions, inconsistent alternatives, and
prompt-provenance contradictions.

Validation Engine v1 runs pure, synchronous rule extensions over an immutable
Architecture Document snapshot. Rules have branded stable IDs, semantic
versions, explicit provider/catalog/target/environment applicability, and
structured findings with six closed severity values, typed affected locations,
two explanation levels, and documentation metadata. The report is bound to the
engine version and document content hash, and its findings, diagnostics, and
rule lists are deterministically ordered.

The built-in provider-neutral rules cover unsupported document versions,
duplicate identities, broken references, parent cycles, malformed generated
operation provenance, invalid variable/output references, workload ownership and
binding failures, and missing ports. Missing-port validation consumes a
caller-supplied provider-neutral inventory bound to the document's provider and
exact catalog version; this package does not invent provider ports. A proposed
auto-fix is exposed only after the Graph Command v1 engine validates and
previews its atomic batch. Conflicting previews are marked, rule failures are
contained, and an incomplete evaluation can never appear clean.

`ProviderPlanner<TDeploymentGraphProposal>` is an interface-only provider
boundary. It accepts validated Intent IR plus an explicit provider/catalog
target. No planner implementation or proposal contract is supplied, and a future
proposal remains non-authoritative until deterministic validation accepts
versioned graph operations into an Architecture Document.

## Document versioning and digests

`DocumentMigrationRegistry` owns immutable dispatch by document kind and source
schema version. The default registry supplies the Architecture Document
v1-to-v2-to-v3 path and no-op baselines for Architecture Document v3 and Intent
Document v1. See the [schema contracts](../schemas/README.md) for migration
content. Dispatch distinguishes current, older-without-path, unsupported-future,
malformed, unknown-type and unknown-version results. Migration works on a clone,
then reruns strict structural and semantic validation; unknown fields are
rejected.

Canonical serialization and SHA-256 compression are owned by
`@cloudmarkup/schemas`. This package exposes:

- an Architecture Document content hash over canonical semantic content,
  including normalized workload behavior, with presentation and explicit audit
  timestamps omitted;
- an Architecture Document visual hash over stable node IDs, labels, and
  positions; and
- an Intent Document content hash over normalized intent with explicit audit
  timestamps omitted.

Architecture compatibility metadata reports the pinned catalog ID/version/digest
and compiler input/range metadata already serialized in the document. Intent
compatibility reports catalog and compiler applicability explicitly as
`not-applicable`; it does not select a provider.

## Non-goals

The domain must not import React, AWS SDK clients, database or network clients,
model clients, prompt implementations, IaC renderers, application adapters, or
deployment behavior.
