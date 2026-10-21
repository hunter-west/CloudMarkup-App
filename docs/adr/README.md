# Architecture Decision Records

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

Architecture Decision Records (ADRs) capture durable choices that shape Cloud
Markup. They complement product requirements and implementation plans:

- product requirements and non-goals belong in
  [`docs/product`](../product/PRODUCT_SPEC.md);
- accepted architectural decisions belong here;
- unresolved choices belong in [Project Status](../PUBLIC_STATUS.md); and
- execution sequencing belongs in [Build Sequence](../PUBLIC_STATUS.md) and task
  plans.

## Status vocabulary

- **Proposed** — under review and not safe to treat as decided.
- **Accepted** — current direction for new work.
- **Deprecated** — retained for history but discouraged.
- **Superseded** — replaced by a named later ADR.
- **Rejected** — considered but not selected.

An accepted ADR remains historical. To change it, add a new ADR that names and
supersedes the old one rather than rewriting the original decision.

Accepted and superseded records preceding ADR-0028 retain `CloudCanvas` as the
historical former product name. Those occurrences describe the name in use when
the decision was accepted; they are not active identifiers or compatibility
aliases. [ADR-0028](0028-cloudmarkup-predeployment-identity.md) establishes the
current Cloud Markup identity and clean predeployment serialized baseline.

## Process

1. Copy [0000-template.md](0000-template.md) to the next four-digit number and a
   short kebab-case title.
2. Apply the [ADR-writing checklist](CHECKLIST.md).
3. Describe the forces and constraints without assuming the preferred answer.
4. State one concrete decision, including boundaries and exclusions.
5. Record positive and negative consequences and meaningful alternatives.
6. Link affected product, architecture, security, testing, and roadmap
   documents.
7. Keep the ADR `Proposed` while review can still change it.
8. When accepted, update conflicting documents and remove the resolved item from
   `STATUS.md` in the same change.

Avoid ADRs for easily reversible local implementation details. Write one for
dependency direction, data ownership, public contracts, trust boundaries,
provider strategy, language/platform choices, deployment scope, and long-lived
operational constraints.

## Index

