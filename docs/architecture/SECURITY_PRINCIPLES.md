# Security Principles

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

## Security objective

Cloud Markup must help users design and export infrastructure without becoming a
path to cross-tenant access, credential exposure, unreviewed code execution, or
cloud deployment. The first release targets an OWASP ASVS Level 2-oriented
verification plan; this is an engineering target, not a claim of certification.

Operational reporting guidance is in the repository
[Security Policy](../../SECURITY.md). Canonical cross-layer trust and authority
are defined in
[Solution, Repository, and Continuous-Evidence Contracts](SOLUTION_REPOSITORY_AND_EVIDENCE.md).
The controlled-beta security baseline is traced through the Threat Model, the
[ASVS Level 2-oriented Verification Matrix](ASVS_LEVEL_2_VERIFICATION_MATRIX.md),
the Controlled-beta Limit Inventory, and the
[Data Classification, Retention, and Deletion Policy](DATA_CLASSIFICATION_RETENTION_AND_DELETION.md).

## Trust boundaries

| Boundary                   | Untrusted input                                                               | Required handling                                                                                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser to API             | Tokens, routes, payloads, graph operations, tenant selectors                  | Verify identity, derive tenant context, authorize resource action, validate schema and business rules                                                               |
| Model gateway              | User prompt, retrieved context, model output                                  | Minimize data, constrain tasks, verify trusted external commercial authorization/reservation, validate schemas, treat all output as a proposal                      |
| Repository observation     | Paths, repository bytes, file metadata, parser output, inferred relationships | Pin exact revision, bound/redact input, reject traversal and credentials, preserve evidence, never mutate design automatically                                      |
| AI-authored extension      | Structured request, model output, dependency requests, generated hashes       | Enforce owned paths, no raw-code authority or tools, isolate checks, require exact evidence and acceptance                                                          |
| Plan/deploy/drift evidence | Tool output, environment identifiers, CI claims, timestamps                   | Bind exact Solution Revision/environment/tool, redact failures, preserve staleness, never promote evidence level                                                    |
| Customer CI/CD             | Generated workflow proposal and customer repository context                   | Customer owns review, credentials, approvals, state, and execution; Cloud Markup gains no deploy role                                                               |
| External billing provider  | Event body, headers, identifiers, ordering, and repetition                    | Verify exact bytes/signature/time in the sandbox adapter, retain only safe identity/digest evidence, process idempotently, reconcile, update only local projections |
| Provider catalog           | Released catalog, descriptors, and rules                                      | Strictly compile static reviewed data, verify digest/version, reject unsupported references, never retrieve or load executable artifact data at runtime             |
| Provider assets            | Official files, metadata, and update sources                                  | Verify provenance and integrity, review usage, pin locally, prohibit runtime hotlinks                                                                               |
| API to persistence         | Queries, object references, concurrency tokens                                | Parameterize, scope by tenant, enforce optimistic concurrency, verify object metadata and digests                                                                   |
| Async queue                | Job identity and immutable references                                         | Use trusted envelopes, authorize publication/export, enforce idempotency and expiry                                                                                 |
| Compiler                   | Versioned revision contract                                                   | Validate closed input, deny network and credentials, generate only allowlisted target constructs                                                                    |
| Validation sandbox         | Generated files and tool output                                               | Fresh isolation, pinned allowlist, resource limits, network denial, no deploy commands                                                                              |
| Platform deployment        | Environment configuration and secret references                               | Validate typed non-secret inputs, resolve secrets externally, scope operator roles, fail closed                                                                     |
| GitHub integration         | Repository target and artifact                                                | Least-privilege user authorization, complete diff, idempotency, audit, no merge or deploy                                                                           |

## Identity and tenant authorization

- Cognito is an adapter behind an internal identity interface; vendor claims are
  normalized into a trusted authentication context.
- Authentication does not imply authorization. Every tenant-owned read,
  mutation, job, artifact, and export checks membership and permission.
- Tenant identity comes from verified context and server-side resource
  ownership. A request-supplied organization or tenant ID is never
  authoritative.
- Repository queries include tenant ownership constraints; object-store access
  is mediated through authorized metadata, not guessed keys.
- Repository Snapshot, Observed Solution, Reconciliation Proposal, Solution
  Revision, AI extension, Active Issue, and Evidence access repeats exact
  organization/project ownership and active-membership predicates. Record IDs
  and object keys supplied by a caller never establish authority.
- Background jobs carry a signed or otherwise trusted internal context and
  immutable resource references. Sensitive final actions re-check current
  authorization.
- Authorization failures are fail-closed and avoid disclosing whether another
  tenant's resource exists.
- Role and membership changes generate audit events and invalidate or shorten
  relevant sessions where practical.

Negative cross-tenant tests are mandatory at API, repository, job, and
object-access layers.

The accepted M9
[shared-project editing lease](../adr/0044-shared-project-editing-leases.md)
adds a tab-bound concurrency proof, not new authorization. Raw lease tokens stay
in request/browser memory and are excluded from responses, URLs, audit and logs;
only their digests are stored. Production pending-save and publication paths
must recheck current membership, project lifecycle and unexpired lease
ownership.

## AI and prompt security

- The `ModelGateway` exposes narrow task APIs, not a general tool-execution
  surface.
- Models may extract intent, explain supported concepts, and propose versioned
  graph operations.
- Models may not compile, execute, deploy, call shells, select arbitrary
  binaries, access cloud credentials, or write directly to authoritative state.
- Output is schema-constrained where supported and always parsed and
  deterministically validated afterward.
- ModelGateway v1 has 15 strict operations. Every machine-consumed request,
  response, invocation descriptor, and normalized usage record crosses a strict
  v1 schema; the complete gateway/routing generation set contains 14 JSON Schema
  artifacts. Unknown versions/operations/fields and oversized data fail closed.
- The gateway validates raw request authority and computes
  `authorityInputDigest` before redaction. Schema-preserving redaction rebinds
  affected hashes and metadata, then the sanitized request is parsed and
  authority-validated again before its separate `inputDigest` is computed. The
  invocation claim binds both through its `authorityDigest` and sanitized
  `inputDigest`.
- Parsed output remains untrusted and then undergoes deterministic provenance,
  catalog/operation, evidence-grounding, candidate-path/hash, generation-plan,
  dependency-approval, validation-expectation, repair-binding, and
  tool-authority checks.
- Routing selects configured roles from trusted complexity, entitlement, budget,
  requested mode, provider capabilities, and versioned evaluation results.
  Browser claims cannot select a provider, model, inference profile, or cost
  tier.
- Reviewed prompt files have stable IDs, versions, operation ownership, and
  digests. Callers cannot submit an arbitrary system prompt or replace a
  registered template.
- Provider invocation inputs contain exactly one operation-bound schema-only
  response tool and declare zero tool authority. The response tool is data
  transport, not executable authority; prose, unknown tool names, extra fields,
  and invalid tool input fail closed.
