# Controlled-beta performance baseline

## Evidence boundary

This baseline is non-gating local evidence from 2026-08-30 on Windows,
`Node v24.19.0`, pnpm `11.16.0`, Go `windows/amd64`, and an Intel Core Ultra 7
268V. Results are warmed development-machine observations, not browser response-
time objectives, production capacity, or customer-device guarantees. Correctness
and a deliberately broad 30-second stuck-operation ceiling are asserted; exact
milliseconds are logged and never used as a flaky pass/fail threshold.

Run `pnpm performance:beta` to build the workspace, inventory artifacts, run the
Go compiler benchmarks, profile representative editor transformations, and run
the application-generator baselines. The command uses no credentials, network,
provider, deployment, Terraform apply, or CloudFormation change set.

## Representative sizes

| Class             | Architecture graph                                     | Workload/contracts                                  | Repository snapshot                              | Evidence                                             |
| ----------------- | ------------------------------------------------------ | --------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------- |
| Small             | 25 nodes; curated simple connections                   | 1 handler and 1-3 operations                        | up to 100 relevant files / 1 MiB scanned content | one target, one plan/deploy summary                  |
| Medium            | 100 nodes; curated fan-out/network/event relationships | initial complete family plus curated event handlers | up to 2,000 relevant files / 32 MiB              | both IaC targets and several evidence revisions      |
| Large beta stress | 500 nodes; relationship-heavy browser fixture required | multi-handler contracts at configured schema limits | up to 10,000 relevant files / 128 MiB            | bounded issue/table history at configured API limits |

These are performance fixtures, not raised product limits. The executable editor
profile currently uses catalog-bound Lambda nodes and zero edges to isolate node
projection, validation, command, serialization, and layout-request costs. The
relationship-heavy browser, repository, usage-table, and evidence-table large
fixtures remain explicit follow-up measurements and are not represented by the
numbers below.

## Editor deterministic-operation profile

One iteration per size was captured by
`apps/web/src/features/editor/beta-performance.test.ts`. Times are milliseconds.

| Size   | Nodes | Projection | Selection | Graph Command | Validation | Autosave preparation | Layout request | Serialized bytes | Findings |
| ------ | ----: | ---------: | --------: | ------------: | ---------: | -------------------: | -------------: | ---------------: | -------: |
| Small  |    25 |       4.67 |      0.04 |          1.36 |      32.11 |                10.16 |           4.42 |           40,116 |      100 |
| Medium |   100 |      37.40 |      0.04 |          1.48 |      46.72 |                13.09 |          23.27 |          154,323 |      400 |
| Large  |   500 |     483.39 |      0.19 |          6.79 |     196.27 |                71.59 |         472.83 |          763,743 |    2,000 |

Autosave preparation measures canonical serialization and hashing, not IndexedDB
or API round-trip time. Layout request measures deterministic projection/request
construction, not the ELK worker's full layout. Selection measures exact model
lookup, not a browser paint. Rendering, pointer drag, and frame latency require
Playwright/browser profiling on representative hardware.

## Compiler and application generation

The Go golden compiler benchmark ran 20 iterations:

| Fixture |      Time/op |  Bytes/op | Allocations/op |
| ------- | -----------: | --------: | -------------: |
| Small   |   566,155 ns |   715,189 |          3,998 |
| Medium  | 1,961,995 ns | 2,840,856 |         16,248 |

The deterministic application-generator baseline ran 10 iterations per fixture:

| Fixture | Total for 10 | Files/result |
| ------- | -----------: | -----------: |
| Small   |    617.40 ms |           16 |
| Medium  |  1,392.47 ms |           33 |

These tests validate stable output while measuring. Application build/test and
deterministic ZIP reproducibility remain correctness-gated by the build-runner
suites; end-to-end sandbox wall time varies with the container/runtime cache and
is not assigned an unverified latency target.

## Artifact and chunk inventory

Sizes are uncompressed local `dist` inventories and may include declarations,
source maps, and test-support modules. They are useful regression signals, not
download or Lambda deployed-package sizes.

