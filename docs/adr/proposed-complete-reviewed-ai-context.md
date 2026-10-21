# Proposed: Complete reviewed semantic AI context and applicability proof

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

This proposal is retained as history. The scoped decision is now accepted in
[ADR-0089](0089-complete-reviewed-ai-context.md); its acceptance does not admit
any unrun release or activation gate.

- Status: Proposed for integration; owner-authorized local implementation and
  scoped browser/contract/data-flow review are verified locally
- Date: 2026-10-03
- Owners: Cloud Markup product/application/security and billing maintainers
- Would supersede: Read-context exclusion scope of ADR-0066 for new opt-in
  versions; no policy-edit authority is superseded

## Problem and bounded preparation

[ADR-0066](0066-reviewed-canvas-ai-context.md) permits literal catalog settings
and purpose summaries but excludes policy documents, reference values,
structured operations/triggers and application contract bodies. The fixed
single-output tool has no retrieval step to recover that information. More
elaborate prompts cannot supply missing semantics. V5 adds resources/connections
and edits resource literals; it cannot update/delete existing edges, edit
reference settings or change IAM policy graph nodes. Source-v2 drafts are
reviewed scaffolds, not deterministically verified business implementations.

The bounded correction repairs safe typed metadata, stable grounding, workload
connection summaries and selected-issue preview checks within that scope. This
proposal is not permission to remove safety filters, send raw graphs/source or
enable arbitrary IAM edits.

## Exact proposed contract

1. Introduce read `contextVersion=3`, new proposal version 6 and explicit source
   option `ai-source-draft-v3`, with new producer/prompt/cache identities and
   schemas. Retain exact v1-v5 proposal and source-v1/v2 contracts,
   instructions, pricing reservations and prepared snapshots. V6 mutations
   initially retain v5's literal-update/addition authority; read completeness
   grants no edits.
2. Bind context to exact graph semantic digest and installed catalog
   id/version/digest plus projection producer version. Resolve historical
   catalogs through reviewed exact snapshot adapters; never relabel/upgrade a
   saved revision or use current schemas for historical values.
3. Include every relevant known node's stable node/deployment identity,
   placement/ownership/schema identity, bounded reviewed literals and catalog-
   declared node references `{property,nodeId,attribute,resolution}`. Include
   every relevant connection's stable edge/rule identity, endpoint node
   IDs/ports, schema, lifecycle, literal settings and catalog-declared node
   references. Preserve parent relationships independently of edge
   representation. Undefined targets are explicit unresolved references; never
   substitute labels or external IDs. Secret references, sensitive-variable
   references, unknown fields, arbitrary expressions/source and detected secret
   candidates stay excluded/rejected.
4. Include IAM graph nodes only as read-only, typed catalog semantics: owner and
   attachment relationships, known policy kind/effect/action-group choices,
   referenced principal/resource nodes, and catalog-reviewed condition
   operator/key/value fields after type/bounds/secret checks. Sensitive or
   malformed condition values refuse inference; omitted unreviewed fields are
   explicit omissions and prevent unsupported quality claims. IAM updates still
   require the permissions workflow. No arbitrary JSON policies, inferred
   permissions, grants or hidden credential retrieval.
5. For source-v3 include the exact supported workload runtime/pattern/coverage,
   operation IDs and kinds, trigger/event edge bindings, operation contract
   references and resource/environment binding provenance. Traverse referenced
   Application Contract closure and project reviewed field/interface/data/auth
   schema metadata, failure outcomes and declared test cases as bounded data.
   Preserve contract ID/version/digest and distinguish declared tests from
   executed test/build evidence. Exclude raw source, examples/customer payloads,
   arbitrary callbacks and unsupported expression bodies. An incomplete closure
   yields typed missing-context refusal before source inference, not guessed
   behavior or a successful scaffold presented as complete implementation.
6. Preserve existing global ceilings (100 nodes, 1,000 edges, 40 finding
   summaries, 128,000 context characters). Cap closure to eight workloads, 16
   operations per workload and 32 distinct contracts; each text/list uses
   declared transport and stricter catalog limits. Keep a selected finding
   within the 40 summaries even when outside the first 40. If complete relevant
   supported context exceeds any ceiling, refuse/scope the request before
   inference instead of silently discarding required relationships or schemas.
   Publish explicit omission counts/reasons and supported operation
   capabilities.
