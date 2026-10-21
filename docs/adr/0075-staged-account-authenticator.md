# ADR-0075: Staged account authenticator enrollment

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Proposed
- **Date:** 2026-10-01
- **Owners:** Cloud Markup engineering
- **Supersedes:** None

## Context and decision

The account product plan requires authenticator enrollment/removal with
recovery. [ADR 0074](0074-account-credential-management.md) provides the
verified-token, current-session, recent-authentication and durable
metadata-attempt boundary. Cognito association alone does not establish a usable
second factor. Verifying a replacement can disassociate the existing factor.

Add a separate staged application port and versioned HTTP contracts. Keep
password/email v1 contracts unchanged. Reuse fixed-host provider transport with
an eight-second budget shared across each operation. Create one expiring setup
per actor, bind verification to its original session and exact enrollment ID,
and serialize stage claims with the existing credential/session lock. Replayed,
expired or competing attempts cannot dispatch. An enabled authenticator cannot
be silently replaced. Confirm provider verification, preference change and
GetUser readback before displaying success. A partial provider success remains
uncertain and never retries automatically.

Return a setup key only from a successful start response, with no-store headers.
Keep it in page memory and clear it on cancel, navigation, expiration, account
change or uncertain verification. Never persist it, send it to remote QR or
analytics services, or place it in query/mutation caches. Codes and provider
tokens stay out of storage and logs. Store only enrollment state, timestamps,
actor/session digests and immutable attempt/outcome metadata. No transaction
spans provider I/O.

A configured recovery contact is required before offering new enrollment. The
owner has been asked for the real email or help URL; no contact is invented.
Password recovery does not remove MFA. The UI must explain that distinction and
require recovery acknowledgement. Removal is an explicit, recently authenticated
action with provider readback; it does not promise to end existing sessions. No
operator MFA reset, live identity change or deployment is authorized here.

## Alternatives and consequences

A direct browser SDK would bypass application revocation and durable concurrency
checks. Automatically replacing an existing factor would create surprising
account-access changes. Persisting setup keys for later retrieval broadens
secret storage and is unnecessary: a lost setup must be canceled/restarted.

An additive migration extends the audit action allowlist and adds bounded
enrollment metadata. Existing identities, memberships, financial records and old
SQL bytes stay intact. Rolling back disables the new surface while retaining
audit history. A crash or unknown provider outcome can hold setup until expiry;
that inconvenience preserves the distinction between failure and uncertainty.
Provider behavior remains in adapters; no graph, compiler or AI authority
changes.

## Verification

Exercise account/session mismatch, revocation, expiration, duplicate and
competing attempts, invalid codes, verification ERROR, partial success,
malformed responses, missing recovery policy and audit failure. Use isolated
PostgreSQL and synthetic provider responses, then keyboard/accessibility/themed
browser flows. Do not claim enrollment is integrated until persistence, routes,
production composition and UI are wired and their applicable gates pass.

## References

- [AssociateSoftwareToken](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_AssociateSoftwareToken.html)
- [VerifySoftwareToken](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_VerifySoftwareToken.html)
- [SetUserMFAPreference](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_SetUserMFAPreference.html)
- [TOTP setup and recovery](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-mfa-totp.html)

Completion persists enrollment state and its immutable audit outcome atomically.
A failed completion transaction rolls both back, retaining the durable intent.
The separate production input `CLOUDMARKUP_ACCOUNT_SECURITY` is strict version 1
with a nullable recovery contact. It defaults to null and changes no
registration or purchase gates. Contact configuration does not replace an
operational account recovery process; no operator reset implementation is
introduced.
