# ADR-0081: Live billing and platform staff account authority

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Accepted
- **Accepted:** 2026-10-02
- **Date:** 2026-10-01
- **Owners:** Cloud Markup product and platform
- **Supersedes:** None

## Context

M9's owner requested live hosted Stripe billing and complimentary testing
credits for active-plan accounts. Customer organization owners must not acquire
platform authority. Staff may grant to their own accounts, with the same audit
requirements. See the execution plan.

Accepted [Stripe](0009-stripe-subscription-boundary.md),
[ledger](0010-ai-credits-usage-ledger.md), and
[identity](0022-verified-principal-and-canonical-organization-authorization.md)
boundaries continue to apply. Temporary plan access is outside this decision.

## Decision

Hosted Checkout and Customer Portal use an exact reviewed live price/product
catalog. Runtime modes, API secrets, webhook envelopes, durable event records,
and current projections carry matching test/live provenance. Historical v1 queue
envelopes continue to mean test. Live v2 envelopes explicitly name their
environment. Provider retrieval verifies mode, customer, amount, currency,
product and recurring policy before granting entitlement or credits.

An operator first disables new commerce admission, drains or resolves pending
work, and previews the cutover. One atomic, digest-bound cutover archives test
projections, cancels their current authority and debits unused non-staff test
credits through compensating ledger entries. It preserves original grants,
consumption, receipts and projection snapshots. Active reservations, unresolved
top-ups, pending webhooks and unverified or nonterminal test Checkout attempts
block cutover. The operator reads each retained test session from Stripe; exact
account/session/expiry/version evidence for a completed or expired session is
included in the digest and immutable receipt. Only those verified terminal
attempts are retired in the cutover transaction. An immutable receipt and
database triggers reject subsequent test projection/event writes. No historical
SQL is rewritten.

Platform staff permissions live in canonical PostgreSQL records, separate from
organization memberships. No HTTP endpoint enrolls staff. An AWS operator
resolves an owner-designated verified Cognito identity to its immutable internal
principal, previews the exact permission change, then applies its digest.
Revocation is audited through the same operator path.

Staff HTTP actions require valid current sessions and permissions, recent
authentication, same-origin writes, exact account confirmation, version
preconditions and actor-bound idempotency. Locks serialize authorization,
accounting and revocation. Grants require an active current-mode subscription.
Amounts and expiry are bounded; reasons are required. Self-grants follow the
same controls. Revocation affects only unspent, unreserved credits in the
selected complimentary grant. Staff can pause/resume expensive operations but
cannot manufacture subscription evidence. Every action and immutable receipt
commit atomically; audit failure rolls back the mutation.

## Consequences and alternatives

An email/JWT allowlist or reusing organization administrators would couple
customer-editable authority to platform privileges; both are rejected. Manual
balance edits would bypass allocation and audit invariants. Swapping Stripe keys
for testing risks mixed evidence and cannot provide an independent staff
allowance, so complimentary ledger grants are used instead.

The change adds four v1 API operations and two additive migrations, retaining
existing contract semantics and historical migration bytes. Domain graph and
compiler behavior are unaffected; provider-specific code remains in adapters.
Staff access requires a privileged bootstrap and reauthentication for sensitive
actions. Credit grants do not provide a free plan. Limits, additional staff
permissions, proration and read-audit retention should be revisited only with
concrete support requirements and corresponding tests.

Tests cover ordinary owner denial, forged authority, session/staff revocation,
cross-account selectors, replay/conflicts, atomic audit failure, self-grants,
inactive plans, targeted debit, mode isolation and cutover. Browser tests cover
confirmation, safe retries, responsive themes and accessibility.

Rollback disables new admission and preserves settlement and history. After
cutover, an old test-mode runtime cannot be used as a payment rollback.
Deployment and live provider changes remain separately controlled by exact
release checks and owner authority. See the activation runbook.