7. Add an optional typed selected-issue request containing code and stable
   affected entity/field identities. Recompute its existence from the exact
   admitted snapshot; do not trust client severity, prose, paths or claimed
   support. Return the existing typed `invalid_request` error with
   manual-workflow guidance before reservation/dispatch when fixing it requires
   existing edge, reference, ownership or IAM edits. Assessment/questions remain
   valid paid responses under the current policy.
8. For v6 require the exact saved canvas before admission, binding its tenant,
   project, draft ID/version/etag and full digest. An authenticated host reads
   that baseline and refuses any change; no extra raw graph snapshot is retained
   or sent to the model. Local unsaved edits must be saved first. Existing v1-v5
   local-canvas semantics remain unchanged. Existing tenant, lease, revocation
   and cancellation ports apply. Extract the existing editor preparation into a
   shared provider adapter, leaving pure domain code free of model/UI/provider
   clients. Both server and browser use the same catalog/resolver/command engine
   against that admitted saved baseline, dependency ordering and deterministic
   IDs. Require full validation, no new/worsened blocking findings, and
   disappearance of the selected finding on its stable entities for a repair.
   Questions/assessments bypass mutation proof but retain strict parsing and
   secret checks.
9. Run applicability proof before worker `objects.put`/`meter.record` and before
   any synchronous success delivery. Invalid proposals use existing failure-
   release behavior; preserve actual provider accounting/reconciliation and
   valid question-response pricing. Persist a versioned applicability receipt
   bound to snapshot/proposal/catalog/command/result digests and validator
   version. Replays deliver only matching proven output; legacy delivered jobs
   retain historical treatment, without retroactive refunds/ledger rewrites.
10. Model output remains untrusted. Infrastructure must pass compiler/export
    gates. Deterministic application generation must retain contract/build and
    behavior tests; draft source must remain review-required until a separately
    admitted sandbox proof validates behavior. Generated tests or model review
    alone cannot certify success. No automatic execution, paid retry loops,
    customer deployment or source-scanned IAM derivation.

## Local implementation and exact integration blocker

The follow-up owner instruction authorized the typed read-only expansion.
Context-v3, new proposal/source schemas and prompts, source-v3 export capture,
selected-issue preflight, host applicability proof and versioned output receipts
are implemented locally. V6 requires an installed reviewed applicability host
before reservation/inference. The owner subsequently authorized local production
host wiring: sync admission now uses live request authority and queued
generation uses committed job actor authority. The saved reader verifies exact
current draft/version/etag/full digest, published scoped object bytes and
authorization around reads. The shared pure command engine is extracted with
editor compatibility paths; actual adapter regressions supplement the synthetic
proof-kernel tests. Missing host/reader remains fail-closed. PostgreSQL
authority/failure proof is still a coordinator gate, not established by mocks.

New read context includes policy kind/effect/action/principal/condition
literals, all known graph connections/ports/ownership/schema identities and safe
references without resolving them. Resource attribute suffixes are explicitly
limited to `arn`, `name`, `id`, `url`, `endpoint`, `object-arn` and
`stream-arn`, matched to the target service identity. Unknown attributes refuse
inference. External workload runtime bindings retain names only, without
secret/variable locator IDs or values. Auth comparisons declared sensitive and
credential-like condition keys refuse inference. Contract closure carries exact
original digest plus projected-data digest, with provenance actors omitted and
no fixture payloads or source.

Source-v3 requires valid structural workload/contract references, complete
operations/behavior contracts, no blocking unresolved implementation requirement
and Node.js 24. Its output stays unexecuted and review-required. Read literals
have a 512-character/128-item transport ceiling; bounded catalog-invalid values
remain repair evidence. Mutation lists still use v5's 16-item/256-character
contract and stricter catalog admission. No policy/reference/edge edit authority
was added. Typed selected issues have at most 20 affected locations; larger
repairs require scoping rather than truncating their authoritative identity.

