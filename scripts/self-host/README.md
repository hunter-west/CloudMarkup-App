# Windows self-host route through Linux containers

This source route packages the existing CloudMarkup backend, browser
application, workspace jobs and Go compiler. There is one application codebase.
It does not substitute the fake development server, fake identities, jobs or
billing.

**Current state: synthetic PG17 core and configured infrastructure export
accepted locally; public Linux CI and hosted/provider admission remain open.**
The shared server, strict standalone PostgreSQL 17 profile, local-owner
sessions, guarded persistence and explicit core runtime are implemented. The
default example leaves models and optional adapters disabled. The
[configured runtime guide](CONFIGURED_MODELS.md) explains the additional
source-bound setup for durable proposals and infrastructure-only exports. A
disposable local project passed revision freeze, export job claim, native
compilation, validation, artifact publication and authenticated ZIP download;
the artifact digest matched the retained record. No application-code build or
live model-provider invocation is established. Billing, repository delivery,
conformance and project erasure require separate profile/permission/factory
admission. A successful container start alone is not application readiness.

## Prerequisites and private configuration

Use an already approved Docker Desktop installation with its WSL 2 backend and
**Linux containers**. This launcher never installs Docker/WSL, enables Windows
features, changes networking/firewalls or mounts the Docker socket in the app.
Use the repository's Node **24.18.0** for the host CLI and pnpm **11.16.0** for
the image build. The compiler source pins Go **1.26.8**.

The app runs as UID/GID **10001:10001**, with a read-only image, no Linux
capabilities and a temporary `/tmp`. Two Docker-managed named Linux volumes hold
`/data/cloudmarkup/objects` and PostgreSQL data separately. A fresh object
volume copies the image's non-root ownership. Existing volumes must have
readable, regular, unsymlinked ancestry and correct ownership. Startup uses the
actual filesystem store's hard-link/file-fsync/directory-fsync capability probe.
Errors remain fatal. Do not bind the durable root to NTFS, a Windows share, a
symlink or the container's ephemeral image layer. Native Windows directory fsync
is unsupported; synthetic host tests do not establish Linux durability.

Copy `scripts/self-host/.env.example` to `scripts/self-host/.env`; the root
`.env.example` belongs to the separate seeded development workflow. Set actual
reviewed image digests for the compatible Debian bookworm Node/Go bases and the
admitted PostgreSQL 17 image. The current demo uses `postgres:17.11-alpine3.24`;
that is a source observation, not qualification of the guarded runtime.
Historical PostgreSQL 16 execution evidence does not qualify a new image. No
default digest or PostgreSQL image is supplied. `doctor` verifies the active
engine OS, while version checks in the build bind the supplied Node/Go images to
source pins.

Keep private runtime files **outside the repository and build context**:

- The strict private runtime configuration is mounted at
  `/run/secrets/self_host_configuration` and selected by
  `CLOUDMARKUP_SELF_HOST_CONFIGURATION_FILE`.
- Server-only referenced credentials are mounted read-only under
  `/run/cloudmarkup/secrets`. Use the runtime's exact reference names and
  schema; this route does not invent a second configuration format. Do not put
  credentials in build arguments, image layers, browser environment variables or
  logs.
- For local-owner, the private configuration must bind the container HTTP server
  to literal `127.0.0.1`, port `3000`, set public origin
  `http://127.0.0.1:4317`, use object root `/data/cloudmarkup/objects`, and
  configure the exact principal ID created by the explicit owner initializer.
  Copy [runtime.example.json](./runtime.example.json) outside the repository and
  use its six server-only file references. The core example keeps models and
  adapters null; optional configured export/model steps are documented
  [separately](CONFIGURED_MODELS.md). The same Dockerfile builds the local-owner
  browser and same-origin `/api`; no proof, token or key belongs in `VITE_`
  variables. Compose exposes no host ports. The foreground transport below owns
  host `127.0.0.1:4317` and connects to the container loopback through fixed
  Docker exec pipes. An occupied port refuses. Cognito remote HTTPS needs its
  own reviewed deployment and never receives the local-owner proof.
- The five current restricted ordinary logins are
  `cloudmarkup_beta_api_runtime`, `cloudmarkup_beta_proposal_runtime`,
  `cloudmarkup_beta_export_runtime`, `cloudmarkup_beta_cleanup_runtime`, and
  `cloudmarkup_beta_billing_runtime`. Their passwords belong only in the
  corresponding server configuration/references. The core has no private/model
  purpose identity or owner connection.
