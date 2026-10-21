# ADR-0045: Memory-only, non-replayable AI previews

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Proposed
- **Date:** 2026-09-06
- **Owners:** Cloud Markup engineering
- **Supersedes:** None
- **Refines:** ADR-0035 only for the result replay semantics of this new lane
- **Superseded by:** None

## Context

The owner selected memory-only previews and incremental AWS beta delivery while
explicitly withholding permission to retain temporary AI inputs or unaccepted
outputs. The existing durable worker requires published input/result objects;
substituting fake object stores or dropping writes would violate that contract.
The current buffered API also cannot accommodate the Standard model's bounded
120-second processing window. The first useful bounded lane is Standard
`intent.extract`, not generic chat or direct graph generation.

[ADR-0034](0034-provider-neutral-model-gateway.md),
[ADR-0035](0035-deterministic-ai-evaluation-and-runtime-admission.md), and
[ADR-0043](0043-platform-model-dispatch-spending-fence.md) remain authoritative
for schemas, admission, canonical accounting and the $50 application dispatch
cap. Model access or successful console use is not normal-beta evaluation
authority. The user accepts that refresh/disconnect may lose unsaved results.

## Decision

Introduce a distinct versioned preview protocol with one server-owned execution
identity, exact request digest, verified tenant/principal/project scope and
baseline version. Bind current editing authority where the operation can affect
the shared project's subsequent accepted state. Reuse normal runtime admission,
host-issued input/output evidence, a single canonical commercial reservation,
strict gateway validation and the final one-send platform spending fence.

Temporary sanitized inputs and unaccepted candidates exist only in request-local
server memory and the requesting browser's memory. They must not enter queues,
object storage, database JSON, IndexedDB, local/session storage, persisted query
caches, downloads, traces or logs. Progress frames contain only bounded safe
status codes. The complete candidate is emitted only after strict schema,
semantic, evidence, resource-limit and current-authority checks. The ordinary
post-callback validation remains in place as well.

Use a dedicated authenticated API Gateway REST response-streaming Lambda lane,
preserving the same origin/WAF/authentication boundary. No public Function URL
or reusable provider credentials are exposed. Heartbeats prevent idle delivery
timeouts but confer no authority. Client disconnect is cancellation intent, not
proof that the provider stopped or incurred no charge. Logging and tracing must
be verified content-free before activation.

### Metadata-only delivery and replay

Create a separate additive preview journal. Store bounded identities, versions,
counts, timing, hashes, reservation references and verified normalized usage,
never prompt/result bodies. Do not relax the existing immutable result-object
requirements in migration `0019`. A completed duplicate returns a versioned
result-unavailable state; it cannot replay content or invoke again. Changed
requests under the same idempotency identity conflict. In-progress duplicates
cannot acquire a second dispatch permission.

The gateway gains an explicit non-replayable claim outcome rather than invented
result objects. The canonical commercial `jobId` compatibility field may carry
the server-owned preview execution identity; it is an accounting correlation,
not evidence that an async job or durable content object exists.

After producing and validating a candidate, durably record its digest and exact
provider-usage evidence before emitting it. The response carries a one-time
unpredictable delivery proof; persist only its hash. An authenticated,
content-free acknowledgement binds the same execution, principal, scope,
candidate digest and proof. The browser acknowledges only after receiving and
validating the complete candidate in memory. This receipt is not acceptance of
the proposed Intent.

The first version uses a 30-second database-clock acknowledgement window within
the existing bounded execution leases. Duplicate acknowledgements are
idempotent. Deadline expiry alone cannot prove no dispatch, release credits or
permit another invocation. A worker crash or expired execution is handled only
through a fenced, exact metadata-bound recovery path.

### Customer and platform accounting

Success is settled only after verified complete delivery. Producing an object in
memory or completing a stream write is insufficient delivery evidence. Known,
authenticated and priced provider usage with unconfirmed delivery maps to the
existing compensated/no-charge customer outcome. Missing or uncertain usage
remains reserved and reconciliation-required. The platform's full dollar
reservation is retained in every case under ADR-0043.

Recovery joins the exact journal, invocation, reservation intent/receipt,
dispatch intent, usage and delivery outcome. It cannot create a missing
reservation, invoke a model or manufacture no-usage evidence. Attempts and
rate-limit admission remain consumed even when customer usage is compensated. No
content-free replay triggers automatic regeneration. A user may explicitly
request another preview only through a new fully admitted paid attempt.

### Canonical reservation compatibility

The first host bridge maps only `intent.extract` to the existing commercial
feature `ai-assisted-operations`. Version `intent-extract-runtime-windows-v1`
uses the exact persisted normal-admission organization window for the feature
count and its user window for the per-user count. Both intervals are half-open,
`start, end)`, and admission uses database time after taking canonical account
locks. These are not lifetime counts or invented daily-reset rules. Accepted
reservation decisions consume those counts; an open canonical reservation
continues to consume concurrency even after a remote execution lease expires.

A metadata-only immutable decision binds the exact workflow reservation intent,
principal/project, runtime scope/fingerprint, captured pricing and both windows.
The decision, canonical grant allocation, reservation ledger entry and model
usage detail commit or roll back in one real database transaction. A denied
decision is durable as well. Recovery performs an exact lookup and never calls
reserve, creates a workflow, grants credits or dispatches a model.

