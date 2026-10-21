# ADR-0031: Immutable Solution Revision export orchestration

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Accepted
- **Date:** 2026-08-18
- **Owners:** Cloud Markup engineering
- **Supersedes:** None
- **Superseded by:** ADR-0037, only for the exact single generated application
  build-contract limit

> **Partial supersession note (2026-08-27):** ADR-0037 replaces only the exact
> one-build-contract limit recorded below with a bounded, canonical
> multi-artifact build batch. The historical version 1 wording remains
> unchanged, and every other decision in this ADR remains current.

## Context

Prompts 29 through 32A established independent deterministic boundaries for
Terraform compilation, supported application-source generation, isolated
application verification, Terraform static validation, and deterministic ZIP
assembly. Prompt 25 established one durable asynchronous job lifecycle, and
Prompt 21 established tenant-scoped metadata plus content-addressed object
storage. Those parts do not yet form one authorized user workflow.

An export request must never drift from one immutable Solution Revision to a
newer draft or target policy during a retry. Failed compilation, generation,
build, test, or validation must remain inspectable without accidentally making
unsafe output downloadable. A browser route selector, artifact identifier, or
download URL cannot establish tenant authority. Assistance mode must not change
the operation being performed.

## Decision

Add one versioned `solution-export-orchestration` Async Job family and a
separate Solution-Revision-bound API/read model. Do not reinterpret the legacy
endpoint that exports an already-existing artifact.

### Immutable authority and idempotency

- The public create request contains only an authorized immutable Solution
  Revision selector, an environment selector, an approved target-profile ID, and
  a bounded sanitized export name.
- The API resolves and validates the exact Solution Revision manifest record,
  object digest, project/organization ownership, generation coverage, and a pure
  entitlement decision before it attempts a durable job claim. Any future quota
  or credit reservation belongs inside the idempotent claim/enqueue
  implementation; pure entitlement evaluation does not reserve capacity.
- The durable job subject pins the exact manifest record and digest. The
  approved settings snapshot is stored as a content-addressed input object.
  Checkpoints retain only exact opaque object references and digests.
- Async Job v1 owns the caller-key claim, any durable reservation, leases,
  internal attempt context, cancellation, and audit semantics. The caller-key
  conflict check hashes only the exact primary request selectors and therefore
  excludes the server-selected previous-export baseline. The first claim stores
  one exact workflow submission, including that fixed baseline. Replaying the
  same caller key and primary input always returns that original run. A new key
  for identical primary input reuses an active run, including
  cancellation-requested state, or a successful run whose artifact remains
  retained and available; a queued replay idempotently re-ensures enqueue. If
  the latest run failed, was canceled, or has an expired success artifact, a new
  key creates the required successor with an incremented `runSequence` and
  `rerunOfJobId`. Each successor fixes its own baseline. Identical verified
  bytes may still share a content digest without collapsing the run lineage.

### Ordered isolated stages

The worker validates/fetches the pinned inputs and invokes typed ports in this
order:

1. infrastructure compilation;
2. supported application generation;
3. isolated application build/test/scan/package when the implementation mode and
   generated handoff require it;
4. Terraform formatting/static validation/scanning;
5. evidence/read-model assembly;
6. deterministic export generation and independent integrity verification;
7. content-addressed artifact publication.

The compiler remains Go-only and never builds application source or runs
Terraform. Runner executors remain allow-listed, argument-array based,
credential-free, bounded, and non-deploying. User-provided source is not
executed unless a separately approved safe profile allows it. Workflow version 1
accepts exactly one generated application build contract when generated coverage
requires a build; zero or multiple required handoffs fail closed rather than
being guessed or merged.

### Failure and download policy

- Infrastructure-only output may succeed and be downloaded, but the exact
  coverage and an `application-code-required` warning remain prominent.
- `generationCoverage` is the immutable Solution Revision assessment.
  Application build/test/scan truth is projected separately as
  `applicationVerification`; it may confirm the generated assessment or
  downgrade readiness, but never rewrites or upgrades the revision assessment.
- Compiler, application-generation, build/test/scan, Terraform-validation,
  packaging, manifest-integrity, or security failure remains visible with
  bounded sanitized stage diagnostics and any valid evidence already produced.
- Public diagnostics retain only a stable code, severity, stage, and safe
  optional repository path, node, edge, workload, or owned-policy reference. Raw
  compiler/runner messages and output never become public provenance. Compiler
  diagnostics are not treated as Terraform static-validation Evidence: the
  validation boundary separately binds `infrastructure-compilation` Evidence to
  the exact compiler artifact and `terraform-validation` Evidence to the exact
  static runner report.
- Cancellation observed between stages, after verified-output persistence, at
  the worker precommit gate, or by the result store before terminal commit wins.
  Staged bytes remain hidden and the public job is canceled without an artifact.
- A permanent publication-integrity mismatch becomes a visible terminal
  publication failure with no artifact. A transient terminal-metadata
  persistence failure leaves the job queued and the artifact hidden so the same
  work item can retry safely.
- A blocking failure produces no final combined ZIP and the server reports
  download disposition `blocked`. There is no review-only failed ZIP in version
  1. This avoids treating partial or unverified files as the reviewed artifact.