- `postgres-owner.txt` is the initdb bootstrap superuser secret for provisioning
  and protected backup/restore. It is not mounted in the schema migrator. The
  app never receives this secret or an owner database connection.

The JSON example is parsed by the same API configuration contract. Generate a
separate owner proof from exactly 32 random bytes encoded as 43 unpadded
base64url characters, without a newline, at `runtime-secrets/owner-proof.txt`;
keep it private. For an existing private parent directory, this command creates
the file exclusively without printing the proof:

```powershell
node --input-type=module --eval "import { randomBytes } from 'node:crypto'; import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[1], randomBytes(32).toString('base64url'), { flag: 'wx', mode: 0o600 });" C:/CloudMarkupPrivate/runtime-secrets/owner-proof.txt
```

Retain the directory's private Windows access controls. The proof is entered
only in the local sign-in page and exchanged for short-lived, memory-only
sessions. The five database password files must match the explicit provisioning
stage. Runtime startup cannot create an owner, database role, grant or storage
root.

## Inspect, build and bootstrap

Run these read-only inspections at the repository root in PowerShell before
creating the private JSON documents below:

```powershell
node scripts/self-host/self-host.mjs inspect
node scripts/self-host/bootstrap.mjs inspect
```

Use the actual canonical, installation-profile and runtime-ACL hashes from these
receipts. This section prepares the operator inputs; build, PostgreSQL startup
and privileged application commands appear only after every required private
file has been prepared in the next section.

`inspect` is dependency-free: it reports pinned tools, lockfile SHA-256 and the
current canonical migration manifest/hash. This successor has **120**
migrations, last **0138**, manifest SHA-256
`bc316cae6997880786ecf27fee40f43f997669cfd521356dc942adca9d849a16`. The
canonical manifest remains the authority on an integrated successor.

Select `cloudmarkup-standalone-pg17-v1` explicitly. Canonical 0127 remains
restricted to its protected PostgreSQL 16/RDS topology, with every hosted
byte/checksum/guard unchanged. This standalone loader adds identity `0000`,
reuses common canonical SQL, and replaces only 0127's three operational
admission/transfer DO blocks. The profile manifest binds both source components
and the assembled checksum; there is no duplicate application edition or copy of
the common migration set.

The explicit `operator:admin` command provisions `cloudmarkup_admin` as LOGIN,
CREATEROLE, NOINHERIT, NOSUPERUSER, NOCREATEDB, NOREPLICATION and NOBYPASSRLS,
sets its private password, and makes it owner of the dedicated empty
`cloudmarkup` database. It must initially have no role memberships. Do not give
runtime logins ownership, CREATE/TEMP, elevated role attributes or memberships.
Revoke public database TEMP and schema CREATE for runtime purposes. This
privileged preparation is a separate acknowledged command, and has not executed
in source preparation.

