# ADR-0030: Node.js 24 and TypeScript for the initial Lambda starter runtime

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- Status: Accepted
- Date: 2026-08-17
- Deciders: Cloud Markup product owner and engineering
- Supersedes: None
- Superseded by: None

## Context

Prompt 29A requires one maintainable, strongly typed initial runtime/language
family for deterministic authenticated-notes Lambda starter source. The choice
must agree with the exact curated provider catalog, existing repository
toolchains, canonical Workload Behavior and Application Contracts, the
source-free Go IaC compiler boundary, and the future isolated Prompt 32A build
service.

The current AWS catalog permits only the Lambda runtime `nodejs24.x` and
requires Workload Behavior runtime family `aws.lambda.runtime-family.nodejs24`
with the exact configured handler. The monorepo already pins Node.js 24, pnpm
11, strict TypeScript 6, Vitest, and established TypeScript contract/schema
practices. Go is deliberately owned by deterministic IaC compilation; using it
as the first generated application runtime would introduce a second application
toolchain without a repository or catalog constraint requiring one.

The runtime decision is durable because it controls generated source syntax,
dependency/build contracts, handler layout, tests, extension points, and
artifact compatibility. It must not make runtime-specific source structures an
Architecture, Workload, provider-neutral domain, or Terraform authority.

## Decision

The initial deterministic Lambda starter family is:

- AWS Lambda `nodejs24.x`;
- strict TypeScript `6.0.3` source;
- ECMAScript modules compiled for Node.js 24;
- ZIP artifact delivery through Prompt 29's existing package contract;
- stable Lambda handler `index.handler`, built from deployment-key-addressed
  source entrypoints; and
- pinned AWS SDK for JavaScript v3 dependencies declared as data in the
  versioned Prompt 32A build contract.

The deterministic generator itself is a separate TypeScript workspace package.
It consumes only strict versioned input data: one immutable Solution Revision,
canonical Architecture Document v3 and Workload Behavior v2, Application
Contracts v1, compiler normalized-model v1, exact catalog metadata, and pinned
generator/template descriptors. It emits source, ownership/diff metadata,
diagnostics, coverage assessment, and a content-addressed manifest. It cannot
execute generated source, package managers, TypeScript, tests, AWS SDK clients,
Terraform, repository writes, models, networks, credentials, or deployment.

Runtime-specific emitters operate over one provider-neutral, normalized
application-generation intermediate contract. A later runtime is added by:

1. accepting a new ADR or other required durable runtime decision;
2. adding an exact runtime/template descriptor with ID, semantic version,
   digest, handler/artifact rules, and supported behavior matrix;
3. implementing a source emitter and Prompt 32A build adapter for that runtime;
4. adding golden, compatibility, negative, reproducibility, ownership, and
   security evidence; and
5. extending only the generator/runtime registry and provider compatibility
   data.

A later runtime cannot duplicate or reinterpret Architecture nodes, Workload
operations, Application Contracts, typed edge meaning, generation coverage, or
repository ownership. Those remain shared inputs. No runtime may infer event
shape or business logic from labels, provider service names, or source scans.

## Consequences

### Positive

- The first starter family exactly matches the only reviewed Lambda runtime and
  the repository's maintained TypeScript ecosystem.
- Canonical API/data/auth contracts can produce strongly typed bindings and
  deterministic request validation without a parallel DTO authority.
- Generated source and future build execution remain separate from Terraform and
  the Go compiler's dependencies and permissions.
- Adding another language requires evidence but does not require a new
  Architecture or Workload semantic model.

### Negative

- The initial generator does not support Python, Java, .NET, Go, Rust,
  container-image Lambdas, CommonJS, Lambda layers, or arbitrary handlers.
- Prompt 32A must later own a pinned TypeScript/AWS SDK dependency
  materialization and packaging policy before any ZIP is built.
- TypeScript source completeness does not prove build, test, security,
  provider-Region, plan, or deployment readiness.

## Alternatives considered

### JavaScript without TypeScript

Rejected because it would discard compile-time contract fidelity and diverge
from the repository's strict TypeScript practices without reducing the required
runtime or packaging surface materially.

### Go application starters

Rejected for the initial family because the catalog is pinned to Node.js 24 and
the existing Go module is an intentionally source-free IaC compiler. A Go
application runtime remains possible through a later exact runtime adapter and
build contract.

### Python application starters

Rejected for the initial family because no Python Lambda runtime/template or
repository dependency policy is reviewed, while Node.js 24 is already exact
catalog truth. Python may be added later through the same runtime-adapter rules.

### Multiple initial runtimes

Rejected because it would multiply template, dependency, build, security,
golden, and support claims before one complete deterministic pattern is proven.

## Compatibility, security, and rollback

Only exact generator, template, runtime, language, handler, pattern, catalog,
and contract versions are accepted. Unknown or mismatched values fail closed.
Generated files use bounded repository-relative paths derived from compiler
deployment keys, never display labels or machine paths. Secret values and
credentials are prohibited; environment configuration remains typed references.
Source never determines IAM.

No persisted Architecture, Workload, database, object, or Terraform migration is
required. Existing revisions without the exact generator/template pins remain
valid but are not generation-compatible. Before release, rollback can remove the
new generator/runtime registration and generated artifacts without changing
Prompt 29 Terraform or immutable source documents.

## References

- [ADR-0002](0002-monorepo-and-language-choices.md)
- [ADR-0003](0003-deterministic-compiler-boundary.md)
- [ADR-0017](0017-versioned-workload-behavior-and-build-boundaries.md)
- [ADR-0025](0025-canonical-solution-repository-and-evidence-contracts.md)
- [ADR-0029](0029-deterministic-terraform-and-application-artifact-boundary.md)
- [Compiler normalization](../architecture/COMPILER_NORMALIZATION.md)
- [Deterministic Terraform generation](../architecture/TERRAFORM_GENERATION.md)
- [Security principles](../architecture/SECURITY_PRINCIPLES.md)
- [Testing strategy](../architecture/TESTING_STRATEGY.md)
- Execution plan
