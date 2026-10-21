# Cloud Markup architecture CLI

`@cloudmarkup/architecture-cli` is the provider-neutral, credential-free
repository orchestration boundary for one immutable Cloud Markup Solution
Revision. It does not compile, generate, build, validate Terraform, render
diagrams, or create Evidence itself. An exact versioned pipeline registration
delegates those stages to the existing reviewed implementations.

## Commands

```text
cloudmarkup validate [--root <repository>] [--format human|json]
cloudmarkup generate [--root <repository>] [--format human|json]
cloudmarkup verify   [--root <repository>] [--format human|json]
cloudmarkup diff     [--root <repository>] [--format human|json]
cloudmarkup render   [--root <repository>] [--format human|json]
cloudmarkup test     [--root <repository>] [--format human|json]
cloudmarkup evidence [--root <repository>] [--format human|json]
cloudmarkup import --source <repository> [--format human|json]
cloudmarkup inspect-repository --source <repository> [--format human|json]
cloudmarkup compare --source <repository> [--format human|json]
cloudmarkup verify-repository --source <repository> [--format human|json]
```

- `validate`, `verify`, `diff`, and `evidence` are repository read-only.
  `verify` regenerates into a scoped temporary directory and removes it in
  `finally`.
- `generate` applies a complete verified package only to manifest-owned,
  generated-replaceable paths whose current checksum matches the reviewed
  baseline.
- `render` may update `diagram/` plus the package manifest only. It fails closed
  if the same render result changes any other output.
- `test` delegates to the existing no-credential application-build and Terraform
  static-validation boundaries. It does not run arbitrary repository scripts.
- JSON output is canonical and human output is stable. Output, diagnostics,
  files, bytes, paths, diff entries, and Evidence summaries are bounded.
- The four repository-import commands are read-only. They delegate to one
  explicitly registered @cloudmarkup/repository-importer port bound to the
  locked Architecture and Solution Revision. A missing or mismatched importer
  fails closed; no repository source can select an executable or parser.

Exit codes are stable: `0` success, `2` usage, `3` invalid repository/revision,
`4` generated drift, `5` ownership/conflict, `6` pipeline failure, and `7`
internal/output limit.

## Locked pipeline distributions

`.cloudmarkup-cli.json` pins the CLI and exactly one pipeline ID, version, and
digest. A distribution registers implementations with
`createArchitectureCliPipelineRegistry`; exact ID/version/digest selection is
required and duplicate registrations fail closed. Repository content cannot
select a module, executable, command, container, or policy.

The private source-tree binary intentionally contains no implicit registration.
Running it against a profile that the distribution did not review returns
`cloudmarkup.cli.pipeline-profile-unavailable` and no fabricated Evidence. A
releasable distribution must register its reviewed compiler adapter,
build/validation policies and preloaded image coordinates, diagram renderer/icon
set, exporter, and Evidence store at build time. The repository currently has no
published, reviewed local build or Terraform-validation image, so this source
checkout does not pretend those policies are operational.

Programmatic composition is explicit:

```ts
const exitCode = await runArchitectureCliExecutable({
  args: ["verify", "--root", repositoryRoot, "--format", "json"],
  registrations: [approvedPipelineRegistration],
  stderr: process.stderr,
  stdout: process.stdout,
});
```

## Repository and workflow

The package accepts only canonical `.cloudmarkup-cli.json`,
`cloudmarkup/cloudmarkup.lock.json`, `cloudmarkup/cloudmarkup.manifest.json`,
and `cloudmarkup/solution.json` bindings. It reconstructs Architecture v3 from
the manifest-bound `cloudmarkup/architecture.json`, `workloads.json`,
external-resource document, and application-contract document. Every manifest
file is a regular non-link file with matching size, byte checksum, semantic
checksum, ownership, and portable path. Unmanifested generated output fails
validation.

[`templates/cloudmarkup-validate.yml`](templates/cloudmarkup-validate.yml) is
the reviewed pull-request/trusted-push template. It uses read-only permissions,
no secrets or cloud credentials, full-SHA action pins, frozen dependency
installation with scripts disabled, fixed bounded CLI commands, and a seven-day
non-sensitive Evidence artifact. The template requires a lockfile-declared CLI
distribution containing the exact approved pipeline registration; the
unregistered private source binary fails closed.

See
[Architecture-as-code CLI and repository verification](../../docs/architecture/ARCHITECTURE_AS_CODE_CLI.md)
for contracts, ownership rules, semantic diff coverage, security controls, and
exact development commands.
