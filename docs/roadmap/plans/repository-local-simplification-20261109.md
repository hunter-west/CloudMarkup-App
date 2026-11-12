# Shared source and reproducible local setup

- Milestone: M9, independent refactor requested by the owner
- Workflows: public clone, standalone local editor, hosted source composition
- Status: active; review-driven backend/client integration, release held
- Owner: independent refactor lane; hosted release/acceptance remains separate

## Goals

- Keep one maintained application implementation with a small, explicit hosted
  overlay and verifiable source ownership.
- Make the supported fresh-clone local journey reproducible, with precise
  prerequisites and useful failures before any privileged operation.
- Preserve existing projects, migration history, provider boundaries and hosted
  release admission.

## Context

Fresh Git clones were made without modifying existing checkouts. Initial public
base: `9a3be7041a2e7ea347eede06bdd757faa79c9347`. This repository owns the
application, domain, contracts, providers, compiler and standalone runtime. The
separate hosted operations repository composes a hash-checked overlay over a
pinned public release. A second application rewrite is not justified by this
structure. Local source includes a synthetic web preview, a seeded contributor
API, and a persisted standalone runtime with separate operator stages. These are
different compositions of the same application.

## Constraints

- No merge, deployment, real provider dispatch, production-data change,
  credential creation, budget/access/security-setting change, or CI rerun.
- Preserve unrelated worktrees, backups and useful history. No history rewrite.
- Existing public/local and hosted boundaries remain enforced. Tests use
  synthetic inputs, and test success does not establish live functionality.
- No dependency or broad framework change without evidence of need.

## Checkpoints

- [x] Map composition/local configuration and establish baseline.
- [x] Implement a coherent simplification with focused regression coverage.
- [x] Verify available fresh-clone paths and compatibility; report external
      blockers.
- [x] Review final diffs and record evidence, compatibility risks and review
      guide.
- [x] Integrate command-consistent saves with supported editor transport and
      recovery; verify focused API and editor journeys locally.
- [ ] (current) Admit retained provider-usage evidence, authenticated accounting
      ownership and native migration/permission/recovery proofs.
- [ ] Freeze the corrected source pair for independent review and required
      release gates.

## Validation strategy

Start with dependency-free source/composition/operator tests and a frozen
dependency install. Exercise the preview build and supported local startup. Run
affected contracts, runtime and compatibility tests when their boundaries
change. Record commands, durations, failures and skips below. Do not duplicate
the ongoing owner's release or native acceptance runs.

## Migration and security impact

The initial setup phase changed no application runtime algorithm, HTTP contract,
graph command, catalog, compiler protocol, SQL, database ACL or immutable
revision format. Its canonical migration set had 121 registered entries through
0139; the standalone profile added its existing installation identity. That
phase needed no data migration. The backend follow-up below adds migration 0140
and requires separate native admission. Existing configurations and staged
operator commands remain valid. `docker compose build app` is replaced by the
documented `self-host.mjs build` command; Compose consumes the resulting image.

The setup helper is exclusively for a new installation directory. It cannot
overwrite an existing directory, reset credentials, seed a project, activate a
provider or approve an operator action. All generated privileged
acknowledgements remain unapproved. A failed write preserves its partial output
for inspection. On Windows, host access controls still determine privacy; POSIX
file modes are not an ACL configuration mechanism.

Existing project protection already has an owner:
`packages/graph-preparation/src/catalog-opening.ts`. Additive catalog updates
can return a lossless candidate; changed schema identities require review;
missing definitions, unknown fields and future/foreign catalogs retain the
original document. Immutable exports still require the exact catalog binding. Do
not replace this with silent best-effort rewriting or mutable revision pins.

Future service changes should preserve stable service/resource identities and
versioned schemas, extend the current provider catalog/SDK/compiler contracts,
and exercise the existing catalog-opening and deterministic export suites.
Breaking shape/meaning changes require an explicit reviewed migration design,
with refusal and recovery behavior; merely increasing a version is insufficient.

## Changes and rationale

- `prepare.mjs` derives four non-secret JSON documents and an environment file
  from the existing runtime example and migration/profile inspectors. This
  removes manual hash copying and keeps the owner identity consistent across
  setup stages. `--exports` selects the already implemented deterministic
  infrastructure export adapter; it does not enable models.
- `bootstrap.mjs` exports its existing inspection result for reuse. The same
  checks and CLI output remain authoritative; there is no second manifest
  parser.
- The build command uses the existing Dockerfile and immutable Node/Go pins
  directly. Runtime secrets and PostgreSQL configuration no longer have to exist
  merely to build an image. The duplicate Compose build declaration is removed.
  Its project lock is independent of incomplete optional-model configuration;
  runtime Compose validation remains unchanged. Configured image tags retain
  their case and registry prefix.
- The guides distinguish synthetic preview, persisted core and configured
  integrations, and place setup in executable order.

No dependency, lockfile, historical fixture, backup or application module is
removed. Broader package consolidation would have introduced risk without
evidence of duplicated runtime behavior.

## Stopping condition

The selected simplification has focused passing verification, documented setup
and compatibility behavior, a reviewable commit/PR, and an explicit list of
unverified integrations. Concrete environment/authorization blockers are
recorded rather than bypassed or represented as successful acceptance.

## Handoff and evidence

