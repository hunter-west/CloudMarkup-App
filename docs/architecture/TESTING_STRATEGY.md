# Testing Strategy

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

> **Evidence scope:** foundation conventions and accumulated feature
> verification through the September 29, 2026 source snapshot. Historical counts
> and failures retain their original scope; they are not current-release
> acceptance. Read [STATUS](../PUBLIC_STATUS.md) and
> [HANDOFF](../PUBLIC_STATUS.md) for current evidence.
> [ADR-0062](../adr/0062-separate-beta-coverage-from-delivery.md) governs
> exact-commit test admission separately from scheduled/manual coverage.

## Goals

Testing must establish semantic correctness, tenant isolation, deterministic
generation, contract compatibility, responsive interaction, and safe failure.
Test quantity is not a substitute for evidence at the relevant boundary.

The M9 [single-editor candidate](../adr/0044-shared-project-editing-leases.md)
requires real PostgreSQL races across members/tabs, exact lease renewal/release,
authentication expiry and membership revocation, deletion while editing, and
expiry between object I/O and final publication. Browser evidence must show
read-only peers and preserved unsaved work after loss, not merely a disabled
button. Track actual passes separately from required evidence in the service
continuation checkpoint.

The historical M1/M2 foundation established shared Vitest projects and V8
coverage for the Hono health endpoint, responsive React application shell, and
reusable UI/component states; an isolated Storybook static build; Go
formatting/vet/tests for the compiler CLI boundary; strict TypeScript checks;
typed ESLint; deterministic Prettier verification; production builds;
secret/dependency checks; and synth-only CDK verification. Architecture Document
v1 adds deterministic schema generation, serialization round trips, semantic
validation, JSON Schema compatibility, and valid/invalid contract fixtures.
Intent Document v1 adds provider-neutral capability, explicit-unknown,
normalization, contradiction, provenance, and planner-interface contract
evidence. Graph Command v1 adds schema/version rejection, exact precondition,
immutability, atomic rollback, dependent deletion, containment, provenance,
reference-count, required release-disposition, stale-replay rejection,
non-invertibility, and undo/redo evidence. Provider-catalog/rule,
identity/tenant-authorization, persistence, and commercial-contract suites now
exist in the accumulated record below. External-adapter and evaluation
implementation, activation and acceptance are tracked separately in STATUS. The
historical bounded manual-canvas adapter slice added deterministic
domain/view-model mapping, command dispatch, selection, stable-ID,
unknown-node/icon fallback, mode-parity, keyboard movement, semantic-hash
invariance, accessible empty/error-state, and one real-browser smoke-test layer;
it does not satisfy the complete M3 browser or editor evidence. Generic nested
boundary evidence adds parent-relative coordinate round trips, finite/range
rejection, bottom-up min/max expansion, nested movement, catalog placement and
cycle rejection, atomic move/reparent rollback, non-drag selection, transient
collapse, and Guided/Professional semantic parity. The layout-adapter tests pin
stable hierarchy/port inputs, repeatable ELK output, strict result validation,
cancellation and late-result discard, position-only hashes, exact preview/apply,
and stale preconditions. A representative Chromium flow covers preview, live
mode switching, cancel-as-no-op, and confirmed application. That earlier generic
flow is not AWS networking or large-graph performance certification; AWS
networking editor adds the separate bounded synthetic networking evidence
described below. The service catalog sidebar foundation adds exact
compiled-catalog adaptation, generic catalog-authored search and grouping, safe
defaults and placement, stable multiple-instance identity, unavailable-entry and
icon fallback, mode parity, and equivalent button, keyboard, and drag creation
evidence through Graph Command v1. Validation Engine v1 adds isolated rule
execution, all-severity deterministic ordering, finding deduplication,
applicability, provider-neutral rule coverage, command-validated auto-fix
previews, pairwise fix-conflict detection, malformed-extension handling, and
failure-containment evidence. Contract tests also cover the shared environment
taxonomy, frozen applicability snapshots, reserved core rule IDs, and safe
documentation references. Provider Catalog contract v1 adds strict source
parsing, semantic reference validation, duplicate and unsupported-declaration
rejection, canonical JSON/digest reproducibility, generated-artifact drift,
read-only accessor, and version-bound port-inventory evidence. The immutable AWS
notes family adds synthetic valid and invalid tagged configurations, default
application, field-risk metadata, secretless-client and bounded-IAM negatives,
source-order reproducibility, exact historical catalog reproduction, and
catalog-version hash evidence. Historical catalog `0.9.0` adds networking
schema/default, boundary/association, dock, owned-slot, mapping-readiness,
education, unsupported-mode, icon, resolver, validation, and exact `0.8.0`
migration evidence. Catalog `0.10.0` preserves those identities and adds exact
`0.9.0` migration, implemented Terraform projection, stricter validation,
application reachability, repository/CI fixtures, and deterministic AI
evaluation evidence. AWS provider-validation tests prove stable
descriptor/registration identities, environment-aware severities, exact affected
paths, deterministic finding identities, unavailable-versus-unknown Region
behavior, strict placement/routing/policy/Lambda VPC-access behavior, explicit
target and organization-policy limits, and conservative auto-fix absence for
security-, permission-, topology-, and cost-bearing decisions.

The bounded M1 connection workflow adds focused evidence at each owning
boundary. Provider tests cover canonical compatibility discovery, ambiguity,
invalid direction and ports, API Gateway-to-Lambda invocation, Cognito-to-API
authorization, Lambda-to-DynamoDB read versus write actions, and stable-identity
generated-resource editing. Editor model and component tests cover exact
descriptor projection, descriptor-only rejection, rule-defined questions and
defaults, complete generated-resource provenance and permission preview,
cancellation as a document no-op, Guided/Professional presentation, field-error
recovery, mode switching without draft loss, and keyboard-only confirmation
after preview. The bounded Chromium test draws a real typed port connection,
preserves its draft across a mode change, reviews the generated effects, and
confirms it by keyboard. These tests make no persistence, cloud, IaC, billing,
or deployment claim.

The bounded M1 history and local-recovery slice adds command-level tests for
single operations, atomic-batch undo, redo, branch invalidation,
non-invertibility, stale-document rejection, and deterministic advancement of
the 100-entry/2-MiB in-memory checkpoint. Session and shortcut tests prove that
accepted configuration, connection, movement, placement, and layout commands
share that history while selection, popups, viewport, mode, and wizard buffers
do not; native text-entry and composition shortcuts are preserved on supported
platform conventions.

Recovery tests treat IndexedDB as untrusted adapter input. They cover strict
envelope and document versions, exact scope/catalog binding, canonical digest
integrity, byte and scope limits, credential-literal refusal, trailing-edge
debounce, in-flight coalescing, refresh recovery, fallback checkpoints,
transaction-time compare-and-swap, stale-tab notification, fail-closed corrupt
and unsupported-future drafts, explicit safe recovery and discard (including
headless-record transactional reinspection), and bounded redacted diagnostics.
Browser evidence must cover refresh recovery and a concurrent-tab conflict
without implying backend acknowledgement, tenant authorization, cross-device
synchronization, immutable revisions, or deployment.

The bounded M1 validation-presentation slice adds controller tests for debounced
scheduled/running/current state, explicit requests, late-generation discard,
exact report/document/catalog binding, incomplete/failure handling, and
presentation-only visual changes. Projection and session tests cover all six
canonical severity filters, multi-location resource grouping,
structural/draft/revision/target readiness separation, mode parity,
current-report-only warning review, complete safe-fix command previews,
current/incomplete fix guards, atomic apply, and history. Location routing
supports node, edge, port, boundary, and configuration targets. Component and
session tests cover stale-report display and current/incomplete fix guards; the
Manual editor workflow browser evidence directly exercises node and
configuration focus, including responsive drawer focus-trap escape, but does not
individually exercise edge, port, or boundary routing. The browser suite uses
isolated manual-notes and encryption-fix fixtures to prove the full
add/configure/connect/validate/mode/history/recovery path and the focused
safe-fix/undo/redo path. Browser-injected `axe-core` scans selected initial,
Professional Issues, and fix-dialog states against WCAG 2.0 A/AA, 2.1 A/AA, and
2.2 AA rule tags. Those scans are bounded Chromium evidence, not WCAG
conformance or assistive-technology certification.

The guided usability review experience layer requires focused evidence for the
versioned, actor-scoped browser preference boundary; first-use completion and
skip paths; prompt-placeholder, template, and blank starts; walkthrough
start/dismiss/complete/restart; mode persistence and semantic parity;
catalog-sourced learning content; command-palette and keyboard-only actions; and
the no-op/local usability-event adapter. Its Chromium scenarios must exercise a
novice notes-API flow and a Professional rapid-review flow through the same
editor and command paths. Automated checks do not establish human comprehension;
the paired protocol and evidence fields are recorded in the M1 onboarding
usability script.

The canvas-first presentation slice requires focused component and Chromium
evidence for compact 176-by-72 service nodes, configured-name/icon fallbacks,
the bottom expand/collapse action, and no more than one visible input and output
aggregate dot. Tests preserve every exact grouped handle, port, stable edge,
document hash, history entry, and IaC address input across collapse and expand.
Hover and keyboard focus must name represented inputs/outputs, connection
information must open beside its owning service, and double-clicking only the
service body must select it and open Configure. Shell evidence covers the fixed
92px Inspector and 48px Workspace launchers, Architecture as its own
destination, one rich popup at a time across all ten destinations, switching and
closing, focus restoration, internal scrolling, drop-shadow tokens, 160ms
open/close motion, and zero-duration reduced motion. Catalog remains the only
persistent, resizable desktop panel; tablet drawer and phone list-first behavior
remain.

Canonical cross-layer proof obligations are specified in
[Solution, Repository, and Continuous-Evidence Contracts](SOLUTION_REPOSITORY_AND_EVIDENCE.md).

The M2 solution-contract foundation requires Architecture v3/Workload v2
migration, cross-document references and hashes, External Resource ownership,
Repository Snapshot/Observed Solution/Reconciliation integrity, immutable
Solution Revision, source-ownership conflicts, bounded AI extensions, generation
coverage, Active Issue lifecycle, Evidence ordering, and tenant-scoped immutable
persistence tests. Passing those tests proves the contracts only. It does not
prove repository import, model calls, generation, application build/package,
customer CI/CD, cloud plan/deployment, or drift behavior.

## Principles

- Test the pure domain heavily and deterministically.
- Keep model output outside the trusted oracle.
- Test contracts on both sides of language, process, storage, and network
  boundaries.
- Use realistic integration tests for adapters without making most tests depend
  on cloud services.
- Keep fixtures synthetic and free of credentials or customer data.
- Treat migrations, retries, idempotency, and failure paths as product behavior.
- Separate “user architecture is invalid” from “Cloud Markup failed to evaluate
  it.”
- Record tool and catalog versions for reproducibility.

## Test layers

### Domain unit and property tests

Use Vitest for TypeScript domain behavior. Cover:

- node, port, edge, boundary, and configuration invariants;
- operation parsing, preconditions, atomic application, and deterministic
  ordering;
- stable identity and address inputs;
- draft concurrency and revision freezing;
- Async Job v1 transition validity, exact revision/draft binding, cancellation
  fencing, retry/backoff classification, lease recovery, durable checkpoint and
  user-response binding, output limits, and safe error redaction;
- exact nonempty expected-child orchestration sets, preallocated child identity,
  complete child-set evaluation, and versioned failure-policy decisions;
- generated-resource provenance and lifecycle;
- validation rule isolation, stable finding identity, severity ordering,
  deduplication, applicability, and invalidation;
- provider-neutral broken-reference, duplicate-ID, parent-cycle, port,
  provenance, variable/output-reference, and document-version rules;
- Workload Behavior identity/ownership, operation and I/O references,
  trigger/action edge direction, implementation-mode closure, dispatch policy,
  environment/secret-reference safety, and unresolved-requirement invariants;
- Application Contract stable identity/version/digest and Workload/External
  Resource reference integrity;
- External Resource ownership/create/reference/import/data-source compatibility,
  secret-reference safety, and reviewed ownership transitions;
- Repository Snapshot normalization, bounds, redaction, checksums, exact
  revision binding, observation confidence/evidence, and designed/observed
  separation;
- Reconciliation Proposal preconditions, atomic accepted operations, stable-ID
  preservation, explicit no-op outcomes, and stale-evidence removal;
- Solution Revision hash/reference/version binding and immutable lineage;
- source-ownership regeneration/semantic-diff/conflict behavior and silent
  overwrite rejection;
- AI-extension destination/dependency/validation/acceptance/export-safety
  boundaries;
- generation-coverage evidence requirements, Active Issue lifecycle, and
  independent Evidence level/staleness ordering;
- auto-fix command validation, preview hashes, conflicting fixes, and atomic
  command-engine rejection;
- failure containment proving that one rule cannot mutate another rule's input,
  expose thrown details, stop other rules, or produce a falsely complete report;
- provider-neutral Intent IR identities, explicit unknown references,
  normalization, contradictions, decisions, and alternatives;
- provider-planner dependency direction without an implementation;
- version compatibility and migrations, including deterministic Architecture
  v1-to-v2-to-v3 and v2-to-v3 chains that preserve every existing graph/workload
  fact, add empty new collections, record migration provenance, and reject
  unsupported future versions;
- subscription projection and entitlement invariants; and
- credit reservation, settlement, release, expiry, and idempotency.

Property and metamorphic tests should prove that presentation-only changes
cannot change semantic graph projections or compiler address inputs, and that
applying an invalid batch leaves the graph unchanged. They also prove that
normalized workload behavior is array-order invariant, behavior changes affect
the compilation content hash, display labels do not recreate workload/binding
identities, and dangling workload references make an otherwise valid graph
command fail atomically.

### Web component and interaction tests

