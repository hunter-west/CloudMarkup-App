# Shared source and reproducible local setup

- Milestone: M9, independent refactor requested by the owner
- Workflows: public clone, standalone local editor, hosted source composition
- Status: implemented; independent review and native acceptance pending
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

## Validation strategy

Start with dependency-free source/composition/operator tests and a frozen
dependency install. Exercise the preview build and supported local startup. Run
affected contracts, runtime and compatibility tests when their boundaries
change. Record commands, durations, failures and skips below. Do not duplicate
the ongoing owner's release or native acceptance runs.

## Migration and security impact

No application runtime algorithm, HTTP contract, graph command, catalog,
compiler protocol, SQL, database ACL or immutable revision format changes.
Canonical migrations remain 121 registered entries through 0139; the standalone
profile still adds its existing installation identity. No data migration is
needed for this patch. Existing configurations and staged operator commands
remain valid. `docker compose build app` is replaced by the documented
`self-host.mjs build` command; Compose consumes the resulting image.

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
remains unqualified. No assertions or timeouts were relaxed. A diagnostic run
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
returned permission denied, and existing Docker/WSL holds were not changed.
Ambient Go is 1.26.5, while this checkout requires 1.26.8. No compiler run under
the wrong toolchain is claimed. Model dispatch, real accounts, production
permissions and deployment were not exercised. The release owner still owns
`check:public` and exact-source Linux/PG17 install, persistence/restart/restore,
configured export and provider acceptance.

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
