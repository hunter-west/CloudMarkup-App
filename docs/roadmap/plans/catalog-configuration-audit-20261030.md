# Audit catalog discovery and simplify service configuration

- Milestone: M9 controlled beta
- Workflows: catalog discovery, required/optional configuration, typed
  connections and export
- Status: complete locally; release integration and live acceptance pending
- Owners: catalog/configuration owner; export, release and live QA remain
  separate

## Goals

- Verify individual catalog coverage and explain EC2 discoverability using
  current source evidence.
- Show required user inputs first, optional overrides in an expandable section
  and fixed values as explanations without redundant choice controls.
- Preserve the current UI, typed configuration, graph identity, validation and
  deterministic export contracts.
- Make the blank-canvas message smaller and more compact.

## Context

Started from verified public main `d2dd761903b192d3691c5601948a10b28df38d3f` on
an isolated branch. EC2 is already a standalone service with setup, six curated
instance types, typed network/profile/key connections and implemented
Terraform/CloudFormation mappings. Its initial setup exposed all 26 persisted
properties, including fixed values. Current main does not yet contain the
separately sealed exact-tour resume or approved icon follow-ons; release
integration must preserve those packets.

Review follows the repository's
[mapping review skill](../../../.agents/skills/review-iac-mapping/SKILL.md),
[catalog guide](../../development/PROVIDER_CATALOG.md) and
[testing cadence](../../../AGENTS.md#verification-cadence). The catalog is a
curated, fail-closed subset, not all AWS configurations or arbitrary
connections.

## Constraints

- No redesign, provider activation, security/access/budget changes, deployment
  or independent aggregate/CI run.
- Coordinate any export contract defect through the existing export owner. No
  concurrent export/compiler edits.
- Keep required attestations without defaults explicit. A single list member
  does not fix list cardinality; an optional unset value remains meaningful.
- Preserve sealed `07ebcc3`, `84c89eb` and `6975e7b` packets unchanged; prepare
  current work separately for the release owner.

## Checkpoints

- [x] Verify public source and isolate branch; inspect catalog, configuration
      and export ownership.
- [x] Finish individual-service audit and focused required/optional/fixed
      configuration repairs.
- [x] Run owning regressions, web type/lint/build, review generated/semantic
      preservation and record unsupported gaps.
- [x] Seal the local change and prepare publication materials; push/draft PR
      outcomes are recorded in the external handoff receipt.

## Validation commands

```powershell
node node_modules/vitest/vitest.mjs run --project web apps/web/src/features/editor/inspector/configuration-form-model.test.ts apps/web/src/features/editor/catalog/ServiceCatalogPanel.test.tsx apps/web/src/features/editor/inspector/SelectedResourceInspector.test.tsx
node node_modules/vitest/vitest.mjs run --project web apps/web/src/features/editor/model/service-catalog-view-model.test.ts
node node_modules/vitest/vitest.mjs run --project web apps/web/src/features/editor/EditorWorkspace.test.tsx -t 'renders an accessible empty state'
pnpm type-check:web
pnpm lint:web
pnpm build:web
node scripts/check-markdown-links.mjs
git diff --check
```

Reuse the existing same-lockfile dependency cache and pinned pnpm; no install is
needed. The root full aggregate and live browser scenarios belong to the release
and sole browser owners.

## Migration impact

None: only presentation grouping and controls change. All fixed/default values
remain in the typed configuration and preserve existing validation and
serialization. No service identities, schemas, ports or compiler contracts
change.

## Security impact

No new authority, providers, permissions, secrets or deployment paths. The
existing conversion boundary preserves catalog-fixed values independently of
submitted form text; required attestations remain explicit. Optional errors and
validation targets must still expand and focus their owning section.

## Stopping condition

Owning tests, types, lint, build, formatting, local links and final review pass;
the supported/unsupported matrix and exact pending live scenarios are recorded;
a sealed patch and draft PR are available. Stop the affected action on an exact
denial or an uncertain semantic/export contract rather than infer support.

## Handoff

### Current source audit

There are 73 definitions, 139 directional connection rules and 34 validation
rules. The product presents 46 standalone cards, 19 owned configurations, four
related Configure resources and four secondary grouped variants. EC2 is a
standalone card in both assistance modes. Search/setup and caller-supplied image
requirements are covered by focused UI tests. A missing live card has not been
reproduced against this source; live QA must record the deployed revision,
catalog identity, search/filter state and account/project context before
diagnosing deployment or caching.

The table below audits declared fields, ports and incident relationship
descriptors (`F/P/R`); it is not evidence that every AWS option or configuration
was executed. `C` means card, `O` owned configuration, `R` related Configure
resource and `V` secondary product variant.

| Service ID (prefix `aws.`)                | Surface | F/P/R   |
| ----------------------------------------- | ------- | ------- |
| acm.public-dns-certificate                | C       | 10/3/3  |
| apigateway.http-api                       | C       | 4/3/3   |
| aurora.postgresql-cluster                 | C       | 25/4/4  |
| aurora.postgresql-cluster-parameter-group | C       | 5/1/1   |
| aurora.postgresql-instance                | C       | 10/1/1  |
| cloudfront.alias-configuration            | O       | 3/2/2   |
| cloudfront.cache-policy                   | C       | 11/1/1  |
| cloudfront.distribution                   | C       | 12/3/3  |
| cloudwatch.log-group                      | C       | 4/3/3   |
| cloudwatch.metric-alarm                   | V       | 10/1/1  |
| cognito.user-pool                         | C       | 12/2/2  |
| cognito.user-pool-client                  | R       | 8/2/2   |
| dynamodb.table                            | C       | 7/2/3   |
| ebs.volume                                | C       | 9/3/3   |
| ebs.volume-attachment                     | C       | 4/2/2   |
| ec2.availability-zone                     | C       | 1/3/3   |
| ec2.gateway-vpc-endpoint                  | C       | 3/3/3   |
| ec2.instance                              | C       | 26/6/6  |
| ec2.internet-gateway                      | C       | 1/2/2   |
| ec2.nat-gateway                           | C       | 3/2/2   |
| ec2.route                                 | O       | 1/3/3   |
| ec2.route-table                           | C       | 1/4/4   |
| ec2.route-table-association               | O       | 0/2/2   |
| ec2.security-group                        | C       | 2/12/15 |
| ec2.security-group-egress-rule            | O       | 5/1/1   |
| ec2.security-group-ingress-rule           | O       | 5/1/1   |
| ec2.subnet                                | C       | 4/9/12  |
| ec2.vpc                                   | C       | 4/8/8   |
| ecr.image-reference                       | O       | 4/2/2   |
| ecr.repository                            | C       | 5/1/1   |
| ecs.cluster                               | C       | 2/1/1   |
| ecs.container-definition                  | O       | 14/4/4  |
| ecs.service                               | C       | 6/5/5   |
| ecs.task-definition                       | C       | 7/4/4   |
| elb.application-load-balancer             | C       | 10/5/5  |
| elb.backend-access-configuration          | O       | 3/3/3   |
| elb.https-listener                        | C       | 7/3/3   |
| elb.target-group                          | C       | 14/5/5  |
| eventbridge.event-bus                     | C       | 4/5/5   |
| eventbridge.rule                          | R       | 7/2/2   |
| eventbridge.target                        | O       | 7/7/7   |
| fsx.lustre-file-system                    | C       | 3/3/3   |
| fsx.ontap-file-system                     | V       | 3/3/3   |
| fsx.ontap-storage-virtual-machine         | R       | 1/2/2   |
| fsx.ontap-volume                          | R       | 3/1/1   |
| fsx.openzfs-file-system                   | V       | 4/2/2   |
| fsx.windows-file-system                   | V       | 5/2/2   |
| iam.instance-profile                      | C       | 2/2/2   |
| iam.managed-policy-attachment             | O       | 3/2/2   |
| iam.policy-condition                      | O       | 3/1/1   |
| iam.policy-document                       | O       | 2/11/11 |
| iam.policy-statement                      | O       | 7/12/12 |
| iam.role                                  | C       | 2/6/11  |
| kms.key                                   | C       | 10/5/5  |
| lambda.function                           | C       | 8/18/21 |
| lambda.vpc-access-configuration           | O       | 2/3/3   |
| rds.db-instance                           | C       | 26/3/3  |
| rds.db-parameter-group                    | C       | 5/1/1   |
| rds.db-subnet-group                       | C       | 3/3/3   |
| region.boundary                           | C       | 1/1/1   |
| route53.public-hosted-zone                | C       | 7/1/1   |
| s3.bucket                                 | C       | 6/9/11  |
| s3.bucket-cors-configuration              | O       | 4/1/1   |
| s3.bucket-lifecycle-configuration         | O       | 4/1/1   |
| s3.bucket-notification-configuration      | O       | 6/1/1   |
| secretsmanager.secret                     | C       | 6/3/3   |
| sns.subscription                          | O       | 7/3/3   |
| sns.topic                                 | C       | 5/4/5   |
| sqs.queue                                 | C       | 8/7/10  |
| sqs.redrive-configuration                 | O       | 3/1/1   |
| stepfunctions.state-machine               | C       | 8/4/5   |
| wafv2.alb-association                     | C       | 0/2/2   |
| wafv2.web-acl                             | C       | 17/1/1  |

The checked
[service-extension artifact](../../../packages/provider-aws/src/compiled/service-extension-v1.json)
declares modeling/configuration/validation support for all 73. Region and
Availability Zone are ambient, not standalone IaC resources. WAF Web ACL and ALB
association are CloudFormation-only **proof**; Terraform is pending. The other
69 bounded definitions declare both targets supported, sometimes through an
owning projection. S3 settings, SQS redrive, EventBridge targets and Lambda VPC
configuration intentionally use nested projections rather than fabricated
standalone CloudFormation resource types. Ten definitions participate in
supported generated-code patterns; arbitrary application generation is not
established.

FSx families and CloudWatch resources already share product presentation groups.
No additional genuinely equivalent graph identities were confirmed. RDS
instances versus Aurora members, roles versus profiles, volumes versus
attachments, ingress versus egress and policy documents/statements/conditions
have distinct lifecycles or semantics. They should retain those identities while
related settings remain grouped in the existing Configure surfaces.

### EC2 and export proof

EC2 has seven caller-required inputs without defaults: AMI ID, AMI Region, image
architecture, root-device name, image minimum root size, instance type and
requested root size. The UI now presents these first, four optional overrides
separately and fifteen fixed values as expandable explanations. Fixed scalar
singleton enums and fixed booleans with defaults retain their catalog values;
no-default attestations remain explicit. An incompatible saved value retains an
editable repair path. List member restrictions do not become fixed-list
declarations.

The launch slice remains private Linux with six T3/T4g types, explicit image
provenance, IMDSv2 and encrypted baseline gp3 root storage. Windows,
Spot/fleets, Auto Scaling, bootstrap scripts, SSH keys and live AMI lookup
remain unsupported. Ports cover subnet, security groups, instance profile,
optional root KMS key, EBS attachment and ALB target. Typed validation checks
image/instance compatibility, Region, profile/trust, VPC and applicable storage
topology. Connections are limited to the 139 catalog descriptors; arbitrary
all-to-all links are not promised.

Read-only parallel audit proof on this exact source: the EC2 provider suite
passed 26 cases in 5.97 seconds; `go test . -run '^TestEc2' -count=1` passed
(6.503 seconds package execution), including both native targets, invalid launch
refusal, profile outputs and immutable x86/Arm compilation.
`go test . -run '^TestEbsBothNativeTargets$' -count=1` passed (10.852 seconds).
The provider catalog generator `--check` passed. These are local synthetic
proofs, not live AWS deployment evidence. No compiler/export omission was
confirmed and no export contracts were edited.

### Confirmed remaining metadata correction

P2:
[EC2 capability text](../../../packages/provider-aws/src/catalog/services/ec2-compute.ts)
still says data disks are unsupported, while the
[EBS extension](../../../packages/provider-aws/src/catalog/services/ebs.ts)
supports separate encrypted gp3 volumes and up to four same-AZ attachments. The
minimal correction is to distinguish unsupported inline/AMI extra mappings from
the supported separate volume/attachment slice. It requires regeneration of the
catalog digest and corresponding icon catalog binding. That source correction is
queued through the parent for coordinated export/release integration, rather
than silently invalidate the separately sealed approved icon packet. The
product's current wording is a known documentation defect; local native EBS
behavior passed.

### Verification and integration

The first three-suite UI/model run passed 50 cases and failed two: one revealed
a missing repair path for an incompatible saved singleton value, which was
corrected; the other expected obsolete editable controls for fixed secret
metadata, and was updated to verify explanatory output plus retained typed
values. The subsequent four owning suites passed all 57 cases in 27.04 seconds.
Test-case delta is zero. Reused assertions protect required inputs, explicit
attestations, fixed/default serialization, repair, error focus and
assistance-mode form preservation; these core configuration risks meet the 8/10
threshold.

The compact empty state preserves its accessible heading and existing
layout/theme; its owning case passed in 24.73 seconds (0.275 seconds test
execution; 34 unrelated cases excluded). The 15-task web/dependency type-check
passed in 2 minutes 54.32 seconds. A final web-only type-check also passed after
the repair correction. The production build passed all 15 tasks in 2 minutes
8.66 seconds (Vite 8.11 seconds), with existing large-chunk warnings. The final
form-model suite passed all 11 cases in 8.32 seconds after adding coverage that
an optional singleton retains its meaningful unset choice. No current catalog
field matches that optional singleton case, so the final guard does not alter
current service grouping. A final web type-check, changed-model lint/format
checks and production web build passed (Vite 3.68 seconds). Full web lint
passed; all 336 Markdown files' local links passed. The full security check
passed: static verification, no high-confidence secrets in 3,909 text files
(eight non-text inputs explicitly skipped), and npm audit with nine moderate
advisories and no high/critical advisories. No dependencies changed.

The final diff was reviewed with no unresolved high-priority finding in this
presentation patch. The source metadata contradiction above remains an explicit
P2 follow-up. Browser selectors in `editor-experience.spec.ts` and
`desktop-resolution-qa.spec.ts` expand Optional settings before editing and
verify fixed Runtime as explanatory text. They are prepared for the sole browser
owner and were not browser-run here. Navigation owner retains
`desktop-service-configuration.spec.ts`, dashboard/typed-backend selectors and
notification badge assertions; no conflicting edit was made there. Publication
and PR identity are recorded in the external handoff after their actual result.

Current main already contains the `07ebcc3` workspace-tour packet's exact diff
(confirmed by a successful reverse apply check); do not apply it again. The
sealed `84c89eb` exact-step resume still applies cleanly. The release owner can
integrate it and `6975e7b` approved icons independently of this current-main
patch. This change edits none of their implementation files or catalog/asset
bindings. Preserve their hashes and perform one final combined admission. The
navigation release should not wait for unrelated catalog expansion.

Final browser-source lint, web type-check and build passed after applying the
same compact message style to phone review; the last Vite build took 1.73
seconds. The browser scenarios themselves remain pending their existing owner.

Pending live scenarios: confirm EC2 search and Set up on the exact deployed
revision; verify seven initial required inputs, collapsed optional/fixed
sections, keyboard expansion and visible help; change an optional field,
add/connect the instance and export both supported targets with exact values;
verify invalid image/network/profile/storage inputs refuse export; confirm fixed
values are supplementary explanations and the blank-canvas message is compact at
desktop/tablet/phone widths. Live acceptance belongs to the sole browser owner;
merged/deployed/live-tested status is not inferred from local checks.
