# User Workflows

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

These ten workflows are the canonical product runbook. Their identifiers map
directly to numbered milestones in the [Build Sequence](../PUBLIC_STATUS.md).

## Shared interaction rules

- Every user-visible architecture is a view of a typed graph.
- AI suggestions, connection wizards, and direct manipulation produce the same
  class of validated graph operations.
- The UI shows whether work is a mutable draft, an immutable revision, or a
  generated artifact.
- Async operations expose pending, succeeded, failed, canceled, and retryable
  states without fabricating success.
- Guided and Professional modes share one component tree, controls, dimensions,
  fields, source documents, commands, validation, generation, evidence, and
  workflow. Only wording, contextual education, recommendations, and optional
  technical disclosure may vary.
- Switching modes preserves mounted interaction state, every source document,
  in-progress draft data, and proof status.
- Narrow screens prioritize review, comments, findings, explanation, and export
  status; precision editing remains desktop-first.
- Authorization failures reveal no cross-tenant resource details.
- The UI keeps designed, imported, generated, planned, deployed, and current
  drift layers visibly distinct.
- Repository observations and model output are proposals or evidence. They do
  not mutate approved design.
- Accepted reconciliation changes use the existing versioned deterministic
  command or typed operation with exact preconditions.
- One Issues workspace may project multiple issue sources, but it preserves each
  source, affected reference, state, provenance, and closure evidence.
- Evidence always names its exact level and staleness; a lower level never
  implies a higher one.

See
[Solution, Repository, and Continuous-Evidence Contracts](../architecture/SOLUTION_REPOSITORY_AND_EVIDENCE.md).

## WF-1 — Create a project

**Entry:** An authenticated organization member chooses **New project**.

**Flow:**

1. The user selects prompt, template, or blank canvas.
2. The product records the project name and allowed initial metadata.
3. The API derives organization and user identity from verified authentication
   context.
4. A project and initial draft are created atomically or fail without a partial
   visible project.
5. The user enters intent review or the canvas, depending on the selected path.

**Failure behavior:** Validation errors preserve safe input. Authorization,
quota, and infrastructure failures do not create orphaned cross-tenant data and
provide a retryable or terminal explanation.

## WF-2 — Extract and review intent

**Entry:** A user submits a natural-language application or workflow
description.

**Flow:**

1. The product sends only the necessary, policy-allowed context through the
   model gateway.
2. The model returns a versioned, schema-constrained intent proposal.
3. Deterministic validation rejects malformed or disallowed content.
4. The UI separates requirements, assumptions, unresolved questions,
   nonfunctional constraints, data sensitivity, availability, and cost
   preferences.
5. The user edits or confirms the proposal before it becomes project intent.

**Failure behavior:** The original draft remains usable. Schema failure, model
refusal, timeout, and quota exhaustion are distinguished. Raw model output is
not applied.

## WF-3 — Propose an AWS deployment graph

**Entry:** Reviewed provider-neutral intent is ready for architecture proposal.

**Flow:**

1. The model gateway receives reviewed Intent, the current design, only the
   relevant versioned catalog/connection/placement/policy slice, exact
   validation and target-readiness metadata, and explicit operation limits.
2. When the user approved repository import evidence, the request may also carry
   only the relevant sanitized evidence and exact deterministic reconciliation
   operations.
3. The model proposes strict graph and complete Workload/Application Contract
   operations, typed External Resource References, assumptions/questions,
   generation coverage, test scenarios, evidence-bound reconciliation
   suggestions, rationale, and rejected alternatives.
4. Deterministic domain and AWS-provider validation stages every operation on a
   detached candidate and rejects unknown services, fields, ports, operations,
   policy kinds, references, unsupported targets, and failed rules.
5. Blocking ownership, location, endpoint, authentication, or import decisions
   become user questions and Active Issues; authentication asks for secret
   references, never values.
6. The UI presents the review candidate, rejected diagnostics, assumptions,
   unresolved gaps, coverage, tests, and provenance without changing the
   canonical draft.
7. Only an explicit later user acceptance may apply still-valid versioned
   operations to the current draft in deterministic order.

