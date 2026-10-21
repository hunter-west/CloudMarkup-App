# Cloud Markup application-build image

This context builds the bounded Node.js 24 execution image consumed by the
application-build runner and the inert application-build CodeBuild project. It
is validation-only. The control service imports no AWS client, credential
loader, or network client and exposes no shell-command API, deployment command,
Docker socket, or package-script authority. The frozen dependency closure does
include the approved AWS SDK client bytes needed to validate generated
applications, but the service receives no credentials and runtime egress is an
outer-orchestrator control.

## Authority and contract

The semantic source, artifact, coverage, and Evidence contracts remain
authoritative in packages/application-build-runner and
docs/architecture/APPLICATION_BUILD_EXECUTION.md. The image service is the
lower-level workspace executor adapter; its result cannot independently make an
application export-ready or serve as Build Evidence. The aggregate request's
request, revision, workload, and cache digests are bounded correlation labels,
not independently established semantic authority; the package runner must
validate and bind those authorities before any export.

The service accepts no arguments. It reads exactly:

- /workspace/input/application-build-request-v1.json, conforming to
  service/input-schema-v1.json; and
- /workspace/input/application.tar, an uncompressed canonical ustar archive with
  bounded per-file PAX path metadata whose exact path, size, SHA-256, and
  complete regular-file inventory are bound by the request.

It writes exactly /workspace/output/application-build-result-v1.json, conforming
to service/result-schema-v1.json. Exit 0 means every applicable fixed step
passed, exit 2 means admission or validation failed, and exit 70 is reserved for
an unexpected internal failure. Output contains no timestamps, environment dump,
credential, source bytes, absolute host path, or unredacted tool output.

The accepted profiles are the existing generated Node.js 24, AI-assisted custom
Node.js 24, and static-only user-source profiles. The request carries the
upstream canonical build-request and Solution Revision digest labels. Generated
and AI-assisted profiles run, in order:

1. hook-free frozen pnpm install from /opt/cloudmarkup/pnpm-store;
2. ESLint;
3. TypeScript type-check;
4. one-or-more Vitest unit tests;
5. one-or-more Vitest contract tests;
6. offline Trivy dependency scanning;
7. offline Trivy secret scanning;
8. TypeScript compilation; and
9. hook-free production prune.

The user-source profile runs only lint, type-check, and both scans. It never
executes source/tests, compiles, packages, or establishes complete coverage. It
intentionally does not install repository dependencies; source that cannot be
resolved by the fixed static toolchain fails closed instead of receiving an
executable dependency view. Fixed executable/argument arrays match
packages/application-build-runner/src/commands.ts; input cannot select a binary,
argument, script, directory, scanner option, or output path.

Running the image without arguments retains that aggregate service as its
default entrypoint, including for the inert CodeBuild project. The existing
package-local per-step container adapter is a separate compatibility surface:
after it validates one exact approved invocation, it passes a closed-map
absolute `/opt/cloudmarkup/bin/{pnpm,eslint,tsc,vitest,trivy}` wrapper through
Docker or Podman's `--entrypoint` option before the digest-pinned image and
places only the approved fixed arguments after the image. It never forwards a
request-selected executable or path.

## Security envelope

- Runtime/tool pins are Node.js 24.18.0, pnpm 11.16.0, ESLint 9.39.5,
  typescript-eslint 8.65.0, TypeScript 6.0.3, Vite 8.1.5, Vitest 4.1.10, and
  Trivy 0.74.0.
- Per-file, total-tree, file-count, path, output, process, memory, CPU, and
  wall-time maxima do not exceed APPLICATION_BUILD_V1_MAXIMA. The service
  directly enforces workspace, output, and wall-time bounds; the outer
  container/CodeBuild definition enforces PID, memory, CPU, and writable-tmpfs
  bounds.
