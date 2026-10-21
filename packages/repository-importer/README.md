# Repository importer

`@cloudmarkup/repository-importer` is the deterministic, local, no-credential
repository observation boundary. It reads bounded approved files without
executing Terraform, CDK, package managers, repository scripts, or arbitrary
binaries. The result contains an immutable Repository Snapshot, Observed
Solution, conformance differences, review-only reconciliation operations, active
issues, and level-8 repository-conformance Evidence.

Terraform HCL is parsed through the fixed
`cloudmarkup-iac inspect-terraform-hcl` data protocol. The parser returns syntax
ranges, expression digests, and safe references; it never returns literal
values. Terraform show JSON values are reduced to redacted facts and raw state
is not retained in ordinary importer results.

Importer 1.0.1 includes nested HCL blocks in configuration digests and reference
discovery. References resolve after all selected HCL files are read, within the
same Terraform module directory. Managed resources and data sources have
distinct addresses; ambiguous addresses and module outputs are not guessed.
Repeated references between the same resources produce one observation
connection.

## Supported inputs and outputs

The safe scanner accepts explicit selected subtrees and bounded UTF-8 regular
files only. It recognizes canonical Cloud Markup documents, Terraform HCL/JSON
and sanitized show JSON, CloudFormation JSON/YAML, synthesized CDK templates,
application/source/environment manifests, and GitHub workflow structure. Paths,
links, portable-name collisions, binary content, counts, and bytes fail closed.

Provider mappings come only from the supplied catalog artifact. Confirmed facts
carry exact parser/source Evidence; ambiguous expressions and mutable workflow
action pins remain unresolved. The comparison reports matches, designed-only,
observed-only, configuration/connection, IAM expansion/reduction, ownership,
generated drift, and unsupported findings. A passing check is repository
conformance only, never deployed-state Evidence.

Reconciliation is proposal-only. Exact imported Cloud Markup graph additions may
carry deterministic Graph Command batches validated by the domain engine. The
service never applies them, writes files, executes source, invokes AI, accesses
the network, uses credentials, or deploys.

## Unsupported module and transform declarations (1.0.2)

Importer 1.0.2 reports root Terraform HCL/JSON module declarations and
CloudFormation transforms, including nested `Fn::Transform`, as unsupported
source findings. It retains selected file checksums and available literal facts,
but emits source-bound error diagnostics, conformance differences and Active
Issues. Conformance evidence cannot pass while these sources remain incomplete;
no module or macro output is invented. Review module code separately or provide
a processed CloudFormation template. Import does not resolve remote sources,
execute macros, alter repository files, or create Graph Commands for plain IaC.

Historical 1.0.1 observations retain their original provenance. The snapshot
digest helper accepts an explicit historical version for metadata reads only;
new imports always execute and identify as 1.0.2. Current production repository
request construction requires 1.0.2, and the reviewed 2.9.0 repository assessor
binds parser provenance and durable input receipts. The historical 2.6.0
assessor retains its 1.0.1 expectations; it cannot silently assess current
parser output. See
[the production request](../../apps/api/src/production-model-live-repository-request.ts),
[the successor assessor](../../apps/api/src/model-live-repository-case-assessment-v2-9.ts)
and
[receipt validation](../../apps/api/src/adapters/persistence/model-live-parser-validation.ts).
These contracts do not imply an import was fully understood or a live model run
was authorized.
