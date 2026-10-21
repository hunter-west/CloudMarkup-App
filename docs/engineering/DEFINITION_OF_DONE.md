# Definition of done

A change is done only when every applicable item is true.

## Scope and correctness

- The authorized milestone outcome and execution-plan stopping condition are
  satisfied without implying later behavior.
- Success, invalid input, failure, retry/concurrency, and rollback behavior are
  correct at the changed boundary.
- Package ownership and dependency direction remain valid; public imports use
  declared exports.

## Contracts, data, and determinism

- Public, persisted, async, provider, and cross-language contract changes are
  versioned and include compatibility, migration, or intentional rejection.
- Tenant, schema/compiler/catalog/output versions and provenance remain explicit
  where applicable.
- Semantic and generated results are reproducible and independent of UI layout,
  incidental ordering, timestamps, randomness, and machine paths.

## Security and quality

- Inputs, identity, authorization, secrets, logging, permissions, isolation,
  quotas, and audit implications were reviewed at every changed trust boundary.
- Tests match the risk, including negative tenant/authorization and failure-path
  evidence when applicable.
- Checks required by the root
  [verification cadence](../../AGENTS.md#verification-cadence) pass; pending
  integrated checks have an owner and skipped checks a reason.
- The [code-review checklist](CODE_REVIEW.md) has no unresolved high-priority
  finding.

## Repository truth

- Documentation affected by the change describes current facts and limitations
  accurately; unchanged truth does not require another report or status entry.
- No secret, customer data, sensitive architecture content, cache, coverage,
  synthesized output, or unintended generated file is present.
- Cross-session handoff links the source-bound evidence and records current
  ownership, limitations, blockers, and the safest next task without duplicating
  execution history.
