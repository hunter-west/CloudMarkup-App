# ADR-0073: Branded account access and independent registration admission

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Proposed
- **Date:** 2026-10-01
- **Owners:** Cloud Markup engineering
- **Supersedes:** None
- **Superseded by:** None

## Decision

Keep Authorization Code with PKCE and the protected refresh-cookie exchange. Add
an exact, nonsecret account-access capability view without changing the existing
runtime authentication v1 contract or ordinary access-token scope requirements.
Signup is false by default. One versioned infrastructure input drives both
Cognito self-registration and its public display capability. Returning-user
sign-in and recovery are independent of this flag; purchases retain their
separate commercial admission boundary.

Configure Cognito managed login version 2 with the Essentials feature plan, the
existing CloudMarkup logo, a documented light-mode setting, both color palettes
and supported form settings. Keep existing pool/client identities, recovery,
optional TOTP, password strength and token revocation. Require verification
before an email update takes effect. This is local configuration only;
activating a provider feature tier and inspecting the hosted screens require a
separately authorized deployment.

Provide direct signup and recovery entry routes using the existing popup and
one-time PKCE transaction. Recheck registration admission before opening signup.
Use the supported managed-login prompt for fresh sign-in. Enhanced account flows
may request Cognito's self-service scope in addition to existing scopes;
ordinary legacy grants remain valid for existing API access. All callback,
cancellation, expiry, popup isolation and safe return-path controls remain.

Provider password/email/TOTP management follows in a separate bounded adapter
behind verified identity. Enabling a scope does not claim these controls exist.
No provider operation, email, account creation or deployment is executed by
local verification.

## Evidence required

Test closed/open/malformed configuration, preservation of the old public
contract, independent sign-in/recovery, gate changes during signup, safe
callback/return paths, cancellation and cross-account admission. Synthesize the
exact user-pool gate, scope allowlist, email verification policy and branding
without credentials. Review app routes in both themes and at mobile width. A
live provider journey remains unverified until an authorized deployment.

## References

- [Account sessions](0072-account-session-revocation.md)
- Product execution plan
- [Managed login endpoints](https://docs.aws.amazon.com/cognito/latest/developerguide/managed-login-endpoints.html)
- [Authorization and fresh sign-in](https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html)
- [Managed login settings](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_CreateManagedLoginBranding.html)
- [Registration policy](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-admin-create-user-policy.html)
