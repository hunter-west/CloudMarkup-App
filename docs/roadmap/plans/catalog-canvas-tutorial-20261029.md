# Catalog, canvas configuration and tutorial verification

- Milestone: M9 controlled beta
- Workflows: service creation/configuration, connections, validation, onboarding
- Status: complete
- Owners: catalog/editor workstream; integrated admission and live acceptance
  remain with their assigned owners

## Goals

- Audit current catalog discovery/icons, explicit defaults/custom settings,
  nested placement, typed connections, validation and tutorial behavior.
- Repair reproduced defects with bounded changes and focused regressions.
- Distinguish local implementation evidence from live acceptance and hand off
  exact browser scenarios.

## Context

Public main was independently verified as
`641ed0822598be162df2e67155e40484d67b5579` on October 29. This work uses an
isolated checkout and existing matching-lockfile dependencies. The public
[status](../../PUBLIC_STATUS.md) and
[shared presentation decision](../../adr/0018-shared-editor-presentation-and-assistance-only-modes.md)
remain authoritative. The
[mode specification](../../design/GUIDED_AND_PROFESSIONAL_MODES.md) records the
existing Guided next-action exception.

## Constraints

- Semantic changes must use the existing domain command pipeline.
- Preserve permissions, public contracts and explicit review of generated
  changes.
- The browser acceptance owner has exclusive control of the live browser.
- No dependency installation, broad aggregate/CI run, deployment, paid
  inference, provider activation, executor activation or budget changes in this
  workstream.

## Non-goals

AI proposals, billing/admin, provider integrations, export implementation and
release publication are owned separately.

## Checkpoints

- [x] Inspect source and existing coverage; run bounded baseline checks.
- [x] Reproduce and repair confirmed defects, retaining regression evidence.
- [x] (current) Review changes, seal delivery and hand off local proofs/live
      scenarios.

## Validation commands

The final focused selection uses the original five-second test deadline:

```powershell
node node_modules/vitest/vitest.mjs run --project=web apps/web/src/App.test.tsx apps/web/src/features/editor/EditorExperience.test.tsx apps/web/src/features/onboarding/WorkspaceTour.test.tsx -t 'converts the Catalog and retains the Inspector popup across a desktop transition|resets an active walkthrough and restarts Professional users in Guided mode|guides the reorganized menus' --maxWorkers=1 --bail=1 --reporter=default
```

It passed all three selected cases; 64 unrelated cases were excluded by the
explicit selector, not disabled. The release owner retains integrated
`check:public` and full web/browser/native admission.

## Migration impact

No graph/API/database migration. The existing per-account workspace-tour local
storage key continues to accept the legacy `complete` dismissal marker. It now
also stores `step:<known step key>` progress. Unknown values safely start at the
first step. Older readers reopen a progress marker at step one; graph content,
permissions and completion markers are unchanged.

## Security impact

No authentication, tenant authorization, credentials or provider execution
changes are in scope. UI findings remain subordinate to deterministic validation
and command admission.

## Feature matrix

| Area                                | Source implementation                                                                                                   | Local evidence                                                                    | Live acceptance                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Catalog search and standalone cards | Implemented; owner settings and variants stay under Configure/Set up                                                    | Source-matched release suite: catalog/model suites passed                         | Unverified                                                         |
| Icons                               | Partial artwork coverage: registry/fallback implemented, ten definitions explicitly use missing placeholders            | Source-matched registry/catalog tests; manifest cross-check below                 | Unverified                                                         |
| Default/custom configuration        | Explicit typed defaults; schema validation and reviewed commands for edits; undeclared/credential values rejected       | Source-matched release suite: form/inspector/command suites passed                | Unverified                                                         |
| Nested placement                    | Catalog-bound parents, cycle/depth checks and generated-resource adoption rules                                         | Initial independent placement check: 3 passed; owning release suites passed       | Unverified                                                         |
| Typed connections                   | Exact directional relationships and port rules; review generated support/permissions before atomic application          | Source-matched release suite: connection/model/wizard suites passed               | Unverified                                                         |
| Validation/errors                   | Current complete reports, severity text, affected paths, stale/incomplete readiness suppression and reviewed safe fixes | Source-matched release suite: IssuesPanel/validation suites passed                | Unverified                                                         |
| Workspace tour restart/resume       | Confirmed reload defect fixed; restart clears completion and Next/Back save known step keys                             | Existing lifecycle regression extended; final focused case passed in 0.30 seconds | Unverified                                                         |
| Editor tutorial                     | Separate truthful practice/hosted steps; completion/dismissal preferences persist; restart supported                    | Final focused restart/mode case passed in 2.26 seconds                            | Unverified; exact step resume after editor remount remains missing |
| Guided/Professional                 | Shared commands/control tree; assistance copy differs; documented Guided next-action exception                          | Source-matched release mode/dirty-form coverage; focused restart/mode case passed | Unverified                                                         |

