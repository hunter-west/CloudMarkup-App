# ADR-0038: Deterministic CloudFormation customer-IaC target

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Accepted
- **Date:** 2026-08-28
- **Owners:** Cloud Markup engineering
- **Supersedes:** ADR-0029's statement that CloudFormation is metadata-only
- **Superseded by:** None

## Context

ADR-0029 established a closed, deterministic customer-IaC compiler and shipped
Terraform as its first renderer. It intentionally reserved CloudFormation as a
future target while requiring application source, build, artifact, IAM,
ownership, and deployment authority to stay separate. Prompts 29A and 32A then
produced deterministic Lambda source and final ZIP metadata outside the IaC
compiler; ADR-0037 made those artifacts target-neutral and bounded per workload.

The initial authenticated serverless application family is now representable by
the normalized compiler model: API Gateway HTTP API, Lambda, DynamoDB, Cognito,
IAM, and CloudWatch plus exact graph-owned relationships and policies. Adding a
second target must not duplicate normalization or application generation, change
Terraform addresses or bytes, infer permissions, embed secrets, execute AWS
tooling, or turn export into deployment.

## Decision

Add CloudFormation JSON as a second implementation of the existing target
interface. Both renderers consume the same immutable normalized solution. Target
selection can affect readiness, diagnostics, artifact metadata, and rendered
files; it cannot affect graph meaning, workload coverage, application source, or
policy authority.

CloudFormation templates are encoded from allowlisted structured Go values with
the standard JSON encoder. Resources, properties, policy documents, references,
`Fn::*` intrinsics, parameters, outputs, metadata, conditions, and explicit
dependencies are objects and arrays, never untrusted template fragments. The
renderer parses its own final JSON and applies bounded target-semantic checks
before publishing an artifact. It does not invoke the AWS CLI, CloudFormation, a
macro, a transform, a hook, a formatter, a provider, or repository code.

Logical IDs derive deterministically from deployment keys. When normalization
produces an invalid prefix or collision, a readable normalized prefix is joined
to a short SHA-256 suffix derived from the stable graph ID. Display labels,
layout, collection order, timestamps, machine paths, and randomness never enter
the identity.

The first CloudFormation compatibility profile is limited to the curated
serverless/auth/data family. A new immutable AWS catalog version promotes only
those exact mapping declarations to implemented. Networking and event-driven
CloudFormation mappings remain metadata-only and fail with source-linked,
CloudFormation-specific diagnostics. Historical catalogs and all existing
Terraform artifacts remain byte-compatible.

CloudFormation Lambda `Code` uses explicit S3 bucket, key, and immutable object
version parameters because native CloudFormation cannot deploy a local ZIP path.
The artifact manifest and template metadata retain the exact Prompt 32A
target-neutral ZIP path, checksum contract, runtime, handler, workload, and
implementation mode. The compiler never uploads or rebuilds the ZIP. External
artifact mode uses the same deployment-location parameter boundary. Other modes
reference the same deterministic package contract and truthfully report when
code or user input is still required.

IAM trust documents, inline policies, generated permissions, managed-policy
attachments, permissions boundaries, resource policies, and Lambda invocation
permissions continue to derive from typed graph resources, relationships, and
generated provenance. User-owned and generated policies remain separate manifest
entries. References create dependencies implicitly; `DependsOn` is emitted only
for a reviewed CloudFormation ordering requirement that no intrinsic can
express.

Solution export, repository CLI, semantic diff, UI target selection, and
credentialless pull-request verification accept a target-discriminated artifact
and validation contract. Existing Terraform validation remains unchanged.
CloudFormation validation is local structural and semantic verification; it is
not AWS `ValidateTemplate`, packaging, stack planning, change-set creation, or
deployment evidence. Customer deployment remains outside Cloud Markup authority
and no platform CDK dependency is introduced.

## Prompt 47 implementation evolution

Prompt 47 applies the accepted extension rule through exact additive catalog
`0.15.0`. It promotes the already-curated IPv4 networking and event-driven
mappings only after structured renderer, target limitation, reproducibility,
cross-target IAM/network/filter/retry/DLQ/artifact/coverage, and export/workflow
evidence exists. The target-neutral normalized model, application
generator/build contract, policy authority, and no-deployment decision do not
change.