| Target                   | Files | Total bytes | Largest local file                     |
| ------------------------ | ----: | ----------: | -------------------------------------- |
| Web production build     |    13 |   5,124,818 | main JS 3,488,071 bytes                |
| API build tree           |   352 |   1,984,216 | commercial repository JS 172,849 bytes |
| Application generator    |    36 |     716,381 | resolver JS 104,152 bytes              |
| Application build runner |    32 |     519,692 | contracts declaration 241,537 bytes    |
| Architecture CLI         |    18 |     207,198 | test-fixtures JS 59,465 bytes          |
| Diagram export           |    32 |     375,638 | contracts declaration 169,351 bytes    |

The web build has a separate 1,426,493-byte ELK worker chunk. The 3,488,071-byte
main JavaScript chunk is a beta optimization concern; compression and route-
level loading must be measured in a production-like browser before setting a
budget.

## Requested subsystem profile disposition

| Subsystem                | Current evidence                                                                         | Cancellation/bound                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Rendering/drag/selection | Selection and model projection measured above; Chromium interaction correctness exists   | stale layout is ignored; browser frame/drag profile pending           |
| Command application      | Measured above with a real versioned move command                                        | preconditions and bounded history fail closed                         |
| Validation               | Draft and compilation validation measured above                                          | stale requests are discarded; finding/payload limits apply            |
| Autosave                 | Serialization/hash measured; interruption, coalescing, CAS conflict, and recovery tested | latest-save drain and bounded recovery record                         |
| Layout                   | Request creation measured; existing ELK execution is isolated in a cancellable worker    | superseded responses cannot mutate current document                   |
| Semantic diff            | Deterministic correctness and size limits tested across CLI/targets/contracts            | no timing baseline yet                                                |
| Compiler                 | Go small/medium benchmark above                                                          | immutable input; no network/credentials/extensions                    |
| Application generation   | Small/medium baseline above                                                              | typed Workload/contracts and configured limits only                   |
| Application build/test   | Deterministic command, timeout, scan, ZIP, and multi-artifact tests                      | sandbox timeout/concurrency/output bounds; wall-time baseline pending |
| Diagram export           | Reproducibility, accessibility, redaction, and output limits tested                      | stale job/cancel behavior; wall-time baseline pending                 |
| Code preview             | File count/size/path and safe preview behavior tested                                    | bounded payload/history; browser large-tree timing pending            |
| CLI verify               | Deterministic human/JSON and semantic behavior tested                                    | local process limits; repository timing pending                       |
| Usage/evidence tables    | Pagination, redaction, authorization, stale/partial state tested                         | API page/history limits; browser large-table timing pending           |
| Plan/drift processing    | Sanitization, checksum/identity, difference classes, and no-remediation tested           | payload/expiry limits; large-plan timing pending                      |

## Engineering decisions

- Retain the existing cancellable ELK worker. At 500 nodes, main-thread
  projection and request preparation are already about 0.48 and 0.47 seconds;
  moving ELK execution back to the UI thread would add work to that path.
- Do not add more workers without a browser profile showing a blocking task and
  a safe serialization boundary. Domain commands and validation stay
  deterministic.
- Do not virtualize lists yet. No representative browser measurement proves that
  virtualization's focus/order/announcement complexity is justified. Pagination
  and configured bounds remain the current protection.
- Cancel or ignore stale layout, validation, preview, import, generation, and
  evidence requests. A late response never overwrites a newer document/revision.
- Bound graph/workload/contract payloads, command history, findings, files,
  previews, job logs, plans, drift summaries, and evidence history at their
  owning API/domain boundary; never rely on browser memory as authorization.
- Track web chunks, built runtimes, generated application ZIP checksums,
  compiler and CLI versions, and artifact provenance in release evidence. Size
  change needs explanation, not an automatically weakened security check.

## Next measurements before broad beta

