# ADR-0072: Account session revocation

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Proposed
- **Date:** 2026-10-01
- **Owners:** Cloud Markup engineering
- **Supersedes:** None
- **Superseded by:** None

## Decision

Keep Cognito Authorization Code with PKCE and the protected browser refresh
cookie. Verify ordinary API access against application revocation state after
signature/scope verification and principal mapping. A signed token alone does
not establish a current CloudMarkup session. Preserve ordinary legacy token
scope compatibility; enhanced provider self-service will require a fresh grant.

Record immutable revoked provider-family digests and a monotonically increasing
per-principal authentication cutoff. Ending one registered browser session ends
its provider family. Ending all CloudMarkup sessions rejects authentication at
or before the committed cutoff, including legacy sessions absent from the
browser registry. Current requests admitted before revocation may finish; this
does not cancel jobs or rewrite accounting. No raw token, refresh cookie,
provider family, IP address, or user-agent is persisted or returned by session
management.

Expose actor-owned browser-session metadata with opaque IDs, authentication and
expiry times, and a current-session marker. Do not invent device or location
labels. Use recent authentication, same-origin writes, and actor-bound immutable
idempotency receipts. Replaying an all-session command after fresh sign-in must
return its original result without ending the new session. Missing or another
account's session returns the same unavailable error.

Serialize activation and account session changes per principal. Session
activation, renewal and ordinary API admission check the cutoff and revoked
family. Existing cookie cancellation also records a family tombstone after a
known active session is revoked. Revocation remains effective after expired
browser rows are pruned. Backfill only existing explicit revocations; never
infer a revoked account from missing legacy browser records.

## Verification and rollout

Require real PostgreSQL races, cross-account denials, immutable replay,
authentication expiry after waits, revocation persistence after pruning,
legacy-token cutoff, fresh-sign-in recovery, and no-token-storage tests. Wire
production only after the additive migration and exact admission pins are
registered. Provider global logout, password, email verification and MFA are
separate account-security actions and must report their own confirmed outcome;
application revocation alone does not clear a hosted login cookie.

## References

- [Verified identity and authorization](0022-verified-principal-and-canonical-organization-authorization.md)
- Product plan
- [Cognito token revocation](https://docs.aws.amazon.com/cognito/latest/developerguide/token-revocation.html)
- [Cognito fresh authorization](https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html)
