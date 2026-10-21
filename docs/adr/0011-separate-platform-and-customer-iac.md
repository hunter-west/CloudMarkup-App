# ADR-0011: Separate Platform and Customer IaC Systems

- Status: Accepted
- Date: 2026-07-24
- Owners: CloudCanvas product and engineering
- Supersedes: None

## Context

CloudCanvas has two fundamentally different infrastructure concerns. The team
needs infrastructure code to operate the CloudCanvas service, while the product
compiler generates customer-owned IaC artifacts from Architecture Documents.
Combining them would blur trust, deployment, language, artifact, and
reproducibility boundaries.

## Decision

The two IaC systems remain strictly separate:

- `infra/platform` contains AWS CDK v2 in TypeScript for CloudCanvas platform
  infrastructure and synthesizes CloudFormation for operator-controlled
  deployment.
- `services/iac-compiler` contains the deterministic Go compiler that produces
  customer IaC artifacts from immutable, version-bound Architecture Documents.

They use separate folders, dependencies, tests, permissions, artifacts,
documentation, and deployment paths. The customer compiler cannot import,
invoke, or deploy the platform CDK. The compiler remains offline and
credential-free, and product runtime paths do not deploy customer
infrastructure.

Platform CDK ownership is organized by capability and deployment lifecycle, not
one file or stack per cloud resource. Its logical areas are stateful services,
application/API/workers, edge/web delivery, sandbox isolation, observability,
and typed environment configuration.

## Consequences

### Positive

- Operator platform deployment cannot be confused with customer artifact
  generation.
- Each IaC system has a language and test strategy suited to its purpose.
- Credentials and release permissions can remain narrowly scoped.

### Negative

- Some infrastructure concepts need parallel documentation in two contexts.
- CI and release workflows must make the boundary visible.
- Shared cloud knowledge cannot become shared executable deployment code.

### Follow-up

- Define platform stack boundaries from dependency and lifecycle evidence.
- Add CI checks that prevent cross-imports and artifact mixing.
- Document operator deployment separately from customer export workflows.

## Alternatives Considered

- Use the platform CDK as the customer compiler. Rejected because it would
  couple product semantics to platform deployment code and TypeScript execution.
- Put both systems in one package. Rejected because ownership, permissions, and
  artifacts would be ambiguous.
- Let the product deploy compiler output. Rejected by the export-without-deploy
  boundary.

## References

- [ADR-0002](0002-monorepo-and-language-choices.md)
- [ADR-0003](0003-deterministic-compiler-boundary.md)
- [ADR-0005](0005-export-without-deploy.md)
- [System Overview](../architecture/SYSTEM_OVERVIEW.md)