Use Vitest and React Testing Library for commands, inspectors, wizards,
findings, async state, accessible keyboard behavior, and Guided/Professional
presentation.

Mode-equivalence tests must prove one component tree, controls, dimensions,
fields, and matching Guided/Professional actions over the exact same source
documents, commands, validation, generation, and Evidence. Only wording,
contextual education, recommendations, and optional technical disclosure may
vary. Mode switching preserves hidden advanced values and proof state.
Responsive tests verify narrow screens retain review, comments, issues,
explanation, and export status without claiming the full desktop editing
surface.

React Flow behavior should be tested through user-observable commands and graph
results, not brittle internal DOM structure. Visual regression tests should
cover boundary and association semantics where a misleading rendering would be a
correctness defect. Catalog interactions additionally prove that search uses
only compiled catalog-derived terms, invalid or unplaceable services remain
disabled with explanations, creation inputs converge on the same command path,
and presentation coordinates do not change semantic content.
Service-presentation tests additionally use the accessible collapse/expand
control to prove the exact 176-by-72 compact geometry, icon and configured name,
left input/right output aggregate placement, exact-handle retention, and
unchanged semantic/visual hashes. They cover hover and focus labels, adjacent
aggregate information, expansion into exact group details, and double-click
Configure while proving that a dock or collapse control does not trigger the
double-click route.

Connection interaction tests must prove that port drawing, node-toolbar, the
Connect popup, Architecture-popup port controls, and the scoped `C` shortcut
enter the same resolver-backed workflow. They assert source/target direction,
visible invalid and ambiguous states, no mutation before confirmation, unchanged
document content on cancel or stale apply, and exact application of the prepared
batch. Shortcut tests include the negative case: `C` from text entry or an
unrelated control must not start a connection. Editing tests compare direct and
supporting resource identities before and after a permission-changing edit.
Professional keyboard confirmation remains unavailable until a valid preview
exists.

Lambda connection presentation additionally covers categorized capability
actions, declared-but-unsupported capabilities, aggregate port and rule/pair
cardinality, and several simultaneous incoming/outgoing/association edges.
Guided tests hide raw rule/port/path identities while explaining consequence and
safer separate-function guidance. Professional tests expose the same candidate
and preview plus capability, port, relationship, IAM provenance, cardinality,
and diagnostic details. Configure/Implementation tests show the exact Workload
Behavior record and truthfully distinguish the separate source-generator
boundary from editor execution; the editor does not generate or run application
source. Mode switching cannot change any candidate, answer, preview, command,
document, revision, or hash.

Stable-dock tests prove total one-group-per-port adaptation, exact semantic-port
preservation, side-local dock order, direction/cardinality rejection, multiple
edges sharing one handle, ID-sorted rank assignment, and a common anchor segment
before deterministic fan-out. Compact-state tests prove that those exact handles
remain bound while only one input aggregate and one output aggregate are visible
at the common anchors. Component tests cover accessible names, hover/focus group
names, keyboard activation, aggregate-to-exact expansion, group-only and exact-
edge selection, authorized one-edge disconnect, history/undo, unavailable
reasons, adjacent owner positioning, and identical Guided/Professional
structure. A focused Chromium regression records handle centers and SVG paths
before collapse, while compact, after expanding, before opening a grouped
popover, after scrolling its bounded list, and after closing; document hashes,
history, exact port IDs, and the applicable endpoint snapshot must remain
identical except for the explicitly selected transient compact anchor.

Owned-configuration and policy tests classify exact owner-slot, statement,
condition, and resource-scope bindings; enforce trust and boundary
minima/maxima; and cover zero, one, and multiple user policies. Canonical
projection tests cover deterministic ordering, lifecycle/provenance agreement,
generated/custom separation, generated cleanup with user-policy preservation,
principal rules, empty/unsupported actions, wildcards, malformed conditions,
duplicate statements, and target-specific readiness. The pinned 0.5-to-0.6
migration is tested for preserved legacy node/edge identities and semantic
scope, deterministic new identities, user/generated/adopted lifecycle
preservation, idempotence, exact catalog pins, collision rejection, and
path-specific failure.

Reusable UI states now have a pinned Storybook 10.5.4 isolation build with
synthetic, local fixtures and accessibility-addon feedback. Storybook telemetry
is disabled for development and static builds, and development version checks
are disabled; this is not evidence of a network-denied browser harness. The
manual-editor foundation has a pinned Chromium suite with a fixed local origin,
viewport, locale, time zone, light color scheme, reduced-motion preference,
blocked service workers, and synthetic fixtures. Its focused tests prove the
catalog-bound fixture canvas opens in Guided and Professional modes with the
same document identity, content hash, and stable node identities; exercise
catalog-backed drag and native keyboard creation; retain the synthetic
forced-colors boundary regression; and cover connection, containment, layout,
history, local recovery, responsive node/configuration validation focus,
readiness, and safe fixes. Component and session tests, rather than Playwright,
cover stale-report display and current/incomplete fix guards. Static application
composition and package-boundary tests prove catalog, icon, and validation
inputs are bundled imports; the browser suite does not claim request
interception or a network-denied harness. Editor-shell cases also measure the
resizable Catalog plus fixed 92px Inspector and 48px Workspace launchers, prove
that only one rich popup is open, switch all destinations without document-hash
changes, restore focus on Escape/Close, and keep popup content internally
scrollable. They assert Architecture as an independent destination, 160ms motion
and reduced-motion zero duration, and the shared shadow/surface tokens. Catalog
results and preview/diagnostic regions remain bounded, while Details reveals a
short-phone preview without moving trigger focus. The Architecture popup opens
without changing document hashes and remains the non-canvas semantic path. This
is not a visual baseline, multi-browser matrix, screen-reader audit, or complete
product workflow suite. The representative state inventory is in the
[Accessibility Specification](../design/ACCESSIBILITY.md). Screenshot comparison
will supplement rather than replace semantic React Testing Library, keyboard,
focus, interaction, and automated accessibility assertions.

### API and application tests

Exercise the modular monolith with in-memory or controlled adapters for:

- verified context and authorization;
- tenant-scoped resource access;
- schema and domain errors;
- idempotency and optimistic concurrency;
- project, draft, revision, artifact, and export state transitions;
- quota and audit behavior; and
- safe error translation.

The initial API-contract suite now snapshots deterministic OpenAPI generated
from the canonical Zod operation registry and verifies typed-client request,
response, error, version-rejection, pagination, ETag, idempotency, and
forbidden-authority fields. Hono route tests use a fixed middleware principal
and in-memory ports to cover unauthenticated and cross-tenant hiding, strict
request/response validation, duplicate-query rejection, JSON size limits,
preconditions, idempotent replay/collision, presentation/graph separation, and
all current route families.

The persistence foundation persistence suite adds checksum/drift and
PostgreSQL-statement splitting tests; parameterization and tenant-predicate
repository tests; shared in-memory/filesystem object-store contract tests; Data
API parameter and transaction tests; and database/object failure-injection with
idempotent pending publication recovery. The local PostgreSQL integration suite
is opt-in through a dedicated test database URL and is skipped by the ordinary
no-service suite. Its dedicated command fails closed before test execution when
that URL is absent.

The solution-record persistence suite covers all seven immutable kinds:
Repository Snapshot, Observed Solution, Reconciliation Proposal, Solution
Revision Manifest, AI-authored Extension, Active Issue, and Evidence. It proves
strict kind/payload validation, tenant capability and active membership, project
ownership, parameterization, idempotent replay/collision, pending object
metadata, published-only reads/lists, revision binding, predecessor lineage, one
manifest per revision, and update/delete rejection. It does not prove a public
route or runtime workflow exists.

The identity/authorization suite adds an exhaustive protected-operation policy
check and a tenant-isolation matrix across multiple organizations and all four
canonical roles. It covers guessed IDs, cross-tenant parents, suspended
memberships, deleted principals, projects, legacy/Solution revisions, Repository
Snapshots, Observed Solutions, Reconciliation Proposals, AI extensions, Active
Issues, Evidence, validation/generation/export jobs, artifacts, integrations,
and audit events. Each new record family needs allowed, unauthenticated,
unauthorized, cross-tenant, and mismatched-parent cases. Cognito adapter tests
use a controlled verifier to cover verified, malformed, invalid, wrong-use,
unknown, deleted, and directory-outage results. The local-development adapter is
tested to refuse production and missing explicit local guards.
Recent-authentication and audit hooks cover role, integration, export, and
destructive action families.

Every tenant-owned endpoint needs allowed, unauthenticated, unauthorized,
cross-tenant, stale-version, and malformed-input cases as applicable.

### Asynchronous job contract and framework tests

The ordinary deterministic suite covers all 16 family schemas and all eight
states without invoking an external handler. It must prove duplicate idempotency
keys and collisions; entitlement denial; reservation-hook idempotency; exact
tenant/project polling and exact-principal cancellation; cancellation/completion
races; transient/permanent retry and backoff; worker crash/orphan recovery;
invalid transitions; expiry and expired artifacts; bounded payloads, outputs,
artifacts, attempts, runtime, and checkpoints; redacted errors; durable
awaiting-input response binding with immutable initial `queuedAt` and durable
`receivedAt`; exact-revision retry; supersession auditability; exact nonempty
parent/child sets; deterministic queued/running `cancel-remaining` mutations
before parent failure; stale-delivery draining; and exact Solution
Revision/environment Evidence references.

Queue tests also prove record-before-publish recovery and idempotent redelivery.
Creation tests prove service-derived raw-key/canonical-request digests, no
raw-key storage, immutable creation plans and normalized decisions, zero-hook
stale-claim recovery, expiry and parent/dependency denial, and external
commercial reference retention. Every reconciliation adapter test proves exact
ownership filtering before a low limit.

Audit tests require atomic job-CAS plus deterministic outbox, atomic creation
completion events, distinct atomic claim-denial events, best-effort publication,
durable pending/published state, idempotent delivery and mark-published
behavior, and ownership-scoped reconciliation after a sink failure. In-memory
evidence proves the port behavior; migration tests separately prove the SQL
constraints, without claiming a production repository adapter.

Deterministic fake handlers may synthesize bounded reference outputs for each
family. They cannot call models, compilers, build tools, cloud providers,
Stripe, GitHub, repository services, deployment tools, or customer code, and
their success never proves those future behaviors.

### Adapter integration tests

The persistence foundation local PostgreSQL command applies the checksum-pinned
migrations twice, applies deterministic seeds twice, verifies the complete
storage-version sequence and empty solution and commercial contracts
placeholders, resolves an active tenant scope, and updates actor preferences
with optimistic concurrency. It requires `CLOUDMARKUP_TEST_DATABASE_URL`; the
URL is never committed or printed. The ordinary suite runs the same repository
contracts through controlled executors and object behavior through in-memory and
filesystem adapters without a live service.

Migration 0009 tests verify the checksum-pinned additive table, immutable
update/delete triggers, object-purpose/kind agreement, tenant/project/revision
foreign keys, predecessor lineage, and one Solution Revision manifest per legacy
revision. Migration 0010 tests verify exact job-family/state constraints,
tenant/project ownership, identity reservations and expected-child referential
integrity, immutable subjects and normalized creation plans/outcomes, immutable
attempt identity, monotonic job/attempt record-version transitions, separate
claim/job audit evidence with pending/published delivery state, attempt
failure/retry disposition, monotonic progress, durable interactions/checkpoints,
bounded artifact/Evidence outputs, tenant-first recovery indexes, and absence of
inline secret/payload columns. Its exact checksum is
`05face90ac08f89ba6d08799d0fea1ca921577ea9afce22038309c606a7a6071`. Controlled
repository tests run without a service; the opt-in PostgreSQL suite must apply
the complete sequence twice and exercise tenant, publication, idempotency,
immutability, transition, and cross-tenant cases when its dedicated URL is
supplied.

S3 request behavior and an actual Data API/Aurora environment still need
controlled sandbox integration before production. Cognito, Bedrock, Stripe, Step
Functions/SQS, and GitHub adapters likewise need controlled tests for request
construction, signature handling where applicable, retry classification,
timeouts, redaction, and authorization scope. Do not make live third-party calls
part of the ordinary unit suite.

### Contract tests

Versioned fixtures must verify:

- web/API request and response contracts;
- persisted graph and migration contracts;
- Architecture Document v1/v2/v3 structural, semantic, canonical normalization,
  compilation/visual/source hashes, forbidden-field, v1-to-v2-to-v3 and v2-to-v3
  migration, and future-version rejection;
- Workload Behavior v1/v2 identity, graph/operation/contract references,
  entrypoint/route/event/schedule/data/auth/idempotency/observability/test/source
  ownership/extension/compatibility/provenance invariants;
- Application Contract HTTP, event/message, data, auth, operation, and test
  stable identity/version/digest plus workload/external reference integrity;
- External Resource ownership/lifecycle/create/reference/import/data-source,
  non-secret identifier/authentication, candidate confidence/provenance,
  unresolved information, and target-readiness contracts;
- Repository Snapshot exact source/revision, path/ignore/file bounds, checksums,
  detected types, redaction/limit result, deterministic finding/relationship
  evidence, unsupported files, credential rejection, and canonical hash;
- Observed Solution snapshot/reference/source-location/confidence/provenance and
  designed-conflict separation;
- Reconciliation Proposal outcome, exact precondition/command/operation,
  stable-ID, no-op, ambiguity, ignore-expiration, and stale-evidence contracts;
- Solution Revision manifest identity/lineage, exact source and tool/policy
  hashes/versions, included observation, assumptions/unresolved decisions,
  coverage/ownership/extension/issue/evidence references, and immutability;
- repository ownership/lock/manifest package paths, regeneration, semantic diff,
  conflict, and silent-overwrite rejection;
- AI-extension owned path, structured request, dependency, hash, validation,
  issue, acceptance, export-safety, regeneration, and forbidden-authority rules;
