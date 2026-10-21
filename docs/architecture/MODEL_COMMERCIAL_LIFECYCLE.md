# Model commercial lifecycle

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

## Status and ownership

Prompt 34A is the provider-neutral commercial wrapper for ModelGateway work. It
connects the completed Prompt 34/34R routing and normalized-usage boundary to
the canonical Prompt 24A entitlement, grant-backed reservation, and append-only
organization usage ledger. It does not create a second credit balance.

The implementation is local and deterministic. It contains no provider SDK,
model credentials, Stripe call, hosted worker composition, or deployment. Prompt
35's Bedrock Runtime adapter exists outside this lifecycle, but no deployed live
host composition is enabled here. A future host may dispatch only while it owns
the store-issued fenced runtime and commercial execution leases, after
`ModelCommercialReservationIntentV1` resolves to an exact
`ModelCommercialReservationReceiptV1` through reserve or read-only recovery, and
after a separate `ModelCommercialDispatchIntentV1` is durably recorded. The
callback itself has no commercial, clock, replay, or release authority.

## Invocation order

Proposed [ADR-0045](../adr/0045-memory-only-ai-previews.md) adds a distinct
memory-only preview recovery path. Known, authenticated, reservation-priced
usage with unconfirmed delivery may use the existing compensated customer
outcome; unknown usage remains held for reconciliation. A database-clock
acknowledgement deadline is not no-dispatch evidence. Recover-only execution
must join the exact journal, request, reservation/dispatch intents and usage; it
cannot reserve again or invoke a model. The platform USD reservation remains
retained independently. This lane and its canonical SQL accounting bridge are
not activated by the design or its focused tests.

For one idempotent operation or multi-call workflow, the coordinator:

1. parses the bounded request and obtains trusted host time;
2. through the runtime service's read-only `inspect` and tenant-first `claim`,
   atomically rechecks `snapshotDigest` and claims idempotency, per-user/
   organization/feature request quota, active concurrency, cache-inclusive
   capacity, the initial telemetry outbox, and `ModelRuntimeExecutionLeaseV1`;
3. resolves trusted organization, user, plan, entitlement, suspension,
   environment, allow-list, and one approved Standard or Deep route;
4. selects immutable pricing and credit-normalization versions for every planned
   call at trusted reservation time and pins those exact versions in the
   reservation context;
5. calculates conservative minimum/maximum credits and maximum provider-cost
   micros, then returns the estimate without dispatch when confirmation remains
   outstanding;
6. obtains `ModelCommercialWorkflowExecutionLeaseV1` through `claimExecution`,
   then persists a digest-authenticated `ModelCommercialReservationIntentV1`
   under the fenced workflow lease/revision before asking accounting to reserve;
7. records the canonical result and exact
   `ModelCommercialReservationAccountingStatusV1` in
   `ModelCommercialReservationReceiptV1`;
8. when an intent exists without a receipt, calls the read/replay-only
   `recoverExistingReservation` seam before any ordinary unexpired execution may
   reuse that exact intent to reserve; recovery-only execution always calls that
   seam, even for a stored receipt, to refresh canonical status and never
   creates a missing reservation;
9. rechecks trusted time, commercial/lease expiry, route, reservation, fencing
   token, and expected revision immediately before dispatch; clock expiry alone
   denies dispatch and never releases credits;
10. persists one `ModelCommercialDispatchIntentV1` with compare-and-swap before
    allowing the callback to start;
11. validates the host invocation receipt and bounded result without trusting
    callback timestamps, IDs, or failure text;
12. prices authenticated usage only with the reservation-pinned pricing and
    normalization versions and integer arithmetic;
13. settles no more than the reserved amount; accepts coordinator-owned or
    externally verified no-dispatch Evidence for unused release; and may release
    customer credits for authenticated priced post-dispatch failure while
    recording measured usage as compensated;
14. sends every unknown or invalid post-dispatch outcome to a fixed safe
    reconciliation state while retaining the reservation;
15. atomically stores runtime claim and pending/terminal state with
    deterministic content-free telemetry outbox intents; and
16. drains those stable event IDs idempotently on ordinary execution and exact
    replay without invoking again.