**Failure behavior:** Unsupported services or relationships remain explicit
gaps. The system never substitutes unreviewed resources or treats partial
application as a complete proposal.

## WF-4 — Edit the architecture

**Entry:** The user opens a project draft.

**Flow:**

The compact editor header keeps **Undo**, **Redo**, **Commands**, **Canvas**,
and **Help** immediate. **Canvas** contains arrange, fit, and architecture-list
actions; the canvas itself keeps direct zoom and minimap controls.

1. The user browses catalog-derived placement groups or searches the document's
   exact version-bound service catalog by service name, identifier,
   catalog-provided aliases when present, or catalog-authored plain-language
   education and capability terms. Local Recently used entries and an explicit
   Details preview help compare placement, defaults, Region, support, cost, and
   security facts before adding an item; this presentation state does not enter
   the document.
2. Pointer drag, keyboard activation, and an explicit Add action express the
   same service-creation intent. Provider placement rules choose valid semantic
   parents; drop or automatic coordinates affect presentation only. On phones,
   Add uses automatic placement and precision drag remains a tablet/desktop
   canvas action. When the catalog becomes a responsive drawer, its result and
   detail/diagnostics regions scroll within the bounded drawer rather than
   lengthening the architecture workspace.
3. The user may collapse a service to its icon and configured name to make room
   for the architecture, then expand it from the bottom arrow when exact groups
   are needed. Inputs remain on the left and outputs on the right. Hover or
   keyboard focus names each visible group or compact aggregate.
4. The user changes configuration, moves nodes, creates typed connections, or
   removes elements. Double-clicking a service opens Configure; selecting a
   connection dot opens its information beside the owning service.
5. A command translates each semantic intent into one or more graph operations.
6. Domain validation checks preconditions and invariants.
7. The accepted operation updates the local draft immediately and enters the
   autosave queue.
8. The user may undo or redo commands while their preconditions remain valid.
9. Server acknowledgement or conflict handling reconciles the persisted draft
   version.
10. The user may switch between Guided and Professional presentations without
    converting the document or losing advanced values.

**Current bounded M1 editor foundation:** The compact global header, full-canvas
editor, persistent resizable Catalog, fixed 92px right Inspector launcher, and
fixed 48px bottom Workspace launcher form one shared control tree in both modes.
Architecture, Configure, Connect, Learn, IaC, Assistant, Issues, Code, Activity,
and Jobs open through one shared rich popup, one destination at a time.
Architecture is its own list/tree destination. Rich popups use an opaque compact
surface, restrained drop shadow, padded Close action, internally scrolling
content, 160ms open/close motion, and immediate reduced-motion behavior. Tablet
and phone keep the existing drawer, sheet, and list-first semantics.

Every service projection can collapse to a 176-by-72 node containing its icon
and configured name. A bottom arrow expands it. The compact state shows at most
one aggregate input dot on the left and output dot on the right while preserving
every exact grouped handle and port identity at those anchors. Expanding
restores all group dots. Hover or focus exposes input/output names; activation
opens group information beside the owning service. Double-clicking the service
body selects it and opens Configure. These interactions are session-only
presentation state and do not change commands, history, hashes, compiler input,
or IaC addressing.

Selecting a catalog-described node or typed edge populates the same Inspector
destinations. Configure derives its required, optional, enum, numeric, boolean,
list, and reference presentation from the exact catalog configuration schema and
curated UI hints. It preserves non-edited forward-compatible values, validates
the full record through the catalog, and prepares an exact-preconditioned
`update-node-configuration` or `update-edge-configuration` Graph Command for
review before a separate Apply action. Sensitive IaC values are tagged variable
references; literal cloud credentials are neither accepted nor displayed.
Connect reports existing typed endpoints and the exact relationship descriptor's
questions, supporting resources, lifecycle, and permission effects. Drawing
between ports, the node toolbar, the Connect destination, and keyboard actions
enter one deterministic resolver-backed workflow. Compatibility, direction,
ambiguity, defaults, strict configuration, permission effects, generated
resources, and edit behavior come from the exact version-bound connection
engine. The editor applies only the unchanged, explicitly confirmed atomic Graph
Command preview; cancellation is a no-op.

