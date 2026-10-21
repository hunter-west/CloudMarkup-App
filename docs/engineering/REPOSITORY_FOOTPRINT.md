# Repository footprint and Actions cost

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

Baseline: `e11a86da3d6e2c6537bd35e393484e35baabf318`, before the October 1
reduction. Measurements below count Git blobs, not dependency installs, local
worktrees, builds, caches, PostgreSQL data or Git history. MB means 1,000,000
bytes.

The current successor candidate's
[draft admission decision](../adr/0090-cheap-draft-admission.md) defers the
remaining scope, lint/documentation and security feedback jobs until ready,
retaining only the cheap draft refusal. The historical measurements and October
1 decisions below remain tied to their recorded sources; this correction does
not establish new billed savings.

## Tracked size

| Purpose                          |     Files |          Bytes |    Share |
| -------------------------------- | --------: | -------------: | -------: |
| Generated contracts and catalogs |        60 |     31,227,074 |    43.0% |
| Application and library source   |     1,238 |     15,948,808 |    22.0% |
| Test cases                       |       825 |     11,995,218 |    16.5% |
| Documentation                    |       461 |      6,053,428 |     8.3% |
| Fixtures and golden outputs      |       429 |      3,640,922 |     5.0% |
| Tooling, configuration and locks |       160 |      1,434,834 |     2.0% |
| Database migrations and seeds    |        79 |      1,021,800 |     1.4% |
| Test support                     |        92 |        700,073 |     1.0% |
| Static assets                    |        29 |        517,402 |     0.7% |
| **Total**                        | **3,373** | **72,539,559** | **100%** |

The categories are mutually exclusive path-based classifications. Generated JSON
Schema/OpenAPI/catalog paths take precedence, followed by Markdown,
fixture/golden/snapshot directories, test filename conventions, test helpers,
assets, SQL migration/seed paths, tooling/configuration/locks, then remaining
application/library files. Embedded compiler schemas are generated contracts;
tests emitted inside golden applications are fixtures. This avoids reporting
generated JSON indentation or duplicated golden application source as authored
production code. Individual files may contain more than one conceptual purpose.

The 825 test files include TypeScript, Node-script and Go tests. The root Vitest
baseline discovers 739 modules and 9,954 cases; its successful Linux PR run has
9,910 passes and 44 configured skips. These counts describe different scopes.
Lines and file counts alone do not establish maintainability or execution cost.

## Verified reduction

Tested head `f7bf410e1df0d27e642705b80657186004d75ac3` contains 50,642,749 bytes
(50.64 MB) across 3,354 files: 30.2% fewer tracked bytes and 19 fewer files.
Generated contracts and catalogs fall from 31.23 MB to 10.46 MB; documentation
falls from 6.05 MB to 4.94 MB. Most behavioral test source remains because its
distinct safety cases are still required. Counts include the new plan, decision
and this report. The documentation closeout records later hosted results without
changing the tested application source.

| Purpose                          | Before (MB) | After (MB) | After files |
| -------------------------------- | ----------: | ---------: | ----------: |
| Generated contracts and catalogs |       31.23 |      10.46 |          60 |
| Application and library source   |       15.95 |      15.95 |       1,238 |
| Test cases                       |       12.00 |      11.99 |         824 |
| Documentation                    |        6.05 |       4.94 |         460 |
| Fixtures and golden outputs      |        3.64 |       3.64 |         429 |
| Tooling, configuration and locks |        1.43 |       1.44 |         160 |
| Database migrations and seeds    |        1.02 |       1.02 |          79 |
| Test support                     |        0.70 |       0.68 |          75 |
| Static assets                    |        0.52 |       0.52 |          29 |

The main reduction is stored generated representation, followed by retired
historical prose. It is not a 30% reduction in authored application code, Git
clone size, deployed assets or execution time. Test-module consolidation reduces
duplicated setup; deleting independent behavioral cases would need different
evidence than their number or file size.

The fixed-source local microbenchmark compared five constructions with the saved
original object: 104.8 ms mean before, 45.4 ms including initialization after,
and 0.62 ms mean for 100 subsequent copies. The complete synthetic source
SHA-256 remains
`4808bef6d448244c742defca19c887bfbed0c77cc45ec96bd9fd8678f950e1fa`. This
measures one function under local load, not the site or a hosted pipeline.