`cloudmarkup_owner` remains the actual initdb bootstrap superuser. PostgreSQL's
implicit creator ADMIN edges name that real grantor; portable 0127 checks the
exact native edge and removes the temporary migrator INHERIT/SET grant. It
retains all common helper ownership, EXECUTE ACL, RLS, trigger and private
NOLOGIN role assertions. Never create RDS roles or historical approval markers
to satisfy an admission check. See
[PostgreSQL 17 creator grants](https://www.postgresql.org/docs/17/runtime-config-client.html#GUC-CREATEROLE-SELF-GRANT)
and the
[upstream grantor implementation](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/backend/commands/user.c).

Place the migrator's private password, without a newline, in `migrator.txt`
outside the source/build context; `.env` selects
`CLOUDMARKUP_MIGRATOR_PASSWORD_FILE`. Only privileged operator services mount it
at `/run/secrets/migrator_password`. The API receives neither that credential
nor the bootstrap superuser password.

Create `operator.json` outside the repository. This is a synthetic structure;
replace the profile checksum placeholder with
`installationProfile.manifestSha256` from your actual `inspect` receipt:

```json
{
  "host": "postgres",
  "port": 5432,
  "database": "cloudmarkup",
  "user": "cloudmarkup_admin",
  "passwordFile": "/run/secrets/migrator_password",
  "tls": "disable",
  "manifestSha256": "bc316cae6997880786ecf27fee40f43f997669cfd521356dc942adca9d849a16",
  "migrationProfile": "cloudmarkup-standalone-pg17-v1",
  "profileManifestSha256": "<copy the exact inspected profile hash>",
  "acknowledgeCanonicalMigrations": true,
  "acknowledgeStandaloneProfile": true
}
```

`tls: disable` is restricted to the private local Compose network. External
databases require the runtime's verified TLS configuration. Review the complete
profile/common SQL and source hashes before the ordered first-install commands
below. The empty-database admin stage must precede migration bootstrap.

Bootstrap reuses the existing transaction/advisory-lock/checksum/history runner.
Per-migration retries remain ordered and immutable; the complete 121-entry
profile includes the 120 current shared source migrations. An immutable
installation identity and ledger distinguish the profile. Hosted,
legacy/unmarked, partially mixed, wrong-version, wrong-engine, wrong-owner and
modified history are refused. Repeated installation of this same profile applies
only absent registered entries. Bootstrap loads no role-login or runtime-ACL
activation proposal, demo seed, fake auth/jobs/billing, provider key or
arbitrary operator module.

The separately versioned `self-host-core-runtime-acl-v2.json` binds the exact
installed profile and two fixed reviewed inputs. Provisioning requires explicit
`capabilityProfile: "local-editor-core-v1"` acknowledgement. It grants only the
reviewed ordinary column/helper and local-session permissions. It creates no
runtime logins or memberships, and bootstrap/start never activates it. Full v1
retains its three mandatory provider-direct inputs and is not selected by this
core CLI. The installation includes canonical 0137 journal definitions; the core
ACL does not select the separate provider-direct journal ACL input or enable
model dispatch. Installed definitions are not service admission. Real role, RLS,
trigger, permission-denial and tenant journeys remain native release
prerequisites; source inspection is not installed admission.

## Explicit first-install operator stages

Keep the app stopped through this sequence. All commands use the same image and
private Compose network; no PostgreSQL host port is exposed. `start` never calls
these commands. Existing credentials are verified, never reset automatically.
`operator:admin` requires an empty database; after migrations, use
`operator:roles` to repeat the runtime-role check rather than rerunning admin
provisioning.

The empty-database admin stage also creates the five restricted runtime logins
before migrations, under the dedicated empty-database admission. This stage
grants no runtime table or function access; the post-migration roles, ACL and
purpose checks remain required. All seven distinct password files must therefore
be available before admin bootstrap.

Create seven distinct, randomly generated database passwords, each 24–256
printable ASCII characters without whitespace or a trailing newline. Keep the
bootstrap and migrator files at the paths selected in `.env`. Place the five
runtime files at
`runtime-secrets/database/{api,proposal,export,cleanup,billing}.password`. Set
`CLOUDMARKUP_DATABASE_SECRETS_DIRECTORY` to that private subdirectory. The
runtime's five password references must select those same files/bytes under
`/run/cloudmarkup/secrets/database/`. The role provisioner and checker mount
only that subdirectory, which excludes AI keys and local-owner proofs. Files
must be readable by UID 10001 in the operator container. Maintain their existing
private host access controls; this launcher changes no host ACLs.

The provisioning code sends salted SCRAM verifiers in role-creation statements,
never plaintext passwords. It accepts existing credentials only when their SCRAM
verifier and exact non-elevated role posture match. Credential rotation, foreign
roles, expired credentials and non-SCRAM secrets need a separate reviewed
procedure. See PostgreSQL's
[SCRAM authentication](https://www.postgresql.org/docs/17/sasl-authentication.html)
and
[role password catalog](https://www.postgresql.org/docs/17/catalog-pg-authid.html).

Create the private `provisioning.json` selected by
`CLOUDMARKUP_PROVISIONING_CONFIGURATION_SOURCE`. Copy all three actual hashes
from `node scripts/self-host/bootstrap.mjs inspect`; placeholders are refused.
Review the complete source inputs before each permission operation. Set
`acknowledge` to the one stage about to run (`admin`, `restore-roles`, `roles`,
`acl`, or `check`). A configuration approved for one stage cannot authorize
another.

```json
{
  "host": "postgres",
  "port": 5432,
  "database": "cloudmarkup",
  "tls": "disable",
  "migrationProfile": "cloudmarkup-standalone-pg17-v1",
  "canonicalManifestSha256": "<canonical.manifestSha256>",
  "profileManifestSha256": "<installationProfile.manifestSha256>",
  "aclManifestSha256": "<runtimeAclManifestSha256>",
  "capabilityProfile": "local-editor-core-v1",
  "acknowledge": "admin"
}
```

Admin provisioning uses the actual `cloudmarkup_owner` bootstrap superuser to
create the migrator and five isolated policy-target logins in the dedicated
empty database. After migration, `operator:roles` rechecks their exact
credentials and posture against the complete source profile/ledger. The five
logins have no ownership or memberships, NOINHERIT, NOSUPERUSER, NOCREATEROLE,
NOCREATEDB, NOREPLICATION and NOBYPASSRLS. ACL activation uses only
`cloudmarkup_admin`, rechecks profile/history and the five roles, and applies
exact pinned column/function grants inside one transaction. It does not run
hosted PG16 historical-marker admission or weaken its guards.

Create private `owner.json`, selected by
`CLOUDMARKUP_OWNER_CONFIGURATION_SOURCE`:

```json
{
  "host": "postgres",
  "port": 5432,
  "database": "cloudmarkup",
  "user": "cloudmarkup_admin",
  "passwordFile": "/run/secrets/migrator_password",
  "tls": "disable",
  "canonicalManifestSha256": "<canonical.manifestSha256>",
  "profileManifestSha256": "<installationProfile.manifestSha256>",
  "acknowledgeInitializeLocalOwner": true,
  "owner": {
    "principalId": "principal_local_owner",
    "ownerDisplayName": "Local owner",
    "organizationId": "org_local_owner",
    "organizationDisplayName": "Personal",
    "slug": "local-owner",
    "membershipId": "membership_local_owner"
  }
}
```

The declared owner initializer creates the owner principal, workspace, canonical
roles and membership atomically, only in the exact installed profile and empty
identity tables. It refuses existing identity data; preserve its receipt and do
not rerun it on an initialized workspace. Configure the runtime local-owner
identity with the exact `principalId` above. Configure the owner's server-only
proof using the shared runtime's validated configuration/reference contract;
never store it in this owner metadata or the browser bundle.

`operator:check` opens five independent actual runtime logins, checks installed
profile/history and restricted role/ownership posture, and verifies the API's
local-session INSERT/trigger/function permissions. It mounts neither bootstrap
nor migrator credentials and writes no grants or business data. This is a
database preflight, not application readiness. Full column/helper catalog,
RLS/trigger allow/deny journeys, browser cookie/session behavior, provider jobs,
native services and container/storage acceptance still own release
qualification.

### Check all private inputs before the first build

Complete the pinned image references and private paths in
`scripts/self-host/.env`. Before `build` or `postgres:start`, the current
launcher requires these six regular private files to exist outside the
repository: runtime configuration, PostgreSQL owner password, migrator password,
`operator.json`, `provisioning.json` and `owner.json`. Both the runtime-secrets
directory and its database subdirectory must also exist. Prepare the five
runtime password files and owner proof as described above; match all references,
principal IDs and inspected hashes. Missing files are refused even before build;
later creation is not an implicit launcher step. Do not copy this guide's
placeholders as actual hashes or passwords.

### Apply the first-install stages in order

Keep the app stopped. These are operator procedures for the selected execution
environment. Each privileged stage uses its explicit acknowledgement; a
configuration approved for one stage does not approve the next.

```powershell
node --env-file=scripts/self-host/.env scripts/self-host/self-host.mjs doctor
node --env-file=scripts/self-host/.env scripts/self-host/self-host.mjs build
node --env-file=scripts/self-host/.env scripts/self-host/self-host.mjs postgres:start
# provisioning.json: acknowledge = admin; dedicated empty PG17 database only
node --env-file=scripts/self-host/.env scripts/self-host/self-host.mjs operator:admin
# operator.json separately acknowledges canonical and standalone migrations
node --env-file=scripts/self-host/.env scripts/self-host/self-host.mjs bootstrap
# Set provisioning.json acknowledge to roles before this command
node --env-file=scripts/self-host/.env scripts/self-host/self-host.mjs operator:roles
# Set provisioning.json acknowledge to acl before this command
node --env-file=scripts/self-host/.env scripts/self-host/self-host.mjs operator:acl
node --env-file=scripts/self-host/.env scripts/self-host/self-host.mjs owner:initialize
# Set provisioning.json acknowledge to check before this command
node --env-file=scripts/self-host/.env scripts/self-host/self-host.mjs operator:check
```

`operator:admin` is for the empty first installation. Preserve the receipts and
follow the existing restart/upgrade procedure for an initialized workspace; do
not repeat owner initialization or reset credentials to bypass a refusal.

## Start, drain, restart and upgrade

```powershell
node --env-file=scripts/self-host/.env scripts/self-host/self-host.mjs start
node --env-file=scripts/self-host/.env scripts/self-host/self-host.mjs status
```

After starting the foreground transport below, validate the actual `/ready`
endpoint and allowed/denied/cross-tenant browser sessions, persisted projects,
draft save and full graph reload after start. Core optional-service responses
must remain unavailable. This profile cannot enable paid model/provider calls.

## Foreground local-owner transport

Keep the actual local-owner API listener on container `127.0.0.1:3000`. After
the explicit operator stages and `start`, run the following in a second
PowerShell terminal at the repository root:

```powershell
node --env-file=scripts/self-host/.env scripts/self-host/self-host.mjs transport
```

This command binds only literal host `127.0.0.1` at the private configuration's
canonical HTTP public-origin port. It uses the existing production parser
through `@cloudmarkup/api/self-host-configuration` inside the matched image,
checks that the actual internal loopback socket accepts a connection, and
returns only the validated local-owner/server/public tuple. It never loads Linux
credential paths on Windows or prints the configuration/proof. Check the actual
`/ready` endpoint through the running foreground transport, then use
`http://127.0.0.1:4317` for native browser/session acceptance. This checks the
installed candidate; it does not establish acceptance in advance.

Transport requires the exact running application image to carry
`com.cloudmarkup.browser-auth-mode=local-owner`. The shared Dockerfile derives
that label and the Vite selection from the same constrained build argument; the
normal launcher/Compose build supplies the local-owner default. The label is
trusted build metadata, not cryptographic proof of the bundle. A missing or
Cognito label refuses transport. Qualify the actual matched image and browser;
changing a label cannot establish readiness. There is one application artifact.

For each byte stream, the launcher checks Compose project/service/user/running
state and the pinned full container/image/start identity. Fixed non-TTY
`docker exec --interactive --user 10001:10001` opens the same literal internal
loopback socket. It forwards binary bytes unchanged, including HTTP, Origin,
cookies and Authorization; it does not parse, rewrite or log them. Pipes retain
backpressure and half-close. Limits are 16 concurrent connections, 2 seconds to
connect, 30 seconds idle and 120 seconds total per data session. Disposal has a
separate bounded grace, with unconfirmed shutdown reported as failure.

Keep the foreground terminal open. Ctrl+C/SIGTERM closes ingress and disposes
the local CLI children and the fixed `docker wait` monitor. A pinned container
stop, replacement/restart or failed authority check closes ingress without
retargeting. The command does not hold the operator-exclusive lock, so `stop`
and backup remain available. Transport disposal never replaces the application's
aggregate resource-drain receipt.

The helper bounds its own connect/idle/total lifetime. After CLI closure, a
bounded, read-only check looks for the exact helper program/nonce under the same
pinned container authority. Ambiguous, inaccessible or persistent helper state
closes ingress and reports cleanup unconfirmed. No remote process is signaled;
CLI exit alone is not inner-helper disposal proof. Actual Docker exec/inner
process, image, browser/session/cross-origin and stop/drain acceptance remain
pending. Windows TCP/child-pipe checks cannot qualify Docker or Linux storage.
The base Compose recipe publishes no bridge port; it cannot reach an inner
loopback listener and must not occupy the foreground transport port.

## Drain, restart and upgrade

```powershell
node --env-file=scripts/self-host/.env scripts/self-host/self-host.mjs stop
node --env-file=scripts/self-host/.env scripts/self-host/self-host.mjs restart
node scripts/self-host/self-host.mjs version
```

`stop` sends SIGTERM and gives **120 seconds** aggregate grace. The core stops
HTTP admission, marks unready, drains admitted operations and closes its guarded
storage/pools once. Optional workers and models are not configured. The route
requires container state `exited`, exit `0`, and no OOM before it treats drain
as confirmed. Exit `137`, timeout, missing container or failure refuses
backup/restart. A pool-end timeout is not proof of disposal. Workers must be
owned by D's lifecycle; independent writer containers need equivalent
coordinated drain before this route can qualify.

All mutating CLI procedures share a per-project exclusive operator lock in
`.cache/self-host/<project>/operator.lock`. A crashed lock is not reclaimed
automatically. Preserve evidence; after verifying no operator/runtime writer is
active, reconcile the lock manually. Direct Docker commands and other checkouts
can bypass this host lock: maintain a single operator and stop every external
writer throughout backup/restore. Do not use `docker compose down -v` or delete
volumes as routine cleanup.

For upgrade: inspect and qualify the successor's source/images/configuration,
take a verified backup while the old runtime is drained, retain the old image
and volumes, update reviewed pins and private configuration, rebuild, explicitly
approve/apply only the new canonical manifest, then start and run acceptance.
For rollback, restore the old backup into **new volumes** with the matching old
image and schema. Do not downgrade a migrated database in place.

## Backup and restore

Choose an absolute existing parent directory outside the repository. Archives
contain sensitive application/database content; protect them and make an
independent verified copy. They exclude configuration, provider keys and owner
secret files.

```powershell
node --env-file=scripts/self-host/.env scripts/self-host/backup.mjs C:/CloudMarkupBackups/before-upgrade
```

Backup leaves the runtime stopped. It confirms graceful exit before auditing
objects, then captures a PostgreSQL custom dump and a POSIX pax archive of
**all** object files. Immutable envelopes, decisions, tombstones,
uncommitted/ambiguous files, interrupted probe files and V1 pairs are preserved.
Symlinks/nonregular objects are refused. Hard-link content is preserved as
regular files. Bounded path-only pax records preserve valid long storage keys.
Object archive ownership is normalized to runtime UID/GID 10001 and modes remain
private; inode subsecond timestamps are not an object identity contract. Other
pax attributes are refused. The options follow the
[GNU tar portability documentation](https://www.gnu.org/software/tar/manual/html_section/Portability.html).
A final valid `receipt.json` records package/migration/image identities and both
SHA-256 hashes; files without a valid matching receipt are incomplete and must
be preserved for investigation, never treated as a completed backup. Archive
capture must have returned successfully before restore/copy verification begins.
Backup contract 2 verifies the database's immutable profile identity and the
0000 / portable 0127 ledger checksums against the exact image fingerprint.
Restore binds that profile/version in addition to package and image identities,
and verifies it again after database restore before removing interruption
markers. Original contract-1 archives are preserved but refused for this
profile; an opt-in reviewed migration is required. The dump keeps ownership and
ACLs but excludes cluster-global roles, as described by
[PostgreSQL17 pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html).
Prepare the matching non-superuser database owner and the four reviewed private
NOLOGIN roles explicitly before restoring.

The package fingerprint comes from the exact container image, with no network,
secrets or data mounts. It does not mistake an upgraded host checkout for the
old runtime. Backup refuses a maintenance image different from the drained
runtime; restore requires the original application and PostgreSQL image
identities.

Windows archive files are **staging only, not qualified against power loss**;
file sync does not supply directory fsync. Move/copy and verify them in your
qualified backup system. On Linux the archive's files and directories are
fsynced without swallowing errors. Filesystem sync and named volumes alone do
not prove hardware power-loss guarantees, a storage driver's flush correctness
or that unrelated processes were quiescent.

For restore, select a fresh Compose project in a private `.env` copy (for
example `cloudmarkup-restored`) and the matching old
image/package/migration/PostgreSQL versions. Start only its PostgreSQL service.
Use the first-install `operator:admin` stage with the target's existing private
credential files to prepare its owner and five runtime logins. Then set the
target's `provisioning.json` acknowledgement to `restore-roles` and run that
separate stage. Do not run migrations or the owner initializer on this empty
target; the database archive supplies their existing records. Do not start its
app during preparation or restore.

`operator:restore-roles` compares the complete checksum-verified profile's role
declarations with its closed four-role contract. Using only the existing
bootstrap secret, it creates passwordless NOLOGIN roles and the exact PG17
creator memberships required by portable0127: `cloudmarkup_admin` has ADMIN,
without INHERIT or SET, granted by `cloudmarkup_owner`. It requires the
separately provisioned empty target and rejects partial role sets, existing
passwords, unexpected privileges, settings, dependencies or membership edges. An
exact retry performs no role writes. Admission, creation and final catalog
readback share one transaction; failures roll back. It grants no runtime object
access and does not apply a permission proposal. The restore command itself
still creates no roles and preserves the archive's original ownership and ACLs.

```powershell
node --env-file=scripts/self-host/.env.restore scripts/self-host/self-host.mjs postgres:start
# Target provisioning.json acknowledge: admin; all seven existing target secrets
node --env-file=scripts/self-host/.env.restore scripts/self-host/self-host.mjs operator:admin
# Target provisioning.json acknowledge: restore-roles; same inspected source hashes
node --env-file=scripts/self-host/.env.restore scripts/self-host/self-host.mjs operator:restore-roles
node --env-file=scripts/self-host/.env.restore scripts/self-host/restore.mjs C:/CloudMarkupBackups/before-upgrade
# Set target provisioning.json acknowledge: check; inspect restored runtime roles
node --env-file=scripts/self-host/.env.restore scripts/self-host/self-host.mjs operator:check
node --env-file=scripts/self-host/.env.restore scripts/self-host/self-host.mjs start
```

Sign in to the restored installation with its own configured local owner proof.
The source installation's proof is intentionally rejected when the target was
initialized with a different proof; restoring the database does not replace the
target's private runtime configuration.

Keep the source instance and independent verified backup intact. Synthetic
operator tests do not establish native SQL/ACL roundtrip, target credential
compatibility, restored browser/session behavior or power-loss recovery. Those
remain separate acceptance requirements before promising recovery support.

Restore validates receipt/version/hashes and the entire tar before writing. It
rejects traversal, duplicate names, links, devices, all extensions except one
bounded path-only pax record immediately preceding a regular file/directory,
malformed checksums, truncation and trailing data. It requires an empty database
and object volume, restores the database transactionally without `--clean`,
extracts private modes as the non-root owner with the umask applied (see
[GNU tar options](https://www.gnu.org/software/tar/manual/html_section/All-Options.html)),
fsyncs regular files/directories/ancestry on Linux and checkpoints PostgreSQL.
It never starts the app. Interrupted restores leave host and durable
Linux-volume markers; ordinary `start`, inventory and backup refuse that volume.
Preserve partial volumes and use fresh targets for a retry after investigating.

If inventory finds V1 `.metadata.json` pairs, start is refused. Backup preserves
them; do not delete, infer completion or auto-migrate them. A migration requires
a separate opt-in proposal after actual inventory: match database references to
tenant/purpose ownership, verify each pair's metadata/body digest and length,
record verified backup digests, propose immutable V2 targets with conflict and
tombstone checks, test interrupted/repeated conversion and review before
applying. No V1 migration is needed or proposed for an empty volume. Ambiguous
V2 files likewise require the store/journal's documented reconciliation, not a
cleanup sweep.

## Source checks and owning acceptance

```powershell
pnpm test:self-host:tooling
node scripts/self-host/bootstrap.mjs inspect
```

The Node caller tests run without Docker, credentials or database access. The
API owner runs migration-profile.test.ts with affected API types/build checks in
the coordinated serial slot. Foundation source checks and task-owned synthetic
PG17/browser export checks pass. Fresh public Linux CI and protected hosted
release admission remain separate; a Windows synthetic run does not prove
power-loss durability. Earlier private-source results are predecessor evidence,
not admission of this changed profile and bundle.

These checks use synthetic child adapters and temporary files; they do not call
Docker, PostgreSQL, native builders, providers or AWS, and use no Windows fsync
surrogate. They cover control-plane refusal/drain, context exclusion, canonical
checksums, owner isolation, failure retention and safe restore validation.
Docker's
[Dockerfile-specific ignore convention](https://docs.docker.com/build/concepts/context/#filename-and-location)
and
[Compose secret mounts](https://docs.docker.com/compose/how-tos/use-secrets/)
define the packaging boundaries. A real build/context inspection is still
required.

The integration owner schedules frozen-lock install, changed-file format/lint,
`pnpm security:check`, affected backend/web/compiler builds and owning synthetic
suites. Container acceptance separately owns actual image digests,
Windows-to-Linux bootstrap, non-root Linux-volume multiprocess/interruption
storage tests, real PG migrations/least-privilege admission, verified browser
auth, restart persistence, signal drain, backup/restore and native-profile
acceptance. No release/BYOK readiness follows from source presence.