The baseline came from code and current repository instructions, without prior
chat history or personal memory. Existing unrelated worktrees were preserved.
Raw logs and generated smoke-test configuration remain outside tracked source.

| Check                                          | Observed result                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Fresh `pnpm install --frozen-lockfile`         | 631 packages, pnpm 11.16.0; passed in 4m57.3s                                                                 |
| `pnpm build:web`                               | 15 successful tasks; passed in 7m37.6s; existing large-chunk warnings                                         |
| Local/operator baseline                        | 91 passed, 4 loopback EACCES failures, 1 symlink skip in the restricted sandbox; 6.33s                        |
| Updated self-host route suite                  | 23/23 passed outside the restricted sandbox; 5.24s                                                            |
| Local-development/bootstrap/owner suites       | 76/76 passed; 125.96s on the restricted filesystem                                                            |
| Actual `prepare.mjs <new-directory> --exports` | Created only non-secret templates/empty secret directories; current 0139 hashes, acknowledgements false       |
| `pnpm security:check`                          | Static/security fixtures and secret scan passed; audit found 11 moderate advisories, no high/critical finding |

Additional checks:

- `pnpm build:backend`: 19 successful tasks (13 cached), 8m5.4s.
- Generated runtime parsed by the compiled API: local-owner, schema 0139, models
  disabled, existing infrastructure export adapter; passed.
- Catalog-opening and BYOK/Bedrock adapter/count suites: 108/108 in four
  existing files, 147.12s, with fixtures/stub transports.
- Backup/restore suites: 41/41, 0.40s, synthetic files only.
- Standalone API configuration, migration-profile, owner bootstrap, runtime,
  model-composition and server suites: 78 passed, one existing Windows-disabled
  symlink test skipped, 164.52s in six files.
- Final launcher plus backup/restore suites after project-lock separation:
  64/64, 7.66s. These include the previously listed launcher and recovery cases;
  counts should not be added together.
- The image-build case passed again after preserving configured image-tag case
  (1/1, 0.13s). This extends that existing case rather than adding another
  suite.
- Existing unconfigured local-preview browser test: 1/1 passed (3.2m including
  server/browser startup), with no API requests or failed resources.
- Changed-script ESLint passed; local Markdown links passed across 338 files.
- After the final image-tag edit, formatting, changed-script ESLint and
  `pnpm security:check` passed again (12 security cases; audit still reports 11
  moderate advisories and no high/critical finding).

Browser evidence is incomplete. Five existing editor journeys ran against a
task-owned development server: two passed and three timed out (9.3m). Repeating
only those three after initial build work produced two passes and one
first-navigation timeout (4.2m). Add-service, typed connection, delete/undo and
deterministic layout passed across the runs; the exact-fixture first-load case
was unqualified in that initial run; the November 11 follow-up below records its
later qualification. No assertions or timeouts were relaxed. A diagnostic run
against the production web bundle failed all five synthetic cases because that
bundle requires its API and disables development fixture composition. It is not
the credential-free preview. These failures are retained, not reported as a
passing browser gate.

Three new cases reuse the owning suites: build isolation (8/10), generated
configuration/source/identity and explicit approval contract (9/10), and
no-overwrite/outside-source refusal (9/10). They cover setup correctness and
preservation of operator data. The combined suite grows from 96 to 99 cases. The
initial sandbox run is not a comparable timing baseline for the unrestricted
socket suite; filesystem restrictions dominate the bootstrap timing. No new
browser suite or duplicated application scenario is introduced.

Native container acceptance is unverified here: Docker engine inspection
returned permission denied, and existing Docker/WSL holds were not changed. At
the initial November 9 check, ambient Go was 1.26.5 while this checkout required
1.26.8; the November 11 follow-up below closes that Windows-toolchain gap. No
compiler run under the wrong toolchain is claimed. Model dispatch, real
accounts, production permissions and deployment were not exercised. The release
owner still owns `check:public` and exact-source Linux/PG17 install,
persistence/restart/restore, configured export and provider acceptance.

## November 11 local validation follow-up

This bounded follow-up checked only the required Go toolchain and the previously
timed-out first editor navigation. The public checkout was clean at
`63907f62f51f33238401d36303cf31d96a24895a`; process inspection found no
overlapping check in the task workspace. Unrelated processes were left
untouched. Compiler and browser work ran sequentially. No application, test,
configuration guard, dependency, lockfile, or test-limit change was needed.

### Required Go toolchain

`GOTOOLCHAIN=go1.26.8` obtained the exact toolchain in task-scoped caches. The
process PATH selected its own `go` and `gofmt`, not the ambient 1.26.5
formatter. `go version` reported `go version go1.26.8 windows/amd64`; checking
the selected `gofmt.exe` build also reported `go1.26.8`. `GOFLAGS=-mod=readonly`
preserved module manifests.

The repository command `pnpm check:compiler` passed in 102.33s. It ran:

```text
node scripts/check-go-format.mjs
go -C services/iac-compiler vet ./...
go -C services/iac-compiler test ./...
```

Formatting and vet passed. All four Go packages passed: the compiler (29.419s),
CLI (11.005s), internal contracts (6.464s), and internal JSON Schema (8.383s).
This is Windows local compiler evidence, not Linux/container or live export
acceptance. No extra fuzz campaign, golden update, or full release gate ran.

