# Audit catalog discovery and simplify service configuration

- Milestone: M9 controlled beta
- Workflows: catalog discovery, required/optional configuration, typed
  connections and export
- Status: complete locally; consolidated release and live acceptance pending
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
- [x] Correct EC2 EBS wording and regenerate current catalog and approved icon
      bindings locally while preserving the sealed tour/icon packets.
- [x] Verify derived current fixtures/goldens and frozen model input
      preservation; prepare the local-only correction packet for the release
      owner.

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

The PR7 presentation change has no persisted shape migration. The coordinated
wording follow-on changes the exact current catalog digest and dependent asset,
compiler and generator pins; fixed/default values, identities, schemas, ports
and rendering semantics remain unchanged. Mutable drafts use the existing
lossless catalog-opening review before another immutable freeze; old revisions
and evidence are not silently relabeled. Frozen model contexts retain exact
original artifacts and remain read-only, separate from current editor/compiler
admission. The release owner must qualify this binding update against persisted
project load and export before deployment.

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

### Corrected EC2 metadata and coordinated bindings

The confirmed P2 in
[EC2 capability text](../../../packages/provider-aws/src/catalog/services/ec2-compute.ts)
said data disks were unsupported, while the
[EBS extension](../../../packages/provider-aws/src/catalog/services/ebs.ts)
supports separate encrypted gp3 volumes and up to four same-AZ attachments. The
wording now distinguishes unsupported inline/AMI extra mappings from the
supported separate volume/attachment slice, with up to four same-AZ attachments.
The new current catalog digest is
`sha256:5dc9603e3df5a09835946dd11554aae5ece39803f12aee118f1227e9a591f619`.
Approved icon set 1.22.1 binds that digest with asset digest
`sha256:6d4246caba52b2dd2535e675f44afb4eb452ed7bbc0a4a6a9e7f68c660272651`. All
55 mappings, 41 SVG files, the generated static imports and Hunter's October 29
source review/approval remain byte-identical to the sealed 1.22.0 packet. Only
the current binding and asset-set patch identity change, using the existing
canonical digest, manifest validation and registration generator APIs.

The sole current catalog is regenerated under pre-live policy. Compiler and
application generator pins, current synthetic fixtures and derived golden hashes
are updated together. Reviewed generation commands retain their
category/confirmation/summary guards. The manifests gate now also refreshes the
two existing no-content and identifier-safe source inventories, using the same
projection and assertions as their existing golden checks.

The separately frozen regional-WAF 1.8 model input retains its original
`8e9b1b23...` digest and dataset/source commitments. Exact catalog and extension
bytes from the earlier source are retained alongside the existing frozen-71
input. Lazy read-only model resolution verifies both complete bodies and exact
bindings. Current-only mutation/compiler admission still rejects historical
bindings; no model invocation, provider activation or paid evaluation is added.

### Missing support versus discoverability

The per-definition source audit found no missing declared configuration
readiness, no missing field controls and no orphan relationship endpoints. These
are structural checks, not execution of every possible value combination. Of 139
connection descriptors, 112 declare an implemented free-form resolver. The other
27 use intentional alternate paths: seven canonical placements, thirteen
structured owner slots, two policy grammar relations, two exact resource-scope
relations and three supporting scope changes emitted by reviewed recipes. No
genuinely absent connection implementation was confirmed among those
descriptors. Arbitrary all-to-all connections remain unsupported.

Cognito app-client creation is available through the pool's related Configure
flow and canonical parent command; native renderers consume its containment
edge. Its descriptor's old task-boundary reason is stale explanatory metadata,
not evidence of absent parent creation or export. Its deliberate free-form
resolver exclusion remains unchanged in this bounded correction.

WAF Web ACL/association are the two actual pending Terraform surfaces; their
CloudFormation support remains proof only. Region and Availability Zone are
ambient context for both targets. The other 69 bounded definitions declare both
targets, including owned projections. Their explicit unsupported capability
lists continue to apply. Only ten definitions participate in reviewed generated
application patterns; no application/boot-script generation is added for EC2.

EC2 is under `root-placeable`: Guided labels it **Add directly**, Professional
labels it **Root-placeable**. It passes deployable/icon/visibility/group filters
as the standalone `aws.ec2.instance` card. Search normalizes and matches all
query tokens against ID, name and catalog education. **Set up EC2 instance**
collects caller-required configuration before Add. Existing local search/setup
tests prove that source behavior; source presence alone proves no live result.

The retained read-only live baseline at `2026-10-30T02:15:11.6627480Z` reports
frontend `/assets/index-BstLfSCo.js`, healthy API endpoints and no deployment
performed. It does not expose the served application source revision or catalog
digest. The `d2dd7619` source-binding receipt is explicitly local preparation
only. Thus neither receipt establishes which catalog is served, or verifies live
EC2 visibility. The live owner must capture that binding and actual search
result; no live pass is claimed.

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

The original PR7 diff was reviewed locally; its source metadata contradiction is
corrected by the coordinated follow-on above. Browser selectors in
`editor-experience.spec.ts` and `desktop-resolution-qa.spec.ts` expand Optional
settings before editing and verify fixed Runtime as explanatory text. They are
prepared for the sole browser owner and were not browser-run here. Navigation
owner retains `desktop-service-configuration.spec.ts`, dashboard/typed-backend
selectors and notification badge assertions; no conflicting edit was made there.
Publication and PR identity are recorded in the external handoff after their
actual result.

