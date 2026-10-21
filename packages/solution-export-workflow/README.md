# Solution export workflow

This private package composes the existing deterministic compiler, application
generator, isolated application builder, Terraform static validator, and
solution exporter through injected ports. It owns no cloud, container, network,
repository-write, Terraform execution, credential, publication, or deployment
authority.

The workflow consumes one exact immutable Solution Revision and approved target
profile plus a canonical `targetSettings` snapshot. That snapshot commits the
renderer/export limits and exact per-stage adapter, profile, and limit digests;
generation also commits pattern/runtime/template pins, build commits toolchain
and dependency-contract digests, and validation commits its policy digest. Every
port receives its committed stage descriptor. The workflow checks cancellation
between every sequential stage and propagates a live signal to an active stage.
Its monitor renews the job lease at a bounded cadence (once per 20
cancellation-poll waits) and fails transiently if polling or heartbeating fails.
It persists only content-addressed checkpoint/output references, verifies the
completed export before making it download-eligible, and returns only bounded
sanitized failure codes. Failed or canceled runs are never downloadable, but
their bounded diagnostics, stage reports, Evidence, and any application-coverage
downgrade remain visible as the distinct job-level `applicationVerification`;
the immutable Solution Revision generation assessment is never rewritten.
Sanitized diagnostics preserve only stable codes, stage/severity, and safe
path/node/edge/workload/owned-policy references. Compiler diagnostics remain
diagnostics; `infrastructure-compilation` Evidence and `terraform-validation`
Evidence are separate canonical records returned by the validation boundary and
bound to its durable report.

`createGoCliSolutionExportCompilerPort` is the concrete compiler boundary. It
always invokes the allow-listed `cloudmarkup-iac` executable without a shell and
with the fixed
`compile --architecture architecture.json --workload workload.json --solution-revision solution-revision.json --target terraform --output -`
argument vector. The injected executor receives only those three bounded
canonical JSON files and bounded output/time/cancellation limits; raw stderr is
never propagated into workflow failures.

`createSolutionExportApplicationGeneratorPort` is the concrete deterministic
application-generation boundary. It checks cancellation, derives the strict
generator request only from resolved immutable sources, the compiler's
normalized model, and the approved generation descriptor, then calls the public
application generator. AI-assisted/custom scaffolds are never built; only
conflict-free starter/complete results with build contracts reach the isolated
build port. Workflow v1 admits exactly one generated build contract and fails
closed before build/publication when generated coverage requires zero or
multiple build handoffs.

`createSolutionExportApplicationBuildPort` and
`createSolutionExportTerraformValidationPort` are concrete adapters over the
established injected runner interfaces. The build adapter requires the exact
durable `ApplicationBuildRequestV1`, including revision/environment, generation
artifact, build envelope, profile, limits, dependency, and toolchain
commitments. The validation adapter derives the exact runner request and binds
the approved validation actor. Host workspace executors remain injected; the
same active-stage `AbortSignal` reaches each long runner. Object and diff
adapters also receive the trusted job/ownership scope.

Passing build artifacts and canonical build/Terraform Evidence records are
data-only supplemental export files with exact checksums and provenance. The
workflow supplies a strict `externalStageStatus` bound to the workflow request,
approved target settings, selected environment, report digests, Evidence IDs,
and full canonical Evidence digests. The ZIP manifest reports those stages as
`passed-before-export` while preserving the pure exporter's truthful
`not-run-by-export` and `not-collected-by-export` placeholders: the exporter
still executes and collects nothing itself.

Cancellation is checked between stages and again after verified-output
persistence. The worker and result-store publication boundary must recheck it
before terminal commit, so late cancellation wins and staged bytes remain
hidden. Permanent publication-integrity failure is terminal review truth;
transient terminal-metadata persistence is retryable and cannot expose an
artifact.

Workflow v1 deliberately uses `restart-from-input` retry semantics. Its
content-addressed checkpoint objects are audit and reconciliation records, not
stage-resume tokens: the orchestrator does not consume a saved checkpoint to
skip work. Every retry re-resolves the exact immutable input and
deterministically re-runs the ordered stages. Injected persistence and worker
adapters therefore must be idempotent within the trusted ownership and job
scope.

API create-job reuse/versioning is a separate concern: same-key replay remains
bound to its original run, while state-aware identical-input reuse or
`runSequence`/`rerunOfJobId` successor creation occurs before this orchestrator
is invoked. Internal retry must not be presented as a new public run.