### First-navigation editor case

The existing case at `apps/web/e2e/editor-canvas.spec.ts:125` passed unchanged.
It verifies the exact AWS fixture/catalog, minimap and Guided/Professional mode
behavior while retaining document identity, node IDs and content hash.

Exact invocation:

```text
pnpm exec playwright test apps/web/e2e/editor-canvas.spec.ts --config=.cache/refactor-playwright-validation-20261111.config.ts --grep 'opens the exact AWS fixture and catalog in both experience modes without changing its content$'
```

The task-only ignored configuration inherits the repository configuration. It
uses an owned `127.0.0.1:44173` server, refuses server reuse, writes separate
artifacts and retains the success trace. The existing 30s test limit, 5s expect
limit, 300s startup limit, one worker and zero retries remain unchanged. Node
was 24.18.0, pnpm 11.16.0 and Playwright 1.61.1. A new Vite process and clean
Chromium context started; workspace dependency builds used 14 cache hits. No
editor URL was manually preloaded.

Result: 1 passed, 0 failed/skipped/retries. The test itself took 5.730s, the
Playwright run 17.072s and the outer command 18.353s. Navigation with the
original `waitUntil: load` completed in 968.968ms. The document returned HTTP
200 in 134.106ms; all 630 recorded requests stayed on the local HTTP/WebSocket
origin, with no unsuccessful response recorded.

The preserved November 9 trace has only one document request, response status
`-1` (no response), no completed navigation, and no application-script requests
before the timeout. The later `ERR_ABORTED` accompanied timeout teardown; it is
not evidence that application code detached the frame. The unchanged case now
passes with substantial margin under its existing limit. This supports an
environment-specific navigation/transport stall in the earlier run; the exact
historical OS/network/server cause cannot be established from the retained
trace. No product defect was established, so no product or test correction was
made.

The first follow-up invocation selected zero tests because an overly anchored
grep expression did not match Playwright's full title. Its exit-1 log is
retained as a setup failure, not test evidence. Correcting only the selector
produced the single selected passing run above. This is not a
repeated-until-green test loop.

Raw evidence is retained beside the checkout in `refactor-validation-20261111/`:
`go-toolchain-setup.log`, `run-go-check.ps1`, `go-check.log`,
`go-check-outcome.json`, `editor-check.log` (selection failure),
`run-editor-run1.ps1`, `editor-check-run1.log`,
`editor-first-navigation-run1.json`, the success trace directory, and
`trace-comparison.json`. The original failed logs and trace were not
overwritten; their SHA-256 values were verified unchanged.

Publication denials remain unresolved. This pass did not push, create a PR,
merge, deploy, trigger CI, call providers, use a signed-in hosted session or
retry Docker inspection. Native Linux/PG17 persistence, restart/restore,
configured export, provider and hosted acceptance remain with their existing
owner.

## Independent review guide

1. Follow the root README from a clean public checkout. The preview should need
   only Node/pnpm; synthetic projects must remain editable in both modes.
2. Inspect generated configuration against `bootstrap.mjs inspect`; confirm
   every privileged acknowledgement starts unapproved and existing output is
   refused without changing its contents.
3. Inspect the build argument path and unchanged Dockerfile/runtime commands.
   Verify image build does not resolve runtime mounts or require secret files.
4. On an approved Linux-container/PG17 host, complete the documented explicit
   stages with disposable local credentials, then verify saved projects,
   freeze/export, restart and protected restore. These are pending native
   acceptance, not conclusions from synthetic tests.
5. Review catalog-opening refusal/preservation behavior before any future
   service or schema change. Keep provider credentials server-side and retain
   the existing quota/journal and exact revision checks.

## Post-review build containment correction — 2026-11-11

Independent review identified a regression in the credential-independent build
route: its early branch omitted the configured private-path checks. The local
correction restores that boundary without requiring runtime provisioning.

- `buildArgs()` now awaits validation of every supplied configuration, password,
  secret-directory and provider-dispatch path before returning executable or
  printable arguments. CLI build dispatch performs this validation before any
  Docker command. Omitted inputs and missing external files/directories remain
  supported; existing private contents are never read during build validation.
- The shared location helpers retain strict runtime defaults, check existing raw
  ancestry without dropping a `link/..` component, and compare canonical
  existing ancestors plus missing suffixes against the repository. Runtime still
  requires all core inputs and both optional-model inputs. Image pins, project
  validation and exclusive operator locking remain enforced.
- The owning suite gains one dispatch case (9/10 criticality: prevents
  configured credentials entering a shared image). It checks all ten
  private-path keys, malformed/wrong-type paths, native namespace spelling, safe
  absent/external inputs, diagnostic argument output, image/project validation
  and lock exclusion. Existing argument and native-link cases are extended. No
  test limits, retries or existing assertions were removed to obtain a pass.

Validation on the local correction:

- Node syntax checks, changed-script ESLint, Prettier and `git diff --check`
  passed.
- Nine selected build/dispatch/containment/Compose/Dockerfile tests passed in
  1.280 seconds. The new dispatch case took 70 milliseconds. The earlier
  5.24-second full launcher run used a broader selection, so these durations are
  not a like-for-like performance comparison.
