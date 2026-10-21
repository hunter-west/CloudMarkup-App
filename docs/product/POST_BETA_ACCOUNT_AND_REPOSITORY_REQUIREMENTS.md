# Post-beta accounts, commerce, and repository journeys

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

Status: implementation specification. These requirements do not claim the
unimplemented flows already work. See the execution record and AWS coverage
plan.

## Confirmed product decisions

The owner confirmed on September 30, 2026 that existing-user sign-in must remain
available. Gate new registration and live purchases separately until launch.
Registration closed is a normal product state, not an authentication failure.
The owner revised Pro to **1,250 credits per paid monthly period at $39/month**.
This is an additive plan version; previously issued grants remain immutable.

The owner also set these one-time purchased-credit packs (latest September 30
revision):

| Pack   | Price (USD) | Credits | Expiration |
| ------ | ----------- | ------- | ---------- |
| Small  | $5          | 100     | Never      |
| Medium | $15         | 350     | Never      |
| Large  | $30         | 800     | Never      |

Monthly subscription credits expire at the subscription period end; successful
paid renewal issues the next allowance exactly once. Never reset the combined
balance or erase purchased credits. The existing deterministic allocation order
already puts expiring grants ahead of non-expiring grants. A reservation made
before period end retains its original allocations for settlement; releasing it
after expiry must not revive expired monthly credits. Retail pack prices are
separate from AI token metering and the internal credit conversion policy.