- Only an independently verified, tenant-owned final ZIP may receive a
  short-lived principal-bound download grant. The download endpoint reauthorizes
  the current principal and returns safe content type, disposition, cache, and
  content-security headers. It never exposes a storage key, upstream signed URL,
  token digest, credential, or local path.

### Persistence and review

Additive metadata stores the exact job/revision/profile/previous-artifact
bindings, safe stage/read-model state, immutable artifact and file metadata,
semantic/file diff, and expiring/revocable download grants. Large request,
checkpoint, evidence, manifest, preview, and ZIP bodies stay in the
content-addressed object store under staged publication rules. Legacy
architecture-revision artifact tables and endpoints remain compatible.

The final manifest receives a strict `externalStageStatus` assembled by the
workflow from already-persisted application-build and Terraform-validation
reports and Evidence. It binds the selected environment, workflow request,
target settings, report digests, Evidence identifiers, and complete canonical
Evidence digests. The pure exporter still truthfully reports that it did not run
those tools or collect that Evidence itself.

The orchestrator persists digest-bound stage checkpoints independently of the
public polling view. The injected local worker bridges progress into the public
job on a best-effort basis; a failed progress write cannot change durable stage
truth or fail an otherwise valid run. Terminal projection and checkpoints, not
the progress hint, remain authoritative.

One accessible web component presents the same progress, stages, coverage,
diagnostics, Evidence, files, ownership, checksums, diffs, warnings, and actions
in Guided and Professional modes. It renders `runSequence`/`rerunOfJobId`, exact
solution/workload missing requirements, unresolved requirement IDs, coverage
Evidence bindings, application-verification linkage, and safe diagnostic
references rather than substituting generic placeholders. Only explanatory
wording may differ. Server state, not browser inference, controls terminal
status and download readiness.

## Consequences

### Positive

- Every run, internal retry, and artifact can be traced to one exact immutable
  revision, policy snapshot, fixed workflow submission, run lineage, and
  previous-export baseline.
- Failed verification remains explainable without publishing an ambiguous
  downloadable package.
- Existing compiler/generator/runner/export trust boundaries remain separately
  testable and replaceable through provider-neutral ports.
- Tenant authorization, commercial hooks, object publication, and expiring
  download policy have one reviewable server authority.

### Negative

- The export read model and object publication require reconciliation in
  addition to the generic job record.
- A user cannot download partial files after a blocking stage failure in version
  1; diagnostics and evidence remain available in the review UI.
- A callable local composition exists for integration: it accepts injected
  compiler and bounded executors and uses the concrete generator, build-runner,
  Terraform-runner, and exporter adapters. Hosted composition remains
  fail-closed until approved SQL, object-store, queue, executor/cache, and
  operational-monitoring adapters are wired.
- Adding an Async Job family and public API creates compatibility obligations
  for its schemas, migrations, polling view, and retention policy.

### Follow-up

- Prompt 33A may add deterministic diagram artifacts without changing this
  revision/download authority.
- Prompt 33B may add CLI and pull-request verification over the exact reviewed
  artifact; it may not add deployment authority.
- Before production enablement, approve commercial feature mappings and any
  durable reservation policy for complete application generation, executor/cache
  profiles, retention, reconciliation, and alerting.

## Alternatives considered

### Reuse the legacy artifact-export job

Rejected because it starts from an existing artifact and cannot prove the
complete Solution Revision, target-policy, stage, or evidence lineage.

### Treat combined packaging as the aggregate workflow

Rejected because that family accepts already-produced artifact references. It
does not represent compilation, generation, verification, or failure state.

### Resolve the newest draft or revision on retry

Rejected because it breaks reproducibility, authorization intent, idempotency,
commercial reservation, and audit lineage.

### Publish a review-only ZIP after blocking verification failure

Rejected for version 1 because a partial package is easily confused with the
reviewed artifact and can omit required build or validation output. The safe
read model preserves failure details without issuing a ZIP.

### Put tenant or entitlement claims in the request body

Rejected because browser data and route selectors are untrusted. Verified
authentication context and server repositories remain authoritative.

## Compatibility, security, and rollback

Contracts and migrations are additive, strict, bounded, and versioned. The
legacy generation/export/artifact API remains unchanged. Disabling the new
routes and worker stops new work while immutable run and artifact records stay
readable; no destructive down migration is required. Object access, preview,
diff, cancellation, and grant mint/consume paths repeat exact tenant ownership
checks and hide cross-tenant selectors.

No stage receives customer AWS credentials or deployment permission. No worker
runs `terraform plan`, `terraform apply`, customer provisioners, arbitrary
package scripts, repository mutation, or cloud deployment. Sanitization and
bounded schemas exclude prompts, secrets, tokens, local paths, internal logs,
and temporary signed URLs from public state.

## References

- [ADR-0005: Export without deployment](0005-export-without-deploy.md)
- [ADR-0021: PostgreSQL metadata and versioned object storage](0021-postgresql-data-api-and-object-storage.md)
- [ADR-0022: Verified principal and organization authorization](0022-verified-principal-and-canonical-organization-authorization.md)
- [ADR-0026: Provider-neutral durable async job framework](0026-provider-neutral-durable-async-job-framework.md)
- [ADR-0029: Deterministic Terraform and application artifact boundary](0029-deterministic-terraform-and-application-artifact-boundary.md)
- Solution export workflow plan
- [Security principles](../architecture/SECURITY_PRINCIPLES.md)