## Supplied Actions usage

| Workflow                        |   Minutes |   Runs | Minutes per run |
| ------------------------------- | --------: | -----: | --------------: |
| CI                              |     3,792 |     28 |           135.4 |
| Deploy beta                     |       738 |      6 |           123.0 |
| Memory runner proof             |       445 |     16 |            27.8 |
| Candidate runner proof          |       418 |     11 |            38.0 |
| Temporary refactor verification |       117 |      3 |            39.0 |
| Native normalization            |        62 |     13 |             4.8 |
| **Total**                       | **5,572** | **77** |                 |

These are the owner's supplied usage figures. Their links identify a
current-week view, while the request describes monthly usage; the exact period
is not independently established. CI accounts for 68.1% of this table.
Concurrent jobs each consume runner time, so a 20-minute wall-clock run can
consume well over 100 runner-minutes. Failed, cancelled and repeated attempts
also consume time. The temporary refactor workflow was already removed in PR 41.

The last complete PR-41 CI run (private historical evidence, omitted from this
distribution) used 7,273 raw runner-seconds across its successful jobs. The
eight Vitest logs contain 737 timed file reports totaling 3,611.232 seconds; the
remaining modules are wholly skipped. The largest single file,
`model-live-seed-stage-postgres.integration.test.ts`, used 1,146.503 seconds for
163 selected cases, five skipped. It accounts for 31.7% of reported Vitest file
time and 15.8% of total CI job time. The five largest reported files were:

| API integration suite                     |  Selected cases |   Seconds |
| ----------------------------------------- | --------------: | --------: |
| Seed-stage PostgreSQL                     | 163 (5 skipped) | 1,146.503 |
| Export terminal PostgreSQL                |              18 |   202.476 |
| Model execution PostgreSQL                |  44 (2 skipped) |   138.475 |
| Export initial-claim authority PostgreSQL |              41 |   114.185 |
| Export admission PostgreSQL               |              24 |   101.846 |

This is a setup/integration concentration, not evidence that hundreds of small
deterministic tests should be deleted.

The deployment workflow verifies the actual merged source and builds its own
bound bundle. Most of its cost is verification; the deployment operation itself
is comparatively short. The previous refactor results record measured CI and
release improvements and their cold/warm limitations. Raw seconds here are not
billing-rounded minutes or predictions for future runs.

Native PR path filters use the cumulative PR diff. Once a relevant
shared-package change enters a PR, later intermediate pushes continue to trigger
its proof workflows. Repeated full runs during unfinished development were an
avoidable multiplier. The new
[draft policy](../adr/0080-draft-verification-and-compact-generated-contracts.md)
keeps cheap feedback while requiring full checks when ready. It does not reuse
old test results or omit release verification.

## Reduction decisions

| Area                        | Change and retained protection                                                                                                                                                                                                                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Generated contracts         | Compact 45 JSON files: OpenAPI, 41 schemas and three compiler copies. Save 20,769,696 bytes; every parsed object remains identical. Canonical document serialization, historical catalogs and golden application bytes stay unchanged.                                                                                                                  |
| Schema tests                | Replace 24 repeated artifact-drift cases with one complete 41-artifact inventory check. Retain structural/behavioral cases, exact v3 ID and forbidden-field checks. Generation commands still enforce exact artifact bytes.                                                                                                                             |
| Migration helpers           | Replace 18 duplicate proposal helpers with one module. Retain all 18 original SQL hashes, both five-statement checks and pre/post transaction guards; four consuming suites still run.                                                                                                                                                                  |
| Expensive seed construction | Reuse the private validated fixed scaffold and return deep copies. Revalidate every configured input. Preserve all authorization, revocation, concurrency, accounting and failure cases. No clock, tenant or execution result is cached.                                                                                                                |
| Documentation               | Retire two obsolete checkpoint archives and the completed first audit/plan; condense the history index and final audit. Immutable Git links preserve original outcomes and old anchors. Keep current guides, active plans, accepted ADRs and unresolved obligations.                                                                                    |
| Draft PRs                   | Run scope, lint/format or documentation, and security; fail merge admission until ready. Ready transitions run all selected checks; conversion back to draft cancels obsolete PR work.                                                                                                                                                                  |
| Local release command       | Run the full root gate once, then distinct browser profiles, OpenAPI drift, deployment-input validation, golden checks, performance observations, dependency audit, beta synthesis and artifact checks. Avoid repeating broad backend/web/infra and Vitest E2E wrappers already covered by the root gate. Focused workstream commands remain available. |

