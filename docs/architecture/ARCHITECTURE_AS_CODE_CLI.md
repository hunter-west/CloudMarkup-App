# Architecture-as-code CLI and repository verification

## Status and boundary

Prompt 33B adds a thin TypeScript command-line boundary over the immutable
Solution Revision workflow.
[ADR-0032](../adr/0032-typescript-repository-orchestration-cli.md) keeps the Go
`cloudmarkup-iac` executable compiler-only because application generation/build,
Terraform static validation, diagram rendering, export assembly, and Evidence
are TypeScript interfaces. The CLI coordinates those interfaces; it does not
reimplement their schemas, provider rules, rendering, ownership, or security
policy.

The dependency direction is:

```text
repository profile + lock + immutable source/package
                         |
                         v
               architecture CLI service
                         |
              exact profile ID/version/digest
                         |
                         v
       reviewed Solution Revision pipeline registration
         |          |          |          |          |
         v          v          v          v          v
     Go compiler  generator  build   target-local  diagram/export
                            sandbox   validation       + Evidence
```

No stage deploys, plans against a customer account, reads customer credentials,
makes an implicit network request, evaluates repository-selected code, or
invokes a shell through the CLI. Process-capable adapters retain their existing
executable-plus-argument-array and pinned-container policies.

## Versioned repository contract

The root `.cloudmarkup-cli.json` is canonical JSON and pins:

- contract version `1` and CLI `cloudmarkup.architecture-cli@1.0.0` with its
  deterministic digest;
- one reviewed pipeline profile ID, semantic version, and complete SHA-256
  digest;
- the fixed lock, generated manifest, and immutable Solution Revision paths.

The solution-export lock and manifest must agree on the exact Solution Revision
ID/digest, Architecture/Workload/application-contract/external-resource hashes,
catalog/compiler/generator/renderer/policy-pack pins, target, ownership, file
inventory, and complete checksums. Architecture v3 is reconstructed from the
canonical `cloudmarkup/` source documents and validated before a pipeline runs.
The browser draft, viewport, layout-only editor state, and mutable assistance UI
are not inputs.

The raw private workspace binary registers no pipeline automatically. A
distribution must include an exact reviewed registration at build time. Unknown
or ambiguous profiles fail with safe code
`cloudmarkup.cli.pipeline-profile-unavailable`; they are never loaded from
repository JavaScript, environment-selected modules, or PATH discovery. This
source tree still lacks published reviewed application-build and
Terraform-validation images, so it does not fabricate a working production
registration from the test coordinates. The orchestration contract, fixture
registration, and fail-closed binary are implemented; publication of those
reviewed images remains the explicit operational prerequisite.

## Prompt 45/45A event repository verification fixture

The sanitized AWS event fixture binds exact catalog `0.13.0` to one immutable
Solution Revision and canonical Architecture, Workload, application-contract,
and External Resource hashes. Its SQS consumer Workload and typed event
contracts bind the reviewed event generator, dispatcher, partial-batch response,
retry/DLQ, environment, handler, generated tests, and final artifact metadata.
Neither repository content nor infrastructure output infers payload, dispatch,
business transforms, IAM, or handler behavior.

The fixture records designed, imported, generated, planned, deployed, and
current-drift layers separately. Imported, deployed, and drift collections
remain empty; generated Terraform is replaceable output; the plan diff is
sanitized synthetic evidence with `credentials: false`. Neither the Repository
Snapshot nor a plan fixture can overwrite Architecture or promote evidence into
approved design.

The normal CLI test pipeline exercises `validate`, `generate`, `verify`, `diff`,
and `test` against the complete repository artifact. It verifies the exact
revision, manifest, lock, Workload/event contracts, generated handler source and
fixtures, Prompt 32A artifact commitments, Terraform tree, ownership, stable
digests, and semantic snapshot. Event Terraform contains typed references and
wildcard-free permission scope, with no arbitrary `depends_on`.

The repository pull-request workflow uses only reviewed fixed commands and
`contents: read`. It explicitly runs the application-generator and Prompt 32A
build-runner gates before the aggregate repository gate, so Prompt 45A handlers
are built and tested locally without OIDC, secret references, AWS credentials,
Terraform plan/apply, deployment, `pull_request_target`, or repository-selected
execution.

