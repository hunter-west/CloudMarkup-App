# Product Specification

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

## 1. Purpose

Cloud Markup helps people turn application intent into an understandable,
editable, validated cloud architecture and deterministic Infrastructure as Code
(IaC), with declarative application behavior, explicit external-resource
authority, and continuous evidence for one immutable solution lineage. It
combines guided AI assistance with a responsive visual editor while keeping all
authoritative changes under deterministic domain control.

This specification states product requirements. System boundaries are defined in
[System Overview](../architecture/SYSTEM_OVERVIEW.md), domain semantics in
[Domain Model](../architecture/DOMAIN_MODEL.md), and first-release boundaries in
[MVP Scope](MVP_SCOPE.md). Audience, presentation, and device requirements are
owned by [Personas and Experience](PERSONAS_AND_EXPERIENCE.md); subscription and
entitlement requirements are owned by [Commercial Model](COMMERCIAL_MODEL.md).

## 2. Product outcomes

Cloud Markup should enable a user to:

- surface requirements, assumptions, unknowns, data sensitivity, availability
  needs, and cost preferences before treating a design as complete;
- understand a proposed architecture and the meaning of its relationships;
- edit an architecture without needing to author IaC by hand;
- discover structural, networking, security, cost-sensitive, and readiness
  problems early;
- freeze a reviewable architecture revision;
- distinguish approved design from repository observations, generated output,
  cloud plans, and deployed evidence;
- review repository differences without silently adopting them;
- track active issues and exact evidence without treating a lower verification
  level as a higher one; and
- receive reproducible, inspectable artifacts without granting Cloud Markup
  deployment access.

The product is not an autonomous cloud operator. It is an AI-native
Architecture-as-Code, education, validation, generation, and continuous
solution-verification system in which model output remains untrusted proposal
data. Canonical solution, repository, and evidence ownership is defined in
[Solution, Repository, and Continuous-Evidence Contracts](../architecture/SOLUTION_REPOSITORY_AND_EVIDENCE.md).

## 3. Intended users

### Learner

A user who needs plain-language explanations, guided configuration, connection
wizards, visible assumptions, and actionable findings. The learner should not be
shielded from important cloud semantics.

### Practitioner

A cloud engineer, software engineer, or architect who expects concise technical
language, efficient keyboard use, precise relationship types, deterministic
output, complete diffs, and predictable control over revisions.

### Organization administrator

A person who manages membership and roles and needs tenant isolation, project
ownership, and auditable sensitive actions. The exact role matrix remains an
[open decision](../PUBLIC_STATUS.md).

Guided and Professional modes are assistance preferences over one editor
component/control tree and the same source documents, commands, validation,
generation, evidence, revision, and export model. Component structure, controls,
dimensions, geometry, density, fields, order, stages, actions, and shortcuts
remain identical. Wording, contextual education, recommendations, and optional
technical disclosure may vary. Changing modes preserves mounted state and cannot
change deployment semantics or proof. See
[ADR-0006](../adr/0006-guided-professional-shared-semantics.md) and
[ADR-0018](../adr/0018-shared-editor-presentation-and-assistance-only-modes.md).

## 4. Core concepts

