# Controlled-beta billing readiness

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

The October 1 live-billing candidate and staff credit process are documented in
LIVE_BILLING_AND_STAFF. Its owner-approved commercial catalog supersedes older
readiness examples below; production activation is still pending and must not be
inferred from this document.

Cloud Markup's Starter/Pro commercial subsystem is ready for deterministic,
no-charge verification in fake mode and bounded Stripe test-mode exercises. It
is **not approved for live mode**. This document is an evidence record, not an
authorization to charge, deploy, create webhooks, or enter production secrets.

## September 30 update (not deployed)

The restricted beta profile now selects the additive Pro mapping
`cloudmarkup-starter-pro-credit-mapping-2026-09-30-v4`, with 1,250 credits per
eligible paid month at the unchanged $39 price. Migration `0081` must be
installed before this runtime is activated. Prior paid periods and plan versions
retain their original allowance; no retroactive grant is fabricated. The older
baseline tables below remain historical compatibility inputs.

Approved purchased packs are $5/100 credits, $15/350 and $30/800, with no
expiration. The domain policy is implemented; top-up checkout/fulfillment and
reviewed Stripe Product/Price bindings are not yet composed. Do not present
these packs as purchasable or enable live mode from this policy alone.

## Reviewed commercial contract

| Item                     | Controlled-beta value                                                                |
| ------------------------ | ------------------------------------------------------------------------------------ |
| Plans                    | Starter and Pro only; one subscription per organization and one seat                 |
| Monthly credits          | Starter `200`; Pro `1,000`                                                           |
| Currency and interval    | `USD`, fixed monthly recurring prices                                                |
| Trial                    | None                                                                                 |
| Cancellation             | Period end by default; immediate cancellation requires an approved operator decision |
| Grace                    | `0..720` configured hours; expensive paid AI operations remain blocked during grace  |
| Mapping version          | `cloudmarkup-starter-pro-mapping-2026-08-28-v1`                                      |
| Webhook endpoint version | `cloudmarkup-stripe-webhook-2026-08-28-v1`                                           |
| Publishable key          | `null`; hosted Checkout/Portal do not require a browser Stripe SDK                   |
| Explicitly absent        | recurring free plan, trial, Team seats, credit packs, automatic overage              |

Verified backend subscription state and the canonical append-only credit ledger
are authoritative. Browser state and caches cannot grant access. Inactive
subscriptions preserve policy-approved existing-project access, manual editing,
and approved data export. They never delete projects. New paid AI operations are
denied when subscription entitlement or credits are unavailable. A configured
grace can preserve only the reviewed non-expensive operations; it cannot enable
paid AI or imply future capabilities.

## Exact Stripe Dashboard inputs

Complete this table separately for each Stripe test account and, only after a
future approval, each live account. Never copy a secret value into this file.

| Dashboard/configuration input     | Test-mode value                                                                                                                                                                                              | Live-mode value                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Stripe environment                | Test mode                                                                                                                                                                                                    | `<blocked-until-live-approval>`                                   |
| Starter Product ID                | `prod_ExampleStarterTest`                                                                                                                                                                                    | `<operator-reviewed-live-product-id>`                             |
| Starter monthly Price ID          | `price_ExampleStarterTest`                                                                                                                                                                                   | `<operator-reviewed-live-price-id>`                               |
| Starter monthly unit amount       | `USD 9.00` (`900` minor units)                                                                                                                                                                               | Same after business/legal approval                                |
| Starter monthly grant             | `200` Cloud Markup credits                                                                                                                                                                                   | `200` after approval                                              |
| Pro Product ID                    | `prod_ExampleProTest`                                                                                                                                                                                        | `<operator-reviewed-live-product-id>`                             |
| Pro monthly Price ID              | `price_ExampleProTest`                                                                                                                                                                                       | `<operator-reviewed-live-price-id>`                               |
| Pro monthly unit amount           | `USD 39.00` (`3,900` minor units)                                                                                                                                                                            | Same after business/legal approval                                |
| Pro monthly grant                 | `1,000` Cloud Markup credits                                                                                                                                                                                 | `1,000` after approval                                            |
| Price attributes                  | USD, monthly, fixed quantity one, no trial                                                                                                                                                                   | Same, after approval                                              |
| Checkout success URL              | `<environment-origin>/settings/billing?checkout=success`                                                                                                                                                     | `<approved-production-origin>/settings/billing?checkout=success`  |
| Checkout cancel URL               | `<environment-origin>/settings/billing?checkout=canceled`                                                                                                                                                    | `<approved-production-origin>/settings/billing?checkout=canceled` |
| Portal return URL                 | `<environment-origin>/settings/billing`                                                                                                                                                                      | `<approved-production-origin>/settings/billing`                   |
| Portal configuration ID           | `<reviewed-test-portal-configuration-id>`                                                                                                                                                                    | `<reviewed-live-portal-configuration-id>`                         |
| Webhook endpoint                  | `<api-origin>/webhooks/stripe`                                                                                                                                                                               | `<blocked-until-live-approval>`                                   |
| Webhook events                    | `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required` | Same allow-list after approval                                    |
| API key secret reference          | `cloudmarkup/<environment>/stripe/api-key`                                                                                                                                                                   | Separate approved production reference                            |
| Current webhook secret reference  | `cloudmarkup/<environment>/stripe/webhook-signing-secret`                                                                                                                                                    | Separate approved production reference                            |
| Previous webhook secret reference | Optional `cloudmarkup/<environment>/stripe/webhook-signing-secret-previous` during a bounded rotation                                                                                                        | Separate approved production reference                            |
| Signature tolerance               | `300` seconds; accepted range `60..900`                                                                                                                                                                      | Reviewed value after approval                                     |

