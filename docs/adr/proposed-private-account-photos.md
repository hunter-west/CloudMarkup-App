# Private account photos

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- Status: Proposed; source implementation remains isolated and uncommitted
- Date: 2026-10-06
- Owner: App UI refinement task; integration/release owner approves activation

## Context and decision

Account photos must survive browser/device changes, remain bound to verified
identity and support explicit removal. Existing object storage requires an
authorized organization/project scope. Inventing that scope for an identity
photo or granting a new bucket prefix would introduce incorrect tenancy and
infrastructure permissions.

Use an additive principal-owned SQL record in the existing database, separate
from profile names and their v1 version. This is a narrow exception to the
binary-column prohibition: only a canonical 192-pixel PNG of at most 180 KiB is
stored. Architecture, model content and general assets continue using their
existing storage. GET/PUT derive ownership solely from verified principal
context; requests cannot select an account or provide a URL. Writes require
exact origin, recent authentication and an actor-bound ETag. Lock acquisition
and completion both recheck authority. Removal erases bytes and retains only an
empty versioned record to prevent stale-update ABA races. Events retain
operation/version/correlation metadata, never image bytes or names. Physical
principal deletion has a cascade on the photo record; audit-event foreign keys
follow the existing account audit/lifecycle policy and may restrict physical
principal deletion. This does not introduce a new account-erasure mechanism.
Inactive principals cannot read or modify photos.

The browser accepts JPEG/PNG/WebP up to 5 MiB with predecode dimension limits,
crops and prepares PNG. The API independently bounds bytes, dimensions, PNG
structure/CRC and decompressed scanline size before invoking the existing resvg
decoder, strips metadata and re-encodes. Only constant SVG containing a checked
base64 PNG reaches that decoder; no user markup, URL, path or font loading is
allowed. Reads use private/no-store responses. The browser uses
principal-partitioned, memory-only query state cleared by existing
sign-out/session expiry, and confirms private readback before changing the
displayed photo.

## Alternatives, dependencies and consequences

Browser storage cannot satisfy persistence or cross-device behavior.
Organization S3 would introduce false tenancy; a new private bucket/prefix needs
infrastructure and permission review. Inline arbitrary uploads without decoding
would retain unsafe content. Using the existing database avoids new resources
and IAM changes, at the cost of bounded identity-image storage and response
bandwidth. No general media store is introduced. Live migration/activation is
excluded from this task.

The API declares the existing catalog-pinned `@resvg/resvg-js` 2.6.2 directly;
it is already in its transitive dependency closure through diagram-export. This
adds no package/version or install permission. The maintained Rust raster
renderer uses MPL-2.0. Sharp would duplicate native image tooling; a new PNG
codec would expand the dependency/security surface. System fonts are disabled
and external image resolution is rejected. Frozen installation, raster/negative
tests, builds and the security gate must pass before integration.

## Required evidence

Contract compatibility, auth/origin/ETag rejection,
malformed/oversized/decompression-bomb inputs, private readback, removal and
cancellation, cross-principal isolation, lock-wait expiry, transaction rollback
and local PostgreSQL concurrency are required. Synthetic browser screenshots
prove rendering, not a hosted database, migration or live account change. No
paid resource, permission, account security or billing change is authorized.

See execution plan, [actor-owned profiles](0069-actor-owned-account-profiles.md)
and [dependency policy](../engineering/DEPENDENCY_POLICY.md).

## Integration and rollback

Review this storage exception and the existing identity audit-retention policy
before activation. Reserve avatar migration0097 before the peer trial0098; the
combined owner regenerates one manifest and advances all API, platform migrator
and admission tip/hash/count pins together. All historical SQL remains
immutable. This isolated patch advances only API bindings and leaves platform
integration pending; it must not be deployed by itself.

Rollback retains the additive schema, empty version tombstones and audit
metadata. Use a compatible schema-forward application rollback rather than
dropping tables, replaying an older ledger or restoring erased image bytes. User
removal erases current bytes; database backup retention follows existing policy.
Only isolated synthetic test schemas were migrated and removed for native proof.
No live migration, account data deletion or application rollback was executed.
