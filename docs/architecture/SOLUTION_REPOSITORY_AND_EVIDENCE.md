# Solution, repository, and continuous-evidence contracts

Status: accepted authority contract with bounded deterministic generation,
repository observation, and Prompt 47B continuous-conformance projections
implemented behind separate adapters. This document grants no live model,
repository mutation, cloud-plan execution, deployment, or remediation authority.

This document defines the ownership and trust boundaries that connect the Cloud
Markup design model to future repository and verification workflows. The
canonical schemas and deterministic domain validation are the executable
contract. This text explains their intended composition and must not be read as
a claim that later roadmap behavior exists.

## Canonical sources of truth

| Concern                                              | Canonical authority                                                     | Non-authoritative inputs and projections                                                                  |
| ---------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Infrastructure design                                | The typed graph in the current Architecture Document                    | Canvas layout, model output, repository observations, plans, deployments, and drift                       |
| Application behavior                                 | Workload Behavior v2 in Architecture Document v3                        | Source files, parser inferences, generated code, and model proposals                                      |
| External systems                                     | External Resource Reference Document v1 in Architecture Document v3     | Detected provider identifiers and AI-extracted candidate fields until reviewed                            |
| HTTP, event, data, auth, operation, and test meaning | Application Contracts v1 referenced by workloads and external resources | Framework-specific DTOs and generated bindings                                                            |
| Repository state at one exact revision               | Immutable Repository Snapshot v1                                        | A moving branch, working directory, or integration account                                                |
| Imported understanding                               | Observed Solution v1 bound to snapshot evidence                         | It never mutates approved design by itself                                                                |
| Review of differences                                | Reconciliation Proposal v1                                              | Acceptance applies only through the versioned deterministic command or operation named by the proposal    |
| Frozen solution lineage                              | Solution Revision Manifest v1                                           | Later evidence binds back to the revision and does not rewrite the manifest                               |
| Current cross-source problems                        | Active Issue v1 immutable lifecycle records                             | Validation Finding v1 remains the canonical deterministic architecture-rule output referenced by an issue |
| Verification                                         | Evidence v1 records at one exact level                                  | A lower level, a UI label, or a successful unrelated check never implies a higher level                   |

Architecture Document v1 and v2 and Workload Behavior v1 remain readable,
immutable contracts. Architecture Document v3 is the current atomic envelope.
Its reviewed migration from v2 preserves all existing graph and Workload v1
meaning, maps Workload v1 to Workload v2 without guessing new behavior, and adds
empty external-resource and application-contract collections bound to the same
document and revision identity.

## Authority and mutation

AI output, repository parsing, inferred relationships, build diagnostics, plans,
deployment results, and drift are untrusted proposal or evidence data. They may
explain, recommend, or populate a bounded review record. They cannot directly
change Architecture, Workload, External Resource, or Application Contract truth.

Architecture graph mutations continue through atomic Graph Command batches with
exact preconditions. Accepted workload and external-resource changes use their
reviewed, versioned deterministic domain operations. Generated resources retain
explicit lifecycle and inverse rules. No operation may silently adopt,
customize, delete, import, or create an externally managed resource.

## Designed, imported, generated, planned, deployed, and drift layers

- **Designed** contains approved Intent, Architecture, Workload, External
  Resource, and Application Contract meaning.
- **Imported** contains immutable Repository Snapshots and Observed Solutions.
- **Generated** contains deterministic artifacts and accepted, bounded
  AI-authored extensions with ownership and validation records.
- **Planned** contains cloud plan or change-set evidence for one immutable
  Solution Revision and safe environment identity.
- **Deployed** contains the exact approved deployment plus smoke/integration
  evidence for that revision and environment.
- **Current drift** contains a customer-owned, read-only observation compared
  with the approved deployed evidence. It is never the deployment baseline.

Records can refer across layers, but later layers do not rewrite earlier ones.
Evidence levels are independently established: structural validity;
provider/architecture validity; deterministic target compilation; AI-extension
parse/static validity; application build and tests; cloud plan/change-set;
deployment and smoke/integration; repository conformance; and deployed drift.
The versioned continuous-conformance report keeps all six projections distinct,
marks partial/stale/invalid evidence explicitly, and creates review-only Active
Issues rather than one merged graph or automatic correction. See
[Continuous conformance](CONTINUOUS_CONFORMANCE.md).

## Solution Revision and generation coverage

A Solution Revision Manifest is immutable and binds the exact design hashes,
included repository observations, contract versions, tool and policy versions,
assumptions, unresolved decisions, source ownership, generation coverage,
AI-extension references, and the issue/evidence identifiers known at freeze
time. Evidence created later names the Solution Revision; it never changes the
manifest.

