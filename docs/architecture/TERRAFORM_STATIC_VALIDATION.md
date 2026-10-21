# Terraform static validation boundary

## Scope

Prompt 32 adds a local, worker-callable static-validation interface and a
synth-only AWS CodeBuild sandbox definition. It accepts one immutable,
digest-bound Terraform tree from the deterministic IaC compiler and returns a
bounded result containing sanitized diagnostics, command summaries, a report
digest, and Evidence v1 records. It does not upload, publish, plan, apply, or
deploy anything.

The TypeScript runner is separate from the Go compiler. The compiler continues
to construct HCL without subprocess, credential, network, provider, or Terraform
access. The runner cannot change compiled files or claim customer account
validation.

## Fixed command protocol

Artifacts never select an executable, subcommand, flag, or configuration path.
The runner constructs only these exact executable-plus-argument arrays:

| Step                   | Exact invocation                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Format                 | `terraform fmt -check -recursive -no-color .`                                                                     |
| Initialize             | `terraform init -backend=false -get=false -input=false -lockfile=readonly -no-color`                              |
| Validate               | `terraform validate -json -no-color`                                                                              |
| Optional lint          | `tflint --chdir=. --format=json --no-color --force`                                                               |
| Optional security scan | `trivy config --format json --exit-code 0 --quiet --disable-telemetry --skip-version-check --skip-check-update .` |

Subprocess creation uses an executable and argument array with `shell: false`.
There is no `plan`, `apply`, destroy, import, console, arbitrary shell, or
artifact-selected command path. Optional TFLint, Trivy, and organization-policy
hooks are exact policy commitments; required-tool absence is an error and
optional-tool absence is a warning.

## Admission and deterministic dependencies

Only checksum-valid `infrastructure/*.tf` regular files within configured
file-count, individual-byte, and aggregate-byte limits are accepted. Portable
case/NFC duplicate paths, local paths, secret-shaped content, real backend
blocks, provisioners, `local-exec`, `remote-exec`, external data commands,
remote state, unsupported provider names/sources/versions, and unsupported
module source/version pairs fail before a workspace is opened.

Policy v1 binds the exact compiler, Terraform, validation image, read-only
provider lock, prepackaged provider mirror packages, optional modules, TFLint,
Trivy, and organization-policy configurations by version and SHA-256 digest.
Provider and module coordinates must be unique. Initialization disables backend
and module retrieval and uses the image's filesystem mirror and CLI
configuration. An approved coordinate does not authorize a download: if bytes
are absent from the reviewed image, initialization fails offline.

The local adapter accepts only an absolute, operator-trusted Docker or Podman
binary. It runs the digest-pinned image with no network, no privilege, no added
capabilities, `no-new-privileges`, a read-only root, bounded no-exec tmpfs,
non-root UID, no inherited AWS/credential environment, a single disposable
workspace mount, and explicit CPU, memory, process, output, wall-time, file, and
total-byte limits. It inspects the workspace for symlinks and non-regular or
oversized outputs after every command and removes the exact temporary workspace
after collection.

## Diagnostics and Evidence

Tool output is parsed structurally where available, normalized, sorted by UTF-16
order, capped at 1,000 diagnostics, stripped of control characters, and redacted
for secret-shaped values, signed URLs, and local machine paths. File diagnostics
recover exact Solution Revision, node, edge, and owned-policy references from
the compiler-provided provenance map when a unique path match exists.
Organization-policy output is revalidated against the public diagnostic schema
before it enters the result.

The result contains two Evidence v1 records at deterministic target-compilation
level: one binds the exact compiler artifact, and one binds the static report,
image, lockfile, provider/module packages, optional-tool configurations, and
non-informational finding IDs. These returned records are data only. No Evidence
is persisted, promoted, or used to mutate immutable Solution Revision coverage.

## Synth-only AWS sandbox

The existing Application stack contains one inert `AWS::CodeBuild::Project`; the
platform still has exactly four resource-bearing stacks. The project has no
source, artifact trigger, event rule, caller grant, or deployment command. It
uses:

- one digest-pinned private-ECR image coordinate and service-role image pull;
- `BUILD_GENERAL1_SMALL`, explicit build/queue timeouts, one concurrent build,
  no retry, no cache, no badge, and `PrivilegedMode: false`;
- one fixed image entrypoint command;
- isolated subnets with no NAT and a validation security group whose only egress
  is TCP 443 to dedicated S3 and CloudWatch Logs interface endpoints;
- endpoint policies and service-role IAM restricted to the validation input
  prefix, validation Evidence prefix, exact log group, exact ECR repository, and
  Region-conditioned CodeBuild ENI operations;
- no STS assume-role, PassRole, customer-role, deployment, CloudFormation,
  Lambda invocation, or customer-account permission; and
- S3-managed encryption, versioning, artifact-prefix expiry, retained Evidence,
  bounded log retention, timeout/concurrency controls, and an explicit monthly
  build-minute control value for a later authorized scheduler.

The configured development image digest is a deterministic synthesis coordinate,
not proof that an image has been published. Before any separately authorized
deployment, release review must publish and attest the exact image, provider
mirror, lockfile, tool/config bytes, and then update the reviewed digest. Prompt
32 did not build or push that image. Prompt 2 now supplies and locally builds a
candidate context, but no workflow has published or attested it and nothing is
deployed.

## Remaining boundary

Prompt 32A is implemented as the separate
[application-build runner](APPLICATION_BUILD_EXECUTION.md). Terraform validation
still does not install application dependencies, execute generated application
tests, build Lambda source, package application artifacts, or attest registry
bytes; the two runners use distinct requests, executors, CodeBuild projects,
roles, logs, and artifact prefixes. Persistence/publication, Repository Snapshot
authorization, job scheduling, active budget enforcement, retention/audit jobs,
customer-cloud validation, planning, applying, and deployment remain
unimplemented and unauthorized.

## Prompt 36A extension-validation mode

The runner now has an additive extension context; the original request for a
deterministic artifact remains unchanged. Extension admission requires the exact
compiler baseline artifact/tree digest, immutable Solution Revision, Prompt 24D
extension and approved slot, model-output and candidate-bundle digests, owned
candidate paths, protected baseline paths and Terraform addresses, and explicit
provider/resource allowlists.

The runner recomputes the complete tree and candidate-subset digests, parses
HCL, and applies the existing secret/path/limit controls plus deterministic
collision and provenance checks. Any module, backend, provisioner,
shell/external command, plan/apply/import/state/test-run construct, unapproved
provider/resource, or shadowed deterministic path/address fails before or during
the fixed offline command sequence.

Extension mode emits one exact level-4 `ai-extension-parse-static-validity`
Evidence record; it never re-labels the candidate as level-3 deterministic
target compilation. Results remain data for the Prompt 36A coordinator, which
creates Active Issues and requires explicit acceptance. The runner cannot
accept, write, merge, plan, apply, or deploy the candidate.