Every stored record change requires the store-issued lease and expected-revision
compare-and-swap; `releaseExecution` separately requires the current fenced
lease and releases only commercial workflow execution ownership. A concurrent
exact duplicate sees in-progress or terminal state instead of invoking; a
changed duplicate conflicts. Separately, runtime store `release` returns only
verified active concurrency. Accepted request counts and cumulative live
capacity remain conservatively consumed. The accepted route, authorization,
pricing/normalization pins, and credit cap survive later plan or price changes
for settlement of already-reserved work. The coordinator's `recover(request)`
entry point and a runtime `ModelRuntimeExecutionLeaseV1` with
`recoveryOnly: true` can only recover persisted accounting/workflow state; they
cannot reserve missing work or invoke a model.

## Prompt 38 fenced execution contracts

The runtime boundary authenticates exact host-issued input Evidence before
authority resolution, state inspection, or this commercial workflow. The
Evidence binds the tenant/user/operation/input, requested counts/allow-lists,
redaction, source ownership, and absence of external authority; it is retained
in the invocation fingerprint and exact replay. The technical protocol then uses
these exact provider-neutral bindings:

- `claimExecution` issues `ModelCommercialWorkflowExecutionLeaseV1` with
  `leaseId` and `fencingToken`; workflow records carry a monotonic `revision`;
- every state transition calls
  `compareAndSet({ expectedRevision, lease, record })`; `releaseExecution`
  releases commercial workflow execution ownership only and cannot release
  runtime capacity, credits, or accepted request/live capacity;
- the workflow record persists
  `reservationIntent: ModelCommercialReservationIntentV1`,
  `reservationReceipt: ModelCommercialReservationReceiptV1`,
  `dispatchIntent: ModelCommercialDispatchIntentV1`, and
  `invocationReceipt: ModelCommercialHostInvocationReceiptV1`; its resolved
  context stores trusted `reservationOccurredAt`;
- canonical accounting scopes otherwise equal caller-visible opaque reservation
  and idempotency IDs by verified organization/project/user identity; cross-
  tenant recovery or lifecycle mutation fails closed;
- `ModelCommercialReservationAccountingStatusV1` is the closed
  `active`/`denied`/`expired`/`released`/`settled` state bound into the receipt,
  while `ModelCommercialReservationRecoveryResultV1` returns only `found` with
  that status or `not-found`;
- `ModelCommercialAccountingPort.recoverExistingReservation` is read/replay-only
  and must never create a reservation; coordinator `recover(request)` calls it
  even when a stored receipt exists so the matching canonical status is
  refreshed, and cannot call the provider or fall back to reserve;
- `ModelCommercialAccountingPort` has no generic `expire` mutation. `expired` is
  only a canonical read/recovery status from a future authenticated accounting
  process; trusted time alone cannot release a reservation;
- `ModelCommercialPricingAuthorityV1` binds `authorityDigest`, `capturedAt`,
  `pricingCatalogDigest`, `normalizationPolicyCatalogDigest`, and exact
  `routePins`; and
- `ModelCommercialCoordinatorPreDispatchProofV1` is host-owned no-dispatch
  Evidence derived only from a persisted dispatch intent, trusted host expiry,
  and authenticated coordinator knowledge that the callback did not start. Time
  alone is not release Evidence. A callback-origin no-dispatch claim instead
  requires `ModelCommercialPreDispatchNoUsageAttestationV1` verified by
  `ModelCommercialHostAttestationPortV1`.

Closed safe outcomes include `callback-outcome-unknown`,
`unsafe-provider-receipt`, `host-attested-pre-dispatch-no-usage`,
`reservation-expired-before-dispatch`, and `missing-provider-usage`. Unsafe
post-dispatch candidate metadata is discarded before the fixed reconciliation
record is built.

## Pricing and normalization

`ModelProviderPricingVersionV1` is immutable and effective-dated by provider,
model, model version, inference profile, and environment. It supports integer
micros per million input, output, cache-read, and cache-write units plus named
provider-specific unit rates. Overlapping windows are invalid. A
`disabled-pricing-unavailable` version makes estimation and settlement fail
closed when a trustworthy price is unavailable.

`CreditNormalizationPolicyVersionV1` is a separate immutable effective-dated
policy for one cost currency. The initial deterministic calculation is:

```text
normalized cost = estimated provider cost + rounded-up operating buffer
credits = rounded-up normalized cost / configured credit-unit micros
```

Pricing and normalization are selected once from trusted reservation time for
each planned call and retained as immutable reservation pins. Settlement must
use those pins even if prices change or the callback reports a different start
or completion time. Provider/callback timestamps remain sanitized latency and
lineage observations only; they cannot select a price, policy, expiry, or
charging rule.

