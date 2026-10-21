# ADR-0029: Deterministic Terraform and application-artifact boundary

- Status: Accepted
- Date: 2026-08-17
- Deciders: Cloud Markup product owner and engineering

## Context

ADR-0003 established a closed deterministic compiler boundary, ADR-0004 put AWS
behavior behind versioned provider contracts, ADR-0005 prohibited customer
deployment, ADR-0017 separated workload behavior from source generation, and
ADR-0025 separated designed, generated, planned, and deployed truth. Prompt 29
authorizes the first customer Terraform output but does not authorize
application-source generation, Terraform execution, planning, deployment, or
Evidence creation.

The initial authenticated notes API needs stable Terraform addresses, exact
catalog compatibility, graph-derived IAM, honest application packaging inputs,
and explicit treatment of externally owned resources. Those choices form a
public artifact protocol that Prompt 29A and Prompt 32A will consume.

## Decision

The standalone Go compiler renders Terraform only from a structurally and
semantically valid immutable Architecture Document v3 and its compatible
Workload/Solution Revision inputs. It accepts only the exact AWS notes catalog
`0.7.0` artifact digest recorded by the compiler. The catalog promotes the eight
reviewed resource mappings to `implemented`; CloudFormation mappings remain
metadata-only. An exact `0.6.0` to `0.7.0` migration repins older documents
without changing graph semantics.

Terraform is produced with HashiCorp HCL APIs. The target emits a fixed,
deterministically ordered tree, pins Terraform and provider constraints in
compiler metadata, uses persisted deployment keys or stable node IDs for
addresses, detects collisions, and parses every emitted HCL file before
returning it. The compiler never runs Terraform, providers, modules,
provisioners, shells, package managers, cloud SDKs, models, or network clients.

IAM is derived only from typed graph relationships and reviewed owned-policy
configuration. Direct supported relationships require an exact generated policy
with source-edge provenance, and every generated statement/provenance edge must
map back to one exact supported relationship. Trust, generated identity
permission, user-authored inline policy, managed-policy attachment, permissions
boundary, and Lambda service-grant provenance remain distinct in the output
manifest. Application source is never scanned to infer permission.

The application-artifact contract is separate from Terraform rendering:

- generated modes point to a stable relative package that Prompt 32A may
  produce;
- user-provided, infrastructure-only, and AI-assisted-custom modes require a
  validated relative package and digest input whose manifest semantics and HCL
  validation reject absolute paths and malformed hashes;
- external-artifact mode requires immutable object-artifact inputs; and
- infrastructure-only mode emits an explicit code-required warning and README
  instruction.

Externally owned resources are created, referenced, or imported only when
ownership state, lifecycle authority, behavior, target readiness, mapping
identity/version, and exact import address agree. Existing externally managed
resources become explicit non-created variables. Imported resources emit a
reviewed import block. Unknown or inconsistent ownership fails closed.

Target-extension references reserve the Prompt 36A contract but every nonempty
extension is rejected in this milestone. AI-authored target content therefore
cannot enter deterministic files or bypass parsing, validation, review, or
source-ownership gates.

## Consequences

- Presentation and assistance-mode changes cannot alter Terraform, application
  artifacts, or policy output; visual provenance may still record a different
  visual hash.
- HCL v2 and cty are direct Go dependencies of the isolated compiler module;
  they add no runtime network or execution capability.
- The artifact manifest and generated files are bounded and digest-addressed.
- CloudFormation, source generation, application building, Terraform
  initialization/validation/plan/apply, customer credentials, and deployment
  Evidence remain future or customer-owned concerns.

## Alternatives rejected

- String-built HCL was rejected because it weakens parsing and structural
  guarantees.
- Source scanning for IAM was rejected because application text is not
  infrastructure authority.
- Terraform modules or provisioners were rejected because they introduce
  arbitrary execution and dependency surfaces.
- Treating every workload mode as a local filename was rejected because it
  obscures source ownership and package provenance.

## References

- [Compiler normalization](../architecture/COMPILER_NORMALIZATION.md)
- [Deterministic Terraform generation](../architecture/TERRAFORM_GENERATION.md)
- [Solution repository and evidence](../architecture/SOLUTION_REPOSITORY_AND_EVIDENCE.md)
- [Security principles](../architecture/SECURITY_PRINCIPLES.md)
- [ADR-0003](0003-deterministic-compiler-boundary.md)
- [ADR-0005](0005-export-without-deploy.md)
- [ADR-0017](0017-versioned-workload-behavior-and-build-boundaries.md)
- [ADR-0025](0025-canonical-solution-repository-and-evidence-contracts.md)