GitLab is the selected implementation default for the second repository service
unless the owner specifies another provider. Research supports exact-commit
reads and batched commits with a review branch. GitLab's write_repository OAuth
scope is for Git transport, not general API writes; selecting it alone cannot
implement the planned commit/MR adapter. See
[GitLab OAuth scopes](https://docs.gitlab.com/integration/oauth_provider/) and
[Commits API](https://docs.gitlab.com/api/commits/).

## One-time purchase implementation boundary

Use a separate durable top-up attempt from subscription Checkout, with a stable
account-bound retry key and immutable pack-policy/version snapshot. Checkout
uses payment mode, quantity one and exact server-derived USD amounts. The local
sandbox implementation uses inline prices from the immutable pack policy; live
product/price management remains a separate activation decision. A signed event
initiates authenticated session and line-item retrieval; a browser return never
grants credits. Require the session's paid status, matching
customer/account/attempt, exact price/quantity/currency and successful payment
before the canonical ledger receives one non-expiring purchased grant. Delayed
payment events and concurrent/repeated delivery must converge on the same grant.
See [Stripe Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment)
and
[session line items](https://docs.stripe.com/api/checkout/sessions/line_items).

The local follow-up now adds one-time payment normalization, durable attempts,
atomic purchased grants, typed account routes and a gated UI. Its queue retains
the reference-only v1 shape with an additive event allowlist; subscription
completion remains separate. Local workstream checks pass with documented
focused recoveries; final integrated root/release verification remains pending.
Retain event digests, payment/session IDs and safe policy evidence, never card
details or webhook secrets. Refund/dispute reconciliation must preserve consumed
history and flag an unresolved financial adjustment instead of deleting grants
or rewriting usage. Existing live-mode denial remains in force until separately
configured and activated.

The local Usage view now separates available monthly, purchased and other
credits, with the next recorded expiration. All amounts use one ledger snapshot,
exclude active reservations and reconcile to the displayed total. Historical
plan allowances are never replaced with the current 1,250-credit default.
Refund/dispute review still retains financial history without automatic debits.

## Baseline gaps and local follow-up

| Journey             | Existing evidence                                                                                                                                 | Required work                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canvas              | Zoom changes inverse-scaled service/boundary geometry                                                                                             | Remove interpolated geometry and replayed detail entry animations; verify wheel/zoom and stable graph hashes                                       |
| Account navigation  | Profile, Preferences, Personal security already exist; Usage/Billing were under Organization                                                      | Move Usage/Billing into Account and account icon menu, retaining current authorized scope                                                          |
| Personal workspaces | Verified beta Cognito onboarding already creates a separate deterministic tenant and owner membership per subject; storage is organization-scoped | Explicit personal-account classification, private owner-only behavior and routes; keep existing tenant isolation and never infer shared membership |
| Organizations       | Read/list/settings, role capability projection and bearer invitation acceptance exist                                                             | Create/rename organization; recipient-bound email/ID/handle invitation; member role/removal/leave/ownership lifecycle                              |
| Profile/security    | Verified profile/security pages explicitly read-only                                                                                              | Actor-owned display name/handle/preferences and verified email; real credential/MFA/session controls through Cognito                               |
| Public signup       | Cognito application stack sets selfSignUpEnabled=false                                                                                            | Server-enforced registration admission plus verified principal/personal-workspace onboarding and styled screens                                    |
| Top-ups             | Local verified durable attempts, atomic purchased grants, typed Checkout, gated account UI and canonical balance breakdown                        | Final integration, operational reconciliation and separately authorized activation                                                                 |
| IaC export          | Both deterministic targets and GitHub export experience exist                                                                                     | End-to-end selection/job/artifact/repository acceptance evidence for each target and supported graph                                               |
| Imports             | Bounded Terraform/CFN observations and exact stored graph command acceptance exist                                                                | Ordinary IaC-to-canvas mapping, file selection/upload, bounded repo discovery, source-to-workload review, and unresolved coverage UI               |

The catalog represents customer infrastructure; the platform's own Cognito,
Stripe, GitHub and Bedrock adapters are separate. Editing the provider's Cognito
catalog definition will not implement CloudMarkup signup.

## Personal account and organization flow

Create the application principal only from a verified identity-provider subject
and verified onboarding data. Provision exactly one personal workspace per
principal transactionally and idempotently. Existing beta Cognito onboarding
already creates an independent deterministic tenant and owner membership from
the verified provider subject. Preserve that storage isolation while adding an
explicit personal-account kind and owner-only behavior; personal workspaces are
not shared organizations in the user experience and cannot accept extra members.
Opening an account must not grant access to any existing beta organization. The
workspace switcher distinguishes Personal from explicitly joined organizations.
Personal projects, credits, integrations and exports are private to that
principal.

A user can create an organization, choose its name, and become its owner. Keep
personal billing and organization billing separate. Joining, leaving, switching
or creating an organization does not move projects, subscriptions, integrations
or purchased credits. Any future transfer is a separate reviewed operation.

The member composer supports verified email, exact application user ID, or exact
public handle. Resolve recipients on the server and present generic errors to
prevent account enumeration. Existing users receive a recipient-bound pending
invitation; new users receive an invitation that can be claimed only after email
verification and registration admission. Use explicit acceptance to preserve
personal-account consent. Do not add arbitrary people immediately based on a
name match. Expired/revoked/used tokens cannot be reused; repeated acceptance by
the same recipient is idempotent. Never place invitation secrets in logs or
analytics. New invitations must migrate the current bearer-link-only contract.

Provide invitation listing/revoke/resend, current roles, leave/remove, owner
transfer and member removal. Enforce last-owner protection and prevent an
administrator from promoting themselves or creating an owner. Reauthorize each
request against current membership and require recent authentication where
policy requires it. Removal invalidates future reads/writes without deleting
other members' work; outstanding jobs retain explicit cancellation/accounting
policy. Membership and organization lists need pagination, empty states,
loading, retry, stale response protection and keyboard/focus handling.

Before implementation, introduce a reviewed personal-versus-organization
workspace ownership contract. Preserve legacy organization/project/grant IDs;
backfill existing records as organization-owned, never guess personal ownership
from a single member. New personal-workspace routes use actor-owned authority.
Keep existing organization routes compatible while adapters resolve canonical
workspace scope. Test migrations twice, rollback read compatibility, owner
suspension/deletion, cross-tenant guesses, replay and concurrent provisioning.

### Local workspace implementation

The isolated product follow-up implements explicit personal ownership,
owner-only SQL guards, additive actor-owned directory/get/create operations, and
new verified Cognito onboarding. Existing beta tenant IDs and contents remain
unchanged as organization-kind records. Account UI now distinguishes Personal
and supports creating an organization. Creation retains a durable retry
identity, current actor authorization, atomic owner/role/audit setup, and the
current 100-workspace limit. See proposed
[ADR 0068](../adr/0068-personal-and-organization-workspaces.md). This foundation
does not yet provide complete member lifecycle or credential management, and has
not been deployed. Recipient lookup is described in the next local slice.

### Local editable profile implementation

The isolated product branch adds actor-owned display-name and optional public
username updates, a stable visible user ID and verified session readback.
Usernames are case-normalized and constrained by both schema and SQL uniqueness;
profile versions reject stale saves, and conflicts retain the user's draft.
Clearing or changing a username releases it, while future invitations must bind
the resolved immutable user ID. Profile reads preserve legacy name
compatibility; new writes require a single-line name. Post-lock
expiry/recent-authentication checks cover both writes and unchanged saves. No
global account directory or username-availability API is exposed. See proposed
[ADR 0069](../adr/0069-actor-owned-account-profiles.md). The profile does not
change Cognito subjects, verified email, credentials, tenant membership or
billing. Password/email/MFA/recovery and registration admission still need
implementation.

### Local recipient invitation implementation

The local product branch now addresses invitations to an exact existing user ID
or normalized username and binds the resolved immutable principal. A renamed or
reused username cannot retarget an invitation or its retry. Sharing-plan and
current manager authority are checked before new recipient resolution. Creation
and acceptance retain canonical account/seat locks, recent authentication,
private-workspace denial and audit rollback. There is no global account search;
exact authorized invitations necessarily confirm the selected recipient when
successful. Public-registration abuse controls remain part of launch review.

Organization Members provides a paginated invitation history, revoke and invite
again. Re-inviting an expired/revoked entry uses its stable principal ID.
Account and profile menus expose Invitations with explicit accept/decline,
actor-bound readback and refreshed workspace authority before showing access.
Interrupted creation retains the same selector, role and idempotency key.
Browser readback is bounded to 100 pages; exceeding that bound reports
unconfirmed state and preserves the attempt rather than claiming success.

Migration 0086 preserves legacy invitations and guards recipient identity at the
SQL boundary, including legacy acceptance. See proposed
[ADR 0070](../adr/0070-recipient-bound-organization-invitations.md). Email
delivery and invitations for unregistered users are not implemented. Member role
changes, removal/leave/ownership transfer, credentials and public registration
remain subsequent work; nothing in this slice activates live signup or
deployment.

## Profile and security screens

Use the existing shared controls, theme tokens, responsive layout, focus
handling and status/error patterns. The account icon opens Profile, Preferences,
Security, Usage, Plans & billing, workspace switching and Sign out. Show the
selected billing/workspace context whenever organization data is presented under
Account.

Profile: display name, application handle, verified email and read-only stable
user ID. Preferences: theme, guidance mode, locale/time zone and notification
settings when backed by a contract. Preserve unsaved changes and use explicit
save/error/conflict states; do not show a successful save without server
readback. An application handle is distinct from the Cognito username/sub, which
is not renamed by changing a label. Unique handles need normalization, reserved
names, length/character policy, concurrency constraints and lookup privacy.

Security: password change, forgotten-password recovery, verified-email change,
MFA enrollment/removal with recovery, current-session details, sign out and
revoke-other-sessions. Federated users see provider-specific management guidance
instead of a nonfunctional local password form. Reauthenticate sensitive
changes, keep old email active until the new one is verified, and handle stale
verification codes and canceled requests. Passwords/codes/tokens never enter the
graph, AI, logs or browser storage. Account deletion needs explicit ownership,
billing, retention and recovery behavior before activation.

Keep the accepted
[session boundary](../adr/0053-revocable-browser-refresh-sessions.md):
short-lived access in memory, server exchange/restore, protected refresh cookie
and durable revocation. Do not replace it with a second authentication system.
Use Cognito-managed password/authentication operations. Custom branded forms
must implement all relevant challenge states; a polished form alone is not a
working authentication flow.

## Signup and login state machine

Routes: Sign in, Create account, Verify email, Recover password, Set new
password, Complete required challenge, Invitation acceptance, and Account setup.
Preserve safe return paths, support popup blocked/canceled and redirect
fallback, and prevent open redirects. Use generic identity errors, bounded
retries/rate limits, clear field validation, password visibility, accessible
status and keyboard flow.

Registration admission is a server-owned deployment/runtime capability and must
also deny direct Cognito self-registration while closed. A hidden button is not
a gate. Expose only a public capability boolean and friendly closed-state copy;
never expose credentials. Existing users can always use the normal sign-in and
recovery paths unless separately suspended by existing policy. Do not bind the
login button to Stripe configuration or a billing outage.

When enabled, verify email and atomically provision the principal/personal
workspace before opening the dashboard. Retry after a partial failure resumes
that same onboarding identity. A rejected or unverified principal gains no
workspace authority. Keep registration default closed and live-commerce default
disabled until their independent acceptance gates pass.

AWS documents separate self-registration from login and supports registration,
verification/recovery and MFA through configured managed login. See
[user creation policy](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-admin-create-user-policy.html)
and
[signup confirmation](https://docs.aws.amazon.com/cognito/latest/developerguide/signing-up-users-in-your-app.html).
Pool capability and account-security changes require their own reviewed platform
configuration; this task does not activate them on AWS.

Initial top-up creation explicitly admits hosted card payments. Dynamic bank
payment methods stay off until failed delayed-payment recovery and operational
reconciliation have a reviewed workflow. Authenticated unpaid completion never
grants credits or unlocks a replacement charge; delayed successful evidence is
still handled safely by the worker. A completed unpaid attempt can require
operator reconciliation, so elapsed time alone cannot unlock it.

## Purchased credits and renewal implementation

Create an immutable versioned pack catalog with exactly the approved amounts.
The browser sends a pack key and idempotency key, never an authoritative amount,
credit quantity, currency, tenant or Stripe Price ID. The server resolves the
current authorized billing scope and pinned pack policy. Sandbox inline prices
are derived entirely on the server; unconfigured live mode fails closed.

Persist a one-time purchase attempt distinct from subscription checkout. Bind
workspace/billing account, verified buyer, pack/policy version, currency/amount,
provider mode, provider customer, session/payment reference and replay identity.
Use Stripe payment-mode Checkout and hosted URLs already admitted by the app.
The local account screen shows pack prices, non-expiration, total available
balance, pending payment and safe retry/reconciliation states. A separate
included-versus-purchased balance presentation remains follow-up work. A top-up
must not create, switch or cancel a subscription.

Fulfillment accepts only verified signed payment evidence and an exact server
readback bound to the purchase. Check paid status, expected pack/line items,
quantity, currency, amount, customer, mode and canonical tenant. Delayed payment
methods require async success before issuance. Insert a non-expiring purchased
grant and its immutable ledger event atomically, with uniqueness on the payment
and source reference so duplicate events and concurrent requests grant once.
Browser return never grants credits. Stripe documents this requirement in
[Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted).

Handle unpaid/expired sessions, out-of-order and duplicate events, signature
failure, stale policy, customer mismatch, refunds and disputes. Current local
refund/dispute handling flags manual reconciliation while preserving all
financial history. It does not automatically reverse grants or consume unrelated
credits. Final refund/debit tools and policy need review before live activation.
Monthly paid-period issuance/expiry remains the existing idempotent subscription
path. Prove mixed-grant allocation, renewal with a pending reservation, and
purchased-credit survival through cancellation and plan changes.

## Export and repository flow

From a saved immutable revision, choose Terraform or CloudFormation, and
optional application source separately. If users request both targets, show
independent readiness, job status and downloadable results. Disable only the
unsupported target with exact service/property issues and a route back to
configuration. A ready export binds graph/catalog/compiler/profile/artifact
versions and hashes. Selecting a language never invokes an authoritative AI text
translation.

Verify ZIP and GitHub exports for both targets with deterministic fixture
graphs, complete file inventory/checksums, Lambda artifact references,
failure/retry and revoked-access tests. GitHub export uses a reviewed branch/PR,
conflict detection, installation ownership and recent-auth requirements.
Preserve existing files outside the generated manifest; unknown ownership is a
review conflict.

The second provider uses the same provider-neutral review/manifest/job boundary,
with a provider-specific credential/network adapter. Start with GitLab.com;
self-managed arbitrary hosts require an explicit allowlist and SSRF/redirect
policy. Read a pinned commit, not a moving branch. Export a bounded file batch
to a new review branch with the exact starting commit, then create a merge
request. Never force-push, auto-merge, upload secrets, install CI or trigger
deployment. Resolve uncertainty by reading recorded provider identities before
retrying. Repository writes require the app user's explicit preview approval at
runtime.

## Import and application mapping flow

Offer Upload files/archive, Select connected repository paths, or Discover
infrastructure. Discovery lists a bounded exact-commit tree and lets users
review selected paths before body retrieval/AI use. Detect Terraform,
CloudFormation, SAM/CDK synthesized output and application roots, while
preserving unknowns. Report file count/size/path limits, ignored sensitive
files, links/submodules, unsupported modules/transforms and parse errors before
generating a proposal.

The deterministic parser produces observations with source locations and
coverage. A reviewed mapping layer translates supported observations into
versioned graph commands and stable imported identities. Show creates, existing
matches, unresolved references, ownership choices and all warnings. Require an
explicit apply step with draft version/edit lease; replay must not duplicate
resources. Never flatten modules or unknown expressions into invented resources.

Application analysis suggests handler/runtime/build root and workload placement
using exact infrastructure artifact bindings plus source evidence. Existing code
remains user-owned. Show one-to-many and ambiguous mappings, allow overrides,
and distinguish observed implementation from generated starter/source drafts. AI
can summarize and propose typed mappings over admitted content, but repository
README/AGENTS/prompt text has no instruction authority. No source execution,
package install, Terraform/CDK evaluation or credential scan against live
systems.

## Acceptance sequence

1. Verify the canvas/navigation correction and finish the coordinated refactor
   integration before calling this branch ready.
2. Introduce personal workspace and account/profile contracts, migrations and
   denied/cross-tenant tests. Implement organization/member lifecycle next.
3. Wire auth forms/challenges, public-registration gate and verified onboarding;
   keep activation disabled until all acceptance cases pass.
4. Add exact pack policy, one-time payment persistence/worker/UI and
   mixed-credit renewal tests; review refund/dispute policy and keep live mode
   disabled.
5. Verify both export targets and GitHub, then add the chosen second adapter.
6. Deliver observation-to-canvas import and explicit application mapping.
7. Execute the 50-family catalog plan as bounded evidence-backed slices,
   updating AI evaluations, configuration menus, connections, issues and
   export/import mappings in each slice.

Every stage has focused unit/contract tests, relevant browser/integration tests,
full repository checks and documentation/compatibility evidence. Hosted
identity, Stripe and repository acceptance remains a separate controlled test;
local fake success is never described as proof that deployed integrations work.

### Authentication implementation research (September 30)

Keep registration admission independent of billing and existing-user access.
Cognito's disabled self-registration rejects direct SignUp requests and removes
the managed-login signup link, so the eventual flag must configure the provider
as well as the app's public capabilities. See
[creation policy](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-admin-create-user-policy.html).

Cognito supports direct browser signup and recovery entry points with the same
parameters as authorization. Reuse the existing PKCE/state/session boundary;
confirmation and password-reset completion remain provider challenge flows.
These managed webpages are browser-only, not JSON API endpoints. See
[managed-login endpoints](https://docs.aws.amazon.com/cognito/latest/developerguide/managed-login-endpoints.html).

Custom self-service security forms require the appropriate token-authorized
Cognito operations and verification states. The existing runtime's exact scope
contract does not currently authorize that whole surface; changing it requires
versioned client/server/configuration agreement and its own review. App handles
must remain separate from immutable provider subject identity. See
[authorization models](https://docs.aws.amazon.com/cognito/latest/developerguide/authentication-flows-public-server-side.html).

The current stack explicitly selects classic hosted UI and optional MFA. The
current sign-in helper reopens authorization, but that alone does not prove a
fresh authentication timestamp. AWS documents `prompt=login` only for managed
login branding, not classic hosted UI. The security/auth slice must therefore
implement and verify a supported reauthentication flow; do not pretend that
adding this parameter to the current classic flow solves recent-authentication
requirements. Until then, an expired recent-auth window can require signing out
and signing in again. See the
[authorization endpoint](https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html).

For signed-in password changes, use the token-authorized
[ChangePassword operation](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_ChangePassword.html)
and its reserved self-service scope, with explicit credential errors and no
password logging/storage. TOTP setup is a staged provider interaction:
[associate](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_AssociateSoftwareToken.html),
[verify](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_VerifySoftwareToken.html),
then
[set preference](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_SetUserMFAPreference.html).
Keep the setup secret ephemeral and show MFA as enabled only after successful
verification and provider readback. Hosted login with optional MFA does not
itself provide every account-management control.

Email changes need `AttributesRequireVerificationBeforeUpdate` configured so the
old address remains usable until the replacement is verified; app profile names
and usernames remain separate from that provider-owned state. Implement pending
verification/resend/expiry and canonical readback without accepting a client
`email_verified` claim. See
[attribute verification settings](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-email-phone-verification.html).
These are researched requirements for the following slice, not activated
identity features.

## Local member lifecycle checkpoint

The local member implementation follows
[ADR 0071](../adr/0071-organization-membership-lifecycle.md). Owners can change
non-owner roles and transfer ownership to an existing active member;
administrators are limited to editor/viewer administration. Active members can
leave, subject to last-owner protection. Removal/leave retain membership IDs,
close pending offers and require a new bound invitation to rejoin. Legacy
administrative suspensions remain non-rejoinable. Exact versions, actor-bound
receipts, current authorization and explicit UI confirmation protect changes;
fresh readback determines current access. This does not change billing, move
projects or activate deployment. Final combined verification remains open.

Upcoming account security must distinguish provider revocation from local JWT
signature checks. AWS documents that an unexpired signed token can already be
revoked, and GlobalSignOut does not itself invalidate a classic/managed login
browser cookie. Define application session revocation and provider logout before
claiming sign-out-all-devices. Sources:
[JWT verification](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-tokens-verifying-a-jwt.html)
and
[GlobalSignOut](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_GlobalSignOut.html).

### Account session implementation in progress

Session revocation is implemented locally under proposed
[ADR 0072](../adr/0072-account-session-revocation.md). The Security page can
review ending a selected browser sign-in or all earlier CloudMarkup sessions,
with actor-bound retries and current admission readback. Ordinary API tokens now
check revocation; the database stores metadata and hashes only. Existing jobs
and requests admitted before revocation may finish. The workstream gates and
provider password/email/MFA/recovery and registration work remain open; this is
not deployed behavior.

### Branded account entry implementation

The local implementation follows
[ADR 0073](../adr/0073-branded-account-access.md). The account-access capability
view does not change the existing runtime auth contract. One infrastructure
input controls provider self-registration and its public display flag.
Registration is disabled; returning-user sign-in and recovery remain available.
Managed login v2, an additional self-service OAuth scope, CloudMarkup
logo/colors and verification before email replacement are local definitions.
Public signup/recovery routes preserve PKCE and safe return paths.
Provider-hosted rendering, real signup and email delivery remain unverified;
local browser tests use synthetic responses.

### Provider account management implementation

Password and verified-email controls are implemented locally under proposed
[ADR 0074](../adr/0074-account-credential-management.md); authenticator
enrollment/removal is wired locally under proposed
[ADR 0075](../adr/0075-staged-account-authenticator.md), with final verification
in progress. Bind each operation to the exact token verified by HTTP middleware,
current application session admission and recent authentication. Never accept
account identity or a replacement access token in the request body. Provider
transport must use an allowlisted fixed endpoint, bounded responses, timeouts,
sanitized errors and no automatic mutation retries after an uncertain outcome.

Use provider GetUser readback, matched to the existing subject mapping. Email
updates must retain the current address until provider verification completes.
Only synchronize a provider-verified address to the principal record; do not
change principal identity, memberships, schema version or profile edit version.
A staged TOTP flow must distinguish association, verification and enabling,
retain its setup secret only in memory, and confirm enabled status by readback.
A metadata-only principal audit must exclude passwords, codes, setup secrets and
tokens. Do not hold a database transaction across provider network calls.

The local Security forms use uncontrolled credential fields and clear them
before dispatch. A conditional account header prevents a tab that displayed one
account from submitting secrets after the active account changes; verified
authentication remains the only identity authority. Fresh sign-in never
resubmits a prior form.

Migration 0089 stores immutable attempt/outcome metadata with account-level
serialization, bounded attempts and session revocation checks. Provider errors
are sanitized, and an uncertain outcome disables further form submission until
explicit readback. Email confirmation updates only the verified address for the
existing provider subject. A password change does not promise to end existing
CloudMarkup sessions; the separate session controls perform that action. These
local controls have synthetic-provider and isolated PostgreSQL evidence, with
broader checkpoint verification recorded in the product execution plan. No real
provider change, delivery, registration opening or deployment is claimed.

### Authenticator and recovery configuration

The Security page stages association, code verification and enablement. The app
shows enabled status only after provider verification, preference change and
GetUser readback. Setup expires within ten minutes and verification is bound to
the original sign-in session. An enabled factor cannot be silently replaced.
Users must explicitly disable it before starting again. A lost setup key can be
cancelled and restarted; an uncertain attempt requires readback or expiry.
Disabling an authenticator does not end existing CloudMarkup sessions.

The setup key is shown only on the active setup page. It is never stored on the
server, in browser storage or in query/mutation caches. A code is cleared before
dispatch, and mutations never retry automatically. Migration 0090 adds only
metadata, with enrollment completion and its audit receipt committed atomically.

Infrastructure accepts an optional versioned `accountSecurity` input containing
`schemaVersion: 1` and `recoveryContact`: either null, an email contact
(`{kind: "email", value: "…"}`), or an HTTPS help URL
(`{kind: "url", value: "…"}`). The same validated configuration is emitted as
`CLOUDMARKUP_ACCOUNT_SECURITY`. Omission defaults to null and disables new
enrollment. No actual recovery contact has been supplied yet. Password recovery
does not remove MFA; a functioning support recovery process is still required.
No administrative MFA reset, live provider call or deployment is introduced.