Lambda actions are capability-based and categorized rather than target-service
handles. One function may retain compatible API invocation, separate data read
and write dependencies, its exclusive execution role, canonical logging, and
other supported edges simultaneously. Aggregate port and rule source/target/pair
limits remain explicit; duplicate nonexclusive behavior is decided by the rule,
not a global endpoint-pair ban. Configure/Implementation projects the exact
Workload Behavior record and missing decisions without generating source. Learn
renders catalog-authored education and HTTPS official-documentation metadata as
safe text and links. IaC reports target mapping status and property/port
bindings as metadata-only preview descriptions; it does not generate code.
Inspector form buffers, connection drafts, popup destinations, disclosures,
service collapse, selection, report navigation, warning review, and mode remain
local presentation state. Prepared resolver results and validation reports
remain in the document session rather than Zustand. Bounded Graph Command
history supplies atomic undo/redo, while a development-only IndexedDB adapter
supplies observable local recovery and stale-tab protection. Neither is
backend-authoritative persistence, conflict reconciliation, an immutable
revision, compiler input, or deployment state.

**Failure behavior:** Invalid catalog records, unsupported entries, missing safe
defaults, ambiguous or unavailable parents, invalid drops, and incompatible
connections remain visibly unavailable where safe and explain why no command
runs. They do not change the document. Unknown Region availability and
metadata-only IaC mappings remain explicit rather than becoming support claims.
Stale writes do not silently overwrite newer drafts. Visual placement and
movement change layout metadata only.

## WF-5 — Complete a connection

**Entry:** The user starts a supported connection between typed ports.

**Flow:**

1. **Set up connection** identifies one compatible relationship and separately
   checks capability-port, rule-source, rule-target, and endpoint-pair
   cardinality. The user completes the shared ordered fields, recommendations,
   and validation.
2. **Review and connect** explains data flow and consequences, then previews
   direct and supporting Graph Commands, deterministic IAM requirements,
   provenance, findings, and the atomic **Connect** action.
3. The same **Technical details** disclosure exposes exact authorized rule,
   port, identifier, command, and diagnostic evidence in both modes.
4. Domain logic applies all operations atomically and records provenance for
   generated elements.

**Current bounded M1 evidence:** The local editor supports exact port drawing,
node-toolbar, the Connect popup, Architecture-list actions, and keyboard
initiation. Expanded nodes expose exact grouped dots. Compact nodes retain those
exact handles while showing no more than one input and one output aggregate;
hover/focus names them, and activation opens adjacent information without moving
an endpoint or changing a hash. Both modes render the same two stages, fields,
order, validation, actions, shortcut, and **Technical details** disclosure from
one component tree. Guided may add plain-language purpose and consequence copy;
Professional may use concise exact terminology in the same assistance slots. A
mode switch preserves the mounted dialog and draft. Existing generated
connections can be edited through one provider-owned atomic batch that preserves
stable direct/supporting graph identities and updates configuration-dependent
permissions. This evidence is bounded to implemented rules in the exact local
catalog and does not imply persistence, cloud access, compilation, or
deployment.

**Failure behavior:** No partial integration survives a failed transaction.
Later deletion shows whether generated elements are still shared, user-adopted,
or safe to remove. Duplicate exclusive associations fail clearly. Multiple
compatible triggers retain separate configuration and provenance; heterogeneous
trigger contracts without an explicit supported dispatcher warn on drafts and
fail closed for revision/compilation. Both modes expose the exact evidence and
recommend separate functions rather than guessing an event type; only the
assistance wording differs.

## WF-6 — Inspect boundaries and associations

**Entry:** The user views or rearranges a graph involving networking or identity
constructs.

**Flow:**

1. The canvas may render VPCs, Availability Zones, and subnets as semantic
   visual boundaries.
2. The UI renders security groups, IAM roles, route-table associations, and
   managed-service links with association-specific visuals.
3. Inspectors explain the difference between placement, membership, attachment,
   permission, and data flow.
4. Automatic layout preserves semantic boundary membership while remaining
   presentation-only.

**Failure behavior:** The product does not imply physical containment when AWS
semantics do not support it. Ambiguous relationships must be resolved before
revision readiness.

## WF-7 — Validate the draft

