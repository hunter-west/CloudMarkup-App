# `@cloudmarkup/api`

## Responsibility

Own the Hono HTTP boundary, authenticated application composition, persistence
adapters and hosted workers. Routes cover identity, organizations, projects,
drafts, revisions, validation, jobs, artifacts, integrations, billing and audit
through the shared versioned API contract. See
[current status](../../docs/PUBLIC_STATUS.md) for enabled beta capabilities and
operational holds.

## Runtime entry points

- `src/app.ts` exposes the injectable route factory. Without product adapters,
  only health, readiness and OpenAPI endpoints are usable.
- `src/production-lambda.ts` composes `createProductionApp` behind verified
  edge-origin admission. The platform's beta asset selects this entry point; the
  bare `src/lambda.ts` handler is not the production composition.
- `src/production-composition.ts` owns verified identity, tenant-scoped
  application services and configured production adapters. Hosted export and
  cleanup workers have separate entry points and restricted capabilities.
- `src/local-server.ts` and `src/local-development/` compose the explicit local
  environment. Local identity and synthetic data are never production authority.

Use the declared package exports for cross-package access. Route tests can
inject deterministic adapters without enabling the production integrations.

## Authorization and mutation boundaries

Correlation and request limits precede route parsing. Canonical schemas validate
paths, queries, headers, bodies and application responses. Product operations
receive a principal from verified middleware; request identifiers are untrusted
selectors, never identity, membership or entitlement evidence.

Every tenant-owned read and mutation reauthorizes its exact scope. Draft edits
use versioned Graph Commands, `If-Match` and `Idempotency-Key`. Queued work and
creation operations retain their contract-specific idempotency rules.
Presentation preferences use ETags without changing architecture semantics.

Exports bind immutable revisions, exact target/tool versions and job/artifact
lineage. Repeated requests retain their original run or create an explicit
versioned successor according to terminal state and artifact availability.
Cross-tenant selectors have the same not-found surface as missing data. Download
grants are short-lived and principal-bound; authenticated ZIP responses are
private/no-store, checksum- and length-bound, and expose no upstream storage
selector. Cancellation and publication-integrity failures cannot publish an
unverified artifact.

## Persistence and local verification

`@cloudmarkup/api/persistence` exposes principal/scope, repository and object
ports with PostgreSQL, RDS Data API, S3, filesystem and in-memory adapters.
Checksum-pinned forward migrations in `migrations/` and their registered
manifest are authoritative; historical migrations are not cleanup candidates.
Relational rows retain authorized metadata, versions, hashes, state and exact
object references. Full documents, generated files and job payloads are object
content. Staged publication supports idempotent post-commit recovery.

From the repository root, supply only a dedicated local database through an
approved environment channel:

```powershell
$env:CLOUDMARKUP_DATABASE_URL = '<local PostgreSQL URL>'
pnpm --filter @cloudmarkup/api migrate:local
pnpm --filter @cloudmarkup/api seed:local

$env:CLOUDMARKUP_TEST_DATABASE_URL = '<dedicated local test database URL>'
pnpm --filter @cloudmarkup/api test:postgres
```

Database tests require a loopback URL without query/fragment overrides. They
create unique test-owned schemas, apply forward migrations and verify ownership
before cleanup. Never use the beta database or a tunnel to it. Ordinary tests
skip configured database cases when their prerequisite is absent; that is not
database integration evidence. CI supplies an ephemeral pinned PostgreSQL
service. [Testing](../../docs/engineering/TESTING.md) documents full gates and
the [workspace guide](../../docs/development/WORKSPACE.md) documents local
setup.

## Model and execution boundaries

Model responses and repository observations are untrusted proposal data.
Deterministic validation and explicit review control acceptance; browser input
cannot create tenant, usage, billing or deployment authority. Private seed,
repair and accounting adapters retain their versioned provenance and replay
contracts even when a beta profile does not activate them. Their implementation
does not establish evaluation or traffic-admission approval.

Customer infrastructure is exported, never deployed by this application.
Compilers, isolated runners and provider integrations retain their own bounded
ports; the platform delivery workflow is a separate authorized operator action.