The Stripe API version selected for the Dashboard webhook endpoint remains an
operator-reviewed input and must be recorded in the environment change evidence;
it is distinct from the Cloud Markup endpoint-contract version above. Do not let
an account default drift substitute for that recorded input.

The allow-list requires the Product and Price pair, not just a Price ID. Product
and Price identifiers are not secrets, but mapping changes alter entitlement and
require review, reconciliation, and a mapping-version change. Test and live
accounts, IDs, Portal configurations, endpoints, event stores, secret paths,
alarms, and deployment roles must remain separate.

The Portal may expose payment-method management, invoice history, cancellation
at period end, and switching between only the reviewed Starter and Pro prices.
Quantity changes, coupons/promotion codes, trials, unreviewed proration, credit
packs, and metered/automatic overage remain disabled.

## Configuration and implementation evidence

| Boundary                                            | Evidence                                                                                                                                 |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Typed configuration and fail-closed live mode       | `apps/api/src/application/billing.ts`, `apps/api/src/adapters/billing/environment.ts`, `infra/platform/lib/config/environment-config.ts` |
| Raw-body verification and dual-secret transition    | `apps/api/src/adapters/billing/stripe-billing-provider.ts`, `infra/platform/runtime/billing-webhook.ts`                                  |
| Duplicate/out-of-order projection and period grants | `apps/api/src/application/billing.ts` and its lifecycle tests                                                                            |
| Entitlement/grace behavior                          | `packages/domain/src/commercial.ts` and `commercial.test.ts`                                                                             |
| Reconciliation and audited support interfaces       | `apps/api/src/application/billing-operations.ts` and its tests                                                                           |
| Retry/DLQ and alarms                                | `infra/platform/lib/stacks/application-stack.ts`, `observability-stack.ts`, and synth assertions                                         |
| Provider usage truth                                | `packages/model-gateway`; Cloud Markup records normalized request evidence while AWS billing data is aggregate/estimated                 |

The platform runtime declares the AWS-maintained Secrets Manager and SQS SDK
clients at exact workspace-catalog versions because the ingress must resolve
logical secret references and enqueue without embedding a secret. Reusing the
general API role/client or passing secret values through environment
configuration was rejected because it broadens access and leaks rotation
authority.

The deployment-target webhook ingress runtime verifies the exact request bytes
before parsing, accepts a bounded current/previous signing-secret overlap, emits
only a sanitized event reference/digest/order envelope, and enqueues to an
encrypted FIFO queue with a bounded redrive policy and DLQ. FIFO deduplication
is an ingress control; the canonical receipt and ledger remain the
replay/idempotency authority.

Reconciliation reports label every finding with its source and confidence.
Amazon Bedrock/provider totals are compared to normalized Cloud Markup ledger
cost estimates only at the aggregate level. The system does not claim exact
per-request provider reconciliation where the provider source cannot support it.

## Human business/legal decisions still required

- Tax collection, registrations, invoice wording, and merchant-of-record duties.
- Refund policy and approval/escalation authority.
- Upgrade/downgrade proration behavior and effective timing. No policy is
  inferred by the application.
- Contractual grace duration, operations allowed during grace, and customer
  communication. Code defaults to zero hours and always blocks expensive AI.
- Dunning cadence, final failure point, and restoration communication.
- Who may approve immediate cancellation and the evidence required.
- Terms, privacy disclosures, data-export eligibility, retention, support SLA,
  incident notification, and regional availability.

Operational consequence: until these decisions are approved, use only test mode,
do not promise proration/refunds/grace, and escalate the case without changing
subscription or ledger state.

## Live-mode blockers

1. Live mode is rejected by both application and platform configuration.
2. No approved live Product/Price/Portal/webhook identifiers or production
   secret references exist in source configuration.
3. The platform synthesizes webhook ingress, queue/DLQ, and alarms, but the
   durable queue consumer/application persistence composition is not deployed.
4. Scheduled reconciliation and support operations have typed, tested ports but
   no approved production scheduler, identity integration, or operator host.
5. Aggregate Bedrock billing/cost evidence is not connected to a reviewed
   production ingestion source.
6. Tax, refund, proration, grace, dunning, legal, retention, and incident-policy
   decisions above are unresolved.
7. No live-mode rotation, replay, mapping rollback, payment-failure, provider
   outage, or AI-cost-spike drill has produced approved audit evidence.
8. No deployment is authorized; CDK output remains synth-only.

Clearing a blocker requires a separate reviewed change. Never remove the live
mode guard merely because Stripe test-mode verification passes.

## Readiness evidence to retain

Retain only safe evidence: configuration version/digest, mapping and endpoint
versions, synthesized resource assertions, test command/results, event IDs,
payload digests, order keys, signature-secret version (`current`/`previous`),
projection versions, ledger/grant/adjustment references, finding IDs,
source/confidence, actor/principal IDs, safe reason codes, and timestamps. Do
not retain signatures, secret values, raw webhook bodies, card data, raw
prompts, provider response bodies, private repository content, or unrestricted
tenant content.

Use [BILLING_OPERATIONS_RUNBOOKS.md](BILLING_OPERATIONS_RUNBOOKS.md) for test
setup, rotation, lifecycle incidents, reconciliation, support, rollback, and
cost-spike procedures.
