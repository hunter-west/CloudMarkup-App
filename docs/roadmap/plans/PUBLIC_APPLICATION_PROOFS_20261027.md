# Public application proof ownership

- Milestone: public source release
- Workflows: application build, native generation, local setup
- Status: active
- Owners: CloudMarkup release

## Goals

- Run application tests and public-safe native packaging on CloudMarkup-App's
  standard public runners.
- Make the successful main-push proofs usable as exact-source evidence for
  separately controlled hosting.

## Context

The public source CI already runs builds, contracts, backend, browser, local
setup and security checks. Native normalization, memory isolation and actual
candidate ZIP proofs remain in private runner workflows despite using public
application code.

## Constraints

- The native workflow runs only for public `main` pushes, with read-only
  repository permissions and pinned actions.
- It accepts no fork artifact, secret, cloud credentials or deployment
  authority.
- The private release must independently verify source archive, manifest, tree
  and private hosting inputs.

## Non-goals

This change does not prove hosted AI, enable application deployment from
generated code, change AWS permissions or reduce the existing public source
checks.

## Checkpoints

- [x] Add public native workflow and verify trigger, action pins and static
      security policy.
- [ ] (current) Run protected public CI and native workflow on an exact merged
      revision.
- [ ] Bind the separately controlled hosted admission to that exact successful
      revision, then remove private application suite replay.

## Validation commands

```powershell
pnpm security:static
pnpm security:secrets
pnpm exec prettier --check .github/workflows/public-native.yml scripts/security/public-source-static.test.mjs docs/roadmap/plans/PUBLIC_APPLICATION_PROOFS_20261027.md
```

## Migration impact

No data or schema migration. An unsuccessful native proof blocks hosted source
admission. Reverting this workflow change restores the prior release evidence
path until hosted workflow updates are qualified.

## Security impact

The public workflow uses a standard ephemeral runner with no credentials or
write permissions. Native scripts create only synthetic artifacts. Hosting must
reject any untrusted PR or mismatched public-main result.

## Stopping condition

The public main-push source and native jobs pass for the same exact revision,
and hosting's separate source-bound gate admits only those results. Stop if the
native host check fails or the private Actions cap blocks required hosted
admission.

## Handoff

The public workflow and local static tests are prepared. Hosted workflow changes
remain separate until public exact-head proof succeeds.
