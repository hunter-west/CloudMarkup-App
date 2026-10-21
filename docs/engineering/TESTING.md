# Engineering test conventions

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

> **Evidence scope:** foundation conventions and accumulated feature
> verification through the September 29, 2026 source snapshot. Historical counts
> and failures retain their original scope; they are not current-release
> acceptance. Read [STATUS](../PUBLIC_STATUS.md) and
> [HANDOFF](../PUBLIC_STATUS.md) for current evidence.
> [ADR-0062](../adr/0062-separate-beta-coverage-from-delivery.md) governs
> exact-commit test admission separately from scheduled/manual coverage.

These conventions implement the repository
[testing strategy](../architecture/TESTING_STRATEGY.md). They began with the M1
foundation and continue across the current capability suites. New layers retain
these deterministic, tenant-aware defaults.

## Shared configuration

- [`vitest.config.ts`](../../vitest.config.ts) is authoritative for TypeScript
  tests. Do not copy common Vitest configuration into packages.
- Tests are colocated with source as `*.test.ts` or `*.test.tsx`.
- The `api` project uses the Node environment. The `web` project uses JSDOM and
  the shared React Testing Library setup in
  [`apps/web/src/test/setup.ts`](../../apps/web/src/test/setup.ts).
- [`config/playwright/default.config.ts`](../../config/playwright/default.config.ts)
  owns the bounded Chromium editor-workflow environment. The browser suite uses
  a fixed local origin, viewport, locale, time zone, color scheme, and
  reduced-motion preference.
- `pnpm generation:baselines` and `pnpm performance:beta` explicitly run the
  non-gating repeated-generation measurement. Ordinary generator correctness
  runs retain independent reproducibility, full-program compilation and exact
  golden/byte checks without replaying that measurement loop.
- `apps/web` owns its direct development dependency on the pinned `axe-core`
  catalog entry. The manual editor workflow E2E file injects its bundled source
  into selected local Chromium states; it has no production import or runtime
  network role.
- Import Vitest APIs explicitly. Tests must not rely on ambient test globals.
- Use React Testing Library queries that reflect how a user perceives the page,
  preferring roles and accessible names over implementation selectors.
- Browser-local recovery adapter tests use deterministic fake IndexedDB,
  scheduler, clock, and BroadcastChannel boundaries. They do not use the
  developer's real browser profile or treat local storage as trusted input.

## Test behavior

- Name tests after observable behavior or an invariant, not an internal method.
- Keep tests deterministic: no live network, real cloud account, wall-clock
  dependency, uncontrolled randomness, or test-order coupling.
- Prefer real pure-domain behavior. Mock only a boundary whose behavior is not
  under test, and make failure behavior explicit.
- Keep fixtures synthetic and free of secrets, customer data, production
  identifiers, or sensitive architecture content.
- Add negative tenant and authorization cases whenever tenant-owned behavior is
  introduced.
- Generated and compiler outputs require reviewable golden fixtures and
  reproducibility checks; snapshots are not a substitute for semantic
  assertions.

## Test selection and criticality

Automated cases require at least 8/10 criticality. Score the protection added by
the actual fixture, action and assertions against its supported caller and
retained coverage. A title, execution cost or target reduction percentage is
insufficient evidence. Each retained case needs a distinct reason tied to a core
feature or critical security, data, payment, migration or deployment behavior.
Reassess previously rated 7/10 cases against their actual assertions and source
paths; do not raise scores to preserve a case or apply one score to an entire
file. For an existing case or a proposed new test, answer this checklist in the
existing review:

1. What observable failure would hurt a user or violate a supported contract?
   Identify the actual action and assertion that catch it, and a plausible
   implementation change that would cause it.
2. What unique protection does this case add? Compare retained cases by their
   predicates, roles, states and side effects; cite the owning coverage.
3. Does it specify behavior or an implementation detail? Prefer outcomes over
   private call order, incidental CSS, exact prose or fixture snapshots unless
   those details are the public contract. Remove excessive specification that
   blocks harmless changes without detecting a user failure.
