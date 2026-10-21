# Contributing to Cloud Markup

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

Follow the root [instructions](AGENTS.md) for task scope, context, and
verification. Implementation, activation, and hosted acceptance are separate
claims.

## Start with context

Confirm the assigned worktree, branch, source commit, and working tree. Define
the bounded outcome and acceptance criteria before editing. Read root and
applicable scoped instructions, then retrieve only the architecture, contracts,
and current [STATUS](docs/PUBLIC_STATUS.md)/[HANDOFF](docs/PUBLIC_STATUS.md)
sections needed for the affected boundaries. [README](README.md) is the
documentation map; [BUILD_SEQUENCE](docs/PUBLIC_STATUS.md) resolves milestone
questions. Historical evidence remains available through pinned links.

## Change workflow

1. Start from a clean understanding of the working tree; do not overwrite
   unrelated changes.
2. Use the simplest sufficient change for one authorized outcome. Reuse existing
   modules, tests, and commands; leave unrelated findings as follow-up.
3. Use an execution plan when
   [execution-plan policy](docs/engineering/EXECUTION_PLANS.md) requires one.
4. Add an ADR for a durable architectural decision using the
   [ADR-writing checklist](docs/adr/CHECKLIST.md). Do not present an unresolved
   choice as accepted.
5. Update only changed repository truth. Record detailed evidence once in the
   existing plan or PR and link it from current status/handoff when needed.
6. Verify the change and describe the evidence in the pull request.

The pinned toolchain and commands are documented in the
[workspace guide](docs/development/WORKSPACE.md). Do not add dependencies or
implementation placeholders outside the active milestone merely to broaden the
workspace.

Review changes with the repository
[code-review checklist](docs/engineering/CODE_REVIEW.md). Shared test
conventions are documented in
[engineering testing guidance](docs/engineering/TESTING.md). Completion is
governed by the [Definition of Done](docs/engineering/DEFINITION_OF_DONE.md),
and dependency changes must follow the
[dependency policy](docs/engineering/DEPENDENCY_POLICY.md).

## Documentation standards

- Use relative Markdown links for repository files and verify every target.
- Distinguish current behavior from planned behavior.
- Use normative words intentionally: **must** for a requirement, **should** for
  a strong default, and **may** for an option.
- Prefer concise sections, concrete invariants, and stable terminology from the
  [domain model](docs/architecture/DOMAIN_MODEL.md).
- Keep unresolved choices in the open-decisions section of
  [STATUS.md](docs/PUBLIC_STATUS.md), with the milestone that needs the
  decision.
- Avoid time-sensitive vendor details unless they are necessary and sourced in
  an ADR.

## Architectural changes

Create an ADR by copying [the ADR template](docs/adr/0000-template.md) when a
change affects dependency direction, data ownership, public contracts, trust
boundaries, deployment scope, language or platform strategy, or long-lived
operational constraints.

An ADR describes one decision and its consequences. Product requirements belong
in product documentation; task progress belongs in roadmap documentation.

## Clean checkout and generated files

Use the pinned toolchain and `pnpm install --frozen-lockfile` for a fresh
checkout, missing prerequisites, or manifest/lockfile changes. Start local
development with the credentialless example configuration; no maintainer account
or workstation path is required. Browser tests additionally need
`pnpm test:e2e:install`. Database and native-tool prerequisites are documented
in the workspace guide.

Keep lockfiles, reviewed schemas, migrations and intentional synthetic fixtures
tracked. Keep local environment files, Terraform state/plans/variable values,
private keys, caches and generated reports untracked. Use
`git check-ignore -v <path>` to diagnose an ignore rule; do not force-add
unknown generated output. A clean checkout must reproduce intentional generated
artifacts using their documented checks.

Ignored files may still be needed by an active task or preserve a failed test.
Before reclaiming space, follow the workspace guide's
[storage and recovery guidance](docs/development/WORKSPACE.md#local-disk-space-and-retained-evidence).

Project code in this public source distribution is licensed under
[Apache-2.0](LICENSE). Third-party components and AWS icons retain their own
terms; see [the README license section](README.md#license). Publication and
repository visibility remain separate owner decisions.

## Security

Do not commit secrets, customer data, production identifiers, sensitive
diagrams, or proprietary prompt transcripts. Report vulnerabilities through the
private process in [SECURITY.md](SECURITY.md).

## Verification

Apply the existing
[8/10 test criticality criterion](docs/engineering/TESTING.md#test-selection-and-criticality)
when adding or retaining cases. Identify the distinct core feature or critical
behavior protected, reused coverage and count/runtime impact in the normal
review; no separate inventory approval or new CI job is required.

Before adding tests, find the existing owning suite and state which new behavior
or risk needs evidence. Extend a current case or fixture where it remains clear.
Keep one primary layer for each invariant and a lean browser critical path;
extra layers must prove different wiring or failure behavior. Report case-count
changes and comparable focused runtime in review, with unmeasured estimates
labeled. The existing
[test-growth and runtime budget](docs/engineering/TESTING.md#test-growth-and-runtime-budget)
guidance explains matrix selection, setup and flaky-test expectations.

The root [verification cadence](AGENTS.md#verification-cadence) is the single
policy. Use [testing guidance](docs/engineering/TESTING.md) and scoped
instructions to select affected checks. Related-test discovery is a convenience,
not evidence for dynamic dependencies or shared contracts. Preserve meaningful
negative, tenant, accounting, migration, export, and compiler checks when
affected.

The assigned integrated release owner runs full root and release admission for
the final candidate; explicit task/plan requirements and unresolved risks may
also require broad checks. Numbered prompts alone do not. Name pending
integrated checks and their owner when handing back focused work. Required
hosted ready/native and exact-release protections remain unchanged.

Summarize source, commands, duration/results, and limitations once; keep raw
logs/receipts outside tracked source. For documentation-only changes, check
changed-file formatting and links, review the full diff, run `git diff --check`,
and confirm there are no unintended generated or dependency changes. Install and
security requirements follow root instructions rather than every editing cycle.

## Commits and pull requests

Keep unfinished work in a draft PR and run affected formatting, lint, security
and tests locally before review. The
[public CI workflow](.github/workflows/public-ci.yml) runs the public gate,
local/operator tooling and existing browser profiles for pull requests and
pushes to main. It uses read-only permissions and synthetic services without
deployment credentials. Branch admission requires explicit owner setup during
publication. The separately controlled hosted repository retains its draft
refusal, required ready/native profiles and exact-source release verification.

The
[repository footprint and cost report](docs/engineering/REPOSITORY_FOOTPRINT.md)
explains the retained tests and
[draft admission decision](docs/adr/0090-cheap-draft-admission.md).

Use a short imperative commit subject with an optional explanatory body. Pull
requests should state:

- the outcome and active milestone;
- important constraints or decisions;
- verification performed;
- security, compatibility, and migration implications; and
- follow-up work or unresolved choices.

Do not combine unrelated cleanup with a product or architecture change.

## Optional development tooling

The hidden `.agents` skills and `.codex` settings are optional contributor
tools. Repository rules in AGENTS, declared package boundaries and review
requirements apply regardless of which editor or assistant performs the work.
Historical development-stage names are mapped to capabilities in HISTORY; use
capability names in current explanations.