- All 102 bootstrap, backup and restore tests passed in 6.143 seconds. These use
  synthetic files, SQL ports and container runners; no database or Docker engine
  was contacted and no real backup was changed.
- `pnpm security:check` passed: 12 static security tests, public workflow/source
  validation, secret scanning and dependency audit. The audit reported 11
  moderate advisories, no high/critical finding.

The original synthetic exposure result is retained outside tracked source. The
new dispatch test rejects its in-context marker files before the injected Docker
runner is called, and confirms the marker contents remain unchanged. A pins-only
build and safe external not-yet-created configuration still reach the synthetic
runner while holding the existing operator lock.

Native symlink/junction creation and actual Linux Docker context/image
inspection were not run because their existing restrictions remain. Native-link
regression assertions are retained for an authorized environment. This is a
locally tested correction, not complete security-fix verification or release
admission. Publication and deployment remain on hold pending independent review
of the corrected commit, the blocked native checks, and exact public/private
source admission.

### Independent patch-review follow-up

The first correction checkpoint did not pass independent review. On Windows, an
existing repository directory spelled with a trailing dot resolved inside the
checkout for Win32 consumers while Node reported it missing. The
missing-external-path allowance therefore admitted that alias. The failed review
and synthetic evidence are preserved; no Docker build or credential exposure was
observed.

The follow-up rejects trailing-dot/trailing-space Windows path components,
except the ordinary `.` and `..` navigation components, before accepting a
missing path. It also strips terminal directory separators before each raw
ancestry `lstat`, preserving both link detection and `link/..` checks. The
existing dispatch case covers the confirmed Windows alias and missing alias
forms. The existing native-link case now includes terminal separators; that case
remains unrun under the native permission restriction.

After the follow-up, the same nine focused checks passed in 1.799 seconds
(dispatch case 93 milliseconds), and the 102 bootstrap/backup/restore checks
passed in 7.929 seconds. `pnpm security:check` passed again in 14.833 seconds,
with the same 11 moderate dependency advisories and no high/critical findings.
Syntax, lint and formatting checks passed. The native fixture's separator
assertions were then bound to the directory configuration input they protect;
that fixture is still unverified, not a passing native check.

The corrected immutable candidate requires the external independent review.
Actual Linux context/image inspection, native links, source-pair admission and
the remaining release gates are still unmet. These local results do not close
the release hold.

### Backend review integration

The reviewed setup anchors remain immutable in history. The follow-up integrates
two separate correctness boundaries: command-consistent draft saves and retained
provider-usage accounting. They require new evidence and do not inherit release
admission from the setup checks.

Draft snapshot writes must retain all semantics and protected provenance; only
existing node label/position changes may use that path. Semantic edits use the
existing authoritative command endpoint, original ETag, current authorization
and editing lease, and exact receipt replay. The editor captures actual commands
independently of bounded undo history. Browser recovery retains pending command
identity and uncertain acknowledgements; it never treats a snapshot or digest as
proof of a command history. Older snapshot-only checkpoints remain recoverable
for comparison/download/copy, without a semantic-save bypass.

This integration is not ready for rollout. Focused copy-level checks preceded
integration; the complete client transport, browser checkpoint, command
receipts, catalog adaptation, imports, lease loss, offline/reconnect, and exact
undo must pass integrated checks. Required backend/web, native persistence,
source-pair and independent review gates remain separate. The server restriction
must not ship without its supported client.

The accounting proposal preserves pricing, caps, customer refunds and summary
fields. Authenticated internal report ownership and cleanup checkpoint/outcome
retention require explicit source-bound admission. Billing reader permissions do
not authorize cleanup writes. No new endpoint, live schedule, operator identity,
production record or permission is activated by local preparation.

### Local integration checkpoint

The supported server-backed editor now sends actual commands for autosave,
explicit save, close, revision creation, catalog adaptation and import draining.
Undo/redo receives fresh command identities for new actions; retry retains its
original body, key and ETag. A scope-bound IndexedDB command checkpoint
preserves uncertain requests independently of undo history and retains its
previous value under compare-and-swap. Existing snapshot recovery is unchanged.
Storage failure does not silently drop local work or authorize a semantic
snapshot write. Native browser storage/crash and offline acceptance remain
required.

Provider usage is recorded before output validation/publication and retained
through financial-release errors. Identical financial replay resolves uncertain
acknowledgements; conflicting terminal evidence remains explicit. Cleanup
follows financial completion without making refunds depend on evidence
migration. The internal projection counts agreeing representations once using
original pricing; unresolved or conflicting costs remain null/incomplete.
Customer summaries, prices, caps and refund calculations are unchanged.
All-write failure still can leave counts only in memory; no crash-durability
guarantee or fabricated backfill is claimed.

Migration 0140 adds five write-once observation columns and an invoker trigger.
All 121 prior migration bytes/checksums remain unchanged. Ordinary-role column
grants are a separate **unapplied** authority proposal. The report reader has no
authenticated entry point, and cleanup has no durable owner/checkpoint wiring.
The integration is therefore incomplete and held: internal operator/report
visibility and checkpoint retention/deletion/restore must be admitted before
those contracts are activated. Existing billing-reader grants confer no cleanup
write authority. No new service, schedule, or live database change was made.