**Entry:** Validation runs incrementally during editing or explicitly before
revision.

**Flow:**

1. Structural checks run against graph invariants.
2. Provider checks evaluate curated AWS constraints and required configuration.
3. Networking, security, availability, cost-sensitive, and IaC-readiness rules
   evaluate the affected graph.
4. Findings appear with stable identifiers, severity, location, rationale, and
   remediation.
5. The user navigates from a finding to the relevant element and applies a fix
   manually or through a previewed deterministic operation.

Later compiler, parser, application build/test/security, AI extension,
repository mismatch, cloud-plan, deployment/smoke, and drift diagnostics may be
referenced by versioned Active Issues in the same Issues workspace. They remain
separate source records, and a deterministic Validation Finding remains the
architecture-rule authority it is today. Resolving, accepting, deferring, or
marking an issue stale requires versioned lifecycle evidence; presentation
cannot close it.

**Current bounded M1 evidence:** The local AWS editor runs the exact
deterministic rule pack after meaningful document edits with a trailing-edge
debounce and on explicit request. Superseded generations are discarded; report
identity, engine, environment, provider, catalog, target, and content binding
must match before a result becomes current. Issues groups the canonical findings
by severity and every affected resource, filters without changing the report,
and focuses/highlights nodes, boundaries, edges, ports, or configuration fields
through the synchronized Architecture and Inspector popups.

Both modes show **What happened**, **Why it matters**, **How to fix it**, target
applicability, stable finding/rule identities, exact affected paths, and the
same **Technical details** disclosure in one order. Guided may add remediation
explanation; Professional may use concise exact terminology. A reviewed safe fix
exposes its complete preconditioned Graph Command batch and resulting hashes
before confirmation, applies atomically as one history entry, and remains
undoable/redoable. Warnings may be marked **Reviewed this session** without
suppression, reclassification, persistence, or a revision-gate claim. **Warning
acceptance** remains **Not available** while product-wide acknowledgement and
suppression policy is unresolved.

The browser-local readiness summary distinguishes structural validity, current
draft error/security findings, unavailable immutable-revision readiness,
metadata-only Terraform/CloudFormation target readiness, and session-local
warning review separately from unavailable warning acceptance. A complete
current local report is not universal security, compiler, cloud, or deployment
evidence. The synthetic notes fixture models an authenticated API architecture
in an explicitly unverified local mock shell.

**Failure behavior:** Validator failure is not reported as a clean graph. Stale
or incomplete findings remain review evidence only, readiness becomes
unavailable, and no safe fix can apply until a complete report matches the
current draft.

## WF-8 — Freeze and compile a revision

**Entry:** The draft satisfies revision gates and the user requests an
exportable revision.

**Flow:**

1. The server authorizes the request and revalidates the persisted draft
   version.
2. The system creates an immutable Solution Revision manifest that binds the
   exact Intent disposition/hash, Architecture revision and hashes, Workload,
   External Resource, and shared contract hashes, approved observation
   references, tool/policy versions, assumptions, unresolved decisions,
   generation coverage, source ownership, and freeze-time issue/evidence pins.
3. A compilation job references that revision by identity and content digest.
4. The standalone compiler validates its supported input and emits Terraform
   deterministically.
5. For an exact reviewed notes or curated-event workload/runtime/template, a
   separate deterministic generator may emit revision-bound source and tests
   from Workload Behavior and typed Application Contracts. It never guesses an
   event or business transform from prose. The IaC compiler neither invokes the
   generator nor consumes its source.
6. The artifacts record revision, compiler, catalog, workload, generator,
   template, dispatcher, build-contract, target-format, and final package
   metadata plus the content digests that actually apply. Multiple event
   workloads retain independent identities and packages.

**Failure behavior:** The system never compiles a mutable draft. Unsupported
schema or catalog versions, failed validation, or compiler errors produce no
successful artifact.

## WF-9 — Format and statically validate generated code

**Entry:** Deterministic IaC compilation and any separately authorized workload
source generation have produced candidate artifacts.

**Flow:**

1. IaC is copied into a fresh isolated IaC-validation environment.
2. An allowlisted IaC toolchain formats and statically validates those files.
3. Network, credentials, deployment commands, provisioners, and arbitrary
   executables remain unavailable.
