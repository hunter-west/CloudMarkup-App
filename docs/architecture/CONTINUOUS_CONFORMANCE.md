# Continuous conformance

Status: implemented M5 Prompt 47B contract and bounded local/test surfaces;
production evidence collection and durable lifecycle composition are not
configured.

This system answers whether approved intent, repository observations,
deterministic output, a reviewed cloud plan, an approved deployment, and a
read-only drift observation agree. It does not merge those states and it does
not promote evidence into approved design.

## Independent projections

Every report is bound to one organization-authorized project, one immutable
Solution Revision, and one environment. It contains exactly these projections:

1. `designed`: the approved Architecture, Workload, External Resource, and
   application-contract documents in the Solution Revision. This is the only
   approved-design authority.
2. `imported`: the exact pinned Repository Snapshot plus deterministic inferred
   facts and source locations. It is observed evidence, never an approval.
3. `generated`: deterministic compiler and validated AI-extension manifests,
   files, policies, application artifacts, and contract bindings for that
   Solution Revision.
4. `planned`: a sanitized Terraform saved-plan JSON projection or sanitized
   CloudFormation change-set representation. Change-only or incomplete inputs
   are marked partial and cannot prove inventory absence.
5. `deployed`: attestations for the exact approved saved plan or change set,
   workflow, environment, commit, artifacts, and smoke/integration results.
6. `current-drift`: a read-only customer-owned observation compared with the
   approved deployment evidence. It is never treated as the deployed baseline.

Unavailable, partial, stale, expired, invalid, and unknown evidence remain
visible. The report never describes partial mapped evidence as a complete cloud
inventory.

## Deterministic comparison

Facts carry stable subject keys, semantic digests, evidence references, source
locations, ownership, management state, exposure, application bindings, plan
operations, and digest-only IAM permissions. The evaluator compares:

- designed to imported and generated;
- designed to planned and deployed, subject to evidence completeness; and
- deployed to current drift.

Every semantic digest also declares a versioned comparison basis and coverage.
Hash equality or inequality is conclusive only when both facts use the same
contract version and basis with `complete` coverage. `partial`,
`operation-only`, cross-version, or cross-basis facts produce explicit unknown
evidence instead of a false match or mismatch. Plan operations and drift
classifications remain independently reportable from their validated evidence.

It classifies matching resource, connection, and configuration facts; designed
facts missing from complete current evidence; observed facts absent from the
design; generated drift; create, update, delete, and replace operations; IAM
expansion or reduction; network/public-exposure changes; external or unmanaged
resources; ownership/import mismatches; application contract or artifact binding
mismatches; managed, unmanaged, permission, network, application, and unknown
drift; and evidence quality findings.

Stale, expired, invalid, or unavailable layers do not produce semantic
conclusions. Partial or unknown layers may report positive mismatches from facts
they contain, but may not manufacture missing-resource findings. Approved user
extension points are preserved and do not become generated-file drift merely
because their content is user-owned.

Every non-matching finding creates a canonical Active Issue with no automatic
fix. Re-evaluation may supersede or close an issue only through the existing
issue lifecycle and Evidence rules. Reconciliation is a reviewed action or PR,
never a silent overwrite.

## Plan and deployment evidence

Plan evidence is accepted only after validating its Solution Revision,
repository commit, generated manifest, backend/workspace or stack identity, tool
version, sanitized representation checksum, and expiration. Sensitive values are
rejected or redacted before evidence storage. Cloud Markup parses the sanitized
representation and never runs `terraform apply`, creates a change set, or
executes a deployment from this boundary.

Deployment evidence is valid only when the receipt names the exact approved
saved-plan or change-set identity and the expected workflow, environment,
commit, and artifact attestations. Missing or mismatched identifiers invalidate
readiness. Smoke and integration results are independent evidence; deployment
without them remains visibly incomplete. The deployed diagram contains only
safely mapped facts.

## Drift and repository reconciliation

Drift evidence may be supplied only through an explicitly configured adapter
backed by a customer-owned read-only role or workflow. This repository does not
compose or invoke a production drift collector. Reviewed issue/PR request
contracts and fake adapters prove the proposal path; no live GitHub writer or
automatic remediation adapter is runtime-composed.

Repository conformance compares the pinned Snapshot and generated manifest with
the Solution Revision. Generated-file edits, source ownership mismatches, and
approved extension changes remain distinct. Generated ownership never permits
silently overwriting user-owned content.

## Freshness

Freshness policy is versioned and deterministic. It selects an exact
environment/evidence rule with an `any` fallback. Rules may be revision-bound,
maximum-age bound, or require an explicit expiry. Revision changes invalidate
generated, planned, deployed, and drift readiness; designed and imported layers
remain identifiable historical projections. Integrity failures outrank expiry,
which outranks staleness.

The reviewed `cloudmarkup.conformance.default-v1` policy applies these fallback
rules to every environment unless a later reviewed policy supplies an exact
environment-type override:

| Evidence type                              | Default expiration                   | Newer Solution Revision          |
| ------------------------------------------ | ------------------------------------ | -------------------------------- |
| Approved documents                         | Revision-bound historical projection | Retain as historical design      |
| Repository Snapshot                        | 24 hours after verification          | Retain as historical observation |
| Generated manifest                         | Revision-bound                       | Invalidate readiness             |
| Terraform plan / CloudFormation change set | Explicit expiry required             | Invalidate readiness             |
| Deployment, smoke, and integration         | 24 hours after verification          | Invalidate readiness             |
| Read-only drift                            | Explicit expiry required             | Invalidate readiness             |

An environment-specific rule must be part of a new versioned, server-selected
policy. Browser state, repository input, and evidence payloads cannot select the
clock, current revision, evaluator, or freshness policy.

The report records `evaluatedAt`, `lastVerifiedAt`, calculated or explicit
expiry, source revision bindings, the policy identifier and digest, and
machine-readable freshness reasons. Evaluation uses the supplied timestamp and
performs no clock, filesystem, network, credential, or model access.

## Surfaces and safety

- The API authorizes `projects.read` before querying a tenant-scoped evidence
  source and rejects report bindings that differ from the route.
- The Architecture CLI accepts conformance only through an explicit read-only
  local port, validates the complete report, and emits a bounded sanitized
  summary and drift exit code.
- Export and editor diagrams share Designed, Imported, Generated, Planned,
  Deployed, Current drift, and Differences controls, legend, and provenance.
  Assistance modes keep the same controls and structure; wording alone may
  differ.
- Customer workflow generation emits inactive, no-credential PR verification and
  explicit operator/deployment evidence seams. CloudFormation and Terraform may
  differ in syntax and evidence shape while preserving architecture intent.

No conformance surface can approve design, apply a plan, execute a change set,
deploy, use customer credentials, overwrite repository content, or remediate
drift automatically.

The default API fails closed with an unavailable conformance application. The
local server refuses production mode and can prove only the bytes in its local
manifest; all six self-attested evidence layers are deliberately projected as
unavailable/unknown with no facts. Its report snapshots and Active Issue history
are in-memory only. Production still requires tenant-scoped durable snapshot and
issue stores, trusted current-revision state, and explicit plan, deployment, and
drift ingestion/collection adapters. Diagram and GitHub review-action adapters
remain injectable tested seams rather than default runtime integrations.
