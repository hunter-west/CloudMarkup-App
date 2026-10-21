# ADR-0025: Canonical solution, repository-observation, and evidence contracts

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Accepted
- **Date:** 2026-08-14
- **Owners:** CloudCanvas product and engineering
- **Supersedes:** None
- **Refines:** ADR-0001, ADR-0003, ADR-0005, ADR-0017, ADR-0021, and ADR-0022
- **Superseded by:** None

## Context

CloudCanvas already has canonical Intent Document, Architecture Document,
Workload Behavior, Graph Command, Validation Finding/Report, immutable revision,
artifact, authorization, object-storage, and commercial contracts. It does not
yet have one versioned model for externally managed resources, application
interfaces, exact repository observations, reviewed reconciliation, a complete
Solution Revision manifest, AI-authored extensions, generation coverage,
cross-source active issues, ordered evidence, or deterministic repository file
ownership.

Without those contracts, repository state could silently compete with approved
design, model-authored source could be mistaken for deterministic generator
output, validation success could be overstated as plan or deployment proof, and
generated files could overwrite user-owned content. Putting these concerns into
unrestricted JSON, source code, shell instructions, UI state, GitHub state, or
provider-specific records would weaken the existing deterministic and
provider-neutral boundaries.

Workload Behavior v1 is accepted and immutable under ADR-0017. The additional
behavior required here therefore needs a new workload version and a
deterministic Architecture Document migration rather than an in-place rewrite.
Likewise, the existing immutable Revision must evolve into the Solution Revision
lineage rather than gain a competing revision aggregate.

## Decision

### Canonical source documents

Architecture Document v3 is the atomic draft/revision envelope for three
independently versioned semantic sources:

- the Architecture graph is the authority for designed infrastructure;
- Workload Behavior v2 is the authority for declarative application behavior;
  and
- External Resource References v1 are the authority for designed references to
  resources or systems whose lifecycle may be outside generated IaC.

Versioned API, event/message, data, auth, behavior-operation, and test contracts
are shared records referenced by workloads and external resources. Their
canonical schemas are reused directly by domain and API adapters; manually
synchronized DTO copies are prohibited.

The envelope supports atomic draft/revision persistence while each source has a
separate canonical projection and content hash. Deterministic repository export
serializes those projections as `architecture.json`, `workloads.json`,
`external-resources.json`, and `contracts/` entries. Those files are projections
of one canonical revision input, not competing authorities.

Architecture v2 migrates to v3 by copying existing graph and Workload Behavior
v1 meaning, mapping only equivalent implementation states, and representing
newly expressible facts as absent, empty, or explicitly unresolved. It never
guesses routes, event shapes, entities, authorization, tests, source files,
external resources, repository facts, generators, or model provenance.
Architecture v1 continues through the existing v1-to-v2 step. Existing immutable
revisions remain valid legacy revisions and are not rewritten.

### External-resource lifecycle authority

An External Resource Reference declares one ownership state and a compatible
create/reference/import/data-source policy. Generated IaC may create only a
resource explicitly owned by generated IaC. Existing cloud resources managed
elsewhere, third-party services, on-premises/network endpoints,
repository-defined dependencies, and unresolved resources remain reference-only
unless a reviewed ownership/import operation changes that authority. An
imported-into-current-IaC record requires explicit reviewed import lifecycle
intent; no importer infers it from an identifier or configuration file.

Identifiers, ARNs, URLs, endpoints, account/project and Region/location values
are bounded non-secret references. Authentication records name methods and
secret references only. Secret values, credentials, tokens, private keys, and
connection strings are prohibited.

### Repository observation and reconciliation

A Repository Snapshot binds one repository/local-source descriptor to an exact
immutable commit, selected paths, ignore rules, file checksums, importer
version, redaction/limit result, deterministic findings, and unsupported files.
Observed Architecture/Workload records are immutable evidence derived from that
snapshot. They may contain deterministically confirmed facts and bounded
inferences with file/line evidence, confidence, provenance, external resources,
generated-file ownership evidence, and conflicts with approved design.

Observed state is never an Architecture, Workload, or External Resource source
of truth automatically. It is displayed as the imported/observed layer until a
reviewed Reconciliation Proposal is accepted. Graph changes carry exact Graph
Command v1 batches with existing preconditions and atomicity. Workload and
external-resource changes use versioned typed operations with exact content-hash
preconditions. Keep-observed-only, intentional external/unmanaged, regenerate,
ignore-with-reason/expiration, ambiguity resolution, and stale-evidence removal
remain explicit review outcomes.

