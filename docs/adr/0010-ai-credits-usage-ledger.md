# ADR-0010: Organization AI Credit Usage Ledger

- Status: Accepted
- Date: 2026-07-24
- Owners: CloudCanvas product and engineering
- Supersedes: None

## Context

Model providers report raw tokens and costs, while customers need a stable,
understandable allowance. Concurrent requests, retries, failures, changing model
prices, and delayed provider reporting make a mutable balance or aggregate
counter insufficient for reliable charging and audit.

## Decision

CloudCanvas will present model usage as shared organization AI credits. Plans
grant entitlements, limits, and monthly or otherwise defined credit allocations.
Raw provider token details may be visible to authorized Professional-mode users
but are not the customer billing unit.

Usage accounting uses an append-only, organization-owned ledger. Entries retain
request or job identity, provider, model and model version, pricing version,
input and output token counts when applicable, latency, outcome, estimated
provider cost, and credit effects.

Before invoking a model, CloudCanvas reserves credits atomically. Completion
settles the reservation; failures or cancellations release it; abandoned
reservations expire through a controlled process. Idempotency rules prevent a
request, callback, or retry from charging twice. Historical entries retain the
pricing version used at settlement instead of being recomputed with current
prices.

AWS or other provider billing data may reconcile aggregate internal estimates
for operations. It is not the per-request authorization source and does not
replace the application ledger.

## Consequences

### Positive

- Concurrent requests cannot knowingly overspend the available allowance.
- Usage remains explainable across retries and pricing changes.
- Customer-facing credits are decoupled from provider-specific token models.

### Negative

- Reservation expiry and recovery add operational state.
- Pricing and credit-conversion versions require governance.
- Provider reports can still differ from estimated per-request costs.

### Follow-up

- Define ledger entry and reservation state contracts.
- Set credit conversion, allocation, expiry, and visibility policies.
- Add invariants, idempotency tests, reconciliation alerts, and retention rules.

## Alternatives Considered

- Store only a mutable remaining-credit counter. Rejected because it cannot
  provide a durable audit trail.
- Charge only after completion. Rejected because concurrent work can exceed the
  allowance.
- Use aggregate cloud bills as per-request truth. Rejected because they are
  delayed and insufficiently attributable.

## References

- [Commercial Model](../product/COMMERCIAL_MODEL.md)
- [Billing and Usage](../architecture/BILLING_AND_USAGE.md)
- [ADR-0009](0009-stripe-subscription-boundary.md)