Both the buffer and credit unit are versioned internal configuration. They are
not customer billing, margin disclosure, a current provider-price claim, or a
permanent public token/currency/dollar equivalence. Provider costs remain
integer monetary micros grouped by currency and are never sent to Stripe.

## Canonical usage evidence

Every model usage event carries:

- stable event and idempotency identities;
- organization, user, project, job, request, reservation, feature, and
  multi-call workflow identities;
- Standard/Deep route and route ID;
- provider, model, model version, inference profile, environment, prompt,
  template, pricing version, and normalization-policy version;
- input, output, cache-read, cache-write, total, and named provider-specific
  units;
- estimated provider cost in integer monetary micros and reserved, charged, and
  compensated Cloud Markup credits;
- trusted occurrence time, bounded observational start/completion times,
  aggregate latency, status, one closed safe failure code, bounded opaque IDs,
  and complete attempt lineage; and
- reconciliation state.

Raw provider or callback IDs, categories, timestamps, exception text, and
receipts are parsed and sanitized before any canonical record. Unknown or
invalid post-dispatch data maps to one fixed safe reconciliation outcome; it is
never copied into an event or used to release value. Normal events contain no
raw prompt, response, source, diagnostic, secret, or protected reasoning.

The Prompt 38 runtime store commits claim and pending/terminal state atomically
with deterministic, content-free `ModelRuntimeTelemetryOutboxEntryV1` records.
Event identity derives from immutable request and decision digests, event kind
and ordinal, and source-Evidence digest; `occurredAt` is stored once.
`listPendingOutbox` and `acknowledgeOutbox` let ordinary execution and terminal
replay drain the same entries idempotently. Host-authenticated operational
outcomes bind the exact executed request, decision, terminal digest, tenant,
operation, safe reason codes, and source Evidence before one audit/metric pair
is atomically appended; forged, cross-tenant, unexecuted, and substituted claims
fail closed, and publish retry cannot duplicate the entry. The commercial
workflow store and runtime outbox prove ownership, replay, and event delivery
only. The Prompt 34 normalized recorder remains technical evidence, and none is
a balance, credit/token counter, usage ledger, pricing authority, settlement
path, or replacement for canonical accounting.

Migration 0013 adds immutable provider-pricing and normalization-policy tables
plus `model_usage_event_details`. A detail row has its own stable event and
idempotency identities and must reference an existing organization-scoped Prompt
24A `usage_ledger_entries` row. It also references the exact pricing and
normalization versions. The `canonical_model_usage_events_v1` view joins the
technical detail to canonical ledger tenant/user/project/job/feature/provider/
model evidence. Update and delete triggers protect all three histories.

## Failure, retry, and route behavior

| Situation                                           | Required behavior                                                                                                          |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Crash after reservation intent, before receipt      | Call `recoverExistingReservation` first. Recovery-only execution never creates a missing reservation.                      |
| Recovered reservation found                         | Require the canonical replay/result and accounting status, persist the receipt, and continue without another reservation.  |
| Recovery-only request finds no reservation/workflow | Return the bounded reservation-denied result; do not reserve or invoke.                                                    |
| Recovery-only request has a stored receipt          | Re-read canonical accounting, persist only the matching refreshed status, and fail closed if it is missing or conflicts.   |
| Trusted expiry after persisted dispatch intent      | Release only with coordinator proof that also authenticates callback-not-started; trusted time alone is insufficient.      |
| External host proves dispatch did not start         | Verify exact tenant, workflow, reservation, and dispatch-intent identities through `ModelCommercialHostAttestationPortV1`. |
| Callback/provider merely claims no dispatch         | Ignore the claim as release authority; retain the reservation and reconcile.                                               |
| Authenticated priced failure with no useful output  | Release customer credits, record measured provider usage as compensated, and do not describe the result as no dispatch.    |
| Timeout, cancellation, throw, missing/invalid usage | After a dispatch intent, retain the reservation and enter fixed safe reconciliation unless authenticated evidence applies. |
| Crash or replay after persisted dispatch intent     | Never invoke again; resume receipt handling or reconciliation under the fenced lease/revision.                             |
| Successful authenticated usage                      | Price with reservation pins and settle no more than the reserved maximum.                                                  |
| Settlement failure                                  | Save the authenticated receipt and retry settlement without another callback.                                              |
| Concurrent exact duplicate                          | Return in-progress or terminal replay state; only the fenced lease owner may dispatch.                                     |
| Changed duplicate                                   | Fail with an idempotency conflict.                                                                                         |
| Commercial/lease expiry before dispatch intent      | Fail at trusted host time without invoking; do not release on clock alone, and recover only canonical reservation state.   |
| Plan/price change during reservation                | Settle against the accepted snapshot, pinned pricing/normalization, and cap.                                               |
| Administrative suspension                           | Deny new work before reservation; do not reinterpret already-authenticated settlement.                                     |
| Standard-to-Deep escalation or repair               | Remain within the pinned workflow maximum or record the increment as compensated; never create automatic overage.          |
| Estimate overrun                                    | Charge at most the reservation, mark the increment compensated, and create no overage.                                     |