4. Is this the cheapest sufficient layer? Use a unit test for a pure rule,
   integration coverage for a real adapter boundary, and a browser case for a
   user interaction that lower layers cannot prove. Avoid repeating the same
   assertion through every layer.
5. Does a realistic, deterministic setup reach the intended branch? Prove the
   valid starting state before a negative mutation, and check the intended
   rejection rather than an earlier unrelated fixture failure.
6. What are the runtime and maintenance costs? Use measured timings when
   available; remove equivalent slow variants first. Cost does not justify
   losing unique high-impact protection.
7. Could a missed regression expose data, lose persisted work, duplicate a
   payment, corrupt AI accounting or exports, break migration/recovery, or
   bypass deployment authority? Name the concrete boundary and consequence; a
   security or persistence filename alone is not evidence of high value.
8. After removal or consolidation, which retained assertions prove the behavior?
   Check references from test selectors, generated artifacts and exact-source
   bindings. Identify affected local checks and the release owner's required
   same-source native/CI qualification; local success does not grant deployment
   admission.

Score the distinct protection using these anchors:

- 10: distinct protection against unauthorized access, cross-tenant exposure,
  monetary duplication, irreversible data loss or release-authority bypass.
- 9: a distinct accounting, persistence, AI, immutable export or migration
  invariant with a material corruption or recovery risk.
- 8: a distinct core workflow or known production regression.
- 7: a meaningful feature or contract boundary with a realistic failure path.
- 6: secondary convenience/presentation, or an equivalent input whose predicate
  and meaningful rejection are already covered.
- 5: duplicated assertions or scenarios without distinct protection; cite the
  retained overlap.
- 4: obsolete compatibility with no current supported caller or contract.
- 3: non-gating diagnostic repetition supported by existing diagnostics.
- 2: fixture/helper bookkeeping without a product invariant.
- 1: placeholder or ineffective check without an observable contract assertion.

Before removing a case below 8, check whether its actual assertions uniquely
protect a core feature or critical invariant; if so, record the concrete
evidence for its score and keep it. Generic strict-schema checks do not make
tenant, secret, executable-code or financial fields interchangeable.
Parameterized rows may share a rationale only when they exercise the same
predicate; distinguish actual roles, states, schema branches and provider
semantics. A Linux filesystem contract does not lose criticality because it is
skipped on Windows.

Report the reused coverage, unique-case delta, removed files/lines and measured
focused runtime in the existing review. Record the score, reason,
keep/remove/consolidate decision and retained coverage for each case; give
different parameter rows separate decisions when their protection differs. Track
reviewed coverage, reversals and cases still awaiting reassessment separately.
Distinguish literal registrations from resolved parameterized executable cases.
Separate skipped/unresolved registrations from executable cases, source cases
from browser-project duplication, and proposed changes from committed, merged
and deployed ones. Combining all original assertions into a loop reduces
setup/registrations rather than execution coverage; say so and measure the
actual benefit. This criterion adds no CI job or inventory gate.

## Test growth and runtime budget

