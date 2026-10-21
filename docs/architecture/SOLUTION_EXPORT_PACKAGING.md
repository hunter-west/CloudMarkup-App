# Deterministic solution export packaging

Status: Prompt 31 local service plus Prompt 32A build artifacts, Prompt 33
external-stage truth, and Prompt 33A deterministic diagrams are implemented;
persistence, upload, repository materialization, and deployment remain outside.

## Boundary

`@cloudmarkup/solution-export` is a pure, synchronous local service. It accepts
an immutable Architecture v3 document, Solution Revision v1, a digest-bound
Terraform or CloudFormation artifact projection, an optional validated
Application Generation Result v1, approved target settings, bounded supplemental
regular files, and an optional verified Diagram Export Artifact v1 plus an
optional inventory of existing destination paths. It returns either:

- a verified file tree, strict manifest, ownership metadata, deterministic ZIP
  bytes, and exact manifest/ZIP digests; or
- fail-closed diagnostics and destination conflicts, with no partial archive.

The service does not read or write a repository. Workers may call the same
interface later, but persistence and transport must remain adapters outside the
package.

## File tree

The tree has fixed roots and purpose:

- `cloudmarkup/` contains the canonical Solution Revision, normalized
  architecture, Workload, external-resource, Application Contract, provenance,
  artifact, coverage, lock, validation-placeholder, and evidence-placeholder
  documents;
- `infrastructure/` contains the selected generated IaC target and its generated
  README; CloudFormation additionally contains deterministic `template.json` and
  `parameters.example.json` files;
- `application/` contains supported generated application source, its generator
  manifest, per-workload final ZIP/artifact manifest/SBOM/Evidence, and bounded
  declarative smoke-test specifications; user-owned extension scopes may be
  declared without fabricating bytes;
- `diagram/` contains the verified generated `architecture.svg`,
  `architecture.png`, and diagram README; `evidence/` accepts separately
  supplied bounded artifacts with exact ownership and provenance;
- `README.md` is generated from sanitized display data and states the
  no-validation/no-build/no-deploy boundary and embeds the diagram through the
  GitHub-compatible relative path `diagram/architecture.svg`.

The manifest excludes itself from `files` to avoid a self-hash cycle. Its exact
canonical bytes are bound by the returned `manifestDigest`; every file,
including the manifest, is then bound by `zipDigest`. The manifest records the
Solution Revision digest, Architecture/Workload/contract/external hashes,
compiler infrastructure artifact digest, application artifact digest when
present, catalog/compiler/generator/renderer/policy pins, target/provider
constraints, immutable and required artifact references, generation coverage,
validation and Evidence placeholders, warnings, resource/policy/contract
provenance, per-path ownership, exact checksums, semantic checksums, media type,
and size.

## Ownership and conflicts

Ownership is exact per path:

| Ownership                     | Meaning                                  | Replacement rule                                                      |
| ----------------------------- | ---------------------------------------- | --------------------------------------------------------------------- |
| `architecture-as-code-source` | Canonical Cloud Markup source projection | Never replaced by destination materialization                         |
| `generated-replaceable`       | Deterministic source or metadata         | Only when the existing generated baseline equals its current checksum |
| `user-owned-extension`        | User or AI extension boundary            | Preserve; conflicting bytes block                                     |
| `user-provided`               | Caller-supplied source or reference      | Preserve; conflicting bytes block                                     |
| `generated-build-artifact`    | Separately produced build output         | Fail closed; Prompt 31 never builds it                                |
| `evidence-artifact`           | Separately produced Evidence bytes       | Fail closed; Prompt 31 never upgrades Evidence status                 |

An identical existing checksum is unchanged. A modified generated file, a
user-owned file, a non-regular destination, a case/normalization collision, or
ambiguous ownership blocks the entire export. Unrelated existing paths are not
read, copied, removed, or claimed.

## Security and limits

Every input is schema-validated and every candidate is screened before archive
creation. The service rejects absolute and platform-specific paths, `..`, empty
segments, backslashes, alternate data streams, device names, non-NFC names,
case-insensitive duplicates, symlinks, device files, directories, unapproved
roots, mismatched media types, caches, `node_modules`, coverage, Terraform
state/plans, environment files, and other forbidden outputs.

Text screening rejects private keys, access keys, common token forms, bearer
tokens, assigned secret values, signed URLs, local machine paths, `file://`
URLs, raw prompt markers, and internal debug/trace logs. Configured limits bound
UTF-8 path bytes, file count, individual bytes, total decompressed bytes, and
archive bytes, below hard contract maxima.

