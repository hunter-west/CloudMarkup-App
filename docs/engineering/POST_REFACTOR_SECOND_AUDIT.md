# Post-refactor second audit

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

Audit date: October 1, 2026. Milestone: M9 controlled-beta hardening. Runtime
baseline: `dc1f3cfb46150ad19f9f6d31fe478be91b973473` (PR 46); documentation
closeout incorporated from `df8e1602a1c9e2119efbb89f31549e037bfaab9c` (PR 47).
Comparison baseline: refactor closeout `3ae57567`.

This report preserves the October 1 audit baseline. Its open findings and next
steps describe that date; [STATUS](../PUBLIC_STATUS.md) owns subsequent fixes,
delivery evidence and remaining limitations.

## Outcome

The 50-family goal is **not complete**: 13 have bounded existing slices and 37
remain research. The current 44 catalog definitions include boundaries and owned
configurations; they are not 44 independent AWS service families. Structural
integrity passes, but confirmed FSx capacity and AI configuration gaps prevent a
blanket correctness claim.

This audit removes one unused internal barrel, corrects current documentation
and extends existing same-run build reuse to the CI quality job. It does not
change runtime, catalog bytes, public contracts or deployment authority.
Repository inspection did not establish a safe bulk runtime deletion. Findings
below distinguish established defects, coverage limits and future optimization
candidates.

## Repository and documentation review

At the runtime baseline, tracked files increased from 3,354 to 3,483 since
refactor closeout, and tracked content from 50,642,160 to 51,998,892 bytes: 129
files and 1,356,732 bytes (about 2.68%). The comparison changes 314 files, with
34,350 insertions and 1,928 deletions. Markdown files increased from 460 to 474.
These are Git-tree measurements, excluding ignored builds, dependencies,
worktrees and this audit's own changes.

An exact Git-blob census found 105 duplicate groups. The largest are complete
expected application manifests and generated golden outputs. The three Go-owned
JSON Schema copies are required by the isolated compiler and drift tests.
Historical catalogs, SQL migrations, accepted ADRs, fixtures and generation
goldens remain intentional compatibility evidence. No tracked file also matches
the repository's ignore rules.

A TypeScript import/entrypoint census produced ten apparent orphan modules. Nine
are package exports, HTML, CLI, image-build or infrastructure entrypoints. The
remaining nine-line editor repository barrel had no consumers, package export or
dynamic entrypoint; every component consumer imports its concrete module. It was
removed while retaining the components and their tests. No public API was
deleted based on import counts. Static analysis cannot prove the absence of all
dead code; dynamic and data-driven entrypoints were inspected separately.

Corrected current prose in the domain model, system overview, model gateway, MVP
scope, UI specification, provider guide and provider README. Two dated roadmap
handoffs now explicitly point readers to current status without rewriting their
historical evidence. The corrections remove claims that there is no curated
catalog, that current networking CloudFormation is pending, that migration 0080
is the latest, and that the completed refactor still imposes a temporary merge
hold. The provider README now points to one maintained scope guide rather than
repeating a long historical 0.10.0 walkthrough. Historical version sections
remain clearly historical.

Two completed release sections in HANDOFF were byte-identical to STATUS (137
lines together). They now retain their headings, current holds and direct links
to the complete source records, removing over 100 duplicate lines without
discarding release or incident evidence. Refactor test counts and preview-port
occupancy are explicitly historical.

Two further cleanup candidates need separate compatibility evidence:

- Large legacy/current model-instruction strings overlap, but they bind distinct
  proposal versions. Share text only if byte-level historical behavior and
  evaluation fixtures remain unchanged.
- Six catalog relationship education entries contain language about future or
  pending compiler support. Review their exact historical meaning in the next
  catalog version; released digest-bound bytes cannot be edited as prose
  cleanup.

## Catalog inventory and checks

Current catalog `0.17.0`, digest
`sha256:68b2fd6a83d597a260a994e7428c3ce82b8b10f1a6fba7191bc6cc9366060873`:

| Measure                                     | Verified result                                        |
| ------------------------------------------- | ------------------------------------------------------ |
| Definitions                                 | 44                                                     |
| Configuration properties / semantic ports   | 191 / 156                                              |
| Connection / validation descriptors         | 88 / 20                                                |
| Standalone implemented mapping declarations | 38 Terraform / 32 CloudFormation                       |
| Per-definition target readiness             | 42 supported for each target; Region/AZ not applicable |
| Region availability                         | All 44 unknown                                         |
| Generated application readiness             | 10 supported; 34 not applicable                        |
| AI v3/v4 catalog projection                 | 37 definitions / 51 relationships                      |

The structural census checked every definition's schema/UI fields, mapping
configuration and port references, validation references, connection endpoint
types/directions and service-extension membership: zero integrity defects.
Artifact regeneration matched all nine generated files byte for byte. The
SDK/provider tests and Go compiler checks pass at the audited baseline. None of
these establishes that all AWS property combinations or all real deployment
journeys work.

Of the 88 relationship descriptors, 64 have implemented free-form connection
resolvers. The remaining 24 intentionally describe placement, structured owner
slots or supporting policy edges governed by their dedicated domain commands.
They are not 24 generic missing connection recipes, and the AI picker only
advertises its applicable implemented subset.

Catalog maturity, individual production-oriented labels, per-target compiler
support, generated application support and regional evidence describe different
things. A family name is not support for every AWS mode. Inline/owned child
projections explain some standalone mapping-count differences.

### All 50 planned families

The coverage plan is a product-priority selection, not an independently measured
popularity ranking. Its proposed controls and connections are not delivered
capabilities.

| #   | Family                 | Status and key scope                                                                                           |
| --- | ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | Lambda                 | Existing curated function, IAM, network and event slices                                                       |
| 2   | S3                     | Existing bucket and owned configurations; bounded connections                                                  |
| 3   | DynamoDB               | Existing table; indexes and streams absent                                                                     |
| 4   | API Gateway            | Existing HTTP/JWT slice; CORS fixed off                                                                        |
| 5   | Cognito                | Existing graph user-pool/client slice; hosted-login/federation modeling absent                                 |
| 6   | IAM                    | Existing typed policies/roles; generated ownership protected; policy children excluded from AI direct creation |
| 7   | CloudWatch             | Existing logs and Lambda Errors alarms; generic metric coverage absent                                         |
| 8   | VPC networking         | Existing curated IPv4 slice; interface endpoints/main-table adoption absent                                    |
| 9   | SQS                    | Existing queue/redrive and typed producer/consumer slices                                                      |
| 10  | SNS                    | Existing topic/subscription slice; AI array configuration gap below                                            |
| 11  | EventBridge            | Existing bus/rule/target slice; AI array configuration gap below                                               |
| 12  | Step Functions         | Existing curated Standard workflow; arbitrary ASL/Express absent                                               |
| 13  | FSx                    | Existing four filesystem families plus ONTAP children; capacity defects below; no generic Lambda mount         |
| 14  | EC2                    | Planned; no catalog implementation                                                                             |
| 15  | EBS                    | Planned; no catalog implementation                                                                             |
| 16  | EC2 Auto Scaling       | Planned; no catalog implementation                                                                             |
| 17  | Elastic Load Balancing | Planned; no catalog implementation                                                                             |
| 18  | ECS / Fargate          | Planned; no catalog implementation                                                                             |
| 19  | EKS                    | Planned; no catalog implementation                                                                             |
| 20  | ECR                    | Planned; no catalog implementation                                                                             |
| 21  | EFS                    | Planned; no catalog implementation                                                                             |
| 22  | RDS                    | Planned; no catalog implementation                                                                             |
| 23  | Aurora                 | Planned; no catalog implementation                                                                             |
| 24  | ElastiCache            | Planned; no catalog implementation                                                                             |
| 25  | OpenSearch             | Planned; no catalog implementation                                                                             |
| 26  | Redshift               | Planned; no catalog implementation                                                                             |
| 27  | Kinesis Data Streams   | Planned; no catalog implementation                                                                             |
| 28  | Amazon Data Firehose   | Planned; no catalog implementation                                                                             |
| 29  | Glue                   | Planned; no catalog implementation                                                                             |
| 30  | Athena                 | Planned; no catalog implementation                                                                             |
| 31  | Lake Formation         | Planned; no catalog implementation                                                                             |
| 32  | CloudFront             | Planned; no catalog implementation                                                                             |
| 33  | Route 53               | Planned; no catalog implementation                                                                             |
| 34  | ACM                    | Planned; no catalog implementation                                                                             |
| 35  | WAF                    | Planned; no catalog implementation                                                                             |
| 36  | Shield                 | Planned; no catalog implementation                                                                             |
| 37  | KMS                    | Planned; platform/token-vault usage is not catalog support                                                     |
| 38  | Secrets Manager        | Planned; no catalog implementation                                                                             |
| 39  | Systems Manager        | Planned; no catalog implementation                                                                             |
| 40  | CloudTrail             | Planned; no catalog implementation                                                                             |
| 41  | AWS Config             | Planned; no catalog implementation                                                                             |
| 42  | AWS Backup             | Planned; no catalog implementation                                                                             |
| 43  | SES                    | Planned; no catalog implementation                                                                             |
| 44  | Bedrock                | Planned; platform model-provider use is not catalog support                                                    |
| 45  | SageMaker              | Planned; no catalog implementation                                                                             |
| 46  | Batch                  | Planned; no catalog implementation                                                                             |
| 47  | AppSync                | Planned; no catalog implementation                                                                             |
| 48  | Transfer Family        | Planned; no catalog implementation                                                                             |
| 49  | MSK                    | Planned; no catalog implementation                                                                             |
| 50  | Amazon MQ              | Planned; no catalog implementation                                                                             |