- Amazon Bedrock is the first production provider family behind the
  provider-neutral adapter contract, not a domain dependency. Prompt 34R records
  Sonnet 5 Standard and Opus 5 Deep/internal-escalation candidates with exact US
  inference-profile identifiers, but both production records remain unevaluated
  lifecycle candidates. Prompt 35 later adds the checked-in Bedrock Runtime
  adapter using the SDK default credential chain. Its existence does not enable
  a route, supply credentials, invoke a provider in ordinary CI, or activate
  platform AI configuration.
- Non-fake invocation requires a matching trusted routing decision. Browser and
  model output cannot select plan entitlement, credit authorization, route,
  provider/model/profile, effort, timeout, retry, pricing version, or fallback.
  Internal escalation is single, terminal, failure-gated, diagnostics-bound, and
  adds zero customer credits beyond the accepted estimate. Its exact one-time
  lineage claim atomically fences the original invocation/routing decision,
  accepted maximum, credit decision, feature, scope, and sanitized input.
- Prompt-cache keys contain digests and version/configuration scope rather than
  raw customer content. Organization-safe policy scope and residency are part of
  the key; cache content cannot be shared across tenant or residency boundaries.
- AI-authored extensions are bounded records of structured requests, owned
  destinations, hashes, dependencies, validation results, issues, acceptance,
  and conflicts. They do not grant shell, package-manager, repository mutation,
  billing, secret, compiler, cloud, or deployment access.
- Parser/static success alone cannot establish validated custom or complete
  generation coverage; every required evidence check and explicit acceptance
  must be present.
- Prompt instructions embedded in user content, templates, catalog text, or
  artifacts do not override system tool policy.
- Only the minimum required project context is sent. Secrets and credential
  values are prohibited. Repository excerpts and repair diagnostics are bounded,
  reference-identified, and redacted before adapter invocation.
- Default logs contain only safe IDs, hashes, counts, timings, and results. Raw
  prompts, responses, source, diagnostics, and unrestricted architecture bodies
  are not logged. Any retained evaluation data needs explicit classification,
  access, retention, and redaction policy.
- Every started provider attempt has one deterministic `usageRecordId` for its
  exact invocation/attempt tuple. The injected recorder must retain that
  identity idempotently, but has no entitlement, reservation, pricing,
  settlement, adjustment, reconciliation, or other ledger authority.
- Model, token, request, and concurrency quotas protect availability and cost.
- An atomic organization credit reservation is required before chargeable
  expensive work. It pins plan, entitlement, charging, and pricing policy
  versions; provider, model, and model version; and exact grant allocations.
  Settlement, release, expiry, retry, and compensation are idempotent and
  auditable.
- The commercial wrapper resolves trusted suspension, entitlement, quota,
  route/model, environment, price, and credit state before dispatch. Prompt 38
  additionally requires atomic quota/concurrency claim, a fenced lease/revision,
  reservation intent/receipt with read-only recovery, trusted-time expiry
  recheck, and a separate persisted dispatch intent. Recovery-only execution
  refreshes canonical accounting status even for a stored receipt, never
  reserves missing work, and never invokes. The accounting port has no generic
  clock-driven expiration mutation; trusted time alone can deny dispatch but
  cannot release credits. Settlement retry reuses the authenticated host
  receipt. Ambiguous or invalid processing remains open for fixed safe
  reconciliation; zero-usage release requires coordinator-owned or externally
  verified Evidence that dispatch did not start.
- Immutable model usage detail must reference the organization-scoped Prompt 24A
  ledger and contains no raw prompt or response. Customer-safe contracts omit
  provider cost, margin, operating buffer, and credit conversion configuration.
- The UI distinguishes AI suggestions and assumptions from accepted user or
  deterministic system decisions.
- Generated application and IaC results are candidate artifacts only. Paths and
  generation-plan targets must be request-owned. Dependency/module/provider
  requests are inert data and require both a request-declared and operator-
  allow-listed approval path.
- The gateway has no arbitrary URL, filesystem, repository, package-manager,
  shell, compiler, payment, usage-ledger mutation, cloud, or deployment port.
- Deterministic fake adapters implement every operation for local development
  and CI. They require no network, credentials, provider account, or spend and
  do not count as model-quality Evidence.
- See [Provider-neutral ModelGateway](MODEL_GATEWAY.md) for the exact trust
  flow.

## Billing and payment security

- Every account is an organization and owns exactly one Cloud Markup billing
  account. Personal accounts use the same single-member organization boundary.
- The commercial domain is provider-neutral. Prompt 24B supplies deterministic
  fake and optional Stripe sandbox adapters for hosted Checkout, Portal, and
  webhook normalization without importing Stripe into domain code. Live keys,
  charges, and card collection are prohibited.
- Active owners and canonical administrators may manage billing under commercial
  authorization policy version 2. Every active member may read current
  plan/entitlement/seat/credit/grant/aggregate-usage summaries; restricted
  technical usage requires owner or administrator authorization.
- Administrative credit adjustment belongs to a separate trusted
  platform-administrator or system-reconciliation boundary. No ordinary
  organization role can invoke it.
- Browser return parameters, presentation mode, provider identifiers, and
  client-supplied subscription state are never authorization inputs.
- The dedicated webhook verifies its endpoint-specific signature and bounded
  timestamp against the exact raw body before parsing. It allow-lists required
  event types, persists only safe identity/digest/retry/order/outcome evidence,
  resumes incomplete work idempotently, and cannot let an older event replace a
  newer projection.
- Checkout and Portal require billing.manage, recent authentication, current
  database membership, and server-selected Product/Price configuration. Browser
  redirects, arbitrary Price IDs, provider metadata, and client claims never
  activate access.
- Provider customer/subscription ownership is checked across organizations.
  Unknown mappings, deleted tenants, cross-tenant metadata, trials, quantities,
  and unsupported periods/statuses fail closed.
- Stripe sandbox API and signing secrets remain outside configuration objects,
  responses, persistence, logs, audit summaries, and fixtures. Future deployment
  resolves only cloudmarkup/<environment>/stripe/api-key and
  cloudmarkup/<environment>/stripe/webhook-signing-secret, plus the optional
  cloudmarkup/<environment>/stripe/webhook-signing-secret-previous during a
  bounded signing-secret rotation, with least privilege.
- Entitlements use the tenant-scoped local subscription projection and versioned
  plan policy and fail safely when authoritative state cannot be established.
- Credit availability derives from grants and append-only events, never one
  mutable balance. Reservation atomically pins plan, entitlement, charging, and
  pricing policy versions; provider/model/model-version identity; and exact
  grant allocations, and it cannot settle above its reservation in policy
  version 1.
- Every usage event retains its charging-policy version. Administrative credit
  corrections are append-only `adjustment` events distinct from ordinary grant
  issuance and cannot double-count an adjustment-backing allocation bucket.