The ZIP uses store mode, UTF-8 paths, UTF-16 code-unit ordering, regular-file
mode `0644`, the DOS 1980 epoch, and no comments or extra fields. The
independent reader verifies header parity, CRCs, regular metadata, safe paths,
uniqueness, ordering, bounds, and exact bytes. Verification also reconstructs
the archive and requires byte equality.

## Prompt 32A build-artifact adapter

Prompt 31 still never builds source. Its data-only adapter accepts either one
schema- and digest-verified passing Prompt 32A result or the canonical bounded
batch defined by ADR-0037. Every per-workload result must bind the same Solution
Revision and exact generated build contract; Lambda ZIP, target-neutral artifact
manifest, and CycloneDX SBOM bytes retain `generated-build-artifact` ownership,
while each canonical application Evidence record becomes a separate
`evidence-artifact`. Cross-workload path, artifact, workload, or Evidence
identity collisions fail closed. Failed, blocked, canceled, malformed, partial,
or digest-corrupted results are rejected rather than exported. The adapter does
not invoke the builder or upgrade Solution Revision coverage.

See [isolated application build execution](APPLICATION_BUILD_EXECUTION.md).

## Prompt 33A diagram adapter

The pure exporter does not render diagrams. It accepts only a strict Diagram
Export Artifact whose full artifact digest, renderer pin, Solution Revision,
Architecture hashes, catalog/icon identity, dimensions, profile, warnings, and
file inventory match the same package inputs. Every declared diagram path must
resolve exactly once to bytes with the declared checksum, semantic checksum,
media type, and size. Missing SVG/README, substituted PNG/SVG, extra files, or a
foreign revision/catalog/renderer fails the complete export.

Diagram files retain `generated-replaceable` ownership and exact renderer,
revision, node/edge, catalog/icon, profile, and layout provenance. The solution
manifest embeds the complete diagram artifact rather than a weak reference, so
its renderer version, profile, dimensions, warnings, coverage binding, and full
checksums remain machine-readable. Independent ZIP verification reconstructs the
same inventory and bytes.

See [deterministic architecture diagram export](ARCHITECTURE_DIAGRAM_EXPORT.md).

## Prompt 46 CloudFormation target adapter

The exporter accepts CloudFormation only as canonical JSON with the exact
compiler target/format metadata and
`application/vnd.amazon.cloudformation.template+json` media type. It preserves
the same target-neutral Prompt 32A application ZIP, manifest, SBOM, and Evidence
bindings used by Terraform. Target selection is part of the approved settings,
manifest provenance, and file inventory; it does not change generation coverage.

The external-stage projection is target-specific. Terraform carries the existing
isolated Terraform-validation report and Evidence. CloudFormation carries the
exact compiler artifact plus the deterministic offline structural validation
report and `cloudFormationValidation` Evidence. The pure exporter runs neither
validator and cannot translate one target's evidence into the other. Exact
catalog `0.15.0` networking/event CloudFormation artifacts use this same
adapter. Manifests and previews retain architecture/revision identity, policy
ownership, parameters/outputs/tags, event retry/DLQ/filter facts, application
ZIP/checksum references, generation coverage, and declarative smoke-test
configuration. ZIP and GitHub destinations select the approved target without
forcing Terraform and CloudFormation into one file layout.

The portable repository workflow remains one fixed credentialless integrity
validator for either target. Reviewed privileged customer workflows remain the
Terraform-only profile and are never copied into a CloudFormation export merely
because the infrastructure tree validates. AWS-backed validation,
package/upload, change-set, stack, or deployment remains outside this adapter.

## Explicit exclusions

The Prompt 31 export service does not execute Terraform, generated source,
package managers, builds, tests, policy engines, or arbitrary extensions. It
does not resolve or fetch external artifacts, use credentials or network access,
write a repository, create Evidence, or claim validation succeeded. The separate
Prompt 32 and Prompt 32A runners own static-validation and application- build
execution; this package consumes only their verified data results.

## Verification

The focused suite covers infrastructure-only, generated-starter,
complete-supported-pattern, user-provided, and external-artifact modes; exact
checksums; strict and corrupted manifests; stale Solution Revisions; ownership
conflicts; traversal, ZIP-slip, device, non-regular, duplicate, normalization,
content, cache, and size attacks; repeated/order-equivalent output; and exact
ZIP reconstruction.

```powershell
pnpm check:solution-export
```