| Concept                 | Product meaning                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| Project                 | Tenant-owned workspace containing drafts, revisions, artifacts, findings, and audit history            |
| Intent Document         | Versioned provider-neutral statement of reviewed needs, unknowns, decisions, and alternatives          |
| Draft                   | Autosaved, mutable working state; never a compiler input                                               |
| Architecture graph      | Typed nodes, ports, edges, visual boundaries, configuration, and metadata                              |
| Workload Behavior       | Versioned provider-neutral declarative application behavior bound to stable graph identities           |
| External Resource       | Designed reference to a system whose lifecycle authority may remain outside generated IaC              |
| Application contract    | Versioned HTTP, event, data, auth, operation, or test meaning reused across solution documents         |
| Graph operation         | Structured proposal to add, update, connect, disconnect, or remove graph elements                      |
| Revision                | Immutable snapshot of an accepted graph with explicit schema and catalog versions                      |
| Solution Revision       | Immutable manifest binding exact design, contract, ownership, coverage, tool, issue, and evidence pins |
| Repository Snapshot     | Immutable evidence for selected files at one exact repository revision                                 |
| Observed Solution       | Imported understanding derived from repository evidence; never approved design automatically           |
| Reconciliation Proposal | Reviewable difference and explicit resolution whose accepted mutations use deterministic operations    |
| Finding                 | Stable, explainable validation result with severity, location, and remediation guidance                |
| Active Issue            | Versioned cross-source issue lifecycle that references findings and other diagnostics                  |
| Evidence                | Immutable proof at one exact verification level, Solution Revision, environment, and tool identity     |
| Artifact                | Immutable generated output associated with one revision and compiler/catalog/renderer versions         |
| Diagram artifact        | Deterministic SVG or PNG representation rendered from an immutable revision                            |
| Provider catalog        | Versioned curated definitions, constraints, ports, capabilities, and approved asset references         |
| Supporting resource     | A resource or relationship created to satisfy an integration, retaining provenance                     |
| Subscription projection | Local organization billing state derived from authoritative, signed, idempotently processed events     |
| Entitlement             | Versioned permission or limit granted by plan and local subscription state                             |
| Cloud Markup credits    | Customer-facing unit for shared organization model allowance, distinct from provider token accounting  |

See [Domain Model](../architecture/DOMAIN_MODEL.md) for authoritative semantics.

## 5. Functional requirements

### 5.1 Project and organization lifecycle

The product must:

- support organization-scoped projects and explicit organization roles;
- allow project creation from a natural-language prompt, a curated template, or
  a blank canvas;
- autosave drafts without silently overwriting a newer state;
- preserve immutable revisions separately from mutable drafts;
- record auditable security- and lifecycle-sensitive events; and
- derive tenant identity from verified authentication context.

### 5.2 Intent capture

For prompt-based creation, the product must produce a reviewable,
provider-neutral Intent Document containing:

- application summary and capability-oriented functional requirements;
- ingress, egress, identity, authorization, data, workflow, and environment
  requirements;
- explicit assumptions;
- unresolved questions classified as blocking or non-blocking;
- explicit user decisions and candidate alternatives with rationale;
- data sensitivity, retention, and residency constraints;
- availability, durability, recovery, latency, and scale expectations;
- operational-overhead and cost preferences; and
- compliance constraints.

