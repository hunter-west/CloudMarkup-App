# Reliable architecture proposal boundaries

- Milestone: functional beta
- Workflows: account creation, architecture creation and adjustment, project
  export
- Status: blocked
- Owners: AI workstream; integrated release and live acceptance remain with the
  release owner

## Goals

- Keep Bedrock and provider-direct architecture requests on the same reviewed
  prompt, tool schema and output limits.
- Reject a response against the exact requested proposal version and preserve
  every strict schema and deterministic applicability check.
- Use the same v6 capability and saved-draft admission for project creation as
  editor adjustments, without a paid legacy fallback.
- Exercise the cross-field rejection classes with synthetic, reproducible
  responses, and give users a safe request reference when generation fails.

## Context

The [public status](../../PUBLIC_STATUS.md) separates local source qualification
from hosted activation. The existing model suite covers transport, malformed
output and allowlisted diagnostic fields. Historical hosted attempts reached
generation and failed strict proposal validation; one attempt reported a root
constraint. Its rejected output was not retained, so the specific failing rule
cannot be recovered or claimed fixed. Existing fixed root-rule telemetry is
retained. Zod refinements enforce relationships that JSON Schema shape alone
cannot prove. See [ModelGateway](../../architecture/MODEL_GATEWAY.md).

## October 29 continuation

The initial fix is merged in public PR #5 at
`641ed0822598be162df2e67155e40484d67b5579`. This audit starts from that public
source. Merge, integrated qualification, deployment and live proof remain
separate records. The earlier full-run failure below is historical local
evidence, not admission for the current candidate.

The new audit found that creation discarded the v6 applicability receipt at the
RAM handoff, whereas editor adjustments compared it to the actual prepared
command/result. The existing review fixture used v1 and did not reach this v6
boundary. A valid v6 fixture passed, while six missing/mismatched-proof controls
incorrectly left Apply enabled. The fix carries the receipt and verifies its
baseline, proposal, catalog, command, result and outcome kind before review.
No-change assessments now receive the stale-baseline check too. Missing or
mismatched proof disables application with fixed recovery guidance.

The resumed focused run passes 74/74 web cases across five owning suites, with
12/12 runtime/capability API cases. The creation suite grows from five to twelve
cases: six proof bindings (9/10 each; each protects a different admitted input
or prepared output) and the stale no-change branch (8/10). Existing positive,
editing-denied, session-expired, stale-mutation and cancellation cases now use a
real deterministic synthetic v6 preparation. The setup journey additionally
asserts exact receipt retention. Before the fix the six proof controls failed
and five prior behaviors passed in 44.40 seconds; the resumed five-suite run
passed in 150.80 seconds, with 13.17 seconds test execution. One earlier
post-fix process failed to start a worker and executed no tests; it is not
counted as a product pass. No timeout, retry, assertion or gate was weakened.

Final correction checks passed: creation review 12/12 in 90.94 seconds, web
types and changed-file lint, direct production web build in 1.89 seconds,
formatting, 334 Markdown link checks and diff whitespace checks. Security
policy/static/secret checks passed; the unchanged dependency set has nine
moderate audit advisories and no high/critical advisories. No broad suite or CI
run was started for this continuation. Integrated admission belongs to the
release owner after the resumed patch is combined with other workstreams.

No live generation or deployment proof is claimed. Exact served-source binding,
spending authorization and campaign/job identities belong in the separate
private operational handoff, not this public source plan. This procedure cannot
authorize inference from an account balance or AWS sign-in status.

## Constraints

- One provider attempt, existing token/deadline limits, unchanged funding
  policy.
- Strict versioned parsing, current tenant/draft/catalog admission and explicit
  atomic graph application remain mandatory.
- No paid calls, Chrome navigation, merge or deployment in local qualification.
- No raw prompts, provider output, tenant content or secrets in diagnostics.
- Preserve released v1-v4 prompt bytes; current reviewed versions receive only
  explicit guidance describing their existing cross-field rules.

## Non-goals

- Automatic repair calls, relaxed validation, account entitlement changes,
  application source generation and deployment.

## Checkpoints

- [x] Inspect previous work, current source and owning tests; reproduce the
      synthetic shape/refinement mismatch without provider access.
- [x] Share request preparation, require version-exact output, retain root
      diagnostics and improve safe failure recovery.
- [x] Run focused package/web checks and review the complete diff.
- [x] Reproduce and repair the v6 creation proof handoff with focused
      regressions.
- [x] Supply exact supported prompts and recovery/export expectations.
- [x] Finish focused candidate checks and deliver the resumed patch.
- [ ] (current) Release owner integrates and qualifies the candidate, then
      coordinates separately authorized deployment and live acceptance.

## Validation commands