"Source-matched release suite" refers to the release owner's local candidate
`84130ae5d0f2dd37dd28d3df2bca7c3abcc59e19` web/UI selection: 190 suites passed,
and only the two named App/editor cases failed out of 1,665 cases. Those owning
catalog, inspector, connection, validation and mode sources are unchanged from
the independently verified main. This is reused same-source local evidence, not
a fresh independent rerun or live acceptance. The combined release gate remains
failed until its owner verifies the integrated fixes.

The current provider catalog declares 73 services, 139 connection rules and 34
validation rules. These totals include owner-managed settings and variants and
do not imply that every definition is an independently addable card.

Of 55 icon-backed definitions, ten manifest entries explicitly have
`state: placeholder`, `placeholderReason: missing` and no file:
`aws.ec2.instance`, `aws.ecr.repository`, `aws.ecs.cluster`, `aws.ecs.service`,
`aws.ecs.task-definition`, `aws.iam.instance-profile`, `aws.kms.key`,
`aws.secretsmanager.secret`, `aws.wafv2.alb-association`, and
`aws.wafv2.web-acl`. This is a confirmed source artwork gap, not a failed icon
registry test or proof that all ten are independent visible catalog cards. The
existing source approval record is `CC-AWS-ICONS-OWNER-APPROVAL-2026-10-06`; a
follow-up must check exact/family mapping evidence and run the existing
source/asset/bundle admission under
[ADR-0019](../../adr/0019-product-owner-governance-for-official-provider-icons.md).
No asset was promoted or its approval inferred from placeholder state here.

## Reproductions and environment evidence

- The extended workspace-tour regression failed on the original implementation
  because no tour was rendered after restart, Next and remount (`Your account`
  was absent). One case failed in 12.04 seconds (1.17 seconds test execution).
- The repair passed the same owning case in 13.59 seconds (0.89 seconds test
  execution), then the stronger immediate-restart/remount and resume checks in
  45.11 seconds (3.63 seconds test execution). Test-case count is unchanged.
  Criticality is 8/10: a reproduced failure of the explicit restart/resume
  onboarding workflow, added to the existing owning lifecycle case.
- The first six-file selection stopped four suites at missing provider `dist`
  prerequisites and reproduced the workspace-tour failure; the independent
  placement suite passed three cases. This is not a product catalog failure. A
  bounded `tsc -p packages/provider-aws/tsconfig.json` build then passed.
- A subsequent four-file selection and changed-file ESLint attempt were
  interrupted without terminal results when the release owner reported its exact
  Catalog/Inspector and editor-walkthrough failures. Neither interrupted command
  is counted as passing.
- Release candidate `84130ae5d0f2dd37dd28d3df2bca7c3abcc59e19` changes none of
  `App.test.tsx`, the editor/onboarding/preferences source or tests, or shell
  source relative to the verified main. Its app stylesheet changes navigation
  sizing and overflow. Its terminal web result is 1,663 passed / 2 failed; both
  exceptions are five-second timeouts. No release worktree was modified and no
  aggregate/CI run was launched here.
- An isolated original-deadline rerun reproduced the App timeout. A diagnostic
  20-second allowance then completed every original assertion in 5.37 seconds
  (App) and 14.45 seconds (walkthrough). This diagnostic is not admission and no
  timeout increase is committed. A later timing diagnostic also timed out under
  contention; those attempts are retained rather than counted as passing.
