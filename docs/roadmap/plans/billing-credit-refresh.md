# Keep verified billing and credit state consistent

- Milestone: current application quality work
- Workflows: account creation, billing, AI credits, project export
- Status: active
- Owners: billing reliability owner; parent coordinates release

## Goals

- Refresh the scoped commercial cache when verified subscription authority
  changes.
- Preserve server-only payment, trial, credit and export admission decisions.
- Make fresh workspaces discoverable for a first reviewed staff grant/trial,
  without provisioning from reads or adding staff authority.
- Explain personal versus organization billing and member coverage using
  existing verified summaries, while preserving the current visual design.

## Context

BillingWorkspacePage polls the authenticated billing workspace after Checkout.
CreditTopUpSection and editor/usage summaries have separate keys under the same
commercialSummary prefix. Before this fix a verified subscription transition
refreshed only Billing, leaving credit purchase eligibility and other cached
summaries stale. The existing return-status test checked polling without
checking that handoff. See
[billing architecture](../../architecture/BILLING_AND_USAGE.md).

## Constraints

- Original implementation base: c44c8026210d3c25d93e35d8991278a3891acb8e.
- Current focused acceptance base: merged PR5,
  641ed0822598be162df2e67155e40484d67b5579.
- Organization-member presentation base (October 30): verified public main
  d2dd761903b192d3691c5601948a10b28df38d3f, including the fresh-staff
  correction.
- Use synthetic fixtures only. No live balance, purchase, subscription, account,
  IAM, credential, deployment or approval changes.
- Browser ownership and integrated release remain with the designated owners.

## Non-goals

- Commercial-policy changes, automatic trials, pricing changes or provider
  upgrades.

## Checkpoints

- [x] Trace signup, trial/staff grants, subscription, top-up and export
      authority.
- [x] Fix verified subscription-to-credit cache handoff and extend its existing
      regression.
- [x] Run focused billing/web tests and affected checks; review complete diff.
- [x] Verify the fix is present in merged PR5 and refresh focused billing,
      credit, staff, onboarding and provider evidence at that exact source.
- [x] Reproduce FRESH-STAFF-01 against immutable 641ed082 source and implement
      the correction with current staff authority and native regressions.
- [ ] QA verifies the reviewed correction in the deployed candidate; release
      owner completes integrated and exact-release qualification.
- [x] Complete role-aware billing/Usage presentation and affected local checks
      for the October 30 UX batch.
- [ ] (current) Release owner integrates the frozen billing packet into the
      consolidated public UX batch; QA qualifies the deployed screens
      separately.

## Organization-member billing presentation (October 30)

This pass changes the existing billing, top-up and Usage screens. Global menus,
organization navigation and integrations remain with their assigned owners.
Cards, typography, CSS and payment providers retain their existing design.

The user model follows the existing tenant boundary: choose Personal workspace
for personal projects, or the named Organization for organization work. Plans
and credits belong to that selection. Organization membership does not attach
the organization's subscription to the person's personal projects or merge
credit pools. A paid organization member does not need to purchase a personal
subscription to use features covered in that organization, subject to their
role, available credits, service availability and operation admission.

| Scope or role                                                       | Existing read visibility                                                    | Existing payer/management boundary                                                                                 | Access and credit meaning                                                                                                                     |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Personal workspace owner                                            | Own plan, credit and subscription summaries                                 | Existing personal billing account/customer; owner manages hosted sessions                                          | Personal projects use this pool; organization work stays separate                                                                             |
| Organization owner/administrator                                    | Organization commercial summaries and existing restricted usage permissions | Existing organization billing account/customer; billing.manage plus recent application authentication for payments | Organization plan and shared credits apply here; role and entitlement checks still gate operations                                            |
| Organization editor                                                 | Organization commercial summaries                                           | No Checkout, Portal or credit-purchase authority                                                                   | Uses the organization's applicable features/shared budget; no personal purchase is required for covered organization work                     |
| Organization viewer                                                 | Organization commercial summaries                                           | No Checkout, Portal or credit-purchase authority                                                                   | Read access remains read-only; a paid plan does not grant editor or expensive-operation permission                                            |
| Multiple organizations                                              | Separate summaries for each current membership                              | Each organization retains its own billing account                                                                  | No automatic cross-organization or personal credit transfer, subscription inheritance or pool aggregation                                     |
| Independent trial or complimentary credits                          | Existing current-plan summary, distinct from paid subscription state        | Existing separately authorized staff action only                                                                   | A trial has recorded expiry/revocation; complimentary funding supplies its existing AI policy without a paid subscription or export privilege |
| Inactive subscription, suspended/closed account or disabled service | Verified status; failed/revoked reads withhold prior data                   | Existing server action flags remain authoritative                                                                  | Neither a personal purchase nor a plan label bypasses account state, service, role or credit checks                                           |