The local release deduplication retains `check`'s complete TypeScript coverage,
typed lint/type checks, builds, deterministic model evaluation, provider assets,
Go checks, CDK synthesis, workflow policy and static/secret checks. Its three
Playwright profiles remain explicit. OpenAPI drift and deployment-input
validation are added explicitly because their old wrappers performed them.
Golden and performance commands remain explicit even where their test files also
appear in the complete suite. Dependency auditing remains fresh and external.

Compiler-embedded schemas remain because the Go compiler is independently built.
Identical golden manifests remain because separate generation scenarios must
each produce their complete expected output. Historical SQL and regression
fixtures remain because they prove upgrades and compatibility. Browser configs
under `config/playwright` remain active test inputs. The ignore policy excludes
local dependencies, caches, browser output, secrets and build products. Three
precise generated-application workspace patterns now also cover cancelled
integration runs in Git and lint discovery; ordinary source remains checked.
These outputs are not counted as tracked code.

## Verification status

Local and hosted verification, authorized integration and automatic beta
delivery are complete in PR 42 (private historical evidence, omitted from this
distribution). No hosted run was triggered by intermediate edits, and no hosted
rerun was needed.

| Evidence                       | Result                                                                                                                                                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preservation                   | All 45 complete parsed JSON objects match baseline; 512 fixture, SQL, catalog-history and canonical-serializer Git blobs remain identical. Dependency locks and registered SQL have no diff.                          |
| Focused contract/setup checks  | API contracts pass 184 cases; the final complete coverage run includes all schema cases. Five source/SQL suites pass 252 cases with five intentional profile skips. The pinned Go compiler gate passes.               |
| Configured backend             | 325 modules / 4,854 cases pass; one module / two opt-in live GitHub cases skip. Vitest takes 2,762.17 seconds with one worker, isolated PostgreSQL schemas and the real pinned compiler.                              |
| Full root gate                 | Passes in 2,763.55 seconds, including lint/types, generated drift, deterministic evaluation, all builds, coverage, Storybook, Go, CDK, workflow policy and static/secret checks.                                      |
| Coverage                       | 666 modules / 8,492 cases pass; 72 modules / 1,439 local-profile skips. Duration 2,131.46 seconds. Statements 76.80%, branches 72.28%, functions 81.50%, lines 77.54%. Selectors and thresholds are unchanged.        |
| Browser profiles               | Default: 74 pass / 55 configured skips (263.44 seconds); typed backend: 37 pass (149.34 seconds); export: 16 pass (43.21 seconds). Together they exercise 127 cases; both Linux visual cases also pass hosted checks. |
| Historical receipt preparation | Fresh frozen installation and all 17 historical builds pass in 147.75 seconds; no cached test result is used.                                                                                                         |
| Workflow and security          | All 132 final policy/security cases pass; six workflows validate. Fresh static/secret/audit checks pass with zero high/critical and seven moderate registry findings. No dependency version changes.                  |
| Remaining release stages       | OpenAPI drift, deployment-input validation, generation goldens (44 Vitest cases plus Node/Go checks), both selected performance observations, credentialless beta synthesis and exact artifact validation pass.       |

Root coverage uses the normal offline database profile after the complete
configured backend run. Its database skips do not replace that separate passing
evidence; final hosted and release profiles retain configured database checks.
The largest backend seed-stage suite takes 629.740 seconds locally. That is not
a like-for-like comparison with the Linux timing above. The seven counted
execution/seed cases excluded from coverage retain their dedicated commands and
configured backend evidence. Golden conformance runs without coverage
instrumentation. Performance observations use the existing narrow selection,
including its 20 nonselected cases.

