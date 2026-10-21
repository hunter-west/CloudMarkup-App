# Cloud Markup repository instructions

These rules apply everywhere. A closer `AGENTS.md` specializes changed risks;
the verification cadence below remains authoritative. Subtree guidance cannot
weaken security, provider-neutral boundaries, or deployment authority.

## Start every task

1. Confirm the assigned repository/worktree, branch, source commit, and working
   tree. Preserve unrelated changes and other owners' fixtures/processes.
2. Define one bounded outcome, acceptance criteria, and affected boundaries.
   Read applicable local `AGENTS.md` and only the product, architecture,
   contract, and accepted [ADR](docs/adr/README.md) sections needed for them.
3. Consult current [STATUS](docs/PUBLIC_STATUS.md) and
   [HANDOFF](docs/PUBLIC_STATUS.md) sections when milestone, ownership, live
   behavior, or blockers matter. Follow pinned history links only as needed.
4. Maintain an existing plan, or create one only when
   [execution-plan policy](docs/engineering/EXECUTION_PLANS.md) requires it.

## Non-negotiable boundaries

- The typed, versioned architecture graph is the product source of truth.
- Every graph mutation uses the versioned domain command engine. Preconditions
  fail closed, batches are atomic, safe inverses are explicit, and generated
  resources are never silently customized or removed.
- Domain code stays deterministic and provider-neutral. It cannot import UI, AWS
  SDK, database/network clients, or IaC renderers.
- UI layout never changes deployment meaning; stable graph identities preserve
  IaC addresses.
- AI output is untrusted, schema-constrained proposal data. Deterministic domain
  logic validates and applies operations.
- Compile only immutable, version-bound revisions. The compiler cannot deploy,
  use credentials/network/model access, or execute arbitrary extensions.
- Tenant identity comes only from verified authentication context. Every
  tenant-owned access and mutation boundary requires explicit authorization.
- Provider behavior belongs behind versioned contracts. AWS-first must not
  become AWS-hardcoded core logic.
- Cross-package imports use declared package exports; no deep imports.

## Engineering workflow

- Use the simplest sufficient implementation within the authorized outcome.
  Reuse existing modules, test harnesses, and commands. Record unrelated
  findings as optional follow-up; do not expand the task to implement them.
- Add no abstraction, framework, dependency, gate, or tracked report without a
  concrete task need and an assessment of the simpler existing alternative.
- Pre-live beta extends one current catalog. Service waves do not require frozen
  predecessor catalogs, migrations, or historical fixture copies. Preserve
  current graph/artifact validation and exact-source checks; post-go-live
  breaking compatibility/migrations require an explicitly scoped design.
- Follow [DEPENDENCY_POLICY.md](docs/engineering/DEPENDENCY_POLICY.md) for every
  manifest, lockfile, module, or install-script change.
- Use the [ADR checklist](docs/adr/CHECKLIST.md) for durable choices. Keep
  unresolved choices in `STATUS.md`; do not rewrite accepted ADR history.
- Provider-catalog patterns now have focused repository-local skills. Use
  `$add-aws-service`, `$add-connection-rule`, `$add-validation-rule`, or
  `$review-iac-mapping` for that exact job. Their instructions do not broaden
  the active milestone or authorize unrelated services, compiler behavior,
  network access, credentials, or deployment.
- Update tests, contracts, and documentation only where current truth changes.
  Record detailed progress/evidence once in the existing plan or PR; status and
  handoff should link to it rather than repeat its history or full logs.
- Never commit secrets, customer data, sensitive architecture content, caches,
  coverage, synthesized output, or incidental generated files.

## Verification cadence

