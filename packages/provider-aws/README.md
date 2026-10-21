# `@cloudmarkup/provider-aws`

The current catalog source is **0.30.0**: 73 resource, boundary and owned
configuration definitions, 139 connection descriptors and 34 validation
descriptors. These cover bounded AWS service slices, including serverless,
networking, events, FSx, KMS, Secrets Manager, EC2, ECR, ECS Fargate, PostgreSQL
RDS and Aurora, Route 53, ACM, CloudFront, ALB and EBS. Definition counts
include supporting configurations; they are not counts of independent AWS
services. Source support and live beta release admission remain separate.

The added regional WAF Web ACL and owned ALB association are visibly marked
proof-level. Their bounded configuration, typed connections, validation and
native CloudFormation export are implemented. Terraform, expanded WAF modes, new
artwork approval and actual AWS traffic qualification remain unavailable. They
add no model, credential, runtime permission or deployment authority.

## Current projects

`resolveAwsCurrentCatalogV1` admits only the installed catalog ID, version and
digest for immutable consumers. The editor can open an older mutable draft with
the latest catalog after checking its stored service/resource types,
configuration schemas and values, parent relationships, and connection
endpoints. Compatible additions change only an in-memory catalog binding through
the graph command engine; the next ordinary authorized save persists it. Reads
never rewrite stored projects or immutable revisions.

Configuration schema version changes require explicit review of a lossless
adaptation. Unknown fields, unavailable services, removed ports, changed schema
identities and invalid values retain the original project with issue paths,
recovery download and migration guidance. They are never filtered or guessed.
Normal export validation and exact revision bindings remain required. The editor
and native compiler install one current catalog; they do not dispatch arbitrary
historical migrations.

## Frozen model inputs

`resolveAwsModelCatalogV1` provides read-only interpretation of two exact
bindings: the current catalog and the frozen 71-definition model-input catalog.
The latter uses the original catalog and service-extension bytes retained under
`src/model-evaluation-source/`, with complete artifact digests verified before
constructing immutable accessors. It is not a reconstructed subset of the
current catalog. Unknown or relabeled bindings fail closed. Its no-argument
default is the current catalog; `resolveAwsCurrentCatalogV1` remains
current-only.

Historical model request construction and read-only coverage checks use the
explicit frozen binding. Historical assessor bytes and executable current-only
validator checks remain unchanged; this reader does not qualify live assessment.
This reader grants no graph mutation, compiler compatibility, provider
invocation, commercial reservation, report issuance or model promotion. Existing
evaluation inputs, policies and receipts keep their original commitments.

## Source and generated outputs

Reviewed source is statically imported from `src/catalog`. One generator writes
three canonical JSON artifacts, their SHA-256 files and TypeScript accessors:

- `src/compiled/catalog-v1.json`: services, relationships and validation facts.
- `src/compiled/connection-presentation-v1.json`: stable connection docks.
- `src/compiled/service-extension-v1.json`: configuration slots and readiness.

Extensions bind the exact current semantic catalog. The isolated
[Go compiler](../../services/iac-compiler/README.md) owns deterministic
Terraform and CloudFormation output. Provider support grants no credentials,
cloud access or plan/apply authority. Graph changes pass through domain
commands; generated resources retain provenance and require adoption before
customization.

## Product boundaries

Configuration, connections, placement and permissions stay explicit. Region and
Availability Zone are ambient placement; regional availability remains unknown.
EC2 requires caller supplied image declarations, private subnet, security
groups, profile and canonical role trust. Renderers preserve encrypted storage
and IMDSv2. KMS requires exact key-local structured policy and retained
lifecycle; wildcard input, implicit principals and lockout bypass remain
rejected.

Secrets Manager exports empty metadata with external population and explicit
encryption and permission choices. It never emits values, versions, generated
passwords, rotation or retrieval behavior. FSx capacity and subnet bounds and S3
name/filter rules remain enforced. Current application generation covers
reviewed Lambda patterns; catalog presence does not promise arbitrary
application logic, AI generation or deployment success.

Provider icon attribution and reviewed artwork provenance remain intact. Neutral
icon fallbacks identify the service without claiming official artwork.

## Focused verification

After an authorized catalog source change, run:

```powershell
pnpm --filter @cloudmarkup/provider-aws generate:artifacts
pnpm --filter @cloudmarkup/provider-aws verify:artifacts
```

Review generated bytes and run the affected provider/compiler cases. Artifact
verification compares all nine outputs byte for byte. Synthetic fixtures are
generated at the current binding; executed evidence is never reissued merely to
change a catalog header. See the
[development guide](../../docs/development/PROVIDER_CATALOG.md) for contracts
and [Terraform generation](../../docs/architecture/TERRAFORM_GENERATION.md) for
output boundaries. Historical release notes describe their named versions.
