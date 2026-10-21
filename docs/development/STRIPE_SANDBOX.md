# Stripe sandbox billing setup

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

> Prompt 47A readiness authority: use
> [BILLING_READINESS.md](BILLING_READINESS.md) for the versioned Starter/Pro
> mapping, exact Dashboard inputs, decision placeholders, and live blockers; use
> [BILLING_OPERATIONS_RUNBOOKS.md](BILLING_OPERATIONS_RUNBOOKS.md) for rotation,
> Aggregate environment validation and the current non-secret Dashboard input
> checklist are in Stripe operator inputs.

> replay, reconciliation, incidents, mapping rollback, and provider cost spikes.

Prompt 24B implements an optional Stripe sandbox adapter behind the
provider-neutral Cloud Markup billing port. Normal local development and CI use
the deterministic fake and make no Stripe network calls. Nothing in this guide
authorizes live charges, deployment, or production configuration.

## Operator checklist

Classify values before configuring anything:

| Value                    | Classification        | Reviewed sandbox value or source                                |
| ------------------------ | --------------------- | --------------------------------------------------------------- |
| Starter Product ID       | Non-secret identifier | prod_ExampleStarterTest                                         |
| Starter monthly Price ID | Non-secret identifier | price_ExampleStarterTest                                        |
| Pro Product ID           | Non-secret identifier | prod_ExampleProTest                                             |
| Pro monthly Price ID     | Non-secret identifier | price_ExampleProTest                                            |
| Portal configuration ID  | Non-secret identifier | A reviewed sandbox configuration created by the operator        |
| STRIPE_SECRET_KEY        | Secret                | Local secret channel only; must begin with sk_test_             |
| STRIPE_WEBHOOK_SECRET    | Secret                | Stripe CLI/endpoint secret channel only; must begin with whsec_ |

Never put a real secret in .env.example, source, tests, fixtures, logs, tickets,
screenshots, or committed shell history. Product and Price IDs are identifiers,
not credentials, but changes still require review because they alter the
server-side allow-list.

## Default fake mode

Copy .env.example to an ignored local environment file if the selected launcher
uses one, keep CLOUDMARKUP_BILLING_MODE=fake, and run the normal local checks.
The fake creates loopback hosted URLs and accepts only the deterministic
cloudmarkup-fake-billing-signature-v1 fixture signature. It is authoritative for
ordinary local and CI verification.

CLOUDMARKUP_BILLING_MODE=disabled makes the dedicated webhook route return a
safe retryable unavailable response and makes Checkout/Portal application
operations fail closed. Prompt 24C will own browser-facing Checkout and Portal
routes; they are intentionally absent here.

## Optional manual Stripe sandbox/CLI exercise

1. Confirm the Stripe account is in sandbox/test mode. Never use an sk_live_
   key; the adapter rejects it.
2. Configure the four reviewed Product/Price IDs above. Each Price must be USD,
   recurring monthly, fixed quantity one, with no trial, coupon, metered usage,
   credit pack, annual interval, or automatic overage.
3. Create and review one sandbox Customer Portal configuration. Enable only
   payment-method management, invoice history, cancellation at period end, and
   switching between the two reviewed monthly Prices. Disable arbitrary quantity
   changes, promotion codes/coupons, and unreviewed proration.
4. Put the sandbox API key and CLI forwarding secret in the approved local
   secret channel and set CLOUDMARKUP_BILLING_MODE=stripe-sandbox.
5. Forward only the allow-listed event set to the API origin:

       stripe listen --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed,invoice.payment_action_required --forward-to <local-api-origin>/webhooks/stripe

6. Copy the CLI whsec_ value into the local secret channel, start the API with
   the typed environment contract, and exercise only Stripe test payment
   methods. A Checkout return URL is informational; verify the signed webhook
   projection and append-only grant evidence instead.
7. Remove local secrets when finished. Do not commit captured webhook bodies;
   deterministic reviewed fixtures cover CI.

The webhook verifies the exact raw request bytes before JSON parsing, rejects
stale signatures outside the configured 60-900 second tolerance, stores only
event identity/digest/order/retry/outcome evidence, and never stores signatures,
raw bodies, card data, API keys, or provider response bodies.

## Controlled-beta infrastructure status

The synth-only platform now provisions the isolated raw-body webhook ingress,
encrypted FIFO queue/DLQ, exact secret-reference permissions, and safe alarms.
It still does not authorize deployment. The durable queue consumer and
production persistence/scheduler/operator composition are explicit live-mode
blockers in `BILLING_READINESS.md`.

The infrastructure contract remains:

- Route the exact raw request to POST /webhooks/stripe, either through the API
  or a dedicated Lambda, without JSON reserialization before verification.
- Resolve cloudmarkup/<environment>/stripe/api-key and
  cloudmarkup/<environment>/stripe/webhook-signing-secret at runtime. Grant the
  billing component read access only to those exact secrets and the minimum
  database/network permissions; no browser or general worker receives them.
- Isolate Stripe sandbox/test and live accounts, secret paths, Portal
  configurations, Product/Price mappings, webhook endpoints, event stores,
  alarms, and deployment roles. No environment inherits live values.
- Configure bounded retry with exponential backoff and a dead-letter destination
  for transient processing failure. Duplicate delivery must remain safe; poison
  events need an operator reconciliation path rather than infinite silent retry.
- Alarm on signature failures, sustained webhook 5xx/retry backlog, dead-letter
  depth, projection/replay conflicts, unknown mappings, and reconciliation lag.
  Do not place request bodies, headers, payment data, or secrets in alarm text.
- Set explicit encrypted log retention and access control. Log only safe event
  identifiers, status classes, counts, latency, and correlations.
- Pin the reviewed API/event contract and provision an endpoint-specific signing
  secret. Rotation must support a bounded overlap/reconciliation plan.
- Provide a replay/reconciliation operator workflow that reuses persisted event
  identity and cannot issue a second subscription-period grant.

Before any live-mode work, pricing, tax, terms, refunds, cancellation access,
retention, incident response, and production reconciliation policy require
separate approval.