Only coordinator-owned proof derived from persisted intent plus trusted host
time, or separately verified host Evidence, can distinguish not-dispatched from
uncertain processing. Callback booleans, exception types, timestamps, provider
text, and missing data cannot establish no-dispatch release authority.
Authenticated priced post-dispatch failure uses explicit compensation/release
semantics instead. Reconciliation uses fixed safe codes, bounded opaque
identities, and authenticated Evidence digests while raw provider details remain
outside the canonical ledger and telemetry.

There is no unauthenticated, time-driven accounting expiration seam in this
package. `expired` remains a canonical read/recovery status. Controlled
production expiration is future work and must flow through ADR-0010 accounting
authority with verifiable predispatch or reconciliation Evidence.

## Quotas and safe contracts

Pre-invocation policy enforces per-user, organization, and feature request
counts; active concurrency; maximum input/output settings; route/model
allow-lists by plan/environment; entitlements; suspension; and available
credits. Idempotency, request quotas, active concurrency, and the store-issued
execution lease are acquired atomically, so concurrent distinct requests cannot
both pass a stale snapshot. Exhaustion is a hard denial before callback
invocation. Lease release returns active concurrency exactly once but does not
refund accepted request counts or cumulative live-authority capacity. There is
no automatic Stripe overage.

Customer-safe contracts expose only the credit estimate range, Standard/Deep
label and explanation, reservation accepted/denied state, completed credits,
optional technical units, usage summaries, stable denial reasons,
compensation/reconciliation status, and safe identifiers. Internal contracts
hold the full canonical event, pricing, and normalization evidence. Safe
responses never expose provider cost, operating buffer, credit-unit conversion,
margin, raw prompt, or raw response.

## Reconciliation

Provider-neutral ports and deterministic fakes cover aggregate provider-cost
reconciliation, missing or invalid usage, unknown/post-dispatch outcomes,
open/expired reservations, outlier detection,
route/provider/model/feature/environment reporting, and customer-credit
compensation reconciliation. The reservation intent/receipt, separate dispatch
intent, and any authenticated host invocation receipt are persisted before the
corresponding reconciliation decisions. Unknown failures map to a fixed safe
code and bounded opaque identities; raw provider errors, secrets, and
unrestricted metadata are neither logged nor copied into canonical events. These
scans report immutable evidence and candidate work; they do not reinvoke,
rewrite usage, silently release a reservation, or silently change credits.

## Current stopping point

The coordinator, deterministic pricing domain, strict internal records,
append-only canonical accounting contracts, reconciliation ports/fakes, and
focused tests are the current provider-neutral boundary. Prompt 38 hardens the
reference workflow with fenced lease/revision transitions, persisted reservation
intent/receipt, read-only accounting recovery that refreshes stored receipts,
recovery-only runtime leases, persisted dispatch intent, pinned
pricing/normalization, exact no-dispatch versus compensation/release Evidence,
and atomic telemetry outbox semantics. Final affected and repository gates
remain tracked by the active Prompt 38 plan. Complete hosted runtime/commercial
persistence, provider invoice ingestion, live evaluation/promotion, Stripe
activity, and deployment remain outside this boundary.

## Prompt 35 live-provider composition

`ModelIntentCommercialServiceV1` joins the first Bedrock Runtime adapter to this
lifecycle without creating a second accounting path. A future host composition
may call its adapter only after atomic idempotency/quota/concurrency
acquisition, a canonical upper-bound credit reservation, trusted-time expiry
rechecks, persisted reservation intent/receipt, and a separate dispatch intent
under the store-issued fenced lease/revision. A recovery-only lease uses
`recover(request)`, refreshes canonical accounting status even when a receipt is
stored, and cannot call the adapter or create a reservation. The adapter
verifies the selected commercial route against the routing decision and returns
bounded attempt/usage evidence; it cannot choose time, pricing, normalization,
settlement, release, or replay policy.

