# ADR-0044: One active editor per shared project

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Accepted
- **Date:** 2026-09-06
- **Owners:** Cloud Markup engineering
- **Supersedes:** None
- **Superseded by:** None

## Context

The owner selected one editor at a time for each shared project. Organizations
share role-authorized projects; viewing another member's project must not imply
exclusive ownership. Optimistic document versions already prevent blind
overwrites, but cannot communicate who may begin editing. S3 publication occurs
outside PostgreSQL transactions, so checking a lock only in an HTTP handler
would still admit late saves after an editor loses ownership.

This design supplements
[ADR-0021](0021-postgresql-data-api-and-object-storage.md) and
[ADR-0022](0022-verified-principal-and-canonical-organization-authorization.md).
The product choice is approved. The technical decision was accepted after the
database, transport, browser and integrated evidence below passed; acceptance
does not claim deployment or activation of other services.

## Decision

Use one PostgreSQL editing lease per active project. A lease lasts at most 60
seconds and never beyond verified authentication expiry. The owning browser tab
renews every 20 seconds. Acquire accepts a cryptographically random 32-byte
base64url token, stores only its SHA-256 digest, and binds it to verified
principal/session identity. The server issues a new opaque lease epoch on each
replacement. Acquiring the same live tab proof is idempotent; another tab,
including one belonging to the same person, cannot take over an active lease.

Availability reads require current project-read permission and disclose only
available/held state and expiry, not holder identity or token. Acquire, renew,
release and saves require current canonical project-mutation permission. Renewal
and release require the exact epoch and tab proof. Missing resources and foreign
tenants remain indistinguishable. Release is explicit and best effort on close;
crashes recover through expiry without a force-unlock control.

Production draft writes require the proof in addition to the existing ETag and
domain-command validation. Both pending writes and final publication recheck
current authorization, lifecycle, lease epoch and database clock. A deferred
database check prevents an expired transaction from committing a lease-bound
draft change. No database lock spans object-store I/O. Replacing or releasing a
lease can abandon only its exact pending draft metadata, preserving the last
published document and retained object records; unbound ambiguous pending state
fails closed. Initial project publication has a narrow creator-bound exception
before any lease exists, never an exception for editing an existing draft.

The editor blocks mutations before acquisition and after loss. Other members may
view. Unsaved work stays recoverable locally under the existing manual draft
policy, but is not silently saved or replayed after a different lease takes
over. Temporary AI inputs/results are outside this policy and remain unapproved
for storage. Archive/delete stays under existing administrative authority;
immutable revision/export reads retain their version and permission checks
without claiming ownership of the mutable diagram.

## Compatibility and rollback

The additive API operations and optional v1 request proof preserve decoding of
older clients. Production intentionally rejects old clients' proof-free saves;
they must reload the paired web release. Local/reference compositions may use an
explicit disabled mode for untouched no-lease fixtures, never a production
fallback. Once any lease record exists for a project, the deferred database
trigger also rejects untagged semantic/pending writes from old application
instances. It locks that exact project before admitting no-history writes;
released or expired history cannot reopen the old write path. Mixed-version
reverse lock order can cause a safe transaction abort/retry during rollout.
Migration `0025` is forward-only and adds lease metadata and draft publication
fencing without rewriting historical SQL or graph identity. Rollback must retain
the new schema and use a lease-aware application; do not restore an unfenced
writer.

## Consequences and alternatives

The lease adds periodic requests and database contention on a shared project.
Suspended/background tabs may lose editing access, and unsaved work can require
manual recovery. These costs provide a clear editor/viewer experience without
realtime collaboration infrastructure or permanent locks. Provider-neutral
graphs and compilers remain unaffected; persistence owns concurrency, not graph
meaning. No customer infrastructure or integration permissions are added.

Optimistic versions alone were insufficient for the selected interaction.
Browser-only locks cannot coordinate members/devices. Permanent locks require
operator recovery after crashes. Forced takeover risks avoidable lost work and
is excluded. Reconsider the lease if simultaneous collaborative editing becomes
an explicit requirement or measured renewal cost requires another transport.

## Required evidence

Real PostgreSQL tests must cover competing members and tabs, expiry/reacquire,
renew/release replay, current-role revocation, foreign tenants, deletion,
publication failure/retry and expiry at commit. Transport tests cover strict
proof shapes, verified identity, safe errors and no token/identity disclosure.
Browser tests cover read-only peers, close/reopen, renewal/loss and preservation
of unsaved work. Run the active backend/web/infra and aggregate gates with exact
migration/OpenAPI compatibility pins before accepting or deploying this slice.

## Review outcome

Accepted on 2026-09-06 after independent source review and exact-schema
evidence: 24 real PostgreSQL lease cases, 45 contract/route cases, 34 focused
client cases, all 17 synthetic editor browser scenarios and the two final
desktop/phone presentation reruns pass. The web gate passes 1,011 tests; the
uninterrupted repository gate passes 4,565 tests with 36 explicit skips and real
PostgreSQL enabled. Migration hashes, publication fencing and paired rollback
constraints were reviewed together. This is local candidate evidence, not a live
rollout.

## References

- [Authorization model](../architecture/AUTHORIZATION_MODEL.md)
- [Testing strategy](../architecture/TESTING_STRATEGY.md)
- Active restoration plan
- Service checkpoint
