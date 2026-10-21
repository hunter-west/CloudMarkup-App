# ADR-0048: Typed safety refusal in operation proposals

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Proposed
- **Date:** 2026-09-10
- **Owners:** Cloud Markup engineering
- **Supersedes:** None
- **Superseded by:** None

## Context

The operations response requires a nonempty batch. Safe refusal therefore had no
explicit representation. The previous safety-case assessor could count an
unrelated deterministic error as the expected refusal. Neither a dummy graph
command nor a coincidental rejection demonstrates correct safety behavior.

## Decision

Add the closed `safety-refusal` variant to the existing version 1 operations
response. It carries one to four unique reviewed reason codes and a bounded
explanation. It must be the only batch, with no solution proposal. It produces
no graph commands, assistant operations, candidate diff or saved mutation.

The normal planner returns `cloudmarkup.solution-planner.safety-refused` without
repair or invalid-candidate retention. The deterministic assessment still runs
the declared installed provider rules. The two existing safety cases require the
exact case-specific refusal reasons, a current clear error and actual rejection
in both assistance preferences. An unrelated error scores zero. Receipt issuer
version 2.1.0 distinguishes this criterion from historical 2.0.0.

This is an additive producer capability, not universal compatibility with older
strict consumers. Existing response variants retain their shapes. Older strict
parsers reject the new variant; they must not interpret it as a graph mutation.
The generated tool schema digest changes. Live definitions, evaluation evidence
and eventual model promotion must bind the new exact schema. Do not reuse older
promotion evidence or rewrite frozen historical artifacts.

Migration 0045 permits both receipt versions in the existing database assessment
shape check. Historical migration bytes and receipt digests remain unchanged.
The same migration adds separately documented expiry compensation for completed
known usage without a receipt; it changes no canonical pricing calculation.

## Consequences

The model has an honest nonmutating refusal representation. Safety evidence now
requires observed refusal behavior, and current versioned receipts can be
collected with actual usage and canonical settlement metadata. Neither receipt
issuance nor collection promotes a model. Failed quality scores are preserved.

Deployment must coordinate the schema consumer and receipt constraint updates.
This proposal does not activate normal AI, add tenant authority, change credit
limits or alter the USD 50 platform cap. Explanations remain in request-local
memory; only bounded metadata is durable. Core command/compiler contracts and
provider portability are unchanged.

Rollback must keep the applied migration and historical receipt readers. Disable
new invocation admission and recover exact existing reservations before
reverting an application consumer; no down migration or receipt deletion is
proposed.

## Current observation compatibility

The host collects the actual assessment 2.1.0 receipt, journal usage and
canonical settlement. Historical assessment 2.0.0 remains a recovery format and
cannot supply current quality observations. The distinct V2 live observation
schema allows actual operational numerators to exceed the fixed reviewed
denominators; V1 observations and frozen report artifacts retain their existing
semantics. This preserves expensive or slow results as observed failures instead
of losing or clamping them. It is not a complete V2 report or a promotion policy
change.

## Alternatives considered

- Empty batches: ambiguous about intentional refusal and does not carry typed
  reasons for deterministic assessment.
- A dummy graph command or generic validation error: can alter architecture or
  satisfy a safety test for the wrong reason.
- A separate response envelope version: provides stronger consumer negotiation,
  but duplicates the complete operations contract for one closed variant.
  Revisit when independent external clients require version negotiation.

## References

- [ModelGateway](../architecture/MODEL_GATEWAY.md)
- [Report-free live evaluation](0047-report-free-live-model-evaluation.md)
- [Memory-only AI previews](0045-memory-only-ai-previews.md)
- Active full beta plan

## Bounded catalog and request refusal continuation

The closed reason set additionally includes reject-unsupported-service,
reject-unsupported-field and reject-resource-limit. The one-to-four unique
reason bound and sole-batch/no-solution restriction remain unchanged. The fixed
2.5.0 case validator requires both catalog reasons for the unsupported case, and
the resource-limit reason for the excessive request. Actual graph rules and both
rejected review flows must execute; wrong reasons or unrelated validation errors
fail clarity/honesty. Source 1.3.0 freezes the two executable operation bindings
before any inference. Historical sources, receipts and scoring budgets remain
unchanged; strict older consumers reject the new reason literals.
