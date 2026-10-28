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
- [ ] (current) Release owner integrates the candidate, qualifies the full gate,
      and coordinates the separately authorized live acceptance.

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

## Local verification checkpoint

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

This is a procedure, with no live execution or credit authorization implied.
Before the first request, the parent coordinates the existing bounded allowance
and the sole Chrome driver, records remaining credits and entitlement, and binds
the served revision to the release owner's exact candidate. Use fresh synthetic
projects named `QA-<date>-AI-01` through `AI-10`. Preserve previous failed
projects as evidence. Run one initial smoke request; continue only if its strict
output and actual graph preview succeed. Stop on a schema/provider failure,
unknown charge or allowance exhaustion. There are no automatic retries.

For each create, append: "Use only the current supported catalog. Propose
infrastructure only, disclose unimplemented application logic and unknown
settings, use least privilege, and do not deploy." For each adjustment, append:
"Change only the requested settings; preserve all unrelated graph IDs,
relationships, configuration and workload contracts. Ask a blocking question or
explain a supported manual workflow when the request cannot be represented."

| Project       | Create requirements                                                                                                                                        | Adjustment 1                  | Adjustment 2                                                         | Adjustment 3                                                            |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 01 Notes      | Authenticated notes API: HTTP API, Cognito, Lambda, DynamoDB; Lambda 256 MB/10 seconds                                                                     | Lambda 512 MB                 | Lambda timeout 15 seconds                                            | Explain ownership isolation and missing business logic; no graph change |
| 02 Catalog    | Read-only product lookup API with Lambda 128 MB/3 seconds and DynamoDB; no write endpoints                                                                 | Lambda 256 MB                 | Lambda timeout 10 seconds                                            | Review read permissions and unresolved query behavior; no graph change  |
| 03 Uploads    | Private S3 JSON uploads under incoming/ trigger Lambda 256 MB/10 seconds, with metadata table and logs                                                     | Lambda 512 MB                 | Lambda timeout 30 seconds                                            | Explain duplicate delivery and retry limitations; no graph change       |
| 04 Orders     | Standard SQS, Lambda 256 MB/15 seconds, DynamoDB, DLQ; queue visibility 120 seconds, redrive after 5 receives                                              | Visibility 180 seconds        | Queue long polling 20 seconds                                        | Lambda 512 MB                                                           |
| 05 Fanout     | Standard SNS to two independent standard SQS queues, no external endpoints; analytics retention 1 day                                                      | Analytics retention 7 days    | Billing queue long polling 20 seconds                                | Explain topic delivery versus consumer processing; no graph change      |
| 06 Events     | Custom EventBridge bus, enabled OrderCreated rule and Lambda 256 MB/10 seconds; source qa.orders                                                           | Disable rule                  | Re-enable same rule                                                  | Lambda timeout 15 seconds                                               |
| 07 Reports    | Daily EventBridge rate schedule, Lambda 256 MB/10 seconds, private output bucket                                                                           | Lambda 512 MB                 | Lambda timeout 30 seconds                                            | Disable schedule while retaining its interval/target                    |
| 08 Static     | Private S3 origin with CloudFront origin access control; default hostname/certificate, HTTPS redirect, index.html; cache 0/60/300 seconds                  | Default cache TTL 120 seconds | Maximum cache TTL 600 seconds                                        | Explain private origin versus public viewer access; no graph change     |
| 09 Postgres   | Private encrypted RDS PostgreSQL foundation, two AZs, RDS-managed authentication, 20 GiB, backups 7 days, no public ingress; ask for unknown engine inputs | Backup retention 14 days      | Storage 40 GiB                                                       | Explain authentication/network prerequisites; no graph change           |
| 10 Containers | Private ECS Fargate foundation, 256 CPU/512 MiB, non-root/read-only container, desired count zero; published image digest remains unresolved               | Task 512 CPU/1024 MiB         | Keep desired count zero and explain pending image; no invented image | Explain readiness and unresolved runtime inputs; no graph change        |

Create plus three requests gives at most 40 planned interactions. A question is
valid advisory output, but it does not establish a created architecture. Mark
that project's dependent edits blocked until the parent supplies the missing
input and approves any additional budgeted interaction. Unsupported label,
policy, reference or workload edits must never be counted as completed
mutations.

For every interaction, record request reference, timestamps, requested version,
safe diagnostics, credit receipt, returned proposal and actual preview result in
private evidence. Review and explicitly accept only a valid proposal. Compare
before/after graph data, check unrelated stable IDs/configuration, exercise one
Undo/Redo, save/reload, and create an immutable revision. Explanations must make
no changes and claim no source execution. Rejected output must leave the saved
baseline unchanged and expose its real accounting outcome.

For each generated baseline that reaches export, record the immutable revision,
provider/catalog bindings, real export job/download, archive contents and
deterministic validation. Export entitlement failure is a blocker, not a pass.
Application-source generation, builds and runnable backend tests are separate
evidence owned by the application-generation workstream. Score only completed
observations; unrun/blocked results remain null, with a denominator that
excludes them. The release owner selects integrated public/private CI and
browser/native acceptance; these local tests supply no deployment authority.

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

Local implementation is ready for release-owner integration. The unresolved full
web result and unknown historical rejected output block release/quality claims.
The release owner owns the integrated public/private gates and delivery; the
designated Chrome owner owns a source-bound smoke request and subsequent
ten-project campaign after parent budget coordination. No new full suite should
run concurrently with the other workstreams on the shared PC.
