# Current workspace and repository connection access

- Milestone: Account-to-export workflow quality
- Workflows: Personal workspaces, organization membership, repository
  connections
- Status: blocked
- Owners: Organizations and provider integrations workstream

## Goals

- Keep private personal workspaces distinct from shared organizations.
- Withhold retained repository details and pending authorization when a current
  provider connection check fails.
- Let users refresh GitHub status explicitly from settings.
- Use distinct personal/organization labels and enumerate supported repository
  providers, with Bitbucket explicitly unavailable in both contexts.

## Context

Source baseline: public application commit `c44c802`. Explicit personal
ownership, organization creation, recipient-bound invitations and membership
lifecycle routes/UI exist. GitHub installations are workspace-owned. GitLab
OAuth grants remain actor-owned inside one workspace; membership does not
delegate another person's grant. See
[workspace ownership](../../adr/0068-personal-and-organization-workspaces.md),
[membership lifecycle](../../adr/0071-organization-membership-lifecycle.md), and
[GitLab lifecycle](../../adr/0077-gitlab-oauth-and-reviewed-repository-export.md).

GitHub's selected repository panel could read retained successful query data
after a refresh failed. Both provider panels could retain a pending OAuth link
and callback listener after connection checks failed. Initial-response denial
tests did not cover these successful-access-to-denial transitions.

## Constraints

- Server-side current tenant, actor and provider authorization remain mandatory.
- Preserve all wire contracts, stored grants, migrations and export approvals.
- No provider activation, OAuth registration, credentials, new permissions,
  customer-repository writes, merge or deployment.
- Onboarding and global navigation stay with their assigned owners.

## Non-goals

Shared GitLab grants, new provider implementations, membership policy changes,
provider-native acceptance and release admission.

## Checkpoints

- [x] Audit public workspace, membership and provider boundaries.
- [x] Implement current-connection checks and GitHub reload in the two panels.
- [x] Extend the existing suites with three regression cases.
- [x] Restore execution, build prerequisites, run focused tests and affected
      web/security checks, and review the full diff.
- [x] Clarify the personal/organization directory and integration context; add
      matching disabled Bitbucket cards without changing provider authority.
- [x] Qualify the presentation follow-up with its owning suites, changed-file
      lint/formatting, web typing/build and security checks.
- [ ] (current) Release owner coordinates consolidated publication, browser
      acceptance and exact integrated admission before readiness.

## Validation commands

```powershell
pnpm install --frozen-lockfile
pnpm --filter @cloudmarkup/web prepare:workspace
pnpm exec vitest run --project=web apps/web/src/features/settings/GitHubIntegrationSettings.test.tsx apps/web/src/features/settings/GitLabIntegrationSettings.test.tsx apps/web/src/features/settings/PersonalIntegrationSettings.test.tsx apps/web/src/features/settings/VerifiedWorkspaceIntegrationSettings.test.tsx --maxWorkers=1 --no-file-parallelism
pnpm lint:web
pnpm type-check:web
pnpm test:web --maxWorkers=1 --no-file-parallelism
pnpm build:web
pnpm security:check
git diff --check
```

The four web commands are the existing `check:web` constituents, with one test
worker to bound the local run. The release owner coordinates browser and full
admission. Local synthetic UI evidence cannot establish live-provider
acceptance.

## Migration impact

None. Existing contracts, SQL, tenant records, grants and approvals are
untouched. Reverting the UI change requires no data movement or permission
change.

## Security impact

Require successful connection metadata before rendering retained repositories or
continuing a pending OAuth relay. Existing allowed, initial-denial, actor and
tenant binding coverage remains. Three new cases cover cached GitHub repository
access followed by denial or another tenant's metadata, and pending GitLab OAuth
followed by denial (criticality 8/10 each). They reuse their owning suites at
the lowest useful UI layer; no new test file or duplicate browser scenario is
added. Focused case count increased from 43 to 46; observed focused runtime was
18.18 seconds (2.74 seconds in tests). Comparable baseline timing is unmeasured.

## Stopping condition

Focused tests and affected web/security checks pass, the final diff is reviewed,
and pending browser/release admission has an owner. Local verification is
complete. Keep release readiness pending coordinated browser and exact-source
admission; do not infer provider activation from source completeness.

## Handoff

