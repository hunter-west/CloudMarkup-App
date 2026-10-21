# Controlled-beta billing operations runbooks

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

The October 1 live-billing candidate and staff credit process are documented in
LIVE_BILLING_AND_STAFF. Its owner-approved commercial catalog supersedes older
readiness examples below; production activation is still pending and must not be
inferred from this document.

These runbooks are limited to Cloud Markup fake mode, Stripe test mode, and
reviewed operator interfaces. They do not authorize live charges, deployments,
tax/refund/proration decisions, or direct database edits.

## Universal safety rules

1. Confirm the environment, Stripe account mode, organization ID, actor
   identity, plan-mapping version, webhook endpoint version, and change ticket.
2. Preserve the canonical event, subscription projection, grant, reservation,
   settlement, compensation, and audit evidence. Never repair by editing a
   balance or projection row directly.
3. Use allow-listed Product/Price pairs and known provider event IDs only. A
   replay requires the persisted payload SHA-256 and an operator idempotency
   key.
4. Record only safe identifiers, digests, counts, source/confidence, outcomes,
   and reason codes. Never paste secrets, signatures, card data, raw payloads,
   prompts, provider bodies, or repository/tenant content.
5. If live mode, automatic deployment, a new charge, a policy invention, or an
   unknown tenant is involved, stop and escalate.

## Stripe test/live setup

- Use the exact input table in `BILLING_READINESS.md`. Verify test mode in the
  Dashboard before creating or changing any object.
- Store API and webhook secrets through separate environment-scoped secret
  references. Never place values in configuration, logs, fixtures, or tickets.
- Verify Starter/Pro Product and Price pairs, USD/monthly/fixed quantity one, no
  trial, the bounded event allow-list, hosted Checkout/Portal URLs, and the
  Portal restriction to the two reviewed prices.
- Run the fake and Stripe test suites, synthesize the platform, scan secrets,
  and retain sanitized evidence. Live setup remains blocked pending every live
  blocker in `BILLING_READINESS.md`.

## Webhook signing-secret rotation

1. Record the current endpoint/mapping versions and queue/DLQ baseline.
2. Create the replacement secret in Stripe test mode and store it only at the
   current secret reference. Move the prior value to the environment's
   `webhook-signing-secret-previous` reference for a bounded overlap.
3. Configure both references; they must differ. Verify test events signed with
   each secret report only `current` or `previous`, never a secret value.
4. Watch signature/processing failure, queue age/backlog, DLQ, and stale
   projection alarms through at least the documented retry window.
5. After Stripe no longer signs with the previous secret and reconciliation is
   clean, remove the previous reference and delete/disable it through the
   approved secret-management process. Retain versioned audit evidence.

## Starter/Pro mapping change or mismatch

1. Suspend expensive operations for affected organizations if entitlement or
   grant correctness is uncertain.
2. Compare provider Product/Price pairs with the allow-list and verify Starter
   `200` / Pro `1,000` credits, USD/monthly/fixed quantity one, and no trial.
3. If a mapping is wrong, restore the last reviewed configuration and mapping
   version. Do not reinterpret old events under an undocumented mapping.
4. Replay only persisted known events by ID and digest; then run reconciliation.
   Apply any correction as an idempotent compensation/credit adjustment with a
   reason and related evidence reference—never overwrite the ledger.
5. Resume expensive operations only after projections, period grants, balances,
   queue/DLQ, and findings are clean.

## Payment failure, dunning, and recovery

- Treat signed `invoice.payment_failed`/`payment_action_required` and reconciled
  subscription state as evidence. Do not infer a dunning schedule.
- Preserve projects, approved existing-project access, manual editing, and
  approved export. Block new paid AI when entitlement is inactive; configured
  grace cannot enable expensive operations.
- Direct the owner to the hosted Portal when policy permits. Never accept card
  data through support channels.
- On a signed recovery event, reconcile ordering, projection, subscription
  period, and grant idempotency before restoring paid operations. Do not issue a
  second grant for the same provider invoice/subscription period.

## Cancellation, downgrade, and deleted/merged organizations

