# ADR-0091: Lean beta verification and exact-source impact selection

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Proposed; implementation authorized by the owner on October 5
- **Date:** 2026-10-05
- **Owners:** Cloud Markup product and platform
- **Supersedes:** The test-selection and parallel-preparation cadence in
  [ADR-0062](0062-separate-beta-coverage-from-delivery.md), on acceptance

## Context

The no-user beta's local release entry point still invokes full instrumented
coverage, then repeats generation/build checks. Ready CI and main delivery use
different model-suite flags. Catalog growth also requires unrelated UI tests to
update copied service inventories. The owner authorized structural cleanup in
the implementation plan.

## Decision

Use `check:beta` as the local functional entry point and `check:beta:quality`
for its shared hosted quality work. Keep `check:full` explicit. Existing weekly
and manual CI run complete coverage plus Storybook/performance diagnostics.

Routine ready PR and main verification select changed Vitest workspace projects
and reverse transitive consumers from exact committed package manifests and the
complete Git diff. No empty selection means no work: `[]` means all projects.
Shared controls, security/data paths, unknown config/history and uncovered tests
fail back to full tests. Historical preparation uses that identical inventory.

Two real-time PostgreSQL/SDK suites run completely once without coverage in the
mandatory quality job, outside the ordinary shards. No selector or legacy
deferral flag may hide their failures. Tenant/billing/recovery browser profiles,
security checks, all builds/types, schema/catalog drift, compiler reproduction,
OpenAPI and deployment-input checks stay required.

Preparation waits for exact-source verification and restores only that run's
build cache. Its authoritative bundle still receives the existing artifact,
hash, environment and OIDC checks before privileged delivery. The compatible
`functional_beta` call input grants no skip authority.

UI catalog adapters check projection against provider source metadata and use
small explicit behavior fixtures. Provider digest, graph/version, generated
artifact and migration contract assertions remain exact.

## Consequences and rollback

UI changes avoid unrelated workspace tests and per-release coverage/report work.
Dependency graph changes need no new package-specific path list. Cold browser
bootstrap receives Vite's existing entry-file warmup; browser response
synchronization remains necessary and assertion deadlines/retries are unchanged.

Impact selection can miss an undeclared dependency; unknown shapes fail full,
mandatory critical flows remain, and scheduled complete checks expose drift.
Preparation loses parallel overlap while gaining verified cache reuse. Savings
are unmeasured until hosted execution; historical timings are not forecasts.

There is no product/data migration, new deployment authority or IAM change.
Revert this commit to restore the prior profile. Keep full checks mandatory for
an affected change whenever its risk exceeds the selector's evidence.

## Alternatives

Continuing blanket instrumented local reruns preserves measurement cadence but
repeats slow real-time fixtures. Removing failing assertions or adding automatic
retries would conceal failures. Trusting a prior PR artifact across a different
main source requires a new provenance mechanism; exact-main verification stays.