4. Resource limits and timeouts are enforced.
5. Results, tool versions, logs safe for display, and final content digests
   attach to the artifact.
6. Supported application source enters the separate isolated, pinned runtime
   build/test/scan/package boundary once per eligible workload and produces its
   own Evidence, deterministic Lambda ZIP, SBOM, and target-neutral artifact
   manifest. The canonical aggregate batch passes only when every workload
   passes. Workload commands/scripts are never read from the Architecture
   Document, and the IaC runner cannot execute this path.

Each successful check publishes only its exact configured Evidence level,
Solution Revision, environment, tool/model versions, timestamps, checks,
findings, artifact hashes, safe CI identity, provenance, and redacted failures.
Structural or parse/static validity does not imply build/tests, plan,
deployment/smoke, repository conformance, or drift. An AI-authored custom
extension cannot reach validated coverage until every required check for that
coverage level succeeds and the user accepts it.

**Failure behavior:** Timeout, resource exhaustion, invalid output, and
infrastructure error are distinct. Validation failure blocks a “validated” label
but retains safe diagnostic evidence.

<a id="prompt-36a-custom-candidate-flow"></a>

### Custom-candidate flow

For supported behavior, **Generate** selects the deterministic compiler or
application generator and never asks a model to reproduce those files. For an
explicit `ai-assisted-custom` workload or approved IaC extension slot, the same
screen presents this exact flow:

```text
Generate
→ Check
→ Fix automatically where safe
→ Review remaining issues
→ Accept candidate
```

1. **Generate** sends the configured ModelGateway only the exact revision,
   requested behavior, editable owned paths, protected path/address metadata,
   contracts/bindings, allowed dependencies/providers/resources, reviewed
   schema/catalog slice, and sanitized preserved user file bodies only for exact
   owned paths, plus expected tests, limits, and validation policy. The response
   is a strict file/patch candidate with no write authority.
2. **Check** materializes bytes in a restricted content-addressed store and runs
   all applicable path/content/ownership/provenance, parse/static/security, and
   target-readiness checks. Application candidates additionally run the fixed
   isolated workload build, unit/contract tests, scans, package, and
   reproducibility checks. The coordinator awaits each bounded, sequenced live
   progress snapshot, so current, stale, and resolved issue history extends a
   verifiable prefix. Terminal generation seals that complete prefix, terminal
   result, and final Evidence/issues/history state immutably; edits later append
   separate revalidation authorities without rewriting the generation seal.
3. **Fix automatically where safe** distinguishes deterministic authority from
   AI proposals. The host authorization port must allow the exact
   `apply-deterministic-fix` action and canonical operation digest bound to
   organization/project, review, artifact, source revision, current issue
   record, and source hashes before the preconditioned Graph Command v1 batch
   runs. The result derives the reviewer from that decision and returns its
   decision ID plus an inverse. AI repair receives only relevant candidate
   sections and sanitized diagnostics for at most two configured, idempotent,
   metered attempts; it remains a proposal until the complete pipeline passes,
   and no rule or accepted estimate cap is weakened.
4. **Review remaining issues** uses the strict surface mounted on the existing
   artifact-review route. It shows plain-English issue summaries, next actions,
   assumptions, unresolved items, expected tests, and evidence state. Optional
   **Technical details** show files, ownership and digests, schema references,
   tool diagnostics, model/prompt provenance, and exact deterministic-operation
   or AI-proposal fix references. Ordered attempt summaries are privacy-safe and
   exclude raw provider-attempt prompts, responses, repair sections, secrets,
   and unrestricted diagnostics. The adapter rehashes the authorized review,
   inspection, replay, route, and candidate bytes and fails closed on stale or
   malformed input.
