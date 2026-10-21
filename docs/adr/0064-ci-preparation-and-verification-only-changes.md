# ADR-0064: Prepare historical evidence only for its consumer and classify verification-only changes

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

Reviewed against [the ADR checklist](CHECKLIST.md). The owner explicitly
approved this bounded CI and deployment-classifier scope on September 28.
Acceptance follows complete diff/policy review, all 12 hosted implementation
checks on `ce39f492`, and the passing full local `pnpm check` (3,666.52 s). The
final PR head still requires its own passing checks before merge.

- **Status:** Accepted
- **Date:** 2026-09-28
- **Owners:** Cloud Markup product and platform
- **Supersedes:** The test-only preflight restriction in ADR-0062
- **Superseded by:** None

## Context

September 26 release run 36255032627 spent 1,612 seconds preparing the pinned
historical AI importer in the quality job and all eight test shards. Only
`model-live-historical-importer-upgrade-postgres.integration.test.ts` consumes
that bundle. Its current shard's preparation took 208 seconds; the other eight
preparations consumed 1,404 seconds (23.4 runner-minutes). The owner confirmed
that Actions cost prevented the September 28 main and pull-request jobs from
starting and requested bounded cost reductions before more beta usage.

[ADR-0062](0062-separate-beta-coverage-from-delivery.md) keeps exact-commit
tests, separate scheduled coverage, and privileged deployment admission. Its
preflight currently treats every mixed documentation/test/CI change as
deployable. This CI-only maintenance should be reviewable and mergeable without
deploying.

## Decision

The credentialless CI test job discovers the configured Vitest specifications
and applies the same public sequencer's shard method used by execution. The new
`scripts/ci-historical-preparation.mjs` validates the exact eight-shard config,
bounded nonempty results, unique project/file identities, repository
containment, and exactly one historical consumer. It emits a decision only after
successful discovery and cleanup. Both historical checkout and preparation run
only for the shard containing that consumer. Discovery failure fails the job.
The quality job omits historical preparation because its explicit test selection
does not use it.

All test selections, worker limits, PostgreSQL services, coverage profiles,
immutable historical source binding, security checks, and final gates remain.
Tests prove all 738 specifications occur exactly once across eight partitions;
shard ownership is discovered rather than hardcoded. Vitest 4.1.10's list
command does not apply sharding, so it is not used to make this decision. A new
historical consumer requires updating this contract and its tests before
depending on it.

The full before/after Git diff preflight also treats these exact paths as
verification-only:

- `.github/workflows/ci.yml`
- `scripts/ci-historical-preparation.mjs`
- `scripts/validate-workflows.mjs`
- `scripts/beta-deployment-workflow-policy.mjs`
- `scripts/classify-beta-deployment.mjs`

Existing named test sources, `docs/`, `.agents/skills/`, and files named
README.md or AGENTS.md remain neutral when mixed with those paths. Runtime,
infrastructure, dependency, unknown workflow/script paths and uncertain history
still require the complete deployment path. Revisions must be full hashes and
match the checkout; the diff uses NUL delimiters and disables rename folding.
Malformed input fails closed. The deployment workflow trigger and privileged
jobs are unchanged.

This decision authorizes no deployment, environment approval change, test
removal, cached artifact trust, application behavior change, dependency change,
concurrency increase, or weakening of tenant isolation. Graph/compiler
contracts, determinism, provider neutrality, accessibility and billing are
unaffected. There are no data, schema or contract migrations.

## Consequences

### Positive

- Avoids eight unused historical preparations while retaining the consuming
  regression and its immutable source evidence.
- Allows the approved CI maintenance to merge without invoking beta deployment.
- Uses exact path and full-history evidence instead of broad CI directory skips.

### Negative

- The public Vitest discovery/sequencer API and historical consumer inventory
  become maintained CI contracts. Dependency or test topology changes need the
  partition and failure-path regressions.
- The explicit verification-only list needs deliberate review for every
  addition.
- The 23.4-minute reduction is an estimate from historical job steps, not an
  observed new hosted saving. Discovery adds work to each shard.

### Follow-up

All 12 hosted checks passed on `ce39f492` after funding was restored in run
36433956064, attempt 2 (private historical evidence, omitted from this
distribution). The actual setup was one 192-second preparation, eight one-second
discovery steps and a three-second historical checkout. Both consuming
regression tests passed. The PR/release profile difference prevents a total
pipeline speedup claim. The full local `pnpm check` also passed in 3,666.52 s.
Review accepted this exact scope after its negative admission, partition,
rollback and security evidence passed. Require all checks on the final PR head
before merge; any changed base needs new current-head verification. Rollback the
CI workflow, discovery helper, policy, classifier and associated tests together;
this restores repeated preparation and the narrower classifier. No database
migration or redeployment is needed to revert these changes.

## Alternatives considered

### Share one prepared artifact across all shards

Deferred: cross-job provenance, restoration checks and artifact storage/transfer
would need additional evidence. Only one shard needs this historical artifact.

### Remove tests or trust checks from another commit

Rejected: either weakens the existing exact-commit admission guarantee. Counts
alone are not evidence that a test is redundant.

### Skip all workflow changes using path filters

Rejected: broad rules would hide deployable workflow changes and inherit GitHub
path-filter diff limits. The classifier retains full Git evidence and a narrow
allowlist. Unknown paths continue through the complete deployment path.

## References

- Repository audit (private historical evidence, omitted from this distribution)
- Refactor plan, E04 (private historical evidence, omitted from this
  distribution)
- Execution record
- Controlled beta runbook
- [Current status](../PUBLIC_STATUS.md)