Focused source checks passed: 69 editor lifecycle/session/lease/command-recovery
tests; 31 model-adapter fixture tests; two API command-save tests; two read-only
migration manifest/portable-byte tests; and three selected domain replacement,
inverse and catalog cases. Six accounting tests passed with SQL/financial or
admitted-authority doubles, including source-wrapper observation/publication
failure, financial lost acknowledgement, pre-commit failure, conflicting
terminal state and retained legacy usage during cleanup failure. API and web
no-emit checks passed. OpenAPI regeneration and verification passed, with only
the draft-save operation summary changed. Local static security checks and
secret scanning passed; the network-dependent registry audit remains unrun for
this integration.

Failed attempts remain in the external evidence bundle. Early web fixture issues
and command-capture ordering were corrected without relaxing test limits. Tests
for immutable revision retries now require the existing saved version when the
command queue is empty, retaining exact request replay. Initial lint failures
identified weak recovery-input typing and fixture conventions; changed-file lint
passed after correction. One new source-wrapper mock had an incorrect return
shape; its corrected API type-check and six focused tests passed. These are
author checks, not independent review or native certification.

New regression cases protect semantic/provenance rejection, generated
replacement and inverse compatibility, command receipt/retry/recovery, known
financial usage and release availability (criticality 8–10/10). Existing
lifecycle, validation, lease, store and session suites were extended; the
IndexedDB double was extracted without deleting its five tests. No performance
improvement is claimed: selected runs and concurrent local checks are not
comparable suite baselines.

Remaining admission: authenticated accounting owner/checkpoint and report
access; native SQL/ordinary roles/concurrency/lost acknowledgements/restore;
complete source-generation and asynchronous-worker orchestration; real-browser
recovery; the required backend/web/public gates and registry audit; exact
hosted/public composition and independent review. The retained build-context
native-link and container/image gates remain unrun under their existing
restrictions. Source integration is neither deployment evidence nor permission
to bypass these gates.

### Recovery corrections and scoped report preparation

Independent review of the integrated candidate found three editor recovery
regressions. Completed command records consumed the 32-scope capacity forever; a
rejected record could not be reset through the offered reload action; and
confirmed local clearing omitted the new command database. The correction
retires only provably completed records, preserves pending or unexplained prior
work, and provides explicit evidence download, previous-checkpoint recovery and
atomic quarantine/reset. Failed or uncertain reset acknowledgements cannot
install a new in-memory drain. Confirmed clearing now includes both databases;
blocked/error outcomes prevent a reported successful clear. Ordinary sign-out
and cancelled clearing retain local work. No real recovery data was deleted.

Sixty-three focused recovery/session/lifecycle tests passed with synthetic
IndexedDB and UI fixtures. Web type checking and changed-file lint passed. The
native stale-import setup now advances through an authoritative domain command,
preserving its stale-import assertion; that PostgreSQL test remains unrun.

The [staff-report proposal](../../adr/proposed-staff-provider-cost-report.md)
records the approved audience and new implementation. A dedicated permission and
separately audited exact organization grant gate each page, with canonical
session/staff checks before and after its read-only cost query. Migration 0141
and operator source add no automatic grants or live authority. The original 122
migration bytes and manifest entries remain preserved. Ordinary-role authority
deltas and native grant/transaction/restore admission remain pending. Customer
summaries and accepted provider accounting/financial calculations are unchanged.

Focused author tests cover report authorization, foreign scope, revocation,
cursor/cohort binding, scoped operator audit, transport and UI boundaries.
API/web type checks, changed-file lint and OpenAPI verification passed after
correcting a duplicate no-store header, a missing operation registry entry and
operator result narrowing. Original failed attempts are retained externally.
These checks are not independent review or native proof.

Cleanup-owner preparation remains separate and unapplied. Its bounded protocol
checkpoints selected identities before cleanup, uses organization-bound CAS and
exact operation receipts, records each outcome, progresses past failed rows and
restarts completed sweeps. Synthetic copy tests include failed/lost checkpoint
acknowledgements, competing owners, revocation and restore fencing. No durable
adapter, meter selection/execution binding or production caller is supplied;
none of those tests establishes actual durable cleanup. Storage classification,
holds, recovery and retention admission remain unresolved.

No TTL is enabled. Thirty days is only a tentative possibility for redundant
operational metadata after durably verified completion and hold/replay/restore
checks. Pending or uncertain work, recoverable previous copies, unique provider
observations and canonical financial/security/audit evidence are excluded.
Existing data policies have not established a legal retention period for these
new operational records. No jurisdiction or new financial policy is assumed.

Publication and release remain held for immutable corrected-candidate review,
ordinary-role/native SQL/concurrency/restore, real-browser recovery, cleanup
owner admission, required integrated gates and exact public/private composition.
Prior setup native-link/container restrictions remain. Current source checks do
not admit a release, grant staff access or certify a retention policy.

### Checkpoint retirement acknowledgement follow-up

Independent review reproduced an additional recovery sequence: completed record
retirement commits, its acknowledgement is lost, and a newer command is queued
before retry. The old checkpoint fingerprint then falsely reported another
writer. The checkpoint now retains the exact unacknowledged operation and
reconciles it before writing newer state. Only the known retirement can resolve
its missing record; unrelated missing or changed records still fail CAS. The
existing recovery download includes this pending operation alongside local
edits.

