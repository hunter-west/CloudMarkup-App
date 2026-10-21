# ADR-0067: Durable one-time credit purchases

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Proposed
- **Date:** 2026-09-30
- **Owners:** Cloud Markup engineering
- **Supersedes:** None
- **Superseded by:** None

## Context

The owner approved non-expiring packs of 100 credits for USD 5, 350 for USD 15,
and 800 for USD 30. Monthly subscription credits retain their existing period
expiration. The product follow-up requires repeat-safe purchases while public
registration and live commerce remain closed. Existing subscription Checkout
attempts cannot represent an independent one-time payment.

## Decision

Keep a separate versioned purchase attempt bound to the verified billing
account, customer, approved pack policy, and durable provider retry identity.
Serialize new attempts per account. An unknown external result remains reserved
until a fresh provider read verifies its terminal state; a browser retry key or
elapsed time cannot unlock a second charge. New purchases require an active
subscription.

Sandbox Checkout uses payment mode and server-derived inline price data for one
approved pack. No browser amount, credit count, customer, provider identifier,
return URL or policy version is authoritative. This avoids requiring manually
created Stripe price IDs for every sandbox pack. Authenticate a fresh Checkout
session, its complete one-item list, and its captured PaymentIntent/Charge
before fulfillment. Validate exact USD amounts, quantity, ownership, policy
metadata and payment state. Current sandbox checks deny taxes, discounts,
shipping, recurring prices, recovery sessions and live-mode data. Production
tax/commerce activation requires its separate launch configuration; this
decision does not enable it.

Initial top-up creation explicitly admits hosted card payments. Dynamic bank
payment methods stay off until failed delayed-payment recovery and operational
reconciliation have a reviewed workflow. Authenticated unpaid completion never
grants credits or unlocks a replacement charge; delayed successful evidence is
still handled safely by the worker. A completed unpaid attempt can require
operator reconciliation, so elapsed time alone cannot unlock it.

Keep signature-verified, reference-only queue delivery. The worker retrieves
provider data again, then atomically commits the canonical purchased grant and
attempt receipt. Purchased grants never expire. Repeat or concurrent events
produce one grant; delayed unpaid completion produces none. The browser return
page cannot issue a grant. Refund/dispute observations retain financial history
and flag reconciliation without silently removing consumed credits or rewriting
monthly allowance. New-purchase admission never disables processing of existing
paid attempts.

## Consequences

### Positive

- Monthly and purchased allowance remain independently auditable in one ledger.
- Unknown outcomes and concurrent retries do not create parallel open charges.
- Exact provider evidence and durable account scope prevent cross-account
  grants.

### Negative

- One open top-up per billing account can require operational reconciliation.
- Refunds and disputes need an explicit accounting workflow for consumed
  credits.
- Sandbox inline-price products add provider records; live product/price
  management and tax activation remain separate release decisions.

### Follow-up

The local additive `0083` schema, public typed routes, purchase UI and worker
integration are implemented with denied/concurrent/replay/rollback coverage;
local workstream checks pass with documented focused recoveries. Final
integration and root/release verification remain pending the refactor handoff.
Historical migration bytes through `0082` are unchanged. Rollback disables new
purchase creation while retaining the forward-compatible fulfillment worker and
financial records. Do not deploy or activate this proposed implementation from a
local checkpoint.

## Activation and operational boundary

New purchase creation requires `CLOUDMARKUP_CREDIT_TOP_UPS_ENABLED=true` in
addition to the existing reviewed sandbox billing-session configuration. The
flag defaults off and is not enabled by infrastructure in this checkpoint. Live
Stripe mode remains rejected. The fulfillment worker is independent of this flag
so closing Checkout cannot strand previously accepted payments.

Before a separately authorized sandbox activation, ensure the configured webhook
endpoint delivers Checkout completion, async payment success/failure, Checkout
expiration, charge refunds, and dispute created/closed events. The retained v1
queue stays reference-only; the event allowlist is additive. The worker
authenticates fresh session, complete line-item and payment evidence.

Unknown provider outcomes remain reserved after the 23-hour retry window;
operators must reconcile them against retained provider evidence. A review state
does not authorize an automatic refund, debit, grant removal, or return to
Checkout. Refund/dispute accounting tools and live tax/product policy remain
open release requirements. No operator action is performed by this migration.

The AI runtime still reserves up to 100 credits per new invocation and settles
actual usage. A remaining balance below 100 cannot start a fresh invocation;
this purchase feature does not change that reservation policy.

## Alternatives considered

### Subscription checkout attempts

Rejected because they serialize a different external effect and have
subscription terminal-state semantics. Mixing them could duplicate or strand
purchases.

### Credit browser returns immediately

Rejected because a return URL does not establish successful payment and can be
replayed without provider authority.

### Precreated Stripe prices

Reasonable for later live catalog management. Sandbox inline price data
currently keeps the approved server policy sufficient for setup; authenticated
line-item amount and type checks remain mandatory.

## References

- [Account and commerce requirements](../product/POST_BETA_ACCOUNT_AND_REPOSITORY_REQUIREMENTS.md)
- [Stripe Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment)
- [Create Checkout session](https://docs.stripe.com/api/checkout/sessions/create?api-version=2025-06-30.basil)
- [Session line items](https://docs.stripe.com/api/checkout/sessions/line_items)
- [PaymentIntent](https://docs.stripe.com/api/payment_intents/object)
- [Charge and refund state](https://docs.stripe.com/api/charges/object)
