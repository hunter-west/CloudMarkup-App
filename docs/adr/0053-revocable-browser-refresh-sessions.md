# ADR-0053: Revocable browser refresh sessions

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Accepted
- **Date:** 2026-09-17
- **Owners:** Cloud Markup engineering
- **Supersedes:** None; refines the browser transport of ADR-0022
- **Superseded by:** None

## Context

The beta loses its in-memory credentials on reload and Stripe return. The owner
requires restoration without bearer or refresh tokens in JavaScript-accessible
persistent storage. Existing bearer verification and canonical tenant checks
remain required, and transient provider failures must permit recovery.

## Decision

Use a same-origin, versioned authentication transport that exchanges the
existing PKCE authorization code on the server. Keep access tokens in browser
memory and place the opaque provider refresh credential in a Secure, HttpOnly,
SameSite=Strict, host-only cookie. PostgreSQL retains only a digest of a random
browser attempt handle, lifecycle metadata and verified principal/session
bindings; no token, code, verifier or prompt is stored there.

The cookie alone does not authorize product APIs. Restoration exchanges it at
the fixed Cognito endpoint, verifies the returned access token and active
principal, and checks the current durable session before returning an access
token to RAM. The original verified authentication time bounds restoration to
eight hours. Every product request retains bearer verification and current
tenant authorization.

Exchange admission and cancellation share a durable handle. Cancellation can
create a tombstone before exchange starts; canceled or replayed handles cannot
be activated. Logout revokes this durable session before confirming success, so
late exchange/refresh responses cannot restore its authority. Provider
revocation is also attempted. This does not claim that historical bearer-only
access tokens become instantly invalid; they retain their existing verification
and expiry behavior.

Cookie-bearing endpoints require the exact configured HTTPS Origin, a JSON POST
with an explicit transport header, and same-origin Fetch Metadata when present.
They do not allow CORS. Responses and requests are bounded, uncached and
redacted. Transient provider outages preserve the session and return a retryable
failure; confirmed invalid_grant revokes it. Tokens never appear in URLs, logs
or cache keys.

The existing Cognito client uses non-rotating refresh credentials. Restoration
and logout responses never write or clear cookies, including on rejection; only
exchange writes them. This prevents a delayed renewal or logout response from
removing a newer sign-in cookie. After logout, the revoked cookie remains until
its original bounded expiry or the next sign-in replaces it; durable revocation
prevents it from restoring access. Unexpected provider rotation fails closed and
requires a separate coordinated rotation design before enabling it.

The delivery adapter exposes exactly POST exchange, restore, cancel and logout
under /auth/session/v1. No authenticated product route loses its Cognito
authorizer. CloudFront forwards the cookie and request headers to this
same-origin handler. Production browser bundles select this transport by
default; the local development harness uses its explicit in-memory fixture
transport. This does not authorize deployment ahead of migration registration.

## Consequences

Reload and billing return can resume without another interactive sign-in.
Durable revocation prevents a delayed response from undoing logout. The
transport adds metadata migration, cookie/CSRF tests and provider failure
recovery responsibilities. Expired metadata has bounded cleanup and no customer
architecture content.

The migration remains unregistered until implementation, database concurrency,
compatibility and release checks pass. Historical migrations and clients are
preserved. Rolling back the host disables restoration while bearer-only clients
remain usable; no migration or cookie can grant tenant authority by itself.

## Alternatives considered

JavaScript token storage was rejected because persistence would expose a durable
refresh credential to scripts. An access-lifetime increase does not survive
reload. A stateless refresh cookie cannot reliably fence a delayed exchange
after logout. Storing encrypted refresh tokens in PostgreSQL would add key
management and secret storage that this bounded cookie-plus-metadata design does
not require.

## References

- [Principal and tenant authority](0022-verified-principal-and-canonical-organization-authorization.md)
- [Authorization model](../architecture/AUTHORIZATION_MODEL.md)
- Beta completion plan
