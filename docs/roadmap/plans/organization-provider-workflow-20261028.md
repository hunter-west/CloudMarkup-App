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
- [ ] (current) Release owner coordinates browser acceptance, exact integrated
      admission and authorized public submission before readiness.

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