- Default to cancellation at period end. Immediate cancellation requires the
  documented approver and related evidence. Upgrade/downgrade proration and
  timing remain business decisions; do not invent them.
- For downgrade, reconcile the provider period and projection; do not claw back
  credits unless an approved policy and compensation event explicitly require
  it. For cancellation, never delete projects.
- On owner change, re-authorize the caller against current organization roles;
  provider customer ownership cannot be reassigned by browser input.
- For deleted/merged organizations, quarantine unmatched provider events,
  preserve audit/ledger evidence under retention policy, block expensive
  operations, and escalate ownership resolution. Never attach them to a guessed
  tenant.

## Refund/escalation placeholder

No refund, tax, or proration policy is approved. Capture safe invoice/event and
organization references, amount/currency metadata when policy permits, the
request category, and the approver/escalation ticket. Do not promise an outcome,
issue a provider refund, alter credits, or cancel immediately until an approved
policy and authorized operator action exist.

## Reconciliation

- Run scheduled reconciliation at the reviewed cadence and an operator run for a
  single exact organization after payment/lifecycle changes, replay, mapping
  rollback, provider outage, cost anomaly, or adjustment.
- Review open/expired reservations; duplicate/missing usage; provider usage
  without settlement; monthly grants and period boundaries; impossible balances;
  mapping mismatch; compensation events; outliers; configured
  low-cost/standard/deep/repair route distribution; and repair costs.
- Compare Amazon Bedrock/provider data only at its recorded `aggregate` or
  `estimated` confidence. Do not claim exact request matching from an aggregate
  bill. Resolve findings through canonical terminal/compensation events.
- A stale projection, open reservation, or unknown mapping is fail-closed for
  new expensive work. Record the report/finding IDs and safe source references.

## Support and administration

Use only the least-privilege permissions for projection view, usage view, known
event replay, credit adjustment, expensive-operation suspension, and
organization reconciliation. Verify actor/principal IDs and the exact
organization. Every successful operation emits safe audit evidence; mutation
idempotency keys are stored only as hashes. Do not expose card data, secrets,
raw prompts/webhooks/provider bodies, private repository content, or general
tenant content. Never use a credit adjustment as an undocumented refund.

## Webhook or commercial incident

1. Suspend expensive operations when incorrect entitlement or uncontrolled cost
   is plausible. Do not disable manual editing or delete data.
2. Triage signature failures, processing failures, queue age/backlog, DLQ depth,
   stale projections, unknown mappings, and ledger findings using safe IDs.
3. Preserve the queue/DLQ and canonical receipts. Do not repeatedly replay a
   poison event; replay only a known event with its persisted digest and a fresh
   operator idempotency key.
4. Rotate secrets if compromise is suspected, using the bounded dual-secret
   procedure. Roll back mappings using the mapping procedure.
5. Reconcile, document scope and source/confidence, obtain incident approval,
   and resume expensive operations only after evidence is clean.

## Model-provider outage

- Stop new paid dispatches when a safe terminal state cannot be recorded.
  Reservations remain open until evidenced release/settlement/compensation;
  timeouts alone do not refund credits.
- Do not silently reroute beyond reviewed low-cost/standard/deep/repair policy
  or fabricate provider success. Record provider outage and aggregate evidence
  confidence, reconcile pending attempts after recovery, and apply only
  idempotent compensation events.

## AI cost spike

1. Suspend expensive operations with reason `ai-cost-spike`; preserve existing
   projects/manual editing/export according to policy.
2. Inspect per-attempt normalized estimates, aggregate provider totals and
   confidence, route distribution, automatic retries/system escalations, and AI
   custom-generation repair costs. Do not infer exact provider request costs
   from aggregate data.
3. Check mapping, duplicate settlement, unbounded retry symptoms, and route
   configuration. Do not raise limits or enable overage.
4. Correct only reviewed configuration, run reconciliation, record compensation
   if warranted, and obtain approval before resuming expensive operations.

## Exit evidence

For every runbook execution retain: environment/test-mode proof, actor and
principal IDs, exact organization, ticket, configuration/mapping/endpoint
versions, timestamps, safe event/ledger/report/finding references, command/test
results, alarm recovery, decision owner, and resume/continue-suspension outcome.