Four focused synthetic sequences cover the reported failure, unchanged retry,
pre-commit failure with a newer edit and a real competing writer. Before the
correction, only the reported sequence failed after correcting two fixture
assertions; both initial receipts are retained outside source. After correction,
all 17 command-drain/checkpoint cases passed in 13.14 seconds. Web type checking
and changed-file lint passed. The four added cases protect saved/unsaved work
and replay identity (criticality 9/10); they extend the owning IndexedDB double
without duplicating native or browser suites. Compared with the earlier broader
63-case recovery run, this narrower selection is not a performance comparison.

These are author-executed synthetic acknowledgement checks. Native IndexedDB
transaction, browser quota, cross-tab and restart evidence remains unrun. No
provider, accounting, permission, migration, pricing or retention behavior is
changed by this follow-up. The previously reviewed candidate and evidence remain
available; independent review of this successor and all retained release gates
are still required.

### Operational cleanup successor

The earlier tentative 30-day discussion is superseded by the approved 60-day
target for redundant completed operational details, scoped in the
[cleanup retention proposal](../../adr/proposed-beta-ai-cleanup-retention.md).
The successor separates meter selection from execution and adds durable
checkpoint/receipt storage, canonical completion verification, current-session
authorization and explicit dry-run eligibility. No financial/customer contract,
unique usage, browser-recovery lifetime or historical migration changes.
Restore-owner binding, native/ordinary-role admission and independent review
remain required. No live grant, retirement caller, TTL or deletion is activated.

### Current schema and historical fixture admission

The formatter-only PR successor reached backend CI and exposed stale `0139`
runtime/profile/release expectations after additive `0140` and `0141`. The local
cleanup successor adds `0142`, so qualification now binds that complete current
registry. The standalone profile retains its original identity and portable
`0000`/`0127` bytes, and the core ACL keeps the same unarmed column/function
grants. Production composition, scheduled-host expectations, migrator imports,
release guards and handoff counts must agree with the same exact source.

Historical evaluation prefixes retain their original counts, statements and
digests. Ordinary isolated-schema tests select `0001`–`0098` plus the reviewed
ordinary additions, excluding the protected `0099`–`0137` role topology. Because
canonical `0140` explicitly targets `public`, its isolated fixture has a
distinct filename and checksum and uses no public-schema names. It is fixture
behavior, not evidence that the canonical migration was executed or admitted.
Native public-schema, protected-role and restore qualification remain separate.

The original ordinary ACL evidence is preserved. Its source successor records
the changed consumers and new schema/permission proposal hashes without claiming
native qualification or enabling optional accounting/staff/cleanup authority.
The private overlay/source pin remains intentionally unadmitted until authentic
successor public assets and exact composition receipts are available. No private
repin, production schema operation, grant or deletion accompanies this repair.

### Independent cleanup and fixture corrections

The independent review found that awaiting optional accounting maintenance could
stall an otherwise healthy balance response. Commercial reads now neither start
maintenance nor await its admission/storage. The separately awaited durable
owner keeps its exact-page retry and authorization controls;
execution/restore-owner admission remains required. No background Lambda promise
or timeout race is used.

Three native consumers also retained the old fixture tail positions. They now
compare the complete requested/applied version sequence and look up historical
statement checks by version. The canonical 124-migration registry, isolated
85-entry layout and protected-prefix checks remain unchanged. Focused checks
exercise pending-maintenance isolation, retained cleanup replay and the real
consumer assertion fragments with synthetic ledger rows; native SQL remains a
separate gate. Original failed receipts and reviewed commits stay immutable.

### Deployment test execution consolidation

The complete public check runs API-contract tests once in its contracts phase;
the later backend phase runs API and repository-export services. Standalone
`test:backend` still includes API contracts. The main-only native workflow runs
shared package-policy assertions once, retaining both actual package groups and
the separate memory/normalization proofs. Release suites are listed explicitly
instead of importing other test modules for side effects. No unique test case,
native proof, negative control, timeout or release permission is removed.

The prior CI log records 34 API-contract files / 313 cases executed twice. Its
second-pass test-body durations total 1.344 seconds; this is not measured job
time saved. Shared native package-policy executions drop from three to one. The
private deployment policy also reuses its already completed workflow-policy
suite instead of executing it again through CI validation. Workflow/job counts
and source/native/release admission requirements remain unchanged.

### Image-context validation corrections

The shared source validator now checks the effective final-stage user and exact
service entrypoint, rejecting later overrides and unsupported parser forms.
Archive generation completes short writes and rejects invalid progress before
hashing a chunk. Existing reviewed recipes and digest-only output remain
supported. Focused synthetic regressions and fixture controls cover both paths;
actual Docker execution and image inspection remain separate qualification.

### Delivery-audit follow-up

Exact secret-fixture exceptions are filtered before the scanner's retained
finding limit; dense allowed fixtures cannot hide later unmatched findings. The
optional branding writer now edits Markdown prose ranges through the already
pinned parser, preserving links, code, identifiers and accepted early historical
decisions. Its check command runs focused synthetic-file regressions before
inspecting documentation. Native-proof assertions require each guard and
operation to exist before comparing their order. Tool self-test documentation
now describes the actual temporary fixture and its explicit dependency link.