The canonical reservation and ledger gain an immutable pricing-authority
selector. Existing rows and old writers retain the legacy provider default.
Generated legacy/model selector columns each reference their real pricing
catalog with a validated foreign key; the legacy equivalent is validated before
the exact old foreign key is replaced. Model rows must additionally bind their
accepted canonical decision and immutable workflow evidence. No duplicate legacy
pricing row or second balance is created to satisfy the old schema.

Reservation/recovery alone is not the complete commercial accounting port.
Legacy terminal/expiry entry points must reject model-priced reservations. Model
settlement, release, compensation and reconciliation require their own atomic,
usage-verified bridge. The next implementation supplies that separately tested
bridge with additive migration `0029`; it is not normal-beta activation
evidence. No runtime may compose a partial port with fabricated terminal
successes. Neither migration approves a credit normalization policy, seeds
pricing, awards trial credits or changes the platform dollar fence.

### Bounded transport framing

The version-one SSE contract admits closed status codes and at most one complete
candidate with its exact digest and delivery proof. It has no resumable event
ID, retry directive or free-form progress message. Candidate framing is limited
to 256 KiB, total output to 272 KiB, heartbeats and backpressure waits to five
seconds, and the complete request to 180 seconds. A host may lower these limits
but cannot widen them through configuration. These are transport ceilings, not
provider quota, commercial admission or delivery authority.

Serialize and validate candidate bytes before waiting for backpressure; then
recheck current emission authority and cancellation immediately before the
write. Disconnect, deadline or cancellation invalidates all later callbacks even
when an underlying operation ignores its abort signal. A completed stream write
cannot be retracted. A sink that delays physical network handoff must recheck
the exact authority and signal at that handoff; the framing adapter cannot
recall already-issued bytes. A completed write is not an acknowledgement,
customer settlement, explicit acceptance or proof of a successful complete
application workflow. The authenticated route and RAM-only browser consumer
remain separately required composition.

### Explicit acceptance

Acceptance is a separate authenticated operation, not an automatic consequence
of preview delivery. Revalidate current tenant/member/project state, the exact
editing lease and baseline, and the submitted bytes against issued candidate
evidence and digest. Parse and validate the Intent again. Only that explicit
acceptance may publish a canonical immutable accepted-Intent object under the
project's established retention rules, with atomic idempotency and audit.

The acceptance transport and canonical record kind require separate compatible
implementation; they do not exist merely because this ADR or preview journal
does. Accepted Intent also does not apply model-generated graph changes. Those
remain schema-constrained proposals applied by the versioned deterministic
domain command engine with explicit review and current preconditions.

## Consequences

### Positive

- Useful AI previews can progress without violating the owner's retention veto.
- Failed delivery cannot silently cause redispatch or successful customer
  charging; uncertain costs remain conservative and visible.
- Existing queued workflows, result-object integrity and domain authority remain
  intact instead of being repurposed with no-op persistence adapters.

### Negative

- Refresh, disconnect, or process loss can destroy a valid unaccepted result.
- Metadata replay cannot recover content; another explicit attempt costs
  additional provider capacity and remains subject to the $50 fence.
- Streaming, acknowledgements and recover-only accounting add operational and
  compatibility responsibilities. Abusive failed delivery still consumes the
  platform allowance, requiring existing admission/rate-limit controls.

### Follow-up

- Implement and independently review the metadata migration, bounded protocol,
  gateway/commercial compatibility, normal admission store and authority
  resolver, canonical SQL accounting bridge, streaming transport and RAM-only
  UI.
- Supply genuinely reviewed normal-beta route/evaluation/pricing evidence and
  verify provider capacity and content-free logging before activating calls.
- Test duplicate/concurrent dispatch, forged/cross-tenant acknowledgement,
  changed digest, stale lease/baseline, disconnect, every persistence failure,
  known/unknown usage and process restart. Recovery tests must prove zero
  provider calls and no second reservation.
- Roll back by disabling the preview route and retaining metadata/accounting
  records. Do not drop journal rows, refund uncertain charges, or re-enable
  queued content storage. Existing historical migrations are unchanged.

## Alternatives considered

### Retain encrypted content for queued recovery

Not selected because the owner explicitly withheld approval. Reconsider only
with new retention consent and separate lifecycle evidence.

### Treat a successful stream write as delivery

Not selected because the connection or browser can fail before receiving the
complete candidate. A content-free bound acknowledgement is a stronger receipt.

### Automatically retry after a lost result

Not selected because it consumes additional paid capacity and can duplicate work
without informed user action. Metadata replay reports the loss honestly.

### Extend the buffered API timeout or expose a Function URL

Not selected: a larger buffering timeout does not provide useful progress and a
separate public URL would bypass the reviewed origin/authentication boundary.

## References

- [Active restoration plan
- Service checkpoint
- [Editing leases](0044-shared-project-editing-leases.md)
- [Canonical solution records](0025-canonical-solution-repository-and-evidence-contracts.md)
- [API Gateway response streaming](https://docs.aws.amazon.com/apigateway/latest/developerguide/response-transfer-mode.html)
- [Lambda streaming integration](https://docs.aws.amazon.com/apigateway/latest/developerguide/response-transfer-mode-lambda.html)