| ADR                                                                         | Status     | Decision                                                                                                                            |
| --------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| [0001](0001-versioned-architecture-graph.md)                                | Accepted   | A typed, versioned architecture graph is the source of truth                                                                        |
| [0002](0002-monorepo-and-language-choices.md)                               | Accepted   | Use a pnpm/Turborepo monorepo, strict TypeScript, and a standalone Go compiler                                                      |
| [0003](0003-deterministic-compiler-boundary.md)                             | Accepted   | Compile immutable revisions deterministically across a closed compiler boundary                                                     |
| [0004](0004-aws-first-provider-strategy.md)                                 | Accepted   | Deliver AWS first through versioned provider contracts                                                                              |
| [0005](0005-export-without-deploy.md)                                       | Accepted   | Export reviewed artifacts without direct deployment or customer cloud credentials                                                   |
| [0006](0006-guided-professional-shared-semantics.md)                        | Accepted   | Guided and Professional modes share one semantic model                                                                              |
| [0007](0007-deterministic-diagram-export.md)                                | Accepted   | Render revision-bound SVG and PNG diagrams deterministically                                                                        |
| [0008](0008-provider-icon-asset-pipeline.md)                                | Superseded | Use official provider icons through a controlled local asset pipeline                                                               |
| [0009](0009-stripe-subscription-boundary.md)                                | Accepted   | Keep Stripe behind hosted, webhook-authoritative subscription contracts                                                             |
| [0010](0010-ai-credits-usage-ledger.md)                                     | Accepted   | Account for Cloud Markup credits in an append-only usage ledger                                                                     |
| [0011](0011-separate-platform-and-customer-iac.md)                          | Accepted   | Keep platform CDK and customer IaC compilation strictly separate                                                                    |
| [0012](0012-staged-deployment-configuration.md)                             | Accepted   | Stage typed deployment inputs while keeping secrets out of source and prompts                                                       |
| [0013](0013-desktop-first-responsive-review.md)                             | Accepted   | Use a desktop-first editor with responsive read and review experiences                                                              |
| [0014](0014-design-system-ownership.md)                                     | Accepted   | Own provider-neutral visual tokens and components in a shared UI package                                                            |
| [0015](0015-provider-neutral-icon-resolution.md)                            | Accepted   | Resolve opaque catalog icon IDs through local provider-neutral registries                                                           |
| [0016](0016-component-isolation-and-visual-testing.md)                      | Accepted   | Use Storybook isolation and Playwright browser and visual evidence when UI begins                                                   |
| [0017](0017-versioned-workload-behavior-and-build-boundaries.md)            | Accepted   | Version declarative workload behavior separately from source generation and build execution                                         |
| [0018](0018-shared-editor-presentation-and-assistance-only-modes.md)        | Accepted   | Use one editor control tree and limit modes to assistance copy                                                                      |
| [0019](0019-product-owner-governance-for-official-provider-icons.md)        | Accepted   | Govern official provider icons with product-owner evidence and automated technical admission                                        |
| [0022](0022-verified-principal-and-canonical-organization-authorization.md) | Accepted   | Verify external subjects, resolve current application identity, and authorize canonical tenant roles/object ownership               |
| [0023](0023-provider-neutral-commercial-domain-and-credit-accounting.md)    | Proposed   | Define provider-neutral plan, grant allocation, charging, usage, compensation, and commercial authorization policy                  |
| [0024](0024-canvas-first-on-demand-editor-surfaces.md)                      | Accepted   | Keep the desktop canvas primary through compact service projections and on-demand Inspector and Workspace surfaces                  |
| [0020](0020-stable-docks-and-node-backed-owned-configurations.md)           | Proposed   | Separate stable visual docks and model owned configurations as typed graph concepts                                                 |
| [0021](0021-postgresql-data-api-and-object-storage.md)                      | Accepted   | Store transactional metadata in PostgreSQL and immutable large content in versioned objects                                         |
| [0025](0025-canonical-solution-repository-and-evidence-contracts.md)        | Accepted   | Bind canonical solution, repository-observation, issue, evidence, generation, and ownership contracts                               |
| [0026](0026-provider-neutral-durable-async-job-framework.md)                | Accepted   | Coordinate durable provider-neutral jobs without taking domain, commercial, evidence, or deployment authority                       |
| [0027](0027-aws-platform-capability-lifecycle-topology.md)                  | Accepted   | Organize AWS platform resources by capability and lifecycle; ADR-0040 supersedes beta ingress and delivery constraints              |
| [0028](0028-cloudmarkup-predeployment-identity.md)                          | Accepted   | Adopt Cloud Markup and a clean predeployment identifier baseline without legacy aliases                                             |
| [0029](0029-deterministic-terraform-and-application-artifact-boundary.md)   | Accepted   | Generate bounded deterministic Terraform while preserving application-artifact and source-ownership boundaries                      |
| [0030](0030-nodejs-typescript-lambda-starter-runtime.md)                    | Accepted   | Use Node.js 24 and strict TypeScript for the initial deterministic Lambda starter runtime                                           |
| [0031](0031-immutable-solution-export-orchestration.md)                     | Accepted   | Orchestrate immutable Solution Revision exports with retry-safe stages and verified-download-only publication                       |
| [0032](0032-typescript-repository-orchestration-cli.md)                     | Accepted   | Use a thin TypeScript repository CLI over the closed Go compiler and existing deterministic stage boundaries                        |
| [0033](0033-deterministic-repository-import-parser-boundary.md)             | Accepted   | Import repository observations in TypeScript while reusing Go HCL through a fixed data-only protocol                                |
| [0034](0034-provider-neutral-model-gateway.md)                              | Accepted   | Constrain provider-neutral model assistance behind strict operations, trusted routing, and zero execution authority                 |
| [0035](0035-deterministic-ai-evaluation-and-runtime-admission.md)           | Accepted   | Require frozen deterministic evaluation evidence and one fail-closed runtime admission boundary before beta activation              |
| [0036](0036-customer-owned-receipt-bound-ci-cd.md)                          | Accepted   | Export deterministic customer-owned OIDC workflows with exact saved-plan and predecessor-receipt bindings                           |
| [0037](0037-deterministic-multi-artifact-application-build-batches.md)      | Accepted   | Build bounded canonical application-artifact batches with per-workload Prompt 32A evidence                                          |
| [0038](0038-deterministic-cloudformation-customer-iac-target.md)            | Accepted   | Render the initial customer-IaC family as structured deterministic CloudFormation from shared normalized authority                  |
| [0039](0039-independent-continuous-conformance-projections.md)              | Accepted   | Compare six immutable evidence projections without merging authority or granting remediation power                                  |
| [0040](0040-regional-rest-ingress-origin-admission.md)                      | Accepted   | Use Regional REST ingress with pre-integration origin admission and platform-only main-branch delivery                              |
| [0041](0041-cross-account-beta-dns-ownership.md)                            | Accepted   | Keep beta DNS in its authoritative account behind the exact retained CloudFormation role chain                                      |
| [0042](0042-github-installation-ownership-callback.md)                      | Accepted   | Bind GitHub installation ownership callbacks to exact tenant sessions and one-time PostgreSQL intents                               |
| [0043](0043-platform-model-dispatch-spending-fence.md)                      | Accepted   | Bound application model dispatches with retained USD reservations and a one-send final HTTP guard                                   |
| [0044](0044-shared-project-editing-leases.md)                               | Accepted   | Enforce one expiring tab-scoped editor per shared project across draft publication                                                  |
| [0045](0045-memory-only-ai-previews.md)                                     | Proposed   | Deliver non-replayable in-memory AI previews with metadata-only acknowledgements and conservative accounting                        |
| [0046](0046-project-content-erasure.md)                                     | Proposed   | Erase active project content after verified write closure; retain lifecycle metadata and normal backups                             |
| [0047](0047-report-free-live-model-evaluation.md)                           | Proposed   | Add report-free live evaluation admission with shared canonical controls before genuine report issuance and current promotion       |
| [0048](0048-typed-model-safety-refusal.md)                                  | Proposed   | Add a nonmutating typed refusal and require exact safety behavior in current evaluation receipts                                    |
| [0049](0049-memory-only-candidate-build-execution.md)                       | Proposed   | Add a separate memory-only candidate build executor with verified tmpfs, bounded stdin, exact helper identity and cleanup           |
| [0050](0050-preissued-ai-evaluation-sequence-lineage.md)                    | Proposed   | Pre-issue bounded repair stages and bind actual predecessor-derived inputs and every outcome before report projection               |
| [0051](0051-live-repository-parser-input-receipts.md)                       | Proposed   | Bind actual pre-inference parser metadata to exact live evaluation input and preserve historical validator receipts                 |
| [0052](0052-typed-beta-planning-evaluation.md)                              | Proposed   | Evaluate basic API and notes through the actual typed command operation while preserving historical source and quality requirements |
| [0053](0053-revocable-browser-refresh-sessions.md)                          | Accepted   | Restore browser sessions through a revocable same-origin refresh transport with token-free lifecycle metadata                       |
| [0054](0054-explicit-authenticated-no-content-pattern.md)                   | Proposed   | Add an explicit authenticated no-content application pattern with separate compiler and build evidence                              |

