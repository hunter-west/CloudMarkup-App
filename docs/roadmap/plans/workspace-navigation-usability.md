# Restore clear workspace navigation after sign-in and reload

- Milestone: Existing hosted beta usability; no new product milestone.
- Workflows: Account entry, workspace selection, project navigation and handoff.
- Status: blocked (workspace selection repair merged; sidebar overflow verified
  locally; hosted post-deployment acceptance pending).
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
- [x] Remove unnecessary sidebar overflow while preserving access to long menus,
      wrapped labels, collapsed actions and keyboard focus.
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

The initial isolated branch was `fix/workspace-navigation-20261028`, based on
the public revision named above. The repair changes only web navigation, its
owning route and browser cases, styles, and this plan. AI creation and
support-menu source belong to their separate owners.

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

### Sidebar overflow follow-up

The workspace selection repair is merged in public main
`641ed0822598be162df2e67155e40484d67b5579`. The separate layout follow-up starts
from that exact revision on `fix/navigation-overflow-20261029`; it does not
repeat the selection implementation or touch AI/support account-menu ownership.

A current signed-in native Chrome observation still showed the earlier missing
workspace links and an unnecessary vertical scrollbar for a short menu. The
browser extension connection was absent, so no current DOM metrics or served
commit were obtained. A native collapse attempt was followed by a restored,
tablet-sized window and an open navigation drawer. Its desktop-collapse outcome
is unqualified; input stopped instead of assuming success. No sign-in request,
project/account/security change or deployment was performed.

Exact-main synthetic geometry isolated the false overflow: at 1440 by 900 the
short panel had client height 853 and scroll height 854. The header measured 49
pixels while navigation subtracted a fixed 48. With Chromium's default
`--hide-scrollbars` argument removed, the false vertical scrollbar consumed 15
pixels; collapsed navigation then had client width 55 and scroll width 56,
reproducing a horizontal scrollbar as well. These are local fixture
measurements, not live DOM measurements.

The layout uses the existing desktop viewport bound for all desktop shell pages,
separate header/menu grid rows, one vertical menu scroll region, and wrapped
labels. Collapsed padding leaves room for icons when a real vertical scrollbar
is needed. A first diagnostic iteration found that long-menu focus could scroll
the whole unconstrained standard page and hide the navigation header; extending
the existing desktop shell bound corrected that failure without weakening its
assertion.

The ignored diagnostic matrix combines four distinct states, each expanded and
collapsed: short light menu at 1366 by 768, short dark menu at 1440 by 900, full
light menu at 1920 by 1080, and full dark menu at 1280 by 720 with minimum
sidebar width and an unbroken synthetic long label. It checks zero
outer/horizontal overflow, no unnecessary short-menu scrollbar, focus access to
every link, a visible collapse control, and retained vertical scrolling for
genuinely long content. The default-scrollbar matrix passed in 18.7 seconds.
Logs and captures are outside source under `.cache/navigation-overflow/`.

Visible-scrollbar acceptance passed initially in 19.0 seconds and on the final
candidate in 54.7 seconds while browser types/lint/build verification also ran.
The existing navigation journey exposed collapsed visually hidden labels
escaping their menu's containing block at 520 pixels tall. Making navigation a
positioned containing block corrected the unchanged overflow/focus assertions;
the final eight-state run includes that containment fix. Failed diagnostic
captures/logs remain retained outside source.

The existing navigation/history/keyboard browser case is extended with those
scroll-owner and collapsed-link access assertions. Executable tracked case count
does not increase. This is criticality 8 coverage for a reported production
navigation regression; DOM geometry requires a real browser rather than a
duplicated React unit case. Its prior comparable standard-dev run took 19.3
seconds; the final modified case passed in 18.6 seconds, with no assertion or
timeout weakened. Final browser-test types, changed-file lint and the direct
production Vite build passed (10.17 seconds; an earlier build took 2.85
seconds). The release owner retains the combined full gate and post-deployment
live qualification.

The installed dependency set was reused: package manifest, workspace and
lockfile inputs did not change from the already-installed base. The default
Corepack cache attempted a registry download that could not resolve; local
verification uses the already-installed pinned tools directly, without changing
dependencies or ownership trust. Restricted localhost test startup stalled
before assertions and was stopped; the same local-only diagnostic succeeded in
the established owning execution context.

```powershell
node node_modules/@playwright/test/cli.js test --config config/playwright/typed-backend.config.ts desktop-dashboard.spec.ts --grep "keeps settings sections"
node node_modules/typescript/bin/tsc -p config/typescript/playwright.json --noEmit
node node_modules/eslint/bin/eslint.js apps/web/e2e/desktop-dashboard.spec.ts --max-warnings 0
node apps/web/node_modules/vite/bin/vite.js build apps/web
```

