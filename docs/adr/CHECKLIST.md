# ADR-writing checklist

Use this checklist with [the ADR template](0000-template.md).

## Before drafting

- [ ] The choice is durable: dependency direction, ownership, public contract,
      trust boundary, provider/language/platform strategy, deployment scope, or
      long-lived operational policy—not a reversible local detail.
- [ ] The problem is linked to current product/architecture constraints and any
      open item in [STATUS.md](../PUBLIC_STATUS.md).
- [ ] Existing accepted ADRs were checked for conflict or required supersession.

## Decision quality

- [ ] Context is neutral and names forces, assumptions, and constraints.
- [ ] One concrete decision states scope, ownership, boundaries, and non-goals.
- [ ] Credible alternatives and reconsideration conditions are recorded.
- [ ] Positive and negative consequences include operational and maintenance
      costs.
- [ ] Tenant/security, data/migration, versioning/compatibility, determinism,
      provider portability, testing, and rollback impacts are explicit or
      explained as not applicable.

## Publication

- [ ] The ADR starts `Proposed`; acceptance is a deliberate review outcome.
- [ ] A changed accepted decision is superseded by a new ADR rather than
      silently rewritten.
- [ ] The ADR index and affected product, architecture, security, testing,
      status, handoff, and plan documents are updated together.
- [ ] Resolved open decisions are removed from `STATUS.md`, while follow-up work
      remains visible in the roadmap/plan.
- [ ] Local links, formatting, and `git diff --check` pass.