### Personal and organization presentation follow-up

The October 30 follow-up starts at public main `d2dd7619`. The directory is
"Personal & organizations"; its cards retain their existing dashboard/settings
routes. "Personal workspace" denotes private projects, "Organization" plus its
name denotes shared projects, and "Personal account" denotes profile, sign-in
and preferences. Global menu grouping and billing presentation have separate
owners; existing route IDs and tour anchors stay unchanged.

Both verified integration contexts enumerate GitHub, GitLab and a disabled
"Coming soon" Bitbucket card using the existing card styles. Other repository
providers cannot be added. GitHub's selected installation may be shared within
the organization under existing authorization; GitLab remains member-owned and
cannot be borrowed by other members. Current service failures still withhold
connection controls. A placeholder does not register a provider, authorize a
grant, or imply that import/export is active.

The four existing integration suites pass 46/46 before presentation changes
(79.62 seconds overall; 4.43 seconds in tests). Reuse those cases to check that
Bitbucket is disabled, makes no request and stays behind verified context. No
new test case, provider route, wire contract, dependency, credential, activation
flag, style rule or global menu change belongs to this follow-up.

The six owning integration/directory/creation suites pass 59/59 in 27.29
seconds. After final JSX escaping and creation-status copy corrections, the two
affected suites pass 16/16 in 23.38 seconds; this is a subset rerun, not an
additional case count. Changed-file typed lint passes with zero warnings after
correcting the unescaped apostrophe reported by its initial invocation; no rule
or assertion is weakened. Web typing and all 15 build tasks pass (13 cached;
10.898 seconds), with the existing chunk-size warning retained. Security passes
12 static cases and a scan of 3,909 text files with eight explicit binary skips;
dependency audit reports nine moderate and no high/critical advisories.
Formatting, three local plan links and whitespace checks pass. The test
selections/cache states differ, so the timings do not establish a speed
improvement. Full web/public/private gates and browser acceptance remain with
the release and QA owners.

### Earlier provider recovery evidence

Frozen installation passed using Node 24.18.0 and pnpm 11.16.0. The original
focused run was stopped without results; the original build lost its terminal
receipt when Windows disconnected. Public candidate `1988e9bd` preserved the
bounded edits. Those original interrupted receipts are not passing evidence.

Execution was restored on October 28 at 13:17 UTC: a harmless read returned the
expected checkout and confirmed it existed. The original session could not be
resumed. An elevated check found no matching checkout Node runner or listener on
the repository's browser-test ports. Original local edits remain in a named
stash; validation checked out exact candidate `1988e9bd` before corrections.

Restored verification, with raw logs retained outside tracked source:

- Workspace preparation: 14 successful build tasks, 162.52 seconds.
- Focused provider/workspace suites: 46/46 tests in four files, 18.18 seconds.
- Initial formatting found two files; Prettier corrected them locally. Typed
  lint then rejected a redundant boolean comparison in the new GitHub guard.
  Removing it preserved the predicate and the lint rule. The original failed
  formatting/lint logs remain; no assertion, rule or timeout was weakened.
- Corrected `lint:web`: passed in 172.00 seconds.
- `type-check:web`: 15 successful tasks, 301.70 seconds.
- Complete single-worker `test:web`: 1,661 tests / 192 files passed in 575.72
  seconds (577.66 seconds including command overhead). No full-suite rerun was
  started after the resource-coordination handoff.
- `build:web`: 15 successful tasks, 8.85 seconds including command overhead.
  Vite retained its chunk-size warning; no limit or build policy was changed.
- Final `security:check`: passed in 307.74 seconds. Eleven static cases passed;
  the secret scan covered 3,901 text files and explicitly skipped eight binary
  inputs. Registry audit reported nine moderate advisories and no high/critical
  advisory. Dependencies and permissions are unchanged.
- Changed-file formatting, local documentation links and whitespace checks pass.
  Full provider diff review found no unrelated source changes.

This local handoff contains the formatting and redundant-comparison corrections;
the already-published candidate is preserved without another public mutation.
Public PR creation was not retried. Parent obtains specific submission authority
after validation. No private operations source, credential, activation identity,
grant or permission change was copied into public code. Browser acceptance and
integrated public/private release gates remain with their assigned owners; no
live-provider, merge or deployment evidence is claimed.