Timeout, cancellation, callback throw, missing usage, malformed metadata, or any
other unknown/invalid post-dispatch outcome retains the reservation and enters
the fixed safe reconciliation path. Coordinator proof can establish
not-dispatched only from the persisted intent, trusted expiry, and authenticated
knowledge that the callback did not start, while callback-origin no-dispatch
evidence requires the separate host verifier. Authenticated priced post-dispatch
failure may release customer credits with measured usage recorded as
compensated; it does not claim the dispatch never started. Authenticated usage
settles against the reservation-pinned pricing/normalization versions and credit
cap, regardless of callback timestamps or later price changes. A crash or
duplicate after `ModelCommercialDispatchIntentV1` never calls Bedrock again.
Runtime pending/terminal state and deterministic content-free
`ModelRuntimeTelemetryOutboxEntryV1` records commit atomically, and exact replay
drains them by stable `outboxId` through `listPendingOutbox` and
`acknowledgeOutbox`.

Live enablement therefore requires trustworthy pricing and credit-normalization
records plus the reviewed route and fenced host composition. Provider cost
estimates, buffers, conversion policy, and margins never enter the safe Intent
API contract, and no Stripe overage is initiated. Prompt 38 exposes the
already-computed maximum provider-cost micros and accepted credit maximum only
after the canonical reservation. Its authority-digest live capacity fence
accumulates conservative admission projections across requests but cannot price,
settle, release credits, or change a balance. Workflow/lease/dispatch/outbox
state is not a second estimator, reservation, token/credit counter, usage
ledger, or settlement path; canonical accounting remains authoritative.

The direct evaluation harness cannot consume this composition: all live-mode
attempts fail before adapter invocation. A future reviewed live-evaluation host
port must carry the store-issued lease/revision and recovery-only state;
reservation intent/receipt and read-only recovery that refreshes stored
receipts; no generic accounting expiration mutation or clock-only release;
canonical `ModelCommercialDispatchIntentV1` and
`ModelCommercialHostInvocationReceiptV1`; safe reconciliation/outbox state; and
deterministic validator Evidence into each result.

## Separate platform dispatch spending ceiling

The restoration adds migration `0019` for durable gateway invocation claims and
verified result-object references, not commercial settlement or a runtime lease
store. Its restricted-content object port remains uncomposed. Migration `0020`
adds a different, application-owned protection described in accepted
[ADR-0043](../adr/0043-platform-model-dispatch-spending-fence.md): an
append-only USD 50 monthly dispatch reservation fence shared by all
organizations in the authoritative beta database. Database UTC time and a global
transaction lock plus insertion trigger enforce the aggregate maximum in integer
micro-USD.

This does not replace canonical customer-credit reservations, pricing,
normalization, usage, settlement or compensation. It is a separate host spending
stop that can deny a provider call even when customer credits are available.
Every retry/repair/escalation needs its own exact-payload reviewed provider-cost
ceiling. Missing pricing, unknown billing components or contradictory model,
profile, pricing-version or scope evidence fails closed. No production cost
resolver, rate constant or enabled model route is supplied by this addition.

The supplied final SDK HTTP handler rechecks the reservation after credential
and signing middleware, permits one raw send per private context, and propagates
pre-dispatch and hard month/pricing deadlines through connection waits. All
reserved ceilings remain consumed for that UTC month, even on success, failure,
cancellation or uncertain charge. There is no platform refund/settlement API.
Customer compensation cannot refund this platform allowance, and a budget denial
cannot invent zero provider usage or authorize release of customer credits.

Production activation still requires the real reviewed pricing authority, the
existing fenced runtime/commercial stores and trusted host evidence, actual SDK
construction using the final guarded handler, restricted result-object policy,
provider availability and evaluation, and passing real PostgreSQL/release gates.
This application-only cap does not cover unrelated AWS usage. Client abort does
not prove the provider stopped billing, and the ledger's UTC reservation month
does not guarantee AWS invoice-posting timing. Rollback disables dispatch while
preserving immutable reservation evidence.

## Memory-only normal Intent reservation bridge

