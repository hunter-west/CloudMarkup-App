# ADR-0039: Independent continuous-conformance projections

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Accepted
- **Date:** 2026-08-29
- **Owners:** Cloud Markup product and engineering
- **Supersedes:** None
- **Refines:** ADR-0005, ADR-0007, ADR-0025, ADR-0033, and ADR-0036
- **Superseded by:** None

## Context

Cloud Markup has separate approved design documents, repository observations,
deterministic generated artifacts, customer-owned plan and deployment evidence,
and read-only drift observations. Each source has different completeness,
freshness, security, and lifecycle properties. Treating them as one graph or one
verification state would let partial or stale evidence displace approved intent,
or let a lower Evidence level imply a plan, deployment, or complete inventory.

The product also needs one consistent way to compare these sources, create
cross-source Active Issues, render state-specific diagrams, and prepare reviewed
reconciliation actions without gaining repository-write, cloud-mutation, or
deployment authority.

## Decision

Continuous conformance uses one strict versioned report containing exactly six
independent projections for one tenant-authorized project, immutable Solution
Revision, and environment:

1. `designed`, from approved Architecture, Workload, External Resource, and
   application-contract documents;
2. `imported`, from an exact Repository Snapshot and deterministic inferred
   evidence;
3. `generated`, from deterministic compiler and validated application or
   AI-assisted generation artifacts;
4. `planned`, from a sanitized Terraform plan or CloudFormation change-set
   representation;
5. `deployed`, from an exact approved-plan/change-set deployment attestation and
   smoke/integration evidence; and
6. `current-drift`, from a customer-owned read-only observation bound to the
   approved deployment evidence.

Only `designed` has approved-design authority. Every other layer is evidence
only. Comparison never merges layers, silently promotes evidence, edits source
documents, or treats presentation layout as semantic input.

### Normalization and comparison

Provider and workflow adapters reduce untrusted source material to bounded,
redacted, stable facts with exact source, Evidence, Solution Revision,
environment, ownership, and mapping references. The deterministic domain
evaluator compares designed with imported, generated, planned, and deployed, and
compares deployed with current drift. It emits stable classifications and Active
Issues; it does not call a model, filesystem, repository, network, cloud
provider, clock, or renderer.

Each fact declares a versioned semantic comparison basis and whether its
coverage is complete, partial, or operation-only. Digest equality or inequality
is conclusive only for complete facts with the same contract version and basis;
otherwise comparison yields explicit unknown evidence. A plan operation or
validated drift classification remains useful evidence without pretending that
its source-specific digest is equivalent to approved design intent.

Positive absence claims require complete current evidence. Partial or unknown
evidence may report facts it positively contains but cannot imply missing
inventory. Unavailable, stale, expired, or invalid evidence remains visible and
cannot establish semantic agreement.

### Identity and freshness

Plan evidence must bind the exact Solution Revision, repository commit,
generated manifest, backend/workspace or stack, tool version, sanitized
representation checksum, and expiry. Deployment evidence must rejoin the exact
approved saved-plan or change-set identity, environment, workflow, commit, and
artifact attestations. Drift evidence must rejoin an independently trusted
deployment baseline and stay read-only.

A versioned policy determines freshness by evidence type and environment. A
newer Solution Revision invalidates generated, planned, deployed, and drift
readiness for the older revision without rewriting its historical evidence.
Integrity failure outranks expiry, and expiry outranks ordinary staleness.

### Reconciliation and presentation

Every non-matching result requires review and has `automatic: false`. Repository
reconciliation preserves approved user extension points and may prepare a
reviewed Graph Command, known GitHub issue, or reconciliation pull request. It
never overwrites, commits, merges, deploys, applies, or remediates
automatically.

Editor and export surfaces expose the same Designed, Imported, Generated,
Planned, Deployed, Current drift, and Differences controls in every assistance
mode. State diagrams draw only safely mapped facts, retain unmapped evidence and
quality warnings explicitly, and never imply a complete inventory unless the
source establishes completeness.

## Consequences

### Positive

- Authority, provenance, staleness, and partial evidence remain explicit.
- Terraform and CloudFormation can have different evidence syntax while sharing
  target-neutral comparison semantics.
- CLI, API, Issues, diagrams, exports, workflows, and GitHub reconciliation can
  consume one integrity-checked report without receiving mutation authority.
- Exact identifiers and content digests make replay, mismatch, and audit tests
  deterministic.

### Negative

- Six projections, source adapters, freshness rules, and cross-source mappings
  add contract and test surface.
- Partial plan, deployment, or drift evidence must stay conservative, so a
  report may remain unknown even when an operator expects a simple answer.
- Durable collection and lifecycle composition still require explicit adapters;
  a missing adapter must fail closed rather than synthesize evidence.

## Alternatives considered

### Maintain one continuously corrected architecture graph

Rejected because repository, generated, planned, deployed, and drift evidence
cannot silently acquire design authority.

### Use one overall pass/fail status

Rejected because freshness and completeness differ by source, and lower-level
success cannot establish plan, deployment, repository, or drift proof.

### Automatically repair drift or overwrite generated files

Rejected because remediation changes customer repositories or cloud state and
requires separate authorization, review, and execution authority.

## Compatibility, security, and rollback

The contract is additive version 1 and rejects unknown versions and extra
fields. Reports and nested differences are canonically hashed; tenant-owned API
reads authorize before source lookup. Inputs retain only bounded safe text,
relative source locations, identifiers, and digests, never sensitive values, raw
prompts, credentials, private repository bodies, plan values, or cloud
responses.

Rollback disables the additive adapters and API/UI consumers while preserving
existing immutable Evidence, repository snapshots, Solution Revisions, export
artifacts, and customer-owned workflows. No database rewrite, repository
rollback, plan apply, change-set execution, or cloud rollback is implied.

## References

- [Continuous conformance](../architecture/CONTINUOUS_CONFORMANCE.md)
- [Solution, repository, and Evidence](../architecture/SOLUTION_REPOSITORY_AND_EVIDENCE.md)
- [Local repository import and conformance](../architecture/LOCAL_REPOSITORY_IMPORT_AND_CONFORMANCE.md)
- [Testing strategy](../architecture/TESTING_STRATEGY.md)
- [Product specification](../product/PRODUCT_SPEC.md)
- [User workflows](../product/USER_WORKFLOWS.md)
- Prompt 47B execution plan
- [ADR-0025](0025-canonical-solution-repository-and-evidence-contracts.md)
- [ADR-0033](0033-deterministic-repository-import-parser-boundary.md)
- [ADR-0036](0036-customer-owned-receipt-bound-ci-cd.md)