The image validator also rejects full-line comments ending in a continuation
before joining instructions. Both recipe contexts have LF/CRLF positive and
negative controls in the existing runtime case. The unique private refreshed
license-rejection assertion is shared upstream; the test copies are identical.
Removing the private override still requires authentic successor source assets,
the matching admitted pin and cold-composition evidence. No native gate, source
guard, deployment permission or live setting changes with these corrections.

### Application-state follow-up

Adopted-resource deletion reports an unavailable inverse rather than inventing
restoration authority; direct adopted-add refusal and ordinary inverse behavior
remain. Job callbacks and completion retain the original attempt identity across
awaits, including replacement claims that reuse a worker ID. Browser recovery
owns both request and transaction failures before returning, retaining the prior
checkpoint. Focused tests use synthetic jobs and IndexedDB stores only.

Renderer 1.2.0 corrects the zero-summary budget above 50 nodes and is selected
by new export profiles. Historical renderer pins 1.0.0 and 1.1.0 retain their
exact behavior; saved revisions are not relabeled. The existing icon test now
reaches both digest and sanitization boundaries. The retained-provider directory
test uses healthy independent history so a corrupt pending file cannot mask its
incarnation check. That filesystem test remains unrun here because the existing
rename restriction was not retried. Current contributor guidance includes the
build/bootstrap/permission sequence and the actual PG17 cleanup scope.

These changes require independent source review and normal integrated CI. Native
SQL, filesystem/browser durability, exact hosted admission and release
qualification remain separate; no production change or deletion is authorized by
focused source tests.

### Project-state follow-up

The compact workload editor now verifies that its existing managed contracts
round-trip through the same builder used for changes. Saved nullable fields,
descriptions, storage semantics, failure outcomes and authorization remain
unchanged when the compact form cannot represent them; both form resolution and
direct preparation refuse such edits. Simple managed contracts remain editable.

The shared client serializes validated numeric page/limit values alongside
string cursors. Schema bounds and server pagination guards remain intact. The
sensitive-action helper distinguishes operation failure from audit-delivery
failure: a completed operation is never relabeled failed or rerun because its
success event was not acknowledged. Delivery errors still reach the caller.

Focused synthetic regressions also cover populated retained-history replay and
valid revision-authority refusal fixtures. Editor ADR headers link their precise
accepted partial successors. Native restore, provider calls, browser journeys,
exact hosted admission and release acceptance remain separate gates.

### Persistence and list follow-up

Object staging retains an owned copy of every streamed chunk before hashing, so
buffer reuse cannot change the acknowledged bytes. Unsaved presentation
preferences use a distinct conditional-write identity from the first saved row.
A new opaque preference-validator namespace also rejects cached predecessor
validators, which aliased the absent state and stored version one. Clients must
read current preferences before an explicit retry; failed writes are not
replayed automatically. Persisted numeric versions and the positive public sync
version remain unchanged. Lifecycle retries pass the original project version to
the durable receipt/CAS owner; deletion responses read version metadata without
reopening draft content. Unexpected coded import errors retain the generic
server-error boundary.

Project and revision lists apply stable sort and continuation predicates before
the SQL limit. Cursors bind the principal, organization, collection and
requested ordering; timestamp continuations preserve database microseconds.
Every page still requires current authorization. Old project cursors must
restart the list; continuation does not promise a point-in-time snapshot across
mutable pages. Project summaries no longer query environment counts they
discard. Focused provider-free tests cover these boundaries; native SQL/roles,
concurrency, filesystem durability and exact hosted composition remain
unqualified. The ordinary-role source proposal records the new read paths
without granting or activating additional permissions.

### Repository import recovery follow-up

The reserved import attempt now owns its initial progress write. A transient
failure can reclaim the same import and snapshot through the existing attempt
and version fence. Progress delivery after a successful commit cannot append a
false failed-import event. Webhook refresh recovers the original baseline from
the persisted import fingerprint before retrying; completed subscriptions do not
become new imports after another subscription fails or an acknowledgement is
lost. Manual requests remain distinct, existing receipts remain immutable, and
production automatic refresh remains unavailable.

The workspace owns installation/repository selection, including remounts after
delayed branch reads. Discovery and explicit import use that same selection.
Quoted generic token assignments, including truncated values, are redacted from
optional interpretation evidence and again by the model gateway; the metadata
reflects the detected transformation. No model or webhook capability is enabled
by these corrections. Focused fake-store and DOM tests cover the reported
sequences; native database, real browser/provider and hosted admission remain
separate.

### Persistence proof and test consolidation

Verified read streams now yield owned buffers, so a retaining export reader sees
the same bytes that were hashed even when its producer reuses storage. The
receipt negative starts from a schema-valid successful export and changes only
the retained archive binding. An unmapped-resource assertion now checks the
diagram itself. Four overlapping cases were removed while retaining terminal
principal/preview refusal, active-attempt protection, exact evaluated revision,
wrong-environment refusal and admission-generation type checks. Native cases,
production schemas, workflow selection and source-admission gates are unchanged.

### Export content and size boundaries

The pure export assembler rejects prohibited assignments with quoted keys and
inspects the already-supported CycloneDX JSON media type. Safe references and
artifact bytes keep their existing digest conventions. Generated manifests now
obey the same per-file bound as payloads; independent verification and retained
reconstruction enforce that bound too. Invalid JSON or undecodable verification
content yields a bounded diagnostic without parser text. These changes do not
publish artifacts, enable providers or qualify hosted/native release behavior.
The checksum and ZIP round-trip assertions share one successful-export fixture,
removing a duplicate generation while retaining order, sizes and exact bytes.