5. **Inspect or edit** first requires a host-owned authorization decision
   derived from verified authentication context and bound to the exact action,
   principal, organization/project, review, artifact digest, and source
   revision. Each artifact has one immutable review identity-and-digest binding;
   every action rejoins it, and edited lineage requires immutable historical
   reads of every predecessor binding, lifecycle, replay, and revalidation
   authority. An edit rehashes the owned content, reruns the complete validator,
   creates fresh Evidence/issues/review identity, and then atomically supersedes
   the exact current predecessor. The predecessor remains immutable and current
   after any failed or racing edit; successful repeated edits append exact
   authorization and per-file lineage. Each successful edit also appends an
   immutable authority over its decision, cumulative lineage, parent
   artifact/review/generation seal, validation, and monotonic Evidence,
   issue-history, and current-issue prefixes without changing the generation
   seal.
6. **Accept candidate** requires exact current-review authorization; rejection
   uses the same boundary. Both reread the current artifact and immutable review
   binding after authorization; concurrent supersession fails closed. Edited
   acceptance additionally rejoins every immutable predecessor and append-only
   revalidation authority. Acceptance then rechecks the source revision,
   restricted artifact bytes and digests, Evidence, ownership, issues,
   unresolved behavior, and ordered generation/repair provenance. It creates a
   distinct immutable successor Solution Revision and immutable export input
   containing the accepted AI extension contract record and exact user-edit
   lineage. It does not mutate the source revision, write or materialize a
   repository, plan, apply, create a change set, or deploy. Rejection creates no
   successor.

**Failure behavior:** Invalid paths or content; unknown dependencies, providers,
resources, or properties; deterministic collisions; missing tests; unresolved
behavior; scanner, build, or test failures; unsupported targets; stale authority
or review; repair exhaustion; or CloudFormation without exact reviewed readiness
remains a visible current or stale issue rather than disappearing. Missing exact
issue-linked Evidence prevents resolution. No stage writes a repository, mutates
the design, uses secrets or cloud credentials, runs Terraform plan or apply,
creates a CloudFormation change set, or deploys. Guided and Professional
preferences use the same mounted component tree and authority. The shared
Assistant coordinator adds the shared Assistant workspace and strict scoped
workflow ports; production database/job transport and operational hosting remain
separate.

## WF-9A — Seamless Assistant review

**Entry:** An authorized user supplies requirements or selects current design,
repository-difference, custom-generation, issue, or generated-resource context.

**Flow:**

1. The host derives exact scope, current revision, catalog/evidence/limit
   authority, idempotency key, and credit estimate. Denial or insufficient
   credit stops before model invocation.
2. The commercial service reserves once. The model may return only strict
   allow-listed graph/Assistant batches; whole documents and unknown operations
   are rejected.
3. Deterministic logic normalizes safe IDs, validates each operation, applies
   the entire batch to a detached candidate atomically, then validates the final
   candidate. Unrelated configuration, positions, ownership, and files remain
   unchanged.
4. One workspace shows requirements, semantic changes, observed-versus-designed
   repository state, custom generation, issues, progress, credits, and file/
   Evidence effects. Technical details reveal exact IDs, paths, policies,
   evidence, model/prompt versions, and validation deltas.
5. The reviewer may edit the strict operation batch or explicitly accept/reject.
   Every edit is reauthorized, compare-and-swap stored, and revalidated. Accept
   returns detached candidate/review state with no apply authority.

**Failure behavior:** Cancellation, denial, insufficient credit, unknown or
stale authority, invalid or partial atomic batches, ungrounded repository
evidence, or validation failure remains visible and cannot partially apply.
Duplicate retries replay the recorded result without another invocation or
charge. No repository, compiler, payment, GitHub, cloud, plan/apply, change-set,
or deployment action is available.

## WF-10 — Review and export

**Entry:** An authorized user selects one valid immutable Solution Revision,
environment, and approved target profile.

**Flow:**

1. The API reauthorizes project access, resolves the exact Solution Revision
   manifest record/digest and server-approved target policy, evaluates coverage
   and entitlement, fixes the previous-export baseline, and claims idempotency.
   It never accepts a mutable draft or tenant/hash authority from the browser.
2. A durable worker invokes IaC compilation, supported application generation,
   eligible isolated application build/test/scan/package, Terraform static
   validation, deterministic export packaging, independent verification, and
   content-addressed publication through separate typed boundaries.
