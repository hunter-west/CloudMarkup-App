# ADR-0063: Meter enabled beta AI against organization credits

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Proposed
- **Date:** 2026-09-24
- **Owners:** Cloud Markup engineering and the beta owner
- **Supersedes:** The owner-funded, no-customer-debit decision in ADR-0055 when
  this accounting path is implemented and activated
- **Superseded by:** None

## Context

The owner reports that allocated credits remain unchanged after using enabled AI
features and requests usage-based debits with estimates and actual amounts. This
is the behavior specified by ADR-0055, not a balance-view bug. The beta diagram
proposal job, legacy synchronous proposal endpoint, and opt-in
application-source draft export call a fixed Bedrock model without canonical
credit reservations. The ordinary model gateway's reservation and settlement
contracts are present but not promoted for these beta paths. The account's last
reviewed model offer expired on September 23, 2026.

## Decision proposed for implementation

Meter every enabled beta provider invocation through the canonical,
organization-scoped append-only credit ledger. Use the existing immutable
normalization policy: one credit per USD 0.01 of normalized value, with a 30%
markup on provider cost. The price version, policy version, model, request
identity, and maximum billable use are pinned before reservation. Charge only
through a durable, idempotent terminal transition using provider-reported
billable token counts and verified pricing. A completed result exposes the
preflight estimate or upper bound and the settled actual credits. The balance
view refreshes from the canonical summary after settlement. Historical free beta
calls are not retroactively billed.

Each path reserves enough credits before calling Bedrock, including the maximum
approved retry allowance. The worker records dispatch and provider usage in a
durable journal. A crash, uncertain send, cancellation, duplicate queue
delivery, invalid response, or publication failure has one explicit terminal
charging/release policy. No new provider call is allowed when pricing,
reservation, or reconciliation is unavailable. The legacy synchronous route must
share this boundary or be retired with a compatible API transition. The optional
source draft needs the same controls even when it is invoked from an export
rather than a proposal job; a cache hit incurs no new provider use.

The beta feature remains in its current owner-funded state until an additive
versioned contract and accounting implementation, fresh account-specific offer
evidence persisted in a reviewed price version, tenant and retry tests, and
release gates pass. Activating customer billing is a separate reviewed rollout.
This proposal does not grant deployment authority.

## Consequences

Available credits decrease after a settled charge, and unused reservations
return to availability. Users see an estimate before committing and actual
credits after completion. Billing evidence and balance are server-owned;
prompts, provider output, and browser estimates remain untrusted. New job
output/usage fields require a versioned public contract and old-job read
compatibility. Additive persistence may be required for per-attempt dispatch and
usage evidence. Provider cost ceilings stay independent of customer-credit
conversion. Tenant authorization, current grant availability, explicit
entitlements, and exactly-once ledger semantics remain mandatory.

## Alternatives and reconsideration

Subtracting a fixed amount from a mutable balance after a successful browser
response cannot distinguish duplicates, failures, or provider usage. Charging
only the diagram job leaves the source draft and synchronous endpoint as
unmetered bypasses. Replacing Sonnet from list price alone does not establish
schema-valid generation or current account pricing. These approaches are not
selected. Reconsider the selected model after controlled comparison on actual
diagram and source-draft cases, reviewed provider offers, and explicit rollout
evidence.

## References

- [Credit ledger](0010-ai-credits-usage-ledger.md)
- [Owner-funded beta decision](0055-functional-beta-infrastructure-assistant.md)
- [Opt-in source drafts](0057-opt-in-beta-application-source-drafts.md)
- [Commercial lifecycle](../architecture/MODEL_COMMERCIAL_LIFECYCLE.md)
- [Current review](../engineering/AI_CREDITS_AND_CODEBASE_REVIEW_20260924.md)
- Execution plan
