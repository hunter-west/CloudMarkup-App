# ADR-0001: Versioned architecture graph as source of truth

- **Status:** Accepted
- **Date:** 2026-07-23
- **Owners:** CloudCanvas engineering
- **Supersedes:** None
- **Superseded by:** None

## Context

CloudCanvas accepts natural-language intent, renders a visual diagram, and emits
Infrastructure as Code (IaC). Any of those representations could accidentally
become authoritative:

- prompts are incomplete, ambiguous, and model-dependent;
- diagrams can hide semantic detail or conflate layout with placement;
- generated Terraform is target-specific and loses user intent; and
- mutable UI state cannot provide reproducible revisions.

The product also needs autosaved editing, immutable history, deterministic
compilation, provider evolution, validation, auditability, and future schema
migrations.

## Decision

The source of truth is a typed, versioned architecture graph.

The graph explicitly represents stable node identities, typed ports and edges,
provider-accurate boundaries and associations, configuration, presentation-only
layout, intent traceability, and provenance for generated supporting elements.

All mutations use versioned graph operations. AI, UI commands, templates,
wizards, and migrations may propose or construct operations, but deterministic
domain code validates preconditions and applies operations atomically.

Projects have mutable, concurrency-controlled drafts and immutable revisions.
Only an immutable revision with explicit graph-schema and provider-catalog
versions may be compiled. Public and persisted graph contracts require a
deterministic migration or explicit rejection path.

Canvas coordinates and presentation mode are non-semantic. Stable graph
identity, not label or coordinates, anchors generated resource addressing.

## Consequences

### Positive

- AI, manual editing, validation, and multiple IaC targets share one semantic
  contract.
- Revision history and generated output are reproducible and auditable.
- Visual layout can evolve without infrastructure churn.
- Provider plugins and migrations have explicit integration points.
- Invalid AI or UI operations fail before state mutation.

### Negative

- Graph schema and migration design become critical platform responsibilities.
- Some provider behavior will not fit simplistic node-and-line modeling and
  requires typed relationships or supporting elements.
- Dual representation of semantic and presentation data adds discipline and test
  work.
- Catalog and schema version compatibility must be maintained across TypeScript
  and Go.

### Follow-up

- Define serialized contracts, canonical encoding, migrations, and minimal
  catalog fixtures in Milestone M1.
- Add property tests proving atomic operations and presentation/semantic
  separation.
- Define role-aware revision gates and autosave conflict behavior before
  Milestone M2.

## Alternatives considered

### Prompt as source of truth

Rejected because natural language cannot provide stable identity, complete
configuration, deterministic migration, or reliable compilation.

### Rendered canvas model as source of truth

Rejected because UI-library structures and coordinates would couple deployment
semantics to presentation and make nonvisual consumers fragile.

### Generated Terraform as source of truth

Rejected because it is target-specific, difficult to round-trip without loss,
and would make provider-neutral intent and future output targets subordinate to
one renderer.

### Event log alone as source of truth

Not selected as the primary contract. An operation history may support audit or
reconstruction, but immutable graph snapshots remain necessary for bounded
reads, migrations, validation, and compiler input.

## References

- [Product Specification](../product/PRODUCT_SPEC.md)
- [Domain Model](../architecture/DOMAIN_MODEL.md)
- [User Workflows](../product/USER_WORKFLOWS.md)
- [Build Sequence](../PUBLIC_STATUS.md)