| [0055](0055-functional-beta-infrastructure-assistant.md) | Accepted | Allow
one bounded, owner-funded beta infrastructure proposal path without the full
evaluation/promotion campaign |

- [0056: Incremental beta diagram proposals](0056-incremental-beta-diagram-proposals.md)
  — Accepted. Add durable jobs and explicit existing-resource references with a
  bounded, owner-approved diagram projection for beta follow-up requests.

- [0057: Opt-in beta application-source drafts](0057-opt-in-beta-application-source-drafts.md)
  — Accepted. Package explicit review-required Lambda source from immutable
  purpose and diagram relationships.

- [0058: Desktop service configuration and appearance](0058-desktop-service-configuration-and-appearance.md)
  — Accepted. Group service variants without changing resource contracts,
  prioritize configuration tasks, and add shared appearance preferences.

- [0059: Desktop canvas readability and consolidated utilities](0059-desktop-canvas-readability-and-utilities.md)
  — Accepted. Theme-aware connections, softer glass surfaces, and profile/Help
  utilities.

- [0060: Desktop dashboard and navigation continuity](0060-desktop-dashboard-and-navigation.md)
  — Accepted. Read-only organization dashboard, coherent navigation, clearer
  glass, minimap actions and transient readable overview tiles.

- [0061: Desktop panel and layout continuity](0061-desktop-panel-and-layout-continuity.md)
  — Accepted. Compact resizable glass panels, anchored tours, stable expansion
  viewport and deterministic proposal spacing.

- [0062: Separate beta coverage collection from deployment admission](0062-separate-beta-coverage-from-delivery.md)
  — Accepted. Keep complete exact-commit tests and deployment checks; collect
  coverage in separate weekly or manual CI runs.

- [0063: Meter enabled beta AI against organization credits](0063-metered-beta-ai-credits.md)
  — Proposed. Reserve and settle every enabled beta model use through the
  canonical ledger, with visible estimates and actual credits.

- [0064: Prepare historical evidence only for its consumer and classify verification-only changes](0064-ci-preparation-and-verification-only-changes.md)
  — Accepted. Preserve exact test admission while eliminating unused historical
  preparation and allowing an explicitly reviewed CI-only path set to skip
  delivery.

- [0065: Reuse source-bound CI preparation and isolate documentation checks](0065-source-bound-ci-reuse-and-documentation-profile.md)
  — Accepted. Preserve complete source verification while sharing same-run build
  preparation, hashing public native tool caches and reducing documentation
  runs.

- [0080: Defer draft verification and compact generated contracts](0080-draft-verification-and-compact-generated-contracts.md)
  — Accepted. Reduce unfinished PR runs, generated storage and duplicate
  verification setup while retaining exact ready/release admission.

- [0066: Reviewed canvas context and consistent AI decisions](0066-reviewed-canvas-ai-context.md)
  — Accepted. Bounded configuration context, stepped proposals, advisory source
  reviews and reservation-pinned one-cent usage conversion.