- generation-coverage required/satisfied evidence and syntax-only rejection;
- Active Issue source, affected-reference, lifecycle, provenance, staleness,
  fix, and closure-evidence contracts;
- Evidence exact-level, ordering, staleness, environment/tool/CI identity,
  redaction, and lower-level-non-implication contracts;
- Intent Document structural, normalization, provenance, and intentional
  version-rejection contracts;
- provider catalog schema;
- provider catalog canonical artifact, digest, generated accessors, and
  compatibility/migration declarations;
- provider catalog tagged configuration defaults, invalid values, reference
  sources, and value-safe diagnostics;
- exact-bound connection-presentation and service-extension source/artifact
  schemas, digests, generated accessors, total service/port coverage, unique
  dock assignment/order, direction/cardinality agreement, ownership graph
  bindings, policy-kind constraints, adoption, and target-readiness matrices;
- provider connection capability categories; aggregate port, source, target, and
  endpoint-pair cardinality; rule-owned compatibility; all-edge IAM requirement
  ordering/provenance; exact direct-edge cleanup identity; dependency-safe full
  operation-provenance closure; cycle/orphan rejection; shared retention; and
  atomic stale-cleanup rejection;
- TypeScript-to-Go revision input;
- compiler manifest, diagnostic, and artifact output;
- application-generation request/result, file, provenance, ownership,
  semantic-diff, coverage-assessment, and isolated workload build handoff
  contracts;
- diagram-renderer input and output manifests;
- billing webhook, subscription projection, entitlement, and AI usage ledger
  contracts;
- typed platform deployment configuration and secret-reference contracts;
- Async Job v1 family, subject, ownership, limits, state, attempt, checkpoint,
  interaction, orchestration, output/artifact/Evidence, queue, audit, and
  polling contracts, including future-version rejection; and
- GitHub export requests and results.

Backward compatibility, deterministic migration, or intentional rejection must
be explicit for every supported older version.

### Compiler tests

Use Go tests and HashiCorp HCL parsing for:

- exact resource mapping and stable Terraform addresses;
- deterministic file ordering and formatting;
- valid references and dependency relationships;
- rejection of unsupported nodes, edges, versions, and unsafe constructs;
- no arbitrary providers, modules, external sources, or provisioners;
- equivalent output after presentation-only graph changes; and
- bounded diagnostics that do not leak input unnecessarily.

Golden fixtures pair a versioned revision input with normalized expected files,
manifest, and diagnostics. Golden updates require human review and an
explanation of semantic change. Repeated compilation in fresh processes must
produce byte-identical normalized output.

Generation conformance's complete golden suite binds one exact revision to the
generated Terraform files, deterministic application source, canonical
contracts, source-coverage assessment, and
infrastructure/source/ownership/build-handoff manifests. Inventory-set
assertions, exact byte trees, parsed HCL/TypeScript/JSON, semantic joins,
ownership conflicts, repeated/order/presentation variants, clean temporary
directories, bounded fuzz/property cases, and non-gating performance baselines
verify the joins and digests between those sections without executing
application source or treating a coverage assessment as immutable Evidence or a
revision upgrade. Update gates and the exact reviewed layout are in
[Deterministic generation golden workflow](../development/GENERATION_GOLDEN_WORKFLOW.md).

Reviewed contract bytes use a test-only logical filename projection so the
committed fixture tree remains portable on Windows. Unique contract-ID/version
names remain readable; a 12-hex prefix of the full source-file checksum is added
only when logical names collide or must be shortened. Projected filenames are
bounded at 96 characters, complete repository-relative golden paths at 180, and
case-insensitive NFC or short-prefix collisions fail closed. This does not
rename canonical `application/contracts/...` generator or export paths. Full
exact and semantic hashes, provenance, ownership, and canonical paths remain in
the reviewed application manifests and semantic summaries.

### Workload source and package tests

The deterministic application generation source-generator suite binds an
immutable revision, Workload Behavior v2, canonical Application Contracts v1,
compiler normalized model v1, exact provider catalog, runtime/template/pattern
descriptors, and normalized application-source manifest. Golden and metamorphic
cases prove byte-identical fresh-process output, display-label and input-order
independence, stable paths and environment bindings, multiple dependencies,
canonical request/response validation, supported CRUD routes, Cognito claims,
logging/correlation helpers, and generated unit/contract fixtures.

The suite covers all six modes and fails closed for incomplete
`complete-supported-pattern` coverage, unsupported operations or runtimes,
missing behavior, malicious labels/paths, secret leakage, incompatible trigger
contracts without a reviewed dispatcher, guessed business logic, and any attempt
to render or mutate IaC. Ownership tests prove exact-baseline generated
replacement, user-owned preservation, conflicts instead of silent overwrite,
semantic/file diffs, provenance, and manifest checksums. Coverage output is
tested as an assessment only; it cannot mutate the Solution Revision or create
Evidence. Generated test files are artifact bytes in this suite, not executed
customer code.

Isolated workload build tests the initial Node.js 24 runtime through an injected
isolated workspace-executor boundary. Fake-executor cases cover exact fixed
commands, pinned toolchain/dependency/cache inputs, denied package scripts,
source and output paths, credentials/secrets, bounded
process/filesystem/time/memory/ output behavior, malformed successful tool
output, scanner findings, cancellation, cleanup, deterministic ZIPs/SBOMs,
source/build digest linkage, coverage downgrade, Evidence, and Terraform
artifact compatibility. Public result-schema tests reject forged report and
artifact integrity data.

A separate reviewed complete-notes harness materializes only generator-owned
source and uses the pinned repository Node, TypeScript, and Vitest tools to
perform a real type-check, execute the generated unit and contract tests, and
compile with a local DynamoDB stub and no registry, AWS, credential, upload, or
deploy path. It does not create production Evidence or substitute for the pinned
container. CDK assertions prove the application-build sandbox is unprivileged,
inert, network-isolated, prefix-scoped, and distinct from Terraform validation.
Neither execution suite runs in the Go IaC compiler. See
[isolated application build execution](APPLICATION_BUILD_EXECUTION.md).

### Diagram and combined-artifact tests

Deterministic diagram export fixtures bind one immutable Architecture Document
and Solution Revision to a canonical semantic scene, accessible SVG, SVG-derived
PNG, architecture metadata, warnings, combined manifest, and ZIP. Repeated and
equivalent-order rendering with pinned layout, catalog, font, icon, and renderer
versions is byte-identical. Profile-parity tests require identical resource and
relationship identity sets while allowing only reviewed presentation detail.

Security/property cases cover malicious and very long labels, external URLs,
approved and unavailable provider icons, parallel relationships, oversized
graphs/pixels/files, malformed SVG, substituted SVG/PNG/checksums, PNG
dimensions, and fail-closed limits. Viewport, selection, hover, panels, zoom,
scroll, minimap, and assistance mode are not request fields and do not affect
output. Workflow/export tests bind the exact files and artifact digest into the
manifest/ZIP; the root README uses the exact relative diagram path. Browser
tests cover bounded SVG/PNG preview, warnings, mode parity, and authenticated
complete-package download.

Official asset fixtures verify source provenance, integrity, review state,
local-only resolution, accessible fallbacks, and deterministic placeholder
behavior.

### Billing and usage tests

Commercial domain contract, deterministic domain-invariant, repository,
migration, database, and concurrency suites cover:

- each versioned Free Trial, Pro, and Team beta example without treating price
  metadata as a legal promise;
- plan effective dates, historical plan/pricing identity, stable entitlement
  decisions, and denial reasons;
- one-time welcome, monthly, promotional, and purchased-policy grant contracts,
  plus the distinct trusted administrative-adjustment contract;
- idempotent welcome and explicit subscription-period monthly issuance;
- monthly expiration at period end and purchased-grant activation failure while
  expiration policy is unresolved;
- earliest expiration, then lowest consumption priority, then grant start, then
  stable grant ID allocation, with non-expiring grants last;
- atomic concurrent reservation, insufficient credits, duplicate retry, partial
  settlement, release, expiry, and the invariant that settlement never exceeds
  reservation under `cloudmarkup-charging-and-failure-v1`;
- active reservation plan/entitlement/charging/pricing/provider/model/grant
  capture across plan, policy, pricing, or provider-default change and grant
  expiration, including no revival when expired allocation is released;
- append-only compensation with reason and trusted actor while retaining
  provider-usage and estimated-cost history;
- exact `grant`, `reservation`, `settlement`, `release`, `expiration`,
  `provider-failure`, and `adjustment` technical-event kinds, per-kind sparse
  fields, required charging-policy evidence on every event, and immutable
  related-event or reservation correlation;
- organization-shared pools, integer credit and monetary-micros invariants, and
  reconciliation totals;
- normalized provider usage and per-currency cost evidence separated from
  customer-charge credits, including zero-net-charge failures and separate
  per-currency aggregation without cross-currency combination;
- active owner/administrator/editor seat counting, active-viewer exclusion, and
  pending/suspended/removed exclusion;
- explicit versioned member/project extensions that cannot silently bypass a
  plan;
- commercial suspension, expensive-operation kill switch, credit exhaustion, and
  preservation of manual edit/read/existing-artifact/permitted-export access;
  and
- the full failure and no-net-charge/settle/compensate policy matrix.

Authorization matrices cover every canonical role, multiple organizations,
summary versus restricted technical detail, billing management, guessed
commercial identifiers, and the trusted administrative-adjustment boundary.
Every active member may read its own organization summaries; only active owners
and administrators may manage billing or read technical usage; active editors,
administrators, and owners may hold `commercial.expensive.use`; and no
organization role can perform a platform adjustment.

Billing-provider adapter adds signed and invalid provider webhooks, duplicates,
reordering, replay, unsupported/missing events, reconciliation, projection
transitions, and organization authorization. Browser return state must never
grant an entitlement. billing interface adds exposed-interface contracts,
operation-registry coverage, recent-authentication, safe errors, and
presentation evidence.

Aggregate provider-bill reconciliation cannot rewrite request-level usage or
remove provider evidence when customer credits are compensated. Test fixtures
contain no raw prompts, model responses, credentials, payment data, or customer
architecture bodies.

### End-to-end tests

Use Playwright for selected [user workflows](../product/USER_WORKFLOWS.md),
including:

- the current deterministic fixtures opening in both presentation modes without
  changing document identity, content hash, or node identities;
- the isolated manual-notes workflow adding services through drag and non-drag
  controls, configuring required fields, connecting Cognito, API Gateway,
  Lambda, DynamoDB, IAM, and CloudWatch, navigating a deterministic error,
  switching modes without semantic change, reviewing technical detail,
  undoing/redoing one atomic connection, refreshing, and recovering the exact
  local checkpoint with no draft `error` or `security-error` findings;
- one Lambda retaining an API invocation, separate DynamoDB read-table and
  write-table edges, one execution role, and one canonical log group at the same
  time; deleting the read edge removes only its edge-owned permission resources,
  while duplicate roles and incompatible triggers fail visibly;
- grouped Lambda docks retaining exact edge ports while opening, scrolling,
  focusing one connection, disconnecting one authorized edge, switching modes,
  and using reduced-motion presentation without semantic or history changes;
- collapsing Lambda to its icon and configured name, converging exact handles at
  one visible input and output aggregate, reading group names by hover/focus,
  opening adjacent connection information, expanding from the bottom action, and
  double-clicking the service body into Configure without semantic changes;
- opening Architecture, Configure, Connect, Learn, IaC, Assistant, Issues, Code,
  Activity, and Jobs through the fixed launchers while retaining at most one
  rich popup, restoring focus, and preserving document hashes;
- an IAM role summary separating generated permissions, custom inline policies,
  trust policy, managed attachments, and permissions boundary; structured
  statement add/edit/duplicate/remove; graph resource selection; principal and
  wildcard findings; and explicit bounded Terraform-ready/CloudFormation-pending
  status;
- the isolated DynamoDB encryption workflow focusing the affected configuration,
  previewing the complete reviewed safe-fix batch, applying it atomically, and
  undoing/redoing the fix;
- selected Chromium axe scans plus keyboard/focus and non-canvas fallback
  assertions, without a conformance claim;
- prompt, template, and blank project creation;
- review of AI-extracted intent;
- manual and AI-assisted graph editing;
- connection wizard preview and atomic application;
- validation navigation and correction;
- draft conflict behavior;
- revision freeze;
- mode switching, responsive review, deterministic diagram review, and combined
  artifact ZIP export; and
- a controlled GitHub export flow.

End-to-end tests should verify state through supported APIs or visible behavior,
not direct database mutation.

### AI evaluation harness

The evaluation harness uses frozen, synthetic, versioned cases with expected
properties rather than exact prose. It measures:

- schema validity;
- requirement, assumption, and unknown coverage;
- unsupported-service refusal;
- graph-operation validity after deterministic checking;
- security-sensitive omissions and unsafe proposals;
- prompt-injection resistance;
- consistency across supported model changes; and
- latency and token/cost budgets once budgets are accepted.

No evaluation passes solely because a second model approves an answer. Model
changes require comparison against a pinned baseline and human review of
regressions.

Model gateway's contract harness is provider-free and precedes live evaluation.
It uses deterministic fake responses for every ModelGateway operation and
covers:

- strict version/operation/schema compatibility and oversized or malformed
  output;
- unknown catalog services, invalid operation batches, and ungrounded repository
  claims;
- cancellation, bounded transient retry, duplicate invocation identity, and
  deterministic repeatability;
- secret redaction, safe errors, missing usage, metering failure, and proof that
  default logs contain no raw prompt or response;
- exact model/prompt/source provenance, candidate path/hash/generation-plan
  ownership, dependency approval paths, and validation expectations; and
- denial of arbitrary tool, repository, file-write, package, compiler, payment,
  and deployment authority.