### Confirmed correctness findings

**P2 — FSx Lustre accepts invalid persistent SSD capacity.**
[Provider validation](../../packages/provider-aws/src/validation/fsx-rules.ts)
and [compiler validation](../../services/iac-compiler/fsx.go) accept every
multiple of 1,200 GiB. The renderer selects PERSISTENT_2 SSD. AWS permits 1,200
or multiples of 2,400 GiB for that mode. A synthetic 3,600-GiB model produced
both Terraform and CloudFormation artifacts without errors. See
[AWS StorageCapacity](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-fsx-filesystem.html#cfn-fsx-filesystem-storagecapacity).
The coordinated fix must update versioned provider validation/UI and both-target
rejection evidence while retaining valid 1,200/2,400/4,800 boundaries.

**P2 — FSx ONTAP permits capacity above its fixed HA-pair limit.** The
[service schema](../../packages/provider-aws/src/catalog/services/fsx.ts) and
[compiler](../../services/iac-compiler/fsx.go) admit up to 1,048,576 GiB, while
both renderers fix HA pairs to one. AWS bounds capacity at 524,288 GiB per pair.
A synthetic 524,289-GiB single-pair model produced both target artifacts without
errors. Use the single-pair limit unless a separately reviewed schema adds
HA-pair configuration. The same
[AWS capacity reference](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-fsx-filesystem.html#cfn-fsx-filesystem-storagecapacity)
supports this finding.

The two reproductions ran through the actual Go renderers using an ignored test
overlay on the baseline; they did not modify released fixtures or contact AWS. A
passing reproduction means the defect was reproduced, not that the input is
valid. These defects remain open: correcting released catalog semantics requires
a versioned provider/validator/compiler slice rather than mutating 0.17.0.

**P2 — AI advertises configuration it cannot represent.** The
[API catalog projection](../../apps/api/src/application/beta-infrastructure.ts)
includes EventBridge rule `detailTypes`, `filterKeys` and `sourceKinds`, plus
SNS subscription `filterKeys`, all array-valued fields. The
[v3/v4 proposal settings](../../packages/schemas/src/beta-infrastructure-proposal-v1.ts)
permit only strings, numbers and booleans. The editor's bounded literal
conversion has the same scalar constraint. AI can use scalar configuration and
review/apply typed graph operations, but cannot configure these four fields. The
AI task confirmed this mismatch: bounded string lists are readable context, not
a proposal write route. A direct schema reproduction rejects array-valued
sourceKinds at its exact configuration path while accepting a scalar. Fix in a
versioned proposal slice with bounded arrays, catalog-aware conversion,
evaluations and negative tests, or explicitly omit/describe unsupported fields
in the capability projection. Do not stringify arrays or weaken validation.

Seven definitions are intentionally absent from direct AI creation: IAM policy
condition/document/statement; S3 CORS/lifecycle/notification configurations; SQS
redrive policy. Some are generated by typed connection resolvers. This is not
equivalent to full direct configuration support. Current proposals admit at most
24 new resources and reference at most 100 existing resources.

**P2 evidence gap — strengthen FSx target assertions.**
[FSx tests](../../services/iac-compiler/fsx_test.go) repeat generation and check
selected output strings and rejection cases. No FSx fixture appears in the
central generation-golden inventory. Add exact per-family target goldens and
valid/invalid capacity-boundary cases as part of the fixes above. Existing
reproducibility and global renderer checks remain useful, but did not catch the
capacity errors.

### Documentation-tool finding

The optional `pnpm docs:brand:check` fails on valid repository URLs.
`check-document-brand.mjs` protects code spans but applies display-name
replacement inside Markdown link destinations; a direct synthetic reproduction
turns a GitHub `/CloudMarkup/` path into `/Cloud Markup/`. Its `--write` mode
would therefore corrupt those links. The diagnostic also drops the first path
character because the root already ends with a separator. This is a pre-existing
checker defect, not evidence that every flagged historical document is obsolete.
Do not run its bulk update until link destinations and URI literals are
protected and regression-tested. Required link verification passes.

## GitHub Actions cost and duration

Measured the successful PR 46 full CI run 36913105108 (private historical
evidence, omitted from this distribution), plus its separate native workflow and
protected delivery as baseline evidence. Durations below come from first/last
timestamps in downloaded job logs, not billed minutes, queue time or future
guarantees.

| Job                      | Logged duration         |
| ------------------------ | ----------------------- |
| Shared build producer    | 4m 56s                  |
| Ordered quality          | 14m 51s                 |
| Browser                  | 11m 22s                 |
| Slowest test shard (3/8) | 21m 41s                 |
| Other test shards        | About 7m 16s to 10m 11s |

Quality's first 24-task operation is type-checking, so its 4m 28s is not counted
as removable build work. Later schema/provider/evaluation/full builds total
about 4m 17s. Existing test shards and browser already consume a build-cache
artifact from the producer; quality did not.

The change makes quality depend on `changes` and `build`, downloads the same
`ci-build-cache` into `.turbo/cache/`, and retains the entire ordered quality
command. Exact pinned actions, single-run artifact identity, no token or run-ID
override, failure behavior, draft/documentation classification, native checks
and deployment admission remain enforced. Regression mutations reject cross-run
references, wrong artifact/path, skipped/soft-failed restore, missing
producer/restore and incorrect ordering.
[GitHub's artifact documentation](https://docs.github.com/en/actions/tutorials/store-and-share-data)
describes dependent jobs sharing artifacts within a workflow run.

Expected effect: reduce repeated runner build work. Quality waits for its
producer, so this does not promise a shorter critical path. Only a new hosted
run can quantify cache hits and billed-minute/wall-time changes. No check is
dropped, no cross-run test result is reused, and no deployment is triggered by
this audit.

The largest individual suite is
`model-live-seed-stage-postgres.integration.test.ts`, about 814 seconds across
163 cases (five skips). Next are solution-export PostgreSQL suites at about 179
and 153 seconds. Profile fixture/database setup and split independently isolated
cases before changing shard count. Preserve denial, authority, retry, race and
receipt cases. More parallel runners may shorten elapsed time while increasing
cost; fewer runners can do the reverse.

## Coordination and verification

The AI task completed PR 46 runtime delivery and PR 47 documentation closeout,
then released shared status-document ownership. The product task confirmed the
13/37 split and deferred dirty Terraform/GitLab/migration-0091 work. The billing
task was notified of audit scope; this audit does not touch its isolated
worktree or billing activation. Original dirty main, shared PostgreSQL services
and all other task worktrees are preserved.

Read-only coordination confirmed that billing uses migrations 0092/0093 and has
no edits to the audit CI files. Both owners were notified that, after
higher-numbered migrations are released, deferred 0091 must be renumbered for
forward integration rather than inserted retroactively into the ledger.

The app restart interrupted the root gate during coverage. The repeated full
coverage run completed with one 60-second timeout in the unchanged real
pinned-export-compiler integration test: 8,946 passed and 1,550 configured
skips. Its exact case subsequently passed under coverage in 23.45 seconds with
the original inputs and timeout. No assertion mismatch, timeout increase or
source workaround was introduced. Following the verification cadence, only that
failed suite was repeated; all remaining root/release stages then passed.

The original aggregate remains interrupted, and the broad coverage aggregate
remains failed in the evidence. Component recovery does not relabel either
command as a clean full-run pass or establish the timeout's root cause.

Recent product, billing, AI, refactor and model-access chats were reconnected at
the owner's request. AI/refactor confirmed completed closeout and released
ownership. Product/billing resumed their already-authorized work in separate
checkouts. The audit performs no shared database, cloud or deployment mutation.

The UI review separately owns the stale M3/M1 status introductions in
DESIGN_SYSTEM and INFORMATION_ARCHITECTURE and its premium-UI execution plan.
Those corrections are outside this patch; UI_SPEC remains this audit's narrow
current-scope correction. All status/handoff additions must be reconciled
additively when the independent branches integrate. Product and billing agreed
to reserve 0094/0095 for forward product integration after billing 0092/0093;
these are coordination reservations, not applied migration claims.

Earlier local attempts remain distinct from recovered results: the release
policy tests passed (318 cases, 22.8s), but its initial metadata admission
failed on six missing non-secret beta settings (12 findings). Supplying scoped,
synthetic synthesis metadata passed that admission in 1.1s. Two web-gate
attempts were manually interrupted at 339.9s and 425.2s after lint/type checks;
buffered output was not evidence of a hung suite. The unchanged full web/UI
selection subsequently passed with an explicit single worker and progress
reporter, followed by the web build. None of those interrupted invocations is
reported as a passing aggregate.

Completed local evidence:

| Command / scope                                    | Result / elapsed time                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Frozen installation                                | Pass, 34.5s; no manifest/lock changes                                                 |
| Catalog regeneration                               | Pass, 12.3s; all nine artifacts match                                                 |
| SDK type-check and focused SDK/provider tests      | Pass; 20 files / 214 cases; 38.0s combined                                            |
| Focused compiler gate                              | Pass, 97.5s with Go 1.26.8                                                            |
| Workflow gate                                      | Pass, 17.1s; 110 cases including nine invalid cache mutations, six workflows          |
| Initial security gate                              | Pass, 13.7s; zero high/critical and seven moderate advisories                         |
| Historical receipt preparation                     | Pass; 17 fresh builds, exact bundle/manifest pins; 153.4s                             |
| Web lint/types and full web/UI selection           | Pass; 171 files / 1,519 cases; tests 583.6s                                           |
| Web build                                          | Pass, 59.5s                                                                           |
| Original pnpm check                                | Interrupted by app restart during coverage; no aggregate pass                         |
| Full coverage recovery                             | Failed, 3222.6s; 8,946 passed, 1 timed out, 1,550 configured skips across 784 modules |
| Unchanged failed case under coverage               | Pass, 41.8s; one case, 23.45s test body under original 60s limit                      |
| Remaining root components                          | All pass, 310.5s combined; exact commands below                                       |
| Default browser profile                            | Pass, 462.0s; 74 passed / 77 platform-profile skips                                   |
| Typed-backend browser profile                      | Pass, 342.3s; 55 passed                                                               |
| Solution-export browser profile                    | Pass, 100.7s; 16 passed                                                               |
| OpenAPI verification / deployment-input example    | Pass, 5.3s / 4.0s                                                                     |
| Generation goldens                                 | Pass, 77.8s; Node/Go checks and 44 TypeScript cases                                   |
| Synthetic performance checks                       | Pass, 42.6s; selected cases and Go benchmarks, not a production-capacity claim        |
| Fresh registry audit                               | Pass, 2.0s; seven moderate, zero high/critical                                        |
| Credentialless beta synthesis / artifact admission | Pass, 44.8s / 1.3s                                                                    |
| Documentation links                                | Pass; 476 Markdown files                                                              |
| Protected source and prior STATUS evidence         | Unchanged; original release facts retained                                            |
| Baseline FSx and AI reproductions                  | Both FSx defects reproduced for both targets; AI rejects array-valued settings        |
| Optional docs:brand:check                          | Fails on valid repository URLs; pre-existing checker defect recorded above            |

The recovered root tail ran `storybook:build`, `icons:check:bundle`, `go:check`,
`cdk:synth`, `ci:validate`, `ci:validate:customer`, `security:static` and
`security:secrets`. Earlier root formatting, lint, types, schema/catalog,
deterministic model evaluation, assistant integration and icon checks had passed
before the restart. Database-dependent counted execution was skipped in this
offline profile. Secret scanning covered 3,479 text files; seven non-text files
were explicitly skipped.

Verification used Node 24.18.0, pnpm 11.16.0, Go 1.26.8 and the built,
SHA-pinned real compiler. Coverage used one worker and unchanged timeout limits;
it had no database URL. Browser checks owned ports 4173/4174/4175 with server
reuse disabled; all were released afterward. Windows visual/profile skips do not
become new Linux visual evidence. The separate synthetic performance selection
also intentionally skips unselected cases.

Beta synthesis used scoped non-secret metadata and a synthetic certificate ARN,
with no credentials or deployment. This is default-profile assembly evidence,
not verification of the deployed live-billing/model profile, provider access,
staff bootstrap or signed-in production acceptance. The fresh registry audit
retains seven moderate advisories; no dependency was changed.

Final formatting (63.3s), local links (476 files, 2.2s), secret scanning
(12.4s), whitespace, protected-source comparison and complete-diff review cover
the closeout documents. All earlier failed and interrupted attempts remain
explicit above. Exact ready-for-review hosted checks are still required before
integration; no new hosted CI or measured cache saving is claimed by this local
audit.

## Safest next implementation work

1. Ship a bounded, versioned FSx correction with schema/UI, validation,
   compiler, exact target goldens and boundary/reproducibility tests.
2. Resolve AI array capabilities in a separately versioned proposal/admission
   slice and correct catalog education in the next immutable artifact.
3. Profile the seed-stage PostgreSQL fixture lifecycle; measure one hosted
   before/after CI run before asserting savings.
4. Follow the 50-family plan in bounded service slices. Each needs
   configuration, semantic connections, deterministic validation, both target
   evidence, AI coverage, compatibility and regional claims reviewed
   independently.

The audit is not certification of arbitrary AWS configuration, complete import
coverage, all 50 families, signed-in product acceptance or live deployments.
