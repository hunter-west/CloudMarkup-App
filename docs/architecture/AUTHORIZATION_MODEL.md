# Authorization model

## Status and scope

This document defines authorization policy version 1 for the modular monolith
and the proposed commercial permission extension in policy version 2.
[ADR-0022](../adr/0022-verified-principal-and-canonical-organization-authorization.md)
is the durable identity and tenant decision. Proposed
[ADR-0023](../adr/0023-provider-neutral-commercial-domain-and-credit-accounting.md)
defines the commercial extension and requires maintainer acceptance.

The boundary authenticates Cognito access tokens, maps verified external
subjects to active application principals, resolves current organization
memberships from PostgreSQL, and authorizes exact tenant-owned objects. Policy
version 2 adds provider-neutral commercial permissions and internal trusted
adjustment scope; it does not provision Cognito, implement a browser login flow,
integrate Stripe, expose billing interfaces, call a model, or deploy
infrastructure.

## Threat assumptions

The following inputs are untrusted selectors, never authority:

- route, query, or body organization, tenant, principal, membership, role, or
  ownership values;
- Cognito groups, custom role claims, email addresses, display names, and other
  mutable token claims;
- project, revision, job, artifact, integration, audit-event, object-store, and
  idempotency identifiers supplied by a caller;
- billing account, subscription, plan, entitlement, grant, reservation, usage,
  seat, extension, adjustment, or provider identifiers supplied by a caller;
- cache entries that are not bound to an authorized organization and current
  membership policy version; and
- object-store paths constructed from caller strings instead of authorized
  metadata.

A correctly signed token can remain valid after an application user is deleted
or a membership is suspended. Token verification therefore establishes an
external subject only. Active application principal and membership state are
read from trusted application storage for authorization.

The boundary assumes TLS at the deployed edge, controlled Cognito pool/client
configuration, normal JWKS key rotation, parameterized database queries, and
private object-store access. Compromise of Cognito signing keys, the application
database, or the production secret store is outside this boundary and requires
the platform incident-response controls.

## Principal and authentication

`Principal` contains only the application principal ID, token/session ID,
authentication source, verified authentication time, and expiry. It contains no
organization, role, ownership, or permission claim. Authentication middleware
creates this value; route handlers and request bodies cannot create or amend it.
The middleware adds the server correlation ID in a separate request context for
auditing.

The production adapter accepts one bounded `Bearer` access token and uses
`aws-jwt-verify` to check the Cognito signature, issuer, expiry, token use,
configured app client, and required API scope. It then maps `(issuer, subject)`
through the application principal directory. An unknown, suspended, or deleted
principal is unauthenticated.

The adapter named `LocalDevelopmentPrincipalResolver` is intentionally separate.
It requires `enabled: true`, an exact `local` runtime, a namespaced
`local-development:` token, and a non-production process. Construction fails in
production. Tests inject controlled verifier implementations; production
verification is never weakened for test convenience.

The deployed beta described below still uses tab-memory credentials. The
September 17 candidate implements
[ADR0053](../adr/0053-revocable-browser-refresh-sessions.md) with server PKCE
exchange, an HttpOnly refresh cookie, verified eight-hour session metadata and
durable revocation. Its migration 0078 remains an unregistered proposal;
deployment and live restoration acceptance are pending. Cookie possession alone
never authorizes product endpoints. The candidate also preserves transient
renewal failures for bounded retry and carries a validated same-origin return
path through sign-in. The historical deployed behavior below is retained until
the reviewed release is actually deployed.

The beta browser uses Cognito Authorization Code with PKCE and validated,
same-origin public runtime configuration. Access and refresh tokens remain only
in private memory in the originating tab. They are never written to
localStorage, sessionStorage, IndexedDB, cookies, URLs, query keys or logs.
Reloading or closing the tab requires another sign-in.

Before authenticated API requests and downloads, the browser renews access
tokens within one minute of expiry. Concurrent callers share one POST to the
original validated Cognito token endpoint and client. Refresh-token rotation is
supported; the provider can reject an expired or revoked refresh credential.
Token requests have a 15-second deadline. Failure clears the tab's credentials
and lets the existing unauthorized API response request sign-in. Application
requests are never replayed automatically after a 401.