Prompt 33C owns future local deterministic import/conformance. Prompt 40B owns
future narrowly authorized GitHub import/synchronization. Existing M8 export
remains a separate one-way reviewed branch/pull-request operation. None executes
repository content, reads embedded credentials, silently mutates design,
regenerates during export, merges, force-pushes, or deploys.

### Solution Revision and later evidence

The existing immutable Revision identity evolves into a Solution Revision. Its
freeze-time manifest binds the exact Intent disposition/hash, Architecture
revision and semantic/visual hashes, Workload hash, External Resource hash,
shared contract hashes, explicitly approved repository snapshot/observed-layer
references, catalog/compiler/generator/renderer/importer/prompt/policy versions,
assumptions, unresolved decisions, generation coverage, source ownership,
accepted AI-extension references, and issue/evidence snapshots available at
freeze time.

Evidence produced later does not mutate the Solution Revision. Each immutable
evidence, artifact, issue-state, plan, deployment, repository-conformance, or
drift record binds back to the exact Solution Revision. A newer manifest means a
new Solution Revision, not an update to an old one.

### AI-authored extensions and generation coverage

AI-authored extensions are bounded proposal/artifact records for behavior not
covered by deterministic generators. They record structured intent, exact owned
destination paths, architecture/workload inputs, model/provider/prompt
provenance, file or patch digests, dependency requests, validation plan and
results, issues, acceptance, export safety, regeneration, and conflict policy.
They contain no raw source, executable command, package script, secret, billing
authority, repository mutation capability, or deployment authority.

The model is never authoritative. Future creation or repair still requires the
provider-neutral ModelGateway, entitlement and atomic credit reservation, schema
parsing, deterministic ownership/path validation, isolated formatter/
parser/build/test/security evidence, explicit user acceptance, and immutable
artifact publication. Amazon Bedrock is only the first future adapter; model,
Region, retention, and evaluation configuration remain explicit versioned
operator inputs and cannot enter domain meaning.

Generation coverage is recorded per workload and for the solution as one of:
infrastructure-only, starter-application, complete-supported-pattern,
ai-assisted-custom-validated, custom-implementation-required, or
target-unsupported. Syntax or parser success alone can never establish
complete-supported-pattern or ai-assisted-custom-validated. Each state names its
required and satisfied evidence.

### Active issues and ordered evidence

Validation Finding/Report v1 remains canonical deterministic architecture-rule
output. Active Issue v1 is a versioned cross-source envelope that references,
rather than redefines, findings and diagnostics from validation, policy,
compiler/parser, application build/test/security, AI generation/repair,
repository mismatch, plan/change set, deployment/smoke, and drift sources. Issue
state is append-only versioned evidence: current, stale, resolved, accepted, or
deferred, with provenance, closure evidence, deterministic fixes where
available, and separately labeled AI fixes plus validation status.

Evidence v1 has nine ordered levels: structural; provider/architecture;
deterministic compilation; AI-extension parse/static; application build/tests;
cloud plan/change set; deployment/smoke/integration; repository conformance; and
deployed drift. Every record binds the Solution Revision, safe environment,
tool/model versions, checks, findings, artifact hashes, CI identity,
timestamps/staleness, provenance, and redacted failures. Evidence levels are
independent facts: a lower level never implies, satisfies, or upgrades a higher
level.

Generation-coverage evidence must resolve to one current, all-passing record for
the same Solution Revision at the exact configured level, with a passing check
that explicitly claims the requirement. Shared levels do not merge proof:
infrastructure compilation and application generation remain distinct level-3
checks, and application build/tests and application security remain distinct
level-5 checks. Active Issue closure requirements are immutable and bind an
exact level plus check ID. Resolution requires referenced evidence linked to the
issue; numeric minimum-level or higher-rank substitution is forbidden.

The UI may project designed, imported, generated, planned, and deployed layers
and one continuously updated Issues workspace. Presentation cannot merge their
authority, change evidence, or hide exact source and staleness.

### Repository ownership and CI/CD

The deterministic repository package owns:

```text
cloudcanvas/
  solution.json
  architecture.json
  workloads.json
  external-resources.json
  repository-snapshots/
  contracts/
  cloudcanvas.lock.json
  cloudcanvas.manifest.json
application/
infrastructure/
diagram/
evidence/
.github/workflows/
```

Every path is classified as source, generated, AI-authored, user-owned,
imported-observation, or approved extension, with an owner, digest, regeneration
rule, semantic-diff behavior, and conflict policy. Generated or AI-owned paths
never silently overwrite user-owned content. No second diagram DSL is
introduced.