3. One shared Guided/Professional screen shows server-paced progress, exact
   coverage, warnings and unresolved behavior, sanitized diagnostics, Evidence,
   ownership, source/IaC/application/test/build files, checksums, bounded text
   previews, manifest data, and semantic/file diff against the fixed previous
   export. Assistance mode changes help wording only.
4. Infrastructure-only output may succeed, but it clearly states that
   application code is required. A blocking compiler, generation, build/test,
   Terraform-validation, packaging, integrity, or security failure remains
   reviewable and produces no ZIP.
5. For successful output, the user requests a principal-bound short-lived grant.
   The authenticated download rechecks tenant, project, artifact, digest,
   retention, principal, and expiry and returns exactly the reviewed ZIP with
   safe private/no-store, disposition, type, length, and checksum headers.
6. Intentional reruns are distinct jobs with the same canonical input digest or
   explicit previous-artifact version; job/attempt/time data never change
   deterministic package bytes.

**Failure behavior:** Denied entitlement, unknown/mutable revisions, stage
failures, cancellation, expired artifacts/grants, integrity mismatch, and
cross-tenant selectors fail closed without hiding already valid diagnostics or
Evidence. No retry may switch revision, target, or baseline, double-enqueue the
same idempotent claim, or deploy. Diagrams, repository verification, and
optional customer-owned workflow files remain exact reviewed artifacts;
displaying or exporting them does not execute them or upgrade Evidence.

### GitHub export and customer-owned CI/CD continuation

**Entry:** An authorized administrator may create a short-lived, one-time GitHub
App installation link and explicitly continue to GitHub. A trusted callback
authority returns an opaque receipt; the browser removes it from the URL and
never submits an installation ID. An authorized editor then selects a verified
immutable export, linked installation, repository/base/destination/ feature
branch, Terraform target, diagram profile, and whether to include the five
approved customer workflow files.

If the trusted callback verifier is not composed, connection fails closed. The
user can still review existing linked installations according to organization
authorization; no numeric-ID fallback exists.

**Flow:**

1. The same Guided/Professional export workspace previews the complete source,
   application, infrastructure, diagram, contract, manifest/lock, Evidence,
   semantic, file, ownership, and previous-export differences. Technical details
   add exact paths, hashes, versions, IDs, workflow triggers/permissions/action
   pins, environment/ref mappings, OIDC subjects, role-variable names, and
   secret placeholders.
2. When workflow files are selected, the user previews and confirms all five
   exact `.github/workflows/cloudmarkup-*.yml` paths and digests. The GitHub App
   must already have Workflows write permission; Cloud Markup never expands it.
   Export without workflows remains available with a precise readiness warning.
3. The GitHub App adapter rechecks the base, files, artifact, ownership,
   permission, and preview before creating one feature branch, exact commit, and
   pull request. Safe retry reuses the same idempotency identity. It cannot
   update the default branch, merge, run a workflow, or deploy.
4. The customer configures separate GitHub Environments, approved refs,
   purpose-specific OIDC roles, Terraform backend/workspaces, protection,
   non-secret variables, and secret references for development, staging, and
   production. Pull-request validation remains credentialless.
5. For each environment, the customer runs a new plan, reviews its exact
   revision/commit/environment/backend/workspace/tool/lock/input/expiry
   manifest, approves deployment, applies only that saved plan without
   replanning, and retains the plan Evidence and deployment receipt. Deployment
   itself does not create canonical Evidence. Promotion repeats the sequence
   with a new target-environment plan and both predecessor deployment and
   passing smoke receipts; it never reuses the prior plan artifact.
6. Bounded smoke uses no cloud role and verifies the exact deployment receipt,
   commit, environment, Solution Revision, target authority, and reviewed
   endpoint digest. Refresh-only drift verifies the same deployment baseline
   before its read-only OIDC work. Optional ephemeral mode is unsupported and
   schema-disabled in v1.

**Failure behavior:** Missing or denied Workflows permission, stale
installation-link proof, expired/replayed link state, stale preview/base,
ownership conflict, changed file, revoked installation, protected branch,
invalid OIDC trust, absent approval, disabled environment, stale/tampered or
cross-environment plan, receipt mismatch, rate limit, or partial GitHub failure
fails closed with safe progress and idempotent recovery where possible. Cloud
Markup receives no installation token in the UI, customer credential, Terraform
state, approval, workflow-run, merge, or deployment authority.

