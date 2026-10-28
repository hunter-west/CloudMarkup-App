# Current workspace and repository connection access

- Milestone: Account-to-export workflow quality
- Workflows: Personal workspaces, organization membership, repository connections
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
- [ ] (current) Restore an execution environment, build prerequisites, run focused
      tests and affected web/security checks.
- [ ] Coordinate browser acceptance and integrated admission with the release
      owner before readiness.

## Validation commands

```powershell
pnpm install --frozen-lockfile
pnpm --filter @cloudmarkup/web prepare:workspace
pnpm exec vitest run --project=web apps/web/src/features/settings/GitHubIntegrationSettings.test.tsx apps/web/src/features/settings/GitLabIntegrationSettings.test.tsx apps/web/src/features/settings/PersonalIntegrationSettings.test.tsx apps/web/src/features/settings/VerifiedWorkspaceIntegrationSettings.test.tsx --maxWorkers=1 --no-file-parallelism
pnpm check:web
pnpm security:check
git diff --check
```

Changed-file formatting must be checked again on the final draft commit.
The release owner coordinates browser and full admission. Local synthetic UI
evidence cannot establish live-provider acceptance.

## Migration impact

None. Existing contracts, SQL, tenant records, grants and approvals are untouched.
Reverting the UI change requires no data movement or permission change.

## Security impact

Require successful connection metadata before rendering retained repositories or
continuing a pending OAuth relay. Existing allowed, initial-denial, actor and
tenant binding coverage remains. Three new cases cover cached GitHub repository
access followed by denial or another tenant's metadata, and pending GitLab OAuth
followed by denial (criticality 8/10 each). They reuse their owning suites at the
lowest useful UI layer; no new test file or duplicate browser scenario is added.
Focused baseline runtime is unmeasured.

## Stopping condition

Focused tests and affected web/security checks pass, the final diff is reviewed,
and pending browser/release admission has an owner. Keep this draft blocked when
execution or reviewed provider setup is unavailable; do not infer activation
from source completeness.

## Handoff

Frozen dependency installation passed using Node 24.18.0 and pnpm 11.16.0.
Prettier completed for the four local source/test files. The initial focused
Vitest invocation stalled at Windows worker startup and was stopped without a
test result. The workspace prerequisite build started but the Windows execution
environment disconnected before its terminal outcome was received. Its result
and process cleanup are uncertain and must be checked before another run.

The connected repository API preserved the same bounded edits and regression
cases from the public baseline in this draft after the runtime was lost. This
reconstruction has no passing test, build, type, lint, security or browser receipt.
No private operations source or activation identity was copied into public code.