The tab permits renewal for at most eight hours after interactive sign-in. This
is a browser lifetime bound, not server revocation or proof of recent
authentication. API identity still comes from verified JWTs and current stored
principal/membership state. Sensitive actions continue to use verified
`auth_time`; refreshing an access token does not satisfy fresh authentication.
The API binds sessions to Cognito's verified `origin_jti` refresh-family claim,
with `jti` fallback only when the claim is absent. Malformed present identifiers
fail closed. This keeps an existing tab's editing proof usable across renewal;
another sign-in, principal, tab proof or lease epoch still fails the existing
checks. The configured beta client has token revocation enabled, 30-minute
access/ID tokens and a seven-day refresh token; refresh rotation is disabled.
See
[Cognito access-token claims](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-access-token.html).

There is no database migration. During rollout, an existing lease bound to the
previous token ID may need to expire and be reacquired through the normal
60-second lease lifecycle. No ownership or expiry guard is bypassed.

Sign-out clears both credentials and pending work, and the existing token-free
cross-tab message clears other active tabs. Cancellation and a new sign-in
invalidate late token responses even if network cancellation is ignored. The
Cognito logout redirect clears hosted-login state; this does not claim immediate
server invalidation of every previously issued access token.

No cookie-based application session is introduced: authorization remains an
explicit bearer header, with PKCE and callback state binding for interactive
sign-in. Existing CSP, output encoding, same-origin API routing and tenant
authorization remain necessary. Script compromise can still access authority in
an active page. Tests cover renewal, rotation, expired/malformed credentials,
concurrency, timeouts, sign-out and sign-in races, storage exclusion and
asynchronous API/download use. Hosted renewal evidence remains pending.

## Canonical organization roles

Permissions are derived from the current stored canonical role. Persisted
free-form capability arrays are compatibility/presentation evidence only and
cannot expand authority.

| Capability family                                                                        | Viewer | Editor | Administrator                      | Owner |
| ---------------------------------------------------------------------------------------- | ------ | ------ | ---------------------------------- | ----- |
| Read organization, projects, documents, revisions, jobs, artifacts                       | Yes    | Yes    | Yes                                | Yes   |
| Create/edit projects and environments; mutate drafts; validate, revise, generate, export | No     | Yes    | Yes                                | Yes   |
| Read integration metadata                                                                | No     | Yes    | Yes                                | Yes   |
| Read memberships and audit summaries                                                     | No     | No     | Yes                                | Yes   |
| Manage memberships/integrations and delete projects                                      | No     | No     | Yes, except owner/admin escalation | Yes   |
| Assign owner or perform organization-sensitive lifecycle actions                         | No     | No     | No                                 | Yes   |

Actor-owned current-principal and presentation-preference capabilities require
an active Principal but no organization membership. Preferences remain separate
from Architecture Documents and cannot affect architecture semantics, revisions,
validation, compilation, diagrams, commercial policy, or technical-usage
visibility.

The API contains an exhaustive protected-operation-to-permission registry. A new
protected versioned operation fails TypeScript checking until it has an explicit
authorization requirement.

### Integration discovery and stored-policy alignment

The GitHub export workflow added `integrations.read` to the editor runtime role
in Prompt 40. It permits tenant-authorized integration discovery, not linking,
credential access, membership visibility, integration administration or billing
management. Linking still requires `integrations.manage`; export execution has
its separate `exports.run` and reviewed lifecycle checks.

Owner-approved migration `0023` repairs the historical `0007` SQL mirror of this
already-deployed runtime set. It takes a transaction-scoped role-table lock,
refuses unexpected prior canonical function/row metadata, replaces the mirror
function and updates only canonical authorization-v2 editor capability metadata.
The identical canonical check is restored and explicitly validated before the
migration ledger commits. Other roles, memberships, principals and policy
versions are unchanged. Historical migrations remain immutable.

Commercial SQL boundaries compare the stored canonical set with current runtime
policy under authorization locks and fail closed on a mismatch. Do not suppress
this comparison or use free-form stored claims as authority. Migration replay
uses the checksum-bound ledger; failure rolls back the complete `0023`
transaction, not previously committed additive migrations.

## Commercial permissions policy version 2

Commercial policy version 2 adds explicit permission families over the same
canonical stored roles:

| Commercial permission                                                                               | Viewer | Editor | Administrator | Owner |
| --------------------------------------------------------------------------------------------------- | ------ | ------ | ------------- | ----- |
| Read current plan, entitlement, seat-limit, credit, grant-expiration, and aggregate-usage summaries | Yes    | Yes    | Yes           | Yes   |
| Start a new authorized expensive commercial operation                                               | No     | Yes    | Yes           | Yes   |
| Manage billing and external subscription workflow                                                   | No     | No     | Yes           | Yes   |
| Read restricted technical usage and provider-cost detail                                            | No     | No     | Yes           | Yes   |
| Perform administrative credit adjustment                                                            | No     | No     | No            | No    |

The canonical permission names are `commercial.summary.read`,
`commercial.expensive.use`, `billing.manage`, and `usage.read-technical`,
respectively. `commercial.expensive.use` only permits entry to deterministic
entitlement evaluation; it cannot bypass plan features, limits, credit
availability, commercial suspension, or the expensive-operation kill switch.

All entries require an active membership in the exact organization. Browser
mode, redirects, subscription identifiers, and caller-supplied organization or
role values never grant commercial authority. Guided and Professional modes have
the same authorized technical-detail surfaces.

Administrative credit adjustment is a separate trusted platform-administrator or
system-reconciliation boundary. It requires explicit authorized organization
scope, trusted actor/system identity, reason, idempotency key, correlation, and
audit evidence. It cannot be reached through ordinary owner, administrator,
editor, or viewer membership.

Prompt 24A defines these permission requirements for domain schemas and internal
ports. Prompt 24C owns exposed commercial operations, each of which must enter
the exhaustive operation registry before it is routable.

## Object authorization

Authorization evaluates these steps in order:

1. Confirm the authenticated application principal is still active.
2. Resolve the selected object and its ownership from trusted metadata.
3. For child objects, verify the exact parent chain and organization: project,
   then revision/job/artifact as applicable.
4. Re-read the actor's active membership for that organization.
5. Validate the stored role is one of `owner`, `administrator`, `editor`, or
   `viewer`, then derive permissions from the applicable versioned policy.
   Commercial operations use policy version 2.
6. Produce an authorized organization context for repository and object-store
   access.

The same pattern applies to projects; legacy revisions and Solution Revision
manifests; Repository Snapshots, Observed Solutions, and Reconciliation
Proposals; AI extensions, Active Issue states, and Evidence; validation,
generation, and export jobs; downloadable artifacts; integrations; audit events;
billing accounts; subscription projections; entitlement decisions; grants;
reservations; usage events; seat summaries; and scoped extensions. Database
repositories require an explicit authorized scope. Object-store keys use the
authorized organization/project plus validated object metadata; callers cannot
supply a tenant prefix. Idempotency keys include the authorized organization,
principal or trusted system actor, operation, and caller key so entries cannot
cross tenants.

Access to a solution/provenance record does not grant model, repository,
generation, billing, secret, compiler, cloud, CI, or deployment authority.

A commercial adjustment port accepts only the separately constructed trusted
platform-administrator or system-reconciliation context. An ordinary
organization scope cannot be promoted into that context by a request field.

## Unauthorized, forbidden, and hidden resources

- `401 authentication_required`: missing, malformed, invalid, expired, or
  unmapped token; suspended/deleted/unknown application principal.
- `404 not_found`: missing or guessed object; cross-tenant object; mismatched
  parent; absent or stale membership. These cases use the same safe message.
- `403 access_denied`: an active same-tenant member lacks the requested role
  permission, or a sensitive operation requires newer authentication.

Object lookups never occur before deleted-principal rejection. Cross-tenant
guesses do not write attacker-controlled events into the target tenant's audit
stream. Responses do not identify which check failed.

## Asynchronous job authorization

Authentication and application authorization verify the current principal,
active membership, permission, organization/project ownership, and any
commercial permission before constructing `AsyncJobTrustedContextV1`. The job
context carries only the exact actor, correlation ID, and organization/project
ownership; it does not cache role, membership, or permission authority. Job
payloads and queue envelopes cannot select a tenant or principal.

Creation idempotency is scoped to the verified organization and actor plus the
operation, derived caller-key digest, and derived canonical request digest.
`JobService` verifies both digests internally and never stores the raw key.
Reads and typed status polling require an exact stored organization/project
match and hide cross-tenant or cross-project guesses as not found. Cancellation
additionally requires the exact verified principal that created the job.
Internal workers compare the trusted queue envelope with durable ownership and
input identity before claim; that envelope grants no publication, repository,
credential, or deployment permission.