Generation coverage is explicit per workload and for the solution:
`infrastructure-only`, `starter-application`, `complete-supported-pattern`,
`ai-assisted-custom-validated`, `custom-implementation-required`, or
`target-unsupported`. Each claim requires its configured exact evidence. Parse
or syntax success alone cannot establish application completeness.

Coverage authority resolves every referenced Evidence record against the
immutable Solution Revision. The record must exist exactly once, bind the same
revision, be current, contain only passing checks, use the exact Evidence level,
and include a passing check that explicitly names the coverage requirement.
Deterministic infrastructure compilation and deterministic application
generation share level 3 but require distinct check claims; application
build/tests and application security share level 5 with the same distinction.
One check cannot be relabeled or inferred to satisfy another requirement.

Active Issue closure uses the same fail-closed authority. Closure requirements
are immutable across lifecycle records and name an exact Evidence level and
check ID, never a minimum rank. A resolved record must reference unique,
current, passing Evidence for the same Solution Revision, and the matching check
must explicitly name the issue. Missing, stale, failed, unrelated, or
higher-ranked evidence cannot close it.

The exact authenticated-notes Node.js 24/TypeScript family now has deterministic
complete-pattern generation and isolated build evidence. Prompt 36A may validate
an exact AI-custom candidate under that same reviewed runtime, but it does not
advertise arbitrary applications, broader Terraform, production CloudFormation,
any Region, or deployment as complete.

## Repository package and ownership

The deterministic package roots are:

```text
cloudmarkup/
  solution.json
  architecture.json
  workloads.json
  external-resources.json
  repository-snapshots/
  contracts/
  cloudmarkup.lock.json
  cloudmarkup.manifest.json
application/
infrastructure/
diagram/
evidence/
.github/workflows/
  cloudmarkup-validate.yml
  cloudmarkup-plan.yml
  cloudmarkup-deploy.yml
  cloudmarkup-smoke.yml
  cloudmarkup-drift.yml
```

Every managed path declares one ownership class: source, generated, AI-authored,
user-owned, imported observation, or approved extension. Lock and manifest
records bind exact content, generator/importer versions, inputs, regeneration
policy, semantic-diff behavior, and conflicts. Regeneration fails closed on
ownership or baseline mismatch. There is no second diagram DSL.

Local repository import/conformance, GitHub import/synchronization, GitHub
export, and customer workflow execution remain separate capabilities:

- Prompt 33C parses a bounded local snapshot and reports immutable observations,
  reconciliation choices, and conformance without repository mutation;
- Prompt 40B may later obtain an exact GitHub revision and propose reviewed
  synchronization/reconciliation;
- Prompts 39 and 40 export exact reviewed artifacts through a GitHub App-created
  feature branch and pull request; and
- Prompt 40A generates the five exact optional workflow files above as reviewed
  artifact data. Only the customer repository and its GitHub/AWS configuration
  can execute them.

No capability may merge, force-push, execute repository content, infer
credentials, mutate approved design, or grant Cloud Markup deployment authority.
Workflow files require the GitHub App's existing Workflows permission and exact
per-file confirmation; export without them remains possible with a readiness
warning.

## Model, billing, CLI, CI/CD, and deployment boundaries

All model access remains behind the provider-neutral `ModelGateway`. Prompt 35
provides the first live-capable Bedrock Runtime adapter, but it is opt-in,
environment configured, and was not invoked for Prompt 36A; deterministic fakes
remain the local/CI default. Exact enabled model/profile IDs, Regions, prompt
versions, evaluation thresholds, lifecycle, and retention settings remain
reviewed deployment decisions and are never guessed in contracts. Model output
remains schema-constrained proposal or candidate data.

Solution records do not grant or spend customer credits. Any provider model call
must separately pass Prompt 24A/34A entitlement policy, atomically reserve
organization credits, and append settlement, release, expiration, compensation,
or provider-failure usage evidence. Provider token/cost evidence is not the
customer credit ledger.

The Prompt 33B deterministic local CLI validates, inspects, and diffs exact
repository/revision artifacts without model, secret, cloud, arbitrary command,
or deployment access. Prompt 40A's deterministic generator produces exactly the
five allow-listed customer-owned workflow paths. Pull-request validation is
credentialless; plan, deploy, and drift use separate customer-owned short-lived
OIDC roles and state, while smoke uses no cloud role. Every environment has an
independent saved plan, approval, and Evidence chain. The saved-plan manifest
binds the exact revision, commit, environment, backend/workspace, locks, inputs,
tool versions, expiry, and checksums; deploy never re-plans. Deployment creates
a receipt that bounded smoke and refresh-only drift must verify against the
exact environment, commit, revision, and target authority before further work.
Staging and production also verify the exact predecessor deployment and passing
smoke receipts.