Evidence comes from
[canonical role permissions](../../../apps/api/src/application/authorization.ts),
[commercial request authorization](../../../apps/api/src/production-commercial-authorization.ts),
[billing summaries and hosted actions](../../../apps/api/src/production-billing-workspace.ts),
[top-up eligibility](../../../apps/api/src/production-credit-top-ups.ts),
[commercial reads](../../../apps/api/src/production-commercial-reads.ts), and
[the existing billing architecture](../../architecture/BILLING_AND_USAGE.md#commercial-authorization-policy-version-2).
The ordinary payment path operates on the selected organization's billing
account/customer, not a separate subscription for every member. Role-based
billable-seat candidates and plan limits already exist; they do not establish a
new per-seat price or authorize automatic charges on joining. Seat pricing,
personal sponsorship/credit transfer, different payer ownership and new access
permissions remain separate business-policy decisions and are not implemented.

Presentation changes use existing APIs only. account.workspaces.get supplies a
verified kind and name, bound to principal, tenant and role. Failed or
mismatched metadata cannot label another tenant as Personal or disclose its
name. Members see organization coverage and an owner/administrator contact path
rather than purchase buttons. Billing managers still require server canCheckout,
canManage and canPurchase flags. Top-up and plan cards distinguish personal from
shared organization credits. Usage labels the selected pool and links to Plans &
billing. Existing current-plan reads can show independent trial/complimentary
access without claiming a paid subscription; paid conversion or account
unavailability withholds stale independent-access presentation.

The initial three owning web suites passed all 43 cases in 18.87s before this
change. Nine cases were added in the existing billing suite: editor/viewer
coverage and purchase suppression (criticality 9), active trial/expired
trial/complimentary access distinctions (9), and tenant/principal/role metadata
or current-plan binding rejection (9). Existing personal-scope, switching,
revocation and late-response cases were extended. No test was removed, skipped
or given a broader timeout/retry allowance. The permission-loss case now proves
that a revoked billing capability hides Checkout and cannot issue a second
request while its late first response is discarded.

All 52 selected web cases have passing final evidence: the complete selection
passed in 23.00s (4.27s test bodies, versus 3.04s before). A later
pending-payment fixture refinement initially used an invalid top-up ID, which
strict parsing rejected; after correcting only the fixture to the existing
contract, all 33 billing cases passed in 7.86s. The other 19 owning cases retain
their passing results. There are no new production financial or authorization
rules. The 57 existing billing/commercial API cases passed in 6.22s, and the 60
existing app-level cases passed in 32.45s. This yields 169 distinct passing
Vitest cases across six suites; the timings are receipts, not a controlled
performance comparison.

Three existing synthetic Playwright journeys passed in 33.5s: credit-source
balance/expiry/denied refresh, and original-session preservation through
separate Checkout and Portal windows. They used an isolated loopback Vite port
and mocked APIs/payment documents. The initial sandbox listen EACCES was an OS
access error, not an approval denial; the supported approved run passed without
changing deadlines, assertions or retry policy. Its temporary configuration was
removed. Usage and billing screenshots were inspected; the current cards,
spacing, typography and palettes remain. The popup fixture does not supply a
successful top-up workspace response, so its top-up-unavailable notice is not
evidence about deployed top-up configuration or payment acceptance. Member-role
presentation has focused component evidence; deployed browser acceptance remains
with QA.

Web types, scoped lint, production web build (5.25s), formatting and diff checks
passed. Security checks passed 12 control cases, static verification and secret
scanning; dependency audit has nine moderate advisories and none at the
configured high threshold. No dependencies or public contracts changed. Raw
receipts and screenshots remain outside tracked source. No aggregate, CI,
hosted/provider or live account run is started by this owner.

Publication is coordinated with the release owner's single public UX batch
(codex/public-ux-batch-20261030). The initial coordination send returned an app
path error, and its outcome was checked read-only rather than blindly retried;
the global UX owner received the scope and publication constraint. The release
owner's recorded batch already includes this billing work. A reviewed feature
branch push does not trigger these workflows (both push profiles select main;
diagnostics are scheduled/manual), but an independent PR would start duplicate
CI. Consolidated PR creation remains with the release owner. Source publication
does not establish deployment or live acceptance.

Focused commands:

```powershell
node node_modules/vitest/vitest.mjs run --project web apps/web/src/features/billing/BillingWorkspacePage.test.tsx apps/web/src/features/billing/CreditTopUpSection.test.tsx apps/web/src/features/billing/UsagePage.test.tsx --maxWorkers=1
node node_modules/vitest/vitest.mjs run --project api apps/api/src/production-billing-workspace.test.ts apps/api/src/production-commercial-reads.test.ts --maxWorkers=1
node node_modules/vitest/vitest.mjs run --project web apps/web/src/App.test.tsx --maxWorkers=1
node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit
pnpm security:check
```

The browser command used the existing typed-backend configuration with only a
temporary loopback port/output override, selecting credit-overview.spec.ts and
the two "keeps the original app session when returning" cases in
typed-backend.spec.ts. No browser case or permanent configuration was added.

No public API or database contract changes. The prior fresh-staff correction
remains intact. Existing read and mutation authorization, recent sign-in,
idempotency and provider checks remain authoritative. No live account, balance,
grant, subscription or payment is read or changed for this pass.

## FRESH-STAFF-01 correction: local implementation

Staff with accounts.read can use additive staff-workspace reads to discover a
canonical unprovisioned workspace. Its version-2 preview has zero funds, no
subscription or trial, disabled operations and an ETag bound to the workspace's
record version. Existing staff-account operations retain version-1 wire
contracts and typed client request/response shapes. Action requests and
immutable receipts remain v1. The web reader uses the workspace reads and
explains first-action initialization before review.

Only the existing credits.grant or trials.grant permission can initialize the
empty account, within the same transaction as the reviewed grant/trial, ledger
and receipt. Read-only and operations-only staff cannot initialize it. Ordinary
organization owners remain denied. Recent application authentication, exact
target confirmation, original optimistic precondition, bounded amounts and
actor-bound idempotency still apply. The stable account identity is shared with
lazy Checkout. A competing initializer invalidates the old preview; audit
failure rolls back account creation as well as funding. No subscription is
created, and no staff, database-role or IAM permission is added.

The baseline proof ran the new first-grant scenario against the exact staff
implementation from 641ed082: it failed at the expected missing-account boundary
with "This billing account is unavailable." The temporary source/test copies
were removed. The corrected owning PostgreSQL suite has 26 cases, including five
new cases; its 21-case comparison passed in 25.82s. After the final
compatibility correction, staff and related Checkout persistence suites passed
all 43 cases in 78.00s, with 27.83s in test bodies. The HTTP, contract, staff
UI, billing workspace, OpenAPI and client selection passed 73 of 74 cases in
180.74s. Its sole failure was a new assertion that omitted middleware-added
actor metadata. After preserving all expected actor fields with a partial object
match, the exact HTTP suite passed all 23 cases in 41.88s. All 74 selected cases
therefore have passing final evidence. Import/transform load varied, so these
timings are evidence rather than a controlled performance comparison. After
registering both new reads under the existing principal boundary, the owning
authorization and staff HTTP suites passed all 37 cases in 6.95s. The final
selections cover 131 distinct passing cases across nine suites. Browser
collection found the three existing staff cases; none was executed by this
owner.

Final compatibility review rejected adding a query schema or widening the
response type on released account operations: either would break existing typed
callers. The correction instead adds two read-only workspace operations.
Existing account operations retain their exact request/response schemas. A
separate TypeScript compile of the client request-type regression passed; the
temporary compile configuration was removed.

Fourteen executable cases were added across existing owning suites: five native
financial/authorization/concurrency/rollback cases (criticality 10), two read
compatibility/fundless-contract cases (9), one HTTP preview-route case (9), and
two first-action UI review cases for credits and independently authorized trials
(8), and four strict-selector rejection rows (9). The existing client typing
case also pins the legacy account request and response shapes; existing HTTP
authentication/denial coverage now includes both new reads. The existing browser
fixture intercepts the new read paths while retaining the original action path;
its browser run remains with QA. Existing cases and assertions remain. No
deadlines or retry settings were weakened. An intermediate negative fixture
tried to mutate immutable personal workspace state; it was corrected to create a
suspended synthetic workspace directly, preserving the ownership guard.

Docker's original named-pipe error and the first sandbox loopback connection
error were OS access errors, not approval-review denials. Normal tool-approved
elevated calls succeeded. The PostgreSQL fixture used the repository's pinned CI
image, a dedicated named container, a random loopback-only port and bounded
resources; the release owner's existing container was left untouched. No live
account, grant, provider payment, subscription or access state was changed.
After native checks completed, the exact task-owned container ID and fixture
label were verified before its container and new volume were removed. No other
owner's fixture was changed.

Final API/web type checks, the API and web production builds, scoped lint,
regenerated OpenAPI verification and the owning security checks passed. The API
type guard initially caught missing authorization-registry entries for the two
new reads. Both now use the same principal boundary as existing staff routes;
canonical accounts.read authorization stays in the transaction adapter. The
owning authorization tests and final compile/build passed after that correction.
The four released staff path contracts are identical to immutable 641ed082; only
the two workspace GET paths are added. An earlier standalone staff UI run also
passed all 11 cases in 46.12s after lint-only test assertion corrections. The
security audit remains at nine moderate advisories with none at the configured
high-severity threshold; no dependency versions changed. No aggregate
application gate or CI run was started by this owner. The release owner retains
integrated public/hosted admission, protected-role qualification and deployment;
the designated QA owner retains browser acceptance. The previously delivered QA
handoff was not duplicated.

QA scenario 5 below now expects the fresh workspace to appear as an
unprovisioned preview. Search and detail reads must leave billing absent;
confirming the first authorized action on a synthetic workspace must initialize
and fund exactly once. The previous missing-candidate result is baseline
evidence, not the expected behavior of the corrected candidate. Browser and
deployed qualification remain with their designated owners.

## Earlier acceptance snapshot before the FRESH correction (2026-10-29)

The cache fix is merged in
[PR5](https://github.com/hunter-west/CloudMarkup-App/pull/5). Do not reimplement
it. The October 28 gate timeouts below are historical implementation receipts,
not a current gate failure for the merged candidate. This pass ran focused tests
only; aggregate, CI, deployed browser and provider qualification remain with
their existing owners. Source presence does not prove which build a hosted
browser is running.

| Feature                                        | Current source and focused evidence                                                                                                         | Remaining acceptance                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Verified billing refresh                       | Implemented in PR5; all 24 BillingWorkspacePage cases pass, including scoped credit refresh, bounded polling and no extra Checkout          | QA must observe the deployed revision before checking the new behavior                           |
| Available/reserved balance and funding buckets | Editor, top-up and credit-overview contract/reader fixtures pass; available excludes held credits and buckets reconcile to one snapshot     | Real PostgreSQL ledger projection and stable-workspace browser comparison                        |
| Monthly and purchased credits                  | Reviewed monthly allowance/expiry and purchased-credit payment validation have passing focused coverage                                     | Sandbox event delivery and durable exactly-once funding; no live payment test                    |
| Staff credits                                  | Current UI/API fixtures cover unsubscribed target review, scoped balance invalidation, retry identity, denied actors and suspended accounts | Real transaction/audit/rollback and target lookup on synthetic PostgreSQL                        |
| Subscription status                            | Current billing, invoice-period, provider-signature, Checkout and environment fixtures pass                                                 | Deployed mode/catalog/secrets/queue configuration and event processing                           |
| Credit top-ups                                 | Implemented; approved packs, stable retries, duplicate suppression, delayed/unpaid evidence and review state covered                        | Active-subscription eligibility is intentional policy; complete payment only in sandbox          |
| Staff search                                   | Implemented for existing billing accounts; canonical email search has an owning PostgreSQL scenario                                         | Fresh unprovisioned workspaces are excluded; see FRESH-STAFF-01 below                            |
| Independent trials and export eligibility      | Domain and contract cases pass for expiry, revocation, paid conversion and reviewed trial privileges                                        | SQL admission, queue/worker fencing and end-to-end export on synthetic fixtures                  |
| Staff/admin entry and reauthentication         | Account support is gated on accounts.read; sensitive mutations retain the ten-minute recent-authentication check                            | Existing Cognito application session/staff permissions; AWS SSO renewal does not establish these |

Focused results at the acceptance base: 350 API/domain/contract cases passed in
60.29s; 63 onboarding/provider/environment cases passed in 37.79s. The first
four-file web command passed 22 cases but its Billing worker failed to start
before loading that suite. After the concurrent API selection ended, the exact
Billing suite passed all 24 cases alone in 19.44s with the same single-worker
setting. The other three suites were then run separately and passed all 22 cases
in 39.93s. All 46 selected web cases therefore have clean focused passing
evidence; the first command's worker-startup failure is retained and is not a
product assertion failure. No test assertions, retry settings, timeouts or
dependency versions changed. At that earlier snapshot no synthetic database URL
or PostgreSQL binaries were configured. Docker inspection hit an OS named-pipe
access error; no database was started during that initial pass. The subsequent
approved synthetic reproduction and cleanup are recorded above. No live account,
balance, purchase, grant or subscription was changed.

## Baseline source defect at 641ed082: FRESH-STAFF-01

The following records the pre-correction defect and proposed remedy. The local
implementation and native proof above supersede its pending-source/native
status.

Source confirms a missing path for staff support of an unprovisioned workspace:

1. [Workspace creation](../../../apps/api/src/adapters/persistence/account-workspaces.ts)
   creates the tenant, roles, owner and audit, without a billing account. The
   [owning integration test](../../../apps/api/src/adapters/persistence/account-workspaces-postgres.integration.test.ts)
   explicitly expects no billing-account row. Cognito personal onboarding also
   creates no billing-account row.
2. [Staff account search](../../../apps/api/src/adapters/persistence/staff-accounts.ts)
   starts from organization_billing_accounts. Searching a new workspace's exact
   organization ID or member email cannot return that workspace without a row.
3. The ordinary runtime's
   [lazy provisioning entry point](../../../apps/api/src/production-billing-workspace.ts)
   is createCheckout; ordinary billing/credit reads intentionally do not
   provision. The staff API has no separate preparation operation. As a result,
   grants and independent trials are not reachable from Account support for this
   unprovisioned state through the current public-source flow.

At the initial audit snapshot this workflow limitation was source-confirmed; the
subsequent real PostgreSQL reproduction and correction are recorded above.
Hosted incidence remains unverified. It is not evidence that existing
provisioned accounts or staff grant accounting are broken. No production
workaround or live Checkout was attempted.

[ADR-0068](../../adr/0068-personal-and-organization-workspaces.md), which
remains Proposed, describes the current choice: "Billing retains the existing
lazy account provisioning path." Its current integration assertion also pins
that behavior. Do not silently initialize every account or mutate state from
search GETs. The proposed bounded follow-up is an explicit, audited staff path
that can discover a canonical unprovisioned workspace, review its identity, then
lazily initialize an empty billing account together with the authorized staff
action. It must create no subscription or automatic trial, preserve actor-bound
retry identity/target confirmation/recent authentication, and commit account,
grant and audit atomically. Contract handling for the unprovisioned preview
needs review with the workspace and release owners before changing the current
v1 shape.

The decisive synthetic reproduction is: create a fresh personal or organization
workspace, verify there is no billing row, search as staff by exact workspace ID
and exact projected member email, and record the missing candidate. Then, for a
reviewed fix, verify a single explicit staff action initializes/grants once,
concurrent retries cannot duplicate either row or grant, other workspaces remain
unchanged, and audit failure rolls everything back. Use no live account.

## QA acceptance scenarios

The designated QA owner runs the browser work; this owner opened no browser.
Record deployed source/build identity, mode, timestamp and organization scope
before interpreting results. Use synthetic tenants for payment, grant, trial and
export mutations. Reuse the existing typed browser fixtures in
credit-overview.spec.ts and staff-accounts.spec.ts rather than another aggregate
or CI run.

1. In the selected workspace's account menu, verify Usage and Plans & billing
   target that workspace. Account support appears only for accounts.read staff.
   Switch workspace and check every destination's scope.
2. In a stable synthetic workspace, compare editor available/reserved values,
   Usage buckets and the Billing top-up balance at compatible snapshot times.
   Monthly + purchased + other must equal available; held credit is excluded. A
   denied refresh hides stale amounts. Credit-summary GETs can reconcile expired
   reservations, so they are not inert live-account probes.
3. Apply a verified fixture subscription transition from not-subscribed to
   active. Credit/top-up eligibility refreshes without a new payment request. A
   return URL alone grants nothing; polling remains bounded and another
   workspace's cache stays unchanged.
4. In sandbox/fixtures only, exercise unpaid/delayed payment, verified paid
   payment, duplicate event and review/dispute state. Funding occurs exactly
   once after verification; purchased credits do not expire, monthly credits
   expire at their period boundary.
5. Search exact synthetic email, username and workspace/account ID. Review the
   canonical target. Include an unprovisioned fresh workspace as FRESH-STAFF-01;
   do not start a live purchase to make it searchable.
6. In fixtures only, grant with exact account confirmation, ETag, reason and
   stable retry key after recent authentication. Retry issues once, updates the
   selected balance and leaves the other workspace untouched. Verify audit
   failure rolls back and revocation affects only available selected-grant
   funds.
7. Customer owners cannot administer platform grants; credit-only staff cannot
   grant trials. A valid independent trial enables its reviewed export profile;
   expiry/revocation denies new export admission. Staff credit funding alone
   adds no subscription, trial or paid export privilege. Paid conversion cannot
   revive a trial.

Current focused commands use the installed pinned runner directly:

```powershell
node node_modules/vitest/vitest.mjs run --project web apps/web/src/features/billing/BillingWorkspacePage.test.tsx apps/web/src/features/billing/CreditTopUpSection.test.tsx apps/web/src/features/editor/EditorCreditBalance.test.tsx apps/web/src/features/staff/StaffAccountsPage.test.tsx --maxWorkers=1
node node_modules/vitest/vitest.mjs run --project api --project contracts --project api-contract apps/api/src/application/billing.test.ts apps/api/src/adapters/billing/stripe-top-ups.test.ts apps/api/src/adapters/billing/stripe-invoice-period.test.ts apps/api/src/production-billing-workspace.test.ts apps/api/src/production-commercial-reads.test.ts apps/api/src/modules/staff-accounts.test.ts packages/domain/src/commercial.test.ts packages/domain/src/credit-plans.test.ts packages/domain/src/staff-trial-policy.test.ts packages/api-contract/src/credit-overview.test.ts packages/api-contract/src/staff-trials.test.ts --maxWorkers=1
node node_modules/vitest/vitest.mjs run --project api apps/api/src/adapters/identity/beta-cognito-principal-directory.test.ts apps/api/src/modules/account-workspaces.test.ts apps/api/src/adapters/billing/stripe-billing-provider.test.ts apps/api/src/adapters/billing/stripe-checkout-session.test.ts apps/api/src/production-billing-environment.test.ts --maxWorkers=1
```

## Historical implementation validation commands (2026-10-28)

```powershell
pnpm install --frozen-lockfile
pnpm exec vitest run --project web apps/web/src/features/billing/BillingWorkspacePage.test.tsx apps/web/src/features/billing/CreditTopUpSection.test.tsx apps/web/src/features/editor/EditorCreditBalance.test.tsx --maxWorkers=1
pnpm exec vitest run --project api apps/api/src/application/billing.test.ts apps/api/src/application/billing-operations.test.ts apps/api/src/billing-worker.test.ts apps/api/src/adapters/billing/stripe-billing-provider.test.ts apps/api/src/adapters/billing/stripe-top-ups.test.ts apps/api/src/production-billing-workspace.test.ts apps/api/src/production-commercial-reads.test.ts --maxWorkers=1
pnpm check:web
pnpm security:check
git diff --check
```

## Migration impact

No database migration is needed; no columns, grants, subscriptions or historical
ledger records are rewritten. Versioned read previews use additive staff
workspace GET operations. Existing v1 reads, typed client calls and v1
action/receipt shapes stay compatible. Older runtimes can read accounts
initialized by this correction; rollback hides unprovisioned workspaces again
without changing financial history.

## Security impact

Refresh only the authenticated principal/organization commercial cache.
Redirects remain signals for read-only requests and cannot grant payment or
entitlement. Keep existing scope-change, denied/session and idempotency
regressions. Staff preview and initialization retain canonical platform
permissions and add no staff enrollment or IAM capability. Native negative cases
verify that denied, stale, wrong-target and suspended-workspace actions leave
billing unprovisioned. Accounting and immutable audit share initialization's
transaction.

## Stopping condition

The verified return regression remains green, and the first-action regressions
prove read-only discovery, authorization, exact targeting, optimistic conflicts,
concurrent retries and atomic audit/accounting rollback. Affected focused checks
pass, or exact blockers and owners are recorded. Local evidence does not
establish hosted release admission; the release owner owns integrated gates.

## Historical implementation receipt (2026-10-28)

Audit confirms no automatic signup trial; audited staff grants can fund AI only;
paid or valid independent trial authority gates exports. Stripe event processing
retrieves current provider state, verifies mode/catalog/ownership and uses
durable receipts and period grants. Hosted activation and secure recent
authentication remain separately controlled. No live account was read or
changed.

The existing return test now verifies refreshed purchase eligibility, available
credits, isolation of another organization's cache, bounded polling and no extra
payment request. This is criticality 8/10 for the
subscription-to-funded-workflow handoff; no cases were added or removed.
Existing scope-change, return-forgery, uncertain retry and duplicate-click
coverage remains. The focused three-file web selection passed 37 tests in 21.46
seconds; a comparable pre-change full focused runtime was not measured. API
billing fixtures passed 221 tests in 51.26 seconds,
staff/Checkout/invoice/environment fixtures passed 131 in 16.57 seconds, and
domain entitlement/plan-mapping fixtures passed 89 in 11.71 seconds. No live
payment was used. PostgreSQL acceptance is not claimed: this checkout has no
configured synthetic test database URL.

The first broad web-check session was lost during environment disconnection; its
outcome was uncertain and was not counted as passing. After recovery, web lint
and all 15 type-check tasks passed. Fresh-checkout editor collection then failed
because compiled provider exports were absent. The invalid test process was
stopped after verifying its checkout identity. `pnpm build:web` supplied the
prerequisites and passed all 15 build tasks in 1m45.657s; generated outputs
remain untracked/ignored.

The subsequent complete `pnpm check:web` test stage ran 192 files and 1,658
tests in 262.11s: 190 files/1,655 tests passed, with three five-second timeouts
in unchanged editor suites. The two cases in `EditorExperience.test.tsx` concern
walkthrough restart and permission teaching; the case in
`EditorWorkspace.networking.test.tsx` concerns collapsed VPC connection dialogs.
The exact two suites then passed all seven tests with one worker and unchanged
timeouts in 46.14s. This is consistent with resource contention but does not
prove the full gate clean. No timeouts, retries or test assertions were
weakened. Parent/QA must resolve or qualify the broader gate on the integrated
candidate; the release owner retains `check:public`, PostgreSQL and
exact-release admission. Browser/e2e acceptance remains with the designated
browser owner, and no Chrome session was touched. Hosted activation is
separately qualified under [public source status](../../PUBLIC_STATUS.md).

Security checks passed: static controls, secret scanning and dependency audit at
the configured high-severity threshold. The audit reports nine moderate
advisories. Formatting and diff whitespace checks passed. No dependency versions
changed. There are no public API, database, pricing or Stripe configuration
changes. Tax configuration/registration readiness was not verified or changed.

Recent authentication for sensitive billing and staff mutations is ten minutes
by default; this requirement remains intact. No reauthentication or live action
was attempted. The credit-overview read currently calls expired-invocation
reconciliation, so a live no-mutation balance audit must account for that side
effect rather than assuming every GET is inert. No such live read was made.
