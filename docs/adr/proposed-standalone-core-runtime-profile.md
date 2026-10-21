# Standalone core runtime profile

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Proposed
- **Date:** 2026-10-15
- **Owners:** Standalone integration and database/release owners
- **Supersedes:** None
- **Superseded by:** None

## Context

The same application must support hosted Cognito/AWS operation and a standalone
local editor. Hosted canonical migration bytes and their installed ledger cannot
be replaced by private-source history. Main has 118 canonical entries; the
broader private provider-direct candidate also has 0137 and a full three-input
ACL policy. That policy requires real provider-direct definitions and roles even
when models are disabled. Removing its third input would silently weaken its
contract.

## Decision

Derive a distinct standalone installation from the current main canonical
manifest, adding its installation identity and replacing only the three declared
operational0127blocks. Bind the exact original and assembled bytes. Keep hosted
loaders and canonical SQL unchanged; mixed, unmarked and incompatible histories
refuse rather than being adopted automatically.

Use a separately versioned, closed core ACL contract with fixed two-input
selection, an exact installed-profile manifest hash and explicit
`local-editor-core-v1` operator acknowledgement. Preserve full v1 three-input
provider-direct assembly and all its guards. Both activation paths require the
actual schema operator and transactional profile/catalog admission. Neither
runtime startup nor HTTP requests can activate grants or provision missing
roles.

The first core runtime must require disabled models and unsupported optional
adapters. This is a staged integration of the shared product, not a second
application or permission to claim configured AI/export/billing availability.
Later provider-direct admission needs its genuine migration/role/journal
contract and an explicit compatible profile transition. No plan or credit
records may be fabricated to bypass hosted funding checks.

Retain `FilesystemObjectStore` and its existing Windows/local-development data
format. Introduce the reviewed strict implementation under the explicit name
`DurableFilesystemObjectStore` for the standalone runtime. Both implement the
same object-store port and use the shared repositories; application behavior is
not forked. The durable format requires actual directory sync and refuses
unsupported filesystems, including current Windows Node directory opens. It does
not adopt the legacy format or fall back after a readiness failure. Data
conversion and backup/restore require separate admission.

The ordinary ACL metadata records current source inputs but remains an unarmed
proposal. Current main's async-job updates are not admitted by the proposed
immutable-column permissions. The core must keep those optional purposes
disabled rather than broaden grants to accommodate them.

The core server resolves declared credential references through a generic
server-side resolver. It does not depend on model-provider implementation code.
Configuration rejects models and optional adapter bindings before resolving
secrets or allocating database handles. Cognito readiness probes each required
column with PostgreSQL's `has_column_privilege`, which admits the existing
narrow column grants without requesting table-wide access. Native acceptance
must run that probe under the actual installed API role.

## Consequences

### Positive

- Hosted defaults and immutable migration history remain intact.
- Core permission admission is explicit and independently reviewable.
- Local identity, repositories and deterministic graph/compiler code remain
  shared.
- Existing Windows development storage and its tests remain compatible.

### Negative

- Core and configured provider-direct installations have separate compatibility
  and native acceptance requirements.
- Operators must acknowledge exact profile and ACL identities; mismatched
  artifacts refuse and cannot be repaired by rewriting an installed ledger.
- Standalone durable storage is a distinct format with native Linux acceptance
  and restore requirements; synthetic interruption fixtures are insufficient.

### Follow-up

Complete guarded persistence, identity, runtime, web and packaging integration.
Run actual fresh PostgreSQL17 and Linux storage/image acceptance on the
resulting main-derived artifact. Independently admit backup/restore and
configured services. Keep unfinished implementation in draft. A coherent,
locally verified candidate enters the normal ready profile; merge waits for
required integrated/native gates and release review.

## Alternatives considered

### Apply the private snapshot to main

This would replace later hosted/auth behavior and canonical0127/0134bytes and
pull unrelated private feature dependencies into the foundation. Port bounded
contracts and behavior instead.

### Reuse full v1 while omitting provider-direct SQL

Its contract intentionally requires three fixed inputs and real database
definitions. An explicit core contract preserves this admission boundary.

### Add provider-direct0137to the first core installation

This introduces role/bootstrap and migration lifecycle obligations before core
needs them. Reconsider during the separately reviewed configured-provider
tranche.

## References

- Foundation integration plan
- [Current project status](../PUBLIC_STATUS.md)
- [Canonical migration registry](../../apps/api/migrations/manifest.json)
- [PostgreSQL 17 access privilege inquiry functions](https://www.postgresql.org/docs/17/functions-info.html#FUNCTIONS-INFO-ACCESS-TABLE)