The approved backend is represented by one strict versioned `aws-s3` descriptor
and the exact Terraform-root `backend.hcl`; its six reviewed assignments are
parsed and Region-bound rather than passed through as arbitrary backend input.
Terraform `.tf` and `.tf.json` content is inspected with bounded deterministic
HCL/JSON parsing that rejects actual modules, provisioners, malformed input, and
limit exhaustion without treating inert comments, strings, or heredocs as
blocks. Plan, deploy, smoke, and drift also recheck the exact immutable
repository identity and private visibility before protected artifact or OIDC
work. Smoke has no cloud role and its runtime endpoint must match the exact
reviewed per-environment digest.

Cloud Markup validates and exports those files but cannot execute them, receive
customer credentials, manage state, approve an environment, merge, or deploy.
The generated validation file currently runs package integrity and then stops at
an explicit activation hold before Terraform, not the full operational Prompt
33B pipeline. Beta or production activation remains blocked until both a
reviewed published Prompt 33B CLI distribution, digest, installation procedure,
and support policy exist and the selected GitHub Environment protection rules
are authoritatively verified at the execution boundary. Prompt 40A made no live
AWS call, GitHub repository mutation, GitHub Actions run, Terraform plan/apply,
or deployment. Repository-owned Cloud Markup development CI proves only this
product repository.

Platform infrastructure under `infra/platform` is TypeScript AWS CDK for the
Cloud Markup service and synthesizes four nonempty capability/lifecycle stacks
without bootstrap, deployment, credentials, or AWS calls. Customer
infrastructure follows the standalone Go compiler path; Prompt 29 renders only
the exact supported Terraform family, while application generation/build and
Prompt 36A candidate validation remain separate. The systems share no
credentials, deployment role, artifact authority, or execution capability.
Prompt 36A does not assemble accepted extension bytes into compiler output.
Cloud Markup does not apply, deploy, or hold customer cloud credentials.

## Same-UI assistance rule

Guided and Professional preferences use the same component tree, controls,
dimensions, fields, source documents, mutations, validation, generation, and
evidence. Assistance may change wording, contextual education, recommendations,
and optional technical disclosure only. It cannot change product authority or
what counts as proof.

## Prompt 36A candidate, evidence, and acceptance authority

`@cloudmarkup/ai-extension-generation` keeps candidate bytes in a restricted,
content-addressed, tenant/project-scoped artifact boundary. Ordinary review
records contain only file paths, sizes, digests, ownership, source kind,
provenance, validation results, sanitized diagnostics, assumptions, unresolved
items, expected tests, attempts, progress, Evidence, Active Issues, and
`writeAuthority: "none"`. Invalid bytes are retained through a separate
restricted invalid-candidate record for bounded debugging, never in logs or
member-readable issue text.

The coordinator requires exactly one qualifying level-4
`ai-extension-parse-static-validity` claim for the exact candidate artifact. For
applications that claim comes from the coordinator's deterministic static
checks; Terraform and CloudFormation require it from their actual target runner.
An application candidate additionally requires exactly one level-5
`application-build-and-tests` Evidence record from the Prompt 32A AI-custom
profile, with both build/test and application-security coverage claims.
Terraform and CloudFormation candidates do not fabricate deterministic compiler
Evidence. Each qualifying record binds the same immutable Solution Revision,
exact candidate artifact digest, media type, byte size, and all-passing checks;
a bundle-only, duplicate, different, or higher-level record cannot substitute.

Required failures and blocking unresolved behavior create deterministic Active
Issues. Issue identity comes from exact target/check/affected-reference
authority, not editable human copy. Every lifecycle transition appends an
immutable record: an issue stays current until a complete superseding assessment
marks it stale, and it resolves only when exact current passing Evidence names
that issue. Stale and resolved history remains inspectable; validation
completion never silently deletes a record. The coordinator awaits bounded,
strictly sequenced live progress snapshots before generation, validation, or
repair advances. Those snapshots form a digest-verifiable prefix carrying the
exact current issues, append-only history, and artifact/review/bundle bindings.
Terminal generation creates one immutable finalization seal over the complete
prefix, terminal result, and final Evidence/issues/history counts and digests.
Later edits preserve that generation seal rather than rewriting history.