## Risk and review required before integration

The authorized host-wiring follow-up extracts existing pure editor helpers into
`@cloudmarkup/graph-preparation`, depending only on public
domain/schema/provider-SDK contracts. Editor paths remain compatibility
re-exports. AWS composes exact catalog/descriptors/resolver and the proposal
orchestration in its provider package; API composition supplies authenticated
persistence authority. No provider semantic module imports React, browser state,
model clients, database/cloud clients, filesystem, clocks or randomness. This is
a mechanical package-boundary move, not a second command implementation or a
catalog-artifact change. Its risks are build/export resolution and accidental
editor drift; focused helper/adapter compatibility checks and coordinator-owned
full gates must cover both hosts.

Read-only IAM and contract semantics increase disclosure and prompt-injection
surface, payload size, cost and coupling to historical catalogs. Explicit owner
review, typed allowlists, secret-negative tests, hostile-label tests and exact
input size accounting are required. The saved-only choice avoids new retained
architecture objects; still review exact subject reads, tenant scope, stale
baselines, revocation, deletion and erasure. Sharing editor preparation is an
architectural package-boundary change; ensure deterministic provider adapters do
not import React, browser state, filesystem/cloud/model clients or execution.

Before-settlement graph rejection affects delivery eligibility and credit
failure handling. Semantic-invalid inference explicitly reuses the existing
unavailable-output hold-release and expiry/orphan reconciliation semantics,
including existing unsuccessful-usage field clearing. No new pricing/credit
policy is selected and no durable failed-provider-cost receipt is claimed.
Billing maintainers must still verify crash-after-usage, publication/recording
ambiguity, retry, cancellation and retained legacy jobs in the PG gate. This
slice introduces no new cost ledger or live billing writes. A matching receipt
is required on fresh publication and retained v6 replay; it does not establish
crash/ambiguity handling without the PG gate. No new pricing, live credit
mutation or compensation is authorized here. A model may still miss intent or
return executable-looking wrong business behavior; acceptance needs stubbed
adversarial scenarios plus separately authorized real
browser/export/build/behavior proofs. No live-model quality claim is available.

## Required evidence and rollback

Test full reference/connection/contract closure, typed redaction, secret and
unknown inputs, tenant denial/revocation/erasure, payload ceilings, historical
catalogs/snapshots/prompts, selected-issue stability after reordered/filtered
graphs, invalid parent/rule/ownership/cardinality/triggers and false repairs.
Failure injection must prove no invalid proposal is published/settled and valid
questions retain current settlement. PG proof covers immutable objects, worker
replay and ambiguous recording. Real browser acceptance after coordinator-owned
deployment covers issue preflight/review/undo/reload, uncertain admission replay
with one reservation, saved revision export, both infrastructure targets and
honest application draft/verified behavior distinctions.

Rollback disables new v6/source-v3 admission together, drains or cancels new
prepared jobs and retains capable readers for new receipts/artifacts. Never
reinterpret new snapshots as historical versions or discard proof metadata to
force an older reader. Keep current immutable history and existing pricing.

## Owner-authorized browser rollout and local review

The browser rollout plan records the completed local contract/security data-flow
review, precise choices, original failures and source-pinned verification. The
canvas now explicitly requests proposal v6 after saved-baseline checks; source
consent requests v3. A separate strict public AI support view keeps existing
authentication/export views compatible and prevents paid version probes or
silent downgrades. Missing support disables new AI submission while
infrastructure exports and legacy readers retain their existing paths. The
browser binds the independently prepared command/result to the server receipt.
No new edit, pricing or deployment authority is introduced.

Local ordinary design decisions are resolved within the owner-authorized scope.
The proposal remains proposed for deliberate integration-maintainer acceptance;
accepted ADR-0066 history is unchanged. Read-only policy/contract disclosure,
prompt injection, exact worker rollout and ledger failure ambiguity remain risks
with explicit release gates. Public display support reflects API composition,
not worker fleet health or an admission kill switch. Deploy compatible workers
before advertising it; preserve capable readers and independently withdraw new
admission during rollback. There is no unresolved request for broader IAM edits,
pricing changes or live credentials.
