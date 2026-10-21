# ADR-0004: AWS-first provider strategy

- **Status:** Accepted
- **Date:** 2026-07-23
- **Owners:** CloudCanvas engineering
- **Supersedes:** None
- **Superseded by:** None

## Context

The first release needs sufficient depth to teach, validate, and compile real
architectures. Attempting broad support across AWS, Azure, and GCP would favor
superficial abstractions and delay production-quality Terraform. Conversely,
hardcoding AWS throughout the domain would make later providers require a
rewrite.

Cloud concepts overlap but do not map perfectly. Networking, identity,
availability boundaries, service configuration, and relationship semantics need
provider-specific accuracy.

## Decision

Deliver AWS first through a versioned provider extension contract.

The core owns provider-neutral intent, graph lifecycle, stable identity, generic
typed graph mechanics, operations, revision semantics, provenance, and extension
interfaces. The AWS provider supplies a curated versioned catalog of node types,
ports, relationships, configuration schemas, boundary and association semantics,
explanations, validation rules, connection recipes, and compiler mappings.

Provider-specific facts remain explicit; the design will not force a
lowest-common-denominator resource model. Provider extensions are trusted,
reviewed release artifacts and cannot bypass core invariants, access tenant data
directly, or execute arbitrary catalog code.

Terraform is the first production target. CloudFormation follows after the graph
model and Terraform compiler are stable. Azure and GCP are future provider
plugins whose introduction requires separate validation, compiler, product, and
security decisions.

Service coverage is curated. A service is not supported until it meets every
criterion in the
[MVP curated-support rule](../product/MVP_SCOPE.md#curated-support-rule).

## Consequences

### Positive

- The initial product can achieve accurate AWS depth and production-quality
  output.
- Provider-neutral domain ownership is explicit from the start.
- Provider differences can be modeled honestly instead of hidden behind false
  equivalence.
- Catalog versions make validation, revision, and compiler behavior
  reproducible.

### Negative

- Designing extension seams before a second provider carries some uncertainty.
- AWS concepts will pressure generic interfaces and require boundary
  enforcement.
- Curated depth limits marketing breadth.
- Each future provider needs substantial catalog, UX, validator, compiler, test,
  and education work.

### Follow-up

- Select the initial curated service/relationship set before promoting M1
  fixtures.
- Prove the provider boundary with contract tests and a minimal AWS slice.
- Reassess extension interfaces using production AWS evidence before starting
  Azure or GCP.
- Add CloudFormation only through the deterministic target interface after
  Terraform stability.

## Alternatives considered

### Multi-cloud MVP

Rejected because it would spread effort across incompatible semantics before the
graph and compiler contracts are proven.

### AWS-specific core

Rejected because future providers would require replacing project, graph,
validation, and revision logic rather than adding extensions.

### Lowest-common-denominator resource model

Rejected because it would misrepresent provider behavior and prevent accurate
validation and IaC.

### Broad catalog with partial compilation

Rejected because visible but incomplete service support would create unsafe
expectations and inconsistent exports.

## References

- [Product Specification](../product/PRODUCT_SPEC.md)
- [MVP Scope](../product/MVP_SCOPE.md)
- [Domain Model](../architecture/DOMAIN_MODEL.md)
- [Build Sequence](../PUBLIC_STATUS.md)
