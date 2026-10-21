# Local configured export and model runtime

- Milestone: M9
- Workflows: WF-standalone-export, WF-standalone-model
- Status: active
- Owners: local release integration

## Goals

- An owned local project can submit, process, and download a valid
  infrastructure-only export through the shared durable export workflow.
- Optional model configuration uses the shared gateway with explicit provider
  credentials, current schema and ACL boundaries, and honest unavailable
  behavior when omitted.

## Context

The core PG17 local-owner profile was qualified on `a6a171e`. The configured
export adapter now reuses the shared durable job, compiler, validation, artifact
and authenticated-download path. Earlier configured-export packets were
reconciled against current source rather than copied wholesale. Optional model
configuration remains a separate provider-credential path; no live model
invocation is claimed.

## Constraints

- Preserve hosted route, billing, claim and authorization behavior and all
  current 0137/0138 migration bytes.
- Use existing shared workers/compiler and closed local adapter bindings. No
  synthetic export success, borrowed hosted entitlement, production credentials,
  or provider calls.
- Reconcile ACLs from actual SQL statements and test API and worker roles; never
  grant broad rights to cure an unknown error.

## Non-goals

- Application-source generation, a live AI invocation, AWS deployment or
  publication.

## Checkpoints

- [x] Reconcile the current migration/ACL and earlier adapter seams without
      changing canonical migration bytes or granting direct cross-tenant
      audit-table access.
- [x] Implement optional export/model composition with omitted configuration
      retaining core behavior. Model-provider execution still needs operator
      credentials and separate acceptance.
- [x] Run disposable PG17 and an authenticated local browser through revision
      freeze, export creation, durable claim, native compilation, validation,
      artifact publication and ZIP download. The 20-entry, 190709-byte
      infrastructure ZIP matches the persisted SHA-256
      `624d8472da98d6353d1b103d59f4c7084ca1cc59fe946c84604bd955a5369e56`; the
      local export credit receipt is `not-metered`.
- [ ] Complete final changed-source/backend and public-archive qualification,
      then bind the private operations revision to that sealed source.
      Publication, hosted AI and application-code generation are separate
      admissions.

## Validation commands

```powershell
pnpm --filter @cloudmarkup/api test -- --run src/self-host
pnpm check:backend
pnpm security:check
# Fresh disposable native qualification must additionally inspect the actual artifact.
```

## Migration impact

No canonical migration bytes are to change. Existing unarmed full-profile rights
may require exact-source binding, privilege-specific proof and controlled local
activation; retain core fallback and rollback by disabling optional adapters.

## Security impact

Direct-provider credentials remain private resolved references. Proposal and
export jobs must retain scoped ownership, idempotency, funding and worker role
isolation. Test denied cross-tenant and missing/expired credential paths.

## Stopping condition

Complete only with a real local artifact and negative admission checks. Stop an
individual activation if exact privilege/role evidence or required provider
configuration is absent; report it rather than adding generic grants.

## Handoff

Current: actual local infrastructure export and authenticated download passed on
a disposable synthetic project. The browser package explicitly reports
infrastructure-only coverage and no application build verification. Final
source, archive and private deployment admission remain open; no hosted provider
or production operation was exercised.
