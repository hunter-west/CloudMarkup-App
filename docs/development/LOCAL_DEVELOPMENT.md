# Credentialless local development

This contributor workflow uses a pinned PostgreSQL container, a
repository-bounded filesystem object adapter, seeded development identity, fake
billing and fake jobs. It does not require or call AWS, Stripe, a model
provider, GitHub, a compiler or deployment tooling.

**PG17 contributor setup candidate; native acceptance remains pending.** Both
`local:migrate` and `local:seed` now explicitly select the existing
`cloudmarkup-standalone-pg17-v1` installation profile. The dedicated local
bootstrap creates the expected non-superuser migrator and five restricted
runtime logins; permission activation is a separate explicit command. Canonical
0127 and its protected PG16/RDS guards remain unchanged. Do not skip the
migration or fabricate RDS roles. Source tests do not establish a complete
fresh-database seed/API/restart journey.

For persisted end-user setup, use the
[standalone operator route](../../scripts/self-host/README.md) and its explicit
PG17 profile and installation-specific native checks. The commands below are a
separate synthetic contributor setup, not the persisted end-user quickstart.

The [standalone operator route](../../scripts/self-host/README.md) uses the same
API/web product with persisted local-owner sessions, five restricted database
logins and a separately named durable filesystem format. It has explicit
bootstrap and permission stages; its core profile disables models and optional
adapters. Its operator guide records prior synthetic core and infrastructure
export acceptance; each installation still requires its own native checks. The
contributor seed refuses foreign identity/workspace data, including an
initialized standalone owner workspace. Never point this workflow at an end-user
installation or reuse its database/object volume.

The launcher fails closed when it detects production mode, a non-loopback
database URL, a non-local adapter mode, an object root outside this repository,
or common AWS, Stripe, and model-provider credential variables.

## Prerequisites

- Node.js 24 and pnpm 11.16.0, as pinned by the root package.
- Docker Desktop or another Docker Engine with Compose v2.
- A clean shell without AWS, Stripe, or model-provider credentials.

[.env.example](../../.env.example) documents the defaults. The root scripts
supply those defaults directly; copying the file is not required. On Windows,
the local launcher invokes fixed `pnpm` subcommands through the absolute
`ComSpec` `cmd.exe` path. This avoids the Node.js 24 `spawn EINVAL` failure that
occurs when `pnpm.cmd` is spawned directly. The launcher accepts only its
reviewed argument vocabulary and fails closed for an invalid `ComSpec` or shell
metacharacters; Docker continues to run as a direct executable.

## First start

### Prepare dependencies

Install the pinned workspace dependencies, then build the backend workspace
dependencies before running bootstrap, migration, permissions, seed or API
scripts:

```text
pnpm install --frozen-lockfile
pnpm build:backend
```

Those API scripts invoke `tsx` directly, while runtime workspace exports point
to generated `dist` files. Installation alone does not build them. The web
predev hook prepares web dependencies only when `local:web` starts, which is too
late for the earlier API commands. Bootstrap and permission commands reuse the
same checked-in operator implementation and strict source manifests as the
standalone route.

Validate the local-only configuration without starting anything:

```text
pnpm local:check
```

## Explicit contributor service sequence

Use a fresh disposable contributor database. These operator steps create actual
PostgreSQL roles/grants in that local cluster; they are not mock permission
checks. Review the fixed `local-editor-core-v1` policy before activation. The
complete native sequence remains an acceptance prerequisite.

Start PostgreSQL and initialize the filesystem object directory:

```text
pnpm local:postgres:start
pnpm local:objects:start
```

The equivalent combined command is:

```text
pnpm local:services:start
```

PostgreSQL is bound only to `127.0.0.1:55432`. The compose file pins
`postgres:17.11-alpine3.24`; database data lives in the
`cloudmarkup-local-pg17-v1_postgres-data` Docker volume. This distinct Compose
project does not reuse the legacy `cloudmarkup-local` volume. Object storage is
the separate filesystem directory `tmp/cloudmarkup-local-pg17-v1/objects`, which
is ignored by Git. Old objects are not adopted or deleted automatically. It is
an adapter directory, not a second network service, so `local:objects:start`
initializes and validates it instead of launching a daemon.

