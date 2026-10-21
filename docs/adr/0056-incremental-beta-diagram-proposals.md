# ADR-0056: Incremental beta diagram proposals

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Accepted following owner approval and implementation review
- **Date:** 2026-09-21
- **Owners:** Cloud Markup engineering and the beta owner
- **Supersedes:** ADR-0055's requirements-only projection for explicitly
  selected proposal versions 2/3 and its synchronous deadline for the new job
  endpoints
- **Superseded by:** None

## Context

The owner approved sending Region, resource IDs/types/labels and relationships
to the existing fixed Bedrock model for follow-up requests. A live synthetic FSx
request needed 39.846 seconds, exceeding the legacy 20-second HTTP deadline.
Configuration values, credentials and application source remain excluded.

## Decision

Preserve the request/response envelope and requirements-only proposal v1.
Proposal v2 adds bounded existing-resource references and workload purpose. V3
adds typed configuration proposals for the current catalog, including FSx and
owned networking. Existing graph configuration is never sent to the model. Only
the reviewed Lambda VPC execution managed policy may be proposed directly; other
generated IAM comes from deterministic connection recipes.

New POST/GET/DELETE beta-infrastructure-jobs endpoints reuse the existing
architecture-proposal job family, database schema, immutable objects and audit.
Admission requires current tenant editing capability, active project, document
identity and saved draft precondition. Its idempotency key binds the original
one-hour expiry. Saved draft content and the unsaved client baseline have
separate hashes. Worker execution rechecks current membership, project, draft
version, lease, cancellation and expiry before dispatch and publication,
including a three-second cancellation check while the model runs.

The dedicated two-concurrency SQS worker has a 240-second runtime, two attempts,
420 aggregate runtime seconds and bounded output. Model calls use the existing
fixed Claude Sonnet model, one SDK attempt and a 180-second timeout. Transport,
role, queue encryption/retention and consumer settings are admitted exactly.
Browser requests remain short, poll progress and cancel the exact admitted job;
an uncertain POST retry retains its idempotency key. Legacy synchronous callers
retain their deadline and contract.

The model receives at most 100 editable resource IDs/types/labels and their
relationships, plus Region and the user's requirements. Credential candidates
are rejected. Strict output schemas reject duplicate or fabricated references,
ambiguous parents and undeclared resources. All proposed changes pass ordinary
deterministic graph commands. Resources, trust relationships and owned network
configuration are prepared in dependency order, then committed as one explicit,
atomic, reversible user action against the original local graph hash.

## Consequences

Background execution fixes requests that outlive the API gateway deadline and
supports visible cancellation. It adds retained job input/output and an isolated
queue/worker but no database migration. Existing documents and proposal v1/v2
remain readable. Catalog 0.17 upgrades separately through an explicit reversible
binding command that preserves 0.16 history and stable resource identities.

Context minimization means the model cannot infer configuration it has not
received. Reconfiguration/deletion of existing resources remains in the editor.
Source generation is a distinct opt-in export decision in ADR-0057; no proposal
executes code or grants compiler deployment/model authority.

Regression evidence includes actual PostgreSQL idempotency, duplicate delivery,
cross-tenant denial, revoked membership, stale saved drafts, unsaved baselines,
cancellation, exact policy output and atomic undo. Rollback removes new
admission and the worker together while leaving historical jobs/documents
readable.

## Alternatives

A longer synchronous HTTP call still fails at the ingress deadline. Sending the
whole graph exceeds the approved projection. Replacing the graph loses user
edits and is unnecessary for additive requests.

## References

- [Original beta boundary](0055-functional-beta-infrastructure-assistant.md)
- [Source-draft export](0057-opt-in-beta-application-source-drafts.md)
- [Model gateway](../architecture/MODEL_GATEWAY.md)
- Execution plan