- Explicit React viewport synchronization exposed an obsolete App assertion:
  after Catalog receives desktop focus, returning to tablet intentionally opens
  its drawer. The same requirement is already covered by "opens the focused
  desktop region after switching to a review posture" and the shell's focus
  reconciliation. The test now checks the committed posture and its intentional
  drawer, then retains the Inspector popup assertions. No shell behavior
  changed.
- The walkthrough test now queries its own tour and header, uses a tablet
  fixture without the unrelated open desktop catalog, and waits on the exact
  command-palette element before retaining the global absence assertion. Its
  keyboard focus/activation, restart, Professional hiding and return-to-Guided
  assertions are preserved. No test case or original deadline was removed.
- Final default-deadline run: 3 selected cases passed, 64 excluded by selection;
  App 3.09 seconds, editor restart 2.26 seconds, workspace tour 0.30 seconds.
  Process total was 125.35 seconds, including module preparation. Added cases:
  zero. Retained cases score 8/10 for responsive focus, tutorial restart/mode
  behavior and the reproduced workspace-tour reload regression.
- Changed-file ESLint passed for all four changed code/test files in 37.94
  seconds. Web `tsc -p apps/web/tsconfig.json --noEmit` passed in 32.97 seconds.
  Changed-file Prettier, final `git diff --check` and local Markdown target
  verification passed. No dependency or lockfile changed.

## Stopping condition

Confirmed bounded defects have focused passing regressions, changed-file checks,
a reviewed/sealed diff and exact live acceptance scenarios. Any concrete
environment or scope blocker is recorded with the next owner action; local
checks do not establish deployment or live acceptance.

## Handoff

The local audit, bounded tour repair and focused release-test corrections are
complete. Existing source caches were reused; no live browser or release
operation was attempted. Exact editor-step resume and the ten missing artwork
mappings remain explicit follow-ups. The live QA owner should use a disposable
project and retain its exact deployed revision with each result:

1. Search for Lambda, S3 and DynamoDB on a blank design; add them without a VPC.
   Check service names and local icons. Search for a nested setting and confirm
   discovery leads to its owning Configure section instead of an independent
   resource. Open FSx Set up and check its explicit family selector.
2. Inspect the explicit defaults. Enter an invalid configuration value and
   confirm the highlighted field/error and unchanged design. Correct it,
   preview, cancel, preview/apply, then undo and redo.
3. Add Region, VPC, Availability Zone and subnet in order. Verify the subnet is
   inside its zone. Attempt an incompatible parent/root placement; confirm the
   reason and no change. Move only coordinates and retain resource identities.
4. Prepare a supported directional service connection, inspect endpoints and
   generated permission/support changes, cancel, then prepare/confirm and undo.
   Check that reversing an unsupported direction cannot create a partial edge.
5. Open Issues, filter findings, follow an affected field/node and review any
   available safe-fix preview. Confirm stale or incomplete validation is never
   shown as ready. Do not manufacture live permissions or service outages.
6. In Settings/Appearance, change Guided/Professional while a form is dirty and
   a technical disclosure is open. Confirm values, controls, selection,
   disclosure and command history persist; only assistance changes. Test the
   documented Guided next-action exception separately from feature access.
7. Dismiss the workspace tour, restart it from Dashboard, refresh immediately
   and confirm step one remains available. Advance, refresh, confirm the same
   step, go Back, dismiss and refresh to confirm dismissal. No account-switch or
   new-user claim is made without that separate authenticated evidence.
8. Restart the editor tour and follow each Show me target. The practice editor
   must describe revision/export placeholders truthfully; the saved editor must
   point to actual revision/export entry points. Switching assistance mode must
   not mutate architecture. Record the known missing exact editor-step resume
   after remount separately from persisted completion/dismissal.
9. At tablet width, open Catalog, resize to desktop and confirm Catalog owns
   focus as a panel. Resize back to tablet and expect its review drawer to open
   to preserve focus. Switch to Inspector, then resize to desktop and confirm
   the modeless Configure popup and selected launcher remain active.

The release owner owns integrated `check:public`, full web/browser/native
admission and publication. Local successes here are not deployment claims.
