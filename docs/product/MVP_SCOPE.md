# MVP Scope

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

## Purpose

This document defines the first production release boundary. It narrows the
[Product Specification](PRODUCT_SPEC.md) without changing its architectural
invariants. The canonical designed/imported/generated/planned/deployed ownership
and evidence boundaries are in
[Solution, Repository, and Continuous-Evidence Contracts](../architecture/SOLUTION_REPOSITORY_AND_EVIDENCE.md).

## In scope

### Product experience

- Organization-authenticated project access with explicit roles.
- Project creation from a prompt, a curated template, or a blank canvas.
- Reviewable extraction of requirements, assumptions, unresolved questions, data
  sensitivity, availability needs, and cost preferences.
- An AI-proposed AWS architecture expressed as schema-constrained graph
  operations.
- A responsive graph editor with service catalog, typed ports and edges,
  meaningful visual boundaries, inspector forms, undoable commands, and
  automatic layout.
- Guided and Professional assistance preferences over one component tree and the
  same source documents, controls, dimensions, fields, validation, generation,
  evidence, revision, and export behavior. Only wording, contextual education,
  recommendations, and optional technical disclosure may vary.
- A calm, trustworthy, light-first, desktop-first editing experience; narrow
  screens prioritize review, comments, findings, explanation, and export status.
- Shared reviewed connection guidance for the selected curated AWS service set.
- Versioned Workload Behavior intent for supported functions, including stable
  trigger/action bindings and truthful implementation readiness.
- Versioned External Resource authority for references that generated IaC must
  not create without an explicit reviewed ownership/import change.
- Shared versioned HTTP, event, data, auth, operation, and test contracts
  referenced by workloads and external resources.
- Structural, provider, networking, security, cost-sensitive, and IaC-readiness
  findings for the supported surface.
- Autosaved drafts, immutable revisions, audit events, and versioned projects.
- Fixed organization subscriptions, locally enforced entitlements, and shared
  Cloud Markup credits backed by an auditable usage ledger.

### Output

- A production-quality Terraform compiler for the curated graph surface.
- Deterministic generation from an immutable revision and explicit
  compiler/catalog versions.
- Isolated formatting and static validation that cannot deploy.
- Complete artifact preview and diff.
- Deterministic, revision-bound SVG and PNG architecture diagrams.
- Deterministic starter application source only for explicitly reviewed Lambda
  runtime/behavior templates, followed by isolated supported workload
  build/test/package evidence; neither path generates arbitrary business logic.
- An immutable Solution Revision manifest binding the exact design hashes,
  included observations, versions, assumptions, unresolved decisions, generation
  coverage, source ownership, accepted AI-extension references, and freeze-time
  issue/evidence references.
- Explicit ownership and coverage records that prevent silent overwrite and
  prevent syntax-only output from being called complete.
- ZIP download containing IaC, diagrams, architecture metadata, validation
  evidence, an architecture summary, and separately produced supported
  application source and built Lambda artifacts where present.
- User-authorized GitHub branch and pull-request export whose generated
  documentation references the exported diagram and whose reviewed file plan
  includes supported application source where present.
- Optional deterministic generation and explicit GitHub App export of exactly
  `.github/workflows/cloudmarkup-validate.yml`, `cloudmarkup-plan.yml`,
  `cloudmarkup-deploy.yml`, `cloudmarkup-smoke.yml`, and
  `cloudmarkup-drift.yml`. The customer owns OIDC roles, state, approvals,
  execution, promotion, smoke, drift, and deployment authority. Cloud Markup
  only previews and exports the reviewed files.

### Platform

- AWS-hosted application using the accepted components in
  [System Overview](../architecture/SYSTEM_OVERVIEW.md).
- Provider-neutral domain interfaces with AWS as the first provider
  implementation.
- An internal identity interface with Cognito as the first adapter.
- A provider-neutral model gateway with Amazon Bedrock as the first adapter.
- Stripe-hosted Checkout and Customer Portal behind a billing adapter, with
  signed idempotent webhooks updating a local subscription projection.
- Organization entitlement enforcement and append-only accounting for Cloud
  Markup credits.