The schema-`0028` checkpoint added `PostgresModelCommercialReservations` with
only `reserve` and `recoverExistingReservation`, not the complete model
accounting port or production activation. It maps `intent.extract` to
`ai-assisted-operations` under the versioned captured-runtime-window policy in
proposed [ADR-0045](../adr/0045-memory-only-ai-previews.md).

The exact persisted workflow reservation intent and runtime scope/fingerprint
are checked alongside current organization/member/project authorization. The
canonical account lock serializes grants, existing credit reservations and
accepted decision counts. The immutable model decision, grant allocations,
canonical reservation ledger event and technical model usage detail share one
transaction. Database-time checks after locks and before commit reject expired
windows or execution authority. Counts use the original half-open organization
and user windows; unknown open canonical reservations remain concurrency holds.

Model pricing uses a distinct immutable lineage selector on the same canonical
reservation and ledger tables. Generated selectors preserve validated foreign
keys into the legacy or model pricing catalog; old rows and old writers retain
the legacy default. Exact model pricing/normalization pins come from the saved
workflow, never browser-provided prices or duplicated legacy pricing rows. No
new policy, pricing row, subscription or credit grant is seeded by the change.

Recovery is lookup-only, including when a decision is absent, and returns the
existing canonical status with exact scope/intent binding. Denials are durable
and cannot turn into a later same-key debit. Legacy expiry/terminal APIs reject
model-priced reservations. At that checkpoint SQL refused model terminal ledger
entries until a verified model terminal bridge existed; a host must not fill
missing methods with synthetic success.

Historical SQL checksums remain unchanged. Rollback disables new model
composition while retaining canonical evidence; do not drop model decisions or
refund uncertain usage. Registered migration, concurrency, legacy compatibility
and source-bound release evidence belong in the service continuation, not a
claim that this partial bridge is live.

## Metadata-only terminal continuation (locally registered `0029`)

The next isolated worktree implements `settle`, `release`, and
`markReconciliationRequired` for exactly one primary Standard `intent.extract`
call. Its additive migration is registered in the isolated next worktree and
verified through the normal PostgreSQL migration loader, not deployed authority.
It does not enable an API route, model, policy, price, credit grant, evaluation
admission, or provider adapter.

An append-only accounting outcome references the original immutable commercial
workflow revision, request fingerprint, canonical reservation, dispatch intent,
and pricing/normalization pins. The host independently reads the exact
metadata-only preview journal. Acknowledged delivery can settle actual
normalized usage, capped at the accepted customer reservation. Known failed
delivery releases the customer hold and records absorbed provider cost as
technical compensation; it never creates a compensating grant or refunds the
separate platform USD hold. Unknown usage remains active and
reconciliation-held. Clock expiry alone does not manufacture usage evidence or
release customer credits.

For this single-primary lane, immutable nonnegative rates, the admitted per-unit
maximums and one identical normalization policy bound actual normalized credits
by the reserved maximum. The defensive charge cap remains, but tests do not
invent an admitted overrun by weakening those bounds. Real PostgreSQL cases
exercise cache read/write, provider-specific units, fractional-micro ceiling,
nonzero operating buffer, and failed-delivery compensation.

The canonical account/reservation locks, existing grant-allocation arithmetic,
terminal ledger, technical detail and new outcome journal share one transaction.
SQL independently binds delivery and priced usage and requires exact terminal
ledger/detail lineage at commit. Failure rolls back every credit effect. One
canonical terminal outcome is allowed; replay after a committed settlement or a
lost workflow save returns the same verified outcome without a second charge.

`0022` workflow history and frozen reconciliation responses remain unchanged. An
optional host-only terminal recovery port can verify later usage/delivery and
append the terminal continuation, then return its strict bound response. It
cannot reserve, dispatch, invoke, mint execution leases, release request debits,
or refund platform spending reservations. An absent or unavailable port retains
the old held behavior. Current principal/session authorization remains a
required host wrapper; SQL additionally rechecks current tenant roles. The
accounting journal contains bounded receipts, hashes, counts and usage metadata
only—never prompts, candidate bodies, delivery tokens, or content-object
references.

Recovery still requires the original actor, membership and project to be active
with current mutation and expensive-operation permissions. Archiving/deleting a
project or revoking that actor can therefore leave an existing hold requiring a
separately authorized operator/accounting continuation. This slice neither
relaxes those checks nor invents a system principal. Hosted activation must
coordinate deletion, cancellation and reconciliation; post-deletion holds are
not claimed to resolve automatically.