- Keep a test only when its criticality is at least 8/10: it adds distinct
  protection for a core feature or critical security, data, payment, migration
  or deployment behavior. Read its actual action/assertions and retained overlap
  before scoring; names, failing results or a reduction quota do not determine
  criticality. Apply the
  [selection rubric](docs/engineering/TESTING.md#test-selection-and-criticality)
  to new and retained cases, including previously rated 7/10 cases and
  parameterized rows, reusing the owning suite where possible.
- Keep test growth proportional to new risk. Before adding a case or file, read
  the owning suite and extend its existing fixture/behavior check when possible.
  Choose the lowest layer that proves the invariant; add integration or browser
  coverage only for a distinct boundary or critical user journey. Do not repeat
  a whole scenario at every layer or multiply presentation-only scenarios by
  every mode, palette and viewport. Preserve meaningful negative regressions.
- In review, identify the new behavior/risk, reused coverage, case-count delta
  and observed focused runtime (or explicitly mark timing unmeasured). Explain
  runtime growth against the owning suite's last comparable recorded run. Fix
  flaky synchronization/setup at its cause; failing tests alone never justify
  removal, broader retries or a skipped required check. See
  [test-growth guidance](docs/engineering/TESTING.md#test-growth-and-runtime-budget).
- Run focused tests after logical changes. After a correction, rerun failed
  checks and any additional checks affected by the fix; broaden when failures or
  unresolved risks require it. Use affected workstream checks before handback.
- Match tests to changed risk and reuse existing coverage: tenant/authentication
  changes require allowed, denied, and cross-tenant cases; billing/accounting
  requires financial invariants; contracts/data require applicable
  compatibility, migration, or intentional-rejection cases; exports/compiler
  require goldens and deterministic reproduction.
- The assigned public-source release owner freezes one candidate and runs
  `check:public`, with separately selected browser/native acceptance. Private
  hosted admission uses `check:beta` / `beta:release-gate` in its separately
  controlled repository. The public CI workflow runs the public gate and
  existing local/operator/browser checks on standard runners; branch admission
  requires owner setup during publication. Private hosted CI selects changed
  workspace projects and their declared consumers; uncertain history, shared
  controls and security/data changes require the complete suite. Coverage,
  Storybook and performance diagnostics run on the existing scheduled/manual
  profile; `check:full` remains an explicit deep check. Real-time PostgreSQL/SDK
  contracts, browser tenant/billing/recovery flows, security, build, migration
  and exact deployment protections stay mandatory. Queue new work separately.
  Rerun when changes invalidate that evidence or a high-risk change, explicit
  task, or plan requires broad checks. Numbered prompts alone do not require a
  full gate. Handback must name pending integrated checks and their owner;
  focused success does not establish release admission.
- Review the final diff and summarize source, command, duration, result, and
  limitations once. Keep raw logs/receipts outside tracked source; link existing
  history. Never describe a skipped or failing required gate as passing.

Keep unfinished PRs in draft and batch locally verified changes before marking
ready. Run affected checks locally in this public snapshot. In the separately
controlled hosted repository, drafts run only the dependency-free admission
refusal and merge admission requires the selected ready profile. Required hosted
ready/native profiles, exact-release admission, and environment/OIDC safeguards
remain. See the
[draft admission decision](docs/adr/0090-cheap-draft-admission.md).

## Review and completion

- Apply [CODE_REVIEW.md](docs/engineering/CODE_REVIEW.md) and
  [DEFINITION_OF_DONE.md](docs/engineering/DEFINITION_OF_DONE.md).
- Run `pnpm install --frozen-lockfile` for a fresh checkout/missing
  prerequisites or manifest/lockfile changes, not for every unchanged skill
  invocation.
- Run `pnpm security:check` for dependency, workflow, script, fixture, or
  security-sensitive changes. It requires registry access.
- For documentation-only changes, check changed-file formatting and local links,
  inspect the full diff, and run `git diff --check`.
- A task stops only when its plan stopping condition and the Definition of Done
  are satisfied, or a concrete blocker and next action are recorded once with
  the needed current status/handoff link. Implementation, release, and owner
  acceptance remain separate claims.

## Deployment authority

Repository changes and local verification do not authorize deployment. The
existing platform delivery workflow may run only with explicit owner authority,
passing exact-release checks and its existing environment/OIDC safeguards.
Customer infrastructure remains export-only. Never add deployment authority to
the compiler, domain, generated code or an ordinary test.

## Contributor tooling

Optional `.agents` skills and `.codex` settings grant no additional authority.
Current implementation/activation facts belong in STATUS; historical prompt
provenance belongs in the linked roadmap history.
