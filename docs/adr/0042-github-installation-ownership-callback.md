# ADR-0042: Session-bound GitHub installation ownership callbacks

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Accepted
- **Date:** 2026-09-05
- **Owners:** Cloud Markup product, application, and security
- **Supersedes:** ADR-0040's closed public route list only for the two GET
  routes below
- **Refines:** ADR-0005, ADR-0022, ADR-0040, and ADR-0041
- **Superseded by:** None

## Context

Customers must explicitly connect their own selected repositories to the public
Cloud Markup GitHub App. An installation identifier in a browser redirect does
not prove ownership. Cognito sessions and GitHub user authorization are separate
identities, while the initial Regional REST route list excludes GitHub browser
callbacks. The already approved platform delivery path must not grant customer
cloud access or expand the retained beta runtime role implicitly.

## Decision

Independent implementation and trust-boundary review on 2026-09-05 accepted this
design with no unresolved high-priority findings. This is technical architecture
acceptance, not owner-bootstrap activation or live provider evidence.

Add exactly public-at-Cognito GET `/github/setup` and `/github/callback` to the
existing REST origin, exposed through CloudFront as `/api/github/setup` and
`/api/github/callback`. Both retain Regional origin admission and application
edge-marker checks. These callbacks do not grant tenant authority. With the
connection feature off they fail closed; all protected connection operations
still require verified application identity and current organization membership.

The authenticated link intent binds organization, principal, exact
authentication session, one-time state and expiry. The setup handler initiates
OAuth with S256 PKCE and a secure bounded state cookie. The callback exchanges
the code only at the exact approved GitHub endpoint, then verifies the exact
App, installation, account, selected-repository scope and minimum permissions.
Personal accounts must match the authenticated GitHub user; organization
accounts require current administrator membership. Suspended installations and
unrelated identities fail closed. OAuth initiation during GitHub installation is
disabled because the application owns this subsequent authorization flow.

Purpose-separated HKDF keys derived from the exact client secret seal bounded
state and receipts using AES-256-GCM. State/receipt replay is additionally
fenced by the one-time PostgreSQL intent. Codes, tokens, seals and raw provider
content are not stored in ordinary database rows, browser storage, logs or
analytics. The callback fragment is removed immediately and relayed only in
memory to the initiating same-origin authenticated tab. A different
authentication session cannot complete the receipt, even for the same user.
Secret rotation invalidates in-flight seals; users restart the short connection
flow.

PostgreSQL connection/discovery composition rechecks current tenant authority at
each query/transaction and does not retain SQL locks across provider requests.
The exact App private-key and client-secret ARNs are the only provider secrets
admitted. The separate retained owner-bootstrap policy and application flag both
default off. The deployment role does not mutate bootstrap IAM implicitly.

This decision neither enables repository writes nor implements artifact jobs.
Production export remains unavailable until its immutable artifact/execution
ports are composed. It grants no workflow permission, default-branch write,
merge, customer credential, customer cloud action or new provider webhook.

## Consequences

### Positive

- Customer-selected repositories have explicit installation/account ownership
  evidence bound to the initiating tenant session.
- Origin admission and retained IAM ownership remain intact.
- Separate connection and export activation prevent misleading readiness claims.

### Negative

- Owners must register two exact URLs and coordinate a separate runtime policy.
- User authorization, expiry and same-session restrictions add recoverable
  failure cases; secret rotation interrupts in-flight installation flows.
- Encrypted seals depend on careful purpose separation and bounded decoding.

### Follow-up

- Review callback, tenant/session, replay, secret, route and PostgreSQL tests.
- Verify registration and exact bootstrap policy before enabling connections.
- Run exact-head CI and authenticated linking/discovery smoke; do not use fakes
  or a stored secret as activation evidence. No new migration is required for
  linking; existing versioned GitHub intent/installation tables remain in use.
- Roll back by disabling connection flags and removing the dedicated secret
  grant through its owner-controlled stack; preserve durable intent/audit data.

## Alternatives considered

### Trust installation IDs or share personal access tokens

Rejected: neither binds customer ownership to the application tenant session;
personal tokens also broaden long-lived secret handling.

### Request additional organization-members permissions

Not selected. Current authenticated-user membership evidence suffices for the
administrator requirement. Reconsider only for a separately reviewed capability.

### Put callback state in local storage or reuse Cognito callbacks

Rejected because persistent callback credentials and mixed provider identity
boundaries are unnecessary. The initiating session completes an ephemeral proof.

## References

- [GitHub architecture](../architecture/GITHUB_APP_REPOSITORY_EXPORT.md)
- Provider setup checklist
- Active restoration plan
- [ADR-0040](0040-regional-rest-ingress-origin-admission.md)
- [ADR-0041](0041-cross-account-beta-dns-ownership.md)
