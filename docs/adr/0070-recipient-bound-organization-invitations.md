# ADR-0070: Recipient-bound organization invitations

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Proposed
- **Date:** 2026-09-30
- **Owners:** Cloud Markup engineering
- **Supersedes:** None
- **Superseded by:** None

## Context

The owner wants organization membership invitations addressed to an existing
user ID or username. The current invitation API creates bearer links. Accounts
now have stable principal IDs and optional public usernames; personal workspaces
must remain private, and joining an organization must require explicit consent.

## Decision

Add a nullable immutable recipient principal reference to invitation storage.
Historical invitations retain their existing identity and lifetime. New typed
member-invitation operations require an exact user ID or normalized public
username, resolve it on the server under current organization authority, and
persist the stable principal ID. A later username change cannot redirect an
invitation or its idempotent retry. No global directory or prefix-search
endpoint is introduced, and unsuccessful recipient resolution returns a generic
error.

Retain the existing v1 bearer contract for compatibility. Both legacy-token
acceptance and new account-inbox acceptance must enforce the stored recipient
when present; SQL also rejects acceptance by another principal. Existing
account/seat admission, recent authentication, issuer authority, expiration,
revocation, capacity limits and atomic audit behavior remain authoritative.
Personal workspace invitations remain prohibited.

Use the existing account-first transaction lock order. Acquire issuer/recipient
principal locks in stable order before checking current identity and any new
username binding. Reuse canonical invitation admission inside that transaction.
Idempotency uses the normalized request selector, role and verified issuer;
replay returns the original recipient even after a rename. Prevent a second live
pending invitation for the same organization/recipient and bound the pending
queue. A new attempt after expiration/revocation receives a new identity.

Provide an account invitation inbox with explicit Accept and Decline, and an
organization pending-invitation list with revoke/resend actions. Read paths are
actor-bound and paginated; writes are same-origin, recently authenticated and
currently authorized. Decline closes a pending invitation without adding any
membership. UI retains an attempt identity across uncertain saves and requires
server readback before reporting success or changing the selected workspace. No
organization membership is inferred from an email domain or a display name.

This slice targets existing application users. Email-address invitations for
unregistered users depend on the subsequent verified-email/registration
contract; do not imitate email verification with a caller-provided claim. No
email delivery, provider call, public registration or deployment is activated.
Member role changes, leave/remove and ownership transfer remain a following
checkpoint with explicit last-owner and active-work handling.

## Alternatives and consequences

Keeping every new invitation as a bearer link would not bind the owner's chosen
user. Resolving a username only at acceptance could target someone who later
claims it. Directly adding a named user would skip their consent. A global user
picker would expose accounts unnecessarily; exact authorized resolution is
sufficient for this workflow.

Old unbound links remain valid only under their existing short expiry and
current admission policy. New clients use recipient-bound invitations. Rollback
must retain recipient references and reject unsupported writes; never drop or
weaken a binding to make an older adapter accept it. Invitation/audit history is
retained, without storing plaintext secrets or email addresses in new metadata.

## References

- [Verified principal authorization](0022-verified-principal-and-canonical-organization-authorization.md)
- [Personal workspace ownership](0068-personal-and-organization-workspaces.md)
- [Actor-owned profiles](0069-actor-owned-account-profiles.md)
- [Account requirements](../product/POST_BETA_ACCOUNT_AND_REPOSITORY_REQUIREMENTS.md)
- Execution plan