- Usage, compensation, grant, and reservation records are organization-owned,
  correlated, idempotent, and protected from double settlement or historical
  rewrite. Customer compensation never erases provider-usage or cost evidence.
- Purchased grants cannot activate until their explicit expiration policy is
  approved. Integer credits and monetary micros avoid floating-point accounting.
- Payment, subscription, pricing, raw token, estimated cost, customer credit,
  adjustment, and technical usage data follow explicit access, redaction, and
  retention policies. Usage records contain no raw prompts or model responses.
- Commercial suspension, credit exhaustion, and the expensive-operation kill
  switch block new costly operations without by themselves removing manual
  editing, reads, existing artifacts, or permitted data export.
- Prompt 26 exposes only the bounded tenant-safe plan/credit summary backed by
  fake/local billing. Public Checkout/Portal, billing management, broader
  billing and usage UI, and live provider composition remain Prompt 24C or later
  work.

## Graph and API integrity

- Zod validates TypeScript runtime boundaries; JSON Schema supports
  cross-language and schema-driven contracts where required.
- Schema success is necessary but insufficient: deterministic domain rules
  enforce identity, types, cardinality, lifecycle, catalog support, and
  invariants.
- Requests use explicit size, depth, count, and complexity limits to prevent
  graph and parser exhaustion.
- Mutations use version preconditions and idempotency where retries are
  possible.
- Immutable revisions and artifacts use strong content digests and controlled
  metadata state transitions.
- Public and persisted contracts are versioned. Unsupported versions fail
  clearly rather than being guessed.
- Immutable Repository Snapshots, Observed Solutions, Reconciliation Proposals,
  Solution Revision manifests, AI extensions, Active Issue states, and Evidence
  records use strong digests, exact published objects, and append-only or
  immutable transitions.
- Cross-document references and ownership/lifecycle combinations are
  deterministically validated after schema parsing.
- External resources are create-capable only in the explicit generated-IaC-owned
  state; observed identifiers never grant import or lifecycle authority.

## Compilation and generated-code safety

- Only immutable, authorized revisions may compile.
- The compiler accepts a closed versioned contract and an allowlisted provider
  catalog.
- Terraform generation uses structured HCL libraries, not string concatenation
  of untrusted executable fragments.
- Arbitrary providers, modules, external sources, provisioners, and
  user-supplied executables are prohibited.
- The compiler has no customer cloud credentials, model access, deployment
  permission, or reason to access production metadata stores directly.
- Stable graph identity determines resource addresses; display text and
  coordinates do not.
- Output records exact input, compiler, catalog, target, toolchain, and content
  digests.

## Isolated formatting and validation

The Prompt 32 Terraform static-validation runner now implements the following
boundary:

- start from a fresh, minimal environment;
- receive only the immutable candidate artifact and controlled configuration;
- use pinned, allowlisted tool versions;
- deny outbound network by default;
- expose no platform, customer cloud, source-control, or package-registry
  credentials;
- prevent privileged execution and host filesystem access;
- enforce CPU, memory, process, file-count, output-size, and wall-time limits;
- never invoke `apply`, deployment, shell provisioners, or arbitrary project
  scripts; and
- destroy the environment after collecting bounded, redacted diagnostics.

Terraform initialization uses a digest-pinned image, exact read-only lockfile,
prepackaged filesystem mirror, `-backend=false`, `-get=false`, and no network;
missing bytes fail rather than download. The synth-only AWS sandbox restricts
egress to S3 and CloudWatch Logs interface endpoints. Exact commands, Evidence,
IAM, limitations, and remaining non-deployment boundary are documented in
[Terraform static validation boundary](TERRAFORM_STATIC_VALIDATION.md).

## Deterministic application-source generation

- Treat Architecture, Workload, Application Contract, Solution Revision,
  normalized-model, repository-inventory, label, path, checksum, and external
  reference data as untrusted. Strict versioned schemas and exact semantic joins
  fail closed before a reviewed source template is selected.
- The application generator is a pure data-to-data boundary. It has no
  filesystem-write, subprocess, package-manager, compiler, test-runner, model,
  network, credential, cloud SDK, Terraform, artifact-fetch, or deployment
  authority. The Go IaC compiler cannot call it or execute its output.
- Generated source uses deployment keys and typed relationships, never display
  labels, account-specific identifiers, source scanning, or inferred event
  shapes. IAM remains derived only from graph relationships and owned policy
  configuration.
- Secret values are not accepted or emitted. A generated binding may name only a
  canonical non-secret variable or opaque secret reference; logs and diagnostics
  expose bounded categories and stable IDs rather than source bodies, claims,
  credentials, or secret material.
- Generated replacement requires the exact unchanged baseline. User-owned and
  approved-extension paths are preserved, ownership mismatches conflict, and
  orphaned generated files are never silently deleted.
- Prompt 32A build envelopes are emitted only for conflict-free deterministic
  starter or complete-pattern source. They identify exact source/compiled
  entrypoints and Lambda archive layout and label dependency/tool hashes as
  canonical coordinate digests. The separate application-build runner admits
  those envelopes only with an exact frozen integrity-bearing lock, approved
  offline cache, fixed toolchain/container/scanner pins, disabled lifecycle
  scripts, denied credentials/network, and a bounded disposable workspace.
- Source coverage is an assessment against an immutable Solution Revision. Only
  a fully passing generated build/test/scan/reproducibility result may bind
  application-build Evidence and confirm it; every failure, cancellation,
  static-only user-source validation, or malformed result returns no deployable
  artifact and downgrades coverage. Neither state authorizes planning or
  deployment.

## Repository, ownership, and evidence security

- Treat every path, byte, checksum, parser finding, detected type, inference,
  source location, tool result, CI claim, and environment identifier as
  untrusted input.
- Repository paths are bounded relative paths. They reject traversal, machine
  roots, embedded credentials, secret-bearing URLs, and unsafe package
  destinations.
- Repository Snapshot import limits and redaction outcomes are explicit; a
  rejected, truncated, unsupported, or redacted file cannot silently become a
  confirmed design fact.
- Observed Solutions never mutate approved design. Accepted reconciliation must
  reauthorize the exact project and apply the unchanged deterministic command or
  typed operation against current preconditions.
- Every managed path has one reviewed ownership class and digest. Regeneration
  fails closed on owner or baseline mismatch; generated and AI-authored content
  never silently overwrites user-owned files.
- AI extension dependency requests are data for later policy review, not package
  installation authority. Generated file/patch hashes are evidence, not trusted
  source.
- Active Issue and Evidence records are immutable or append-only,
  Solution-Revision-bound, provenance-preserving, staleness-aware, and redacted.
  Closing an issue requires its declared evidence; changing UI state cannot
  close it.