### Current migration consumer assertions

The remaining migration-preservation consumers use the existing checksum-pinned
current-registry loader. Their distinct historical prefix hashes and statement
checks remain intact. The separately gated bootstrap fixture compares the full
ordered version/checksum ledger after its repeated migration runs. Source-level
assertion probes cover the stale-count failures and altered-history refusals;
native bootstrap, PostgreSQL and integrated CI acceptance remain separate.

### Export workflow capacity and retry boundaries

The supported 32-build batch now has room for its additional target-validation
Evidence in workflow projections and canonical job output. The shared finite
ceiling is 34; unrelated job families and per-stage limits retain their existing
bounds. Success and failure projections preserve every reference. The diagram
wrapper preserves typed monitor failures and their bounded retry delay while
unknown renderer errors stay sanitized and permanent. Deferred-operation tests
and projected capacity checks are provider-free; they do not execute 32 builds
or establish native worker, compiler, browser or hosted acceptance.

### Export test maintenance

Terminal negative fixtures now reach their intended failure and cancellation
guards. Two overlapping checks share their existing owning cases; twelve data
rows that were already excluded no longer obscure the active vectors. The
two-build fixture reuses the same deterministic generator helper. A canned
browser reload case was removed: its narrow presentation guarantee is no longer
separately asserted, and it never proved regeneration or challenged redaction.
Actual diff, retry identity, authenticated download and checksum checks remain.
Focused checks pass; browser and native qualification remain separate.

### Export adapter cancellation and runner guidance

The in-memory publication adapter preserves the canonical cancellation request
when an older processor returns a later successful projection. It acknowledges
cancellation without requeuing or publishing an artifact; immutable identity,
state and timestamp guards remain. A deferred processor regression reproduces
the previous conflict and covers the corrected queue and download behavior.
Runner instructions now distinguish the existing fixed preparation step from
non-root, capability-free validation. Executor code, approval requirements and
production workers are unchanged; no container or provider execution is implied.

### Runner result and cancellation boundaries

Required Terraform command unavailability now follows the same error
classification as required extensions; optional analyzers retain their explicit
warning behavior. Unsupported provider/source diagnostics use fixed text with
retained file references. Application builds check cancellation before workspace
acquisition, forward the transient signal, and classify incomplete scans by
termination before demanding successful output. Acquisition rejection and
partial cleanup remain executor responsibilities. The guide names all
already-admitted generated families and distinguishes fixed Terraform staging
from unprivileged validation. Fake-executor regressions cover these boundaries;
native and hosted activation remain separate. Two standalone
sanitizer/compatibility setups now share their existing owning cases.
Output-path negatives are independent, and the forged-artifact case refreshes
its outer digest so it reaches the intended byte-binding guard.

### Customer CI response-size evidence

The existing actual-response-size rejection now supplies an allowed declared
length and valid oversized repository-identity JSON. Fixture assertions prove
that the response body is read and that parsing or identity mismatch cannot
explain the rejection. The separate declared-size case, generic diagnostics,
fetch options and token-redaction checks remain. This changes no generated
workflow, admission limit or test count; focused execution uses a synthetic
fetch and does not establish live GitHub or hosted acceptance.

### Host-repair isolation and lineage evidence

The existing cross-tenant observation case retains foreign-plan refusal and
separately selects a foreign invocation through a valid local plan. It asserts
the journal-query parameters, no attempted writes and unchanged tenant state.
The candidate-receipt case retains checksum refusal, then rehashes the altered
predecessor and verifies schema-valid but incompatible lineage. Both changes
extend existing cases without changing production code, historical SQL or clock
contracts. Synthetic codec and assertion probes are distinct from the
still-required native PostgreSQL restoration evidence.

### Sequence-receipt refusal evidence

The historical-terminal test now requires zero SQL, database-transaction and
authority-transaction calls as well as access denial. Its constructor negatives
remain. The direct-SQL substitution case verifies the accepted request/decision
baseline and requires the specific binding-validation error for each of its five
mutations; duplicate-key or unrelated failures cannot satisfy it. The separate
exact stage-uniqueness assertion remains. Case counts, production accounting and
historical migrations are unchanged. Native database proof remains separate from
the focused unit and synthetic assertion checks.

### Export reload coverage consolidation

The existing authenticated-download browser case now checks the displayed
archive digest before and after reloading the same job. It retains the real
download-byte checksum and grant-header assertions without restoring a separate
case or the redundant rerun fixture. The guide names that exact fixture-backed
guarantee. This checks presentation of the same mocked job, not regeneration,
database recovery or challenged redaction; browser execution remains a separate
qualification gate.

### Execution-suite fixture profile preparation

The execution suite now takes its synthetic pricing account from the existing
test-only dispatch fixture owner. Its value is explicit for the distribution;
production pricing schemas and account allowlists remain unchanged. All test
registrations, assertions, native/compiler gates and focused selectors are
preserved. The matching private helper after-image remains unapplied, and the
private execution-suite copy stays in place until authentic source intake and
cold composition qualify the shared suite and its profile. This preparation does
not claim native execution or a runtime saving.
