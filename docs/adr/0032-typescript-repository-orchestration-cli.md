# ADR-0032: Thin TypeScript repository orchestration CLI over closed tool boundaries

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Accepted
- **Date:** 2026-08-19
- **Owners:** Cloud Markup engineering
- **Supersedes:** None
- **Refines:** ADR-0002, ADR-0003, ADR-0005, ADR-0025, ADR-0029, and ADR-0031
- **Superseded by:** None

## Context

Cloud Markup needs one architecture-as-code command line that can validate an
immutable Solution Revision and its repository lock, regenerate all reviewed
outputs, detect drift, report semantic changes, render diagrams, invoke the
approved local verification pipeline, and summarize Evidence. The existing Go
`cloudmarkup-iac` executable has a deliberately closed responsibility: parse,
validate, normalize, and compile immutable inputs into deterministic Terraform.
Application generation/build, Terraform static validation, diagram rendering,
export assembly, ownership, repository contracts, and Evidence are established
TypeScript boundaries.

Adding orchestration to Go would require manually synchronized copies of those
contracts and implementations or a growing cross-language protocol for every
stage. Reimplementing compilation in TypeScript would violate the accepted
compiler boundary. A CLI that invokes package-manager scripts or
repository-selected commands would make pull-request content executable and
would weaken the no-credential verification threat model.

## Decision

Create a thin TypeScript `cloudmarkup` repository-orchestration CLI. It owns
only:

- strict versioned CLI request/result and semantic-snapshot contracts;
- bounded, portable, link-safe repository reads and ownership-aware writes;
- stable command/exit-code and human/JSON presentation;
- isolated regeneration comparison and deterministic semantic fact diff; and
- composition through narrow injected ports for validation, generation,
  rendering, application/Terraform tests, and Evidence retrieval.

The CLI does not implement provider semantics or artifact production. Its
production pipeline adapter delegates to the existing Solution Revision export
workflow and its application generator, build runner, Terraform validator,
diagram renderer, and exporter ports. Infrastructure compilation crosses the
existing fixed `cloudmarkup-iac` executable boundary using an executable plus a
constant argument array and canonical named input files; no shell is involved.

The public executable name follows the accepted Cloud Markup identity.
Historical `cloudcanvas` names are not compatibility aliases. Repository source
and output paths remain the existing versioned `cloudmarkup/`, `application/`,
`infrastructure/`, `diagram/`, `evidence/`, and `.github/workflows/` package
layout.

Read-only commands never mutate the checkout. `verify` materializes regenerated
bytes into one bounded digest-named temporary directory outside the repository,
compares exact and semantic digests, then removes it. `generate` is the only
mutating command and may replace only manifest-declared generated content whose
baseline matches. It never silently overwrites user-owned, approved-extension,
or ambiguous content.

The no-credential workflow invokes this CLI only with a reviewed profile. It
does not run repository-selected scripts or arbitrary binaries, grant write
permissions, use secrets, plan/apply, or deploy. External actions are pinned to
full commit SHAs.

## Consequences

### Positive

- Each existing implementation remains the single authority for its contract.
- The command surface can evolve with TypeScript orchestration contracts while
  the Go compiler stays small, deterministic, and independently testable.
- Repository drift, ownership conflicts, and semantic changes share one
  machine-readable vocabulary locally and in pull-request verification.
- No-cloud validation can be exercised without importing UI state or gaining
  deployment authority.

### Negative

- A complete CLI distribution must package both the Node runtime and the pinned
  Go compiler executable and must provide approved offline executor profiles for
  build/Terraform tests.
- Cross-language compatibility still requires exact compiler result schemas and
  version pins.
- The CLI adds another public compatibility surface and must preserve exit-code,
  JSON, repository-layout, and lock semantics.

## Alternatives considered

### Expand the Go compiler CLI into the repository orchestrator

Rejected because Go would need to duplicate or proxy the TypeScript generator,
runner, diagram, export, ownership, and Evidence contracts. It would also blur
the closed compiler boundary.

### Reimplement Terraform compilation in TypeScript

Rejected because ADR-0003 assigns deterministic Terraform construction to the
standalone Go compiler and its reviewed HCL libraries.

### Drive package.json scripts or a shell

Rejected because pull-request content could alter executable commands,
arguments, or lifecycle behavior. The approved workflow may call the CLI, but
the CLI may invoke only typed ports and fixed executable/argument boundaries.

### Verify only committed checksums without regeneration

Rejected because a stale lock and generated tree could agree with each other.
`verify` must regenerate from the immutable source and approved tool pins in an
isolated location before comparison.

## Compatibility, security, and rollback

Contracts are additive, strict, bounded, canonically serialized, and reject
future versions. Disabling or removing the CLI/workflow does not mutate existing
Solution Revisions or artifacts. No database migration is involved. Rollback is
removal of the additive package/workflow after preserving any generated Evidence
needed for review.

Repository paths and bytes are untrusted. The CLI rejects
absolute/traversal/backslash/ambiguous paths, links, non-regular files,
oversized content, duplicate portable names, lock/pin mismatches, and ownership
conflicts. Diagnostics and workflow summaries contain stable codes and safe
references, not raw tool logs, credentials, prompts, tokens, or machine paths.
No command has plan, apply, upload, merge, cloud credential, customer-role, or
deployment authority.

## References

- [ADR-0002: Monorepo and language choices](0002-monorepo-and-language-choices.md)
- [ADR-0003: Deterministic compiler boundary](0003-deterministic-compiler-boundary.md)
- [ADR-0005: Export without deployment](0005-export-without-deploy.md)
- [ADR-0025: Canonical solution, repository, and Evidence contracts](0025-canonical-solution-repository-and-evidence-contracts.md)
- [ADR-0031: Immutable Solution Revision export orchestration](0031-immutable-solution-export-orchestration.md)
- Prompt 33B execution plan