```powershell
pnpm exec vitest run --project=model-gateway packages/model-gateway/src/beta-infrastructure-model.test.ts packages/model-gateway/src/server-byok-models.test.ts --maxWorkers=1
pnpm exec vitest run --project=web apps/web/src/features/generation/beta-infrastructure-client.test.ts apps/web/src/features/projects/ProjectPages.setup.test.tsx apps/web/src/features/generation/ProjectCreationProposalReview.test.tsx --maxWorkers=1
pnpm --filter @cloudmarkup/model-gateway type-check
pnpm --filter @cloudmarkup/model-gateway build
pnpm --filter @cloudmarkup/web type-check
pnpm security:check
git diff --check
```

Extend the owning negative cases rather than adding another test harness.
Root-rule cases protect the untrusted AI boundary (9/10); a version mismatch
must never be delivered (9/10); request-reference recovery is a distinct failed
core workflow (8/10). Measure focused timing and case delta at handoff.

## October 28 local verification checkpoint

- Full model-gateway project: 1,287/1,287 tests passed in 109.21 seconds. The
  owning model file grew from 20 to 27 cases: one transport/version invariant
  and six distinct root-rule rejections. Each new root case proves a valid
  baseline, the specific cross-field rejection, one provider attempt, no usage
  delivery and fixed diagnostics without private text (9/10).
- Final owning model-file check: 27/27 passed in 9.87 seconds, with 138 ms test
  execution. Its initial baseline was 20/20 in 3.17 seconds, with 177 ms test
  execution. Transform/import load dominates these wall times; a comparable
  clean full-suite baseline is unavailable.
- Existing backend proposal and applicability suites: 44/44 passed in 117.14
  seconds. Existing tenant, draft, catalog, accounting and applicability
  assertions are retained.
- Focused client/setup/review suites: 44/44 passed in 54.77 seconds. Four new
  cases cover unsupported capability (8/10), failed capability read (8/10),
  unpublished baseline (9/10), and refusing untrusted support-reference text
  (9/10). Existing successful setup, same-project retry and terminal-credit
  cases now assert the current version and useful failure recovery.
- Affected workspace build and types passed. The final direct web production
  build passed in 3.42 seconds. Changed-file lint, formatting, 330 Markdown link
  checks and diff whitespace checks passed.
- Security policy checks: 11/11 passed; static verification and secret scan
  passed. Registry audit found nine moderate advisories and no high/critical
  advisories; dependencies and lockfile are unchanged.
- The full `check:web` run passed lint/types, then failed its web/UI phase:
  1,655 passed and seven failed across 192 files, in 423.72 seconds of tests.
  App and ServiceCatalogPanel each timed out once; AssistantWorkspace could not
  find Workspace; EditorExperience had three timeouts and could not find Add a
  service. Full gate elapsed time was 846.56 seconds and its build stage was not
  reached. This remains a failed full gate.
- A focused reproduction of all four failing files, with one worker and
  unchanged timeouts, passed all 94 cases in 51.23 seconds. No related source,
  timeout, retry or assertion was changed. This narrower pass does not replace
  the full result; the release owner owns the next integrated full run after
  workstreams settle.
- Paid AI, Chrome, hosted acceptance, public/private release CI, merge and
  deployment were not performed by this workstream. Historical rejected model
  output remains unavailable, so its exact root cause and a live fix remain
  unproven.

## Coordinated ten-project acceptance

Use the
[exact architecture AI runbook](../../development/AI_ARCHITECTURE_ACCEPTANCE.md)
for ten creates, thirty follow-ups, expected diagrams/export results and the
stale/interruption/recovery controls. It replaces the initial draft matrix: SQS
visibility 180 seconds, seven-day retention and arbitrary EventBridge
source/detail values are not supported by the current catalog. The runbook uses
supported literals and separates clarification from completed mutations. It
supplies no paid authorization or live success receipt.

## Migration impact

None: persisted proposal and job envelopes are unchanged. Request guidance and
schema digests change only for current reviewed versions. Rollback restores the
previous request preparation and presentation while retaining strict validation.

## Security impact

Model output remains untrusted. Fixed diagnostics disclose no values. A browser
support reference accepts only the existing bounded identifier alphabet; remote
error text never becomes display copy. No new permission, dispatch, retry or
graph authority is introduced.

## Stopping condition

Stop after focused local qualification and release-owner handoff. Hosted AI
quality remains unverified until an exact deployed candidate is tested through
the coordinated browser with its separately authorized credit cap. If a live
attempt fails, stop further submissions and use its fixed diagnostic category;
never guess the rejected content or report a passing matrix.

## Handoff

The initial implementation is merged in public PR #5; deployment/live proof
remain separate. The resumed creation-proof correction is local and passed
focused qualification. The release owner owns its integrated public/private
gates and delivery; the designated Chrome owner owns source-bound live testing
after parent budget coordination. No new full suite runs independently on the
shared PC. Application generation remains a separate handoff; its default
unavailable stages are not activated by this work.