Inspect, edit, accept, reject, and deterministic-fix application first call a
host-owned authorization port. Only an allowed decision derived from verified
authentication context and bound to the exact action, principal,
organization/project, review, artifact digest, and source revision is valid.
Model output and request bodies cannot choose that authority.

The store gives every artifact exactly one immutable review identity-and-digest
binding. All later operations must rejoin it. An edited chain additionally uses
immutable historical reads to verify each predecessor review binding, artifact
lifecycle transition, replay authority, and append-only edit revalidation
authority.

Authorized inspection reads the exact tenant/project-scoped artifact only after
the review, decision, and artifact digests rejoin. A file edit is an exact
prior-digest replacement request, not a repository write. It rehashes the owned
content, reruns path/content/secret/ownership safety and the complete applicable
validator from the stored sanitized replay context, and creates fresh Evidence,
issues, progress, artifact, and review identity before one atomic stale-safe
supersession. The predecessor and model artifact remain immutable; repeated
edits append exact authorization and per-file lineage. Failed validation,
tampered lineage, or a stale race leaves the predecessor current. Each
successful edit appends an immutable revalidation authority binding the exact
edit decision, cumulative file lineage, parent artifact/review/generation seal,
validation result, and monotonic Evidence, issue-history, and current-issue
prefixes.

Reviewed deterministic issue fixes are separately bounded to a host decision
allowing the exact `apply-deterministic-fix` action and canonical operation
digest for the organization/project, review, artifact, source revision, current
issue record/version/digest, and source content/visual hashes. Only then may the
preconditioned Graph Command v1 batch run through the pure domain engine. Its
result derives `reviewedBy` from the allowed decision and returns that decision
ID, exact changes, and an inverse, but no persistence or deployment authority.
An AI-only fix is rejected.

The strict presentation adapter is mounted on the existing artifact-review route
with host-supplied authorized review/inspection/replay records and edit/accept
callbacks. It rehashes route, review, artifact, and file authority and exposes
no candidate bytes when any input is stale or malformed. Primary issue text
remains plain English; optional technical detail exposes files, schemas, tool
diagnostics, model provenance, and exact fix references under identical Guided
and Professional authority. The bounded context also exposes assumptions,
unresolved questions, expected tests, Evidence, and ordered privacy-safe attempt
summaries; raw provider-attempt prompts, responses, repair sections, secrets,
and unrestricted diagnostics remain outside presentation.

A review is `ready-for-acceptance` only when all required validation has passed,
exact Evidence is present, and no current error/security issue or blocking
unresolved item remains. Acceptance and rejection authorize the exact current
review, then reread the current artifact and immutable binding; concurrent
supersession fails closed. Edited acceptance also rejoins every immutable
historical predecessor and append-only revalidation authority. Acceptance then
rechecks the current review digest, artifact bytes/digest, source Solution
Revision and frozen Evidence, validation, issue state, ownership, and exact
ordered model/prompt/usage attempt records. It returns:

- an accepted Prompt 24D `AiAuthoredExtensionV1` rebound to a distinct immutable
  successor Solution Revision;
- that successor manifest with re-bound Evidence, coverage, issue pins,
  extension membership, and approved-extension/user-owned source lineage; and
- one digest-bound immutable export input containing the exact review, artifact,
  attempts, Evidence collection, and user modifications.

Acceptance does not mutate the source revision or canonical design, write or
materialize a repository, assemble a compiler extension, or deploy. The export
input grants restricted artifact-read authority only and explicitly carries no
repository-write or deployment authority. Rejection is equally explicit,
reauthorized, and cannot create a successor revision. Prompt 37 composes these
records into one strict Assistant review workflow without merging observed and
designed authority or writing a repository. Production database/job transport
remains separate. Current CloudFormation catalog metadata is pending; only an
exact injected reviewed schema/readiness authority can satisfy its candidate
check, and no production CloudFormation compiler support is implied.

## Prompt 37 repository reconciliation in the Assistant

The Assistant may propose only typed accept, reject, or ignore decisions for an
observed repository difference. Each decision pins the exact approved difference
and repository evidence; invented paths, commits, checksums, or observations
fail closed. Applying the batch changes only the detached designed candidate and
its review sidecars. It does not edit, commit, push, merge, or otherwise mutate
the repository.

The shared review presents imported-observed versus designed state separately,
including ownership and generated/user-owned file impact. Active Issues never
disappear: a complete superseding assessment may mark an issue stale, and exact
passing Evidence is required to resolve it. Accepting the workflow returns only
the reviewed detached candidate with no repository-write or deployment
authority.