- Plan, deployment, smoke, repository-conformance, and drift evidence records do
  not grant cloud credentials or execution authority and do not rewrite the
  designed layer.
- Guided and Professional assistance uses the same component structure,
  controls, dimensions, fields, source documents, validation, generation, and
  evidence; mode choice is not a security or authorization input.

Bounded deterministic local repository import is implemented as the observation
boundary described below. GitHub App export and deterministic customer-owned
workflow generation are separate implemented artifact boundaries; neither runs
those workflows or receives customer roles, state, secrets, approvals, or cloud
authority. GitHub synchronization, live customer CI/CD execution, live
model-provider invocation, and Cloud Markup-operated plan/deployment/drift
collection still require separate authority. The local importer grants none of
those capabilities.

## Asynchronous job security

- External authentication and authorization establish membership, permission,
  and object ownership before constructing trusted job context. That context
  carries only actor, correlation, and organization/project ownership; payloads
  never supply authoritative tenant identity. `JobService` derives and verifies
  the raw-key and canonical-request digests internally, and raw idempotency keys
  are never stored.
- Normal records and queue envelopes contain bounded metadata and object
  references, never secrets, credentials, private keys, access tokens, raw model
  prompts/responses, or unrestricted architecture/source bodies. Object reads
  repeat purpose, ownership, digest, size, availability, and expiry checks.
- Leases, exact attempt identity, optimistic record versions, cancellation
  fencing, bounded runtime/attempt/output/artifact policy, compatible durable
  checkpoints, and sanitized allow-listed errors constrain worker crashes and
  hostile handler output.
- Awaiting-user-input binds a durable response reference to one interaction,
  checkpoint, and handler version. Resume preserves immutable initial `queuedAt`
  while durable `receivedAt` controls only new delivery availability. Polling
  redacts the response reference. Parent orchestration requires a nonempty exact
  expected-child set with preallocated IDs and rejects missing, extra,
  duplicate, or mismatched children. `cancel-remaining` persists exact queued
  cancellations and running cancellation requests before terminal parent
  failure.
- Repository contracts atomically store lifecycle compare-and-swap plus matching
  deterministic job-audit outbox entries, creation completion plus creation
  events, and claim denial plus a distinct claim-linked denial event. Durable
  pending/published state supports best-effort idempotent delivery by an
  ownership-scoped reconciler. Migration 0010 keeps attempt identities immutable
  and requires monotonic job/attempt record versions. The runtime adapter is
  deterministic in-memory evidence only; no production repository composition is
  claimed. The job-event table keeps its job foreign key. Queue publication is
  separately recoverable through record-before-publish reconciliation.
- Every queue, stale-claim, orphan, retention, and audit recovery scan filters
  an exact trusted ownership scope before applying its limit. Stale claims use
  only immutable creation plans and already durable commercial outcomes;
  recovery never reruns a hook and fails closed for missing or invalid
  authority.
- Prompt 25 implements a typed polling service contract and deterministic fake
  handlers only. It opens no HTTP/SSE endpoint, imports no AWS SDK into core,
  and calls no model, compiler, cloud, Stripe, GitHub, or deployment tool.

## Secrets and sensitive data

- Do not collect customer AWS access keys.
- Store platform and integration secrets in an approved secret manager,
  encrypted and access-controlled; never in code, repository files, logs,
  prompts, or graph configuration.
- Stripe API keys and webhook signing secrets, GitHub private keys, identity
  client secrets, database credentials, and customer data are secret values,
  never deployment configuration examples.
- Repository integration tokens, Git credentials, embedded credential URLs,
  private package credentials, and customer secrets never enter a Repository
  Snapshot, Observed Solution, AI extension, source-ownership record, Issue, or
  Evidence payload.
- Environment identities and external-resource identifiers remain bounded,
  non-secret references and are redacted when policy requires.
- Prefer short-lived, narrowly scoped credentials for GitHub and internal
  service calls.
- Encrypt transport and persisted customer content with managed keys appropriate
  to the threat model.
- Classify prompt text, architecture graphs, artifacts, audit events, and model
  evaluation data before setting retention and access policies.
- Redact tokens, authorization headers, credentials, sensitive configuration,
  and excessive user content from errors and telemetry.
- Prevent exports from including platform secrets or internal metadata not shown
  in the reviewed manifest.

## Auditability and observability

Audit security- and lifecycle-sensitive actions with trusted actor, tenant,
action, target, result, time, and correlation. Protect audit events from normal
user mutation and restrict access by role.

Operational telemetry should reveal abnormal authorization failures, quota
abuse, job repetition, model schema failures, sandbox limits, compiler
nondeterminism, and export errors without recording sensitive bodies.

The
[Data Classification, Retention, and Deletion Policy](DATA_CLASSIFICATION_RETENTION_AND_DELETION.md)
and
[Controlled-beta Operations Runbooks](../development/CONTROLLED_BETA_OPERATIONS_RUNBOOKS.md)
define the current verification targets for retention and response. Their
existence is not deployment evidence: operators must still approve and exercise
clock synchronization, access review, notification routing, escalation, and
alert thresholds before production. Remaining blockers are tracked in the
Controlled-beta Residual-risk Report.

## Availability and abuse resistance

- Enforce per-tenant and per-actor quotas for projects, graph size, model
  requests, job concurrency, artifact storage, validation, and exports.
- Bound all externally controlled collections and payloads.
- Apply timeouts and cancellation to model, database, compiler, sandbox, and
  GitHub calls.
- Use idempotency and dead-letter handling for retryable async work.
- Degrade expensive assistance without corrupting drafts. Credit exhaustion,
  commercial suspension, a kill switch, or provider outage must not by itself
  disable manual graph editing, authorized reads, existing artifacts, or
  permitted data export.
- Separate user-correctable validation errors from retryable platform failures.

## Supply chain and delivery

- Pin dependencies and toolchains once implementation begins; review lockfile
  changes.
- Generate a software bill of materials and scan source, dependencies,
  containers, and IaC in CI before release.
- Protect the default branch, require review for security boundaries, and keep
  CI credentials least-privileged.
- Sign or otherwise integrity-protect release artifacts and the provider catalog
  where practical.
- Compile provider catalogs only from statically imported reviewed files.
  Catalog artifacts may contain descriptors and opaque icon IDs, never
  callbacks, module paths, scripts, compiler templates, asset paths,
  credentials, or runtime retrieval instructions.
- Admit official provider icons only through a controlled local pipeline with
  recorded provenance, integrity, review state, and usage guidance. Do not use
  generated imitations, unverified-site copies, or runtime hotlinks.
- Apply the admission, size, active-content, checksum, placeholder, and
  ownership rules in the [Asset Policy](../design/ASSET_POLICY.md). Catalog icon
  IDs remain opaque; browser features and diagram renderers resolve them through
  reviewed local registries rather than direct provider imports.
