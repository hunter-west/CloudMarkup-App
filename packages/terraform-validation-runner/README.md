# Terraform validation runner

This private package validates one immutable, digest-bound Terraform tree with
fixed `fmt -check`, offline `init -backend=false`, and `validate -json`
commands. Approved TFLint, Trivy configuration scanning, and organization-policy
hooks are optional exact policy inputs; artifacts cannot select or configure
tools.

The core accepts an injected workspace executor, so tests use deterministic
fakes. The local adapter materializes only validated files in a restrictive
host-temporary directory, then uses one fixed, networkless root staging command
with only `CHOWN` and `DAC_OVERRIDE` to copy them into a new engine-managed
private volume owned by UID/GID 65532. The host temporary directory is removed
before any Terraform command. Normal validation and post-command inspection are
non-root, capability-free, network-disabled, read-only outside the exact volume
and bounded no-exec `/tmp`, and use argument arrays with `shell: false`.

Terraform's executable provider data lives in the volume's separate
`/workspace/terraform-data` path. It is not counted as customer input, but the
fixed non-root inspector rejects links, special or set-id files and applies the
reviewed generated-data count/byte caps after every completed tool step. The
volume name is derived from a random exact temporary root and is removed on
dispose. No host source bind exists during normal validation.

Terraform initialization uses a prepackaged filesystem mirror and an approved
read-only dependency lock. Provider/module downloads, real backends, state,
plans, provisioners, external commands, customer credentials, customer-role
assumption, account access, and apply/deployment are forbidden.

## Interface

`createTerraformValidationRunner({ executor, policy, organizationPolicy })`
returns a local service whose `run(request, { signal })` method accepts one
strict version-1 request and returns one strict version-1 result. Requests bind
the immutable Solution Revision, compiler artifact, exact source checksums,
compiler pin, selected environment, approved validation-runner pin, and
assessment time. Results bind deterministic command summaries, sanitized
provenance-linked diagnostics, a report digest, and compilation/static
validation Evidence records whose actor and environment match those exact
inputs. The interface performs no upload.

Only the fixed commands in `APPROVED_VALIDATION_COMMANDS` are executable. The
required chain is Terraform `fmt -check`, offline `init -backend=false`, and
`validate -json`; TFLint, offline Trivy config scanning, and an organization
policy evaluator are exact approved extensions. Artifacts cannot append flags or
choose a binary.

The TFLint 0.59.1 adapter uses its supported `--chdir=.` form and never accepts
a positional target. The reviewed Trivy 0.74.0 configuration scan fixes quiet
JSON output, disables telemetry and version checks, and uses
`--skip-check-update`; container network `none` remains the independent runtime
enforcement. Vulnerability database update flags are intentionally absent
because this command scans configuration policy rather than packages. TFLint
`--force` and Trivy `--exit-code 0` reserve nonzero exits for operational
failure. Both analyzers must return their documented JSON result array; a
nonzero exit, empty JSON output, or missing result array is an error and cannot
produce passing static-validation Evidence.

`createLocalPinnedContainerExecutor` is the local adapter. Its caller must
provide an absolute operator-trusted Docker or Podman path and a policy whose
image, filesystem mirror, lockfile, provider/module packages, tools, and
configurations are exact digest commitments. The fixed root staging adapter is
not a validation mode and cannot run Terraform or accept a caller command; the
actual validation image default remains UID/GID `65532:65532`.

## AI-authored Terraform extension mode

An optional `extensionContext` discriminates a detached `ai-authored-extension`
request without changing the existing deterministic request shape. The context
binds the extension and approved slot IDs, exact candidate-owned paths and
resource/data addresses, final candidate-artifact and raw model-output digests,
the canonical model descriptor, official schema digests, exact provider IDs,
sources and version constraints, provider/resource tuples, protected
deterministic resource addresses, and the exact compiler
artifact/revision/compiler provenance used as its baseline. Every protected
baseline path must be present with its pinned checksum and must be disjoint from
candidate-owned paths.

The adapter rehashes every file, raw bundle, final artifact, catalog slice and
official schema before invoking the runner. The top-level artifact digest is
recomputed over the complete detached path/checksum tree (protected baseline
plus candidate files), while the candidate digest is recomputed over the exact
candidate subset. Extension-only admission rejects malformed HCL, unowned paths
or addresses, ambiguous resource/data kinds, provider version mismatches,
unknown provider/resource tuples, modules, backend/state/plan constructs,
provisioners/external command paths, and deterministic path or resource-address
collisions before execution. A passing request then uses the same fixed offline
formatter, initializer, validator, TFLint, Trivy, and organization-policy
matrix.

Extension mode returns only rank-4 `ai-extension-parse-static-validity` Evidence
bound to the exact final candidate artifact, canonical model descriptor and
official schemas. It never asserts rank-3 deterministic compilation, mutates
repository files, plans, applies, or weakens deterministic compiler ownership.

## AWS synthesis boundary

The synth-only CodeBuild definition and its four-stack assertions live in
`infra/platform`. Its private endpoint/IAM/image/limit design and honest
publication limitations are documented in
[Terraform static validation boundary](../../docs/architecture/TERRAFORM_STATIC_VALIDATION.md).
No AWS project is deployed by this package or prompt.

## Verification

```powershell
pnpm check:terraform-validation-runner
pnpm check:infra
pnpm cdk:synth
```

## Orchestration handoff

The Solution export workflow passes this runner only the compiler's exact
checksum-bound infrastructure artifact through an injected port. The workflow
verifies the canonical validation report digest, persists the report and all
returned Evidence references, and blocks packaging/publication when validation
does not pass.

This composition adds no Terraform plan, apply, provider download, customer
credential, account access, upload, or deployment authority. The runner cannot
change compiler bytes or application coverage.
