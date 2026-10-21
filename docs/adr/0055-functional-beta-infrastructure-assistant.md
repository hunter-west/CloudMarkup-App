# ADR-0055: A bounded infrastructure assistant for the functional beta

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Accepted
- **Date:** 2026-09-17
- **Owners:** Cloud Markup engineering and the beta owner
- **Supersedes:** The evaluation/promotion and platform-reservation
  prerequisites of ADR-0035 and ADR-0043 only for the beta path defined below
- **Superseded by:** None

## Context

The owner explicitly requested a deployed working model and the minimum checks
needed to test the idea. They deferred the comprehensive evaluation campaign and
said the earlier USD 50 limit was not an important release constraint. The
normal model runtime remains unpromoted. Creating synthetic promotion receipts
or weakening its existing admission checks would misrepresent its evidence.

## Decision

Add an explicitly enabled beta infrastructure-proposal endpoint using one fixed
Bedrock global Claude Sonnet 4.6 profile in us-east-1. Its exact API-role IAM
grant and environment switch are reviewed deployment inputs. The ordinary
promoted model runtime, evaluation sources, receipts and policies remain
unchanged.

The beta owner funds these requests; no customer credits are deducted. Each call
has at most 8,000 requirement characters, 4,096 output tokens, a 20-second
deadline and one SDK attempt. Existing edge request controls still apply. This
beta path does not claim a monthly reservation fence or evaluated model quality.

The API verifies the authenticated principal, active project, editing
capability, current draft precondition and architecture identity before and
after inference. It sends only requirements and a fixed catalog subset to the
provider. Prompts and unaccepted results remain in process/browser memory, never
queue messages, object storage, telemetry or database content. It rejects likely
credentials.

The model proposes resources and relationships as strict bounded data. Existing
catalog creation, placement, configuration validation, connection resolvers and
the domain command engine prepare the actual graph preview. Applying it requires
an explicit user action against the unchanged local baseline. One atomic command
and its inverse provide undo. Normal authenticated draft saving and editing
leases remain responsible for persistence. Compiler input remains an immutable
revision.

This release supports small infrastructure diagrams and infrastructure export.
It neither generates business logic nor executes user or model source. The UI
states those limits and shows proposed resources, connections and limitations.

## Consequences and validation

A real synthetic idea must return a provider proposal, pass actual editor
command preparation and compile through the pinned compiler. Focused checks
cover denied and cross-project access, stale heads, malformed output,
cancellation, atomic application and undo. Hosted sign-in, proposal, saving and
download are acceptance checks. This is functional beta evidence, not a
comprehensive model assessment.

Browser session migration0078 is registered independently of proposed AI
migrations0060–0077. Existing migration checksums remain unchanged. The ordered
manifest supports gaps; later migration adoption must account for the already
applied0078 and must not interpret max(version) as proof of absent migrations.

Rollback disables CLOUDMARKUP_BETA_AI_ENABLED and removes the exact model grant;
saved graph records remain ordinary versioned documents. Keep session metadata
and revocation history, and roll application code back only to a
schema-compatible version. Reconsider the normal admission/report path before a
general release, usage-based customer billing, broader models or executable
custom generation.

## Alternatives

The full evaluation and promotion campaign remains appropriate for general
release, but the owner has deferred it. A mocked model would not test the actual
idea. Automatically applying model output would remove the review and domain
validation boundaries and is rejected.

## References

- [Runtime admission](0035-deterministic-ai-evaluation-and-runtime-admission.md)
- [Spending fence](0043-platform-model-dispatch-spending-fence.md)
- Execution plan