The generated customer pull-request workflow has a narrower boundary: its fixed
`cloudmarkup test` command validates revision-bound IaC/contracts, sealed Prompt
32A ZIP and Evidence commitments, and bounded smoke metadata. It does not
execute or rebuild generated source. Publishing the reviewed CLI distribution
and its pinned execution assets remains an operational prerequisite. Neither
workflow adds repository import, remote synchronization, push, commit, or
pull-request mutation authority.

## Command behavior

| Command    | Mutation                      | Delegated behavior                                                                       | Success meaning                                 |
| ---------- | ----------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `validate` | none                          | source/reference/provider/organization-policy/coverage/readiness validation              | all required local checks passed                |
| `generate` | approved generated paths only | complete IaC, application, contracts, diagrams, manifests, and local Evidence generation | baseline-bound update applied                   |
| `verify`   | none                          | complete regeneration in an isolated temporary tree                                      | byte and semantic output equal committed output |
| `diff`     | none                          | prior/current semantic projections plus file checksums                                   | deterministic change report produced            |
| `render`   | `diagram/` and manifest only  | approved immutable diagram profiles                                                      | no non-diagram output also changed              |
| `test`     | none in repository            | approved application and Terraform local/static verification                             | required checks and Evidence completed          |
| `evidence` | none                          | existing Evidence status/staleness summary                                               | no Evidence was fabricated or upgraded          |

All commands support `--format human|json`; JSON uses canonical serialization.
Exit codes are `0` success, `2` usage, `3` invalid repository, `4` drift, `5`
ownership/conflict, `6` pipeline failure, and `7` internal/output limit.
Diagnostics retain safe repository/node/edge/policy/workload references supplied
by the trusted pipeline, but messages reject URLs, local paths, tokens, and
secrets.

`verify` stages the generated package under an OS-exclusive directory whose
prefix is derived from the package digest. The suffix and local path never enter
output, manifests, Evidence, or logs. The directory is recursively removed in
`finally`. This permits concurrent checks for identical inputs without changing
reproducible bytes.

## Semantic diff

The pipeline supplies a digest-checked, UTF-16-sorted semantic snapshot. The CLI
reports stable identities and canonical digests, never presentation labels. The
version 1 change vocabulary covers:

- service and connection additions/removals/changes;
- permission expansion, reduction, and changes;
- HTTP routes; typed event/data/API/auth/test contracts; event filters,
  retry/DLQ and batch-response settings; explicit handler/runtime bindings; and
  workload operations;
- generation coverage, target readiness, unresolved requirements;
- public exposure and cost-sensitive resource classification.

Malicious or mutable display labels cannot enter diff summaries. Equivalent
input collection order produces identical results.

## Ownership and security

Repository output is bounded to the established solution-package roots. Every
expected file must be regular, non-link, NFC, portable, within size/count/total
limits, and exactly represented by the manifest. Windows devices, ADS syntax,
backslashes, absolute paths, traversal, empty segments, forbidden
caches/state/plans, and case-fold duplicates are rejected by the existing export
path policy.

`generate` and `render` plan the full change before writing. New or modified
content must be `generated-replaceable`; an existing generated file requires the
exact current baseline checksum. User-provided, user-owned extension,
architecture source, build artifact, and Evidence ownership are never silently
overwritten or deleted. `validate`, `verify`, `diff`, and `evidence` do not
write the repository.

Inputs are limited to 4,096 files, 32 MiB per file, 128 MiB total, 10,000 diff
entries, 512 diagnostics, and 8 MiB command output. Errors are fixed safe
messages rather than upstream stderr or source content.

## GitHub Actions template

[`cloudmarkup-validate.yml`](../../packages/architecture-cli/templates/cloudmarkup-validate.yml)
runs on pull requests and pushes to `main` with only `contents: read`. Checkout
credentials do not persist. Actions are pinned to full reviewed commit SHAs.
Install scripts are disabled; command lines are a static allowlist; the workflow
contains no `pull_request_target`, secret references, AWS credential action,
Terraform plan/apply, deployment, curl/wget, or repository-derived
interpolation.

The workflow invokes validation, isolated regeneration/drift verification,
application and selected-target local checks, diagram rendering, semantic diff,
and Evidence summary. It uploads only `evidence/repository-verification/`,
without hidden files, for seven days. The repository CI validator and package
tests parse the template and fail on permission, action-pin, command,
credential, deployment, network-download, retention, or artifact-path drift.

## Prompt 46 target selection

