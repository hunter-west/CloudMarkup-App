# Commercial Model

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

## October 6 local staff trial preparation

The [staff trial proposal](../adr/proposed-staff-trials.md) and implementation
plan add local, synthetic-tested evaluation access separately from paid
subscriptions. Provisional bounds are one trial per billing account, 1–30 days
and 1–1,000 credits. The owner selected all current Professional features and
limits, including beta AI, team sharing and repository/Terraform/CloudFormation
exports. Expiry/revocation prevents new trial admissions; paid access/credits
are preserved. No production trial, staff permission, balance change, migration
or deployment is authorized by this preparation. The historical no-trial beta
descriptions below remain historical configuration, not this local proposal.

## Current approved credit policy

On September 30, 2026, the owner revised Pro to **$39/month with 1,250 credits
per eligible paid monthly period**. This is a new immutable version; earlier
plan definitions and paid grants below remain historical. Monthly credits expire
at the subscription period end and successful renewal grants the next allowance
once, without erasing purchased credits.

Purchased packs are **$5 for 100**, **$15 for 350**, and **$30 for 800**
credits; purchased credits never expire. These retail amounts do not redefine
model token accounting or the internal cost-to-credit conversion. Checkout for
packs remains unavailable until its payment flow is implemented.

See
[billing architecture](../architecture/BILLING_AND_USAGE.md#september-30-allowance-successor)
for version selection, migration and rollback boundaries.

## Purpose

This document is the canonical product record for beta subscription examples,
entitlements, Cloud Markup credits, and customer-facing commercial boundaries.
Detailed accounting and trust boundaries are defined in
[Billing and Usage](../architecture/BILLING_AND_USAGE.md). Implementation status
remains in [Project Status](../PUBLIC_STATUS.md).

Solution semantics are independent of commercial state. Architecture, Workload,
External Resource, Application Contract, Repository Snapshot, Observed Solution,
Solution Revision, Active Issue, Evidence, generation coverage, and
source-ownership records neither grant an entitlement nor spend credits. See
[Solution, Repository, and Continuous-Evidence Contracts](../architecture/SOLUTION_REPOSITORY_AND_EVIDENCE.md).
An entitled future model operation still requires its own atomic credit
reservation and append-only settlement/release/expiry evidence.

## Organization commercial model

Every Cloud Markup account is an organization. A personal account is a
single-member organization, not a separate tenant or billing model. Each
organization owns exactly one Cloud Markup billing account and, when subscribed,
at most one current external-provider customer/subscription projection.
Organization credits are pooled.

The public current-plan contract summary exposes organization, billing-account,
and subscription lifecycle evidence separately. `organizationState` is `active`
or `suspended`; `billingAccountState` is `active`, `suspended`, or `closed`; and
`subscription` is independently `not-subscribed` or a projected provider state.
A non-active billing account cannot report new expensive operations as enabled.

Plan definitions, versions, effective periods, feature entitlements, numeric
limits, and proposed price metadata are versioned configuration. They are
reviewable beta examples, not hard-coded legal or contractual terms.

## Fixed monthly beta plans

The active beta configuration contains exactly two paid monthly plans:

| Plan    | Price metadata | Included editors | Active projects | Monthly credits | Concurrent AI jobs | Configured entitlement posture                                                                                                                                                             |
| ------- | -------------- | ---------------- | --------------- | --------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Starter | 9 USD monthly  | One              | 5               | 200             | 1                  | Manual editing, diagrams, and ZIP; Terraform and AI remain subject to their implemented policy; GitHub export and customer-workflow artifact export are disabled                           |
| Pro     | 39 USD monthly | One              | 25              | 1,000           | 2                  | Starter configuration plus GitHub App branch/pull-request export; an approved export may include the five deterministic customer-workflow files, subject to organization policy and limits |

These rows describe authorization configuration, not production activation or
customer-cloud authority. The customer-owned workflow generator implements
deterministic generation and GitHub export of five optional workflow files, but
Cloud Markup does not run them, hold customer roles/state/secrets, approve an
environment, collect their live plan/deployment Evidence, merge, or deploy.
Customer workflow beta/production activation remains blocked on the reviewed
architecture CLI distribution, digest, installation procedure, exact pipeline
registration, and support policy plus authoritative execution-boundary
verification of the selected GitHub Environment policy.

Historical Starter and Pro configurations keep CloudFormation disabled. The
restricted hosted-export implementation adds configuration
`cloudmarkup-beta-cloudformation-plans-2026-09-12-v1` and Pro successor
`planver_pro_2026_09_12_v4`. It enables only the implemented infrastructure-only
CloudFormation target, preserving the previous Pro price, 1,000 monthly credits,
ten included members and every other entitlement and limit. Starter is
unchanged. This is source configuration under verification; it does not
establish a live export service or retroactively change an organization's plan.

The explicit reconciliation mapping
`cloudmarkup-starter-pro-export-mapping-2026-09-12-v3` may select that Pro
successor only from current verified subscription state whose effective period
begins at or after 2026-09-12 16:15 UTC. Historical deliveries cannot roll a
current successor back into an earlier Pro configuration. Existing credit
grants, ledger records and completed decisions retain their original versions.
Each new export requires an active subscription, validation-job entitlement and
both expensive-operation switches; the worker checks those same current rules
before and after each actual stage. A queued request is not continuing
authority. Export uses the existing zero-credit data-export semantics and cannot
reserve credits for AI or application stages it does not execute.

The new beta service profile keeps billing sessions, AI, Terraform execution,
application generation and customer deployment-workflow activation disabled.
Release admission requires the exact separate FIFO consumer and pinned offline
compiler/native diagram assets. Product availability still requires the hosted
verification recorded in [Project Status](../PUBLIC_STATUS.md). The current
configuration has no recurring free plan, no trial, no automatic overage, no
annual price, no coupon, no credit pack, and no Team or seat-billing
implementation. A public demo or seeded local project may exist without a Stripe
subscription, but it cannot grant paid AI usage.

The fixed sandbox reconciliation mapping is versioned server configuration:

| Plan key | Product ID              | Monthly Price ID         |
| -------- | ----------------------- | ------------------------ |
| starter  | prod_ExampleStarterTest | price_ExampleStarterTest |
| pro      | prod_ExampleProTest     | price_ExampleProTest     |

Product and Price IDs are non-secret identifiers, but they are allow-listed
operator configuration. The browser supplies only a plan key; it cannot choose
an arbitrary Product, Price, amount, credit quantity, entitlement, trial,
coupon, or subscription quantity.

Final pricing, taxes, terms, refunds, cancellation access, retention, regional
availability, support, and production use still require separate product/legal
approval.

## External billing-provider boundary

The billing-provider adapter implements provider-neutral hosted Checkout, hosted
Customer Portal, webhook verification/parsing, and subscription snapshot ports.
A dependency-free Stripe adapter is sandbox-only and optional. The deterministic
fake remains authoritative for normal local development and CI, which make no
live provider calls.

Checkout and Portal session creation are application operations exposed through
the billing interface. They require billing.manage, current server-side
organization membership and recent authentication. Beta session/UI activation is
recorded in STATUS; live Stripe promotion remains separately held. Checkout uses
one reviewed server-side Price, stable organization/billing-account metadata
without PII, approved return URLs, and an idempotency key. A success redirect is
informational and never activates access.

The Portal adapter returns only the short-lived hosted URL and requires a
reviewed configuration in Stripe sandbox mode. That configuration is expected to
permit payment-method management, invoice history, cancellation at period end,
and switching only between the reviewed Starter and Pro Prices. Quantity
changes, coupons, metered billing, automatic overage, and unreviewed proration
remain disabled.

The dedicated POST /webhooks/stripe boundary is intentionally outside the
authenticated /v1 API. It reads exact bytes, verifies the endpoint signature and
timestamp before parsing, bounds the body, and allow-lists only Checkout
completion, subscription create/update/delete, invoice paid/payment failed, and
handled payment-action-required events. Verified provider state alone may update
the local subscription and entitlement projections. Stripe remains authoritative
for payment method, invoice, and provider subscription outcomes; Cloud Markup
never stores card numbers, CVC, full payment-method data, raw webhook payloads,
signatures, secret keys, or provider response bodies.

Event identity and payload digest are persisted idempotently with attempt,
ordering, safe failure, and processed evidence. Older events cannot replace a
newer projection. Replays resume incomplete work, and one organization,
subscription, and provider period can create at most one append-only monthly
credit grant. Unknown mappings, invalid subscription shapes, deleted
organizations, and cross-tenant metadata/provider-ownership conflicts fail
closed.

Active organization owners and canonical administrators may manage billing under
commercial authorization policy version 2. Every active member may read the
permitted current-plan and aggregate commercial summaries through the billing
interface. Restricted provider-cost and technical usage detail requires separate
authorization. Administrative credit adjustment remains a trusted, audited
platform boundary rather than an organization-member permission.

See the
[controlled-beta billing readiness record](../development/BILLING_READINESS.md),
[billing operations runbooks](../development/BILLING_OPERATIONS_RUNBOOKS.md),
[Stripe sandbox operator guide](../development/STRIPE_SANDBOX.md),
[ADR-0009](../adr/0009-stripe-subscription-boundary.md),
[ADR-0010](../adr/0010-ai-credits-usage-ledger.md), and proposed ADR-0023 for
setup and architectural rationale.

## Credits, grants, and usage

Cloud Markup credits are the understandable customer-facing unit for
model-assisted features. Credits are not currency, card charges, or raw provider
tokens.

Credits come from versioned grants and append-only ledger events, not one
mutable balance field. Ordinary grant issuance covers one-time, monthly,
promotional, and purchased credits. An administrative allocation bucket may back
a trusted positive correction, but every positive or negative correction is an
`adjustment` event, not ordinary grant issuance, and is not counted again as
ordinary granted credit. Eligible allocations are consumed by earliest
expiration, then lowest configured consumption priority, then earliest start,
then stable grant ID; non-expiring grants are last. Lower priority numbers are
consumed first. Purchased-credit expiration is explicit policy data. An
unresolved policy cannot activate a purchased grant by inventing an expiration
or silently assuming none.

Within one organization, one-time grant issuance identity is the pair of
`sourcePlanVersionId` and `grantPolicyVersion`. Expiration policy determines
eligibility, not issuance identity: changing only its kind, version, or
timestamp cannot reissue credits. A newly reviewed `grantPolicyVersion` may
issue a new one-time grant. When present, `sourceReference` is an additional
same-kind replay boundary and cannot be reused to evade deduplication.

Monthly grants are idempotent for one explicit subscription period and expire at
that period's end. Credits are reserved before an expensive operation. A
reservation pins its plan, entitlement, charging, and pricing policy versions;
provider, model, and model version; and exact grant allocations. It survives a
later plan change and then settles no more than the reserved amount, releases,
or expires. Reserved allocations may settle after their grant expires, but a
later release does not revive expired availability. Retries and duplicate
messages cannot double-reserve or double-charge. Corrections use append-only
`adjustment` events and never erase provider usage or rewrite settled history.
See [ADR-0010](../adr/0010-ai-credits-usage-ledger.md).

For the beta, a Starter-to-Professional upgrade in the same genuinely paid,
active subscription period adds one supplemental 800-credit allowance. The
original 200-credit monthly grant, reservations and consumed credits remain
unchanged. This makes the period's included allowance 1,000 credits; it does not
reset the available balance to 1,000. The supplement expires at that period's
end. Repeated upgrades, retries and downgrade/upgrade cycles cannot reissue it.
No supplement is issued for an unpaid, expired, future or different subscription
period, or from historical provider state alone. This is a versioned beta
allowance; it does not create a charge or change Stripe proration.

Generation coverage, a Solution Revision, an AI-authored extension, or a
successful evidence check cannot substitute for entitlement or reservation.
Provider/model/prompt evidence stays solution provenance; provider usage and
customer-credit effects remain the separate commercial ledger facts described
below.

The canonical technical usage-event kinds are `grant`, `reservation`,
`settlement`, `release`, `expiration`, `provider-failure`, and `adjustment`.
Every event retains the applicable `chargingPolicyVersion` as immutable audit
context. Other detail is intentionally sparse by kind: fields such as project,
job, model, provider usage, reservation, and related event appear only when the
event semantics require them. Stable event, idempotency, recorder, reason,
reservation, grant-allocation, and related-event evidence provides immutable
correlation without inventing placeholder model or project data.

Provider token counts and estimated costs are internal technical/accounting
inputs, not customer-charge credits. A versioned pricing policy converts
eligible use into credits, while normalized provider usage and estimated cost
remain separate reconciliation evidence. Cost summaries stay grouped by
currency; values from different currencies are never added together. Historical
usage retains the pricing version applied at execution. The beta does not send
raw tokens to Stripe, implement pay-per-token invoicing, enable automatic
overage, or offer unlimited AI. The model commercial lifecycle keeps the model
choice behind a versioned provider-neutral commercial contract. The configured
route registry uses Claude Sonnet for Standard small or routine work and Claude
Opus for Deep, larger, in-depth, or code-generation work. These are configurable
route choices, not permanent public model or price guarantees. User-selected
Deep receives a new estimate and any required confirmation; system escalation or
repair stays inside the accepted cap or is compensated. See
[Model commercial lifecycle](../architecture/MODEL_COMMERCIAL_LIFECYCLE.md).

## Seats, entitlements, and limits

- Active owners, administrators, and editors are billable-seat candidates.
- Active viewers are nonbillable subject to the configured viewer limit.
- Pending invitations, suspended memberships, and removed memberships do not
  count as active or billable seats.
- The domain seat counter receives an effective membership snapshot. The
  authorized API/persistence boundary composes the public summary's `asOf`,
  `planVersionId`, and `contractVersion` evidence from persisted context; the
  counter does not invent time or plan evidence.
- Entitlement checks use trusted local state, never a browser redirect, client
  selector, or live provider request on every action.
- Subscription projection evidence, product entitlement,
  organization/member/project limits, and credit availability remain distinct.
  Stable denial reasons apply only to completed entitlement decisions; an
  inactive projection fails closed before a decision because subscription-change
  access policy is unavailable.
- Every numeric limit carries one versioned period from the exact vocabulary
  `none`, `subscription-period`, `calendar-month`, or `rolling-day`; a plan name
  or feature never supplies an inferred period.
- Per-member and per-project extensions require explicit versioned
  authorization, effective scope, reason, and audit evidence. When the plan
  configures the same limit, an extension must retain that configured period; it
  cannot silently change the period, lower the plan limit, or otherwise bypass
  the plan.
- A commercial suspension, credit exhaustion, or expensive-operation kill switch
  blocks new costly work only. It does not automatically remove manual editing,
  reading existing projects, access to already generated artifacts, or permitted
  data export.
- Separate security, authorization, retention, or deletion policy may restrict
  access for its own documented reason.
- Generating the deterministic five-file customer workflow set is part of the
  exact authorized GitHub export artifact; it does not invoke a model, consume
  Cloud Markup credits, or create a second token/credit counter. The canonical
  GitHub export entitlement and organization/export limits still apply before
  preview execution, and retries retain the export's existing idempotency
  identity.
- An export entitlement grants no entitlement to run GitHub Actions, assume a
  customer AWS role, read Terraform state, approve an environment, merge, or
  deploy. Those remain customer-controlled operations and costs.

Access after cancellation, failed payment, dispute, refund, or general
subscription-state change requires an explicit approved policy before
implementation. An inactive projection remains factual state evidence, but the
entitlement evaluator fails closed before returning a decision with
`Subscription-state access policy is unavailable.` This absence of a decision
neither permits nor denies read, manual-edit, artifact, export, or new-work
access under a cancellation policy.

## Failure and charging communication

Customer-facing behavior follows the versioned
`cloudmarkup-charging-and-failure-v1` policy. `chargingScenario` is the nullable
policy classification; `outcome` is the non-null technical result on every
emitted usage event. They are distinct evidence and are not interchangeable. The
canonical mapping is:

| `chargingScenario`                      | Canonical technical outcome or event treatment                         | Customer-credit result                                     |
| --------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------- |
| `request-rejected-before-invocation`    | No usage event                                                         | No reservation and no charge                               |
| `insufficient-credits`                  | No usage event                                                         | No invocation and no charge                                |
| `user-cancelled-before-invocation`      | `canceled`                                                             | Release and no charge                                      |
| `provider-failure-before-useful-output` | `provider-failure`                                                     | Release to no net charge                                   |
| `cloudmarkup-internal-failure`          | `internal-failure`                                                     | Release to no net charge                                   |
| `proposal-delivered-user-rejected`      | `useful-output-delivered`                                              | Settle actual normalized usage                             |
| `user-requested-redesign`               | No outcome on the prior event; a distinct reservation emits `reserved` | Start a new metered operation                              |
| `automatic-retry`                       | No new event; replay preserves the original event and outcome          | Reuse the idempotency identity and never double-charge     |
| `system-required-repair`                | `useful-output-delivered`; a separate correction is `compensated`      | Stay within the accepted reservation or compensate credits |

Lifecycle outcomes such as `granted`, `reserved`, `released`, `expired`,
`compensated`, and `adjusted` are technical evidence rather than charging
scenarios. `no-useful-output` remains in the technical vocabulary but has no
direct mapping from a current version 1 scenario.

Provider-usage evidence remains available for reconciliation even when customer
credits are compensated.

Cloud Markup must describe plan limits, credit consumption, renewal behavior,
expiration, and export restrictions in understandable terms. Authorized
technical views may expose the model, model version, token counts, pricing
version, and estimated provider cost. Guided and Professional modes have the
same authorized technical-detail surfaces; presentation mode never grants
access.

Product copy must not imply:

- that credits equal provider tokens or money;
- that estimated provider cost is an invoice;
- that a successful redirect grants paid access;
- that Cloud Markup stores card details; or
- that subscription purchase authorizes cloud deployment.

## Legal and policy boundaries

The M9 restoration candidate provides a compact sandbox billing workspace with
Starter and Professional monthly plan cards, truthful current subscription
state, and authorized hosted Checkout/Portal actions. Supporting details are
disclosed on demand. All views use server-authoritative scope and plans; a
redirect or remembered selection cannot grant a plan or credits. The candidate
remains preview-only until sandbox processing and runtime configuration are
verified. This bounded interface does not claim that the AI-to-repository
journey, live charging or all commercial administration is already available.

Before production billing, owners must approve pricing, terms, tax handling,
privacy disclosures, refund/cancellation policy, purchased-credit expiration,
data retention, provider trademark use, regional availability, and support
commitments. Stripe-hosted surfaces reduce payment-data scope but do not
establish legal or compliance approval.