The default budget for an existing suite is steady or decreasing case count and
runtime for unchanged behavior. New behavior and regressions may grow it; this
is a review expectation, not a deletion quota or a new admission gate. Use the
last comparable source-bound run for the same command, platform, database
profile and worker count. Report missing measurements honestly. The historical
[footprint measurements](REPOSITORY_FOOTPRINT.md#supplied-actions-usage)
identify costly setup, but are not a current candidate's runtime budget.

Before adding a test, name its invariant and search the owning suite. Extend an
existing scenario or fixture when it preserves a clear failure. Unit tests own
pure decisions and input partitions. Integration tests own adapter contracts,
transactions, races and persistence. Browser tests own a lean set of real user
journeys, keyboard/focus behavior and layout boundaries. A second layer should
prove different wiring or a failure boundary, rather than replaying all inputs.
Authentication/authorization, cross-tenant denial, billing idempotency, AI
accounting, persistence and deterministic exports retain their required cases.

Choose representative matrix combinations by the code path they exercise. Keep
both sides of an actual breakpoint, each distinct input partition and relevant
security role; avoid Cartesian products of modes, palettes and screen sizes when
they share behavior. Keep one explicit parity check where modes should agree.
CSS-text regular expressions do not establish computed layout; use retained
browser geometry checks and shared token contracts instead. Do not collapse
unrelated assertions into one giant test merely to lower its count.

For normalization and coercion fixes, review input equivalence classes first:
accepted representations, rejected types, range/precision limits and relevant
encoding or truncation boundaries. An additional permutation needs a distinct
branch or named regression. Preserve the failing regression and qualify its fix
before reducing its newly added cases; a count budget cannot overrule that
evidence.

Keep fixture setup isolated and bounded. Reuse immutable validated scaffolds,
never cache tenant authority, clocks, mutable state or execution results across
tests/callers. Read-only input partitions may share one fresh fixture within a
bounded test when each input is copied, every call reauthorizes, no writes are
checked after each rejection and an allowed control proves the fixture remains
usable. State mutations, races and recovery boundaries keep independent
fixtures. Prefer waiting for an observable state to fixed sleeps; avoid
redundant navigation/setup within one scenario. A flaky case needs a recorded
cause and a synchronization or fixture correction. Failure alone is not a reason
to delete it, increase retries, extend every timeout or remove a required
profile.

Review descriptions should give the new risk/behavior, coverage reused, cases
added/removed by layer, focused duration and any estimated setup savings.
Explain runtime growth and the tradeoff in removed coverage. Large
database/native work uses the assigned serial CPU slot. Count reduction,
measured runtime change and reliability evidence are separate claims; a source
review proves none of the pending execution results.

## Commands and coverage

From the repository root:

```powershell
pnpm check:beta
pnpm check:full
pnpm test
pnpm test:related <source-files...>
pnpm test:web
pnpm test:contracts
pnpm test:backend
pnpm test:coverage
pnpm test:e2e:install
pnpm test:e2e
```

`check` and `check:ci` share `check:beta`, which builds, performs static quality
checks, runs functional tests without coverage, runs the complete real-time
SQL/SDK contracts separately once, exercises all three browser profiles, and
runs security checks. It requires an isolated PostgreSQL fixture and the
existing source-built compiler/historical prerequisites.

Ready PR and main CI use the complete committed diff and declared workspace
dependencies to select affected Vitest projects and their consumers. Shared
controls, security/data paths or uncertain history/config select the whole
suite. Shard discovery uses identical selection, including historical receipt
preparation. The quality job always runs both SQL/SDK runtime files in full; the
retained `final-unknown` assertion cannot disappear behind coverage deferral.
The explicit `check:full` and existing weekly/manual profile own exhaustive
coverage, Storybook and performance diagnostics. See
[ADR-0091](../adr/0091-lean-beta-verification.md) for the authorized cleanup and
its pending integration.

`pnpm test` and its compatibility alias `pnpm test:unit` run all root Vitest
projects without coverage instrumentation. `test:web` selects the `web` and `ui`
projects; `test:contracts` selects versioned schema/domain/provider tests; and
`test:backend` selects API, API-contract, and GitHub repository export. Package
test scripts select these same authoritative root projects rather than copying
configuration.

`test:backend` uses one worker, a 30-second test timeout, and a 120-second hook
timeout, matching the intended full-root and hosted CI resource settings. The
three backend projects set their hook timeout explicitly because the root CLI
flag does not propagate to project configs in the pinned Vitest version. This
bounds concurrent fixture setup and teardown and avoids the default five-second
timeout for database and repository integration tests. Assertions, production
deadlines, test selection, and fixture isolation are unchanged. A clean
single-worker run may take longer than parallel execution; measure complete runs
and recovery cost separately. Use only the task's owned synthetic PostgreSQL
fixture, preserve other sessions and schemas, and verify owned teardown before
handoff.

`pnpm test:related <source-files...>` uses Vitest's static dependency graph and
fails when it selects no test. It is a development convenience for immediate
feedback, not evidence that runtime/dynamic relationships, shared contracts, or
other workstreams are safe. Follow the affected-check and integrated-release
cadence in the [root instructions](../../AGENTS.md#verification-cadence).

`pnpm test:coverage` runs every root project and emits text, JSON summary, and
HTML V8 coverage under ignored `coverage/`. Coverage is review evidence, not a
target to game. Threshold changes must follow accepted risk and be recorded
here. The explicit `check:full` retains coverage. Routine beta admission follows
the root verification cadence and does not require instrumentation. Scheduled
coverage still requires every report; neither a skipped diagnostic nor an older
receipt establishes current-release success.

`pnpm test:e2e:install` installs the Chromium revision pinned by the checked
Playwright package. `pnpm test:e2e` starts the local Vite server and runs
synthetic editor workflows covering canvas/catalog/inspector/connection/layout,
refresh recovery and stale tabs, the isolated manual notes API, exact
node/configuration validation focus and readiness, safe fixes, history, and
selected axe scans. The suite uses no live service, credential, backend
authority, customer data, compiler, or deployment. Failure-only screenshots and
traces are written under ignored `test-results/`; CI also retains the bounded
HTML report for failed runs for seven days. Axe supplements semantic, keyboard,
focus, and manual assistive-technology review; a passing scan is not a WCAG
conformance claim.

For focused browser work in a fresh checkout, prepare the declared workspace
consumer builds before starting Vite. A partial dependency build/optimizer cache
previously caused missing exports and a late ELK discovery reload during an
unchanged layout test. The cold-mount investigation records the failed
preparation, fresh owned-cache experiment and passing run. Follow that setup
order; changing retries or total test timeouts would conceal the cause. Preserve
other checkouts' caches and servers. The full beta command already builds first.

## Hosted verification profiles

The policy in
[ADR-0065](../adr/0065-source-bound-ci-reuse-and-documentation-profile.md) adds
a strict documentation-only PR profile: formatting, links, workflow policy and
security. A complete raw Git diff and exact checkout determine eligibility;
unknown, executable or mixed inputs require the full profile. The exact root
CONTRIBUTING.md, SECURITY.md, BETA_READINESS.md and GitHub pull-request template
are also documentation inputs. README/AGENTS eligibility is limited to reviewed
contributor locations; nested fixtures and image-context Markdown require full
checks. Release, scheduled and manual runs always use the full profile. The
final Quality gates job requires every selected dependency and rejects
unexpected skips.

Full CI runs formatting and typed lint alongside ordered quality checks. A fresh
build job shares only its build cache with the same run's eight test shards and
browser job; their build commands still validate task keys and rebuild misses.
No test result is cached. The duplicate assistant wrapper is omitted only from
CI quality because both suites run in the verified complete shard partition.
Static/secret scans run in the mandatory security job. Local full commands and
all test selections, database isolation, workers, retries and coverage profiles
remain unchanged. The privileged release bundle is built separately.

Application native proofs acquire only their application context and may reuse
public Go tool bytes after exact reviewed hash/size/inventory checks. Full image
materialization still covers both contexts. Cache presence is never execution
evidence; native proof and isolation checks run on every eligible candidate.

## Reduced duplication and draft feedback

[ADR-0090](../adr/0090-cheap-draft-admission.md) narrows draft execution to the
dependency-free merge-admission refusal. Drafts never provide merge admission;
ready PRs still run the complete selected profile, including security. Local
affected checks provide feedback while work is in draft. The local release
command runs the root gate once and then its distinct browser, artifact and
release checks. Focused workstream wrappers remain useful during development.

Schema artifact drift is checked in one complete inventory test, alongside exact
generator-byte checks. Compact JSON storage does not change canonical document
serialization. All schema constraints and behavioral cases remain. Synthetic
proposal setup shares its implementation while preserving exact SQL hashes and
registered-ledger checks. The fixed seed scaffold is private and copied per
caller; authorization, clocks, tenant records and execution results remain
fresh. See the [measurement and retained-coverage map](REPOSITORY_FOOTPRINT.md).
