# ADR-0066: Reviewed canvas context and consistent AI decisions

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Accepted
- **Date:** 2026-09-30
- **Owners:** Cloud Markup product and application maintainers
- **Supersedes:** Configuration-exclusion scope of ADR-0056 and ADR-0057 for new
  opt-in versions only
- **Superseded by:** None

## Context

The owner requested more effective AI assistance using canvas configuration,
stepped reviews across creation and repairs, source generation checks, and
approximately 400 usage credits per USD4 of model cost. M9 remains active.
Existing proposal and source versions must remain readable and reproducible.

## Decision

New proposal version 4 and explicit application-source option
`ai-source-draft-v2` use a bounded context projection tied to the exact catalog.
It contains known resources and placement, literal service and relationship
settings allowed by catalog UI descriptors, workload purposes, and deterministic
draft validation findings. Unknown fields, secret references, credential-like
keys and detected secret values are excluded or rejected. Policy documents,
arbitrary source and raw graph content are not model context. Limits are 100
resources, 1,000 relationships, 40 finding summaries and 128,000 context
characters; omitted configuration keys and total finding counts remain visible
to the model. These are AWS adapter choices, not provider-neutral domain rules.

The model identifies intent and returns bounded assumptions, checks and blocking
questions. Assessment-only responses are allowed. Blocking questions cannot be
combined with proposed changes. A single model self-review is advisory evidence,
not an independent review or test execution. No extra automatic inference loop
or paid provider evaluation is introduced.

Version 4 may propose literal setting updates on explicitly referenced,
user-owned resources. Permission policy documents, conditions and existing
managed-policy attachments require their dedicated permissions workflow. The
editor prepares one atomic, reversible command batch using the existing catalog
configuration and connection operations. It rejects stale previews,
generated-resource edits, unsupported settings, incomplete validation and newly
introduced blocking findings. Existing unrelated findings remain visible and do
not force unrelated changes. Configuration-only updates do not rebuild existing
event bindings. A user reviews changes, then checks and assumptions, before
applying. Issue actions prefill the same assistant request; they do not
automatically invoke or charge AI.

Source v2 is generated from an immutable revision and requires supported Node.js
24 Lambda runtime and workload purpose. Each draft includes purpose coverage,
configuration checks, unresolved risks and a test plan in its README. Output is
strictly parsed before publication or charging. Source is not executed, built,
bound to infrastructure or certified ready to deploy. Legacy v1 keeps its
prompt, minimal context and producer identity; v2 uses distinct prompt/context
cache identities.

New credit policy `beta-ai-cent-v2` converts provider-cost micros at 1/10,000:
USD4 corresponds to 400 credits before whole-credit rounding. Migration 0082,
owned by the coordinated account task, closes v1's admission window and appends
v2 without rewriting old prices or charges. Existing reservations replay and
settle under their recorded pricing and policy. New usage uses v2. Retail packs
are a separate commercial decision. Estimates include serialized instructions,
catalog/tool schema and context; actual provider token usage settles the hold.
All AI screens use the same estimate/hold/actual receipt wording.

## Consequences

Richer bounded context and explicit decisions improve reviewability and allow
focused configuration repairs. Deterministic commands retain authority and
tenant authorization remains at existing request, worker and publication
boundaries. Model output is still untrusted, and self-review does not establish
semantic correctness. More context increases input cost and catalog coupling;
unknown or oversized context fails before model dispatch. Human review and
external source testing remain necessary.

Old proposal/source contracts remain accepted. No architecture-document
migration is required. Credit migration and runtime must ship together: rolling
back only the runtime would attempt admission against the closed v1 price. Roll
back new AI admission/UI together; retain the v2 pricing-compatible meter and
immutable historical pricing records.

## Alternatives considered

- Keep the labels-only projection: simpler but cannot ground configuration
  fixes.
- Send the raw canvas: rejected because it broadens data exposure and prompt
  size.
- Automatically apply repairs or trust model review: rejected; deterministic
  graph commands and explicit acceptance retain authority.
- Add multiple automatic model passes: reconsider only with quality evaluations,
  measured credit impact and an explicit user-visible budget.

## Verification and follow-up

Accepted on October 1 after review of bounded data exposure, tenant authority,
version compatibility, reversible command application and reservation-pinned
pricing, followed by PR 46 (private historical evidence, omitted from this
distribution) and all exact-candidate CI/native checks. The decision preserves
the historical contracts in ADR-0056 and ADR-0057 and supersedes only their
new-version configuration-exclusion scope. ADR-0063's separate commercial
decisions remain open.

Focused tests cover schema compatibility, context minimization, configuration
undo/staleness, generated ownership, current issue handoff, source
review/runtime rejection and legacy source cache identity. The 21-case real
PostgreSQL suite creates a v1 reservation before 0082, replays and settles it
after migration, checks duplicate settlement and verifies new usage at v2.
Browser review and the complete hosted profiles pass; the execution plan records
counts, configured skips, earlier local timeout recovery and deployment
readback.

Model self-review remains advisory. No live-model quality gain or execution of
generated applications is established by these synthetic and integration tests.

## References

- Execution plan
- [Status](../PUBLIC_STATUS.md)
- [Incremental proposals](0056-incremental-beta-diagram-proposals.md)
- [Opt-in source drafts](0057-opt-in-beta-application-source-drafts.md)
- [Metered AI](0063-metered-beta-ai-credits.md)
- [Model gateway](../architecture/MODEL_GATEWAY.md)