Prompt 33B owns a future deterministic verification CLI. Prompt 40A owns future
customer-owned CI/CD files that verify exact revision artifacts; the customer
retains deployment credentials, approvals, state, and execution. CloudCanvas's
own repository CI and platform CDK deployment path remain separate from customer
repository workflows and customer IaC.

## Consequences

### Positive

- Designed infrastructure, workload behavior, external lifecycle authority,
  repository observations, generated artifacts, cloud plans, and deployed facts
  remain distinguishable and auditable.
- Existing command, revision, persistence, authorization, billing, compiler, and
  no-deploy boundaries remain reusable.
- Repository synchronization and AI extension work have exact future inputs
  without gaining execution or mutation authority now.
- Coverage and evidence claims become machine-checkable without treating one
  successful stage as proof of another.

### Negative

- Architecture v3, Workload Behavior v2, multiple new contract families,
  migrations, hashes, and reference-integrity validation add a large public and
  persisted compatibility surface.
- Cross-document atomic revision freezing and repository projections require
  careful normalization and more fixtures.
- Active issue projections must reconcile append-only state records without
  rewriting source findings.
- AI-assisted custom coverage remains deliberately harder to satisfy than a
  syntax check.

## Non-goals

This decision does not implement repository scanning/synchronization, a CLI,
customer workflows, application or IaC generation, model or Bedrock calls,
dependency installation, build/test/package execution, cloud plans, deployments,
drift collection, live Stripe/GitHub/AWS access, or a second diagram language.
It does not make arbitrary applications complete or change the current
curated-support rule.

## Compatibility, security, and rollback

All contracts are strict, versioned, bounded, canonically serialized, and
future-version rejecting. Migrations clone inputs and preserve absence rather
than guessing meaning. Existing revisions remain readable with their original
compatibility pins. New metadata/storage changes are additive and
checksum-pinned; rollback restores paired database and object versions rather
than using a destructive down migration.

Repository bytes, model output, tool diagnostics, cloud evidence, and file paths
are untrusted. Relative paths reject traversal and machine roots. Tenant-owned
records require verified-principal authorization and exact project ownership.
Evidence and revision inputs are immutable. Secrets remain external references.
No schema contains a general raw-code, arbitrary-command, callback, module-path,
credential, or deployment field.

## Follow-up

- Implement only the schema/domain/persistence/documentation foundation in the
  accompanying plan, then stop before Prompt 25.
- Implement Prompts 29A, 32A, 33B, 33C, 35, 36A, 40A, 40B, 45A, and 47B only
  through later explicit numbered prompts and their own threat models/gates.
- Keep unresolved Bedrock models/Regions/retention/evaluation thresholds,
  external artifact admission, dependency policy, and cloud-plan/deployment
  provider details in STATUS until their owning prompts resolve them.

## Alternatives considered

### Treat repository state as design truth

Rejected because parsing may be incomplete or inferred, files may be stale, and
silent mutation would bypass Graph Command preconditions and review.

### Add a second workload or revision aggregate

Rejected because it would compete with accepted Workload Behavior and Revision
lineage. New versions and deterministic migrations evolve the canonical
contracts instead.

### Let AI write arbitrary source or Terraform directly

Rejected because model output is nondeterministic and cannot bypass structured
ownership, deterministic compilation where supported, isolated evidence, or user
acceptance.

### Store one overall verification status

Rejected because structural validity, compilation, build/test, plan, deployment,
repository conformance, and drift have different authorities and staleness.

## References

- [Product specification](../product/PRODUCT_SPEC.md)
- [MVP scope](../product/MVP_SCOPE.md)
- [User workflows](../product/USER_WORKFLOWS.md)
- [System overview](../architecture/SYSTEM_OVERVIEW.md)
- [Domain model](../architecture/DOMAIN_MODEL.md)
- [Security principles](../architecture/SECURITY_PRINCIPLES.md)
- [Testing strategy](../architecture/TESTING_STRATEGY.md)
- [Build sequence](../PUBLIC_STATUS.md)
- Execution plan
- [ADR-0001](0001-versioned-architecture-graph.md)
- [ADR-0003](0003-deterministic-compiler-boundary.md)
- [ADR-0005](0005-export-without-deploy.md)
- [ADR-0017](0017-versioned-workload-behavior-and-build-boundaries.md)
- [ADR-0021](0021-postgresql-data-api-and-object-storage.md)
- [ADR-0022](0022-verified-principal-and-canonical-organization-authorization.md)