Trusted model routing adds deterministic coverage for exact Sonnet Standard and
Opus Deep selection, Starter/Pro and credit denial, explicit Deep confirmation,
complex recommendation without silent upgrade, one diagnostics-bound absorbed
escalation, timeout and attempt bounds, lifecycle/evaluation/environment/kill
switches, configuration drift, cache tenant/version scope, route-aware estimate
input, prose rejection, unknown response tools, and operation-specific strict
tool schemas. Production capability records remain unevaluated candidates, and
all tests are provider-free.

Model commercial lifecycle adds deterministic provider-free tests for historical
pricing and normalization, cache/provider-specific units, quota and suspension
denial, atomic/concurrent reservation, insufficient credit, partial settlement,
duplicates, timeout, missing usage, cancellation, settlement retry, expiration,
plan change, cross-tenant denial, multi-call escalation/repair, estimate
overrun, compensation/reconciliation reports, and no automatic overage.

Model evaluation and runtime controls makes the deterministic fake harness
executable. The canonical dataset has 21 content-addressed synthetic cases and
19 deterministic dimensions; deterministic repository import and ambiguous
inference are separate cases. Each case freezes its operation/role requirement,
and each run binds it to exact capability, route, model/profile, prompt,
response-schema, and catalog evidence. Normal deterministic execution rejects
any substituted tuple and accepts only the frozen synthetic fake bindings. The
selected route family must agree with the report's fake-versus-live evidence,
and non-fake evidence requires exact live authority. Unsupported VPC and
image-processing requests must remain unresolved or refused because the current
bounded catalog does not support them.

`FrozenSyntheticModelEvaluationAdapterV1` is content-stable contract smoke. Its
expectation-shaped observations validate exact dataset/result/report digests,
malformed/partial/extra output, redaction, per-case Evidence shape, optional
non-authoritative judge separation, bidirectional score regressions,
cancellation, and absence of live authority. It is not host-owned validator
Evidence, and current evaluator execution hardcodes
`activationRecommendation: "hold"` with `capabilityActivated: false`. The
contract's reserved `eligible-for-reviewed-beta` value requires a future
separately reviewed, resolver-verified host recommendation authority.

Evaluator tests freeze 100 credits, 10,000 estimated micro-USD, 1,000
milliseconds, and 5,000 tokens as policy-digest-bound operational denominators.
They reject adapter-selected denominator substitutions. For each lower-is-better
operational dimension, a schema-valid value one unit above the 8,000-basis-point
threshold—81 credits, 8,001 micro-USD, 801 milliseconds, or 4,001 tokens—must
fail. These are threshold-breach tests; values from 81% through 100% remain
within the denominator.

The separate `pnpm check:e2e:assistant-evaluation` gate derives behavior from
each case's synthetic input instead of its expected disposition. It runs the
production review-only planner, ModelGateway fake, seamless Assistant
coordinator, deterministic repository importer, application generator/build
runner, Terraform/CloudFormation validators, ownership/security checks, and
bounded repair paths. Repository scenarios materialize exact frozen fixture
bytes, verify snapshot checksum, byte size, path, and `sourceMode`, and reject
mutations to the digest, path or source mode. The gate invokes the canonical
`scripts/validate-workflows.mjs` through the host Node executable with shell
execution disabled and binds workflow, validator, and output digests as CI-
workflow-validity Evidence; that probe remains separate from application-plus-
Terraform generation-chain Evidence. Each case derives its observed issue
severity from passed probes and must exactly match the frozen expected severity.
Every declared `requiredSafetyOutcome` and non-`none` `generationTarget` must
bind to passed exact probe groups, and evidence-removal mutations must be
detected. Its web companion renders the actual `AssistantWorkspace` in Guided
and Professional preferences and compares semantic content, authority, keyboard,
screen-reader, issue, progress, credit, and Technical-details behavior. These
probes remain validator-backed fake-model test Evidence, not recommendation or
activation authority. Runtime/commercial tests cover:

- plan/feature/suspension/kill-switch denial and exact prompt/schema/catalog/
  evaluation/runtime-policy provenance;
- strict host-issued input Evidence binding exact tenant/user/operation/input,
  all requested counts/allow-lists, redaction/sanitization, source ownership,
  verifier provenance, and no credential/deployment/shell/tool/URL authority;
  authentication before resolver/inspect/commercial/model/telemetry; rejection
  of unissued, substituted, cross-tenant, request-underreported, sensitive, or
  unredacted records; callback binding; and terminal replay reauthentication
  without another invocation or charge;
- trusted host time, request windows, commercial and lease expiry before reserve
  and immediately before dispatch, with caller/callback timestamps ignored;
- atomic idempotency, per-user/organization/feature quota, active concurrency,
  and authority-digest cumulative-capacity races—including read-only `inspect`,
  atomic `snapshotDigest` recheck in `claim`, input, output, cache-read,
  cache-write, and total-token invariants—followed by canonical credit
  reservation only after the runtime claim succeeds;
- store-issued `ModelRuntimeExecutionLeaseV1` ownership, fencing, expiry,
  revision, `recoveryOnly` state, concurrent in-progress/terminal duplicates,
  changed conflicts, atomic organization-scoped active lease-ID ownership with
  reuse only after release, ordinary
  `ModelRuntimeCanonicalCommercialPortV1.execute` versus recovery-only `recover`
  routing, and conservative release;
- tenant-scoped canonical accounting identity even when two organizations reuse
  the same opaque reservation/idempotency values, plus denied cross-tenant
  recover/settle/release/reconciliation;
- per-call reservation-pinned pricing/normalization across price-window changes;
- persisted `ModelCommercialReservationIntentV1` before reserve,
  `ModelCommercialReservationReceiptV1` with exact accounting status afterward,
  read/replay-only `recoverExistingReservation` returning only
  `ModelCommercialReservationRecoveryResultV1` after a crash, and proof that
  recovery-only execution refreshes canonical status even for a stored receipt
  while coordinator/runtime recovery cannot reserve missing work or invoke;
- absence of a generic accounting `expire` mutation, denial without release when
  trusted time alone expires, and acceptance of `expired` only as canonical
  read/recovery status from an authenticated accounting process;
- `ModelCommercialDispatchIntentV1` persistence, crash/timeout after intent with
  no reinvoke, coordinator-owned `ModelCommercialCoordinatorPreDispatchProofV1`
  after trusted expiry, externally verified
  `ModelCommercialPreDispatchNoUsageAttestationV1`, and rejection of unverified
  callback-only no-usage claims;
- authenticated priced post-dispatch failure recorded as compensated
  release—never inferred no-dispatch—and reservation retention for unknown or
  invalid post-dispatch outcomes;
- fixed safe reconciliation for throws, missing/invalid usage, unknown or
  post-dispatch outcomes, secret-shaped/oversized IDs, and unrestricted provider
  errors;
- failure-injected atomic `claim`, `checkpointPendingAndRelease`, and
  `completeAndRelease` transitions plus content-free
  `ModelRuntimeTelemetryOutboxEntryV1` writes, followed by
  `listPendingOutbox`/`acknowledgeOutbox` replay draining one complete unchanged
  stable-ID event set; plus host-authenticated operational outcomes bound to the
  exact executed request, decision, terminal, tenant, operation, safe reasons,
  and source Evidence, with bare/forged/cross-tenant/unexecuted/substituted
  denial and publish-failure replay without duplicate; and
- every input/output/repair/dependency/provider/module limit, actual
  output-byte/token rejection, host-owned operation/source-ownership Evidence,
  tenant-safe cache keys, result sanitization, and callback absence after
  denial; and
- plain-English primary issue/severity/action text plus optional Technical
  details containing exact IDs, paths, schemas, policies, bounded sanitized tool
  diagnostics, model/prompt provenance, validation deltas, and reviewed fixes
  under the same redaction rules.

`pnpm eval:model:deterministic` builds the fixed package boundary, verifies the
checked-in dataset mirror, runs the fake harness, and prints a safe canonical
summary. It is part of the full repository gate. The CLI accepts no adapter,
provider, or live-mode argument. Evaluator tests prove that direct live mode
fails with `model-evaluation.live-execution-port-required` before either the
injected adapter or optional judge is called, including when all declared live
authority is valid.

Schema and runtime-control tests separately prove exact non-production
authority, case allowlists, trusted expiry, and the atomic authority-digest
fence over projected invocation, input/output/cache-read/cache-write/total
tokens, credit, cost, and concurrency capacity across independent requests. They
also prove that workflow, lease, reservation-intent/receipt, dispatch-intent,
reconciliation, and telemetry-outbox records never price, settle, release
credits, change a balance, or replace canonical usage. Those tests do not create
a live evaluator execution port. A future host port must add atomic
fenced-admission, reservation intent/receipt and recovery,
`ModelCommercialDispatchIntentV1`/`ModelCommercialHostInvocationReceiptV1`,
reconciliation, outbox-drain, and validator integration tests before this denial
can change. The Bedrock adapter is not that evaluator port. Direct live-mode
unit tests exercise denial only; no provider-backed evaluator adapter/judge
invocation or live command/CI entry point is present. See
[AI evaluation and runtime controls](AI_EVALUATION_AND_RUNTIME_CONTROLS.md) and
the [human scripts](../../evals/HUMAN_TEST_SCRIPTS.md).

### Security testing

Security evidence includes:

- static analysis, dependency and secret scanning;
- tenant-isolation and object-reference tests;
- parser limits and malformed graph fuzzing;
- authorization policy tests;
- sandbox escape, network-denial, credential-absence, and resource-exhaustion
  tests;
- forbidden workload source/secret/prompt/command fields, exact IAM
  edge-provenance, wildcard-broadening, and unsafe permission-deduplication
  tests;
- injection tests across API, database, HCL, logs, and GitHub metadata;
- model prompt-injection and schema-confusion tests;
- CDK and deployed-configuration checks; and
- an OWASP ASVS Level 2-oriented traceability checklist.

See [Security Principles](SECURITY_PRINCIPLES.md) for the control requirements.

### Performance and resilience

Establish measured budgets during the relevant milestone, then test:

- canvas interaction across representative graph sizes;
- incremental validation latency;
- draft autosave and conflict handling;
- API and database behavior near expected initial concurrency;
- queue backlog, record-before-publish recovery, duplicate delivery,
  cancellation races, leases, heartbeats, orphan reconciliation, bounded retry,
  checkpoint recovery, and idempotency;
- billing event backlog and concurrent credit reservations;
- compiler and sandbox CPU, memory, output, and timeout bounds;
- source-generator and isolated workload builder/package CPU, memory, process,
  filesystem, network, output, and timeout bounds once implemented; and
- cold-start and scale-to-zero tradeoffs.

Load tests must use isolated non-production tenants and bounded cost controls.

## Test data and fixtures

- Use fictitious organizations, repositories, prompts, ARNs, domains, and
  account identifiers.
- Store no secrets; use explicit dummy markers where a secret reference is
  needed.
- Version Intent, Architecture, Workload, Application Contract, External
  Resource, Repository Snapshot, Observed Solution, Reconciliation, Solution
  Revision, ownership, AI extension, coverage, Active Issue, Evidence, catalog,
  migration, Async Job, compiler, source-generator, and workload-package
  fixtures together with their owning contract.
- Version pricing, entitlement, usage, renderer, layout, and asset fixtures with
  their owning contracts.
- Keep golden outputs reviewable and exclude incidental timestamps, random IDs,
  and machine paths.
- Provide builders for valid defaults while keeping boundary cases explicit.

## CI and release evidence

The current GitHub Actions workflow runs on pull requests and pushes to `main`
or the repository's transitional `master` branch. It grants read-only contents
permission, restores pnpm and Go caches, performs a frozen install, runs the
ordered root `pnpm check`, retains the coverage report for seven days, runs the
bounded Chromium editor workflow suite in a separate browser job, and runs
secret and dependency checks in a separate understandable job. The browser job
installs only Chromium with Playwright's declared system dependencies and
retains its HTML report only after failure. CI uses no AWS credentials and has
no deploy step.

This workflow is product-repository CI evidence only. architecture CLI also
ships a separately parsed `cloudmarkup-validate.yml` template for
credential-free Solution Revision repository validation. Its package tests
enforce exact permissions, full-SHA actions, checkout credential removal, fixed
bounded commands, fork safety, artifact path/retention, and the absence of
secrets, network download helpers, Terraform plan/apply, or deployment. The CLI
fixture proves byte/semantic drift, equivalent ordering, malicious labels/paths,
ownership conflicts, lock mismatch, stable exit codes, bounded output, and
repeatable isolated generation.

Neither product-repository workflow establishes customer-cloud plan or
deployment Evidence. The customer-owned workflow generator produces separate
customer-owned workflow files whose eventual runs may produce
revision/environment-bound Evidence, but Cloud Markup owns no credential, state,
approval, execution, or Evidence claim from those future customer runs.

## Local repository-import evidence

Repository import adds a dedicated repository-importer project plus Go HCL
protocol, architecture-CLI, and editor component tests. Fixtures cover canonical
Cloud Markup source, HCL and tf.json, sanitized show JSON, CloudFormation and
CDK synth, generated/application/environment manifests, workflow structure,
external references, ambiguous expressions, malformed JSON, links, binary and
oversized inputs, sensitive values, repeated and reordered import, exact and
visual-only matches, designed/observed-only, configuration/connection and IAM
drift, generated ownership/checksum drift, and reconciliation
no-op/accept/review-only behavior.

Property-style path tests reject absolute, traversal, backslash, Windows device,
ADS, empty, overlong, and nonportable components. Fixed-argv HCL adapter tests
cover injection, timeout, malformed output, and byte limits. UI tests prove one
Guided/Professional structure, source provenance, external styling, safe
malicious-label rendering, and callback-only review actions. Passing Evidence is
rank-8 repository conformance and must never be presented as deployed state.