- Only normalized application/** UTF-8 text files with the documented media
  types are accepted. One length-bound POSIX per-file PAX path record may
  preserve a generated contract filename exceeding the ustar name field. It must
  immediately precede a regular file; both headers use the same path-hash
  placeholder. Global, duplicate, unknown, size/link, sparse and other archive
  extensions remain denied. Traversal, portable collisions, links, devices,
  executable members, package-manager hooks, lifecycle scripts, caches,
  state/plan/source-map files, unknown types, and secret-shaped content fail
  closed.
- Extraction uses a newly empty bounded workspace, exclusive writes,
  regular-parent checks, and no shell. Every tool sees a scrubbed fixed
  environment whose scratch/cache homes remain on outer `/tmp`, never inside the
  authority-bound application tree.
- A canonical path/kind/mode/size/SHA-256 workspace manifest binds every
  admitted source, test, configuration, package, and lock byte. Install may add
  only `application/node_modules/**`; compilation may add only
  `application/dist/**`; prune may change only node_modules. All other steps
  must be persistently read-only, and source, dependency, and compiled-output
  authority is rechecked after every step. Links, unsafe modes, portable
  collisions, unauthorized paths, and post-test or post-compile mutation fail
  closed.
- The package-local container adapter additionally mounts the workspace
  read-only for lint, type-check, tests, and scans. The aggregate image kills
  the original process group and every other live process in its required PID-1
  container namespace before it accepts a step result. It inspects failed steps
  too and removes the disposable workspace before every return.
- Runtime network access is denied by the existing container adapter using
  network none and by the CodeBuild no-public-egress security group. Every
  package/scanner operation is explicitly offline and skips updates; both fixed
  Trivy commands also disable telemetry and version checks.
- The image runs as numeric UID/GID 65532:65532, removes base-image setuid and
  setgid bits, is non-privileged, and is compatible with a read-only root. Only
  the caller-provided /workspace mount and outer bounded /tmp tmpfs are
  writable. Trivy 0.74 requires a writable database for its local file lock even
  with updates and network disabled. Its fixed wrapper therefore admits only
  byte-identical copies of the two image-bound frozen database files beneath
  `/tmp/cloudmarkup-trivy-cache`; links, hard links, unknown entries, or changed
  bytes fail closed. The pre-OIDC tool self-test provides a 2 GiB tmpfs. The
  per-step local adapter instead mounts one private, disposable host cache at
  that exact subpath only for the two scan steps, avoiding a 1.3 GiB memory
  copy.
- Cancellation and wall/output limits kill the active child process. Tool output
  is bounded and redacted before entering deterministic JSON.

Unsupported operations include package scripts, arbitrary commands, network
resolution, AWS/customer credentials, Terraform, repository writes, model calls,
artifact upload, deployment, and final Evidence issuance.

## Offline materialization

No opaque dependency cache is committed. Before OIDC, the credentialless
materializer byte-verifies the exact pnpm 11.16.0 launchers and complete runtime
closure: package metadata, bundled implementation, and adjacent worker module.
It copies only that verified runtime closure with its original relative layout
into isolated staging, verifies the committed v9 toolchain lock and repository
lock authority, and performs a frozen, scripts-denied fetch with an exact
source-declared linux/x64/musl supported-architectures workspace configuration.
The fetch uses one network operation and one tarball worker at a time. A fixed
Node preload changes `Date.now()` to a reviewed negative sentinel only inside
pnpm worker threads, where pnpm records CAFS `checkedAt` values; the main thread
retains its real clock. The sentinel is deliberately more than 100 milliseconds
before an epoch-normalized file: pnpm's pinned integrity logic therefore
re-hashes every normal CAFS file instead of trusting a future cache timestamp.
It normalizes only pnpm-generated project-registration links and CAFS hard links
into a final link-free v11 store, then stages that store, the exact
byte-verified pnpm JavaScript runtime closure, and frozen Trivy database beneath
declared generated prefixes. The same descriptor acquires the exact signed
Alpine v3.24 `libcrypto3` and `libssl3` 3.5.9-r0 packages. Their repository
signatures, committed SHA-256/size authorities, exact installed versions, and a
repository-free `/sbin/apk add --no-network --no-scripts` upgrade is checked
before those APK bytes are removed. This avoids relying on a host-native
standalone binary. Trivy is materialized from the pinned Go source/build inputs,
checked against the reviewed binary digest, and copied from `offline/bin/trivy`
into the image. The inherited npm, npx, Yarn, and unused Node image entrypoint
are removed and asserted absent; only Cloud Markup's frozen pnpm runtime and
exact service entrypoint remain.

The host SQLite file is not context authority: SQLite page layout and pnpm's
concurrent insertion order can vary without changing package meaning. After
fetch, the materializer exports every `package_index` key and raw MessagePack
value in byte-sorted canonical JSON, removes `index.db`, and binds that logical
index and every remaining preimage-store byte in
offline/pnpm-store/manifest-v1.json. Inside the pinned Node 24 image only, the
reviewed converter validates that JSON, recreates the exact pnpm 11 schema with
ordered inserts, and then runs the frozen offline toolchain install with pnpm's
real clock and explicit store-integrity verification. The already hash-bound
toolchain lock is passed with `--trust-lockfile`, which suppresses pnpm 11's
otherwise-online registry metadata re-verification without weakening exact
lockfile or package-byte checks. The build proves the frozen install leaves the
reconstructed SQLite file byte-identical and creates no journal, shared-memory,
or WAL sidecar, then removes both build-only preimage inventories. The protected
context digest therefore binds the portable preimage; the resulting immutable
image digest binds the derived runtime SQLite bytes. Neither conversion nor
install has network access or mutable dependency resolution. Committed JSON
remains capped at 1 MiB; only the two deterministic generated inventories and
canonical store index receive their separately bounded generated-data ceilings.
Missing bytes, link/special entries, lock or schema drift, checksum drift,
license omissions, oversized inventories, SQLite sidecars, host `index.db`
bytes, or undeclared members stop before OIDC.

The canonical context tar uses plain ustar for representable members and one
deterministic POSIX PAX `path` record only when a valid content-address basename
exceeds ustar's field. Re-extraction compares that metadata, path, padding,
member bytes, coverage, size, and whole-archive digest exactly before a Docker
build directory is admitted.

## Self-test

Run without Docker or network:

    node --test infra/images/application-build/service/self-test.mjs

The suite covers accepted generated input; lint, type, unit, contract, and
compile failures; source, dependency, unauthorized-path, hard-link, and
compiled-output mutation; traversal, malicious paths, dangerous archive members,
oversize and malformed input, unsupported runtime, command injection,
network-denied fixed commands, unavailable dependencies, source-secret
rejection, failed-step cleanup, diagnostic redaction, and repeatability. A
separate built-image PID-1 test proves a detached new-session child cannot keep
writing after supervisor reaping. The image build runs the source suites again
on exact Node.js 24.18.0.

The local suite uses an injected fake process boundary and therefore proves
admission, sequencing, failure, and redaction behavior without claiming that an
image was built. During the image build, the separate tool self-test uses a
disposable child beneath `/opt/cloudmarkup/toolchain` so normal Node and
TypeScript upward resolution reaches the exact installed toolchain; it removes
that child before the layer completes. This is not the runtime application
workspace, whose dependencies are installed from its own bound manifest and
lockfile. The credentialless workflow must build the linux/amd64 image and run
the exact pinned tools before publication.

Trivy uses the [reviewed Go source build](../go-tools/README.md), including its
exact dependency patch and Apache-2.0 license. The final runtime copies the
verified binary from credentialless preparation and performs no tool download or
source build. A current final image scan remains required for admission.

The workspace per-file limit continues to apply to source and arbitrary
dependencies. Four exact files in the pinned offline toolchain exceed that
limit: the two TypeScript compiler modules and the Linux musl Rolldown and
Lightning CSS bindings. Admission requires their exact path, byte length and
SHA-256 before applying the exception. They still count toward total workspace
bytes/files, and every later step must preserve their bytes and mode. A known
path with different content or an oversized unlisted dependency fails closed.

Actual generated-code acceptance uses regular pnpm executable shims, with
`prefer-symlinked-executables=false`; all workspace links remain forbidden.
Vitest runs with `--no-cache` so it does not mutate the bound dependency tree.
The production-prune stage uses `install --prod` with the same exact offline
store, frozen lock/store, no-hook, no-runtime and layout options as admission.
Before the production install, the executor verifies the exact installed and
compiled trees, then removes only its owned `application/node_modules` tree. The
frozen production install starts clean: an incremental hoisted install otherwise
leaves development shims. The default prune command also changes layout and
tries network resolution.

Trivy’s pinned pnpm analyzer may emit a nonempty package inventory without an
empty findings property. Only its exact `pnpm-lock.yaml` / `lang-pkgs` / `pnpm`
row with valid package identities admits that omission. Malformed collections
remain errors. The package runner rejects oversized scan collections instead of
truncating them, so a finding after the previous 256-entry cutoff cannot produce
a passing artifact.