- [0067: Durable one-time credit purchases](0067-one-time-credit-purchases.md) —
  Proposed. Separate account-bound purchase attempts and verified, atomic
  non-expiring grants while live commerce remains disabled.

- [0068: Personal and organization workspace ownership](0068-personal-and-organization-workspaces.md)
  — Proposed. Explicit personal ownership with immutable sharing boundaries and
  actor-owned organization creation, preserving canonical tenant IDs.

- [0069: Actor-owned profiles and public application usernames](0069-actor-owned-account-profiles.md)
  — Proposed. Editable account names and unique application usernames with
  actor-only authority, optimistic concurrency and stable provider identities.

- [0070: Recipient-bound organization invitations](0070-recipient-bound-organization-invitations.md)
  — Proposed. Bind exact user-ID/username invitations to immutable recipients,
  preserving explicit acceptance and canonical seat/tenant admission.

- [0071: Organization membership lifecycle](0071-organization-membership-lifecycle.md)
  — Proposed. Conditional roles, departure and ownership with preserved
  identity, explicit rejoining, current authority and immutable retry receipts.

- [0072: Account session revocation](0072-account-session-revocation.md) —
  Proposed. Persistent session revocation and actor-bound account session
  controls.

- [ADR-0073: Branded account access and independent registration admission](0073-branded-account-access.md)
  (Proposed)

- [ADR-0074: Token-bound account credential management](0074-account-credential-management.md)
  (Proposed)

- [ADR-0075: Staged account authenticator enrollment](0075-staged-account-authenticator.md)
  (Proposed)

- [0086: Bounded AI list-setting proposals](0086-bounded-ai-list-proposals.md) —
  Accepted. Versioned literal string lists with catalog admission and
  reversible, explicitly reviewed editor conversion, preserving proposal
  versions 1–4.

- [0077: GitLab OAuth and reviewed repository export](0077-gitlab-oauth-and-reviewed-repository-export.md)
  — Proposed. Explicit GitLab OAuth, encrypted provider grants and reviewed
  repository writes; connections, selected projects and resumable reviewed
  export are locally composed. Integrated release gates and live activation
  remain pending.

- [0081: Live billing and platform staff account authority](0081-live-billing-and-platform-staff.md)
  — Accepted. Separate provider modes and canonical staff credit administration.

- [Retained cleanup wake shadow](proposed-cleanup-wake-shadow.md) - Proposed,
  awaiting coordinator numbering and acceptance. Disabled shadow delivery keeps
  minute SQL recovery; it does not authorize auto-pause or idle suppression.

- Durable precommit cleanup admission - Proposed. Inactive prepared/committed
  journal with durable wake readback and locked abort; native proof, migration
  admission and activation remain pending.

- [0088: Explicit infrastructure delivery for saved application patterns](0088-explicit-infrastructure-export-selection.md)
  - Proposed. Digest-bound infrastructure selection preserves saved patterns and
    compiler pins while omitting application execution and retaining
    required-code evidence.

- [0089: Complete reviewed semantic AI context and applicability proof](0089-complete-reviewed-ai-context.md)
  - Accepted. Bounded context-v3, saved-baseline proposal-v6 and opt-in
    source-v3 share deterministic applicability proof; historical contracts,
    edit authority and existing pricing remain intact. Final release evidence
    remains separate.

- [0090: Cheap draft admission with complete ready verification](0090-cheap-draft-admission.md)
  - Proposed. Draft PRs retain only the dependency-free admission refusal;
    complete ready, main, manual, scheduled and protected delivery checks
    remain.

- [0091: Lean beta verification and exact-source impact selection](0091-lean-beta-verification.md)
  - Proposed; implementation authorized. Shared functional beta checks,
    dependency-based test selection, mandatory uninstrumented SQL/SDK recovery,
    scheduled diagnostics and same-run verified build reuse; release integration
    and final admission remain pending.

- [0092: Staff-funded AI access without a subscription](0092-staff-credit-ai-access.md)
  - Proposed; product direction authorized. Audited complimentary funding
    permits bounded AI use through the canonical ledger without creating paid
    plan, trial, export or team privileges. Atomic migration and release
    admission remain pending.

- [Private account photos](proposed-private-account-photos.md)
  - Proposed. Bounded principal-owned raster storage uses existing SQL and a
    separate photo contract; local PostgreSQL proof and activation remain
    pending.

- [Independent staff trial access](proposed-staff-trials.md) — Proposed. Audited
  expiring evaluation access and isolated trial credits; activation is held.

- [Standalone core runtime profile](proposed-standalone-core-runtime-profile.md) -
  Proposed. Main-derived standalone history and explicitly acknowledged core ACL
  admission preserve canonical hosted SQL and the full provider-direct contract.
