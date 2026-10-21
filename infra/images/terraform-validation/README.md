# Terraform validation image context

## Purpose and authority

This `linux/amd64` image supplies the real offline executables used by
`@cloudmarkup/terraform-validation-runner`. The package runner's strict
version-1 request, policy, result, diagnostics, and Evidence schemas remain the
semantic authority. This image is an operational adapter: it admits only the
runner's five exact executable/argument arrays, verifies the reviewed runtime
bytes, and executes one step without a shell.

The required sequence is fixed by the runner:

1. `terraform fmt -check -recursive -no-color .`
2. `terraform init -backend=false -get=false -input=false -lockfile=readonly -no-color`
3. `terraform validate -json -no-color`
4. `tflint --chdir=. --format=json --no-color --force`
5. `trivy config --format json --exit-code 0 --quiet --disable-telemetry --skip-version-check --skip-check-update .`

The image cannot accept a plan, apply, destroy, import, console, arbitrary
subcommand, shell string, module download, provider download, backend, remote
state, provisioner, external command, customer credential, AWS role, or deploy
request. A no-argument invocation fails closed; the existing CodeBuild project
is intentionally inert and has no production scheduler/input adapter.

## Contract

- **Accepted input:** only checksum- and provenance-validated regular
  `infrastructure/**/*.tf` files plus the exact reviewed lock materialized by
  the host runner. Input remains bounded to 512 Terraform files, 4 MiB per file,
  and 16 MiB total. Portable duplicate names, unsafe characters, links, special
  files, hard links, non-Terraform files, invalid UTF-8, credential assignments,
  backends, remote state, provisioners, and external execution fail before a
  tool starts.
- **Output:** Terraform/TFLint/Trivy stdout and stderr return to the package
  runner. That runner caps, parses, redacts, normalizes, sorts, and emits the
  authoritative `TerraformValidationResultV1` plus at most two Evidence v1
  records. Adapter denials use `schemas/service-error-v1.schema.json`; the image
  self-test uses `schemas/self-test-result-v1.schema.json`.
- **Exit behavior:** tool status is returned unchanged; adapter invocation
  misuse is 64, rejected input is 65, wrong runtime user is 77, and internal or
  runtime-integrity failure is 70. Only a successful fixed tool step returns 0.
- **Pins:** Node.js 24.18.0 on Alpine 3.24, Terraform 1.16.2, TFLint 0.64.0,
  Trivy 0.74.0, Alpine `libcrypto3`/`libssl3` 3.5.9-r0, and
  `registry.terraform.io/hashicorp/aws` 6.63.0 for `linux_amd64`.
- **Timeouts/resources:** the host policy caps CPU at 120 seconds, wall time at
  300 seconds, memory at 4 GiB, processes at 64, and captured output at 2 MiB.
  Generated `.terraform` scratch is separate from customer-input limits, rejects
  links/special files, and is capped at 512 files, 1 GiB per file, and 2 GiB
  total so the exact reviewed AWS provider can be initialized.
- **Writable paths:** the engine-managed private volume at
  `/workspace/terraform-data` and bounded `/tmp` only; admitted source at
  `/workspace/infrastructure` is private to the same volume. The image root and
  reviewed tools, policies, mirror, cache, schemas, and notices are read-only.
  Runtime UID/GID is `65532:65532`; inherited base-image set-ID bits are removed
  during the build.
- **Network/credentials:** runtime must use container network `none`. The only
  provider installation method is the exact filesystem mirror. Checkpoint,
  registry fallback, backends, proxies, credential variables, inherited
  environment, and AWS metadata are denied. Child tools receive a new safe
  environment rather than the service environment.
- **Data/logging:** source is untrusted tenant data. The adapter never prints
  it, environment values, local host paths, or secrets. Its errors contain only
  closed codes and messages. The host runner owns content redaction, tenant
  authorization, retention, report digests, and Evidence.

## Deterministic offline inputs

`offline/acquisition-v1.json` contains exact public archive/file and Go
source-build recipes, plus the pinned OCI vulnerability database. The final Node
Alpine runtime installs only checksum- and size-bound official signed
`libcrypto3` and `libssl3` 3.5.9-r0 APKs with networking disabled, then removes
the APK inputs, bundled npm/npm/npx and Yarn/yarnpkg, and the unused base-image
entrypoint before the runtime is admitted. The credentialless preparation job
verifies archive size and SHA-256, constrains redirects to reviewed hosts and
paths, rejects undeclared archive members, and retains the provider ZIP in
Terraform's packed mirror layout. Terraform, TFLint and Trivy are built from
exact public commits with the [reviewed Go recipe](../go-tools/README.md).
Dependency acquisition occurs before a separate network-disabled compilation;
only exact binary and license bytes enter the runtime context. Generated paths
are absent from Git and become exact members of the staged context manifest
before hashing/building. No acquisition or dependency resolution is permitted
after OIDC.

The saved-image Trivy scan does not inspect the executable nested inside the
packed provider ZIP. Prepublication verification must therefore also extract the
exact `zh:`-bound provider package into a private temporary root and run the
pinned offline Trivy database against that root. The image scan and the separate
provider-root scan are both required; neither substitutes for the other.

`offline/.terraform.lock.hcl`, `offline/provider-mirror/index-v1.json`, and
`offline/tool-binaries-v1.json` bind the same exact packages. The provider lock
retains both the exact packed-archive `zh:` authority and the `h1:` authority
computed from the exact provider ZIP members. The real offline Terraform init
self-test must verify that lock against the mirror. `terraform.rc` declares only
the offline mirror and disables checkpoint calls. Trivy config scanning disables
telemetry, version checks, and policy-check updates in its fixed arguments while
container network `none` remains authoritative. The pinned Trivy binary and
exact pre-OIDC database snapshot are bound by the Dockerfile, staged context,
final OCI digest, SBOM, scan, provenance, and signature.

## Self-tests

Credentialless source tests run with:

```powershell
node --test infra/images/terraform-validation/self-test/context.test.cjs
```

The built-image test runs `/opt/cloudmarkup/self-test/run.mjs` with network
`none`, a read-only root, a bounded writable workspace/tmpfs, dropped
capabilities, `no-new-privileges`, and UID `65532`. It exercises accepted
format/init/validate/lint/scan behavior, syntax failure, a missing offline
provider, fixed-command denials for apply/destroy/import/injection, backend and
archive rejection, unsafe names, symlink escape, oversized input, provider-lock
drift, credential redaction, and repeatability. Context admission separately
tests acquisition archive traversal, provider/tool checksum drift, unexpected
members, hard links, canonical context hashing, and Docker policy.

The image workdir is `/workspace`, so mounting a temporary filesystem there does
not hide a required child before OCI startup. The self-test mount must use exact
`uid=65532,gid=65532,mode=0700` ownership; the non-root test then creates
`/workspace/infrastructure` and `/workspace/terraform-data` itself.

Neither test deploys, plans, contacts AWS, reads credentials, or mutates a
repository. The candidate context digest is review evidence only; Hunter must
independently recompute and approve it from the exact reviewed `main` revision.

For the local adapter only, one fixed preparatory container runs as root with a
read-only bind of the already-admitted host input and a new private engine
volume. It has no network, no forwarded environment, a read-only image root,
`no-new-privileges`, all capabilities dropped except `CHOWN` and `DAC_OVERRIDE`,
and the single fixed `prepare` entrypoint. It copies regular files once, sets
restrictive UID/GID 65532 ownership, then the host input is deleted. It cannot
run Terraform. Every validation step and the bounded post-step inspector run as
UID 65532 with all capabilities dropped; disposal removes the exact volume.
