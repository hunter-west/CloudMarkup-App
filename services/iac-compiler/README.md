# Cloud Markup IaC compiler

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

## Responsibility

This independent Go module validates and normalizes immutable solution inputs
and deterministically renders reviewed Terraform or CloudFormation targets.
Inputs are Architecture Document v3, optional matching Workload Behavior v2 and
an optional exact Solution Revision Manifest v1. Results contain stable
diagnostics, a normalized model and a versioned, digest-bound target artifact.

Architecture remains infrastructure truth; workload documents describe typed
behavior and artifact intent. The compiler checks exact schema, catalog,
compiler, target and optional generator compatibility without network
resolution. The [scoped instructions](AGENTS.md) describe admitted catalog
families; `DefaultCompatibilityRegistry` and renderer tests define exact
support. Unsupported or metadata-only mappings never become executable by
implication.

The default registry installs one exact AWS catalog: 0.30.0, with digest
`sha256:5dc9603e3df5a09835946dd11554aae5ece39803f12aee118f1227e9a591f619`. Older
immutable AWS bindings are rejected. Mutable drafts may use the editor's
lossless catalog-opening review before a new immutable freeze; old revisions and
evidence remain unchanged. Historical catalog dispatch, replay tuples and
upgrades are not installed. The neutral example catalog still supports the
existing provider-independent normalization contract.

The current catalog adds a bounded regional WAF Web ACL and canonical ALB
association as CloudFormation-only infrastructure proof. Exact literal fields,
Region, ownership, association endpoints and ordered unique priorities are
validated before export. ACL removal/replacement retains the resource;
association removal follows explicit graph intent. Request sampling/logging and
Terraform WAF remain unsupported. Offline native export does not establish AWS
permissions, traffic protection, application generation or deployment.

The current AWS catalog includes one regional AWS-generated symmetric KMS
encryption key. Both targets require its explicit user-owned canonical key
policy, exact typed self-scope and separate reviewed administrator/key-user
statements. Terraform emits inline `policy` and `prevent_destroy`;
CloudFormation emits inline `KeyPolicy` with both Retain policies. Lockout
bypass is false. Offline export cannot prove existing roles, deployment-account
or caller authority. See the bounded plan for synthetic goldens, negative cases,
reproducibility and pending release gates.

The current catalog includes externally populated Secrets Manager metadata. Both
targets validate exact ownership, an optional typed KMS key association and
separately chosen exact role-policy read scope. Terraform emits
`aws_secretsmanager_secret` with recovery-window and destroy protection;
CloudFormation emits `AWS::SecretsManager::Secret` with both Retain policies.
Neither target emits secret values, versions, passwords or inferred grants. See
the Secrets Manager plan for source pins, focused evidence and coordinator-owned
release gates.

The current catalog includes private Linux EC2 and real IAM instance profiles.
The compiler requires exact user-owned identities, static caller-declared AMI
provenance, one canonical EC2-only role trust statement, one subnet and one to
five same-VPC security groups. Terraform uses profile name, explicit private
addressing, IMDSv2 and encrypted gp3 root mapping; CloudFormation uses one
instance-owned primary interface and a typed profile reference. Inline
CloudFormation EBS has no Throughput property, so only the shared 3000 IOPS/ 125
MiB/s baseline is admitted. Neither target emits bootstrap, credentials,
application artifacts, key grants or guessed image identities. Offline export
cannot prove image/launch/PassRole/key authority or workload suitability. See
the EC2 plan for precise limits, focused evidence and Launch-owned remaining
gates.

Compiler-owned JSON Schemas are checked against the authoritative TypeScript
contracts. Go imports no frontend or backend runtime package. See
[normalization](../../docs/architecture/COMPILER_NORMALIZATION.md),
[Terraform generation](../../docs/architecture/TERRAFORM_GENERATION.md) and
[CloudFormation generation](../../docs/architecture/CLOUDFORMATION_GENERATION.md).

## CLI

Run from the repository root:

```powershell
go -C services/iac-compiler run ./cmd/cloudmarkup-iac normalize `
  --architecture ../../packages/test-fixtures/fixtures/architecture-document/v3/valid/representative.json

go -C services/iac-compiler run ./cmd/cloudmarkup-iac compile `
  --architecture <architecture-v3.json> `
  --workload <optional-workload-v2.json> `
  --solution-revision <optional-solution-revision-v1.json> `
  --target terraform `
  --output <compilation-result.json>
```

Choose `--target cloudformation` for its reviewed renderer. Terraform is the
default. `--architecture -` reads stdin. Byte-limit flags bound input/output;
the CLI rejects overwriting an input, emits one versioned JSON result and exits
nonzero for error diagnostics. It does not extract a generated tree or execute
IaC tools. `inspect-terraform-hcl` provides the separate bounded HCL inspector.

## Artifacts and downstream execution

Terraform uses HashiCorp HCL APIs and parses every emitted HCL file.
CloudFormation uses allowlisted structured values, canonical JSON and a local
validator. Both preserve stable graph-derived identities and deterministic
ordering. Artifact contracts carry exact tool/catalog pins, ownership,
resource/policy provenance, file digests and an overall digest.

Application modes reference explicit relative packages or immutable external
objects. Deterministic source generation belongs to
`@cloudmarkup/application-generator`; isolated build/test execution belongs to
`@cloudmarkup/application-build-runner`. The compiler does not infer IAM,
runtime or handler semantics by scanning source. Build evidence cannot rewrite
the immutable revision or silently rebind a historical compiler coordinate. The
current compiler coordinate is `cloudmarkup.iac-compiler@1.2.1`; its exact
digest and supported generator tuples are checked in code.

Compiler 1.2.1 retains exact SQS redrive authorization using explicit source
queue names and template partition/Region/account parameters, without reciprocal
queue-resource dependencies. Lambda logging uses its typed connected log group,
including after a function-name edit. Existing immutable 1.2.0 Solution
Revisions retain their original pins; create a new revision for corrected
output.

`@cloudmarkup/solution-export-workflow` verifies compiler commitments and
projects rendered artifacts into export contracts. Its CLI adapter permits a
fixed executable and bounded canonical inputs. The separate Terraform validator
accepts only immutable compiler files and reviewed offline tools. Compiler
failure or malformed output cannot advance to validation or publication.

## Closed boundary

Unsupported catalog, schema, generator and target versions fail explicitly.
Nonempty target extensions remain rejected by this compiler. It cannot access
models, databases, cloud SDKs, credentials or runtime network; execute commands,
package managers, Terraform, providers, modules, plugins, provisioners or
customer content; build applications; plan/apply/deploy; or create deployment
evidence. Platform delivery is outside this process.

## Verification and compatibility

```powershell
pnpm generation:goldens:check
pnpm check:compiler
pnpm catalog:check
```

The shared golden inventory and target suites cover exact generated trees,
syntax, graph/provenance authority, forbidden constructs and negative support
cases. Repeated, reordered, presentation-only and clean-directory compilations
must remain byte-identical. Historical compiler/catalog and generator tuples
remain regression inputs; a newer supported tuple never upgrades an immutable
revision silently.

Ordinary checks are read-only. Golden changes require an explicit category,
confirmation and reviewer summary under the
[generation golden workflow](../../docs/development/GENERATION_GOLDEN_WORKFLOW.md).