**Activation boundary:** The generated validation workflow currently performs
inert package-integrity checks only and does not install or invoke Terraform.
Beta or production execution remains blocked until both the customer reviews a
published architecture CLI distribution, digest, installation procedure, exact
pipeline registration, and support policy and Cloud Markup can authoritatively
verify the selected GitHub Environment policy at the execution boundary.

## Repository observation and reconciliation lifecycle

**Entry:** A later authorized local-import or GitHub-synchronization capability
receives a bounded repository source and exact immutable revision.

**Flow:**

1. The importer records a Repository Snapshot with provider/integration or local
   source identity, exact commit, selected paths and ignore rules, file
   checksums, importer version, redaction/limit outcome, deterministic findings,
   detected types, evidence-linked inferences, and unsupported files.
2. Deterministic parsing and bounded inferences produce an immutable Observed
   Solution bound to that snapshot, including source locations, confidence,
   generated-file ownership evidence, external references, and conflicts with
   approved design.
3. The UI presents the observed layer beside, never merged into, the approved
   Architecture, Workload, External Resource, and Application Contract sources.
4. A Reconciliation Proposal offers explicit outcomes: accept through the
   reviewed deterministic operation, keep observed-only, mark external or
   unmanaged, regenerate to match design, ignore with reason/expiration, resolve
   ambiguity, or remove stale evidence.
5. Accepted design changes preserve stable identities where possible and apply
   only through exact-preconditioned domain commands or typed operations.

**Failure behavior:** Moving branches, oversized or redacted files, unsupported
formats, ambiguous mappings, changed design preconditions, ownership conflicts,
expired authorization, or snapshot mismatch fail closed without mutating
approved design. Repository credentials and secret values are never embedded.

**Current boundary:** repository import implements deterministic local
scanning/import, and GitHub import refresh implements exact-commit GitHub
acquisition, immutable snapshot history, bounded grounded application
interpretation, approved-diagram comparison, reviewed reconciliation, and
optional allow-listed push refresh. Continuous conformance adds a
tenant-authorized, revision- and environment-bound continuous conformance report
without merging those repository projections into approved design. Designed,
imported, generated, planned, deployed, and current-drift states retain separate
provenance, completeness, and freshness. Sanitized plan, deployment, and
read-only drift representations may be ingested as Evidence; Cloud Markup does
not run a plan, use customer cloud credentials, execute a change set, deploy, or
remediate drift. Repository changes remain explicit review actions or
feature-branch pull requests, never silent overwrite.

## Supporting commercial lifecycles

These lifecycle flows support the canonical workflows without creating a
separate architecture-editing model:

- An authorized organization owner enters Stripe-hosted Checkout or Customer
  Portal. Browser return state is informational; signed, idempotently handled
  webhooks update the local subscription projection that controls entitlements.
- Before model work begins, Cloud Markup atomically reserves Cloud Markup
  credits. Completion settles the reservation, failure or cancellation releases
  it, and a controlled process expires abandoned reservations without double
  charging retries.

The authoritative product rules are in [Commercial Model](COMMERCIAL_MODEL.md);
ownership and failure behavior are in
[Billing and Usage](../architecture/BILLING_AND_USAGE.md).

## M9 reviewed AI interaction update

New AI creation and canvas requests share context, generation and review stages.
The assistant can explain the current design, request missing details, propose
additions or suggest supported literal setting repairs. Current Issues findings
can prefill a request; generation still requires the user's action and follows
the same credit receipt and explicit review. Users inspect proposed settings
before/after, then assumptions, advisory checks and limitations before
acceptance. Acceptance is atomic and undoable; changed drafts require a fresh
review.

Optional AI application source uses immutable revision settings and workload
purpose, includes an advisory review and test plan, and requires external review
and tests. The UI must not imply it ran those tests. Every AI flow distinguishes
estimates, temporary holds, actual settled credits and released holds. New model
usage follows approximately 400 credits per USD4; retail purchases are separate.
[ADR-0066](../adr/0066-reviewed-canvas-ai-context.md) defines compatibility and
the plan records completion evidence.
