# Bounded AI accounting cleanup and completed operational details

Status: Proposed; implementation and the 60-day operational target authorized.
Activation, ordinary-role/native admission, restore qualification and any
irreversible retirement remain separate decisions. No live grant or deletion.

## Context

Provider usage must survive failed output, refunds and uncertain financial
acknowledgements without another provider invocation. The existing meter owns
financial replay and evidence preservation. An unchanging failing prefix must
not starve later work. Financial completion alone cannot prove that accounting
is complete, or that an operational record is redundant.

The
[retention policy](../architecture/DATA_CLASSIFICATION_RETENTION_AND_DELETION.md)
preserves financial/security lineage and leaves its legal/dispute periods open.
This decision supplies no new period for those records. Browser pending drafts,
quarantine and explicit user clearing also retain their existing behavior.

## Decision

Use the existing authenticated organization request owner for one bounded page
of at most 25 released invocations. Persist the exact selection before executing
it. Reuse canonical financial replay, then atomically retain per-reservation
outcomes, the advanced checkpoint and an immutable operation receipt. Resume a
pending page by identity even when eligibility changes. Restart completed sweeps
and revisit released-but-unresolved accounting. No provider, endpoint, schedule,
customer pricing or staff cleanup authority is added.

The current-session lock/admission and canonical organization authorization
guard every cleanup transaction. Permission tags and organization parameters do
not authenticate a caller. Failures do not alter customer summary fields,
charges, reservation caps or the existing available refund path.

Migration 0142 adds operational control, checkpoint, outcome, receipt and
optional diagnostic storage. It enrolls no organization or role. Restore
admission comes from a trusted server owner outside the restored records;
missing admission keeps cleanup inactive. Control updates serialize with cleanup
and retirement. Runtime grants cannot change restore admission or holds. The
production request owner supports an explicit admission binding; the existing
compositions do not yet supply one. Native/restore qualification must establish
that binding before activation, including fencing before restored application
traffic can resume.

Only redundant completed page details can qualify after **60 elapsed UTC days**
from an immutable server-generated durable verified-completion timestamp.
Verification reuses the internal cost projection's invocation, tenant, pricing,
ledger and cross-source checks. Optimistic `known` outcomes are insufficient.
The exact operation receipt, generation/epoch control, pending selection,
unresolved outcome, unique usage evidence and all canonical financial/audit
records are excluded. Known usage with only retained legacy evidence does not
qualify. No 60-day browser-history promise is introduced.

The versioned dry run reports blocked reasons for incomplete evidence, changed
proofs, active dependencies, pending work, holds, restore fences and time.
Creation, access, cursor advancement and refund time never start the clock.
Matching retries preserve the original completion timestamp. Reopened or changed
evidence blocks an older generation; a fresh verified generation is required.

Retirement source code rechecks authority, epoch, holds, canonical references
and eligibility under the same transaction/serialization boundary. It can remove
only optional details, preserving the immutable operation and retirement marker
for exact retry. There is **no production caller, granted update privilege, TTL
or job** for this operation. The current source cannot activate it by aging
rows. Separate confirmation and native evidence precede irreversible activation.

## Alternatives and consequences

Age-only expiry or deleting whole receipts could destroy the sole retry or
accounting proof. Keeping only an in-memory cursor repeats starvation after a
restart. A separate scheduled service adds authority and deployment cost that
the bounded existing owner does not need. These alternatives are rejected.

Durable metadata and canonical verification add storage and bounded SQL work.
This is not a new financial ledger. The request path stays inactive until its
restore owner is admitted. All-write-failure and response-before-first-durable-
write windows remain explicit; missing usage is never zeroed or backfilled.

Rollback may disable the new owner while preserving additive tables and
evidence. Never revert migration checksums, erase receipts or downgrade restored
data. Restore must preserve original completion clocks and proof references,
fence old epochs, recheck holds and authority, and reconcile pending work before
admission. Backup expiry is separate; this is not a promise that backups
disappear on day 60.

## Verification and remaining admission

Focused SQL/transaction doubles cover failed and unacknowledged prepare/complete
operations, cursor progress, exact replay, canonical-copy checks, session/org
revocation, changed epochs, holds and completion-relative eligibility. These are
synthetic source tests, not native PostgreSQL or live retirement proof.

Required admission includes ordinary-role allow/deny/cross-tenant checks,
transaction isolation and lock ordering, concurrent owners, native lost
acknowledgements, restore of old receipts and unique usage, current authority at
retirement, and unchanged financial/customer contracts. The qualified restore
owner binding and retirement activation remain explicit release gates.