Legitimate target differences remain explicit: CloudFormation embeds selected
owned configuration in native resources, parameterizes immutable S3 object
coordinates for Lambda ZIPs, and references rather than creates the default
EventBridge bus. The renderer resolves subnet ancestry, suppresses default
security-group egress, and emits explicit dependencies only for reviewed native
ordering gaps. Unsupported modes remain source-linked findings before export.

## Consequences

### Positive

- Customers can export either deterministic Terraform or deterministic native
  CloudFormation for the same initial revision, application ZIP, and IAM graph.
- Cross-target tests can compare resources, policies, references, artifact
  bindings, and coverage without coupling the normalized model to one syntax.
- JSON avoids a new Go dependency and provides deterministic, locally parseable
  structured output.
- Unsupported service families remain explicit rather than appearing partially
  supported.

### Negative

- Cross-language target artifact, export, CLI, workflow, and UI contracts gain
  target-discriminated branches and require compatibility tests.
- CloudFormation cannot consume a local ZIP directly, so package upload
  coordinates remain deployment-time parameters owned by the customer.
- Local structural verification cannot prove account/Region availability or
  CloudFormation service acceptance; live validation stays outside this prompt.

### Follow-up

- Extend target support only through a reviewed catalog/compiler compatibility
  version with equivalent policy and artifact evidence.
- A future customer deployment workflow may package/upload CloudFormation
  artifacts only after a separate authority, receipt, and rollback decision.
- Prompt 47 may consume target-difference Evidence but cannot rewrite the
  Architecture or infer target equivalence.

## Alternatives considered

### Generate YAML with string concatenation

Rejected because escaping, ordering, intrinsic construction, and injection
properties would be harder to validate and would violate the structured-IaC
boundary.

### Use SAM or CDK as the customer CloudFormation renderer

Rejected because SAM adds a transform/packaging contract and CDK is already the
separate platform-IaC boundary. Neither is needed for the bounded native
resource family.

### Duplicate the application generator per IaC target

Rejected because Workload/Application Contracts and Prompt 32A artifacts are
target-neutral authority. A second generator could drift behavior and source
ownership.

### Promote every existing CloudFormation mapping at once

Rejected because networking and event families lack renderer-equivalence
evidence in this prompt. Metadata cannot establish implementation readiness.

### Call AWS `ValidateTemplate` in ordinary CI

Rejected because ordinary pull-request verification is credentialless,
network-free, and non-deploying. AWS acceptance is a later customer-owned
execution concern.

## Compatibility, security, and rollback

The target artifact wire contract remains version 1 with a strict target
discriminator; the Terraform branch and digest projection are unchanged. The
CloudFormation branch has separate metadata and media types. Old consumers can
continue accepting Terraform and fail closed on an unknown target. Rolling back
the CloudFormation registration makes the exact 0.14.0 target unavailable
without changing historical Terraform outputs or application artifacts.

The renderer allowlists resource types, properties, intrinsics, IAM actions,
principals, references, and file paths; enforces existing byte/file/diagnostic
limits; rejects embedded secret values and unsupported external lifecycle modes;
and owns no network, credential, shell, model, package manager, upload,
change-set, or deployment port.

## References

- [ADR-0003](0003-deterministic-compiler-boundary.md)
- [ADR-0005](0005-export-without-deploy.md)
- [ADR-0011](0011-separate-platform-and-customer-iac.md)
- [ADR-0017](0017-versioned-workload-behavior-and-build-boundaries.md)
- [ADR-0025](0025-canonical-solution-repository-and-evidence-contracts.md)
- [ADR-0029](0029-deterministic-terraform-and-application-artifact-boundary.md)
- [ADR-0031](0031-immutable-solution-export-orchestration.md)
- [ADR-0032](0032-typescript-repository-orchestration-cli.md)
- [ADR-0036](0036-customer-owned-receipt-bound-ci-cd.md)
- [ADR-0037](0037-deterministic-multi-artifact-application-build-batches.md)
- [Compiler normalization](../architecture/COMPILER_NORMALIZATION.md)
- [Application build execution](../architecture/APPLICATION_BUILD_EXECUTION.md)
- Prompt 46 plan