- Do not execute pull-request code with production credentials.
- Keep product-repository CI distinct from generated customer CI/CD. Customer
  workflows retain customer credentials, approvals, state, and execution; Cloud
  Markup cannot silently add deployment authority.
- Treat every generated workflow as data before export. Accept only the exact
  five allow-listed paths, validate deterministic bytes and ownership, preview
  every file, and require the GitHub App's existing Workflows permission plus
  explicit per-file confirmation. Do not execute customer repository content
  during import, reconciliation, preview, or export.
- Generated credentialed jobs use GitHub OIDC only after exact repository,
  environment, and ref admission. Plan, deploy, and drift roles are
  customer-owned, purpose-specific, environment-scoped, and distinct. Smoke has
  no OIDC or cloud role; ephemeral mode is unsupported in v1. Pull requests and
  forks cannot receive roles; long-lived access keys and wildcard trust subjects
  are rejected.
- A saved-plan manifest binds exact revision, commit, environment, backend,
  workspace, locks, inputs, checksums, tool versions, and expiry. Deploy may
  apply only that unexpired plan and must not re-plan. Smoke and drift require a
  verified environment/revision/commit-bound deployment receipt; drift remains
  refresh-only and every environment has a separate plan/approval/Evidence
  chain. Artifact attestation is not implemented in v1; unknown attestation
  fields are rejected and cannot replace an integrity check.
- Local repository import is an observation boundary. Scan only explicit bounded
  subtrees; reject links, non-regular/binary files and portable-path ambiguity;
  reduce plan/state secrets before result construction; and route HCL only
  through the fixed data-only inspector. Import cannot run Terraform, CDK,
  package managers, repository scripts, AI, network clients, or deployment.
- CDK deployment roles must be separated by environment and never exposed to the
  product runtime.
- Keep typed non-secret platform inputs separate from secret resolution.
  Environment overlays must not silently inherit production-sensitive values.
- Keep platform CDK and the customer IaC compiler on separate dependency,
  permission, artifact, and deployment paths.

The future interaction layer also follows the
[Accessibility Specification](../design/ACCESSIBILITY.md): permission and
validation meaning cannot rely on color, canvas position, pointer dragging, or
icon recognition alone.

## Verification plan

The [Testing Strategy](TESTING_STRATEGY.md) must provide evidence for:

- authentication and authorization, including cross-tenant negative cases;
- input validation, output encoding, request limits, and safe errors;
- session, token, and role-change behavior;
- injection and confused-deputy resistance;
- model schema escape and indirect prompt-injection cases;
- commercial policy-v2 summary, billing-management, technical-usage, trusted
  adjustment, and cross-tenant role boundaries;
- grant activation, deterministic allocation, period idempotency, expiration,
  seat counting, and purchased-policy fail-closed behavior;
- reservation plan/entitlement/charging/pricing/provider/model/grant capture,
  concurrency, settlement cap, release, expiry, retry identity, plan or default
  change, compensation, and prevention of double charge;
- retained provider-usage history when customer credits are compensated;
- billing webhook raw-signature, staleness, replay, retry, ordering, mapping,
  cancellation, projection, grant, redaction, and cross-tenant cases;
- Architecture v1/v2-to-v3 lossless migration and future-version rejection;
- Workload, Application Contract, External Resource, and cross-document
  reference integrity, including exact External Resource authentication
  secret-reference grounding and dedicated variable, unresolved-item,
  architecture-requirement, dispatcher, extension, and Evidence reference
  validation;
- external-resource ownership/create/import fail-closed combinations;
- Repository Snapshot bounds/redaction/credential/path cases, deterministic
  observation, and design/observed separation;
- reconciliation precondition, atomicity, stable-ID, authorization, and no-op
  outcomes;
- source-ownership conflict and silent-overwrite rejection;
- AI-extension path/dependency/tool/secret/acceptance/export-safety boundaries;
- generation-coverage evidence requirements and syntax-only rejection;
- Active Issue lifecycle/provenance/fix/closure evidence;
- Evidence ordering, independence, staleness, redaction, CI identity, and exact
  Solution Revision/environment binding;
- tenant authorization, immutability, idempotency, and cross-tenant denial for
  every new solution-record family;
- compiler determinism and rejection of forbidden constructs;
- diagram determinism and asset provenance/integrity checks;
- sandbox isolation, resource exhaustion, and denied network/credential access;
- export authorization and artifact-integrity binding;
- secret and sensitive-data redaction; and
- dependency, IaC, secret-reference, cross-environment, and platform
  configuration scanning.

Threat modeling is repeated when a trust boundary or data class changes under
the Controlled-beta Threat Model. The
[ASVS Level 2-oriented Verification Matrix](ASVS_LEVEL_2_VERIFICATION_MATRIX.md)
records versioned requirement identifiers and evidence status without claiming
certification. Open security design choices are tracked in
[Status](../PUBLIC_STATUS.md).

## Prompt 31 export packaging

The local export service treats paths, names, bytes, checksums, producer
metadata, and destination inventories as untrusted. Strict schemas and a second
independent artifact verifier reject traversal, absolute/platform paths,
alternate data streams, device names, symlinks and other non-regular files,
portable-path collisions, unsafe media/filename pairs, forbidden outputs,
secrets, tokens, signed URLs, local paths, prompt/log material, stale revision
bindings, corruption, and configured resource-limit violations.

ZIP production is deterministic and extraction-safe: store mode only, fixed
regular-file metadata and epoch, UTF-8 names, canonical order, no extras or
comments, checked CRC/bounds, and exact reconstruction. Existing user-owned or
modified generated content always produces a conflict. The service has no
filesystem write, process, Terraform, package-manager, credential, network,

## Prompt 35 Bedrock security boundary

- Live mode is opt-in and fail-closed. The fake remains the ordinary local/CI
  default; incomplete capability, effective-date, Region, evaluation, lifecycle,
  kill-switch, target, or pricing configuration prevents invocation.
- The Bedrock client receives only an explicit Region and `maxAttempts: 1`; it
  receives no access key, secret, API key, or credential provider override. The
  SDK default credential chain owns runtime credentials. Development may select
  the named `cloudmarkup` SSO profile outside application code.
- The adapter uses only Converse/ConverseStream. It has no Bedrock
  control-plane, model discovery, agent, knowledge-base, browser, URL retrieval,
  repository, filesystem, shell, compiler, payment, graph, deployment, or
  customer-cloud authority. The schema-only response tool cannot execute.
- Native structured output and strict tool fallback both receive deterministic
  strict-schema, provenance, grounding, stable-identity, and Intent-semantic
  validation. Provider claims never become trusted facts merely because provider
  schema enforcement succeeded.
- Request metadata contains only an application label, feature, route, prompt
  version, and opaque invocation/job identities. It excludes tenant/user/project
  identity, names, emails, input content, prompts, responses, secrets, pricing,
  and protected reasoning. Normal logs and usage events remain content-free.
