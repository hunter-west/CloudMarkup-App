# ADR-0065: Reuse source-bound CI preparation and isolate documentation checks

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Accepted; final review and hosted verification completed
  2026-10-01
- **Date:** 2026-09-30
- **Owners:** Cloud Markup product and platform
- **Supersedes:** ADR-0064's exact verification-only path list, by adding the CI
  scope classifier and named contributor documents
- **Superseded by:**
  [ADR-0080](0080-draft-verification-and-compact-generated-contracts.md) only
  for draft pull-request verification and local release aggregate composition

## Context

The owner requested permanent reductions in GitHub merge and deployment cost.
The September 29 deployment spent 1,644 seconds in release quality checks and
144 seconds deploying. Eight test jobs each built workspace dependencies. The
September 30 pre-optimization candidate passed all permanent workflows; its
longest test shard took 2,212 seconds and its quality job 1,514 seconds. These
are baseline observations, not predicted savings.

[ADR-0062](0062-separate-beta-coverage-from-delivery.md) retains exact-commit
release tests and separate scheduled coverage.
[ADR-0064](0064-ci-preparation-and-verification-only-changes.md) prepares the
historical importer only in its consuming shard. This decision keeps those
boundaries while avoiding repeated compilation, unused native tool acquisition
and full application verification for ordinary documentation edits.

## Decision

The credentialless CI workflow classifies the complete raw Git diff between a
pull request's base and the exact checked-out merge candidate. Only ordinary
non-executable Markdown under `docs/`, root contributor guides, and immediate
README.md/AGENTS.md files under application, package and service roots qualify.
The exact evals/README.md, scripts/README.md, infra/platform/README.md,
infra/platform/AGENTS.md, CONTRIBUTING.md, SECURITY.md, BETA_READINESS.md and
.github/PULL_REQUEST_TEMPLATE.md files also qualify. Nested source/fixture
guides and every image-context README remain full-verification inputs. Mixed
changes, renamed executable inputs, symlinks, missing ancestry, unknown modes
and uncertain revisions require full verification or fail the job. Release,
scheduled and manual runs always use the full profile. No GitHub path-filter
result grants the reduced CI profile.

Documentation runs formatting, local links, workflow policy and the complete
security gate. Full verification requires formatting/typed lint, shared build,
ordered quality checks, all eight original test shards, Chromium and security.
The final gate rejects any failed, canceled, missing or unexpectedly skipped
dependency for either profile. Its name remains `Quality gates`.

One fresh job builds all workspaces and uploads only its Turborepo build cache.
Test shards and the browser job download the named artifact from that same run
with the existing pinned artifact actions, then invoke their original build
commands. Turborepo checks each task's source/dependency/configuration key and
rebuilds misses. No cross-run artifact, remote cache, cached test result or
deployment bundle is accepted. Partial reruns can reuse the original successful
build from the same immutable workflow run; a rerun of the producer replaces
that run's artifact. Retention is one day and already-compressed cache files are
uploaded without redundant compression.

Formatting and all typed lint rules run alongside the long quality job. Only
CI's quality command omits the duplicate assistant wrapper and duplicate static
and secret scans: the assistant suites remain in the verified eight-shard
partition, and the independent mandatory security job runs both scans. Local
full commands, test selectors, worker limits, coverage policy, PostgreSQL
isolation and all negative/historical cases remain unchanged.

The application archive runs through a pinned pnpm script so its exact
`npm_execpath` authority remains available to the offline-store verifier.
Application-only native proof jobs materialize the application image context
after validating all declared source contexts. They no longer build unused
Terraform/TFLint tools or acquire the Terraform provider. Full release image
materialization still builds both declared contexts. The application archive
receipt cannot masquerade as a complete two-image receipt.

Native proofs may cache only reviewed public Go tool binaries and licenses.
Every hit revalidates source recipes and checks exact inventory, regular
single-link files, sizes and independently pinned SHA-256 bytes before use.
Invalid entries fail closed; misses use the existing reviewed source builder.
The cache contains no application inputs, candidate source, credentials,
execution proof or deployment authority. The official cache action is pinned to
reviewed `actions/cache` v5.0.3, commit
`cdf6c1fa76f9f475f3d7449005a359c84ca0f306`, with no prefix fallback. Locked pnpm
store caching also covers security and native jobs. Native path triggers exclude
only immediate package-root README.md/AGENTS.md files and, for normalization,
the compiler-root guides after their existing positive paths. Image-context
guides and nested fixtures remain eligible.

Add `scripts/ci-change-scope.mjs` and those four exact contributor-document
paths to the existing verification-only deployment classifier list. The existing
platform delivery workflow, OIDC roles, environment approval, same-run
preparation, artifact binding, stack order and post-deployment smoke checks
remain unchanged. No PR artifact or public-tool cache enters privileged
deployment preparation.

## Consequences

The changes can reduce repeated setup and compilation and shorten the release
quality critical path. Hosted cold/warm results must establish actual savings;
the long historical seed/accounting suite remains complete and can still
dominate a full PR run. File deletion counts do not establish performance.

The shared build adds a dependency before test/browser execution and one
short-lived artifact. Cache misses and queue latency can reduce its benefit.
GitHub cache scope may prevent reuse across branches; cache size and retention
need observation. Documentation classification and the final gate become
maintained policy surfaces with fail-closed regression tests.

There are no graph, tenant, billing, provider, schema, API, migration, compiler
or generated-artifact contract changes. All execution remains on the exact
candidate. Review permissions and source provenance as part of workflow changes.
Revert the workflow, classifier and policy-test change together to restore the
former schedule; no product data migration is required.

## Alternatives considered

Keeping every repeated build and full documentation run avoids a cache/profile
contract but preserves measured waste. Reducing test cases or weakening native
isolation would discard needed regression evidence and is rejected. Trusting PR
success in place of exact merged-source verification would require a separate
reviewed provenance mechanism; this change preserves the existing release gate.
Persistent self-hosted runners and cross-run compiled artifacts add operational
and cache-trust obligations beyond this bounded work.

## Follow-up and references

Acceptance requires focused negative tests, full workflow/security review,
unchanged application selection and protected-source evidence, final hosted
checks, and honest before/after timings. Review against the
[ADR checklist](CHECKLIST.md). Implementation evidence belongs in the refactor
audit and active plan.

- [Testing guidance](../engineering/TESTING.md)
- [GitHub dependency-cache isolation](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)
- [Pinned cache action](https://github.com/actions/cache/tree/cdf6c1fa76f9f475f3d7449005a359c84ca0f306)

Acceptance on October 1, 2026 follows the complete code/workflow review,
negative policy tests, preserved source and selection evidence, all
final-candidate hosted checks, and verified exact-merge delivery in PR 41
(private historical evidence, omitted from this distribution). The audit
closeout records raw runner observations, cache conditions and remaining
bottlenecks. Earlier accepted ADR bodies remain unchanged.
