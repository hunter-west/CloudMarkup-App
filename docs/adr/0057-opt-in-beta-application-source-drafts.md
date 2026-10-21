# ADR-0057: Opt-in beta application-source drafts

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Accepted following owner authorization and implementation review
- **Date:** 2026-09-21
- **Owners:** Cloud Markup engineering and the beta owner
- **Supersedes:** ADR-0055's infrastructure-only model output restriction only
  for the explicit ai-source-draft-v1 export selection
- **Superseded by:** None

## Context

The owner requests application source derived from each workload's purpose and
its actual diagram connections, selected explicitly during export. Existing
validated deterministic generators remain valuable but do not implement
arbitrary natural-language behavior. Source alone cannot establish a successful
build.

## Decision

Add the optional ai-source-draft-v1 selector to the immutable export request,
admission digest and persisted job target. It defaults off and is checked again
when restoring a run. The normal export authorization/cancellation fences apply.
Only infrastructure-only exports use this path; it cannot replace deterministic
application generation or supply its verification evidence.

Project at most 100 resource IDs/types/labels, Region, relationships and the
immutable purposes of one to eight Lambda workloads. Exclude configuration,
credentials and existing source. Reject missing purposes and credential-like
content. Call only the existing fixed Bedrock Claude model with a bounded
prompt, output schema and deadline. The approved export role has only that exact
model invocation grant in addition to its existing export permissions.

Validate workload identity, count, bounded content and secrets. The host chooses
all paths under application/ai-drafts, media types and review-required
ownership. Each workload receives index.mjs, index.test.mjs and setup notes; the
directory README records model/prompt/context and immutable revision provenance.
Retained model bytes use the job and immutable context digest for replay.
Changed or revoked authority prevents publication.

The independent ZIP packages these files as ai-generated-review-required. The
host never executes them, installs their imports or builds a Lambda package. The
revision's infrastructure-only coverage and skipped application-build stage
remain accurate. Instructions explain manual environment binding, review,
dependency installation, tests and packaging in the customer's environment. This
does not publish to a repository or deploy customer infrastructure.

## Consequences

Users can export source guided by their saved design without mistaking a model
response for verified application behavior. Generated drafts can still contain
logic errors and require review. This bounded path does not broaden
deterministic source ownership or evidence requirements. There is no database
migration; old requests remain opt-out. New file ownership/media values are
accepted by archive, preview and repository contracts but do not authorize
overwrite or regeneration.

Tests cover opt-out, missing purposes, context minimization, wrong workloads,
revocation, cancellation, immutable admission and ZIP contents. A live synthetic
S3/Lambda/Lustre example generated four files in 67.890 seconds; both JavaScript
files passed syntax parsing. This is not application execution evidence.
Rollback removes new selector admission while retained archives stay readable.
Reconsider automatic build integration only with a separately reviewed sandbox,
dependency policy and native build evidence.

## Alternatives

Silently generating code on every export adds cost and violates user choice.
Pretending drafts passed the deterministic build profile creates false evidence.
Sending all configuration/source exceeds the approved context. These options are
not selected.

## References

- [Original beta boundary](0055-functional-beta-infrastructure-assistant.md)
- [Incremental diagram proposals](0056-incremental-beta-diagram-proposals.md)
- [Application generation](../architecture/APPLICATION_SOURCE_GENERATION.md)
- Execution plan