CI displays each evidence level independently. Passing schema/contracts or
compilation never upgrades application build/tests, cloud plan, deployment,
repository conformance, or deployed-drift evidence.

The current deterministic gate runs:

1. formatting verification and typed linting;
2. strict TypeScript checking;
3. TypeScript unit/component tests with coverage;
4. production builds;
5. Go formatting verification, `go vet`, and tests;
6. four-stack nonempty CDK synthesis, security assertions, and assembly review;
   and
7. workflow YAML and least-privilege validation.

Platform CDK evidence also proves logical capability ownership, typed
environment validation, redaction, missing-input and cross-environment failure,
zero customer-compiler imports, and absence of a customer deployment path.

Secret scanning is local and deterministic; registry-backed dependency audit is
separate because it requires network access. As later milestones introduce
schema generation, property, contract, adapter, browser, security, and
evaluation suites, place them at the matching boundary rather than weakening the
existing gate.

A flaky test is a defect. Quarantining one requires an owner, reason, risk
assessment, and removal condition; quarantine cannot hide a release-critical
security or determinism failure.

## Milestone evidence

Each milestone in [Build Sequence](../PUBLIC_STATUS.md) lists its exit evidence.
A feature is not “implemented” merely because its happy-path UI exists. Its
domain rules, authorization, failure states, contract compatibility,
observability, and relevant test layers must agree.

## Deterministic export evidence

Deterministic export packaging has a dedicated solution-export Vitest project
and focused package gate. Its positive matrix covers infrastructure-only,
generated-starter, complete-supported-pattern, user-provided, and
external-artifact output. Tests join the manifest to exact
producer/revision/tool hashes, source ownership, artifact references, coverage,
provenance, file bytes, semantic checksums, and the returned ZIP.

Negative cases cover stale revisions, malformed/corrupt manifests, modified
bytes, user-owned and modified-generated conflicts, checksum errors, traversal,
absolute/platform/alternate-stream/device/non-NFC paths, duplicates and case
collisions, symlinks/non-regular files, secrets/local paths/signed URLs/raw
prompt or log markers, forbidden caches/state/plans, and every configured size
class. Repeated runs and equivalent collection orders must produce identical
manifest and ZIP bytes.

## Immutable export workflow evidence

Immutable solution export adds a dedicated workflow package, API integration
suite, web component tests, and isolated Playwright configuration. The workflow
tests bind one exact Solution Revision record/digest through compiler,
source-generation, eligible build, Terraform-validation, packaging,
verification, diff, checkpoint, Evidence, and content-addressed publication
ports. Negative cases cover malformed or mismatched object references, compiler
output, generator conflicts, failed build/tests, failed Terraform validation,
corrupted stage reports/checksums, cancellation between stages, retry-safe
immutable input, and blocked publication.

API and migration tests cover immutable-only creation, pure entitlement denial,
idempotent enqueue, fixed environment/profile baseline, every blocking stage,
failed Evidence retention, tenant-scoped preview/diff, corrupted archive/grant
metadata, expiry, revocation, safe headers, and cross-tenant selectors. A
successful public job must identify exactly one verified artifact; a failed or
canceled job cannot publish or mint a grant.

The immutable solution export Playwright suite covers infrastructure-only,
generated-starter, and complete-supported-pattern success; compiler, generator,
build, contract test, and Terraform-validation failure; retry/cancellation;
expiry; cross-tenant denial; reproducible reruns; previous-export diff; exact
coverage; and authenticated checksum-bound download. Guided and Professional
runs use one component tree and retain the same ordered tabs/actions, active
job, selected tab, and selected file. Browser assertions also reject rendered
secrets, tokens, signed URLs, and local machine paths. The deterministic API
harness is local test evidence, not proof that production queue, object-store,
SQL, or runner adapters are deployed.

<a id="prompt-35-bedrock-and-intent-tests"></a>

## Bedrock and Intent tests

Ordinary CI remains networkless. Mocked SDK tests cover Converse and
ConverseStream translation, native JSON Schema versus forced strict tool use,
safe metadata, configured target and Region validation, stream assembly, input/
output/cache usage, provider request ID, absent reasoning-unit behavior,
oversized output, cancellation, timeout, IAM denial, throttling, retryable
service failures, kill switches, effective configuration, and schema subset
translation. Gateway/domain tests retain injection, secret redaction, strict
provenance, no tool authority, and deterministic Intent semantics.

Bedrock and intent adapter / model evaluation and runtime controls runtime and
commercial composition tests prove atomic quota/ concurrency and cache-inclusive
capacity acquisition; store-issued runtime/ commercial lease and revision
ownership; reservation intent before reserve, exact receipt after reserve or
read-only recovery, and no reservation creation on recovery-only execution;
trusted-time expiry rechecks; per-call pricing/normalization pins; persisted
dispatch intent; coordinator-owned trusted expiry proof versus externally
verified callback-origin no-dispatch attestation; compensated authenticated
post-dispatch release versus unknown/invalid reconciliation; concurrent replay
without reinvocation; and atomic stable-ID runtime telemetry outbox recovery
through `listPendingOutbox`/`acknowledgeOutbox`. API contract tests prove the
result carries only safe requirements, route/credit summaries, optional
technical usage, and provenance while rejecting pricing internals, raw content,
provider errors, secret-shaped metadata, and unbounded IDs.

These tests also prove recovery-only execution refreshes canonical accounting
status when a receipt is already stored, no generic accounting `expire` mutation
exists, trusted time alone cannot release credits, and `expired` is accepted
only as canonical read/recovery status from an authenticated accounting process.

Live smoke is manual and opt-in only. In addition to reviewed Bedrock route,
pricing/normalization, environment, credentials, and explicit test cases, valid
evidence requires a separately reviewed host composition that supplies trusted
time; atomic quota/concurrency and cache-inclusive capacity acquisition; the
fenced runtime/commercial leases and revisions; reservation intent/receipt and
read-only recovery; pinned pricing/normalization; persisted dispatch intent;
coordinator proof, verified external attestation, compensated post-dispatch
release, or fixed reconciliation as applicable; and exact runtime outbox
draining. Neither a direct adapter call nor `ModelIntentCommercialServiceV1`
alone is evidence. Record only bounded opaque identities, trusted occurrence
time, normalized usage, reservation, credits, and fixed reconciliation state.
Never record request/response content or raw provider metadata. Skip—not
silently fake—the smoke when any prerequisite or host protocol is absent.

<a id="prompt-36-solution-proposal-tests"></a>

## Solution-proposal tests

The ModelGateway project now composes the configured deterministic gateway with
`ReviewOnlySolutionProposalPlannerV1`. Focused cases cover a complete
Architecture/Workload/Application Contract proposal on a detached candidate,
typed external resources, evidence-bound repository reconciliation, unknown
catalog services, invalid edge ports, disallowed Graph Command and policy kinds,
unsupported targets, malicious display labels, resource-count limits, ambiguous
ownership, missing secret references, ungrounded repository claims, bounded
repair exhaustion, exact replay, and provenance tampering.

The tests inject deterministic no-op rules for all seven required validation
categories and assert that every supplied rule executes. They also assert
`writeAuthority: "none"`, unchanged canonical input, and deterministic
structural normalization of graph and External Resource canonical identities
independent of labels/explanatory copy. Identity cases cover rewritten
`architectureNodeIds` and `importAddressId` references, exact canonical
evidence/interface-contract references, and external authentication secret
references grounded only in current Workload bindings or existing External
Resource authentication. Dedicated deterministic-validator cases cover variable,
unresolved-item, architecture-requirement, dispatcher, extension, and Evidence
references. Proposal-data assumption/question/scenario IDs remain separate.
Complete Workload/Application Contract replacements allow content changes but
reject new or noncanonical workload, operation, binding, contract-set, contract,
index, role, fixture, and expectation identities. The tests also bind the
preserved raw response digest to the detached normalized projection, assert
conservative generation coverage and Active Issues for blocking
questions/coverage gaps, and retain invalid candidates only through the
restricted boundary. The fake planner is the local/CI path; these tests use no
model network, provider credentials, repository mutation, compiler, plan, or
deploy step.

<a id="prompt-36a-ai-extension-tests"></a>

## AI-extension tests

AI extension generation tests are deterministic and provider-free. ModelGateway
contract and security suites cover exact minimized generation context, owned
files and patches, dependency/provider/resource allowlists, extension-slot
binding, expected tests, source references, assumptions/unresolved items,
prompt/model provenance, repair-candidate binding, secret redaction, and
malformed or ungrounded output. Deterministic generators remain the asserted
path for supported catalog behavior.

Coordinator suites cover complete `ai-assisted-custom` application, Terraform,
and reviewed-schema CloudFormation candidates; deterministic bypass; bounded
materialization; tenant isolation; immutable artifact lookup; exact AI extension
contract review/accept/reject decisions; stable IDs; input-order
reproducibility; and no mutation of canonical revisions, deterministic
artifacts, or repositories. Negative cases include traversal, malicious
labels/content, case and Unicode collisions, stale patches, excessive
files/bytes/resources, unapproved operations/dependencies/providers/resource
types/properties, deterministic path/address shadowing, ambiguous ownership,
missing secret references, missing expected tests, unresolved behavior,
ungrounded source/repository claims, unsupported target readiness, stale
acceptance, and tampered provenance.

Additional adversarial cases rehash stored bytes and sizes, require an exact
artifact/output bijection and exact Evidence kind/artifact binding, preserve
per-file ownership in accepted decisions, deny protected file bodies before
provider invocation, and return bounded Active Issues for malformed initial or
repair output retained only by the restricted stores.

Reviewer-authorization tests prove allowed and denied inspect, edit, accept,
reject, and `apply-deterministic-fix` decisions; verified-authentication-context
origin; and exact
action/principal/organization/project/review/artifact/source-revision/operation
binding. Inspection and editing tests prove exact prior file digests,
path/size/content/secret safety, immutable model artifacts, complete replay,
fresh artifact-bound Evidence, and no repository write or silent overwrite.
Store tests prove each artifact receives one immutable exact review
identity/digest binding, validation completes before atomic supersession, stale
or invalid supersession leaves the predecessor current, and repeated edits
preserve append-only authorization and per-file lineage. They also prove the
generation finalization seal remains immutable while every edit appends an exact
decision/parent/validation authority over cumulative file lineage and monotonic
Evidence, issue-history, and current-issue prefixes.

Acceptance and rejection tests prove exact current-review authorization is
followed by a current artifact/binding reread and that concurrent supersession
fails closed. Edited acceptance rereads and rejoins every immutable historical
predecessor binding, lifecycle/replay record, and revalidation authority. The
source revision remains unchanged, the successor revision is distinct and
immutable, Evidence is re-bound to it, the export input preserves ordered
model/prompt/usage attempts and user edits, and both records grant no deployment
authority.

Active Issue tests prove label/copy-independent identity, current-state
retention, stale marking after complete superseding validation, exact
issue-linked Evidence resolution, rejected AI-repair references, append-only
tamper detection, and bounded history. Progress-port tests prove live
publication is awaited and serialized, the sequence is bounded and monotonic,
and every phase extends the exact digest-bound current/history prefix. Terminal
tests verify one immutable finalization seal over the complete prefix, terminal
snapshot/result, and final Evidence/issues/history counts and digests; both
forms remain read-only.

Reviewed safe-fix tests pin the exact host-authorized `apply-deterministic-fix`
action and operation digest, scope, review, artifact, source revision, current
issue record, Graph Command v1 batch, and source/result hashes. They prove
`reviewedBy` derives from the allowed decision, the decision ID is returned with
changes and inverse, and AI-only authority or any mismatch is rejected.
Package-level coordinator and acceptance tests exercise authorized inspect,
edit, accept, and reject operations, including current-store rereads and stale
concurrency rejection. Mounted route and presentation tests rehash
review/inspection/replay/file/scope authority, hide bytes for stale or forged
input, exercise only the surface's edit and accept callbacks, and prove the
exact five-stage flow, plain-English primary issues, bounded assumptions,
unresolved questions, expected tests, Evidence, collapsed
files/schemas/tools/model/fix technical details, ordered privacy-safe attempt
summaries without raw provider-attempt
prompt/response/repair-section/secret/diagnostic content, no deployment action,
and one identical component tree across assistance preferences.

The application-runner suite proves exact scaffold preservation, extension-point
ownership, AI bundle, source, envelope, and revision bindings, fixed unit and
contract test execution, package provenance, rank-5 Evidence, failure downgrade,
and rejection of unresolved behavior or replacement of user-owned or generated
files. Terraform extension tests cover strict HCL, baseline and candidate-subset
digests, provider and resource allowlists, denial of modules, backends,
provisioners, shell and external execution, offline `init -backend=false` and
validation, policy and security tools, address collisions, and rank-4-only
Evidence. CloudFormation tests cover JSON and long-form YAML; tag, anchor, and
alias denial; recursively closed nested schemas with required/type/pattern/range
constraints; intrinsic/reference validity and cycles; recursive IAM wildcard,
`NotAction`, and `NotResource` denial; exact ownership and resource limits;
pending target readiness; and exact rank-4 artifact/model/schema provenance.

Repair tests verify sanitized relevant context only, distinct idempotency and
metering per attempt, one trusted reservation and cumulative accepted estimate,
raw-response versus deterministic merged-bundle digests, persistent per-path
lineage across partial multi-file repairs, full-pipeline reruns, no policy
weakening, clear exhaustion after the configured maximum, and privacy-safe
ordered presentation summaries without exposing raw attempt content. Ordinary CI
uses queued deterministic gateway responses, fake artifact stores, fake
executors, and injected reviewed schemas; it uses no live model, credentials,
registry during candidate execution, Terraform plan/apply, CloudFormation change
set, cloud call, repository mutation, or deployment.

