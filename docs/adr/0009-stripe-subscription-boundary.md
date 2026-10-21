# ADR-0009: Stripe Subscription Boundary

- Status: Accepted
- Date: 2026-07-24
- Owners: CloudCanvas product and engineering
- Supersedes: None

## Context

CloudCanvas needs fixed subscription plans and organization-level entitlements
without handling card details or treating a browser redirect as proof of
payment. Subscription state must remain reliable when events are delayed,
duplicated, or delivered out of order.

## Decision

CloudCanvas will use Stripe Billing as an external billing adapter for fixed
plans. Checkout and billing self-service will use Stripe-hosted Checkout and
Customer Portal surfaces. CloudCanvas will not collect or store card details.

Only authorized organization owners may start billing management flows.
Successful browser redirects are user feedback, not an authorization source.
Signed Stripe webhooks are the authoritative external event channel.

Webhook processing must verify signatures, be idempotent, retain the external
event identity, and update a local organization-owned subscription projection.
Entitlement decisions use that local projection through a versioned domain
contract. Reconciliation handles missed or reordered events without granting
access from client-supplied billing state.

CloudCanvas customer-facing AI allowances are credits within subscription
entitlements; raw model tokens are not sent to Stripe as metered usage.

## Consequences

### Positive

- Payment data remains within Stripe-hosted surfaces.
- Product authorization does not depend on browser state.
- Domain logic can test entitlements without importing the Stripe SDK.

### Negative

- Webhook replay, ordering, reconciliation, and degraded-state behavior require
  explicit operational design.
- Local projections can be temporarily stale and must fail safely.
- Plan and price identifiers need environment-specific configuration.

### Follow-up

- Define the billing adapter and subscription projection contracts.
- Establish retry, replay, reconciliation, and incident procedures.
- Decide exact pricing, tax, trial, refund, and retention policies before
  production billing.

## Alternatives Considered

- Collect card details directly. Rejected because it expands sensitive payment
  scope without product benefit.
- Trust the Checkout return URL. Rejected because redirects are not
  authoritative or reliably delivered.
- Meter raw model tokens through Stripe. Rejected because customer credits and
  provider token accounting serve different purposes.

## References

- [Commercial Model](../product/COMMERCIAL_MODEL.md)
- [Billing and Usage](../architecture/BILLING_AND_USAGE.md)
- [Security Principles](../architecture/SECURITY_PRINCIPLES.md)
- [ADR-0010](0010-ai-credits-usage-ledger.md)
