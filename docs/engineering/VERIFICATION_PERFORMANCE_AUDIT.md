# Verification performance audit

## Scope and method

Historical evidence from August 2, 2026, after M1 Prompt 20 and before Prompt
21: Windows, Node 24, pnpm 11.16.0, Go 1.26.5, warm dependencies, local-only
Turborepo caching and no competing repository workload. Timings are local
observations, not current-release acceptance or cross-machine promises.

This summary retains the primary measurements, failures and review conclusions.
The
[complete original audit](https://github.com/hunter-west/cloudmarkup/blob/c596f2fd30ba7df1828293dd850e74a5b52e1e9b/docs/engineering/VERIFICATION_PERFORMANCE_AUDIT.md)
preserves the expanded inventories, file profiles and command-graph evidence.
Retrieve it offline with:

```powershell
git show c596f2fd30ba7df1828293dd850e74a5b52e1e9b:docs/engineering/VERIFICATION_PERFORMANCE_AUDIT.md
```

Git tracked-file counts exclude ignored builds, coverage, dependencies and
caches. Runtime case counts come from the runners, not source-line counts. The
complete baseline ran uninterrupted; constituent measurements then ran serially
in the warmed workspace.

## Baseline inventory

The baseline contained 534 tracked files, 196 production source files and 97
tracked test files. Runner evidence comprised 82 Vitest files / 738 tests (API
2/2, web 55/525, UI 8/39, contracts 17/172), ten provider-icon Node files / 69
tests, four Playwright files / 39 runtime tests, and one Go file / two tests: 97
files / 848 runtime cases across distinct runners. The original audit owns the
per-package census and its source/test filename definitions.

## Baseline performance

| Command or layer                      | Seconds | Evidence                                 |
| ------------------------------------- | ------: | ---------------------------------------- |
| `pnpm check`                          | 778.354 | Passed complete ordered gate             |
| `format:check`                        |  28.899 | Repository-wide Prettier check           |
| `lint`                                | 280.670 | Type-aware ESLint, no cache              |
| `type-check` (cold in full gate)      |  23.628 | 0/10 Turbo hits                          |
| `type-check` (immediate warm repeat)  |  15.599 | 10/10 Turbo hits; Turbo itself 0.447s    |
| `schema:check`                        |   8.005 | Included a direct schema build           |
| `catalog:check`                       |   9.676 | Included direct provider builds          |
| `icons:test`                          |   3.861 | 69/69 passed                             |
| `icons:check`                         |  15.005 | Included another catalog check by design |
| Vitest without coverage               |  96.732 | 82 files, 738 tests                      |
| Vitest with V8 coverage               | 109.756 | 83.39% statements                        |
| Storybook static build                |  78.211 | Build body 31.39s                        |
| All-workspace build, warm             |   8.847 | 10/10 Turbo hits                         |
| Direct web production build           |  30.614 | Included direct provider preparation     |
| Playwright                            | 155.958 | 39/39 passed; not in `pnpm check`        |
| Go format/vet/tests                   |  54.086 | Passed                                   |
| CDK synth and zero-resource assertion |  51.040 | Passed                                   |
| CI workflow validation                |   4.300 | Passed                                   |

No `check:quick` command existed at baseline. The closest intended inner-loop
sequence was formatting, lint, type checking, and no-coverage Vitest. Its
individually measured layers total 421.900 seconds; this is a constructed
comparison, not a claim that an old quick command existed.

Coverage instrumentation added 13.024 seconds (13.5%) to the warmed TypeScript
suite and created 242 ignored files / 8,488,397 bytes. Baseline coverage was
83.39% statements, 76.45% branches, 88.10% functions, and 83.28% lines. The
repository intentionally has no arbitrary global threshold; this audit neither
adds nor weakens one.

The production web bundle contained 13 files / 2,805,407 bytes. Storybook
contained 45 files / 10,178,312 bytes. The eight approved provider icon files
occupied 19,620 bytes in both the checked assets and the production bundle.

## Slow tests and unusually large files

The original file profiles identify `App.test.tsx` as the unit-suite tail
(12.941 seconds with coverage) and `EditorExperience.test.tsx` as expensive per
composed case (9.029 seconds). Their interaction/focus risks were retained.
Provider resolution, inspector, shell and session modules had distinct
responsibilities; file size alone did not prove redundancy. These are historical
profiles, not current source sizes or permission to remove safety tests.

## Command-graph findings

### Existing cache boundaries

Package build/type tasks used Turbo; root tests, formatting, lint, drift checks,
Storybook, icons, Go, CDK and CI validation ran outside it. Baseline type
checking had 0/10 cache hits, its immediate repeat 10/10, and a warm workspace
build 10/10. No remote cache was introduced.

### Proven repeated work

Direct schema/provider builds were repeated by later Turbo builds. Web
`prebuild` and `pretest` repeated dependency preparation; routine tests
unnecessarily collected coverage. Filtered Turbo tasks, removal of those two
hooks, and a separate coverage command addressed that duplication. Development
kept explicit provider preparation.

An ordinary test pass was not run immediately before coverage. Storybook/web
artifacts, type checks/emitting builds and icon boundary checks were distinct
evidence and remained.

### Unrelated workstreams

The old serial root gate and always-on CI selected unrelated workstreams.
Focused local gates addressed the local cost; CI/required-job changes were
deferred for owner approval. Later release policy belongs to the current
[verification cadence](../../AGENTS.md#verification-cadence) and
[STATUS](../PUBLIC_STATUS.md), rather than this historical deferral.

## Redundancy and stale-code audit

The original searches covered unused symbols, typed lint, duplicate hashes,
imports/exports, modes, feature flags, TODO/FIXME markers, stories, fixtures,
generated paths and dependencies. The duplicated UI Vitest config was removed
after its package script selected the authoritative root UI project, preserving
eight files / 39 tests. Its stylesheet helper gained one deterministic file
read; the UI declared an already-pinned Node type dependency without adding a
resolved package or downloading packages.

Mode-parity assertions, package-owned TypeScript entry points, both Storybook
scopes, legacy fail-closed recovery fixtures, reviewed generated contracts and
provider-icon registration had distinct consumers. No other safe fixture, story,
feature or dependency deletion was proven. No test was deleted or parameterized
in that audit; similar wording/setup did not prove equivalent implementation
paths and failure models.

## Verification tiers

Current commands and prerequisites are maintained once in the
[workspace guide](../development/WORKSPACE.md#verification-by-responsibility),
with test selection in [TESTING](TESTING.md) and authoritative cadence in
[AGENTS](../../AGENTS.md#verification-cadence). The original command table is
historical: its `check` alias, 39-case browser scope and zero-resource synth
description do not describe current main. Currently `pnpm check` selects
`check:beta`; `check:full` is the explicit diagnostic profile.

## Required safety gates and risks

The original retained formatting, typed lint/types, schema/catalog drift,
provider-icon boundaries, coverage, Storybook, production builds, Go, CDK,
workflow/static checks and secret scanning. Registry audit and browser checks
had separate prerequisites. Representative failure probes and the lint failure
below qualified the local changes, without changing organizational merge policy.

Retained risks: local cache validity, indirect/runtime dependencies missed by
`test:related`, and incomplete focused filters. Root dependency-aware builds and
declared package boundaries still matter. Current required checks and release
admission follow the linked repository policy; this audit grants no deployment
authority or new test exemption.

## Final measurements

The audit workflow ran focused gates during implementation and then one complete
gate. The final literal `pnpm check` timing therefore represents that warm
pre-merge boundary; a clean CI workspace still pays the cold typed-lint cost. An
earlier identical-graph `check:full` sample passed in 122.966 seconds, while the
finalized literal alias took 298.647 seconds. The table uses the latter
conservative result and records the substantial uncached-layer variance.

| Measure                     |                                  Baseline |                       Final |             Change |
| --------------------------- | ----------------------------------------: | --------------------------: | -----------------: |
| Complete local gate         |                                  778.354s |                    298.647s | -479.707s (-61.6%) |
| Quick inner-loop equivalent | 421.900s constructed (no command existed) | 135.875s warm `check:quick` | -286.025s (-67.8%) |
| Vitest without coverage     |                                   96.732s | 101.310s inside final quick |            +4.578s |
| Complete coverage           |                                  109.756s |     47.899s warm standalone |           -61.857s |
| Storybook                   |                                   78.211s |   39.632s warm focused gate |           -38.579s |
| Playwright                  |                                  155.958s |                    143.133s |           -12.825s |
| Web bundle                  |                13 files / 2,805,407 bytes |  13 files / 2,805,407 bytes |          unchanged |
| Storybook output            |               45 files / 10,178,312 bytes | 45 files / 10,178,312 bytes |          unchanged |
| Statement coverage          |                                    83.39% |                      83.39% |          unchanged |
| Branch coverage             |                                    76.45% |                      76.45% |          unchanged |
| Function coverage           |                                    88.10% |                      88.10% |          unchanged |
| Line coverage               |                                    83.28% |                      83.28% |          unchanged |

The new focused gates passed with these measured warm times:

| Gate              | Seconds | Evidence                                               |
| ----------------- | ------: | ------------------------------------------------------ |
| `check:web`       |  88.964 | 63 files / 564 web and UI tests plus production build  |
| `check:storybook` |  39.632 | Static Storybook build                                 |
| `check:contracts` |  15.342 | 17 files / 172 tests, drift checks, fixture builds     |
| `check:backend`   |  15.589 | 2 API tests and backend build                          |
| `check:compiler`  |   8.705 | Go format/vet/tests, warm Go cache                     |
| `check:infra`     |  67.690 | Lint/types/build and zero-resource CDK synth           |
| `check:assets`    |  14.915 | 69 icon tests, manifest/repository/build/bundle checks |
| `check:e2e`       | 143.133 | 39 Chromium tests                                      |

The first cold quick attempt stopped after 258.812 seconds because lint exposed
implicit Node type ownership in the UI stylesheet test after deleting its
duplicate config. That was a real correctness finding, not a passing performance
sample. After the package declared the existing pinned type dependency and the
test removed its cwd fallback, focused UI tests, UI types, the React-only
runtime build, and the complete quick gate passed.

Safe temporary probes proved `check:web`, `check:contracts`, `check:backend`,
`check:infra`, `check:compiler`, and `check:assets` each fail on a scoped
representative error. `test:related` also exits nonzero when no source files
select a test. Every probe was removed before positive verification.

Final inventory is 535 tracked files after adding this audit/plan and deleting
one duplicate config. Production source remains 196 files; tracked tests remain
97 files / 848 runtime cases. No test was deleted or parameterized. One config
file was deleted, one stylesheet-test helper was consolidated, zero dependencies
were removed, one existing pinned dev type was declared directly, and no
resolved package was added.

The final complete gate replayed all ten package type checks from Turbo cache;
schema and catalog builds were also cache hits, and the later production build
reused their outputs. Routine tests no longer create coverage; full coverage
remains authoritative.

At that checkpoint, bottlenecks were cold type-aware lint (280.670 seconds on
the baseline machine), uncached Storybook, jsdom setup in the 63-file web/UI
suite, the large complete-editor test files, CDK startup/synthesis, and the
single-worker 39-test Chromium suite. CI selection changes were deferred for
organizational approval; current selection and release requirements belong to
the linked repository policy.

## Deferred recommendations for Prompt 51

These recommendations describe the audit checkpoint. STATUS tracks subsequent
implementation and remaining work; they do not restore superseded release holds.

- Review and explicitly approve a fail-closed CI path classifier plus one
  aggregate required merge job before changing branch-protection semantics.
- Profile splitting `App.test.tsx` and the complete editor-composition tests by
  fixture/ownership boundary; do not copy setup merely to lower a file count.
- Review large provider SDK and editor coordinator modules as architectural
  ownership work, not mechanical line-count reduction.
- Re-evaluate Storybook task caching only with complete inputs for both
  `packages/ui` and imported `apps/web` editor stories.

## Prompt 49 controlled-beta supplement

The historical verification audit above describes its own earlier repository
state. Prompt 49 adds a separate product-operation baseline at
[BETA_PERFORMANCE_BASELINE.md](BETA_PERFORMANCE_BASELINE.md). It covers
catalog-bound 25/100/500-node deterministic editor operations, Go compiler and
application generator baselines, and an uncompressed artifact/chunk inventory.

The large synthetic profile shows approximately 0.48 seconds each for model
projection and layout-request preparation on the recorded machine. The existing
cancellable ELK worker remains; no additional worker or list virtualization is
introduced without browser evidence. Missing relationship-heavy canvas,
semantic-diff, cold sandbox, diagram, preview, large-repository CLI, table, and
plan/drift timings remain named follow-up measurements rather than fabricated
budgets.