### PR7 CI finding and exact undo regression

Draft PR7 was published at `5bd8580c46511f89adac8166f261c6c9898caac4`, based on
`d2dd761903b192d3691c5601948a10b28df38d3f`. Publication automatically triggered
Public source CI run `41067695462`; no manual dispatch or rerun was requested.
The actual job log reports 1,676 web cases passed and one failed, with browser
stages skipped afterward. The failure at `service-setup.test.ts:141` is the
read-only-field expectation before the undo operation: it expected only
`preventDestroy`, but `valueMode` is now also a fixed singleton. This is a stale
assertion about the intentional new presentation contract, not evidence of a
failed undo command or a live incident.

The existing regression now requires both fixed fields, submits tampered fixed
values and verifies their exact retained catalog values, then requires that the
preview changes only description, encryption mode and recovery window. The
original full-document inverse equality and invalid-secret/protection refusals
remain intact. The owning five-case setup suite plus eleven form-model cases
passed all 16 cases in 39.94 seconds (0.716 seconds assertions). No case or
assertion was removed and no timeout increased. The failure log is retained in
the external handoff. PR7's CI remains failed for its original head; local
corrections are not a claim that this CI run passed.

### Menu and tutorial coordination

The completed local menu packet is `2a40d5791958ca4cede31448b4d6dd5b442788b1`.
The earlier coordination note was already received; its uncertain timed-out
follow-up was not blindly resent. The workspace tour now follows **Project work
→ selected Personal workspace/Organization → Personal account**, then the
profile shortcut. Copy explains that the selected scope's name accompanies its
usage/billing/settings and that Personal & organizations opens the switcher.
Keys and anchor contracts remain `workspace`/`Workspace`,
`organization`/`Organization`, `account`/`Account` and the profile trigger.
Existing actor-scoped dismissal, restart and semantic step restoration remain
unchanged; the owning lifecycle case passed in 5.60 seconds (0.804 seconds
assertions), with next/back/resume coverage extended in place. The separate
exact editor-step resume code is retained intact. No menu-owned implementation
or browser file was edited.

### Final coordinated delivery

The regenerated provider catalog/current-binding/EC2 suites passed 39 cases in
75.27 seconds. Application source/golden suites passed 33 cases in 30.62 seconds
after refreshing their derived artifact/build-contract identities; handler and
event-fixture checksums are unchanged. The reviewed `iac`, `application-source`
and `manifests` update gates passed, including the existing 14-case application
conformance suite and its unchanged non-gating baseline skip. Six CLI event
source cases passed; native compilation fixtures passed in 4.664 seconds.
Focused EBS/ELB/WAF native fixture regeneration passed in 51.509 seconds; native
EC2 cases passed after the repin in 10.431 seconds.

The frozen WAF mutation case timed out twice under concurrent generators at its
original five-second deadline; both failures remain in the evidence. After
generators finished, its unchanged owning suite passed both cases in 4.29
seconds (2.04 seconds assertions), without timeout or assertion changes. Seven
provider compatibility cases, the exact frozen-input generator check, provider
types and current catalog artifact checks also passed. Explicit opaque typing
keeps retained JSON input shapes behind the same full-body integrity and schema
checks; no admission condition is weakened.

All 15 production build tasks passed in 11 minutes 11.20 seconds during
concurrent local work (Vite 55.55 seconds; existing chunk warnings retained).
The exact-once bundle check passed for 41 canonical SVGs and 121,059 bytes.
Web/provider type checks, changed-source lint and local Markdown links passed.
The full security check passed with 12 static cases, no high-confidence secret
patterns in 3,919 text files (eight non-text files explicitly skipped), and nine
moderate npm advisories with none high/critical. Golden-path security tests
passed all 12 cases in 0.74 seconds after Windows permissions admitted their
task-confined temporary symlink fixtures; normal sandbox EPERM evidence was
retained. No security check or assertion was removed.

Preservation proof checks all 55 approved mappings and all SVG bytes, source
review, static imports, exact editor-step resume implementation, frozen-71
artifacts and frozen WAF commitments. The new frozen-73 inputs are exact old
bytes. Nineteen native templates are identical except catalog provenance; 94
shared golden changes are confined to README, semantic-summary and artifact
manifest metadata. Generated executable and infrastructure bodies did not
change. The external handoff records the final commit, patch hashes, source
inventory and source-bound raw checks once, including retained failed attempts.

Current main already contains the `07ebcc3` workspace-tour packet's exact diff
(confirmed by a successful reverse apply check); do not apply it again. The
sealed `84c89eb` exact-step resume still applies cleanly. The release owner can
integrate it and `6975e7b` approved icons independently of this current-main
patch. PR7 edits none of their implementation files or catalog/asset bindings;
this follow-on preserves their implementations while regenerating only the
current metadata binding and aligning workspace-tour copy. Preserve the sealed
packet hashes and perform one final combined admission. The navigation release
should not wait for unrelated catalog expansion.

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
