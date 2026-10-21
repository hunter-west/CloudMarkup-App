# ADR-0037: Deterministic multi-artifact application build batches

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Accepted
- **Date:** 2026-08-27
- **Owners:** Cloud Markup engineering
- **Supersedes:** ADR-0031's single generated application build-contract limit
- **Superseded by:** None

## Context

ADR-0031 deliberately made the first immutable Solution Revision export workflow
fail closed unless generation produced exactly one application build contract.
That bound kept orchestration, Evidence, and publication unambiguous while the
only complete application pattern was a single notes Lambda.

The curated event-driven slice has solutions with multiple independently
generated Lambda workloads, including SNS fan-out and Step Functions tasks. Each
workload still needs its own Prompt 32A admission, isolated build, tests, scans,
deterministic ZIP, coverage result, and Evidence. Guessing one combined package
would weaken artifact identity, while retaining the single-build limit would
make otherwise supported multi-workload solutions non-exportable.

The change must preserve immutable revision authority, deterministic ordering,
failure atomicity, target-neutral artifact metadata, and the rule that the
compiler derives IAM only from the architecture graph. It must not let a
repository, model, workflow configuration, or source file select commands or
deployment behavior.

## Decision

Add an explicitly versioned, bounded application-build batch contract to the
Solution export workflow. The existing singular Prompt 32A request remains a
valid compatibility form for one build. A batch contains one exact Prompt 32A
request for every eligible generated build envelope and is canonicalized by
workload ID and build-contract digest.

The orchestrator validates the whole batch before execution. Requests must be
unique, must cover the eligible build-envelope set exactly, and must bind the
same immutable Solution Revision, environment, generated source artifact,
approved runtime, dependencies, toolchain, limits, and build settings. Missing,
duplicate, extra, reordered-without-canonicalization, or mismatched entries fail
closed.

The existing `build-application` stage remains one aggregate workflow stage, but
it invokes the Prompt 32A runner once per canonical entry. Each invocation
produces one independently reproducible Lambda ZIP, SBOM, coverage result, and
Evidence record. The stage passes only when every required result passes and
preserves its input coverage. Any failed, blocked, canceled, malformed, or
misbound result blocks the final export; no partial package becomes
downloadable.

The aggregate stage report retains every build Evidence record. The read model
and external-stage status expose a bounded, canonical per-workload verification
collection rather than collapsing it to one result. Supplemental files from all
passing builds are flattened only after rejecting duplicate portable paths,
artifact identities, workload identities, and Evidence identities.

Each final Lambda artifact also receives a target-neutral manifest entry that
binds workload, path, media type, checksum, runtime, handler, compiled
entrypoint, build-contract digest, generation artifact digest, and Solution
Revision. Terraform consumes the final ZIP path and checksum contract;
CloudFormation may consume the same metadata later. This ADR does not add a
CloudFormation renderer.

No part of this batch changes application semantics, IAM authority, source
ownership, CLI execution authority, or deployment authority. Handler source is
still generated only from exact Workload Document and Application Contract
inputs. Prompt 32A remains the only local source-execution boundary.

## Consequences

### Positive

- Multi-workload event solutions can be verified and exported without merging
  handlers or weakening per-workload provenance.
- One failed handler blocks publication while successful build Evidence remains
  inspectable in the workflow read model.
- Terraform and future targets share one final artifact identity without
  granting the IaC compiler source or build authority.
- The singular input remains compatible for existing one-workload exports.

### Negative

- Workflow schemas, persistence adapters, read models, stage reports, and tests
  must handle bounded collections and reject identity collisions.
- A large solution performs multiple isolated builds serially in canonical order
  unless a later decision adds bounded parallel execution.
- Existing clients that assume one application verification must adopt the
  additive collection before presenting multi-workload detail.

### Follow-up

- Close Prompt 45A only after its final aggregate, security, documentation, and
  diff-review gates pass. The implementation now includes event-handler
  generation, per-workload build Evidence, final artifact manifests, repository
  fixtures, and no-credential repository CI verification.
- Keep retention and deletion behavior for build inputs and artifacts in Prompt
  46; this decision does not establish retention periods.
- Reconsider bounded parallel execution only with deterministic aggregation,
  cancellation, resource budgeting, and evidence-order tests.

## Alternatives considered

### Keep exactly one generated build per export

Rejected because curated fan-out and task solutions legitimately contain
multiple Lambda workloads and would remain non-exportable despite complete
contracts and passing builds.

### Merge every handler into one ZIP

Rejected because it couples unrelated runtimes and dependencies, obscures
least-privilege artifact bindings, increases collision risk, and prevents
independent reproducibility and evidence.

### Let the repository workflow discover and build artifacts

Rejected because repository content is untrusted and cannot select execution,
infer contracts, or become the authoritative build/evidence boundary.

### Publish successful artifacts from a partially failed batch

Rejected because a partial Solution package can be mistaken for the reviewed
revision and violates ADR-0031's verified-download-only publication rule.

## Compatibility, security, and rollback

The singular request remains accepted for an exact one-entry build set. The
batch form is additive, strict, bounded, and digest-addressed. Rolling back
batch admission restores the previous fail-closed behavior without deleting
historical reports or artifacts. No request carries credentials, arbitrary
commands, lifecycle scripts, cloud access, or deployment permission. Public
diagnostics remain sanitized and tenant authorization remains outside runner
inputs.

## References

- [ADR-0017](0017-versioned-workload-behavior-and-build-boundaries.md)
- [ADR-0025](0025-canonical-solution-repository-and-evidence-contracts.md)
- [ADR-0029](0029-deterministic-terraform-and-application-artifact-boundary.md)
- [ADR-0031](0031-immutable-solution-export-orchestration.md)
- [ADR-0036](0036-customer-owned-receipt-bound-ci-cd.md)
- [Application build execution](../architecture/APPLICATION_BUILD_EXECUTION.md)
- [Application source generation](../architecture/APPLICATION_SOURCE_GENERATION.md)
- Prompt 45A plan
