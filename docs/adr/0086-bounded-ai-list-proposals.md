# ADR-0086: Bounded AI list-setting proposals

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Accepted
- **Accepted:** 2026-10-02
- **Date:** 2026-10-02
- **Owners:** Cloud Markup product and application maintainers
- **Supersedes:** None
- **Superseded by:** None

## Context

The M9 audit found that AI catalog context advertises EventBridge `detailTypes`,
`sourceKinds` and `filterKeys`, and SNS subscription `filterKeys`, while
proposal versions 1–4 only accept scalar output. ADR-0066 already permits
bounded lists as read context. Changing historical proposal meaning would weaken
reproducible receipt handling and still leave editor conversion inconsistent.

## Decision

Add explicit proposal version 5 with the existing v4 review, question,
assessment and ownership semantics. Resource, connection and update settings can
additionally contain flat string arrays, with at most 16 entries of at most 256
characters each. Versions 1–4 retain their exact scalar schemas and model
instructions. New canvas and project-creation requests select v5; historical
receipts remain readable under their recorded versions. OpenAPI intentionally
adds v5 to the two request-version enums and four response unions, preserving
the old alternatives; it does not preserve the complete bytes of those expanded
operations.

The AWS beta adapter projects only representable, catalog-declared literal
configuration fields. It reports unsupported keys separately and intersects
advertised limits with proposal transport bounds. The server validates every
explicit v5 setting using the provider SDK's deterministic configuration
validator: field type, enum, minimum/maximum list length and uniqueness remain
authoritative. Partial-setting validation neither materializes defaults nor
interprets omitted context as a default. Resource references remain bound to
editable reviewed context; permission-policy edits use their dedicated flow.

Prepared v5 requests require reviewed context and record the exact current
catalog digest. Generation reauthorizes the request and rejects a changed
catalog before model dispatch, so queued work cannot silently use different
capabilities or a different full-input estimate after a rollout. The user can
request a fresh proposal. Legacy v1–v4 preparation behavior remains unchanged.

The editor converts arrays to typed `string-list` configuration values and uses
the existing catalog operations, relationship resolver, graph command engine and
complete-draft validation. It prepares one atomic reversible batch, rejects
stale previews and newly introduced blocking findings, and keeps explicit user
acceptance. Review displays JSON list notation so an empty list and individual
item boundaries remain visible.

## Consequences

AI can propose the audited list fields without inventing scalar substitutes.
Server admission, model capabilities and editor consumption agree. These remain
AWS adapter choices; no provider-neutral domain or compiler behavior changes.
Transport bounds can be narrower than the provider's ordinary editing limits.
Unsupported settings require manual configuration and remain disclosed.

Tenant authorization, generated ownership, secret filtering, full-request credit
estimation and usage settlement retain their existing boundaries. No additional
model call, paid quality evaluation, billing policy, database migration or new
dependency is introduced. Advisory model review is not evidence of executed
validation or source quality.

Roll back new request admission and UI together. Existing v5 receipts require a
v5-capable reader; do not reinterpret them as v4. Current-catalog binding and
the coordinator's exact-source release checks remain required when integrating
concurrent catalog changes.

## Alternatives considered

- Widen v4 in place: rejected because released contracts would change meaning.
- Hide all lists from AI: coherent but leaves the four audited settings
  unavailable despite existing deterministic support.
- Accept arbitrary JSON or stringify lists: rejected because both lose the
  typed, bounded configuration boundary.

Reconsider wider lists or nested data only for a concrete supported catalog
need, with a new version and matching model, server and editor evidence.

## Verification and follow-up

Compatibility, malformed/bounded input, actual catalog constraints, editable
ownership, request/response version binding, exact input estimation, atomic
undo, stale previews and stepped review are tested without paid inference. The
execution plan records actual gate outcomes and release coordination. This
decision remains proposed until final diff and verification review.

## References

- Execution plan
- [Status](../PUBLIC_STATUS.md)
- [Reviewed canvas context](0066-reviewed-canvas-ai-context.md)
- [Model gateway](../architecture/MODEL_GATEWAY.md)
