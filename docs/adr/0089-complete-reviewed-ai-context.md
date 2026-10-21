# 0089: Complete reviewed semantic AI context and applicability proof

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- Status: Accepted after scoped integration contract, security and data-flow
  review
- Date: 2026-10-03
- Owners: Cloud Markup product, application, security and billing maintainers
- Partially supersedes: ADR-0066 read-context exclusions for context-v3 only;
  existing policy-edit authority and historical contracts remain unchanged

## Context

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
decision grants no permission to remove safety filters, send raw graphs/source
or enable arbitrary IAM edits.

## Decision

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

## Consequences and ownership

The authenticated API reads the tenant-scoped exact saved draft and immutable
object bytes, checking authorization around the read. The provider adapter and
browser share the existing deterministic command preparation through
`@cloudmarkup/graph-preparation`, whose dependencies are public domain, schema
and provider-SDK contracts. It has no React, filesystem, cloud/model client,
clock or randomness dependency. Exact historical catalog adapters and the
original editor compatibility exports remain required.

Read-only policy and Application Contract semantics increase disclosure,
prompt-injection, payload, model-cost and historical compatibility risks. Typed
allowlists, bounded text, secret-negative cases and explicit omissions are
required. Secret locators, payload examples, arbitrary source and sensitive
condition values stay excluded. Complete supported context exceeding a ceiling
refuses inference; implementation does not silently trim authoritative closure.

V6 applicability proof occurs before publication and usage recording. Invalid
semantic output reuses existing failure/hold release; valid questions retain
existing pricing. This decision creates no new cost ledger, refunds, financial
authority or failed-provider-cost receipt. PostgreSQL crash, replay, revocation,
cancellation and ambiguous settlement proof remain release gates.

The browser explicitly requests v6 and opt-in source-v3, matches its independent
command/result to the server receipt, and preserves review/apply/undo. Source
drafts and declared tests remain unexecuted and review-required. There is no
live-model quality, customer deployment or arbitrary IAM edit claim.

## Compatibility, rollout and rollback

Retain exact proposal-v1 through v5, source-v1/v2, prepared snapshots,
instructions, pricing reservations and legacy readers. Context-v3/proposal-v6
and source-v3 have distinct producer, prompt/cache and output receipt
identities. The strict bounded public AI support view reflects API composition;
it does not prove worker fleet health or provide an admission kill switch.
Missing support refuses new AI requests, with no paid version probes or silent
downgrade.

Deploy compatible proposal/export workers before the API advertises new support.
The platform API depends on both worker resources as well as migration
completion during CloudFormation updates. Rollback must independently withdraw
new admission, then drain or cancel prepared new-version work while retaining
capable readers and immutable proof metadata. Never relabel a new snapshot as a
historical version or discard its receipt to force an old reader.

## Alternatives considered

- Retain v5's incomplete projection and rely on better prompts. This preserves
  the smaller disclosure surface but cannot recover omitted relationships or
  operation contracts and cannot support the requested fidelity.
- Send raw graphs, source and policy JSON. This expands arbitrary sensitive
  disclosure and prompt-injection surface without deterministic support bounds.
- Permit policy/reference/edge mutations with the new read context. Read
  completeness does not establish safe edit authority; the existing reviewed
  permissions workflow remains the owner of those changes.
- Copy editor preparation into a second server implementation. Independent
  implementations introduce command/result drift; one pure public package
  preserves both host compatibility and provider-neutral domain boundaries.

## Reconsideration and verification

Reconsider the projection/version only when an authorized use case needs
unsupported contract semantics, more than the existing ceilings or wider edit
authority. That requires a new bounded contract/security decision and evidence;
increasing limits, inferred permissions or unbounded retrieval is not implicit.

Acceptance establishes architectural direction, not release admission. The
browser rollout plan retains 221 owner-focused tests and the terminal-credit
recovery; the combined plan owns two reproduced export regressions, their
51-case recovery, final native/root/browser gates, worker source proof and
actual application acceptance. Tests must cover tenant denial, stale/revoked
baselines, closure/redaction limits, selected-issue stability, false repairs,
immutable publication, accounting ambiguity and replay. No skipped, synthetic or
earlier-source check establishes those later gates.