- PostgreSQL-compatible metadata and object-store abstractions.
- Security and verification controls described in
  [Security Principles](../architecture/SECURITY_PRINCIPLES.md) and
  [Testing Strategy](../architecture/TESTING_STRATEGY.md).

## Explicitly out of scope

- Direct deployment, `terraform apply`, stack creation, or any mutation of a
  customer cloud account.
- Collection or storage of customer AWS access keys.
- Azure, GCP, or CloudFormation outside the exact curated initial,
  IPv4-networking, and event-driven families in catalog `0.15.0`.
- Arbitrary Terraform providers, community modules, arbitrary source downloads,
  shell provisioners, or user-supplied executables.
- Arbitrary business-logic generation, a general-purpose code AST, implicit
  event-shape inference, unreviewed runtime templates, or application source
  stored inside the Architecture Document.
- Model-executed commands, model-authored raw Terraform as the authoritative
  output, or bypass of deterministic validation.
- Superficial coverage of the full AWS catalog.
- Importing and reconciling existing live cloud resources.
- Local repository import/conformance and GitHub import/synchronization.
  Repository export remains the separately reviewed one-way branch/pull-request
  flow.
- Customer-owned CI/CD execution, arbitrary workflow generation, or any Cloud
  Markup-held customer cloud credential, Terraform state, approval, merge,
  plan/apply, smoke, drift, or deployment authority.
- AI-authored custom application or IaC generation and repair.
- Cloud Markup-operated cloud plan/change-set, deployment/smoke,
  repository-conformance, or deployed-drift collection. Generated customer
  workflows may produce their own bound Evidence when customers run them.
- Runtime workload monitoring, incident response, cost billing, or compliance
  certification.
- Direct per-token Stripe metering, collection or storage of card details, and
  browser redirects as proof of subscription state.
- PDF architecture export before beta.
- Provider icon hotlinks, generated provider imitations, or copies from
  unverified asset sites.
- Separate document or validation semantics for Guided and Professional modes.
- Guarantees that exported infrastructure will satisfy every
  organization-specific policy not represented in the graph and validator.

## Boundary distinctions

| Concern                  | Cloud Markup boundary                                                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Presentation modes       | Only wording, contextual education, recommendations, and optional technical disclosure may vary; component structure, controls, dimensions, fields, source documents, validation, generation, and evidence remain shared |
| Diagrams                 | Deterministic artifacts rendered from immutable documents, not editor screenshots                                                                                                                                        |
| Provider icons           | Reviewed official assets in a pinned local pipeline, not runtime or imitation assets                                                                                                                                     |
| Customer billing         | Fixed plan entitlements and Cloud Markup credits, not raw provider-token Stripe metering                                                                                                                                 |
| Infrastructure systems   | Platform CDK deploys Cloud Markup; the isolated customer compiler only emits customer IaC                                                                                                                                |
| Workload intent          | Versioned declarative behavior references stable graph edges; it contains no source, prompts, commands, credentials, or secret values                                                                                    |
| Application artifacts    | Reviewed starter/user source and built packages use separate generator/build manifests; IaC renderers and exporters never execute them                                                                                   |
| Design authority         | Architecture, Workload, External Resource, and Application Contract documents; repository/model/tool observations remain proposals or evidence until reviewed                                                            |
| External resources       | Generated IaC creates only generated-IaC-owned resources; other ownership states remain references unless explicitly changed by a reviewed operation                                                                     |
| Repository operations    | Exact snapshots and observed layers are distinct from one-way export and cannot silently mutate approved design                                                                                                          |
| Customer CI/CD           | Cloud Markup deterministically previews/exports five allow-listed workflow files; customers retain GitHub/AWS roles, state, approvals, execution, Evidence custody, and deployment authority                             |
| Verification             | Each Evidence record establishes one exact level; no lower level implies plan, deployment, repository conformance, or drift                                                                                              |
| Model integration        | Provider-neutral ModelGateway with future Bedrock adapter; model output has no mutation, shell, repository, billing, secret, or deployment authority                                                                     |
| Deployment configuration | Reviewed typed non-secret inputs reference secrets held in approved external channels; neither is prompt data                                                                                                            |

## Curated-support rule

A service or relationship is MVP-supported only when all of the following exist:

