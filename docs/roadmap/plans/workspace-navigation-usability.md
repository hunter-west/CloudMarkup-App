# Restore clear workspace navigation after sign-in and reload

- Milestone: Existing hosted beta usability; no new product milestone.
- Workflows: Account entry, workspace selection, project navigation and handoff.
- Status: blocked (navigation repair verified locally; hosted acceptance needs
  the supported Chrome connection).
- Owners: Navigation/browser owner; release admission and deployment remain with
  the sole release owner.

## Goals

- A user with one verified workspace can reach Dashboard and Projects
  immediately from account pages.
- A returning tab retains its explicitly selected workspace after reload, only
  while the current principal and membership still match.
- Users with an ambiguous workspace choice see a clear chooser instead of
  unexplained missing destinations.
- Record authenticated journey acceptance separately from source checks and
  deployment claims.

## Context

The live Workspaces page reproduced a navigation failure after reload: the
authorized workspace remained listed, but workspace links disappeared until its
dashboard was opened. `useNavigationOrganizationId` retained the selected
workspace only in React state. Work begins at public application revision
`c44c8026210d3c25d93e35d8991278a3891acb8e`.

The product's
[account requirements](../../product/POST_BETA_ACCOUNT_AND_REPOSITORY_REQUIREMENTS.md)
separate personal and organization workspaces.
[Public status](../../PUBLIC_STATUS.md) separates source qualification from
hosted activation.

## Constraints

- Tenant routes and API calls continue to authorize against the current verified
  principal.
- Browser storage is an optional, untrusted navigation hint, never tenant
  authority.
- Preserve existing projects, permissions, routes and account/security/billing
  settings.
- No paid AI calls, payments, invitations, account creation or deletion in
  acceptance.
- One browser owner drives the connected PC; AI, generated application builds
  and integrations have separate specialist owners.

## Non-goals

- New workspace provisioning, automatic organization creation, tenant migration
  or expanded permissions.
- Merge, deployment, PR review approval or replacement of the release owner's
  integrated gate.

## Checkpoints

- [x] Reproduce the live failure and inspect the current public-source
      navigation boundary.
- [x] Implement and verify safe workspace navigation defaults, reload recovery
      and an explicit chooser.
- [ ] (current) Complete the permitted signed-in journey checks when supported
      browser control is available; record untested paths and owners.

## Validation commands

```powershell
pnpm install --frozen-lockfile
pnpm exec vitest run --project web apps/web/src/App.test.tsx --pool forks --maxWorkers 1 --no-file-parallelism
pnpm exec eslint apps/web/src/App.tsx apps/web/src/App.test.tsx apps/web/src/shell/AppShell.tsx --max-warnings 0
pnpm exec eslint apps/web/e2e/desktop-dashboard.spec.ts --max-warnings 0
pnpm --filter @cloudmarkup/web type-check
pnpm exec tsc -p config/typescript/playwright.json --noEmit
pnpm build:web
pnpm exec playwright test --config config/playwright/typed-backend.config.ts desktop-dashboard.spec.ts --grep "keeps settings sections"
pnpm security:check
git diff --check
```

Reuse the existing route suite for first-entry desktop/phone navigation,
account-route isolation, multi-workspace ambiguity, reload restoration, changed
memberships and another principal. Existing synthetic browser coverage
complements manual desktop/collapsed live observations; it does not establish
live mutation/export acceptance. The release owner owns any still-pending
integrated profile. After the specialist patches settle, the sole release owner
runs one integrated `check:web` / selected `check:e2e` and public admission;
this task does not duplicate those full suites.

## Migration impact

No product data, API or database migration. A new tab-session preference stores
only the explicitly selected principal/workspace/membership selectors. Missing,
malformed, unavailable or stale storage falls back to current verified context
or the chooser. Rollback ignores this optional hint.

## Security impact

No new permissions or tenant data access. A hint is resolved against both
principal identity and current membership before creating return links. Route
authorization is unchanged. Tests retain no invented tenant for ambiguous
accounts and ensure account pages do not fetch tenant data merely to show return
links.

## Stopping condition

The navigation repair has focused passing evidence and a reviewed isolated diff;
live acceptance names tested versus untested paths. Stop browser or shell
actions on a disconnected environment or denied operation, preserve evidence,
and continue independent work where possible. Do not claim the source patch is
deployed.

## Handoff

The isolated branch is `fix/workspace-navigation-20261028`, based on the public
revision named above. The repair changes only web navigation, its owning route
and browser cases, styles, and this plan. AI creation and support-menu source
belong to their separate owners.

Local evidence uses pinned Node 24.18.0 and pnpm 11.16.0:

- Frozen dependency installation and all 15 web/dependency build tasks passed;
  Vite completed in 27.65 seconds (complete build profile 5m59.595s under
  concurrent PC load).
- The existing App route suite passed all 60 cases in 78.24 seconds. No new
  executable case was added: existing first-entry desktop/phone, account-route,
  ambiguity and revocation cases were extended. The known workflow regression is
  criticality 8; principal/membership binding is criticality 10. A comparable
  pre-change focused runtime was not measured.
- Web and browser-test types, changed-file lint, formatting, 330-document link
  validation and `security:check` passed. The dependency audit reports nine
  moderate advisories and none at its high-severity failure threshold.
- The existing Chromium navigation case passed in the standard dev profile (19.3
  seconds) and a local production preview (58.6 seconds). It covers first entry,
  a real page reload, Dashboard/Projects links, settings/history/focus, and
  Projects access from collapsed navigation. The case count remains one; no
  timeout or assertion was weakened. It records no API mutations.

The first dev attempts stopped at a pending Templates lazy-module load within
the existing five-second assertion deadline. This did not recur in the compiled
preview or final isolated dev run after competing full suites completed; that
correlation does not establish a conclusive performance root cause. An initial
production-preview attempt omitted the production authentication fixture and
showed API unavailable. The passing preview uses the existing
`desktop-resolution-qa.spec.ts` local session boundary, with external requests
blocked, through an ignored diagnostic wrapper. Logs and screenshots are kept
under `.cache/navigation-qa/` and `test-results/typed-backend/`, outside source.

Live reproduction confirmed an authenticated owner and a listed authorized
workspace: links were present after dashboard selection, then vanished on
reloading the account Workspaces route. The latest supported browser inventory
shows Chrome running but no connected Chrome extension. A presentation-only Show
Navigation attempt previously timed out; reobserve its current state before any
further input. Full signed-in account/credits/canvas/tutorial/export acceptance
and post-deployment retesting remain pending; inaccessible paths are not being
classified as missing implementation. No production identifiers or customer
architecture are retained in this plan.