The complete generated-object/blob comparisons, final review and focused typed
lint pass. Frozen installation has no lock drift. Git and lint ignore probes
retain ordinary source, exclude the three interrupted-test workspace prefixes
and find no tracked/ignored collisions. Full formatting, links in 460 Markdown
files and whitespace checks pass after the final documentation update.

Failed preparation attempts remain distinct from the passing gates: an early
build overlapped helper deletion; initial schema/lint/CLI-fixture mistakes were
corrected and retested; a backend start was interrupted to provide its compiler
and historical prerequisites. A local runner leaked beta metadata into three
Lambda tests, then a cancelled fixture left output that failed formatting. The
runner and fixture isolation were corrected, all nine Lambda cases also passed
with ambient beta settings, and exact ignore rules cover the generated output.
Only this task's verified inactive leftover was removed. The corrected full root
gate above passed afterward; no application guard or test expectation changed.

An unrelated preview owns port 4173. Default browser startup stopped before
tests; the first temporary wrapper also incorrectly merged two server entries.
The corrected ignored wrapper changes the local port to 4273 and retains the
same 129-case discovery and test settings. The default profile then passed. The
existing preview, other worktrees and shared PostgreSQL server remain untouched.

## Hosted verification and delivery

PR 42 (private historical evidence, omitted from this distribution) merged
tested head `f7bf410e1df0d27e642705b80657186004d75ac3` as
`584f966479c2fa1086082805436f9582c44383b8`. The tested PR merge candidate and
head have the same Git tree. PR CI (private historical evidence, omitted from
this distribution) passed 9,887 cases with 44 existing Linux-profile skips; all
three native proof workflows and 76 Chromium cases, including both visual
comparisons, passed.

The automatic beta delivery (private historical evidence, omitted from this
distribution) verified the exact merge, built its own bound bundle and passed
all 18 required jobs. Its release profile passed 9,687 cases with 244 configured
skips; the separate model-composition suite passed all 44 cases. Chromium passed
76 with 53 configured skips. Four platform stack steps and public asset, health,
readiness, runtime-configuration and DNS checks passed. No gate or protection
was waived. Signed-in owner acceptance and wider traffic-admission holds remain
separate.

The complete delivery used 6,796 raw runner-seconds versus 6,907 previously
(1.6% less), with first-job to final-job elapsed time of 1,321 versus 1,447
seconds (8.7% less). These are observed runs, not billing-rounded or guaranteed
savings. The native evidence is retained in the candidate-package (private
historical evidence, omitted from this distribution), memory-only (private
historical evidence, omitted from this distribution) and normalization (private
historical evidence, omitted from this distribution) runs.

| Observation                                | Previous seconds | Current seconds |     Change |
| ------------------------------------------ | ---------------: | --------------: | ---------: |
| Complete PR CI                             |            7,273 |           7,004 |  3.7% less |
| Timed Vitest files                         |        3,611.232 |       3,194.766 | 11.5% less |
| Seed-stage suite, same 163 cases           |        1,146.503 |         714.019 | 37.7% less |
| Native proofs with cold public-tool caches |            4,076 |           3,841 |  5.8% less |
| Complete deployment workflow               |            6,907 |           6,796 |  1.6% less |
| Deployment first-job to final-job elapsed  |            1,447 |           1,321 |  8.7% less |

The PR has 736 timed file reports and two wholly skipped modules. Some build,
lint and quality jobs were slower even though test execution improved; the total
CI change includes them. All three application-native jobs reported public-tool
cache misses. The earlier 2,557-second warm native run is not an equivalent cold
comparison. These observations do not establish guaranteed future savings.

Draft savings depend on batching unfinished work and are not included as an
invented billing credit. Full ready and release profiles remain intact. The
deployment operated on merge `584f966479c2fa1086082805436f9582c44383b8`, with a
fresh same-run bundle, original OIDC/environment boundaries and successful DNS
readback. Local main was fast-forwarded cleanly and frozen installation passed.
Other product and AI branches and the original audit stash remain preserved.