<a id="prompt-37-seamless-assistant-verification"></a>

## Seamless Assistant verification

Schema and domain tests cover every allow-listed Assistant operation family,
whole-document and unknown-operation denial, exact preconditions, partial-batch
rollback, stable-ID/position/configuration/file preservation, detached diffs,
and final atomic validation. Planner tests cover deterministic model-authored ID
normalization, rewritten references, exact external evidence/contract/secret
grounding, and fail-closed identity-bearing additions.

Fake-model workflow tests cover valid, invalid, and partial batches;
cancellation and insufficient credits before model use; canonical
reserve/settle/release; duplicate idempotent replay without another invocation
or charge; repository reconciliation; External Resources; custom-generation
requests; generated- resource previews; stale-safe reviewer edits; Active Issue
current/stale updates; and explicit accept/reject with `writeAuthority: "none"`.
Web tests cover the shared
requirements/change/repository/generation/issues/progress/credits/file-impact
surface, readable and technical diffs, keyboard and screen- reader semantics,
and the identical Guided/Professional component tree.

The complete fake path uses deterministic adapters and in-memory reference
ports. No live model, repository mutation, GitHub call, compiler, payment
mutation, credential, cloud plan/apply, change set, or deployment occurs.

<a id="prompt-40a-customer-owned-workflow-verification"></a>

## Customer-owned workflow verification

Customer-owned workflows tests the workflow generator and exported artifacts as
deterministic data. No test assumes a GitHub OIDC token, calls AWS, accesses a
Terraform backend, applies infrastructure, runs generated customer repository
code, or opens a live GitHub pull request.

Package tests parse and validate all five exact workflow paths and cover:

- deterministic bytes, manifest/preview hashes, full-commit action pins, minimum
  job permissions, bounded artifact retention, and path/secret scanning;
- credentialless pull-request validation and denial of OIDC, secrets,
  `pull_request_target`, fork credentials, wildcard trust, long-lived keys,
  arbitrary actions/commands/providers/modules/provisioners, and unsafe refs;
- distinct development/staging/production roles, workspaces, approved refs,
  protected production approval, customer-controlled state, concurrency, and
  kill-switch behavior;
- saved-plan manifest creation and exact bindings for Terraform/tool/lock,
  Solution Revision, commit, environment, backend/workspace, inputs, checksums,
  and expiry, including stale, substituted, tampered, replayed, and
  cross-environment denial, plus an executable case where expiry crosses between
  initial inspection and the immediate pre-apply gate;
- deploy of only the approved saved plan, never re-planning, host-owned provider
  configuration with provider blocks/aliases denied, plus receipt-bound smoke
  and read-only refresh drift against the exact deployment run, commit,
  environment, and revision;
- bounded sanitized smoke, immutable per-environment target digests, explicit
  rejection of unsupported ephemeral mode, separate per-environment promotion
  plans, exact predecessor deployment and smoke receipts, scheduled/manual
  drift, and sanitized smoke failure Evidence;
- executable fake-filesystem checks for saved-plan encryption/decryption and
  tamper rejection, endpoint admission, promotion input admission, and strict
  predecessor smoke receipt/result/Evidence validation;
- exact backend-descriptor and six-assignment `backend.hcl` admission, including
  duplicate/unknown/comment/Region failures, plus bounded HCL/JSON parsing that
  distinguishes inert comments/strings/heredocs from actual forbidden module or
  provisioner blocks and rejects malformed, escaped-key, and limit-exhaustion
  cases;
- exact private-repository runtime identity/visibility rechecks before protected
  artifact or OIDC work, exact smoke URL digest admission with no AWS role, and
  staging/production binding to both predecessor deployment and smoke receipts;
  and
- deterministic fixture lifecycle success/failure, static concurrency and
  idempotency controls, least-privilege policy, and the absence of Cloud Markup
  deployment, merge, credential, or workflow-run authority.

Solution-export and fake GitHub adapter tests prove that only the exact five
strict workflow contracts can be included; all paths/digests receive explicit
confirmation; missing Workflows permission yields an exact workflowless
readiness warning; one idempotent feature-branch/pull-request export contains
the reviewed bytes; and retry cannot duplicate the pull request. Architecture
CLI coverage proves the exported manifest may observe only manifest-declared
workflow files and that unrelated repository workflows remain outside observed
inventory.

The focused gates are `pnpm check:customer-ci-workflow`,
`pnpm check:e2e:customer-workflow`, `pnpm check:architecture-cli`, the
solution-export and GitHub-export suites, `pnpm ci:validate`, and
`pnpm security:check`, followed by the complete repository gate. The tests
validate the current credentialless package-integrity workflow and activation
hold only. They do not establish a full operational architecture CLI pipeline:
beta and production activation remain blocked until a reviewed published CLI
distribution, digest, installation procedure, and support policy exist and
authoritative execution-boundary GitHub Environment-policy verification is
available. A fake deployment produces a receipt, not fabricated canonical
deployment Evidence; only passing fake smoke produces deployment Evidence. No
customer-owned workflows test calls live AWS, mutates a live GitHub repository,
runs GitHub Actions, plans/applies Terraform, or deploys.

<a id="prompt-41-aws-networking-catalog-verification"></a>

## AWS networking catalog verification

AWS networking catalog is catalog, domain, connection, policy, validation, and
compatibility evidence only. Tests must not render a new editor, add compiler
output, execute repository code, call AWS, use credentials, run Terraform,
plan/apply, or deploy. Human-friendly behavior is verified in the catalog data:
stable dock groups, concise relationship labels, short Guided explanations,
exact Professional details, and secondary Connection, Security, Cost, and
Operations content. It is not a claim that a new React surface exists.

Catalog and artifact tests cover:

- the exact 26-service inventory, including all 14 additive networking service
  IDs and the preserved 12-service `0.8.0` source family;
- strict schemas, reviewed defaults, field UI hints, tagged-value diagnostics,
  stable semantic ports, direction/cardinality, boundary placement, opaque
  catalog icon IDs, reviewed placeholder/asset state, hidden-configuration null
  icons, and explicit unsupported modes;
- total connection-presentation assignment, stable input/output dock groups,
  relationship labels, mode-equivalent fields/actions, and binding of all three
  generated artifacts to one exact catalog ID, version, and digest;
- service-extension readiness and exact owned slots for routes, subnet
  associations, ingress/egress rules, endpoint resource policy, and Lambda VPC
  access;
- valid configuration fixtures for all 14 networking concepts and invalid
  fixtures for typed VPC CIDRs, gateway-only endpoint mode, and IPv4-only Lambda
  VPC access; and
- deterministic artifact bytes, accessors, hashes, icon-manifest binding,
  source-order invariance, fixture safety, and generated-artifact drift.

Connection, domain, and policy tests cover:

- Region-to-VPC-to-Availability-Zone-to-subnet containment, one-AZ subnet
  ownership, VPC-scoped route table/endpoint placement, and public-subnet NAT
  placement without treating AWS-owned zones as customer resources;
- explicit route-table/subnet, VPC/internet-gateway, route/gateway,
  endpoint/route-table, VPC/security-group, and Lambda-configuration/subnet/
  security-group associations, including exact direction, endpoints,
  cardinality, same-VPC checks, deterministic IDs, and input immutability;
- all eight networking direct-association resolver registrations plus rejection
  of descriptor-only placement and owner-slot relationships by the free-form
  resolver, empty direct-association supporting-resource/IAM effects, and no
  silently generated Elastic IP address;
- canonical owner bindings, one-owner invariants, lifecycle/provenance match,
  generated route/association adoption, dependency-safe cleanup, and
  preservation of user-owned configuration;
- security groups as stateful associated policies rather than containers, with
  ingress and egress kept directionally distinct; and
- canonical endpoint resource-policy ownership, policy-kind/cardinality
  projection, raw-policy exclusion, and Lambda ENI permission findings without
  generated broad permission or unsafe auto-fix.

The four networking validator suites exercise deterministic finding IDs,
ordering, severity, exact affected paths, target/environment applicability, and
no input mutation. Their positive and negative matrix includes:

- a single matching Region boundary; valid VPC/subnet CIDRs; out-of-VPC and
  overlapping subnet rejection; and advisory multi-AZ concentration;
- explicit route-table association; public default route through the attached
  same-VPC internet gateway; private direct-internet rejection; public zonal NAT
  posture; and the modeled cross-AZ NAT cost warning;
- S3/DynamoDB-only same-Region gateway endpoints, same-VPC route-table
  associations, duplicate-service rejection, and full-access versus restricted
  canonical policy alignment;
- valid ingress/egress protocol, port, and IPv4 CIDR scope; duplicate rules;
  broad ingress/egress warnings; and security errors for administrative ports
  open to the world; and
- one Lambda owner, bounded subnet and security-group sets, one shared VPC,
  multi-AZ/private-subnet recommendations, the public-subnet/no-public-IP
  warning, unsupported dual-stack access, reviewed ENI policy presence, and the
  fail-closed pending-compiler finding.

Compatibility and target tests reproduce the exact historical `0.8.0` source and
digest, require the `0.8.0` to `0.9.0` migration's exact source binding, prove
its deterministic additive result and no document rewrite, reject wrong
providers/versions/digests, and preserve earlier migration paths. Mapping tests
verify target inventory/readiness and selected subnet binding constraints while
keeping every networking declaration `metadata-only`, ambient Region/AZ
rendering `not-applicable`, and managed networking renderer readiness `pending`.
Existing Go compiler cases remain pinned to `0.8.0`; `0.9.0` must fail as an
unsupported catalog rather than produce partial notes or networking output.

Focused source suites include `networking-catalog.test.ts`,
`networking-validation.test.ts`, `connection-resolution.test.ts`,
`connection-presentation.test.ts`, `provider-extension-artifacts.test.ts`,
`policy/projection-v1.test.ts`, `owned-configuration.test.ts`, and
`catalog/migrations/networking-0-8-to-0-9.test.ts`. Prompt-boundary verification
regenerates and checks catalog artifacts, then runs `pnpm check:contracts`,
`pnpm check:assets`, the exact compiler compatibility checks, and one root
`pnpm check`. Security and dependency checks remain required where the root
instructions prescribe them; no passing catalog suite may be relabeled as UI,
compiler, cloud-execution, or deployment evidence.

<a id="prompt-42-aws-networking-editor-verification"></a>

## AWS networking editor verification

AWS networking editor adds presentation and editing evidence over an exact
catalog `0.9.0` Architecture Document. The editor remains provider-neutral:
tests bind the compiled catalog and assert projected node kind, placement,
owned-slot, dock, relationship, and ancestry facts rather than parsing AWS
service IDs or labels. The scope is synthetic local visualization and Graph
Command handling. It is not live AWS discovery, customer observation, compiler
support, architecture-as-code generation, deployment, or a large-graph
certification.

Model and command tests cover:

- `architecture-presentation-projection.test.ts` for four distinct boundary
  tiers derived from exact ancestry, public/private primary facts, typed
  association badges and exact edge IDs, hidden route/association/security-rule
  summaries, Lambda VPC access subnet/security-group evidence, managed services
  outside VPC containment, stable networking docks, and catalog-authored
  education;
- `architecture-geometry.test.ts` for the four-level multi-branch fixture,
  readable minimum content space, deterministic ancestor growth, bounded maximum
  rejection, geometry independence from dock/row disclosure count, propagation
  of `geometryOverflows` into a persistent canvas status instead of silent loss,
  unique deepest-target selection, and fail-closed equal-depth overlap with
  `ambiguous-boundary-target`;
- `aws-networking-placement.test.ts` and `node-placement-command.test.ts` for
  one-AZ subnet ownership, valid atomic cross-AZ move/reparent, suggested
  non-drag placement, invalid VPC/subnet/root drops with no mutation, false
  containment rejection for security groups and managed services, and undo/redo
  through safe domain inverses;
- `aws-editor-fixture.test.ts` for exact Region/VPC/two-AZ/public-private-subnet
  parents, normalized hidden configurations, exact owner/resolver ports, and no
  false containment; and
- `OwnedConfigurationPanel.test.tsx` plus the focused domain command tests for
  schema-driven non-policy create/edit/remove, current associations, Lambda VPC
  access removal as one batch, resolver-backed association creation, and
  undo/redo without hand-authored invalid edges.

Component and isolated-visual evidence covers:

- `EditorWorkspace.networking.test.tsx` for distinct hierarchy, bounded derived
  sizing, association badges, hidden owner summaries, NAT/endpoint/Lambda help,
  minimap roles, boundary collapse/hash invariance, stable dock IDs, canvas
  node/dock Guided/Professional parity, valid-AZ-only list placement, and atomic
  history;
- Existing stable-dock and edge-path suites define exact semantic endpoints,
  deterministic fan-out, and disclosure invariance. The correction restores the
  exact 176-by-72 wrapper and proves handle coordinates and canonical paths
  remain unchanged through disclosure and details scrolling. Unknown and
  catalog-mismatch fallback metadata now records the actual rendered bottom
  side, including collapsed-dock highlight parity; and
- the `AwsNetworkingHierarchy` and `AwsNetworkingLambdaVpcAccess` Storybook
  states. `pnpm check:storybook` builds them successfully. Storybook itself has
  no snapshot runner; `editor-networking.visual.spec.ts` separately owns two
  Linux-only `toHaveScreenshot` cases and reviewed PNGs for the fitted hierarchy
  and Lambda VPC-access help. CI runs them after a frozen install and
  dependency-only prebuild in the digest-pinned Playwright 1.61.1 Noble image.

Hidden route summaries use the current configuration service's neutral display
name and exact facts. The generic surface uses neutral **Owned configurations**
labels and mounts **Technical details** with identical structure in Guided and
Professional modes.