No dependency, authentication, tenant, graph, export, billing or security logic
changes. CSS bounds and link wrapping are verified in a browser; the existing
desktop navigation case additionally keeps page content actions reachable. No
new full suite was launched from this lane. `check:web`, integrated browser
admission and private hosted release admission remain with the release owner.

### Account menus and notification acknowledgement

This follow-up starts at public main `d2dd761903b192d3691c5601948a10b28df38d3f`
on `fix/account-menu-notifications`. It owns shared shell navigation and
tab-local notifications; organization/provider, billing, AI and catalog screens
retain their specialist owners. Preserve current styling, routes, permissions
and deployment safeguards.

The navigation map is **Project work** (Dashboard, Projects, Templates),
selected **Personal workspace** or **Organization** (Usage, Plans & billing,
authorized organization settings/member/integration links), then **Personal
account** (personal settings, invitations and **Personal & organizations**). The
directory switch includes both personal and organization destinations. Current
scope names are shown where verified; remembered selectors on account pages
receive a neutral **Selected workspace** label. Existing tour anchor keys remain
stable. The duplicate directory action is removed when no workspace has been
selected. Authorized staff account support is grouped with Help & support;
shared-device recovery stays with sign-out actions instead of personal settings.

The previous profile badge counted all retained history. It now counts unseen
items. Opening the profile acknowledges its existing badge items while leaving
Notifications' unread count intact. Opening Notifications marks its existing
history read; later arrivals remain new/unread and can be acknowledged with
**Mark all as read**. Explicit captured IDs prevent a concurrent arrival from
being consumed by an earlier acknowledgement. Toast dismissal, read state and
required actions remain independent; reading never deletes history or resolves
an error or other authoritative state.

This is an in-memory presentation contract only. History and acknowledgements
survive view/route remounts within their provider session. Reloads/new tabs have
independent histories, and existing actor-bound presentation providers reset on
identity changes. No content or read markers are written to browser storage, no
cross-session synchronization is claimed, and no backend/database migration is
needed. Reverting the web source restores the earlier presentation without
changing account or project data.

Acceptance requires retained unread/read distinctions, badge clearing on profile
opening, fresh badges for later arrivals, preserved error/toast records,
independent sessions, and accessible desktop/mobile dismissal and focus.

Focused evidence on this isolated source:

- Frozen installation used pinned Node 24.18.0 and pnpm 11.16.0. All 14 web
  dependency build tasks passed in 1m33.895s. The production Vite build passed
  in 2.66s, retaining its existing IIFE-name and large-chunk warnings.
- The four owning React suites passed all 68 cases in 52.23s: App, deferred
  routes, NotificationProvider and WorkspaceTour. The final additional
  route-retention assertion passed in the existing App scenario (20.26s focused
  run). NotificationProvider adds one case for captured-ID concurrency, retained
  error/toast records and independent sessions; the existing dismissal case now
  covers unseen versus unread state. This is criticality 8 protection for the
  reported persistent-badge regression. Browser executable case count is
  unchanged; existing cases cover the real modal/focus boundary rather than
  duplicating provider-state permutations. A same-command pre-change runtime was
  not measured.
- Nine selected browser cases passed across focused runs: desktop readability,
  navigation/history/overflow/keyboard access, both dashboard palettes,
  personal-to-organization navigation, desktop and phone account navigation, the
  320-pixel modal notification journey (27.1s) and the existing editor
  profile/notification/new-event regression (49.0s). No retries or assertion
  deadlines were increased. The mobile setup was corrected to navigate from
  account settings via primary navigation and to assert background controls
  after closing the modal, when they are accessible.
- Changed-file lint and formatting, web and browser-test types, documentation
  links and `git diff --check` passed. Their separate timings are unmeasured.
  Screenshots and diagnostic configuration remain ignored outside source.
- `security:check` passed its 12 policy/secret-scanner tests, static checks,
  content scan and registry audit. The unchanged dependency set has nine
  moderate advisories and none at the high-severity failure threshold.

Restricted test startup first failed before assertions on a Windows temporary
rename; a task-local temp directory resolved it. Loopback sockets required the
normal reviewed execution context for synthetic browser tests. These are
environment limits, not product failures or changes to security/access policy.

Implementation is ready for integration. The sole release owner owns the
combined `check:web`, selected browser profiles and `check:public` on the frozen
batch. Publication, merge, deployment and live acceptance remain separate; this
lane launches no PR/CI or AWS deployment independently.
