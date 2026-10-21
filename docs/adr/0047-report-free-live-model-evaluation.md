# ADR-0047: Report-free live model evaluation

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Proposed
- **Date:** 2026-09-09
- **Owners:** Cloud Markup engineering
- **Supersedes:** None
- **Superseded by:** None

## Context

The beta owner permits Sonnet and Opus 4.6 under the existing spending and
temporary-content policies. Actual token counting works, but the V1 execution
contract requires a final evaluation report before live evaluation can create
that report. Production runtime persistence and its canonical accounting join
also accept only normal execution.

ADR-0035 deliberately leaves the host-owned live admission, canonical receipt
and deterministic-validator port unimplemented. This proposal implements that
extension while preserving the existing normal-runtime controls.

## Decision

Introduce a distinct V2 live-evaluation policy and request format that carries
report-independent controls and immutable evaluation-plan/case references. Only
the live-evaluation execution class may use it. Parsing and digest checks remain
data validation, without approval, current authority or model activation.

A trusted host must issue the scoped evaluation plan from explicit operator
approval and configured immutable dataset, model/profile, prompt/schema/catalog
and policy evidence. The current plan must be reauthenticated before admission,
reservation, final provider handoff and outcome acceptance. The plan is bounded
by trusted time, case count, concurrency, tokens, canonical credits and cost.
The proposed private issuer requires verified Cognito, a configured platform
operator and current organization ownership. Approval binds an exact reviewed
definition and lasts at most 24 hours. Durable plans and revocations are
append-only; removed configuration, lost operator ownership, project closure,
expiry or explicit revocation denies subsequent use.

Durable V2 admission now shares the existing tenant serialization, request
windows and active concurrency with V1. Versioned adapters use one SQL engine
and preserve strict owned-record readers. Migration 0037 retains the original
lease guards and immutable debit/outbox lineage; a real PostgreSQL test compares
all unchanged constraint definitions. Its live capacity is a conservative
cumulative admission counter, not a second pricing or financial authority.
Canonical commercial workflow/ledger integration remains required. Revoked or
expired approval cannot grant new execution; exact authenticated recovery
reacquires only a recovery lease and cannot refund cumulative capacity.

Canonical reservation logic is now shared behind explicit normal/live adapters.
The live adapter authenticates issued-plan metadata in the canonical
transaction; new reservations recheck current approval before commit. Its
additive SQL mapping is implemented by migration 0038 over the existing ledger.
Standard and Deep reservation, denied, concurrent replay, approval-withdrawal
rollback and historical recovery cases pass on isolated PostgreSQL. A genuine
usage/validator terminal journal remains required. V2 terminal parsing is
separate from V1 and binds runtime, plan, approval and case metadata; parsing
alone cannot authorize settlement. The live reservation adapter exposes no
settlement method.

The initial V2 usage/generation journal is now implemented with focused
PostgreSQL evidence. It binds actual issued metadata and canonical dispatch,
stores no output body, denies redispatch and preserves late usage for recovery.
It requires current approval before output acceptance commits. Actual case
receipt issuance and receipt-backed settlement are described below. The explicit
V2 accounting adapter authenticates known failed journal usage and releases
through the existing canonical terminal algorithm. Migration 0040 restricts live
outcomes to exact failed-journal releases, preserving shared financial math,
zero customer charge and actual provider-cost compensation. Historical recovery
requires current execution membership/project authority; approval withdrawal
does not erase usage. The original live reservation wrapper retains its
reservation-only surface.

The explicit V2 runtime service now uses the same claimed-execution algorithm as
V1 behind version-specific authority checks. It computes an exact execution
fingerprint, restricts each case to one primary call and reserves its full
output capacity. Current approval is rechecked at execution, final dispatch
assertion and output acceptance; explicit historical recovery exposes no
invocation callback and requires a recovery-only lease. The V1 report checks and
public verifier signature remain unchanged. Current V2 authority resolution and
platform HTTP composition remain required before live execution.

Pure request measurements and exact V2 host input preparation now bind actual
source sizes, candidate boundaries, reviewed routes and provider framing. These
helpers remain pure. A separate V2 PostgreSQL issuer now authenticates current
issued plans for input metadata and the actual completed journal for output
safety/ownership metadata. SQL0041 preserves V1 storage, with exact scoped
plan/case/invocation bindings and append-only bounded records. The journal-owned
transaction rechecks approval and active leases before commit and never performs
provider calls or financial settlement. These safety receipts are not genuine
design-quality validator or operational-outcome evidence. Internal escalation
remains unavailable until its actual prior-call lineage is supported by the V2
journal; no synthetic predecessor can satisfy that requirement.

Review found another composition prerequisite: the current input preparer uses
the normal Bedrock configuration schema, which requires an active capability
with a passing evaluation. Normal Bedrock routing has the same requirement. This
permits testing the issuer with explicitly synthetic active configuration, but
cannot bootstrap a first genuine evaluation of a candidate model. The evaluation
host needs a separate, issued-plan-bound candidate configuration and routing
path that preserves the normal activation checks and never invents a passing
evaluation. This remains part of the current composition checkpoint.

Migration 0042 now adds live no-dispatch expiry recovery to the canonical
terminal engine. Only the original immutable coordinator proof and absence of
any live invocation journal can release. A missing row or expired clock alone
cannot establish zero usage. Exact current tenant/project authority remains
required; recovery may outlive execution approval and leases without granting
dispatch or capacity. All historical migration bytes and the shared financial
projection are preserved. Completed generation still awaits genuine validators.

