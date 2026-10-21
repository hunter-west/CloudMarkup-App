# ADR-0080: Defer draft verification and compact generated contracts

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Accepted; exact-candidate checks and merged-source delivery passed
  2026-10-01
- **Date:** 2026-10-01
- **Owners:** Cloud Markup product and platform
- **Supersedes:** ADR-0065 for draft pull-request verification and local release
  aggregate composition
- **Superseded by:** None

## Context

The owner supplied 5,572 Actions minutes, with 3,792 attributed to CI, and
requested substantial repository and test reduction without losing active
features. Repeated intermediate PR runs incur the full setup and integration
cost. One PostgreSQL suite took 1,146.503 seconds in the final PR-41 run.
Generated contract JSON is a larger source-size category than authored tests.
See the reduction plan.

## Decision

Draft PRs run scope classification, the applicable formatting/lint or
documentation checks, and security. Builds, quality integration checks, test
shards, browsers and native proofs wait until the PR is ready for review.
`Quality gates` deliberately fails for a draft or unknown review state. A draft
run can never stand in for merge verification, even when its small checks pass.

PR draft state is serialized with `toJSON` before comparison and gate input.
Only the JSON boolean `false` permits ready admission; missing, null or string
values cannot be coerced into approval by GitHub's
[loose comparison rules](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions#operators).

CI and native workflows explicitly handle `ready_for_review` and
`converted_to_draft`, alongside opened, synchronized and reopened PRs. Marking
ready runs the complete existing profile on the exact current merge candidate;
returning to draft cancels obsolete PR work through existing concurrency groups.
The native workflows retain their same-repository and path guards. These events
are explicit because GitHub's
[default PR activity types](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request)
do not include review-state transitions.

Ready PRs, manual and scheduled runs, exact-release verification, fresh native
proofs, same-run deployment bundles, environment/OIDC safeguards and public
delivery smoke checks retain their existing requirements. There is no cached
test result, label-based bypass, changed branch protection or skipped release
check. Contributors should keep unfinished work in draft and batch locally
verified changes before requesting full hosted verification.

Generated JSON Schema and OpenAPI files use compact JSON with a trailing
newline. Authoritative typed source remains readable. Generation checks enforce
exact storage bytes, and contract tests compare the complete parsed objects. The
Go compiler retains its own identical embedded schema copies and drift checks.
This changes whitespace only: schema IDs, versions, properties, constraints,
ordering and references stay identical. Public canonical document serializers,
historical fixtures, golden application artifacts, catalog history and SQL bytes
are unchanged. No data migration or contract version change is needed.

Repeated schema-drift test bodies become one exhaustive artifact inventory
check, retaining the specific ID and forbidden-field assertions. Behavioral,
tenant, concurrency, accounting and historical compatibility tests remain.
Test-only SQL proposal setup shares one implementation while preserving each
original digest, applicable statement count and both transaction guards.

The fixed synthetic seed source may reuse one private, validated scaffold per
module instance because its recipe accepts no caller input or clock. Every
caller receives a deep copy. Configured-source validation still runs on every
read; tenant state, authorization, financial records, invocation results and
execution evidence are never cached. Mutation/rejection tests and exact-byte
comparisons must pass before accepting this optimization.

The local release aggregate invokes the complete root gate once, then the
remaining unique browser, OpenAPI, deployment-input, golden, performance,
dependency-audit, synthesis and artifact checks. It no longer invokes broad
workstream wrappers whose lint/type/build/Vitest checks already ran in the root
gate. The
[command coverage map](../engineering/REPOSITORY_FOOTPRINT.md#reduction-decisions)
records the retained checks. Focused workstream commands remain available.

## Alternatives and consequences

Removing tests solely for their count would discard distinct failure cases.
Keeping all generated indentation imposes substantial repository size without
additional contract information. Removing generated public artifacts entirely
would break declared exports and independent compiler builds. Cross-run PR
verification reuse would introduce a new evidence trust boundary; it is not part
of this change.

Compact generated diffs are less readable; review their typed producers and
complete semantic comparisons, and pretty-print a generated file when needed.
Draft checks intentionally show an incomplete merge gate. Savings depend on
using drafts for unfinished work, runner conditions and actual fixture costs;
file counts and estimated avoided runs are not measured billing savings.

The change creates no deployment, credential, provider, network or model
authority. Roll back workflow conditions, gate policy and its tests together;
restore artifact formatting with its generators, tests and compiler copies. The
private scaffold reuse can be reverted independently. Revisit this decision if
draft feedback proves inadequate, schema consumers require exact legacy storage
bytes, or the fixed recipe gains dynamic inputs.
