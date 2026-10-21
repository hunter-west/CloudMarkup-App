# Staff-funded AI access without a subscription

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

Status: Proposed

Supersedes the subscription prerequisite for complimentary grants in
[ADR-0081](0081-live-billing-and-platform-staff.md). The owner explicitly chose
subscription-independent staff grants on October 15, 2026.

## Context

Complimentary grants already have immutable actor-bound receipts, ledger
funding, expiry and compensating adjustments. Requiring a subscription at grant
and AI admission prevents using those credits to try the product. Removing the
endpoint check alone leaves funded accounts unable to use AI.

## Decision

An audited staff grant permits a dedicated Credits only AI policy when current
paid or trial authority is absent. It provides one concurrent AI operation and
no included or recurring credits. Existing canonical nontrial credit buckets,
reservations and settlements remain the budget. Zero spendable funds cannot
reserve work. Grant expiry and revocation retain their financial effect.

The effective entitlement projection retains the real snapshot identity and does
not rewrite subscription or trial history. Current paid and trial policies take
precedence. A complimentary grant may supplement an existing trial's AI funds
without creating or extending trial privileges. The policy enables no export,
team, sharing or paid plan feature. Account pauses, verified tenant and role
checks, model admission, pricing and usage limits remain mandatory.

Staff authorization, target confirmation, optimistic version, actor-bound
idempotency, immutable audit and grant/ledger creation remain atomic. Creating
an access policy does not issue credits. There is no automatic trial or plan
conversion. The new hosted migration, closed helpers, ACL metadata and schema
pins must be admitted atomically by the integrated release owner.

The model adapter maps this verified profile to the existing Starter standard AI
routing tier, retaining the canonical staff-credit plan version and no
subscription. Existing valid Professional trials map to their Pro AI tier and
retain their independent trial authority/expiry. These are routing policy keys,
not billing plan changes. The closed model catalog, route digests and Pro-only
Deep Design eligibility remain unchanged.

## Alternatives and consequences

Using a Professional trial would introduce unrelated privileges and an expiry
decision. Removing only the grant check would report success without usable AI.
Persisting only a replacement subscription snapshot would strand valid credits
after cancellation or trial expiry. The effective projection avoids those
failures at the cost of a new versioned database policy and admission packet.

Provider-direct and self-host modes retain their independent authority. Public
response versions remain compatible: the plan key is an existing open string,
and Credits only has no subscription or trial object. Ledger entries and old
migration bytes are preserved. Rollback requires retaining the additive schema;
an older application will refuse this profile instead of creating paid access.
Reconsider this policy if nonstaff self-service credit-funded access is offered.

Validation and exact release holds belong in the execution plan.