1. a versioned catalog definition and configuration schema;
2. accurate ports, relationship, containment, and association semantics;
3. domain and provider validation;
4. Terraform compilation with stable addressing;
5. documentation and shared assistance copy;
6. golden fixtures, negative cases, and contract tests; and
7. a stated compatibility and migration policy.

The current bounded catalog and target readiness are recorded in the
[provider guide](../development/PROVIDER_CATALOG.md). The 50-family coverage
plan is research: thirteen families have existing slices, and thirty-seven
remain planned. Neither a family name nor a mapping label establishes complete
support for every service variant or configuration.

## MVP acceptance scenarios

A complete supported application pattern additionally requires exact Workload
Behavior, Application Contract, generator/runtime compatibility, deterministic
source ownership, isolated build/test/security evidence, and the stated
generation-coverage proof. AI-authored custom output cannot be labeled complete
because it parses or compiles. The exact reviewed authenticated-notes family and
the six catalog-`0.13.0` event families—S3 upload metadata processing, SQS
consumer with DLQ, SNS fan-out consumers, EventBridge schedule, EventBridge
Lambda target, and Step Functions Lambda task—may be labeled
`complete-supported-pattern` only when their complete typed contracts and
passing deterministic build/test/security/package Evidence are present. A
different runtime, operation, filter, dispatcher, transform, dependency, or
incomplete build remains starter or custom-required; these exact patterns do not
imply arbitrary application support.

The release must demonstrate, for the accepted curated service set:

- a new user can turn reviewed intent into an editable AWS graph;
- a user can build the same valid graph from a blank canvas without AI;
- typed connections and wizards explain and stage every supporting change;
- invalid structure, networking, security, and configuration produce actionable
  findings;
- visual-only movement does not change Terraform resource addresses or semantic
  output;
- freezing a revision makes it immutable and compilation never reads a moving
  draft;
- repeated compilation with identical versioned inputs produces identical
  normalized artifacts;
- switching presentation modes preserves the complete document and semantic
  behavior;
- freezing a Solution Revision binds the exact Architecture, Workload, External
  Resource, Application Contract, ownership, coverage, and compatibility inputs
  without rewriting older revisions;
- observed repository content remains a separate layer unless an accepted
  reconciliation invokes the reviewed deterministic operation;
- each displayed evidence level is independently proven and staleness-bound;
- repeated diagram rendering with identical versioned inputs produces identical
  normalized SVG and PNG artifacts;
- formatting and static validation run with no deploy capability or customer
  credentials;
- ZIP contents, including diagrams and reports, match the reviewed artifact
  manifest and diff;
- duplicate, reordered, and replayed billing or model callbacks cannot grant an
  entitlement or charge credits twice;
- GitHub export occurs only after explicit user authorization and records an
  audit event;
- workflow export requires existing GitHub App Workflows permission and explicit
  confirmation of every exact file/digest, while workflowless export remains
  available with a precise readiness warning; and
- development, staging, and production workflows keep separate customer OIDC
  roles for plan/deploy/drift, workspaces, saved plans, approvals, and Evidence;
  smoke has no cloud role, and no customer plan artifact is promoted across
  environments.

Detailed evidence is defined in
[Testing Strategy](../architecture/TESTING_STRATEGY.md).

## Release gates

The MVP cannot be called production-ready until:

- Milestones M0 through M9 in the [Build Sequence](../PUBLIC_STATUS.md) meet
  their exit criteria;
- no unsupported feature is represented as available;
- tenant authorization and audit paths have negative test coverage;
- graph and public contract migration behavior is exercised;
- deterministic compiler golden tests and reproducibility checks pass;
- deterministic diagram golden tests and mode-equivalence tests pass;
- subscription projection, webhook, entitlement, reservation, settlement, and
  reconciliation failure paths have evidence;
- isolated validation has been threat-modeled and tested for escape, network,
  and resource-exhaustion cases;
- operational limits and failure recovery are documented;
- remaining open decisions are either resolved or explicitly deferred outside
  MVP; and
- customer-workflow beta/production activation has a reviewed published
  architecture CLI distribution, digest, installation procedure, exact pipeline
  registration, and support policy plus authoritative execution-boundary GitHub
  Environment-policy verification. Until both exist, generated validation proves
  only inert package integrity without installing or invoking Terraform, not the
  full operational architecture CLI pipeline.
