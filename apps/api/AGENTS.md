# API instructions

These rules specialize the repository [instructions](../../AGENTS.md) for
`apps/api`.

- Keep Hono and Lambda code as transport adapters. Put deterministic business
  rules in domain packages and public request/response shapes in versioned
  schema/API-contract packages.
- Derive tenant identity only from verified authentication context. Never trust
  organization, tenant, role, or ownership fields supplied by a request.
- Validate input at the boundary and translate errors without leaking tenant
  data, prompts, architecture content, credentials, or internals.
- Tenant-owned endpoints require allowed, unauthenticated, denied, cross-tenant,
  malformed, and stale-version cases as applicable.
- Keep persistence, model, queue, provider, and AWS behavior behind explicit
  ports/adapters. The Lambda entry point must remain thin.
- Existing routes cover authenticated projects, revisions, billing and beta
  workflows. Add or change an endpoint only through its authorized versioned
  contract, with matching tenant and compatibility evidence.

For API implementation changes, use `pnpm check:backend` under the root
[verification cadence](../../AGENTS.md#verification-cadence). Review with the
security/tenant, public-contract, tests, and generated-files sections of
[CODE_REVIEW.md](../../docs/engineering/CODE_REVIEW.md).
