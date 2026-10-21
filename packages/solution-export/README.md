# Deterministic solution export

`@cloudmarkup/solution-export` is the pure local export boundary that assembles
one exact immutable Solution Revision's canonical source projections, generated
Terraform, supported application source, contracts, placeholders,
ownership/provenance manifest, and references into a verified file tree and
deterministic ZIP.

The service accepts already-produced compiler and optional application
generation artifacts as data. It verifies their content addresses and revision
bindings but never invokes either producer. It returns a blocked result for
unsafe paths, duplicate/case-colliding paths, content or manifest corruption,
limits, prohibited output, or any destination ownership conflict.

ZIP entries are regular files only, canonically ordered, stored without
compression, assigned a fixed 1980 epoch and fixed permissions, and emitted
without comments or extra fields. The export manifest intentionally excludes its
own checksum; an outer manifest digest and ZIP digest avoid a self-hash cycle.

This package does not write repositories, read local files, execute Terraform or
generated source, install dependencies, build Lambda artifacts, fetch external
artifacts, use credentials/network/cloud/model services, upload, deploy, or
create Evidence.

Verified application-build output crosses this boundary only through
`applicationBuildSupplementalFiles`. The adapter independently validates the
application-build result's report digest and artifact bytes/checksums, accepts
only a passing deterministic-builder Evidence record, and preserves ZIP/SBOM
bytes as `generated-build-artifact` plus the canonical Evidence JSON as
`evidence-artifact`. It never invokes the runner, upgrades failed coverage, or
changes ownership. See
[isolated application build execution](../../docs/architecture/APPLICATION_BUILD_EXECUTION.md).

```powershell
pnpm check:solution-export
```

## Orchestration handoff

`@cloudmarkup/solution-export-workflow` invokes this pure service through an
injected packager port only after compilation, any required application build,
and Terraform static validation have produced exact typed results. The workflow
then calls `verifySolutionExportArtifact` independently before a storage adapter
may publish the ZIP. An optional strict `externalStageStatus` carries only
pre-export build and Terraform-validation truth. It is bound to the selected
environment, target settings digest, workflow request digest, report digests,
and full canonical Evidence-record digests. Every claim must resolve to exactly
one matching revision/environment-bound `evidence-artifact` supplemental file.
The manifest and generated status JSON label these stages
`passed-before-export`; the exporter's own `not-run-by-export` and
`not-collected-by-export` states remain unchanged because this package does not
execute tools or create Evidence.

A blocking producer, build/test, validation, packaging, integrity, or ownership
failure produces no final archive and no download eligibility. Infrastructure-
only success remains valid with an application-code-required warning. The
orchestrator and storage adapters do not move execution, authorization, upload,
or deployment authority into this package.
