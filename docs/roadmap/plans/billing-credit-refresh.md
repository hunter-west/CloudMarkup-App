# Keep verified billing and credit state consistent

- Milestone: current application quality work
- Workflows: account creation, billing, AI credits, project export
- Status: blocked
- Owners: billing reliability owner; parent coordinates release

## Goals

- Refresh the scoped commercial cache when verified subscription authority
  changes.
- Preserve server-only payment, trial, credit and export admission decisions.

## Context

BillingWorkspacePage polls the authenticated billing workspace after Checkout.
CreditTopUpSection and editor/usage summaries have separate keys under the same
commercialSummary prefix. Before this fix a verified subscription transition
refreshed only Billing, leaving credit purchase eligibility and other cached
summaries stale. The existing return-status test checked polling without
checking that handoff. See
[billing architecture](../../architecture/BILLING_AND_USAGE.md).

## Constraints

- Exact public base c44c8026210d3c25d93e35d8991278a3891acb8e.
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
- [ ] (current) Parent/QA resolves broad web gate timeouts and completes
      coordinated browser and release qualification.

## Validation commands

```powershell
pnpm install --frozen-lockfile
pnpm exec vitest run --project web apps/web/src/features/billing/BillingWorkspacePage.test.tsx apps/web/src/features/billing/CreditTopUpSection.test.tsx apps/web/src/features/editor/EditorCreditBalance.test.tsx --maxWorkers=1
pnpm exec vitest run --project api apps/api/src/application/billing.test.ts apps/api/src/application/billing-operations.test.ts apps/api/src/billing-worker.test.ts apps/api/src/adapters/billing/stripe-billing-provider.test.ts apps/api/src/adapters/billing/stripe-top-ups.test.ts apps/api/src/production-billing-workspace.test.ts apps/api/src/production-commercial-reads.test.ts --maxWorkers=1
pnpm check:web
pnpm security:check
git diff --check
```

## Migration impact

None. No schema, public API, provider or historical accounting record changes.
Rollback restores the former cache behavior; canonical server state is
unaffected.

## Security impact

Refresh only the authenticated principal/organization commercial cache.
Redirects remain signals for read-only requests and cannot grant payment or
entitlement. Keep existing scope-change, denied/session and idempotency
regressions.

## Stopping condition

The existing verified return scenario proves current top-up eligibility and
credit state refresh without starting another payment, and polling stays
bounded. Focused tests and affected checks pass, or exact environment blockers
and owners are recorded. Local evidence does not establish hosted release
admission.

## Handoff

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
