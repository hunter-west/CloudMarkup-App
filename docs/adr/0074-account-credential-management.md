# ADR-0074: Token-bound account credential management

- **Status:** Proposed
- **Date:** 2026-10-01
- **Owners:** Cloud Markup engineering
- **Supersedes:** None

## Context and decision

[ADR 0022](0022-verified-principal-and-canonical-organization-authorization.md)
separates provider identity from organization membership. The product request
adds password and verified-email controls to the personal Security page. The
[account access checkpoint](0073-branded-account-access.md) admits the provider
self-service scope, but that alone does not implement account controls.

Use a dedicated provider adapter behind a versioned application port. Reverify
the exact transport access token with both API and self-service scopes, current
application session admission, and recent authentication before a mutation.
GetUser must map its subject to the same active principal; an email is never
identity or membership authority. Use fixed-host HTTPS, bounded responses, short
timeouts, strict operation allowlists, and no automatic mutation retries. Keep
provider diagnostics, passwords, verification codes and tokens out of storage,
logs and result envelopes.

Record a principal-owned attempt before dispatch and append an immutable
metadata-only outcome. Reused attempt IDs cannot dispatch again. Bound current
in-flight work and rate-limit new attempts. A provider success followed by
failed readback or persistence is uncertain, never reported as a rejected or
confirmed change. The UI clears credential fields after submission and explains
recovery from uncertain outcomes.

The provider retains the original email until verification succeeds. Synchronize
only a verified provider readback, matched to the existing subject mapping,
under current session and attempt admission. Preserve principal, membership,
billing, schema and editable-profile versions. Do not hold database transactions
across network calls. TOTP enrollment remains a separate staged flow with
concurrency and setup-secret requirements; this bounded password/email slice
does not claim to implement it.

## Alternatives and consequences

Direct browser SDK calls would bypass application revocation and audit checks.
Administrative IAM calls would unnecessarily broaden authority. Persisting
credentials for retries is rejected. The selected design requires an additive
audit migration and explicit uncertain states, but preserves old HTTP contracts.
Rollback leaves audit history intact and disables unsupported new endpoints.
Existing account login and recovery remain available.

## Verification

Use synthetic provider responses and isolated loopback PostgreSQL only. Exercise
wrong actor/session/subject, missing scope, stale authentication, revocation,
reused attempts, rate limits, concurrent requests, provider errors, bounded
responses, readback failure and audit failure. Confirm email synchronization
does not alter stable identity or profile versions. Review keyboard,
accessibility and both visual themes. No live provider account change or
deployment is part of these checks.

## References

- [ChangePassword](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_ChangePassword.html)
- [GetUser](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_GetUser.html)
- [UpdateUserAttributes](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_UpdateUserAttributes.html)
- [VerifyUserAttribute](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_VerifyUserAttribute.html)
