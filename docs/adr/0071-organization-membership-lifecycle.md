# ADR-0071: Organization membership lifecycle

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Proposed
- **Date:** 2026-09-30
- **Owners:** Cloud Markup engineering
- **Supersedes:** None
- **Superseded by:** None

## Decision

Retain membership IDs and invitation/audit history. Record removal and voluntary
leave as suspended memberships with explicit departure metadata. Previously
suspended memberships without departure metadata remain unavailable for
rejoining. Only a fresh recipient-bound invitation and explicit acceptance may
reactivate a departed member, with current sharing-plan, seat and
account-workspace admission. Rejoining preserves the membership identity,
increments its version and takes the new invitation role. Old accepted or
unbound invitations cannot restore access.

Expose additive versioned member views without changing legacy membership reads.
Use exact versions and actor/organization-bound idempotency receipts for role,
remove, leave and ownership-transfer commands. Receipts contain immutable IDs,
versions, roles and states, not profile names or credentials. A retry may read
its own receipt after loss of membership; it never reapplies the earlier command
or grants current access. Current member reads determine resulting access.

Apply accepted ADR 0022 authority: owners manage non-owner roles; administrators
manage only editor/viewer members and cannot change their own role. Any active
member may leave, except the last active owner. Owner removal/demotion is not an
ordinary member action. Explicit ownership transfer promotes an existing active
member and demotes the acting owner to administrator atomically, requiring exact
versions of both memberships and recent authentication. It changes application
authority only; subscription, payment identity and historical accounting stay
intact. Another existing owner, if present, retains their role.

Serialize lifecycle commands per organization, then lock its existing billing
account before principal/membership locks, matching invitation admission. This
also supports organizations without billing setup. Current principal,
organization, canonical role, target and recent authentication are checked after
waits and at commit. Private personal workspaces cannot be shared, left or
transferred. A membership update always advances its version, including legacy
administrative writes. No-op role updates retain their version.

Role changes revoke pending invitations issued by the affected member. Departure
also revokes pending invitations addressed to that member. This prevents a later
promotion/rejoin from reviving an older offer. Existing accepted invitations are
historical evidence only. Existing project and job authorization fences remain
active; do not delete jobs, credits or leases while changing a membership.
Active editing leases expire within their existing 60-second bound, and new
commits must pass current membership authorization.

## Verification and limitations

Require PostgreSQL concurrency, cross-tenant/administrator denial, last-owner,
post-lock expiry, exact replay, audit rollback and invitation rejoining tests.
UI must confirm consequential actions, retain uncertain attempts, refresh
current membership and principal data, and never infer authority from a saved
receipt. No live billing, identity-provider mutation or deployment is authorized
here. Organization deletion and administrative suspension remain separate
contracts.

## References

- [Authorization](0022-verified-principal-and-canonical-organization-authorization.md)
- [Workspace ownership](0068-personal-and-organization-workspaces.md)
- [Invitations](0070-recipient-bound-organization-invitations.md)
- Product plan
