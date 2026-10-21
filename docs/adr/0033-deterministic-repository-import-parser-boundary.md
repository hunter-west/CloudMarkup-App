# ADR-0033: Deterministic repository importer with a data-only HCL boundary

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Accepted
- **Date:** 2026-08-19
- **Owners:** Cloud Markup engineering
- **Supersedes:** None
- **Refines:** ADR-0002, ADR-0003, ADR-0025, and ADR-0032
- **Superseded by:** None

## Context

Cloud Markup must compare an immutable approved Solution Revision with files in
a local repository before any AI assistance. The source set includes Cloud
Markup documents, Terraform HCL and JSON, sanitized Terraform show JSON,
CloudFormation templates and CDK-synthesized templates, generated application
manifests, and pull-request workflow structure. Import is observation, not
design mutation or proof of deployed state.

The TypeScript contracts already own Repository Snapshot, Observed Solution,
External Resource, Reconciliation Proposal, Active Issue, Evidence, ownership,
CLI, and UI projections. HashiCorp HCL parsing already exists in the closed Go
compiler boundary. Reimplementing HCL in TypeScript would introduce a second
grammar and inconsistent expression behavior. Invoking Terraform or repository
code would add execution and credential authority that import does not need.

## Decision

Create a pure TypeScript `@cloudmarkup/repository-importer` package. It owns
bounded local-file selection, content hashing, safe JSON/YAML reduction,
catalog-driven mapping, redaction, conformance comparison, and strict output
construction. Provider resource identity comes only from the supplied versioned
catalog's Terraform and CloudFormation mapping declarations.

Extend `cloudmarkup-iac` with one fixed data-only `inspect-terraform-hcl`
command. It accepts source bytes over stdin and returns only block and attribute
ranges, expression categories, complete expression digests, and safe traversal
references. It never returns expression literals. The TypeScript adapter invokes
an injected approved executable with a constant argument array and bounded
stdin/stdout; repository content cannot select an executable or arguments, and
no shell is used.

Import results have `designAuthority: none` and
`reviewed-reconciliation-required` mutation policy. Exact Cloud Markup source
may produce reviewed Graph Command batches, but no proposal applies itself.
Terraform, CloudFormation, workflow, manifest, or ambiguous facts remain
observed-only until an explicit reviewed mapping or domain operation accepts
them.

## Consequences

### Positive

- One HCL implementation serves compilation and import without executing
  Terraform.
- Provider mappings, canonical domain operations, ownership, and Evidence stay
  behind their existing authoritative contracts.
- Plan/state secrets can be reduced to redacted facts before ordinary results
  are constructed.
- CLI and UI consume one deterministic comparison vocabulary without receiving
  design mutation authority.

### Negative

- A distributable importer must package and pin both the Node service and the
  matching Go HCL inspector.
- HCL expression evaluation, imperative CDK source, arbitrary framework
  behavior, and resources without exact catalog mappings remain unresolved.
- Repository conformance cannot establish deployed-state or cloud-plan Evidence.

## Alternatives considered

### Execute Terraform or CDK during import

Rejected because import must work without credentials, network, provider
downloads, repository scripts, package-manager lifecycle hooks, or arbitrary
code execution.

### Implement another HCL parser in TypeScript

Rejected because it duplicates syntax and expression semantics already owned by
the Go compiler boundary.

### Treat imported files as approved design

Rejected because repository observation is untrusted and can differ from the
immutable Solution Revision. Reconciliation must remain explicit and reviewed.

## Compatibility, security, and rollback

The package and command are additive version-1 boundaries. Unknown future
versions fail closed. Removing them leaves existing source, Solution Revisions,
generated artifacts, and Evidence unchanged. The scanner rejects links,
non-regular files, traversal, absolute/backslash/device/ADS paths, portable-name
collisions, binary surprises, invalid UTF-8, and configured file/count/byte
limits. Diagnostics are stable safe summaries. Raw state values, literals,
secrets, tokens, local paths, upstream stderr, and commands are not emitted.

## References

- [ADR-0003: Deterministic compiler boundary](0003-deterministic-compiler-boundary.md)
- [ADR-0025: Canonical solution, repository, and Evidence contracts](0025-canonical-solution-repository-and-evidence-contracts.md)
- [ADR-0032: TypeScript repository orchestration CLI](0032-typescript-repository-orchestration-cli.md)
- [Local repository import and conformance](../architecture/LOCAL_REPOSITORY_IMPORT_AND_CONFORMANCE.md)
- Prompt 33C execution plan