- Cancellation and timeouts abort the SDK request and await its settlement.
  Unknown provider processing becomes commercial reconciliation, not a free-use
  assumption. IAM denial, throttling, validation, unavailability, and transient
  service failures map to stable safe categories without provider messages.
- Model invocation content logging/retention remains disabled by default. Any
  future diagnostic capture requires separate approval, restricted encrypted
  evidence storage, retention/deletion policy, and tenant authorization.

## Prompt 36A AI-authored candidate security

Prompt 36A treats model-authored source and IaC as hostile bytes. Generation is
allowed only through the strict Prompt 24D/ModelGateway contract with exact
revision, extension or slot, owned paths, protected deterministic paths and
addresses, source references, runtime, dependencies/providers/resources,
schema/catalog pins, validation expectations, and size/count limits. The model
receives no credential, secret value, cloud account access, arbitrary
repository, or command tool; secret-backed behavior must use a typed secret
reference.

Existing file bodies may cross the model boundary only for exact editable owned
paths needed for preservation; protected deterministic files and addresses are
represented by authority metadata and digests. One trusted reservation and
accepted workflow estimate bind the initial invocation and every configured
repair context before any provider call.

Before any runner opens a workspace, the coordinator revalidates schema and
request binding, normalizes paths, detects traversal and portable case/Unicode
collisions, applies byte/file/resource limits, rejects secret-shaped content and
unsafe patches, proves base digests and ownership, and denies unapproved
dependencies, providers, resources, modules, provisioners, backends, external or
shell commands, and deterministic path/address shadowing. Candidate and invalid
bytes are content-addressed in separate tenant-scoped restricted stores.
Ordinary logs, Active Issues, Evidence, and repair prompts contain only bounded
sanitized diagnostics and digests.

Application execution is limited to the Prompt 32A pinned Node.js 24 AI-custom
profile with the fixed offline install/lint/type/unit/contract/scan/compile
matrix, no shell, no network, and hard resource limits. Terraform uses only the
approved offline `fmt`, `init -backend=false`, `validate`, TFLint, security, and
policy matrix; plan/apply/import/state commands remain denied. CloudFormation
uses bounded JSON or long-form YAML parsing with aliases/custom tags denied,
then exact reviewed resource/property, intrinsic/reference, ownership, policy,
security, and readiness checks; it creates no change set.

Repair receives the minimum relevant candidate sections and sanitized
diagnostics, is idempotent and metered, and is capped at two configured
follow-up attempts. Each record distinguishes the raw model-response digest from
the deterministic merged artifact, reruns the complete pipeline, cannot weaken a
policy, and cannot raise the accepted estimate for system-required escalation.
Malformed generation or repair output returns a restricted marker and current
Active Issue without exposing bytes or attempting an unsafe follow-up; the raw
output remains in ModelGateway's restricted diagnostic store. Exhaustion remains
a visible blocked review. Active Issue history is append-only: complete
superseding validation marks missing issues stale, and only exact issue-linked
passing Evidence may resolve one. Bounded live progress publication is awaited,
strictly sequenced, digest-bound, and forms a verifiable prefix containing only
the exact issue snapshot, append-only history, and safe authority metadata.
Terminal completion adds an immutable finalization seal over that full prefix,
terminal result, and final Evidence/issues/history counts and digests. Neither
live progress nor the seal has write capability.

Inspect, edit, accept, reject, and deterministic-fix application call a
host-owned authorization port. An allowed decision must come from verified
authentication context and rejoin the exact action, principal,
organization/project, review, artifact digest, and source revision; browser or
model data cannot choose any of them. Inspection exposes bytes only after that
decision and every record digest rejoin.

Each stored artifact has one immutable artifact/review identity-and-digest
binding. Every operation must rejoin it. Edited-candidate acceptance
additionally uses immutable historical reads to verify every predecessor
binding, lifecycle transition, replay authority, and append-only revalidation
record; a newest-only lineage check is insufficient.

An edit rehashes exact owned content and reruns the full stored safe validation
context before one atomic stale-safe supersession. The predecessor and original
model artifact remain immutable, authorization and per-file changes are
append-only, and a stale race, failed validation, or invalid lineage leaves the
predecessor current. The immutable generation finalization seal remains
unchanged; every successful edit appends a separate exact decision-bound
revalidation authority over cumulative file lineage, validation, and monotonic
Evidence, issue-history, and current-issue prefixes. Earlier Evidence cannot
authorize the edited artifact.

A reviewed deterministic safe fix is a pure domain operation, not an AI
capability. The authorization port must allow the exact
`apply-deterministic-fix` action and canonical operation digest bound to the
organization/project, review, artifact, source revision, current issue
record/version/digest, and source content/visual hashes. Only then may its
preconditioned Graph Command v1 batch run. `reviewedBy` derives from the allowed
decision, whose ID is returned with exact changes and an inverse; the result has
no persistence or deployment authority. AI-only proposals are rejected.

The mounted artifact-review adapter rehashes route, review, authorized
inspection, replay, file bytes, and scope authority before presenting any
candidate content. Stale or malformed composition fails closed without exposing
bytes. Its bounded review context includes assumptions, unresolved questions,
expected tests, Evidence, and ordered privacy-safe attempt summaries without raw
provider-attempt prompt, response, repair section, secret, or unrestricted
diagnostic content. Prompt 37 adds the shared Assistant workspace and strict
scoped workflow ports; production database/job transport and operational hosting
remain separate and may not weaken these authority joins.

Acceptance and rejection authorize the exact current review, then reread the
current artifact and immutable review binding before deciding; concurrent
supersession fails closed. Acceptance of an edited candidate also verifies the
complete immutable predecessor chain and append-only revalidation authorities.
Only then does acceptance recheck the exact current digest and Evidence and
create a distinct immutable successor Solution Revision/export input binding
metadata plus the exact restricted artifact, ownership, provenance, and user
edits. It grants no repository write, canonical-design mutation, compiler
assembly, credentials, plan, apply, change set, or deployment. No live model or
cloud call is part of the current verification path.

## Prompt 37 Assistant security boundary

Prompt 37 treats every model batch as untrusted proposal data. Trusted planning
context fixes the allowed operation families, graph command kinds, services,
ports, policies, repository evidence, entitlements, output/custom-generation
limits, and commercial cap before authorization and reservation. The model
cannot choose those values, supply reviewer authority, or request a tool.

The deterministic executor rejects whole-document replacement and unknown fields
or operation kinds, checks exact per-operation preconditions, applies to a
detached clone, and validates the complete atomic result. Stable IDs, visual
positions, containment, ownership, unrelated configuration, and user-owned files
remain unchanged unless an exact reviewed operation explicitly changes them.
Repository claims must cite approved snapshot evidence; observed and designed
state remain distinct.