Graph-command output and validation lifecycle output use separate polite atomic
live regions. Validation clears and reannounces per generation without
overwriting the exact action result. Focused store/workspace/validation coverage
passes 3 files/48 tests, and the networking interaction cases observe the
validation cycle before asserting the preserved command announcement.

The dedicated `apps/web/e2e/editor-networking.spec.ts` Chromium suite passes
4/4. It exercises the exact hierarchy, association edges, hidden configuration
nodes, NAT and managed-service education, Lambda VPC access, minimap, collapse
and assistance-mode hash invariance, the keyboard/list cross-AZ alternative with
undo/redo, one valid pointer move, and one invalid subnet-container drop that
leaves the document unchanged. Its fourth case reviews route-table-association
create, direct B-to-A retarget, remove, stable direct-edge ID and provenance,
validation/action announcements, unchanged subnet geometry/containment, and hash
undo/redo/reset. The retarget intent pins only the original relationship rule,
excludes the current edge from cardinality, and preserves ordinary edge-edit
candidate behavior. Selected local axe scans cover the fitted networking canvas,
Lambda help, and boundary-placement controls. The transformed canvas target-size
rule is excluded where viewport clipping makes its result invalid; untransformed
help and placement controls are scanned separately. This is bounded Chrome/axe
evidence, not multi-browser, screen-reader, manual, WCAG, or live-AWS evidence.

Export-independence evidence is split at the real package boundaries. The web
integration test mounts the actual editor session and toggles collapse,
assistance mode, zoom/minimap viewport, Inspector tab/open state, and education
disclosure while observing the same immutable Architecture Document reference,
canonical bytes, and revision hashes. The diagram-export service test strictly
rejects transient editor fields and independently derives equal schema-parsed
requests from equal cloned documents under different presentation snapshots; the
request, artifact, SVG, and PNG bytes are identical. There is intentionally no
production web-to-diagram-export dependency, so these tests do not invent a
compiler/export seam.

Focused final-source evidence is green after assertion corrections: AWS
networking editor web, domain, and UI suites; exact-version web lint; the
14-task dependent type-check/build; the 11/11 diagram-export service suite; the
1/1 editor export-source case; the final 4/4 networking interaction
specification; the final 2/2 pinned-Linux screenshot comparison; and the 1/1
exact stable-handle case.

The web project passed 85 files/714 tests serially before the Windows host
failed to start its final worker. That exact file passed 17/17 in a fresh
process; the shared-UI project passed 8 files/52 tests. Together these bounded
runs cover the final 94-file/783-test inventory. The earlier parallel
`pnpm check:web` wrapper stopped under host saturation and is not relabeled
green. `pnpm check:diagram-export`, `pnpm check:storybook`, and
`pnpm security:check` are green.

The latest default Playwright stage ran 83 cases and stopped at 55 passed, 26
intentionally skipped, and 2 failed on the since-corrected live-region race.
Both failed cases passed focused afterward. The complete `pnpm check:e2e`
wrapper was not rerun or relabeled green. Its unreached typed backend /
immutable solution export / model evaluation and runtime controls / GitHub
export interface, 40A, and 40B stages were run separately and passed at their
recorded counts; those are constituent rather than wrapper results.

On the earlier pre-late-audit tree, the required root `pnpm check` ran exactly
once. Formatting, lint, 23-package type-checking, generated schema/catalog
checks, deterministic model evaluation, model evaluation and runtime controls
checks, and icon checks passed before coverage. Coverage stopped the aggregate
on 15 existing solution-export integration cases because the test renderer
paired the immutable `0.8.0` Notes fixture with the current `0.9.0` catalog. The
test-only renderer now uses the catalog pinned by `API_DIAGRAM_ICON_REGISTRY`;
the focused API file passed 49/49. The corrected coverage constituent passed 298
files with 4 skipped and 2,972 tests with 50 skipped: 81.11% statements, 73.59%
branches, 86.77% functions, and 81.49% lines.

Every root constituent not reached by that earlier stopped aggregate passed
individually on that tree: Storybook and the 23-task package build, bundled-icon
checks, Go format/vet/tests, four nonempty development CDK synth stacks reviewed
without deployment, both CI validators, and the secret scan. The root aggregate
was not rerun after late editor fixes; it remains stopped/failed and is not
final-source aggregate evidence. Final hygiene is complete, and AWS networking
generation has not started.

The exact `aws.cloudmarkup.notes-api-catalog@0.8.0` Go compiler and
application-generator registration remains unchanged. Catalog `0.9.0` networking
target readiness remains pending and metadata-only, ADR-0020 remains Proposed,
and no API, migration, compiler/export semantic, deployment, or AWS networking
generation behavior is covered or authorized by AWS networking editor.

<a id="prompt-43-aws-networking-generation-verification"></a>

## AWS networking generation verification

AWS networking generation supersedes the AWS networking catalog / AWS networking
editor metadata-only compiler boundary without rewriting either historical
artifact. Compatibility tests preserve exact `0.8.0` legacy Terraform behavior,
preserve and reproduce exact `0.9.0` as an unsupported compiler input, and
accept only exact `0.10.0` ID/version/digest for the networking renderer and
reachability projection. Wrong pins fail closed and produce no partial target
artifact.

Provider validation and catalog evidence covers:

- malformed VPC/subnet IPv4 CIDRs, subnet-outside-VPC and overlapping-subnet
  ranges, one-AZ ownership, ancestry and relationship scope across Regions and
  VPCs, and deterministic affected paths/order;
- public/private label and route mismatches, missing VPC internet gateway,
  missing default route, explicit route-table association, private direct-IGW
  rejection, and exact NAT/endpoint satisfaction of declared Lambda egress;
- S3/DynamoDB gateway-endpoint service and route-table scope, security-group
  direction/protocol/port/CIDR constraints, broad sensitive ingress, Lambda
  subnet/security-group/ENI-permission requirements, and unresolved paths with
  no invented fix;
- NAT hourly/data-processing and cross-AZ warnings, multi-AZ recommendations,
  explicit Terraform/CloudFormation target limits, and configured organization
  policies; and
- exact `0.9.0` to `0.10.0` migration, current artifact digest/readiness,
  historical artifact immutability, deterministic regeneration, and mapping
  projection-contract validation.

The Go compiler's focused networking suite covers the public `Compile` path and
the direct renderer with two synthetic architectures: a two-AZ public/private
layout and a low-cost, NAT-free endpoint-based serverless layout. Assertions
parse every emitted `.tf` file with HashiCorp HCL and verify deterministic
references, stable address namespaces, configured variables and outputs,
canonical-order reproducibility, and separation of user-owned endpoint policy
from generated policy provenance. Exact output checks include:

- `aws_vpc`, `aws_subnet` with VPC ancestry and Availability Zone,
  `aws_route_table`, `aws_route`, `aws_route_table_association`, and exact
  internet-gateway attachment;
- public zonal `aws_nat_gateway` with caller-supplied allocation ID and no
  generated `aws_eip`;
- S3/DynamoDB `aws_vpc_endpoint` service names and selected route tables, plus
  an optional canonical user-owned resource policy;
- `aws_security_group` with explicit empty inline egress and standalone ingress
  and egress rule resources; and
- sorted nested Lambda `vpc_config` references and an explicit user-owned
  `AWSLambdaVPCAccessExecutionRole` attachment dependency.

Negative compiler cases reject unsupported IPv6, missing same-VPC internet
gateway for public NAT, missing Lambda ENI permission, wrong endpoint-policy
service or ownership, absent endpoint-policy principal, forged resource type or
semantic parent/port, duplicate relationship pairs, legacy-only policy action
expansion, and every unsupported catalog pin. Rejection returns diagnostics and
no partial artifact.

Application/workload evidence is deliberately separate from source generation.
`reachability-binding.test.ts` binds only exact catalog `0.10.0`, derives
source-referenced object-storage, key-value, or internet-egress assumptions from
normalized network facts, keeps absent paths unresolved, rejects tampered
artifacts, and proves order stability. Its source-preservation case compares the
existing generated application bytes before and after network projection and
proves that subnet, endpoint, NAT, and security-group identifiers are not copied
into source. `reachability-evidence.test.ts` proves that
endpoint-versus-reviewed egress changes the data-only smoke/Evidence
configuration while build network and source inspection stay denied; the
configuration runs no probe and creates no Evidence.

Architecture-as-code, CLI, and CI fixtures add both endpoint and NAT repository
layouts, deterministic verify/diff expectations, an exact no-credential GitHub
Actions workflow, and sanitized fake Terraform plan JSON. Tests prove semantic
diff classification, sensitive-value redaction, plan binding/integrity, and no
default-branch/cloud mutation. Fixtures contain no provider credentials, raw
state, customer data, or executable repository script path. The Terraform
validation-runner remains the established isolated validation boundary; these
fixtures do not add plan/apply or cloud authority.

The additive model-evaluation v2 dataset binds the exact `0.10.0` catalog and
contains five networking scenarios: private database reachability, avoid NAT,
invalid CIDR, broad ingress, and multi-AZ requirements. Deterministic authority
checks require every proposed networking operation to use catalog-approved
services, relationships, configuration schemas, and exact source evidence;
ungrounded or unsupported output fails rather than expanding the catalog.
Historical v1 evaluation bytes and results remain independently reproducible.

Focused AWS networking generation source evidence lives in:

- `packages/provider-aws/src/networking-catalog.test.ts`,
  `networking-validation.test.ts`, `networking-policy.test.ts`, and
  `catalog/migrations/terraform-networking-0-9-to-0-10.test.ts`;
- `services/iac-compiler/terraform_networking_test.go` plus catalog
  compatibility and legacy Terraform suites;
- `packages/application-generator/src/reachability-binding.test.ts` and
  `packages/application-build-runner/src/reachability-evidence.test.ts`;
- `packages/architecture-cli/src/networking-repository-e2e.test.ts`,
  `packages/customer-ci-workflow/src/networking-plan-fixtures.test.ts`, and the
  Terraform-validation-runner fixture suites; and
- `packages/model-gateway/src/networking-evaluation-v2.test.ts` plus the exact
  generated `evals/datasets-v2` authority and dataset checks.

A local Terraform binary can run `terraform fmt -check` without plugins. Full
`terraform validate` requires an initialized `hashicorp/aws` provider; when no
reviewed offline provider mirror is available, provider initialization and
validation are unavailable and must not use network access. In that environment,
the accepted local evidence is `terraform fmt -check` for repository fixtures
plus HashiCorp HCL parsing of every generated `.tf` file. These checks are not
relabeled as provider-backed `terraform validate`.

Prompt-boundary aggregate and final gate results belong in STATUS and HANDOFF
after closeout. This section records the focused evidence and required
boundaries; it does not predeclare the root `pnpm check`, a complete release
gate, live Terraform provider validation, AWS execution, plan/apply, or
deployment as passing.

<a id="prompt-44-aws-event-driven-catalog-verification"></a>

## AWS event-driven catalog verification

AWS event catalog is provider-contract work only. Exact catalog `0.11.0` must
compile deterministically to its pinned digest while the checked exact `0.10.0`
artifact continues to compile to its historical digest. The migration accepts
only that exact source artifact and rejects a current or tampered artifact
rather than silently repinning it.

`event-driven-catalog.test.ts` owns the focused cross-contract evidence. It
asserts the exact 12-service addition and official icon IDs; bounded schemas,
defaults, unsupported advanced modes, and metadata-only Terraform/
CloudFormation declarations; all 35 additive connection rules and resolver
registrations; stable lifecycle/provenance; wildcard-free IAM effects and
reviewed questions; exact owned slots and pending target readiness; and the nine
unique Workload operation/event-contract metadata records. The provider suite
continues to assert every service port has one stable presentation dock and
every relationship has one concise label.

Synthetic validation graphs cover a Lambda/SQS event cycle, FIFO DLQ mismatch,
and duplicate S3 notifications in the focused test. The complete validation
fixture suite exercises every registered descriptor deterministically, while the
event rules additionally cover S3 default EventBridge-bus selection, queue FIFO
naming and deduplication, SNS protocol/filter/raw-delivery compatibility,
EventBridge target/DLQ/retry bounds, producer ordering, SQS visibility versus
Lambda timeout/batching, and Standard Step Functions retry/timeout conflicts.
Unsafe topology, permission, retry, ordering, filter, and destination choices
have no automatic fix.

Provider extension tests prove the exact S3, SQS, SNS, EventBridge, and IAM
resource-policy owner slots and keep every event Terraform/CloudFormation target
`pending`. Icon checks require every catalog icon ID to resolve through the
canonical manifest; six event-family placeholders remain explicit until
separately reviewed official bytes are admitted. No test may treat a
placeholder, mapping resource name, or workload metadata record as compiler, UI,
or application-rendering evidence.

The focused provider source suite currently passes 15 files and 114 tests.
Prompt closeout additionally requires regenerated-artifact drift checks,
`catalog:check`, the contracts workstream gate, `security:check`, one final root
`pnpm check`, formatting/diff hygiene, and an exact worktree review. Results and
any unavailable external evidence belong in STATUS and HANDOFF; this strategy
does not predeclare compiler rendering, provider-backed validation, cloud
execution, deployment, or event infrastructure behavior.

<a id="prompt-45-event-infrastructure-verification"></a>

## Event infrastructure verification

Event infrastructure promotes exact catalog `0.12.0` event Terraform readiness
only where the Go compiler has matching renderer, negative, HCL-parse,
reproducibility, and golden evidence. Focused cases cover S3 bucket
notifications, SQS redrive/DLQ and Lambda event-source mappings, SNS
subscriptions, EventBridge schedules/ rules/targets, Standard Step Functions
with Lambda tasks and logging, Lambda permissions, and the required
identity/resource policies. They prove typed HCL references supply ordering
without arbitrary `depends_on`, custom and generated policies remain separate,
and unsupported cycles, direction, FIFO, filters, permissions, retries, and
modes return source-linked diagnostics with no partial artifact.