The truthful internal charging scenario is `model-preview-delivered-v1`, not
user rejection or system repair. The closed legacy public pricing/settlement and
technical usage v1 decoders are unchanged. Current production commercial reads
return numeric balances, not this internal scenario; a future public technical
usage endpoint needs an explicitly compatible versioned projection.

Model-provider keys now support lowercase nonempty dot-separated namespaces up
to 64 characters, retaining every previously accepted lowercase hyphen key. This
preserves the real gateway identity, including `cloudmarkup.amazon-bedrock`,
without an AWS-specific remapping in shared code. Only model pricing and
model-authorized reservation/terminal paths use the new grammar. Legacy provider
pricing, billing provider names and ordinary terminal methods retain their
existing validation. Historical migration bytes and pricing foreign keys remain
unchanged; rollback disables the new composition while retaining all evidence.

### Real memory-only factory and final dispatch fence

`apps/api/src/production-ai-intent-preview.ts` composes the real deterministic
input/output metadata verifier, non-replayable preview journal, normal runtime
admission store, commercial workflow/accounting stores and coordinator. The
runtime is the sole commercial entry; its reserved callback invokes the gateway
without another reservation or queued job. The exact complete provider request
stays in RAM and is compared again at the adapter. No input/result object port
or invalid-proposal content store is supplied.

The actual SDK request handler performs a fresh host-owned dispatch check after
cost lookup, database reservation and credential/signing work. The real runtime
closure re-resolves current route/policy authority and checks its exact lease;
the host supplies current authenticated session/editing expiry. Only exact
data-only canonical expiry metadata is accepted. The final handler reserves its
single handoff before awaiting that check, then synchronously rechecks
cancellation, authority expiry, the five-second dollar deadline, UTC month and
price expiry before physical handoff. There is no asynchronous wrapper below the
spending fence. The minimum authority/month/pricing expiry also bounds the
handed-off request, and uncertain dollar reservations remain retained.

This factory is not an authenticated public route or a completed AI workflow.
Current session/baseline/editing authorization, reviewed request assembly,
commercial entitlements/pricing/normalization, authoritative telemetry delivery,
provider configuration and USD cost authority remain explicit host ports.
Metadata identities do not grant authority. The unchanged runtime still refuses
normal real-model admission without the separately reviewed current activation
bridge described by ADR-0035; held evaluation reports are not promoted by this
factory. Tests distinguish real PostgreSQL component/denial evidence from an
unavailable positive normal-model end-to-end. Public request/ACK transport,
accepted Intent persistence and graph generation remain separate integration
work; no temporary unaccepted content retention is authorized.

## Private recorded repair evaluation settlement

The unregistered M9 V4 extension completes only evaluations whose first and
conditional final attempts have immutable known usage and native validation, or
an exact unused-final proof. SQL independently reconstructs that receipt and
verifies per-attempt pinned pricing, per-attempt credit rounding, aggregate
usage and host timing. One original reservation yields at most one settlement;
replay verifies its receipt and ledger without another charge. A recorded
invalid candidate remains evaluation evidence, not a quality pass.

Normal private completion requires original RAM-bound input and current host
authority. A separate financial recovery method can settle the same completely
recorded evaluation after RAM/host loss. It rechecks current authenticated
tenant authorization, exact original workflow/runtime bindings and the
SQL-verified receipt; it cannot reserve, count, dispatch or restore content.
Replay verifies one existing settlement. Missing usage remains held. The
read-only metadata port still exposes no financial or send capability. Known
failed first/final attempts release through SQL-verified original usage,
retaining provider cost and zero customer charge. Database-clock expiry is
recorded under the dispatch locks after the original request deadline. Zero-send
and completely known partial cases release with zero customer charge; any
dispatched attempt without usage remains held. The private zero-usage projection
requires that exact SQL-issued proof. Hosted activation remains incomplete.
Historical single-primary sources and migration history are unchanged, and this
extension is not registered for deployment.

The private case reader restores both selected stage outcomes only from the
exact SQL-verified validated, failed or expired receipt and independently read
usage/validation metadata. A known provider failure remains failure. A lost
candidate with known usage remains unknown quality, even after financial
release. Missing usage remains pending and held. This read-only operation
retains current tenant authorization and original selection/runtime bindings; it
neither mutates accounting nor restores source content.