Trusted queue, stale-creation, orphan, retention, and audit-outbox reconcilers
receive one exact ownership scope. Repositories filter that scope before
applying the bounded limit, and service code rechecks every returned candidate.
Stale creation recovery also revalidates exact parent/root/correlation and
dependency ownership before completing a claim.

Large inputs, checkpoints, user responses, outputs, artifacts, and Evidence
records remain separately authorized object references. A future HTTP or
server-sent-events adapter must repeat authentication and ownership checks on
every request or reconnect. Prompt 25 implements only the typed polling service
contract and an interface-only future event source; it adds no generic job HTTP
or SSE route.

## Recent authentication and audit

Role changes, integration credential or lifecycle changes, GitHub export
initiation, organization billing management, and destructive actions require
authentication no older than ten minutes, with one minute of bounded future
clock skew. Request fields, redirects, subscription state, and role claims
cannot refresh the timestamp.

The sensitive-action hook records trusted actor, organization, action family,
target, outcome, safe summary, occurrence time, policy version, and correlation
ID for role, integration, billing, export, and destructive actions. GitHub
exports and future billing-management flows use this hook's
recent-authentication policy.

Administrative credit adjustments use the separate trusted adjustment boundary
and record system or platform-administrator identity, exact organization,
reason, credit effect, idempotency identity, outcome, occurrence time, and
correlation. Secrets, raw model prompts or responses, credentials, payment data,
provider margin, and architecture payloads must never be copied into audit
summaries.

## Cache and storage requirements

- Cache keys include authorized organization ID and policy version; membership
  change/deletion must invalidate or outlive any bounded entry before access.
- Object paths come only from authorized ownership metadata and remain rooted at
  the exact organization and project.
- Signed downloads are created only after metadata authorization and are short
  lived; knowledge of a storage key is not authorization.
- Integration credential references remain server-side secret references. No
  long-lived integration or identity token is returned to browser storage.

Platform IaC may later provision Cognito, IAM, database, and object-store
controls. Those platform resources are separate from customer IaC artifacts,
which remain deterministic exports and cannot deploy or carry Cloud Markup
platform credentials.

## Required verification

The M9 single-editor candidate adds a concurrency requirement without changing
canonical roles: project readers can inspect editing availability; project
mutators must hold the current tab-scoped lease to save the mutable diagram.
Lease proof never substitutes for current principal, membership or lifecycle
checks. Read-only peers remain able to browse shared projects. Technical review
and passing negative/concurrency evidence are recorded in accepted
[ADR-0044](../adr/0044-shared-project-editing-leases.md); this is not yet live
deployment evidence.

The tenant-isolation matrix covers multiple organizations, every canonical role,
guessed identifiers, cross-tenant parent mismatches, suspended memberships,
deleted principals, revisions, all job kinds, artifacts, integrations, audit
events, billing accounts, entitlement decisions, grants, reservations, usage
events, and seat summaries. Adapter tests cover verified, invalid, malformed,
wrong-use, unknown, deleted, and directory-outage identity results plus
production refusal by the local adapter.

Commercial policy version 2 tests prove:

- every active canonical role can read its organization's summary surfaces;
- active editors, administrators, and owners, but not viewers, receive
  `commercial.expensive.use`;
- only active owners and administrators can manage billing or read restricted
  technical usage;
- editors and viewers cannot obtain those permissions from presentation mode,
  request fields, persisted free-form capabilities, or provider identifiers;
- no organization role can invoke the trusted administrative adjustment
  boundary;
- pending, suspended, removed, stale, and cross-tenant memberships fail safely;
  and
- every future exposed Prompt 24C operation has an explicit registry entry,
  recent-authentication rule where required, and safe audit result.

Contract and OpenAPI snapshot tests preserve the public role and permission
shapes when those interfaces are introduced.

## Owner-funded functional beta infrastructure proposals

ADR [0055](../adr/0055-functional-beta-infrastructure-assistant.md) admits the
explicit beta proposal route with verified authentication, active project and
organization editing capability, and a current draft precondition checked before
and after inference. Only requirements and a fixed public catalog reach the
provider. The owner funds one bounded model attempt per request; no customer
credits are deducted and no evaluation or promotion claim is created. Proposals
require explicit local review and domain-command application. Existing editing
leases and authenticated draft writes still govern saving.