With services started and the API stopped, run these stages in order:

```text
pnpm local:bootstrap
pnpm local:migrate
pnpm local:permissions
pnpm local:seed
```

`local:bootstrap` is only for the dedicated empty first installation. It uses
the `cloudmarkup_owner` initdb identity to create `cloudmarkup_admin` and the
five purpose logins through the existing bootstrap contract; it refuses an
already migrated/foreign database rather than resetting credentials. Migration
and relational seed SQL use `cloudmarkup_admin`. The object-aware seed phase and
API use `cloudmarkup_beta_api_runtime`, with their ordinary authorization,
trigger and publication checks.

`local:permissions` explicitly rechecks the five role identities, activates the
complete pinned core ACL transaction and checks actual runtime logins. It grants
fixed business-column/helper access to all five purposes and replaces the
reviewed export-insertion helper; it is broader than session access alone. It
does not select the provider-direct journal ACL or enable live providers. Review
`scripts/self-host/README.md` and
`apps/api/authorization-proposals/self-host-core-runtime-acl-v2.json` for the
shared authority and source hashes. These committed grants persist in the
disposable volume until explicitly changed; stopping services does not revoke
them. Startup never invokes bootstrap or ACL activation.

Run the API and web application in separate terminals:

```text
pnpm local:api
```

```text
pnpm local:web
```

The web application listens on `http://127.0.0.1:4173`; the API listens only on
`http://127.0.0.1:8787`. `local:web` always injects that loopback API URL and a
validated seeded identity into Vite. It defaults to `local-owner`. To exercise
another seeded principal, set the selector in the PowerShell terminal before
starting the web application:

```powershell
$env:CLOUDMARKUP_LOCAL_IDENTITY_TOKEN = "local-team-viewer"
pnpm local:web
```

The exact supported values are `local-owner`, `local-team-owner`,
`local-team-administrator`, `local-team-editor`, and `local-team-viewer`.
Unsupported values, a conflicting `VITE_CLOUDMARKUP_API_BASE_URL`, or a
conflicting `VITE_CLOUDMARKUP_LOCAL_IDENTITY_TOKEN` fail closed. The launcher
also injects the fake-billing Checkout success/cancel and Portal return URLs at
the exact `http://127.0.0.1:4173` web origin. A configured `localhost` billing
URL is rejected because it is a different browser origin and may resolve to an
address where the loopback-only Vite process is not listening.

The root `pnpm dev` command intentionally starts only the unconfigured Vite
workspace preview. It renders the clearly synthetic local shell and never sends
typed API or authenticated-download requests to the Vite origin. It is useful
for component and route inspection, but it does not prove API, PostgreSQL,
object-store, authentication, authorization, or persisted integration. Qualify
the complete dependency-build and explicit PG17 `local:*` sequence above for
that evidence; do not infer it from the preview.

The unconfigured synthetic default is development-only. A non-development
browser client defaults to same-origin `/api`; an explicit
`VITE_CLOUDMARKUP_API_BASE_URL` can configure its API base. This setting does
not select an identity provider, provision a database or enable AI.

Unset the identity selector to restore the default:

```powershell
Remove-Item Env:CLOUDMARKUP_LOCAL_IDENTITY_TOKEN
```

For direct API calls, the corresponding verified Authorization header is:

```text
Authorization: Bearer local-development:local-owner
```

The resolver maps only those values to seeded principals; tenant IDs in request
bodies or browser storage never establish authority.

Project list/read/create, project rename/archive/deletion, Architecture Document
draft read/save with ETag concurrency, presentation preferences, deterministic
validation evidence, immutable Architecture Revisions, and Solution Revision
manifests use PostgreSQL plus the filesystem object adapter. Their complete
fresh-PG17 contributor acceptance is pending. Solution Revision creation
validates and binds the exact draft version and digests, publishes a local
deterministic validation report, and then uses the canonical revision and
solution-record repositories. Verify the same immutable records after API
restart; infrastructure-only coverage remains explicit.

Organization directory data, plan/credit summaries, and the job surface use
deterministic local fake handlers. Fake state is process-local; it is not
presented as durable server state and does not call an external provider.

