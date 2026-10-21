# ADR-0069: Actor-owned profiles and public application usernames

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Proposed
- **Date:** 2026-09-30
- **Owners:** Cloud Markup engineering
- **Supersedes:** None
- **Superseded by:** None

## Context

The owner wants editable account profiles and invitations addressed by user ID
or username. Current principal names are read-only and provider subjects bind
stable tenant, billing and session identities. Those identities must not change
when a user edits their profile.

## Decision

Add an optional public application username and a profile record version to the
canonical principal. Existing accounts retain their display name and receive no
automatically guessed username. Usernames are case-insensitive ASCII letters,
digits and underscores, 3–32 characters, beginning with a letter. Normalize to
lowercase and reserve product/administrative names. SQL uniqueness and matching
constraints back the public schema. A renamed or cleared username becomes
available; stable user IDs never change, and future invitations must bind the
resolved principal ID rather than resolving the username again at acceptance.

Expose additive actor-owned GET/PUT profile operations. No request may choose a
principal, provider identity, role, email verification status or password. Use
current verified authority, same-origin writes, recent authentication and an
exact profile ETag. Capture the actor and parsed input before asynchronous work.
Lock the principal, serialize claims to one normalized username using the
existing transaction advisory-lock pattern, recheck availability and update the
profile atomically. Same-value saves retain the version; stale ETags fail
closed. Metadata-only immutable profile events record changed fields and
version, not old/new names, email addresses or credential material.

Profile UI retains edits on a conflict and requires actor-bound server readback
before confirming success or updating the signed-in display name. Show the
stable user ID alongside the application username. Password, verified-email, MFA
and session controls remain in the existing Cognito/session architecture; this
profile slice does not implement those controls or enable registration.

## Alternatives and consequences

Renaming a Cognito username/subject would break stable identity bindings and is
not used. A separate profile store would duplicate the canonical display name;
additive principal columns preserve current-principal v1 compatibility instead.
Permanent username tombstones would prevent reuse but reserve names after an
intentional rename; reconsider that policy if impersonation/abuse requirements
change. Do not expose a global username availability or account directory API.

Migration is local and additive. Earlier SQL, tenant records, grants and
provider references remain unchanged. Existing clients keep their v1 reads. The
version guard prevents an old writer from silently replacing edited profile
content; rollback must preserve the new identity and version data.

## References

- [Verified principal authorization](0022-verified-principal-and-canonical-organization-authorization.md)
- [Session boundary](0053-revocable-browser-refresh-sessions.md)
- [Account requirements](../product/POST_BETA_ACCOUNT_AND_REPOSITORY_REQUIREMENTS.md)
- Execution plan
