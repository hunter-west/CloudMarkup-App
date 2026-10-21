# Deterministic CloudFormation generation

Status: Prompt 47 implements CloudFormation JSON for the curated initial,
networking, and event-driven application families. Arbitrary extensions,
AWS-backed validation, packaging/upload, change sets, and deployment remain
unsupported.

## Authority and target boundary

The standalone Go compiler consumes the same immutable Architecture Document,
optional Workload Document, Solution Revision, exact catalog binding, and
target-neutral normalized model used by Terraform. Target selection occurs only
after shared validation and normalization. Layout, labels, input order, local
paths, time, randomness, source code, model output, and repository observations
cannot change deployment meaning.

Curated networking and event-driven CloudFormation were introduced with exact
AWS catalog `0.15.0` at
`sha256:5454b1255486921e0240ccd67f3ee1effd5e0b25eb2aaee082e13221528bef3e` and
target contract `1.0`. Exact `0.14.0` remains the historical initial-family
profile. The additive migration changes readiness only, preserves every
historical catalog artifact, and keeps Terraform output byte-regression guarded.

Exact successors `0.16.0` and `0.17.0` retain those families and add bounded
nested policies and curated FSx respectively. Exact `0.18.0` keeps their
rendering and tightens FSx capacity admission: Lustre PERSISTENT_2 SSD uses
1,200 GiB or multiples of 2,400 GiB within the catalog limit; the modeled single
ONTAP HA pair uses 1,024–524,288 GiB. Invalid capacity produces a
source-referenced diagnostic without an artifact or inferred resizing.
Historical bindings retain their original behavior; an explicit draft catalog
upgrade preserves configured sizes. Exact `0.19.0` retains this behavior and
adds shared-namespace S3 bucket naming and direct Lambda notification filter
admission, including encoded-equivalent overlaps. Invalid input yields no
partial artifact; upgrading never renames a bucket or removes a destination.
Valid infrastructure bytes remain unchanged apart from catalog provenance.

## Deterministic artifact

The renderer constructs allowlisted Go maps and structs and serializes them as
canonical, indented JSON. It never concatenates untrusted template fragments.
Intrinsic operations use structured `Ref`, `Fn::GetAtt`, `Fn::Join`, and
`Fn::Sub` values. Resource references provide ordinary dependency ordering.
Explicit `DependsOn` is limited to reviewed ordering gaps that intrinsics cannot
express: S3 notifications wait for their Lambda permission, and Internet Gateway
routes/NAT gateways wait for the VPC gateway attachment.

The artifact contains:

- `infrastructure/template.json` with template-format version `2010-09-09`;
- `infrastructure/parameters.example.json` with non-secret example bindings; and
- `infrastructure/README.md` with exact target/catalog/compiler identity,
  local-validation status, application artifacts, limitations, and the
  no-deployment boundary.

Logical IDs derive from deployment keys. A stable graph-ID hash disambiguates a
collision, so presentation and collection order cannot alter identity. Output is
bounded by compiler file/count/byte limits and must pass the internal
`cloudmarkup-structured-template-v1` structural validator before publication.

## Supported surface

The exact reviewed surface includes:

- API Gateway v2 HTTP APIs/integrations, Lambda, DynamoDB, Cognito, IAM, and
  CloudWatch;
- VPCs, subnets, route tables/routes/associations, Internet and NAT gateways,
  gateway endpoints, security groups/rules, and Lambda VPC attachment; and
- S3 buckets and owned notification/lifecycle/CORS configuration, SQS queues and
  DLQs, SNS topics/subscriptions, EventBridge buses/rules/targets, Standard Step
  Functions Lambda tasks, Lambda event-source mappings, service permissions, IAM
  policies, and resource policies.

The renderer supports parameters, outputs, tags, structured references, trust
policies, custom inline policies, graph-derived generated policies,
managed-policy attachments, permissions boundaries, retries, DLQs, S3 key
prefix/suffix filters, event patterns, and partial-batch SQS response semantics
only where catalog/configuration truth declares them.

Generated and user-owned policy authority remains separate. IAM and Lambda
invocation permissions derive only from typed graph edges and owned policy
configuration; application source cannot widen them. Sensitive inputs become
`NoEcho` parameters or explicit external references. Sensitive outputs and
embedded secret values are rejected.

Unsupported resource types, relationships, configuration shapes, catalog pins,
workload modes, external references, extensions, recursive event cycles,
interface endpoints, arbitrary filters/ASL, cross-account/cross-Region eventing,
FIFO combinations, unbounded retries, ambiguous targets, or sensitive outputs
return target-specific diagnostics with exact document/node/edge/workload/path
references and no partial artifact.

## Application artifacts and coverage

CloudFormation does not generate or inspect application source. All supported
implementation modes use the existing Prompt 29A/45A generator and Prompt 32A
build/test/scan/package result. Lambda `Code` references parameterized S3
bucket/key/version bindings for the same deterministic final ZIP, while artifact
metadata retains the exact workload, archive path, entrypoint, manifest, and
SHA-256 commitments. The same target-neutral metadata can later feed an
authorized uploader without granting upload authority to the compiler.

Generation coverage remains a property of the immutable Workload/Application
Contracts and verified build Evidence. Choosing CloudFormation cannot upgrade or
independently redefine it. The six Prompt 45A event handlers and multi-handler
fan-out packages are reused without source regeneration. A target that cannot
represent required infrastructure fails closed before export.

## Export, validation, and CI

The CLI, solution export, API projection, semantic diff, and shared UI carry an
explicit approved target. Terraform retains its established static-validation
runner. CloudFormation uses only the compiler's credentialless local structural
validator and emits target-specific validation status and Evidence; neither
target's result can satisfy the other.

Repository pull-request CI parses and semantically verifies CloudFormation
output without credentials and builds/tests the shared application artifacts
through fixed repository commands. Portable ZIP/GitHub exports contain the same
credentialless integrity workflow for both targets. Privileged customer
plan/deploy workflows remain the reviewed Terraform-only profile; CloudFormation
does not inherit or relabel them.

No path calls AWS, initializes providers, packages or uploads deployment
artifacts, creates change sets, executes stacks, or deploys.

## Legitimate target differences

Terraform emits separate HCL resources/files and references local ZIP paths.
CloudFormation embeds S3 notification/lifecycle/CORS and SQS redrive properties
where the native resource requires them, references the default EventBridge bus
without creating it, and parameterizes immutable S3 object coordinates for the
same ZIP checksum contract. Terraform variables map to CloudFormation
parameters; outputs, tags, IAM intent, policy ownership, smoke-test metadata,
and architecture identities remain semantically equivalent rather than textually
identical.

See [compiler normalization](COMPILER_NORMALIZATION.md),
[Terraform generation](TERRAFORM_GENERATION.md),
[solution export packaging](SOLUTION_EXPORT_PACKAGING.md),
[architecture-as-code CLI](ARCHITECTURE_AS_CODE_CLI.md), and
[ADR-0038](../adr/0038-deterministic-cloudformation-customer-iac-target.md).