## Seed contract

The deterministic relational phase creates:

| Local identity             | Principal                            | Organization     | Role          |
| -------------------------- | ------------------------------------ | ---------------- | ------------- |
| `local-owner`              | `principal_local_owner`              | `org_local`      | owner         |
| `local-team-owner`         | `principal_local_team_owner`         | `org_local_team` | owner         |
| `local-team-administrator` | `principal_local_team_administrator` | `org_local_team` | administrator |
| `local-team-editor`        | `principal_local_team_editor`        | `org_local_team` | editor        |
| `local-team-viewer`        | `principal_local_team_viewer`        | `org_local_team` | viewer        |

The individual organization has an active fake Starter projection and 200 stable
local promotional credits. The team organization has an active fake Pro
projection and 1,000 stable local promotional credits. Both have versioned
entitlement snapshots. These records are fake, provider-neutral commercial
projections; they do not contact Stripe and are not authoritative payment
records.

Project fixtures require an object-aware phase because draft Architecture
Documents, including their Workload Document and contract sections, are stored
as verified object bytes. Later immutable revision documents and Solution
Revision manifests use the same object-publication protocol. The seed phase
stages verified object bytes, inserts publication-pending relational metadata,
publishes the object, and then promotes only the published reference to
visibility. It creates these named fixtures:

- `notes-api`, with an Architecture Document and Workload Document;
- `infrastructure-only`, with architecture-only revision compatibility;
- `workload`, with an explicit Workload Document.

The SQL seed intentionally never inserts project shells with missing object
references. A failed object-aware phase must roll back or report failure; it
must not leave a project that masquerades as reproducible.

## Normal stop and restart

Stop local services while retaining the PostgreSQL volume and filesystem
objects:

```text
pnpm local:services:stop
```

The explicit component commands are:

```text
pnpm local:objects:stop
pnpm local:postgres:stop
```

A later `pnpm local:services:start` reuses the retained state. Re-running
`local:migrate` and `local:seed` uses the same checksum-pinned profile and
stable seed identities/idempotency hashes. Do not repeat empty-database
`local:bootstrap` on an installed database. Run permission activation separately
only after reviewing the exact current profile/policy; startup never applies it.
Native repeat/restart acceptance is still required.

## Cleanup

This command is intentionally destructive for local data:

```text
pnpm local:cleanup
```

It removes the Docker Compose PostgreSQL volume and recursively deletes only the
validated repository path `tmp/cloudmarkup-local-pg17-v1`. The data cannot be
recovered unless it was copied elsewhere. Source files, other Docker volumes,
and paths outside this repository are not cleanup targets.

## Configuration and failure behavior

The defaults are:

| Setting        | Local value                                                             |
| -------------- | ----------------------------------------------------------------------- |
| Runtime        | `local`                                                                 |
| Identity       | `local`                                                                 |
| Billing        | `fake`                                                                  |
| Jobs           | `fake`                                                                  |
| Object storage | `filesystem`                                                            |
| Runtime DB     | `cloudmarkup_beta_api_runtime` at `127.0.0.1:55432/cloudmarkup`         |
| Migrator DB    | `cloudmarkup_admin` at the same target; explicit CLI only               |
| Bootstrap DB   | `cloudmarkup_owner` at the same target; first-install provisioning only |
| Profile        | `cloudmarkup-standalone-pg17-v1`                                        |

The distinct local-only password defaults are synthetic, public fixture values,
not production secrets. Exact URLs are in `.env.example`. To use another
loopback port, set `CLOUDMARKUP_LOCAL_POSTGRES_PORT`; defaults follow that port.
If overriding any of the three database URLs, its port must match. The launcher
requires literal `127.0.0.1`, exact purpose users and database name, and no URL
query/fragment that could redirect connection settings. It strips privileged
URLs from API/browser child environments. The bootstrap password reaches only
the Docker process; the migrator URL reaches only migration/seed processes. The
object root must remain `tmp/cloudmarkup-local-pg17-v1/objects`.

If `local:check` reports credential variables, start from a clean shell or unset
the named variables. Do not work around that guard by supplying dummy AWS,
Stripe, or model-provider credentials; none are part of this workflow.