The first concrete case validator covers the frozen prompt-injection/secrets and
deployment/credential-request operations cases. It measures the actual strict
response checks, security-rule findings, current error issue structure and
rejected workflow, plus actual Guided/Professional semantic equality. Issue
clarity here is a deterministic structural criterion: nonempty current
summary/technical detail/affected references, correct error severity and actual
rejection. It is not a language-quality judgment. Unsupported case criteria
remain unavailable. The host reads the actual configured frozen source and
executes the actual validator; caller-authored scores cannot issue receipts.

Migration 0043 adds bounded append-only receipts joined to the completed
invocation, active runtime/workflow/reservation, current approval and issued
input/output safety evidence. Deterministic work runs outside SQL transactions;
current authority is checked again before the receipt commits. Raw output and
normalized proposal digests remain distinct. Migration 0044 now connects actual
receipts to canonical settlement with the internal
`model-evaluation-recorded-v2` scenario. The journal and terminal readers
authenticate the actual receipt, issued case, input/output safety records and
usage; the outcome stores its scoped receipt ID/digest. Historical recovery
retains current tenant authorization after execution approval expires. All
earlier migration bytes and the canonical financial calculation are preserved.
The production HTTP callback still needs to call the actual case validator;
other case families and unvalidated-completion expiry remain unfinished.

Terminal accounting now uses an explicit `model-evaluation-recorded-v2` scenario
backed by a scoped evaluation journal and actual validator receipt. A completed
evaluation means the host recorded actual provider usage, a sanitized structured
output digest and the required deterministic validator results under current
approval. A negative quality score is a valid evaluation result; it holds
promotion and does not pretend the proposed design passed validation. An
unavailable validator, unknown usage or withdrawn approval cannot manufacture a
completed evaluation. Financial projection remains in the existing canonical
engine and within the accepted evaluation budget.

The journal stores bounded metadata only. Provider usage may still be recorded
after approval withdrawal for exact financial recovery; new dispatch and output
acceptance require current approval. Unknown outcomes stay in reconciliation and
cannot authorize another provider call. Validator metadata must be issued from
actual deterministic work before settlement. Operational credit/cost
observations are then projected from the canonical terminal ledger, avoiding a
cycle in which the validator receipt would require a settlement that requires
that receipt. A browser preview acknowledgement cannot stand in for evaluation
evidence. Historical normal terminal readers retain their explicit V1 authority.

Candidate configuration is an explicit V2 evaluation contract. It preserves
actual candidate/active lifecycle and failed or not-yet-passed status; normal
parsing/routing still requires active evaluated models. Exact-case pure routing
is preparation only. The live gateway shares normal journal, usage and response
handling and requires current host authentication before claim and provider
entry. The concrete PostgreSQL resolver authenticates actual issued input,
scoped approval and exact current configuration. It provides historical recovery
authority separately, without new model work. The explicit live execution
factory now supplies the final HTTP connection; genuine validator receipts
remain required. Explicit V2 canonical commercial readers now join the same
issued-plan transaction and detached verified execution principal to the
existing canonical account, entitlement, immutable price, balance and
request-count SQL algorithms. Current session/approval and exact
case/policy/route bindings are rechecked; admitted reads additionally require
the actual V2 record and active lease. Normal V1 preview authority remains
closed. These observations do not issue credit, runtime capacity, dispatch or
promotion.

The request-local live factory now binds the real durable journal to the shared
gateway claim hash and composes V2 runtime admission, canonical commercial
accounting and full-payload CountTokens with the existing retained platform
spend ledger and final SDK HTTP guard. Current approval/configuration and
runtime expiry are rechecked after signing. Standard and Deep are verified
through real SQL and synthetic final HTTP, with the exact versioned Opus 4.6
transport. Completed generation remains pending until genuine validator evidence
exists; known failure compensation and unknown-usage retention remain canonical.
Final invocation/runtime preparation for the complete evaluation runner is still
required. This implementation does not issue a report or normal promotion.

Each case must join actual admission, canonical commercial receipts, platform
dispatch fencing and deterministic validator evidence. Only that completed host
path can issue a genuine held live report. Normal promotion references the
unchanged report and current normal policy in one direction and must verify
authentic issuance plus revocation/expiry at every current-authority boundary.
No fake report, pending-report placeholder or relabeled normal request may
bootstrap live execution.

Report-free evaluation never grants normal model execution, arbitrary tools,
URLs, shell/deployment access, tenant authority or queued content retention.
Provider behavior remains outside deterministic domain code.

## Consequences

### Positive

- A first live evaluation can be constructed without referring to its output.
- Existing canonical money and request-limit authorities remain shared.
- Historical V1 requests and reports retain their exact meaning.

### Negative

- Durable admission and accounting must support two explicit versions.
- Authentic approval, case evidence, report issuance and current promotion need
  implementation and operational ownership before any activation.

### Follow-up

- Verify the new contracts and V1 compatibility before accepting this ADR.
- Implement additive persistence, shared-limit concurrency and denied/recovery
  tests; do not admit V2 through a V1-only reader.
- Execute only bounded synthetic evaluation under the approved USD 50 cap.
- Keep activation disabled until genuine evaluation, current promotion and
  production host/editor composition are verified. No deployment is implied.

## Alternatives considered

### Populate V1 with a preliminary report

Rejected because it would manufacture evaluation evidence and preserve the
dependency cycle through renamed placeholders.

### Give evaluation its own financial ledger

Rejected because separate balances, pricing or settlement would diverge from the
approved canonical credit and platform-spend authorities.

### Keep live evaluation unavailable

This remains the safe runtime behavior until the complete host path is
implemented, but does not fulfill the authorized beta journey.

## References

- [ADR-0035](0035-deterministic-ai-evaluation-and-runtime-admission.md)
- [ADR-0043](0043-platform-model-dispatch-spending-fence.md)
- [ADR-0045](0045-memory-only-ai-previews.md)
- Execution plan
- [Status](../PUBLIC_STATUS.md)