The approved profile and immutable manifest select exactly one IaC target.
`cloudmarkup-iac compile --target terraform|cloudformation` forwards that target
to the same normalization boundary. The CloudFormation path emits deterministic
JSON plus a parameter example and generated README, then runs only the built-in
credentialless structural validator. The Terraform path retains its existing HCL
and isolated static-validation contracts unchanged.

The UI target selector changes only the approved profile/target setting; Guided
and Professional modes render the same export component tree. Semantic diff
records `target-changed` and the target fact rather than treating unlike IaC
files as equivalent. Repository pull-request CI runs a focused no-credential
CloudFormation compiler check in addition to existing Terraform, application,
catalog, workflow, and aggregate gates.

Generated customer plan/deploy workflows remain Terraform-only. Prompt 46 does
not generate or execute CloudFormation package, upload, change-set, stack, or
deployment commands, and a CloudFormation target must not be relabeled as having
passed Terraform validation.

Prompt 47 extends that same target path to exact catalog `0.15.0` networking and
event-driven inputs. The checked repository corpus includes notes, two-AZ and
endpoint networks, image processing, fan-out, schedule, queue/DLQ, event target,
and Step Functions cases. `validate`/`generate`/`verify` remain
target-discriminated, and semantic `diff` reports network, event contract,
filter, retry/DLQ, handler/artifact, coverage, smoke metadata, and target
differences without comparing Terraform and CloudFormation text. Unsupported
target capabilities block export with source-linked findings.

## Prompt 40A generated-workflow integration

Prompt 40A deterministically generates exactly these optional customer-owned
workflow paths:

- `.github/workflows/cloudmarkup-validate.yml`;
- `.github/workflows/cloudmarkup-plan.yml`;
- `.github/workflows/cloudmarkup-deploy.yml`;
- `.github/workflows/cloudmarkup-smoke.yml`; and
- `.github/workflows/cloudmarkup-drift.yml`.

The generated Prompt 40A `cloudmarkup-validate.yml` file is credentialless and
checks the exact exported package, manifest, paths, ownership, and tree without
installing or invoking Terraform, a provider, generated source, or repository
commands. Generated handler ZIPs are admitted only when manifest-bound with
retained passing deterministic build/test and application-security Evidence from
the earlier sealed Prompt 32A export pipeline; this workflow does not rerun that
build. The trusted plan workflow repeats those inert checks and then reaches an
unconditional activation hold before Terraform setup, provider execution, or
OIDC. That hold exposes the reviewed seam where a published Prompt 33B CLI can
later verify the complete registered pipeline, but it is not the full
operational Prompt 33B workflow today.

The other files are customer-executed GitHub OIDC workflows, not CLI authority.
Plan records an exact expiring saved-plan manifest. Deploy verifies and applies
only that saved plan without replanning. Smoke and refresh-only drift first
verify the exact deployment receipt, commit, environment, and Solution Revision.
Plan, deploy, and smoke also schema- and checksum-validate each bounded
`smoke.extensions` descriptor, projected publicly as `smokeTestExtensions`,
against its exact workload and JSON specification path. These are declarative
customer extension points only; generated workflows never execute a command from
them. The workflows cannot extend the CLI command registry or make
repository-selected code executable.

Beta or production activation is blocked until the customer reviews a published
Prompt 33B CLI distribution, its digest, installation procedure, exact pipeline
registration, and support policy and Cloud Markup can authoritatively verify the
selected GitHub Environment policy at the execution boundary. See
[Customer-owned CI/CD](CUSTOMER_OWNED_CI_CD.md).

## Exact development commands

From the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm check:architecture-cli
pnpm ci:validate
pnpm check:compiler
pnpm check:application-generator
pnpm check:application-build-runner
pnpm check:terraform-validation-runner
pnpm check:diagram-export
pnpm check:solution-export
pnpm check:solution-export-workflow
```

To inspect the source binary's intended fail-closed behavior after build:

```powershell
pnpm --filter @cloudmarkup/architecture-cli build
node packages/architecture-cli/dist/bin.js validate --root <export-repository> --format json
```

That command succeeds only when the built distribution registers the exact
profile pinned by `<export-repository>/.cloudmarkup-cli.json`. The raw private
workspace build reports the unavailable-profile diagnostic by design. A
production/release workflow must not substitute test fixtures or unreviewed
image coordinates.
