# ADR-0068: Personal and organization workspace ownership

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Proposed
- **Date:** 2026-09-30
- **Owners:** Cloud Markup engineering
- **Supersedes:** None
- **Superseded by:** None

## Context

The owner requires an independent personal account by default and explicitly
created organizations for collaboration. The canonical tenant storage currently
uses organization IDs for every workspace, including newly bootstrapped beta
users. These stable IDs also bind projects, grants, integrations and exports.

## Decision

Add an immutable workspace kind and, only for personal workspaces, a unique
principal owner to the existing canonical tenant record. Existing records remain
organization-kind; do not infer personal ownership from a name, prefix or member
count. Do not move any existing project, subscription, grant or integration. New
verified onboarding creates a personal-kind workspace. Existing principals can
explicitly provision a personal workspace idempotently without converting or
abandoning their existing organizations.

The database prohibits additional members, owner replacement and invitations in
a personal workspace. Generic organization deletion cannot delete the personal
account; account deletion needs its separate lifecycle workflow. Principal
suspension still denies access through existing authorization.

Use additive actor-owned account-workspace operations. Preserve existing strict
organization and current-principal v1 response shapes and stable tenant routes.
The new workspace directory exposes the kind and verified actor binding. A
personal workspace still uses canonical tenant authorization internally; the UI
presents it as Personal. Creating or switching organizations never transfers
personal data or billing.

Organization creation is one transaction: verify current active actor and recent
authentication, serialize that actor's creation requests, establish canonical
roles and owner membership, record a durable request receipt and audit event. A
browser can choose a display name, never an owner, role, tenant ID or billing
scope. The same actor/key and payload replay to the same workspace; a changed
payload conflicts. Billing retains the existing lazy account provisioning path.

Keep the current 100-context principal contract. Organization creation leaves
one slot for a personal workspace. Existing accounts already at that bound can
continue to sign in; explicit personal provisioning returns an actionable
capacity error instead of creating a context the current client cannot read.
Existing invitation acceptance now enforces the same bound before inserting a
new membership, while an existing-member/replay path remains idempotent. It
retains account-first locking and locks issuer/recipient principal rows in a
stable order before current authority and capacity checks. This serializes
joining across organizations with personal/organization creation and avoids
reciprocal-invitation lock cycles. Recipient-bound invitations and complete
membership lifecycle remain separate pending implementation.

## Consequences

- Canonical tenant identities and existing financial history remain stable.
- Personal-workspace ownership is explicit and enforced in SQL as well as UI.
- Existing beta workspaces remain available as legacy organizations. Converting
  them or transferring their contents requires a separate explicit workflow.
- Rollback must retain the personal membership guards. An old client can read
  the unchanged v1 responses, but cannot share a personal workspace.
- The additive local migration does not deploy, open registration, create live
  charges or change authentication providers.

## References

- [Canonical authorization](0022-verified-principal-and-canonical-organization-authorization.md)
- [Account requirements](../product/POST_BETA_ACCOUNT_AND_REPOSITORY_REQUIREMENTS.md)
- Product execution plan
