# Compiler normalization foundation

## Status and authority

Prompts 28 and 29 implement the standalone Go library and CLI under
`services/iac-compiler`. Prompt 28 owns schema/semantic validation and
normalization. Prompt 29 adds deterministic rendering for the exact AWS
notes-API Terraform target; later exact profiles extend Terraform and add
CloudFormation after this shared boundary. No prompt authorizes
application-source generation inside the compiler, artifact builds,
plan/apply/deploy, credentials, or deployment Evidence.

Architecture Document v3 remains infrastructure truth. Embedded Workload
Behavior v2 describes supported behavior and artifact intent. An optional
standalone Workload Document must be canonically identical. An optional Solution
Revision Manifest v1 must bind the exact document/revision identities, catalog,
compiler, workload, application-contract, external-resource, semantic, document,
and visual hashes. Compilation never switches revisions or upgrades draft
analysis into reproducible evidence.

## Input and compatibility contracts

The compiler owns checked-in copies of generated Architecture v3, Workload v2,
and Solution Revision v1 JSON Schemas. Drift tests compare them byte-for-byte
with authoritative TypeScript outputs; Go imports no TypeScript runtime.

Compatibility is exact and caller supplied: input-contract version, compiler
semantic version range, target contract, catalog ID/version/digest and supported
Architecture schema versions, plus optional pinned generator metadata. No value
is resolved from a network or `latest`. The AWS notes catalog `0.8.0` declares
Architecture v1-v3 compatibility and the compiler pins its exact generated
digest. Catalog `0.7.0` is rejected until its exact reviewed `0.7.0` to `0.8.0`
education-content repin is applied; an older `0.6.0` document must first follow
the exact `0.6.0` to `0.7.0` migration.

Structural validation precedes semantic validation. Semantic checks cover
identity uniqueness, endpoints/containment, generated provenance,
variable/output/configuration references, workload ownership and operation/
trigger/edge references, embedded bindings, application/external references,
compatibility pins, and every supplied Solution Revision hash.

## Normalized model

The compiler model deterministically orders infrastructure resources,
connections, policy attachments, variables, outputs, external ownership,
workloads, operations, triggers, environment/artifact bindings, generation
coverage, readiness, source ownership, extension points, and exact provenance.
It is not a general programming AST.

Target keys prefer persisted deployment keys and otherwise stable node IDs.
Collisions fail normalization and receive deterministic digest suffixes for
diagnostic output; target-address collisions are also deterministically
suffix-disambiguated. Presentation, labels, input-array order, audit timestamps,
and assistance preferences cannot alter normalized infrastructure/application
semantics or generated files.

## Terraform target and application-generator boundary

Terraform target contract `1.0.0` is render-capable only for the exact curated
notes family. It produces the fixed HCL tree and application/policy artifact
manifest defined in [Terraform generation](TERRAFORM_GENERATION.md). Every HCL
file is built with HashiCorp APIs and parsed before return. Unsupported
resource, relationship, policy, workload behavior, configuration, external
ownership, or extension is an error; partial artifacts are not returned.

IAM comes only from typed graph relationships and reviewed owned-policy
configuration. Every supported permission-producing edge must retain its exact
generated policy and source-edge provenance. Application source is never
inspected.

Terraform and CloudFormation are separate renderers after normalization.
Unsupported exact target/catalog pairs fail explicitly. `ApplicationGenerator`
and Prompt 32A remain separate boundaries; neither renderer can call them.
Workload modes retain target-neutral relative/object artifact contracts, and the
compiler only references already verified source/package outputs.

## Execution and security boundary

The library accepts bounded byte slices or `io.Reader` values and context
cancellation. Defaults bound input bytes, JSON depth, graph/workload sizes,
diagnostics, normalized output, target bytes, and file count. Diagnostics use
stable codes and identifier/path references and never echo source or secret
values.

The CLI supports `normalize` and `compile`, stdin or explicit input files, and a
single versioned JSON result. It prevents output from overwriting inputs. The
compiler has no network/model/database/cloud client, credential access,
repository/source scanner, subprocess runner, Terraform/provider/module/plugin/
provisioner execution, application build, plan, apply, deployment, or Evidence
path.

## CLI

```powershell
go -C services/iac-compiler run ./cmd/cloudmarkup-iac normalize `
  --architecture ../../packages/test-fixtures/fixtures/architecture-document/v3/valid/representative.json

go -C services/iac-compiler run ./cmd/cloudmarkup-iac compile `
  --architecture <aws-notes-architecture-v3.json> `
  --output <compilation-result.json>
```

Optional flags are `--workload`, `--solution-revision`, `--target terraform`,
`--output`, `--max-input-bytes`, and `--max-output-bytes`. `-` selects stdin for
Architecture. Any error diagnostic produces a nonzero process exit.
