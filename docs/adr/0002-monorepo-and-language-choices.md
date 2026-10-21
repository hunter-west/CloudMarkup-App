# ADR-0002: Monorepo and primary language choices

- **Status:** Accepted
- **Date:** 2026-07-23
- **Owners:** CloudCanvas engineering
- **Supersedes:** None
- **Superseded by:** None

## Context

CloudCanvas needs a web application, API, domain packages, provider catalogs,
schema-driven forms, AWS platform infrastructure, and a deterministic Terraform
compiler. Many contracts cross UI, server, catalog, and compiler boundaries. The
initial team and expected scale favor simple ownership and coordinated changes
over independently operated services.

TypeScript aligns with React, runtime schemas, API code, and AWS CDK. Terraform
generation benefits from Go and HashiCorp's native HCL libraries.

## Decision

Use one monorepo with pnpm workspaces and Turborepo.

Use strict TypeScript for the web application, domain and application packages,
modular-monolith API, adapters, tooling, and AWS CDK v2 platform infrastructure.

Use a standalone Go module for the IaC compiler and HashiCorp HCL libraries for
Terraform generation.

The TypeScript domain remains dependency-inward and cannot import React, AWS SDK
clients, databases, network clients, or IaC renderers. The TypeScript/Go
boundary uses a versioned machine-readable contract and shared fixtures rather
than source-level coupling.

The API begins as a modular monolith on Lambda behind API Gateway HTTP API, with
a lightweight router such as Hono. Logical modules may be separated later only
with operational evidence and a new ADR.

This ADR selects the ecosystem and repository shape. It does not fix exact
folder names, every library, CI provider, deployment topology, or package graph;
those details belong to milestone plans unless they become durable decisions.

## Consequences

### Positive

- Atomic changes can update graph schemas, UI, API, fixtures, and compiler
  contracts together.
- Most product code shares strict TypeScript types and tooling.
- Turborepo can coordinate cached tasks without hiding package boundaries.
- Go provides mature structured HCL generation and an independently testable
  compiler process.
- A modular monolith avoids premature distributed-system cost.

### Negative

- The repository must support two language toolchains.
- Structural dependency rules are needed to prevent the monorepo from becoming a
  coupled monolith.
- Cross-language schemas and fixtures require generation-consistency and
  compatibility checks.
- CI caching and change detection need care so affected tests are not skipped.

### Follow-up

- Define package ownership and enforceable dependency direction in the M1 plan.
- Pin Node.js, pnpm, Go, and generation tool versions when implementation
  starts.
- Add contract generation drift checks and shared fixtures.
- Revisit service extraction only when scaling, isolation, release cadence, or
  ownership evidence justifies it.

## Alternatives considered

### TypeScript only, including Terraform generation

Rejected for the first production compiler because Go's HCL ecosystem provides a
stronger structured generation boundary and makes compiler independence
explicit.

### Multiple repositories

Rejected initially because graph, catalog, UI, and compiler contracts will
co-evolve rapidly and need atomic review. This may be reconsidered if ownership
and release independence later outweigh coordination costs.

### Microservices from the start

Rejected because initial scale and team context do not justify distributed
transactions, deployments, tracing, and local-development complexity.

### Go for the entire backend

Rejected because it would split more application-domain and runtime-schema work
from the TypeScript web ecosystem without a demonstrated benefit.

## References

- [System Overview](../architecture/SYSTEM_OVERVIEW.md)
- [Testing Strategy](../architecture/TESTING_STRATEGY.md)
- [Build Sequence](../PUBLIC_STATUS.md)
