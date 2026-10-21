# ADR-0022: Verified principals and canonical organization authorization

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Accepted
- **Date:** 2026-08-02
- **Owners:** CloudCanvas engineering
- **Supersedes:** None
- **Superseded by:** None

## Context

The M2 API and persistence foundations require one production authentication
adapter, explicit tenant authorization, stable roles, object-level checks,
recent-authentication policy, and auditable sensitive actions. The current test
adapter accepts free-form capability arrays, and the Lambda composition has no
production identity resolver. Product and domain documents intentionally left
the non-owner role matrix open until this task.

Cognito token groups, custom claims, route parameters, request bodies, and
object keys are all outside the authorization source of truth. A valid external
token can also outlive an application user deletion or organization membership
change, so token verification alone cannot grant tenant access.

## Decision

Use one application-owned `Principal` and canonical authorization policy.

- The production Cognito adapter accepts only a bounded `Bearer` access token
  and uses AWS's `aws-jwt-verify` library to verify signature, issuer, expiry,
  token use, configured app client, and configured API scope. Raw JWT data is
  excluded from errors. Verified issuer/subject claims are mapped through the
  application principal directory; an unknown, suspended, or deleted principal
  is unauthenticated.
- A Principal records the application principal and session IDs, authentication
  source, verified authentication time, and token expiry. It contains no
  organization, role, ownership, or authorization claim.
- Local development uses a separate clearly labeled resolver. Construction
  requires both an explicit `local` runtime environment and an enable flag and
  fails when `NODE_ENV` is `production`. It never parses or accepts Cognito
  tokens.
- Organization roles are `owner`, `administrator`, `editor`, and `viewer`.
  Permission sets are defined by authorization policy version 1 in application
  code and mirrored by a checked PostgreSQL migration. Runtime authorization
  derives permissions from the stored canonical role; persisted or JWT-supplied
  free-form capability claims cannot expand access.
- Active principal state and membership are re-read from trusted application
  storage. Object authorization resolves server-side ownership and verifies the
  exact parent chain for project, revision, validation/generation/export job,
  artifact, integration, and audit access before producing an authorized scope.
- Missing authentication, invalid/expired tokens, unmapped subjects, and deleted
  principals return unauthorized. Missing resources, guessed identifiers,
  cross-tenant objects, and stale memberships return the same safe not-found
  response. An active member who lacks an in-tenant permission receives
  forbidden.
- Sensitive actions declare recent-authentication requirements. Policy version 1
  uses a ten-minute maximum age with bounded future-clock skew for role changes,
  integration credential/lifecycle changes, GitHub export initiation, and
  destructive actions. Request claims cannot refresh this timestamp.
- Role, integration, export, and destructive actions run through an audited
  action hook. Trusted actor, tenant, target, outcome, correlation, and safe
  summary are recorded. Cross-tenant guesses do not write attacker-controlled
  records into the target tenant's audit stream.
- Server caches and idempotency keys include the authorized organization scope;
  object-store keys are derived from that scope and validated metadata. Browser
  code receives no token-storage implementation. Production integration must use
  short-lived access tokens and keep refresh/long-lived credentials out of
  browser-accessible storage.

The initial role matrix is:

| Permission family                                            | Viewer | Editor | Administrator                         | Owner |
| ------------------------------------------------------------ | ------ | ------ | ------------------------------------- | ----- |
| Organization/project/document/job/artifact reads             | Yes    | Yes    | Yes                                   | Yes   |
| Project creation and editing, validation, generation, export | No     | Yes    | Yes                                   | Yes   |
| Membership visibility, integrations, audit                   | No     | No     | Yes                                   | Yes   |
| Membership/integration administration and project deletion   | No     | No     | Yes, excluding owner/admin escalation | Yes   |
| Owner assignment and organization-sensitive lifecycle        | No     | No     | No                                    | Yes   |

Actor-owned principal and presentation-preference operations require an active
Principal but no organization membership. Billing permissions remain owned by
Prompts 24A-24C and are not introduced here.

This decision adds no Cognito resource, browser authentication flow, deployment,
background execution, billing behavior, AI behavior, compiler, or customer-IaC
capability.

## Consequences

### Positive

- Token verification, application identity, tenant membership, role policy,
  object ownership, and recent authentication are separate reviewable checks.
- Role changes take effect without waiting for token expiry because Cognito
  groups and role claims are ignored for authorization.
- One exhaustive operation-permission registry makes newly added protected API
  operations fail the TypeScript build until assigned a permission.
- Cross-tenant hiding, canonical scope keys, and exact object-parent checks
  reduce identifier-guessing and confused-deputy risk.

### Negative

- Each protected request requires current principal/membership and object
  ownership data unless a short-lived, tenant-bound cache with explicit
  invalidation is later approved.
- Cognito JWKS retrieval is a production network dependency and needs controlled
  timeout, cache, key-rotation, and outage integration evidence.
- The fixed role matrix requires additive policy migrations for future changes;
  arbitrary customer-defined roles are not supported by v1.

### Follow-up

- The platform-IaC workstream must provision Cognito and configure typed
  non-secret pool/client/scope inputs plus external secret references where
  needed. This application change does not authorize provisioning.
- Browser authentication/session work must document HttpOnly/Secure/SameSite or
  in-memory token handling, CSRF posture, renewal, logout, and revocation before
  connecting the production web application.
- Controlled platform tests must exercise live JWKS fetch/cache/rotation and
  deployed request behavior before production.

## Alternatives considered

### Trust Cognito groups or custom role claims

Rejected because membership changes and application deletion must take effect
independently of token lifetime, and external claims must not become tenant
authority.

### Keep free-form capabilities in membership records

Rejected because arbitrary arrays create policy drift and escalation paths.
Stored role keys are canonical; capabilities are derived and may be returned as
presentation evidence only.

### Use one permissive mock resolver in all environments

Rejected because local convenience must not weaken production verification. The
local adapter has a separate type, token namespace, and construction guard.

### Return forbidden for every authenticated denial

Rejected because it would reveal which guessed resource identifiers exist in
another tenant. Forbidden is used only after current same-tenant membership is
established.

## References

- [Authorization model](../architecture/AUTHORIZATION_MODEL.md)
- [Security Principles](../architecture/SECURITY_PRINCIPLES.md)
- [System Overview](../architecture/SYSTEM_OVERVIEW.md)
- [Domain Model](../architecture/DOMAIN_MODEL.md)
- [Testing Strategy](../architecture/TESTING_STRATEGY.md)
- [Persistence ADR](0021-postgresql-data-api-and-object-storage.md)
- Identity and authorization execution plan
- [Amazon Cognito JWT verification](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-tokens-verifying-a-jwt.html)
- [AWS JWT Verify](https://github.com/awslabs/aws-jwt-verify)