The user must be able to review and correct this material. A model response is a
proposal, not an accepted requirement or graph mutation. Unknown values remain
explicit and linked to unresolved questions; they are not silently defaulted.
Provider services do not belong in the Intent Document. The executable boundary
is specified in
[Domain Model](../architecture/DOMAIN_MODEL.md#intent-document-version-1).

### 5.3 Architecture proposal

The product must translate reviewed intent into a proposed AWS deployment graph
using the curated provider catalog. Every proposed change must:

1. conform to a versioned operation schema;
2. identify its assumptions or rationale;
3. be validated against graph and provider rules; and
4. be applied by deterministic domain code only after the appropriate user or
   workflow approval.

Invalid or unsupported proposals must fail safely and explain what the user can
do next.

### 5.4 Visual editing

The editor must support:

- responsive pan, zoom, selection, drag, and keyboard interaction;
- adding supported services from a searchable catalog;
- typed ports and typed relationships;
- node, edge, and boundary configuration through schema-driven forms;
- automatic layout for complex diagrams;
- undoable, command-driven architecture mutations;
- Guided and Professional presentations over identical semantic behavior; and
- a clear distinction between visual grouping and deployment association.

VPCs, Availability Zones, and subnets may appear as meaningful visual
boundaries. Security groups, IAM roles, route-table associations, and managed
services must not be shown as if they were physically contained when that would
misstate AWS behavior. Layout coordinates must never determine deployment
semantics.

The editing surface is light-first and desktop-first. Narrow screens prioritize
review, comments, findings, architecture explanation, and export status rather
than pretending to offer the complete precision editing experience. The visual
language should be calm, trustworthy, and professional: neither childish and
noisy nor an imitation of a provider management console.

### 5.5 Connections

For supported relationships, one shared two-stage connection dialog must use
**Set up connection** followed by **Review and connect** in both modes. It must
keep the same fields, order, validation, actions, shortcuts, and **Technical
details** disclosure while it:

- explains the integration and its security or networking implications;
- shows all direct and supporting changes before applying them;
- creates required permissions, routes, notifications, associations, or
  supporting resources through validated graph operations;
- retains provenance for generated elements; and
- makes later removal, retention, or user adoption explainable.

### 5.6 Validation

Validation must cover, where relevant:

- graph structure and type compatibility;
- required configuration;
- provider and catalog constraints;
- networking and reachability;
- identity and least privilege;
- data sensitivity and security posture;
- availability and resilience;
- cost-sensitive choices; and
- readiness for the selected IaC target.

Findings must have stable rule identifiers, severity, affected graph elements,
rationale, and remediation guidance. The product must distinguish errors that
block revision or compilation from warnings and educational information.

### 5.7 Revision and compilation

The user must be able to freeze a validated draft into an immutable revision.
Compilation must:

- use only an immutable revision;
- use explicit graph-schema, Workload Behavior, compiler, provider-catalog, and
  IaC-target versions;
- produce the same normalized output for the same inputs;
- preserve stable target deployment identities when presentation-only
  coordinates change, including Terraform addresses and CloudFormation logical
  IDs;
- reject unsupported or invalid constructs rather than inventing behavior; and
- run without model participation.

Generated IaC must be production-quality within each documented curated target
surface. Terraform and CloudFormation cover the exact initial, IPv4-networking,
and event-driven families in current catalog `0.15.0`; each retains documented
native syntax/layout differences. IaC compilation remains source-free: it cannot
generate, read, build, test, or package application source. Supported Lambda
starter source and built workload artifacts use separate deterministic generator
and isolated build/package boundaries over the same immutable revision and
explicit template/toolchain versions. AI extension generation custom candidates
use those boundaries without replacing deterministic source or compiler
authority.

### 5.8 Artifact verification and export

Generated files must be formatted and statically validated in an isolated
environment that:

- cannot deploy;
- has no customer cloud credentials;
- does not execute generated provisioners or arbitrary commands;
- limits time, memory, output, and filesystem access; and
- has network access denied by default.

The revision-bound export set must support deterministic SVG and PNG diagrams
rendered from the Architecture Document rather than a browser screenshot. A
combined artifact package contains generated IaC, diagrams, architecture and
version metadata, validation evidence, an architecture summary, and any
separately produced supported application source and built Lambda artifacts with
their own provenance and digests.

After a complete file list and diff are shown, the user may:

- download an export ZIP; or
- authorize creation of a GitHub branch and pull request.

GitHub publication includes the diagram, references it from generated
documentation, and includes the exact reviewed supported application source
where present. Export does not generate source, build packages, or deploy, and
must never imply that Cloud Markup has applied or verified the infrastructure in
a customer account.

#### AI-assisted custom candidates

Deterministic compiler and application generators remain the preferred product
path for every supported catalog behavior. The product may request model-
authored candidate source only for an explicitly approved `ai-assisted-custom`
workload, or bounded Terraform/CloudFormation only for an approved target
extension slot. The request and result must use the strict AI extension
contract, exact owned paths, runtime/target/schema allowlists, canonical
contracts and bindings, expected tests, provenance, and hard limits. No model
output may regenerate or shadow deterministic files/resources.

The user experience is one ordered state machine:

```text
Generate
→ Check
→ Fix automatically where safe
→ Review remaining issues
→ Accept candidate
```

Candidate bytes remain restricted and non-authoritative. Deterministic parsing,
formatting, lint/type/build/test, dependency/secret/security scanning, target
schema/policy checks, and exact Evidence create Active Issues for every blocker.
Repair is bounded, sanitized, metered, idempotent, cannot weaken rules, and
cannot exceed an accepted estimate for system-required escalation. Unresolved
behavior, missing tests, pending target readiness, or exhausted repair prevents
completion. Generation, validation, repair, and rejection publish bounded,
strictly sequenced live issue prefixes through an awaited host progress port.
Terminal generation adds an immutable finalization seal over the complete
prefix, result, and final Evidence/issues/history state; later edits append
separate revalidation authorities without rewriting that seal.

Primary issues use plain English and retain current, stale, or evidence-resolved
history. Optional **Technical details** show candidate files and ownership,
schema references, tool diagnostics, model/prompt provenance, and exact fix
references. The bounded review context also shows assumptions, unresolved
questions, expected tests, Evidence, and ordered privacy-safe attempt summaries;
raw provider-attempt prompts, responses, repair sections, secrets, and
unrestricted diagnostics stay outside presentation. A deterministic safe fix
requires the host to allow the exact `apply-deterministic-fix` action and
operation digest bound to scope, review, artifact, current issue record, and
source hashes. Its Graph Command result derives the reviewer from that decision
and returns the decision ID and inverse; AI fixes remain proposals until
validation passes. Guided and Professional preferences use the same review
component and authority.

The strict review surface is mounted on the existing artifact-review route with
host-supplied authorized records and edit/accept callbacks. It rehashes every
review, inspection, replay, route, and file binding and hides candidate bytes
when authority is stale or malformed.

Inspect, edit, accept, reject, and deterministic-fix application require a
host-owned decision derived from verified authentication context and bound to
the exact action, principal, organization/project, review, artifact digest, and
source revision. The artifact store binds each artifact to one immutable review
identity and digest, which every action must rejoin. Edited lineage also
requires immutable historical reads of every predecessor review, artifact
lifecycle, and replay/revalidation authority. An edit never overwrites the model
artifact or repository: it replays the original safe context, reruns all
applicable checks, creates fresh Evidence/issues/review identity, and then
atomically supersedes the exact current predecessor. Failed or stale edits leave
the predecessor current, while successful repeated edits append exact
authorization and per-file lineage. Each edit also appends an immutable
revalidation authority over the exact decision, cumulative lineage, parent
artifact/review/generation seal, validation, and monotonic Evidence,
issue-history, and current-issue prefixes; the generation seal remains
unchanged.

Acceptance and rejection require an explicit stale-safe decision over the exact
review, artifact, source revision, Evidence, ownership, and ordered attempt
digests. After authorization each rereads the current artifact and immutable
review binding, so concurrent supersession fails closed. Edited acceptance also
rejoins the complete historical predecessor and revalidation chain. Acceptance
then creates a distinct immutable successor Solution Revision plus an immutable
export input binding the accepted AI extension contract metadata, restricted
artifact, exact Evidence, model/prompt/usage provenance, and user modifications.
The source revision and canonical design remain unchanged. Acceptance still does
not write a repository, assemble compiler output, plan, apply, create a change
set, or deploy. The shared Assistant coordinator combines these authorities into
the shared Assistant workspace through strict scoped ports; production
database/job transport remains separate. Custom AI-authored CloudFormation
remains limited to an exact injected reviewed schema and readiness declaration.
Separately, the deterministic CloudFormation compiler supports the exact
initial, networking, and event-driven families from immutable graph truth; it
does not accept arbitrary model-authored template fragments.

### 5.8A Seamless reviewed Assistant workflow

The Assistant workspace is the single review surface for requirements, proposed
architecture/Workload/contract/External Resource changes, observed repository
differences, custom-generation requests, Active Issues, job progress, credit
estimate/use, file impact, and explicit accept/reject/edit decisions. Primary
language summarizes intent and consequences at a glance. Optional Technical
details expose exact operations, IDs, paths, policy actions, repository
evidence, model/prompt versions, and validation/coverage deltas.

Every proposal is a strict allow-listed operation batch over a detached
candidate. Ordinary edits cannot replace whole documents. Each operation and the
final batch must pass exact preconditions, trusted limits, and deterministic
validation. The workflow reserves before model use and settles/releases
canonical usage; denial, cancellation, and duplicate retries do not invoke or
double-charge. Guided and Professional preferences use the same component tree
and authority. No action automatically applies or writes design, source,
repository, compiler output, payment, GitHub, cloud, or deployment state.

### 5.9 Repository reconciliation and continuous evidence

Cloud Markup must keep designed, imported, generated, planned, deployed, and
current-drift layers distinct. A Repository Snapshot identifies one exact
revision and safe selected paths; an Observed Solution records deterministic
parsing and bounded inferences with evidence. Neither may mutate Architecture,
Workload, External Resource, or Application Contract truth.

Differences enter a versioned Reconciliation Proposal. Accepting a design change
invokes the existing deterministic command or typed operation with exact
preconditions; keep-observed, intentional-external, regenerate, ignore,
ambiguity-resolution, and stale-evidence outcomes remain explicit. Repository
ownership and lock/manifest records protect source, generated, AI-authored,
user-owned, imported-observation, and approved-extension paths from silent
overwrite.

Active Issues may reference deterministic validation findings, repository
mismatches, compiler/parser diagnostics, application checks, AI generation,
cloud plans, deployment/smoke results, or drift. Evidence records establish one
exact level only: structural, provider/architecture, deterministic compilation,
AI-extension parse/static, application build/tests, plan/change set,
deployment/smoke/integration, repository conformance, or deployed drift. A lower
level never implies a higher level.

Local and GitHub repository import, the Architecture CLI, generated
customer-owned workflows, normalized Terraform-plan and CloudFormation
change-set evidence, deployment attestations, and read-only drift observations
remain separately authorized projections. Continuous conformance validates and
compares those projections for one exact Solution Revision and environment,
creates source-linked Active Issues, and exposes only reviewed issue/PR actions.
Cloud Markup still receives no customer cloud credential and cannot plan, apply,
create a change set, deploy, merge a PR, or remediate drift automatically.

### 5.10 Subscription entitlements and model usage

The product must:

- offer fixed subscription plans through Stripe-hosted Checkout and Customer
  Portal surfaces without collecting card details;
- let authorized organization owners or canonical administrators manage billing
  under commercial authorization policy version 2;
- derive local subscription state from verified, idempotently handled webhooks,
  never from a browser return URL;
- enforce versioned project, export, and feature entitlements, including shared
  Cloud Markup credits;
- reserve credits before model work and settle, release, or expire reservations
  through an append-only organization usage ledger; and
- show customer usage as Cloud Markup credits, with raw provider details
  available only to authorized users where useful.

Raw provider tokens are not sent to Stripe as metered customer usage. Detailed
ownership and failure behavior are defined in
[Commercial Model](COMMERCIAL_MODEL.md) and
[Billing and Usage](../architecture/BILLING_AND_USAGE.md).

## 6. Quality attributes

### Correctness and determinism

Architecture, Workload, External Resource, and Application Contract sources are
authoritative in their declared scope—not the canvas, model output, repository
observation, or later evidence. Exact Solution Revision inputs must make
generated output reproducible and explainable.

### Responsiveness

Common canvas interactions should feel immediate at the supported graph sizes.
Expensive layout, validation, AI, compilation, and export work should not block
direct manipulation. Numeric performance budgets require measurement during the
relevant milestone and remain an [open decision](../PUBLIC_STATUS.md).

### Security and privacy

The system must enforce tenant isolation, least privilege, schema validation,
safe logging, strict AI tool boundaries, auditability, and quotas. See
[Security Principles](../architecture/SECURITY_PRINCIPLES.md).

### Approachability

The product should make assumptions, relationships, provider limitations, and
validation findings understandable without erasing technical accuracy. Guided
may add plain-language explanation, while Professional may use concise exact
terminology in the same reserved assistance slots. Both use identical controls,
geometry, density, fields, stages, actions, shortcuts, and technical details.
Names and folder ownership should remain comprehensible to future maintainers.

### Evolvability

Provider-neutral intent and graph semantics must be separable from AWS catalog
and compilation behavior. Public and persisted contracts must be versioned and
migratable.

### Cost proportionality

The platform should operate economically from roughly 1 to 1,000 initial users.
Serverless or scale-to-zero managed infrastructure is preferred where it remains
operationally and architecturally sound.

## 7. Initial constraints and non-goals

- AWS is the first supported cloud.
- Terraform is the first production IaC target.
- CloudFormation is the second deterministic target for the curated initial
  serverless/auth/data, IPv4-networking, and event-driven families; arbitrary
  services, AWS validation, packaging/upload, and change-set execution remain
  unsupported.
- Azure and GCP are future provider plugins.
- Service support is curated; breadth must not replace correctness.
- Direct deployment is not part of the first release.
- Cloud Markup must not request or store customer AWS access keys.
- Arbitrary Terraform providers, modules, and shell provisioners are not
  supported.
- Models do not execute commands, compile, deploy, or apply infrastructure.
- Model output, repository observations, plan results, deployment results, and
  drift never become authoritative design without reviewed deterministic
  operations.
- Syntax-valid AI-authored output is not a complete supported application;
  generation coverage requires the configured build, test, security, and other
  evidence for its exact level.
- Hosted GitHub repository import/synchronization is bounded to exact commits,
  immutable observed evidence, allow-listed verified push refresh, and reviewed
  reconciliation. It cannot silently change approved design or repository state.
  Customer CI/CD execution and cloud access remain outside hosted authority.
  Tenant-authorized conformance accepts only sanitized, revision-bound
  plan/deployment/drift projections produced through explicit ports; it never
  runs the customer workflow, plan, change set, deployment, or drift collector.
  Local deterministic import remains the parser/conformance foundation.
- Cloud Markup does not generate arbitrary business logic, infer handler event
  types, store source in the Architecture Document, or treat a workload intent
  record as proof that source or a built artifact exists.
- Raw model tokens are not directly metered to customers through Stripe.
- Provider icons must come from a controlled, versioned, locally consumed
  official-asset pipeline; generated imitations, random-site copies, and runtime
  hotlinks are not supported.
- PDF diagram export is deferred until after beta unless a later accepted
  decision changes the priority.
- A general-purpose IDE, free-form Terraform editor, or universal cloud
  inventory system is not part of the initial product.

## 8. Product acceptance

The first release is acceptable only when the in-scope
[MVP capabilities](MVP_SCOPE.md) can be completed through the canonical
[user workflows](USER_WORKFLOWS.md), the test and security release evidence is
satisfied, and the UI, API, graph, validation, compiler, and artifact contracts
agree on versioned semantics.

Success metrics, exact plan prices and credit allocations, service-level
objectives, the first curated service set, and detailed role permissions are
intentionally not invented here. They remain listed as
[open decisions](../PUBLIC_STATUS.md).

## September 21 beta usability implementation

The local beta change consolidates project opening through the overview, with
Open canvas and Revisions and exports links. Project settings are collapsed;
deleted and deletion-pending projects leave the active project list. Explicit
sign-in requests a fresh login to recover recent-authentication failures.
Retained-content erasure is still governed separately by project lifecycle and
is not claimed here.

Editor services expose active connection points when expanded and use one
connection wizard from node, list and inspector actions. Node/inspector help
opens Learn. Connect remains useful for inspecting existing relationships and
editing generated connections; unavailable capabilities are omitted from its
action list. Code includes the selected resource's target mappings and
repository/conformance content. Activity includes current-session commands and
AI progress; the Jobs launcher is removed. Layout, help and mode switches do not
change deployment semantics.

Guided mode offers a dismissible next action from complete validation reports
bound to the current graph; Professional mode leaves that guidance hidden. The
independent Editor tour preference controls introductory walkthroughs, including
an explicit project-creation checkbox. Issues retains deterministic severities,
places findings before readiness, and explains that unknown Region availability
is different from a missing Region boundary.

Follow-up AI proposals support additive references to the current diagram
through the owner-approved limited context. Workload purpose is editable without
requesting source generation. Export controls use compact rows, actual job-stage
progress and collapsed technical evidence. ZIP download remains independent of
GitHub publication.

Catalog 0.17 includes Lustre, Windows, OpenZFS and ONTAP FSx resources with
reviewable recommendations and an explicit family selector. The S3/Lambda/Lustre
workflow uses the processed bucket as a data repository, with required subnet
and security-group checks. Other protocols require their own client and
directory configuration; the app does not imply a native Lambda FSx mount.

AI proposals execute as durable background jobs with cancellation and progress.
The optional export checkbox creates review-required Node.js Lambda source,
mocked tests and setup notes from the immutable workload purpose and
connections. The ZIP does not imply a successful build, alter the revision's
infrastructure-only assessment or deploy the generated application. Active code
and configuration values are excluded from model context.

Retained-content cleanup is enabled locally under the owner's explicit approval
for projects already requested for deletion. The worker checks deletion state,
blocks further writes and verifies erasure before completing deletion. Hosted
activation and final release evidence are tracked in the execution plan.

Desktop interaction is the primary design target: compact adjacent controls,
keyboard access, content-sized inspectors and bounded scrolling. Active public
beta projects and saved revisions are preserved across catalog expansion.
Existing 0.16 drafts offer an explicit reversible upgrade that can repair
verified legacy event permissions; it never rewrites saved revisions. Successful
exports offer one authenticated, checksum-verified ZIP action before file
review.