Profile the relationship-heavy 100/500-node canvas in production Chromium,
Firefox, and WebKit; end-to-end autosave API latency; ELK execution; semantic
diff; build sandbox cold/warm runs; diagram/PNG export; large generated-file
preview; CLI verify on defined repositories; usage/evidence tables; and
sanitized large Terraform plan/CloudFormation/drift processing. Record p50/p95,
long tasks, peak heap, artifact bytes, cancellation behavior, and fixture digest
before adopting thresholds, virtualization, or additional workers.

## September 30 runtime audit

The standalone diagram, ZIP, filesystem/JSON import and Lambda timing harness
was specific to the September 30 refactor audit. Its implementation remains in
Git commit `eee76838497f125e62e3d4cebe951787123062c8`; it is no longer current
repository tooling. The observations below retain their original source and
environment boundaries.

Use `pnpm performance:beta` for the current scheduled/manual measurement
profile. Diagram, ZIP, importer and Lambda-bundling regression suites remain the
correctness authority; this historical audit does not replace them.

### September 30 reproducibility observations

Both independent invocations passed in 39.05 and 16.73 seconds, after all 24
build tasks were rebuilt without restoring stale outputs (124.07 seconds). The
prescribed subsequent `pnpm build` passed with 24 cache hits in 3.26 seconds.
These build conditions are distinct; they do not establish a cold-build speedup.
The measurements used Node 24.18.0, Go 1.26.8, Windows 10.0.26200 x64, Intel
Core Ultra 7 268V (eight logical CPUs), and 34,027,393,024 bytes of memory. No
concurrent verification ran during either invocation.

The working source was phase-five commit
`540092fc84b8045b3e3e7b4273d845147dd3f7c0` plus the reviewed E02/E03 changes
(`worktreeDirty: true`). The exact harness SHA-256 is
`4208eaf8e981c3bba3d6123ba9853a1a530cbf9aa606566167f7de24671270e3`. The same
changes are retained in the phase-six commit recorded by the execution plan;
this dirty receipt is not labeled an exact-head hosted check.

| Workload                          | Before median ms | Run 1 min / median / max ms | Run 2 min / median / max ms | Output bytes |
| --------------------------------- | ---------------: | --------------------------: | --------------------------: | -----------: |
| Notes CRUD diagram                |           60.180 |    55.397 / 57.005 / 78.566 |    54.067 / 56.226 / 58.541 |       60,843 |
| STORE ZIP, 100 entries            |            0.682 |       0.645 / 0.690 / 0.961 |       0.607 / 0.670 / 0.875 |      115,022 |
| STORE ZIP, 1,000 entries          |            6.442 |       5.856 / 6.662 / 8.834 |       5.687 / 6.107 / 7.520 |    1,150,022 |
| Filesystem/JSON import, 30 files  |           58.512 |    51.764 / 61.330 / 73.277 |    50.761 / 55.131 / 67.555 |      177,114 |
| Filesystem/JSON import, 105 files |          163.298 | 161.636 / 176.065 / 185.096 | 152.244 / 202.545 / 270.225 |      599,442 |
| Local Lambda module import        |          533.793 | 485.459 / 495.940 / 529.870 | 481.448 / 506.011 / 517.783 |   16,358,354 |

All six output digests and all five explicit fixture digests match between the
independent runs. Diagram, ZIP and import digests and output sizes also match
the fresh main baseline. The Lambda bundle remains 24 files: 10,904,529 bytes of
JavaScript (96 more than baseline) and 5,453,825 map bytes (119 more). Initial
static JavaScript is 10,239,827 bytes across six files; six other JavaScript
files are dynamic chunks. The current bundle digest is
`c1c107f150f3b9d9ec75c4e286f0f9eb4eb8b2c433091aec09ef17e3255e7fe9`. The source
relocation/extraction changes that build artifact, while both current
invocations agree. The artifact grew by 215 bytes; no bundle saving is claimed.
Observed post-import median RSS was 299,143,168 bytes in the first run.

Timing variation, especially the larger filesystem import, is visible in these
small sequential samples. No runtime, service-latency or cost improvement is
established. These are historical audit observations; current regression tests
and protected-output comparisons remain separate requirements.
