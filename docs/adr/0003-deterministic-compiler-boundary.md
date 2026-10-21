# ADR-0003: Deterministic compiler boundary

- **Status:** Accepted
- **Date:** 2026-07-23
- **Owners:** CloudCanvas engineering
- **Supersedes:** None
- **Superseded by:** None

## Context

Generated IaC is security-sensitive executable configuration. Model-authored
text, mutable drafts, implicit catalog updates, unstable identifiers, and
environment-dependent formatting would make output difficult to review or
reproduce. Embedding rendering inside the product domain would also couple graph
semantics to Terraform and complicate future targets.

CloudCanvas must produce production-quality Terraform while ensuring that AI
cannot compile or execute infrastructure and that generated artifacts can be
tied to exact immutable inputs.

## Decision

Create a standalone Go compiler that consumes only a closed, versioned
immutable-revision contract and curated provider-catalog semantics. Use
HashiCorp HCL libraries to construct Terraform output.

Compilation is deterministic:

- exact graph content, graph-schema version, provider-catalog version, compiler
  version, and target-format version are inputs;
- stable graph IDs determine stable Terraform address inputs;
- file names, traversal, serialization, diagnostics, and manifests have
  deterministic ordering;
- incidental timestamps, randomness, UI coordinates, machine paths, and model
  behavior cannot affect normalized output; and
- identical inputs produce byte-identical normalized artifacts.

The compiler validates compatibility and fails closed on unknown versions,
unsupported elements, invalid references, or forbidden constructs. It has no
model access, customer credentials, deployment permission, database ownership,
or direct user-defined execution surface.

Formatting and static validation occur after compilation in a separate isolated
runner. Compiler success does not imply deployment or cloud-account validation.

## Consequences

### Positive

- Output can be reproduced, diffed, cached, audited, and verified with golden
  fixtures.
- The graph remains independent of Terraform syntax.
- Model nondeterminism cannot enter compilation.
- The process boundary supports strict resource limits and least privilege.
- Later IaC targets can use the same immutable revision contract without
  becoming graph authorities.

### Negative

- TypeScript and Go contracts must remain version-compatible.
- Catalog/compiler compatibility and deterministic migrations require
  disciplined releases.
- Golden output changes can be noisy and require semantic review.
- Some Terraform validation normally expects provider packages, creating a
  separate sandbox design problem.

### Follow-up

- Define canonical contract encoding and compatibility fixtures in M1.
- Specify Terraform and AWS provider version policy before M6.
- Build repeated-process reproducibility and forbidden-construct tests in M6.
- Resolve the isolated provider/toolchain model before M7.

## Alternatives considered

### Ask the model to generate Terraform

Rejected because model output is nondeterministic, difficult to constrain
completely, and incompatible with the required trust boundary.

### Compile mutable drafts

Rejected because the graph could change during work and results could not be
tied to a reviewable snapshot.

### Render Terraform inside the TypeScript domain

Rejected because it would violate domain independence and bind semantic logic to
one output target. A TypeScript adapter could have been deterministic, but the
explicit Go boundary and HCL libraries better isolate compiler responsibility.

### Templates with string interpolation

Rejected as the primary approach because escaping, ordering, optional structure,
and injection safety are easier to reason about through structured HCL
construction.

## References

- [ADR-0001](0001-versioned-architecture-graph.md)
- [System Overview](../architecture/SYSTEM_OVERVIEW.md)
- [Security Principles](../architecture/SECURITY_PRINCIPLES.md)
- [Testing Strategy](../architecture/TESTING_STRATEGY.md)
