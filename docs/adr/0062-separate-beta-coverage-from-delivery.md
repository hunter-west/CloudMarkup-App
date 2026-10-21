# ADR-0062: Separate beta coverage collection from deployment admission

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

Reviewed against [the ADR-writing checklist](CHECKLIST.md) and accepted after PR
33 merged and the exact main release passed.

- **Status:** Accepted
- **Date:** 2026-09-24
- **Owners:** Cloud Markup product and platform
- **Supersedes:** None
- **Superseded by:** None

## Context

The controlled beta deploys the operator-owned platform from a reviewed main
commit. Release verification currently repeats the selected beta test suite with
V8 coverage after pull-request CI has run the same tests without
instrumentation. On September 24, release run 35961170778 consumed about 240
Linux runner minutes before deployment, including about 197 minutes across eight
instrumented shards. The final gate could not obtain a runner because of an
account payment or spending-limit failure. The owner requested a simpler, less
expensive delivery path and explicitly approved moving coverage off each
deployment while retaining the existing beta test selection, browser, security,
build, and smoke checks.

Coverage reports have no numeric release threshold in this repository. Their
collection and merge provide diagnostic evidence, while test success is the
deploy-blocking signal. The platform/customer IaC boundary and the cross-account
OIDC roles in [ADR-0040](0040-regional-rest-ingress-origin-admission.md) and
[ADR-0041](0041-cross-account-beta-dns-ownership.md) remain unchanged.

## Decision

For each deployable push to main, the exact triggering commit runs all eight
Vitest shards without V8 instrumentation, the ordered quality job including
bounded live model composition, Chromium, security checks, and a final job that
rejects any unsuccessful dependency. Credentialless preparation builds and binds
the same-run bundle in parallel. Privileged deployment still requires successful
verification and preparation and performs the existing CloudFormation, DNS
readback, and public smoke sequence.

A read-only preflight inspects the full before/after Git diff. It skips beta
verification and delivery only when every changed file has a named test-source
suffix. Missing history, unexpected checkout, malformed revisions, empty diffs,
and any other changed path require the complete delivery path.
Documentation-only pushes keep the existing trigger exclusion. The test matrix
cancels remaining shards after one failure; a canceled matrix cannot pass the
final gate.

The credentialless CI workflow collects and merges all eight coverage reports on
a weekly schedule and through manual dispatch. Coverage runs use the same
bounded beta test selection and separate complete model-composition case.
Neither scheduled nor manual CI can deploy or acquire AWS credentials. Coverage
is diagnostic rather than a per-deployment prerequisite.

This decision changes verification scheduling only. It does not change
application, graph, compiler, IaC, tenant, schema, or deployment artifact
contracts. The existing AWS roles, permissions, environments, and stack order
remain in force.

## Consequences

### Positive

- Each deployable revision still proves test, browser, security, build, bundle,
  and smoke success while avoiding repeated coverage instrumentation and report
  merge.
- Test-only changes avoid a full release, and failed shards stop wasting sibling
  runner time.
- Scheduled coverage preserves periodic complete reports without making every
  deployment pay for them.

### Negative

- A coverage-only regression can reach beta before the next scheduled or manual
  coverage run. The weekly run consumes runner minutes even when no deployment
  occurred.
- The read-only preflight and dual CI profiles require exact policy tests and
  operational monitoring. A skipped test-only release does not prove a new
  deployment.
- The first successful release used 177.3 predeployment runner minutes versus
  234.4 in the preceding failed release attempt. This 24% reduction is a
  measured raw runner-minute comparison; the earlier run stopped before
  deployment, so end-to-end wall time is not comparable.

### Follow-up

- The full local and hosted gates, exact main release, and first manual
  eight-shard coverage merge passed. Monitor the scheduled Monday run and
  reconsider its cadence if diagnostic value or runner cost changes.
- Keep the report and deployment result separate in status and handoff.
  Reconsider the cadence if coverage-only regressions become frequent or cost
  changes materially.
- Restore per-deployment coverage by reverting the workflow change if periodic
  coverage fails or release evidence is inadequate.

## Alternatives considered

### Keep instrumented coverage on every deployment

This preserves the current report timing but repeats the costly instrumentation
for the same test selection. Reconsider if the beta requires coverage as a
deploy-blocking artifact or runner cost ceases to matter.

### Trust pull-request checks instead of verifying main

This could remove more repeated work but requires a trustworthy tree or artifact
binding across merge methods and direct pushes. The current exact-commit gate
remains simpler to audit and fails closed without that new trust mechanism.

### Use GitHub path filters for test-only changes

GitHub's path-filter diff limits can miss files in large pushes. The full Git
diff preflight treats uncertainty as deployable and preserves exact source
binding.

## References

- Beta deployment cost plan
- Controlled beta runbook
- [Definition of done](../engineering/DEFINITION_OF_DONE.md)