Start, edit, accept, and reject derive principal and decision identity from an
allowed host authorization. The runtime/commercial lifecycle atomically claims
execution and capacity, persists reservation intent/receipt, and reserves before
model use. It settles authenticated normalized usage; accepts no-dispatch
release only from coordinator-owned trusted expiry proof or verified
callback-origin host attestation; and records authenticated priced post-dispatch
release as compensated usage, never inferred no-dispatch. Exact duplicates
neither invoke nor charge twice. Workflow records use fenced lease/revision and
compare-and-swap authority. No automatic apply or repository, compiler, payment,
GitHub, cloud, or deployment capability exists.

## Prompt 38 evaluation and runtime-control security

- Frozen fixtures are synthetic, content-addressed, bounded, and contain no real
  credential, customer data, repository body, candidate source, or provider
  response. Applicable deterministic scores require Evidence, and result records
  retain the complete score-Evidence union.
- Evaluation output is strict data-only observation. Optional judge scores are
  non-authoritative. A report binds every case to its required operation/role
  and exact run tuple. Current evaluator execution hardcodes
  `activationRecommendation: "hold"` and `capabilityActivated: false`, and
  cannot recommend or mutate the capability registry. The contract's reserved
  `eligible-for-reviewed-beta` value requires a future separately reviewed,
  resolver-verified host recommendation authority and cannot be emitted now.
  Deterministic mode accepts only the exact frozen synthetic
  route/model/profile/prompt/schema/catalog tuples.
- Runtime admission derives request windows, state capture, and decision,
  authority, commercial, and execution-lease expiry from trusted host time.
  Caller/callback timestamps and counters are not authority.
- Strict host-issued `ModelRuntimeInputEvidenceV1` is authenticated through
  durable verifier state before authority resolution or `inspect`. Its digest
  binds the exact tenant/user/operation/input, requested counts and allow-lists,
  redaction/sanitization, source ownership, verifier provenance, and literal
  absence of credential/deployment/shell/tool/URL authority. The request,
  fingerprint, callback, and terminal replay bind the same Evidence. Unissued,
  substituted, cross-tenant, under-reported, sensitive, or unredacted records
  fail before state, commercial, model, or telemetry work.
- The tenant-first store atomically acquires idempotency, per-user/organization/
  feature request quota, active concurrency, and optional live capacity only
  after read-only `inspect` returns a decision `snapshotDigest` and `claim`
  atomically rechecks it. Claim also stores the initial telemetry outbox and
  issues the sole `ModelRuntimeExecutionLeaseV1` with `acquiredAt`,
  `executionLeaseId`, `expiresAt`, `fencingToken`, `recoveryOnly`, and
  `revision`. `claim`, `assertExecutionLease`, `checkpointPendingAndRelease`,
  `completeAndRelease`, and `release` require that exact lease/revision as
  applicable. Active concurrency lease IDs are unique within an organization
  until release. In-progress duplicates cannot invoke, exact terminal duplicates
  replay, and changed duplicates conflict. An ordinary lease calls
  `ModelRuntimeCanonicalCommercialPortV1.execute`, while a recovery-only lease
  calls only `ModelRuntimeCanonicalCommercialPortV1.recover`, which cannot
  reserve missing work or invoke a model.
- Plan/feature entitlement, administrative suspension, kill switches, model/
  role/route, dependency/provider/module allowlists, prompt, repository, file,
  node, edge, output, and repair limits, exact
  prompt/schema/catalog/evaluation/runtime-policy provenance, cache scope, and
  canonical commercial estimate all fail closed before dispatch.
- The authority-digest live fence tracks current `activeConcurrentJobs`
  alongside cumulative projected invocations, input, output, cache-read,
  cache-write, and total tokens, credits, and estimated cost across requests.
  `reservedTotalTokens` must equal `reservedInputTokens` +
  `reservedOutputTokens` + `reservedCacheReadTokens` +
  `reservedCacheWriteTokens`. Exact replay adds nothing. Verified lease release
  restores active concurrency only; accepted request counts and cumulative live
  capacity remain consumed. This is conservative admission state, not usage
  accounting.
- Canonical accounting scopes otherwise equal opaque reservation/idempotency IDs
  by verified organization/project/user identity, so cross-tenant lookup or
  lifecycle mutation fails closed. The canonical commercial workflow persists
  `ModelCommercialReservationIntentV1` before reserve and
  `ModelCommercialReservationReceiptV1` with exact
  `ModelCommercialReservationAccountingStatusV1` afterward. An intent without a
  receipt must first use read/replay-only `recoverExistingReservation`, which
  returns only `ModelCommercialReservationRecoveryResultV1`. Recovery-only
  execution performs that lookup even for a stored receipt, refreshes only
  matching canonical status, cannot create a missing reservation, and cannot
  invoke. The accounting port has no generic `expire` mutation; canonical
  `expired` status requires a future authenticated accounting process. Pricing
  and normalization remain pinned at trusted host time.
- Expiry and lease/revision are rechecked immediately before a separate
  `ModelCommercialDispatchIntentV1` is persisted. Callback timestamps cannot
  change pricing or policy. Clock expiry alone denies dispatch and cannot
  release credits. Once intent exists, uncertainty cannot reinvoke.
  `ModelCommercialCoordinatorPreDispatchProofV1` may prove not-dispatched only
  from that intent, trusted expiry, and authenticated coordinator knowledge that
  callback start did not occur; callback-origin no-dispatch claims require
  verified `ModelCommercialPreDispatchNoUsageAttestationV1`. Authenticated,
  priced post-dispatch failure may release customer credits while measured usage
  is recorded as compensated; it does not claim no dispatch. Unknown or invalid
  post-dispatch outcomes retain the reservation and map to fixed safe
  reconciliation codes and bounded opaque IDs.
- Returned result evidence is rechecked against admitted, policy, route, and
  live byte/token bounds in addition to structure, secret, and content checks.
  Exact host-validator digests—not model assertions—must prove allow-listed
  operations and source ownership.
- Runtime claim and pending/terminal state commit atomically with deterministic
  content-free `ModelRuntimeTelemetryOutboxEntryV1` records. Stable event IDs
  and stored occurrence time survive retry; `listPendingOutbox` and
  `acknowledgeOutbox` let ordinary execution and terminal replay drain pending
  events idempotently. Post-execution operational authority additionally binds
  the exact executed request, decision, terminal digest, tenant/user/operation,
  safe reason codes, and source Evidence. Bare, forged, cross-tenant,
  unexecuted, or substituted claims cannot append; accepted audit/metric pairs
  append atomically and publication replay cannot duplicate them.
  Audit/metric/outcome records contain only safe IDs, digests, counts, units,
  and closed codes. Raw prompts, responses, provider errors, repository
  excerpts, candidate files, secrets, credentials, URLs, and unrestricted
  metadata are excluded.