Shared editor tests cover every event connection entry point, stable grouped
docks, readable fan-out, previewed generated resources/policies/retry/DLQ facts,
concise delivery/duplicate/ordering/cost guidance, and identical semantic
structure in Guided and Professional modes. Template tests bind the four
reviewed graphs without handler source. Repository, CLI, workflow, sanitized
plan-diff, deterministic model-evaluation v3, and E2E cases remain
credential-free and preserve designed/imported/generated/planned/deployed
separation.

<a id="prompt-45a-deterministic-event-application-verification"></a>

## Deterministic event application verification

Event application generation binds exact catalog `0.13.0` and the reviewed
generator, template, pattern, dispatcher, runtime, and artifact descriptors.
Generator goldens and virtual TypeScript compilation cover all six complete
patterns, explicit trigger dispatch, typed S3/SQS/SNS/EventBridge/Step Functions
envelopes, local fixtures, environment bindings, structured correlation logging,
extension points, and absence of embedded secrets or invented transforms.
Negative cases cover implicit/mixed dispatch, unsupported filters and
operations, missing contracts or permissions, unsafe paths, ownership conflicts,
and incomplete coverage downgrade.

Generated application tests cover batch processing, SQS partial-batch failure,
duplicate delivery and idempotency hooks, metadata extraction, retry/DLQ and
timeout awareness, filtering, task input/output, and independent fan-out
handlers. The reviewed isolated workload build integration materializes the
exact generated tree, type-checks and runs its unit/contract tests offline,
scans it, and produces a deterministic per-workload ZIP, SBOM, target-neutral
artifact manifest, and Evidence. Multi-workload orchestration validates the
entire canonical batch before serial execution, rejects
omissions/extras/duplicates/ identity or path collisions, and blocks publication
unless every build passes.

Compiler and export tests rejoin each final ZIP/checksum/manifest to the exact
workload, generation artifact, build contract, Solution Revision, and Evidence
without reading source or changing graph-derived IAM. CLI semantic-diff tests
classify event-contract, filter, retry, DLQ, batch-response, runtime, and
handler changes. The credentialless repository PR workflow builds/tests handlers
and verifies manifest-bound artifacts. Generated customer PR workflows instead
validate sealed isolated workload build ZIP/Evidence commitments and bounded
smoke metadata; they do not execute or rebuild handler source. Generated
plan/deploy workflows expose only declarative, checksum-bound smoke-test
extension points.

The v4 deterministic model dataset has one accepted typed-design case for each
complete pattern and exact invalid cases for recursive S3 notification, wrong
SQS direction, missing permission, FIFO mismatch, unsupported filters, and
unbounded retry. It contains no handler source and cannot establish support or
activation. Full command results belong in STATUS and HANDOFF; these tests never
claim provider-backed Terraform validation, credentials, cloud execution,
repository synchronization, plan/apply, or deployment.

<a id="prompt-46-deterministic-cloudformation-verification"></a>

## Deterministic CloudFormation verification

CloudFormation generation binds exact AWS catalog `0.14.0` to a second
deterministic IaC target for the initial API Gateway, Lambda, DynamoDB, Cognito,
IAM, and CloudWatch family. Go compiler tests parse every emitted JSON template
and cover exact goldens, semantic resource and intrinsic assertions, stable
logical-ID collision handling, layout/input-order independence, reproducibility,
parameters, outputs, tags, generated/custom IAM, trust and invocation
permissions, managed attachments, permissions boundaries, application artifact
references, NoEcho secret parameters, sensitive-output rejection, and
source-linked unsupported target diagnostics.

Cross-target tests prove the same normalized revision and isolated workload
build artifact contract feed Terraform and CloudFormation, while existing
Terraform goldens remain unchanged. Application-generator tests prove exact
catalog `0.14.0` reuses the existing deterministic application generation /
event application generation source bytes and tests rather than introducing a
target-specific generator. Target-neutral coverage remains unchanged unless the
selected target rejects an infrastructure requirement.

Export, workflow, API, UI, CLI, and CI tests cover the CloudFormation media
type, manifest/README inventory, exact target-specific external-stage status and
Evidence, offline structural validation, prohibition on invoking the Terraform
validator for a CloudFormation run, target semantic diff, identical assistance
mode structure, approved UI target selection, CLI forwarding, and the fixed
credentialless repository verification command. Malformed JSON/resources,
foreign validator identity, wrong-target Evidence, unknown profiles, secret
content, and unsupported networking/event resources fail closed.

Formatting and local validation use structured JSON encoding plus the internal
allowlisted validator; no test claims AWS `validate-template`, packaging,
artifact upload, provider initialization, change-set creation, stack execution,
credentials, or deployment. Generated customer plan/deploy workflows remain
Terraform-only. Full gate results belong in STATUS and HANDOFF.

<a id="prompt-47-curated-cloudformation-verification"></a>

## Curated CloudFormation verification

Curated CloudFormation support binds exact AWS catalog `0.15.0` and promotes
only the reviewed networking/eventing mappings backed by the structured
renderer. Compiler fixtures cover the notes API, two-AZ public/private network,
endpoint-based serverless network, image-processing pipeline, SNS fan-out,
scheduled workload, SQS consumer/DLQ, EventBridge event target, Step Functions
tasks, and invalid or unsupported target cases.

Cross-target semantic assertions compare architecture resource intent, graph-
derived IAM and resource policies, VPC ancestry and Lambda attachment, S3 key
filters, EventBridge event patterns, retry/DLQ and partial-batch semantics,
variables/parameters, outputs, tags, custom/generated policy ownership, event
application ZIP/checksum references, generation coverage, and declarative
smoke-test metadata. Tests compare semantics rather than requiring identical
syntax or file layout. They explicitly admit native target differences:
CloudFormation embeds selected owned configurations, parameterizes S3 object
coordinates, references the default EventBridge bus without creating it, and
uses only reviewed explicit dependency gaps.

Negative cross-target cases prove unsupported filters, interface endpoints,
FIFO/DLQ mismatch, recursive event flow, wrong direction, missing permissions,
unbounded retries, ambiguous target modes, schema/key/version drift, sensitive
outputs, and unsupported resources return target-specific source-linked
diagnostics and no partial artifact.

Catalog migration/reproducibility tests preserve every historical digest and
Terraform golden. CLI, solution export/workflow, API, ZIP/GitHub, UI, fixed
repository CI, application generator/build, deterministic evaluation, and E2E
tests verify target selection and evidence propagation. Credentialless checks
may parse/build/test/compare local artifacts only. They do not invoke AWS,
providers, package/upload, change sets, stacks, plan/apply, repository-selected
commands, credentials, or deployment. Privileged generated plan/deploy workflows
remain the separately reviewed Terraform-only profile.

<a id="prompt-47b-continuous-conformance-verification"></a>

## Continuous conformance verification

Continuous conformance tests the six evidence projections as independent,
revision-bound inputs rather than one mutable graph. Schema and domain suites
cover exact matches; every resource, connection, configuration, generation,
plan-operation, IAM, public-exposure, ownership/import, application-binding,
managed/unmanaged drift, and stale/partial/unknown difference class;
deterministic digests and ordering; Active Issue creation; evidence expiry; and
the rule that incomplete evidence cannot prove absence.

Adapter parity fixtures prove that exact Cloud Markup design, generated, and
repository projections use the same complete, versioned semantic comparison
basis. Source-specific, inferred, partial, and operation-only digests must yield
unknown evidence rather than false equality or inequality.

Repository and workflow suites normalize pinned Repository Snapshots,
generated-file ownership, approved extension points, sanitized Terraform plan
JSON, sanitized CloudFormation change-set representations, exact saved-plan or
change-set deployment identities, smoke results, and read-only drift. Negative
fixtures cover commit, checksum, manifest, backend/workspace or stack, tool,
expiry, workflow, environment, artifact, and smoke mismatches; sensitive-value
redaction; duplicate/out-of-order inputs; generated-file edits; and prohibited
automatic overwrite or remediation. Fake GitHub adapters may record one
reviewable issue or reconciliation-PR request but cannot write a branch, merge,
approve, deploy, or mutate cloud state.

API tests prove project authorization precedes tenant-scoped evidence access,
route/report binding is exact, nested difference and Active Issue digests are
verified, and cross-tenant or malformed evidence fails closed. CLI tests use an
explicit read-only adapter and emit only bounded report identities, layer
quality, counts, and a semantic-difference exit status. Diagram and web tests
cover all six controls plus Differences, mapped-only inventory, unmapped
Evidence, provenance, stable export intent/artifacts, stale or unavailable
states, explicit environment selection, exact Solution Revision requests, and
identical controls in Guided and Professional modes.

Credentialless verification may parse, compare, render, and validate only
sanitized local artifacts. Tests do not invoke Terraform providers, AWS,
customer roles, live GitHub writes, model access, plan/apply, change-set
creation/execution, stack deployment, or drift remediation. Aggregate gate
results belong in STATUS and HANDOFF after closeout. The focused repository gate
is `pnpm check:e2e:continuous-conformance`; the required aggregate remains one
final `pnpm check` invocation.

<a id="prompt-48-controlled-beta-security-verification"></a>

## Controlled-beta security verification

Controlled-beta security uses the version-pinned OWASP ASVS 5.0.0 Level
2-oriented matrix as a traceability aid, not a certification claim. Automated
evidence is limited to the exact repository boundary exercised; browser/session
policy, deployed edge behavior, tenant penetration testing, data-retention
decisions, recipients, thresholds, recovery, and incident drills remain manual
or blocked evidence.

API tests assert strict no-store, CSP, HSTS, content-type, frame, referrer,
permission, opener, and resource headers on success and error paths. Deployment-
shell Lambda tests reject missing, malformed, and mismatched CloudFront origin
markers, admit only the exact bounded marker, emit a fixed content-free denial
event, and prove the marker is not logged. Support tests prove permission and
exact-organization scope before any adapter access and keep card data, secrets,
prompts, provider bodies, and repository content out of views and audit events.

Platform environment and CDK assertions cover lower-only configuration, one
generated retained Secrets Manager origin value with no output or operator
input, dynamic API/billing/CloudFront bindings, feature-gated CloudFront WAF
rate controls, API/worker/CodeBuild concurrency, security headers, X-Ray, safe
metric filters, alarms, dashboards, budget and cost-anomaly hooks,
least-privilege IAM, and the platform/customer-IaC separation. Bundle-size
assertions prevent shared runtime constants from pulling CDK into Lambda
artifacts. Synthesis remains credentialless and proves no deployment or live
control.

`pnpm security:static` runs bounded Node tests plus deterministic policy checks
over repository workflows, the generated validation template, actual
generated-owned application-source goldens, and curated checked-in Terraform
roots. It rejects unreviewed runners/actions, unpinned actions, privileged PR
triggers/permissions/credentials, remote shell download, deploy commands,
arbitrary Terraform execution/external-state constructs, embedded credentials,
and generated-owned source process/dynamic-evaluation primitives. This is a
curated forbidden-pattern gate, not broad language-aware SAST or general IaC
certification. The bounded secret scan fails closed on oversized text,
recognizes reviewed credential families, reports explicit binary skips, and
permits only digest-bound fake fixtures. Generated PR validation separately
scans exact manifest/checksum-bound source; its inline scanner invokes no
network client, credential, repository-selected command, build, or test,
although the GitHub-hosted runner and pinned actions use ordinary network
access. Plan/drift temporary bytes use restrictive permissions and unconditional
cleanup.

Focused API, platform, customer-workflow, scanner, workflow, and static tests
run before the workstream gates. `pnpm security:check` includes the
registry-backed dependency audit. The prompt boundary invokes `pnpm check`
exactly once, records every failure/skip without relabeling it, inspects the
final diff, updates STATUS and HANDOFF, and stops before beta usability and
reliability. No test may deploy, apply, create or execute a change set, use
customer/cloud credentials, create a charge, invoke a live model, mutate a live
repository, or remediate drift.

<a id="prompt-49-beta-usability-accessibility-performance-and-reliability"></a>

## Beta usability, accessibility, performance, and reliability

Beta usability and reliability component tests prove that the Architecture
list's visible directional movement controls use the same versioned
command/session path as other movement and that Change boundary opens the shared
Configure placement section. The conformance workspace test proves its SVG
title/description and sanitized list alternative for resources and connections.
CLI transport tests pin the explicit human no-deployment line while preserving
exact JSON output.

The editor performance test builds exact catalog-bound 25, 100, and 500-node
documents and measures projection, selection, one real Graph Command, draft plus
compilation validation, canonical serialization/hash preparation, and layout-
request creation. It asserts semantic correctness and only a broad stuck-
operation ceiling; logged milliseconds are non-gating. Go compiler and
application-generator small/medium baselines remain deterministic output tests,
and the artifact-size script reads only known build roots, rejects symlinks and
outside-repository targets, and emits stable JSON.

`pnpm performance:beta` builds first, inventories build outputs, runs the Go
golden benchmarks, and runs editor/application-generation baselines. It uses no
credentials or network and performs no apply, change-set, deployment, live
provider, or repository operation. The reported baseline distinguishes
serialization from persistence, request creation from ELK execution, model
selection from browser paint, and correctness tests from unmeasured latency.

Reliability evidence reuses owning subsystem tests for interrupted autosave,
recovery, stale sessions/CAS, job backoff/lease recovery, exact catalog/schema
migrations, partial API errors, Stripe/model/GitHub failure, compiler/build/
diagram failure, stale billing/plan/deployment/drift evidence, and no automatic
remediation. Live outage, browser/assistive-technology, production-load, and
operator-drill results remain manual, never inferred from a fake adapter.

Authoritative reports are the beta accessibility checklist, novice and
professional usability reports, performance baseline, and known limitations.
