# Dependency policy

Dependencies increase supply-chain, compatibility, maintenance, and runtime
risk. Add one only when repository code or an existing dependency cannot meet a
current milestone requirement clearly.

## Adding or changing dependencies

- Explain the concrete need, owning package, alternatives considered, runtime
  surface, license/support posture, and security impact in the change or plan.
- Prefer maintained, narrowly scoped libraries with compatible peer/toolchain
  ranges. Do not add speculative frameworks, duplicate utilities, or an
  abstraction used by only hypothetical future work.
- Pin JavaScript versions in the workspace catalog and commit the `pnpm`
  lockfile. Declare a dependency in every package that imports it.
- Keep install scripts denied by default. Add an `allowBuilds` entry only after
  reviewing why installation must execute code.
- Run a frozen install, applicable tests/builds, and `pnpm security:check`.
  Review lockfile changes and remove unused direct dependencies.

## Workspace boundaries

- Import workspace packages by name through declared `exports`; no deep or
  source-relative cross-package imports.
- Foundational packages cannot depend on apps or infrastructure adapters.
- `packages/domain` remains free of UI, web framework, cloud SDK, persistence,
  network, model, and IaC dependencies.
- Provider implementations depend on provider-neutral public contracts, never
  the reverse.

`packages/provider-aws` is the authorized M1 production-oriented catalog
adapter. Its scoped `AGENTS.md` requires catalog versioning, exact artifact
drift checks, curated-support evidence before support claims, no AWS SDK clients
in semantic catalog code, and no reverse dependency from the domain. Provider
asset subpaths remain separately reviewed release inputs rather than catalog or
domain truth.

## Go and infrastructure

- Prefer the Go standard library in the compiler. Commit `go.mod`/`go.sum`
  changes together and run formatting, vet, tests, golden/reproducibility
  evidence, and vulnerability review when Go dependencies appear.
- AWS CDK dependencies stay in `infra/platform`; AWS-first adapter choices must
  not leak into provider-neutral packages.
- A dependency may not introduce deployment, customer credentials, arbitrary
  provider/module/plugin execution, or runtime network access in the compiler.

Durable changes to language, framework, provider, or dependency direction need
an ADR; routine version updates do not.