- Runtime workflow/capacity/outbox state cannot price, reserve, settle, release
  credits, change a balance, or replace usage records. Canonical accounting
  remains the only commercial ledger; no evaluation-specific balance, estimator,
  token counter, credit counter, or cost ledger exists.
- The normal CLI is deterministic fake-only. Providerless live contracts require
  explicit, unexpired case/model/prompt/schema/catalog/evaluation-policy/
  environment/budget authority plus the exact cycle-free
  `runtimeControlConfigurationDigest` and an unengaged kill switch. That digest
  excludes the final policy digest and report-instance data; the final policy
  binds the exact report one-way.
- Authority alone cannot execute: every direct live harness call fails with
  `model-evaluation.live-execution-port-required` before adapter or judge use. A
  future reviewed host port must atomically join the fenced runtime lease and
  cache-inclusive capacity claim, reservation intent/receipt and read-only
  recovery, reservation-pinned `ModelCommercialDispatchIntentV1` and
  `ModelCommercialHostInvocationReceiptV1` plus reconciliation and runtime
  outbox evidence, and deterministic validator Evidence. Prompt 35's Bedrock
  adapter is not that live-evaluation port. Direct live-mode unit tests exercise
  denial only; no provider-backed evaluator adapter/judge invocation or live
  CLI/CI entry point exists.

## Prompt 40A customer-owned CI/CD security boundary

Prompt 40A implements deterministic generation and GitHub export of exactly five
optional workflow files. It does not implement a Cloud Markup workflow runner,
cloud integration, merge, deployment, or Evidence ingestion path.

- Pull-request validation has read-only repository permission and no OIDC token,
  secret, deployment, or untrusted-PR credential path. Credentialed jobs are
  environment-bound and use minimum job permissions plus full-commit action
  pins.
- Development, staging, and production use separate customer-controlled
  workspaces, plan/deploy/drift roles, plans, approvals, and Evidence chains.
  Smoke has no OIDC or cloud role. Production requires a protected GitHub
  Environment and explicit approval. Promotion never reuses an earlier
  environment's plan and must verify the exact predecessor deployment and
  passing smoke receipts.
- Plan output is sanitized before upload. The approved artifact includes a
  complete saved-plan manifest and checksums; deployment refuses stale,
  substituted, tampered, cross-environment, cross-workspace, cross-backend, or
  cross-revision input and has an environment-controlled kill switch.
- The backend is one closed versioned `aws-s3` descriptor plus an exact
  Terraform-root `backend.hcl`; a strict parser accepts only its six reviewed
  state/locking assignments and rejects extra fields, credentials, endpoint
  overrides, and Region mismatch. Bounded deterministic HCL/JSON parsing rejects
  actual module/provider/provisioner blocks, provider alias assignments, and
  malformed or excessive source without mistaking comments, strings, or heredocs
  for authority. The manifest checksum and expiration are rechecked in the apply
  shell immediately before Terraform, closing an inspection-to-apply expiry
  crossing.
- Smoke is bounded, redacts response data, and admits only the exact reviewed
  per-environment public HTTPS target digest. Optional ephemeral testing is
  unsupported and schema-disabled in v1. Drift is manual or bounded scheduled,
  uses a read-only role, performs refresh-only inspection, and cannot apply.
- Secrets, long-lived credentials, Terraform state, and backend configuration
  remain in customer-controlled GitHub/AWS/Terraform facilities. Logs, previews,
  Evidence, and errors expose only approved names, hashes, safe summaries, and
  redacted diagnostics.
- Plan, deploy, smoke, and drift recheck exact private-repository identity
  before protected artifact or OIDC work, so a visibility change fails closed.
- The generated validation workflow proves package integrity plus exact
  manifest/checksum-bound, ownership-aware application-source policy checks. It
  scans admitted text for secret patterns and applies execution-primitive rules
  only to generated-replaceable source; it does not build, test, or execute that
  source. Its explicit activation hold runs before Terraform setup. It is not
  the complete operational Prompt 33B pipeline. Beta and production activation
  stay blocked until both a reviewed published Prompt 33B CLI distribution,
  digest, installation procedure, and support policy exist and the selected
  GitHub Environment protection rules are authoritatively verified at the
  execution boundary.
- Prompt 40A implementation and deterministic/fake tests perform no live AWS
  call, GitHub repository mutation, GitHub Actions run, Terraform plan/apply, or
  deployment. Deployment emits an integrity-bound receipt but no fabricated
  canonical Evidence; only a passing smoke observation can establish deployment
  Evidence under the current taxonomy.

See [Customer-owned CI/CD](CUSTOMER_OWNED_CI_CD.md) and the
[GitHub OIDC setup guide](../development/CUSTOMER_OWNED_GITHUB_OIDC_SETUP.md).

## Prompt 40B GitHub repository import security boundary

Prompt 40B adds private-source observation, not repository or cloud execution
authority.

- Import tokens are short-lived, exact-installation/exact-repository sessions
  with only Metadata read and Contents read. They remain callback-scoped and are
  discarded; raw tokens, App keys, webhook signatures/bodies, and provider
  errors are absent from storage, audit, progress, and public responses.
- Remote trees and blobs are untrusted. Selection and ignore lists, portable
  repository-relative paths, supported text types, counts, per-file/total bytes,
  tree entries, and excerpts are bounded before parsing. Traversal,
  encoded/ADS/backslash paths, symlinks, submodules, collisions, binaries,
  sensitive filenames, and secret-like values fail closed or are excluded and
  redacted as specified.
- Repository content is never executed. The acquisition worker has no customer
  cloud credential, Terraform/CDK execution, package-manager, shell-extension,
  deployment, workflow-run, merge, or default-branch-write port.
- Deterministic Prompt 33C evidence runs first. Only unresolved sanitized
  application relationships can invoke the approved schema-constrained
  `repository.interpret` operation. Exact evidence references and confidence are
  validated; ungrounded claims are rejected. Private content requires
  tenant-isolated no-cross-tenant-cache-or-training authority and cannot enter
  shared prompt/result caches or training.
- Import, snapshot, review, refresh, cache, and object access are scoped by
  verified principal plus organization/project ownership. Public projections
  contain bounded paths, digests, ranges, safe summaries, claims, and issues,
  never raw state or full source bodies.
- A new commit creates immutable history. Review rechecks the exact snapshot and
  current branch before acting. Accept uses canonical atomic operations; ignore
  requires a reason; regeneration creates an export preview only. Every
  repository mutation remains behind the existing create-only feature branch and
  pull-request workflow.
- Optional synchronization accepts only HMAC-verified, replay-protected,
  allow-listed `push` deliveries bound to the configured installation,
  repository, and branch. Webhook refresh cannot mutate design or repository.

Deterministic and fake-backed tests perform no live GitHub/model/cloud call and
no repository, default-branch, workflow, customer-account, or deployment
mutation.
