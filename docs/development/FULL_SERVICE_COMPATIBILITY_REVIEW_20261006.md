# CloudMarkup full installed AWS catalog review — 2026-10-06

The original review covered **71 definitions, 437 configuration properties and
137 connection descriptors**. This condensed copy retains every definition
decision/workflow and relationship purpose, all findings matrices and active
integration obligations. Repeated catalog dumps and expanded probe logs remain
recoverable in the immutable full review (private historical evidence, omitted
from this distribution). This is source-bound October 6 evidence, not a new
release qualification.

Keep independently addressable native resources separate; group product families
and edit owned configurations within their owner. The catalog is intentionally a
bounded infrastructure model, and its cards should communicate that scope
clearly. Confirmed importer discrimination is fixed in an isolated patch. The
catalog metadata corrections are reviewable proposals and have not changed
installed admission.

## Exact source and coverage

| Binding                                                  | Value                                                                                                                                    |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Review base                                              | 9ab1ddb4085b2397ee40095a286d5c6d10e852c2                                                                                                 |
| Installed catalog                                        | aws.cloudmarkup.notes-api-catalog@0.30.0                                                                                                 |
| Canonical catalog digest                                 | sha256:84c6691236f5767565afc3d49fd9ec25786c61a4c49883387dfcf1a6e9f3ec35                                                                  |
| Catalog file byte SHA-256                                | sha256:774024e64b18fbfa140ad674a8cab1d9a0e184bce51de56cd2a2049d5b255360                                                                  |
| Last independently verified live source supplied to task | 3a9a3c330f5060aca769400f457ef00a9c8d7fc8                                                                                                 |
| Deployment observation                                   | Run 37461306335 for 9ab inspected at 13:09 UTC: Chromium/quality failure, deploy skipped; no subsequent live verification in this review |
| Baseline delta                                           | 0.23→0.30:54→71 definitions;33→48 deployable flags;108→137 connections;27→33 validators                                                  |
| Current scope                                            | 24 AWS product/service families;48 deployable flags+23 config/boundary flags                                                             |
| Validation                                               | 33 exact registered validators;all 71 closed schemas;55 CloudFormation mapping rows;133 direct metadata bindings                         |
| Resolver sweep                                           | 128 declared directed service pairs;4,913 undeclared;5,041 total                                                                         |
| Rule implementations                                     | 110 automatic implementations;27 descriptive ownership descriptors                                                                       |
| UI projection                                            | 71 definitions/437 fields/27 owned slots/137 relationships;catalog parent edges                                                          |
| Current generated artifacts                              | Unchanged;catalog generation --check passed                                                                                              |

A false deployable flag does not mean no native export: VPC/subnet boundaries
and owned routes, associations, rules and subscriptions can still have native
identities. Four placement boundaries and nineteen other config/resource
definitions make up the 23 nondeployable flags. The27 owned slots and27
descriptive relations are separate counts. The initial report covered the exact
17-definition expansion; this review also covers every older definition and
every current rule. EFS remains inactive/outside installed 71. “Latest” is not
evidence of a new deployment.

Added definitions: `aws.acm.public-dns-certificate`,
`aws.aurora.postgresql-cluster`,
`aws.aurora.postgresql-cluster-parameter-group`,
`aws.aurora.postgresql-instance`, `aws.cloudfront.alias-configuration`,
`aws.cloudfront.cache-policy`, `aws.cloudfront.distribution`, `aws.ebs.volume`,
`aws.ebs.volume-attachment`, `aws.elb.application-load-balancer`,
`aws.elb.backend-access-configuration`, `aws.elb.https-listener`,
`aws.elb.target-group`, `aws.rds.db-instance`, `aws.rds.db-parameter-group`,
`aws.rds.db-subnet-group`, `aws.route53.public-hosted-zone`.

Historical baseline: `19912725c321c4f4719d5dc91634611e02e158ef`, catalog 0.23.0,
digest
`sha256:7cd7e7012e1758fd1c17bdf1c0823bc55caae868b36213ea3b3c7d3e73195dc9`. The
preserved initial review records RDS/Aurora/DNS/CloudFront/ALB/EBS source waves
and the installed-only projection. This full review is bound to the exact 9ab
source, with no current live deployment inferred.

## Prioritized corrections

| Priority | Finding                                                       | State                                                                 | Concrete correction and implications                                                                                                                                                                                                                                                                                                                                  | Source                                                                                                                      |
| -------- | ------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| P1       | Native import collision / engine assertion                    | Fixed in isolated importer patch                                      | CloudFormation DBInstance was last-write-wins for RDS/Aurora; FileSystem for four FSx families. Explicit literal engine/family/cluster evidence now selects a variant; missing, intrinsic or conflicting evidence stays native/unresolved. DBCluster also requires aurora-postgresql. Stored snapshots and ownership are unchanged.                                   | packages/repository-importer/src/service.ts:706, 1521                                                                       |
| P1       | Attestation controls are locked before completion             | Separate earlier minimal patch; not applied here                      | CloudFront publicContentAttested and Route53 domainControlAttested are required const true without a default. Current fixed-checkbox rendering cannot collect the attestation. The earlier 4-file web patch permits explicit completion while preserving schema validation.                                                                                           | apps/web/src/features/editor; service-review-attestation.patch                                                              |
| P1       | Remaining specialized native import claims                    | Proposal / bounded residual                                           | Native types alone do not prove FSx VolumeType ONTAP, public HostedZone, public DNS ACM certificate or Aurora parameter family. Terraform RDS cluster/member engines are not established from the redacted HCL expression digest. Need typed parser discriminators with negative tests; no literal reconstruction, ownership or deployment authority may be inferred. | packages/repository-importer/src/service.ts; native primary references below                                                |
| P2       | CloudFront generated OAC missing from CF descriptor           | Separate source-only proposal                                         | Renderer already emits one AWS::CloudFront::OriginAccessControl; distribution projection lists none. Add the type only to distribution, leaving cache policy unchanged. Native resources and least-privilege origin policy already exist.                                                                                                                             | packages/provider-aws/src/catalog/services/cloudfront.ts; services/iac-compiler/cloudfront.go                               |
| P2       | FSx Lustre generated association missing from CF descriptor   | Separate source-only proposal                                         | Renderer already emits AWS::FSx::DataRepositoryAssociation for the canonical S3 relationship. Add that existing generated type; do not introduce a new service card.                                                                                                                                                                                                  | packages/provider-aws/src/catalog/services/fsx.ts; services/iac-compiler/fsx.go:376                                         |
| P2       | Step Functions generated error log missing from CF descriptor | Separate source-only proposal                                         | Renderer already emits AWS::Logs::LogGroup. Record existing generated projection with current bounded logging/retention; no new logging behavior.                                                                                                                                                                                                                     | packages/provider-aws/src/catalog/services/step-functions-eventing.ts; services/iac-compiler/cloudformation_eventing.go:313 |
| P2       | SNS pseudo-property mapping                                   | Separate source-only proposal                                         | subscriptionName is semantic identity metadata, not CloudFormation StableIdentity or Terraform stable_identity. Remove fictitious direct bindings and add semanticConfigurationKeys; preserve native graph/deployment IDs.                                                                                                                                            | packages/provider-aws/src/catalog/services/sns-eventing.ts                                                                  |
| P2       | HTTPS listener port help is misleading                        | Targeted wording proposal                                             | Shared port help describes HTTP backend/health semantics even for the fixed HTTPS viewer port443. Give listener-specific help and keep backend help on target group; requires reviewed successor because catalog bytes change.                                                                                                                                        | packages/provider-aws/src/catalog/services/elb.ts:314                                                                       |
| P2       | Missing vendor assets                                         | 15 prepared official mappings require owner decision; older8 excluded | 71 definitions: 30 approved assets, 23 missing references, 18 without icon contracts. Generic neutral rendering is a visible fallback. No new mappings promoted and old approval cannot authorize changed mapping.                                                                                                                                                    | service-review-icon-coverage.json; icon decision appendix                                                                   |
| P3       | Global unknown Region availability and qualitative cost hints | Product clarification proposal                                        | All71 availability descriptors say unknown. Cost/security flags are broad qualitative annotations, not live prices or a numerical estimator. Curate field-specific help, physical AZ/topology prerequisites and lifecycle charges without claiming account/quota/runtime proof.                                                                                       | Catalog definitions and education below                                                                                     |
| P3       | Stale compiler local instructions and redirected education    | Documentation proposal                                                | Compiler scoped AGENTS lists older registry tuples while current compiled registry admits exact 0.30 only. Three educational URLs redirect and Cognito guided setup is a weak semantic link. Refresh after owner review, preserving historical deployment records.                                                                                                    | services/iac-compiler/AGENTS.md; primary source receipt appendix                                                            |

## Structural decisions and effects

An AWS product/service is a catalog grouping. A native resource keeps its
independent graph/deployment identity, lifecycle and references. An owned
configuration is edited through its canonical owner even when Terraform emits a
separate native resource or CloudFormation nests properties. A variation belongs
in a typed option only when its identity and bounded semantics remain coherent.
No definitions have been reclassified or collapsed.

| Decision                                                                                      | Rationale                                                                                                                                                   | AI/export/import/cost/saved-project/test consequences                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Keep RDS DB, Aurora cluster, members and two parameter families distinct; share subnet group  | Storage/credentials/backup belong to cluster; member AZ/failover/native DBInstance identity remains independent. Parameter-group families and scope differ. | AI needs explicit cluster/member and typed edges. Both exports preserve separate addresses. Import must discriminate shared native types. Estimate capacity/storage once per real resource; retain original graph keys/revisions. Mixed shared subnet-group export now tested. |
| Keep Route53 zone and ACM certificate distinct; viewer/regional use is an option              | Authority, issuance, Region and retention differ. A zone may validate several certificates.                                                                 | DNS/cert edges and pending external authority remain explicit. CF inline validation versus TF records/waiter is owned projection. No import adoption or cross-Region deploy inference. Charges/lifecycle remain independently visible.                                         |
| Keep CloudFront distribution and reusable cache policy; alias/OAC/bucket policy are owned     | Distribution/cache policy have independent native identities; alias and generated origin protection describe one owner intent.                              | AI distinguishes public viewers from signed S3 origin. No extra OAC service card or cost double counting. Metadata proposals retain renderer outputs; digest transition must be reviewed before saved-project admission changes.                                               |
| Keep ALB, target group and listener native identities; backend-access is owned                | Scheme/backend mode are variations; listener/cert routing/target health and peer SG rules have distinct relationships.                                      | Helper can guide setup while Professional mode shows IDs. Export/import keep native resources. Cost belongs to ALB/targets; generated SG/attachments must not be charged as extra ALBs. Review lifecycle/reference tests before any UI regrouping.                             |
| Keep EBS volume and owned attachment native identities; EC2 root storage stays EC2 config     | Independent data volume has retained data, AZ, KMS and attachment identity; root launch disk is an instance setting.                                        | AI must require same physical AZ and guest readiness; exporters retain typed references. Imports preserve each native address; estimate retained/unattached volumes and instance root disk separately.                                                                         |
| Group FSx family selector; retain specific family definitions, SVM and volume resources       | One AWS product includes different native Terraform types, topology, prerequisites and lifecycles.                                                          | Variant switching must create a reviewed new graph intent, not relabel existing IDs. FileSystemType import now selects explicitly. Family-specific cost units and ownership remain distinct.                                                                                   |
| Keep Standard/FIFO, gateway S3/DynamoDB, ALB scheme and bounded backend selections as options | Current shared identity/schema and compiler-specific validation already model variations.                                                                   | No duplicate service cards needed. AI uses exact enum and dependent rules; import must prove a variant where claiming one. New unsupported modes need full schemas/compiler/tests, not more dropdown values.                                                                   |
| Keep policy/route/rule/subscription/container configs under owners                            | Configuration editing and native projection are different concerns.                                                                                         | Maintain parent+owner-edge consistency, generated provenance/adoption and exact reference/cardinality. Graph keys and target-specific native resources remain preserved. Cost follows actual capacity, not every visible config card.                                          |

The per-definition decision matrix supplies the specific rationale, supported
scope, novice/professional workflow and cost drivers for every item. These
recommendations change neither current AI authority nor exporter behavior. Any
later regrouping must preserve exact IDs, parent/owner constraints, reference
contracts and saved revision provenance; structural source changes require
parent/user review.

## Verification and practical limits

| Command / evidence                                                                                  | Result                                                                                                        | Bounded meaning                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pnpm exec vitest run packages/repository-importer/src/service.test.ts                               | 63 tests passed;14.72s                                                                                        | RDS/Aurora engine+cluster discriminator, reversed catalog order, FSx literal family, ambiguity, schema roundtrip and existing goldens.                                                                                                                      |
| Focused provider/editor/AI files selected with git ls-files, then pnpm exec vitest run              | 45 files/926 tests passed;60.17s                                                                              | Installed schemas/defaults/reference authority, all 71/137 AI grounding and Guided/Professional model/creation behavior. No rendered live UI claim.                                                                                                         |
| Actual compiler executable;2 API parser integration files; --testTimeout 30000 --maxWorkers 1       | 2 files/16 tests passed;18.64s                                                                                | Parser2.9.0 authority, importer1.0.2, snapshot digests and independent temporary-directory reproduction. First default5s run had4 startup timeouts; preserved, no production timeout change.                                                                |
| go test ./... -json -count=1                                                                        | 4 packages passed;189 top-level tests;2,049 subtest/fuzz-seed pass entries (2,238 total passing test entries) | Complete local compiler suite and new immutable RDS+Aurora2-member coexistence regression. Fuzz seeds are not a fuzz campaign or AWS provider execution.                                                                                                    |
| service-full-runtime-probe.mjs                                                                      | 5,041 pairs,137 rule-negative checks,437 field type counterexamples passed                                    | 88 successful empty-prerequisite resolver command previews;remaining49 are22 prerequisite refusals+27 descriptive rules. Empty configs are incomplete; this is no universal positive compilation claim. Saturation fixtures may trigger overlapping limits. |
| service-full-ui-probe.mjs                                                                           | 71 definitions/437 fields/27 slots/137 relationships verified                                                 | Built editor adapter required/default/const/valueSource and owner-port contracts. Browser rendering is untested here.                                                                                                                                       |
| pnpm catalog:check                                                                                  | Passed;generation --check only                                                                                | No installed bytes/digest regenerated.                                                                                                                                                                                                                      |
| pnpm --filter @cloudmarkup/repository-importer type-check; focused ESLint; Go vet; git diff --check | Passed                                                                                                        | No manifests/dependencies/migrations/schema version changed.                                                                                                                                                                                                |
| pnpm security:check                                                                                 | Passed high threshold;7 existing moderate vulnerabilities                                                     | Static6 workflows/62 owned-source goldens/195 TF files;3,925 text secret scan files with 7 binary skips. No broad dependency/security clearance claim.                                                                                                      |
| Four patch git apply --check checks against pristine exact base                                     | All passed                                                                                                    | Source patch applicability only; metadata proposals not regenerated or integrated.                                                                                                                                                                          |
| Earlier separate attestation web patch                                                              | 11 model+24 dialog tests, lint/type/build passed                                                              | Earlier full web run:1,713/1,719 passed;6 unresolved failures; baseline provenance not established preserved in original report. This patch has not been combined with importer/visual work.                                                                |
| Official proposed15 icon mappings                                                                   | SVG policy and48/24px renders passed                                                                          | Existing promotion dry-run refuses reused old owner approval. No runtime promotion and no complete icon coverage.                                                                                                                                           |

No authenticated live catalog/canvas/inspector trial, screenshot proof of all 71
cards, real AWS account/quotas/Region availability, Terraform plan/apply,
CloudFormation deployment, IAM effective authorization, runtime behavior, paid
export/AI or full integrated release CI is claimed. Release admission remains
with the readiness owner and requires completed visual/staff-trial work and one
exact combined candidate. Existing source-golden/negative suites supply family
coverage; the newly added cross-family positive covers shared RDS/Aurora
placement, not every possible graph combination.

All71 Region descriptors explicitly report unknown. Catalog min/max/enums are
bounded product contracts, not AWS maximums or exhaustive service support.
Patterns do not prove real domain/AMI/ARN/name availability. Required defaults
do not prove prerequisite graph readiness. Security/retention settings may
prevent native destruction while runtime object lifecycle can still expire data.
Cost notes below identify units/continued charges; no numeric estimator or
current price was established.

## Definition decision matrix — every 71

| Definition                                                                               | Added0.23→0.30 | Classification / proposal                                                | Rationale                                                                                                                                      | Review finding / bounded scope                                                                                                                                                                                                                                                                                                    | Guided + Professional workflow                                                                                             | Cost / lifecycle drivers                                                                                        |
| ---------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| ACM public DNS certificate (aws.acm.public-dns-certificate)                              | yes            | Separate native resource                                                 | Certificate issuance, renewal and retention have their own identity and can serve several ALB listeners. Keep purpose/Region as configuration. | Current scope is new public RSA-2048, one canonical domain and managed DNS validation. us-east-1 viewer intent does not create cross-Region orchestration. Existing/imported/private/wildcard/SAN/email certificates stay outside export scope. Native importer type alone does not prove public DNS intent.                      | Expose a certificate helper from ALB/CloudFront and show its zone, intended use, Region and pending external issuance.     | Certificate/export options and downstream serving costs; no live certificate readiness check.                   |
| API Gateway HTTP API (aws.apigateway.http-api)                                           | existing       | Separate native resource; protocol variation remains bounded             | HTTP API has its own native identity; REST/WebSocket require different resource families and later contracts.                                  | JWT is required and CORS is fixed false. An API invocation edge is distinct from JWT issuer/audience relationships. No arbitrary endpoint, domain, WAF or private API is implied. Default notes-api name is template intent.                                                                                                      | Explain HTTP API scope and require concrete CORS policy before introducing a switch.                                       | Requests, data transfer and related Lambda/Cognito use.                                                         |
| Aurora PostgreSQL Serverless v2 cluster (aws.aurora.postgresql-cluster)                  | yes            | Separate native resource                                                 | Aurora cluster owns storage, credentials, backup and capacity; standalone RDS and members have different lifecycle/export identities.          | Bounded PostgreSQL 16, nonzero Serverless v2 capacity and Aurora Standard are product choices. EngineMode remains provisioned. One two-AZ subnet group, TLS cluster group and private SG path are required. No Data API, scale-to-zero or customer KMS is compiled. Import now requires literal PostgreSQL engine.                | Group RDS/Aurora under database product selection; keep actual cluster and members inspectable.                            | ACUs, storage, I/O, backups and managed credentials; nonzero floor and retention can continue charges.          |
| Aurora PostgreSQL cluster TLS parameters (aws.aurora.postgresql-cluster-parameter-group) | yes            | Separate reusable native resource                                        | A named cluster parameter group is independently addressable and can be shared. It is not the standalone DB parameter group.                   | Only aurora-postgresql16 with forced TLS and retained user ownership is supported. Additional settings/families need typed schemas and compiler evidence. Native type alone does not establish PostgreSQL family in imports.                                                                                                      | Offer a TLS parameter-group helper while preserving an explicit reusable resource and references.                          | No standalone capacity charge; affects cluster behavior and reboot/application readiness.                       |
| Aurora PostgreSQL Serverless v2 member (aws.aurora.postgresql-instance)                  | yes            | Separate cluster member resource                                         | Members have their own DBInstance identifiers, AZ, failover tier and lifecycle; they cannot become a count-only cluster option.                | Current scope is db.serverless, private access and one canonical cluster edge; storage/credentials/backup remain cluster intent. Root graph placement is logical, and membership is relational. Shared CloudFormation DBInstance import is now engine/cluster discriminated.                                                      | Create members from a cluster helper with explicit AZ and promotion tier; preserve each identity.                          | Serverless member capacity and availability decisions; two members are not free redundancy.                     |
| CloudFront alias configuration (aws.cloudfront.alias-configuration)                      | yes            | Owned configuration with native DNS projections                          | Alias expresses exact distribution/certificate ownership and generates A/AAAA records; it is not a second CloudFront service.                  | One exact domain, viewer certificate and matching attested public zone; parent and owner edge must agree. Managed aliases do not prove registrar delegation. Native DNS projections must retain stable ownership.                                                                                                                 | Keep in distribution settings and show DNS/certificate readiness.                                                          | DNS queries and distribution usage; avoid treating projected records as extra service cards.                    |
| CloudFront static cache policy (aws.cloudfront.cache-policy)                             | yes            | Separate reusable native resource                                        | Cache policy has an independent ID and lifecycle and may be shared by distributions.                                                           | Static public-content cache only: ordered TTLs, no viewer cookies/headers/query strings, gzip/Brotli and retention. This is unsuitable for personalized content without a new reviewed cache-key/origin-request contract.                                                                                                         | Offer a static-cache preset, retaining the visible reusable policy and TTL tradeoff.                                       | Cache effectiveness affects origin requests and transfer; retained policy alone is not a throughput resource.   |
| CloudFront distribution (aws.cloudfront.distribution)                                    | yes            | Separate native resource                                                 | Global distribution, enabled state and domain have independent identity; viewer certificate mode is a configuration variation.                 | Signed private S3 origin is read-only while viewers remain public. Explicit content attestation has no default and needs the separate UI fix. The existing OAC is missing from CF generated-type metadata; source proposal remains isolated. Default-viewer regional origin works without cross-Region certificate orchestration. | Lead with public viewer behavior, origin protection and enabled state; show one distribution plus owned OAC/policy intent. | Requests, transfer, price class and cache behavior; disabled default is an explicit readiness choice.           |
| CloudWatch log group (aws.cloudwatch.log-group)                                          | existing       | Separate native resource                                                 | Named log group, retention and lifecycle differ from its producer.                                                                             | STANDARD only, bounded retention values and prevent-destroy are intentional. ECS can share log groups; Lambda port limits remain exact. Generated Step Functions logs are a separate owned projection, not this explicit node.                                                                                                    | Surface log delivery and retention near workload setup; distinguish generated and user-owned logs.                         | Ingestion, storage, queries and retained data.                                                                  |
| CloudWatch metric alarm (aws.cloudwatch.metric-alarm)                                    | existing       | Separate native resource                                                 | Alarm has a native identity and lifecycle distinct from a metric producer.                                                                     | This definition is a bounded Lambda Errors/Sum alarm, not generic metric/composite monitoring. notBreaching can hide missing data and no notification action is inferred.                                                                                                                                                         | Label it as Lambda error monitoring and explain threshold, period and missing data.                                        | Alarm/metric evaluation and downstream notification use.                                                        |
| Cognito user pool (aws.cognito.user-pool)                                                | existing       | Separate native resource                                                 | Directory and users have a lifecycle separate from app clients.                                                                                | Email identity, verified-email recovery and bounded MFA/password choices are explicit. Optional MFA does not require every user to enroll. Existing users/data migration and full threat protection are outside this review.                                                                                                      | Keep app clients beneath the pool and distinguish directory settings from application credentials.                         | User authentication activity and optional messaging/features.                                                   |
| Cognito user pool app client (aws.cognito.user-pool-client)                              | existing       | Owned native child resource                                              | App client belongs to one pool but has its own ID and lifecycle; changing token validity is configuration, not a separate service.             | SRP/refresh authentication and a public client without generated secret are fixed. One canonical owner supplies the JWT audience; client registration alone does not implement frontend login.                                                                                                                                    | Create from pool settings and expose validity units clearly.                                                               | Pool use, token/session security and downstream app behavior.                                                   |
| DynamoDB table (aws.dynamodb.table)                                                      | existing       | Separate native resource; billing variation is configuration             | Table identity/data lifecycle must remain separate from consumers.                                                                             | Current table is on-demand with string partition key, encryption, PITR and protection. Sort keys, indexes, streams and provisioned capacity need additional contracts rather than unsupported enum options. Regional service is not subnet-contained.                                                                             | Explain key/data contract and protection; show runtime data behavior separately.                                           | Requests, stored data and recovery/backup features.                                                             |
| EBS data volume (aws.ebs.volume)                                                         | yes            | Separate native resource                                                 | Data volume has its own AZ, encryption, retention and export identity independent of EC2 root disk.                                            | Encrypted gp3 only with bounded size/IOPS/throughput; one AZ and optional customer-key relationship. Multi-attach is fixed false. Root EC2 storage remains EC2 launch configuration.                                                                                                                                              | Create a data volume in an AZ and then attach explicitly; keep root/data terminology clear.                                | Provisioned GiB, IOPS/throughput above included baseline and retained unattached storage.                       |
| EBS volume attachment (aws.ebs.volume-attachment)                                        | yes            | Owned native attachment resource                                         | Attachment has a distinct native identity and references a volume and instance. Device name alone must not replace those identities.           | Single canonical volume owner and same-AZ instance, Linux device allowlist, no forced detach and external guest formatting/mounting. Retention and guest state require explicit cleanup interpretation.                                                                                                                           | Create from volume settings; explain EC2 device mapping versus guest device/mount readiness.                               | Attachment itself is relational; underlying EC2/EBS charges and retained data matter.                           |
| Availability Zone (aws.ec2.availability-zone)                                            | existing       | Visual boundary; no deployable AWS resource                              | AZ represents placement, not a newly created AWS service/resource.                                                                             | Explicit physical AZ name must belong to the modeled Region; two distinct AZ nodes do not prove two distinct physical zones. VPC containment is a diagram convention rather than AZ ownership by a VPC.                                                                                                                           | Explain that VPC spans AZs and subnets select an AZ; retain existing graph convention until structural review.             | Placement and resilience can change resource costs; boundary has no direct resource charge.                     |
| Gateway VPC endpoint (aws.ec2.gateway-vpc-endpoint)                                      | existing       | Separate native resource; S3/DynamoDB choice is variation                | Gateway endpoint has native identity, VPC/route-table bindings and lifecycle.                                                                  | Gateway only and service enum S3/DynamoDB; restricted policy is owned typed configuration. Endpoint policy complements rather than replaces resource/identity permission. It does not provide arbitrary internet egress.                                                                                                          | Use service selection within one gateway-endpoint card and show route tables/policy.                                       | Gateway endpoint is a connectivity choice; related transfer/service usage remains separate.                     |
| EC2 instance (aws.ec2.instance)                                                          | existing       | Separate native resource                                                 | Instance lifecycle, AMI and native address remain independent from volumes/profile.                                                            | Private Linux/HVM/EBS root with bounded t3/t4g and architecture attestation, IMDSv2 and encrypted gp3 root only. Root disk settings belong here; additional data volumes remain EBS resources. No source-created AMI, SSH ingress or bootstrap/user-data is inferred.                                                             | Require the AMI compatibility evidence and private network path; offer profile/storage helpers.                            | Instance hours, burst credits, monitoring, root disk and retained volumes.                                      |
| Internet gateway (aws.ec2.internet-gateway)                                              | existing       | Separate native resource                                                 | Gateway can attach to a VPC and retains a native identity.                                                                                     | Attachment and a route are separate typed relationships. Gateway existence alone does not make a subnet public or expose a private instance.                                                                                                                                                                                      | Show gateway attachment and route together in Guided setup.                                                                | Gateway/route intent is distinct from transfer/resource usage.                                                  |
| NAT gateway (aws.ec2.nat-gateway)                                                        | existing       | Separate native resource; supported availability mode is variation       | NAT has native identity, zonal placement and allocation lifecycle.                                                                             | Public zonal NAT requires caller-supplied allocation ID and subnet/IGW routes. EIP is not created or adopted by this definition. Private/regional NAT and IPv6 paths are unsupported contracts.                                                                                                                                   | Explain allocation prerequisite and per-AZ resilience/cost choice.                                                         | Gateway hours and processed/transfer data, including idle infrastructure.                                       |
| Route (aws.ec2.route)                                                                    | existing       | Owned native route resource                                              | Route belongs to a route table but has a stable native export address.                                                                         | One destination CIDR and exactly one modeled gateway/NAT target; no implicit default route or guessed target. Root creation is forbidden.                                                                                                                                                                                         | Edit from route-table settings without flattening away the route identity.                                                 | Traffic destination changes connectivity/transfer behavior; route is not its own throughput service.            |
| Route table (aws.ec2.route-table)                                                        | existing       | Separate native resource                                                 | Route table can be shared by subnets and owns routes/associations.                                                                             | Canonical VPC plus explicit subnet associations; public/private tier needs complete route checks. Default names are template labels, not live uniqueness evidence.                                                                                                                                                                | Create reusable table, then owned routes and associations.                                                                 | Associated gateways and transfer paths drive charges.                                                           |
| Subnet route-table association (aws.ec2.route-table-association)                         | existing       | Owned native association resource                                        | Association has distinct native identity even though graph marks it nondeployable.                                                             | Exactly one owner table and target subnet; one subnet cannot gain competing canonical table associations. It is not an independent AWS service.                                                                                                                                                                                   | Create from route table or subnet helper while preserving inverse/ownership.                                               | Relational mapping; costs belong to traffic/infrastructure.                                                     |
| Security group (aws.ec2.security-group)                                                  | existing       | Separate native resource                                                 | Group has native identity and can be referenced by multiple resources.                                                                         | One explicit VPC; ingress/egress rules are owned configurations with native projections. Absence of a configured rule must not imply an AWS default policy.                                                                                                                                                                       | Show effective inbound/outbound paths and related rules from the group.                                                    | Security/capacity effects are indirect; avoid a fictitious SG hourly estimate.                                  |
| Security group egress rule (aws.ec2.security-group-egress-rule)                          | existing       | Owned native rule resource                                               | Rule belongs to one group; separate native identity avoids inline/standalone conflicts.                                                        | CIDR/protocol/port bounds are explicit, including special ICMP/all-protocol semantics. Peer-group rules generated for ALB are a separate canonical ownership path.                                                                                                                                                                | Edit beneath group with destination and protocol-specific units.                                                           | Controls access/traffic; no independent service capacity.                                                       |
| Security group ingress rule (aws.ec2.security-group-ingress-rule)                        | existing       | Owned native rule resource                                               | Owned rule identity and direction must be preserved.                                                                                           | Source CIDR and TCP/UDP/ICMP/all-protocol constraints are explicit. Do not silently synthesize open ingress from a connection label.                                                                                                                                                                                              | Show source authority and port/protocol meaning near the group.                                                            | Exposure/traffic consequences, not an independent charged service.                                              |
| Subnet (aws.ec2.subnet)                                                                  | existing       | Placement boundary with native resource projection                       | Subnet is both a diagram container and a native deployable identity; false deployable flag must not be read as no export.                      | Explicit CIDR, access tier and AZ; no IPv6 autoassignment. Tier alone does not establish internet reachability, routes or public IPv4.                                                                                                                                                                                            | Keep subnet visual containment and native identity; clarify required route configuration.                                  | Addresses, routing and associated workloads/gateways.                                                           |
| Virtual private cloud (aws.ec2.vpc)                                                      | existing       | Placement boundary with native resource projection                       | VPC contains network intent and has a native resource identity despite boundary rendering.                                                     | Bounded IPv4 CIDR and DNS settings with default tenancy. Region/AZ relationships are graph conventions; multiple VPCs cannot silently share SG/subnet ownership.                                                                                                                                                                  | Offer network setup as a grouped workflow; avoid making every regional service a VPC child.                                | Associated network services and data transfer, not a blanket VPC capacity rate.                                 |
| Published image identity (aws.ecr.image-reference)                                       | existing       | Owned external artifact configuration                                    | Digest-pinned image is a reference to published content, not a new repository/service.                                                         | Publication status, manifest kind and architecture are caller assertions; no image build/push or live existence check occurs. Publication-required cannot claim runnable tasks.                                                                                                                                                   | Keep in repository/container setup and distinguish artifact readiness from infrastructure readiness.                       | Image storage/transfer and scanning belong to repository/use.                                                   |
| ECR repository (aws.ecr.repository)                                                      | existing       | Separate native resource                                                 | Repository retains named image storage and policy lifecycle.                                                                                   | AES256, immutable tags, scan-on-push and retention are bounded. Image digest/publication remains owned metadata; no generated application/container artifact is implied.                                                                                                                                                          | Provide repository plus explicit published-image reference.                                                                | Stored image bytes, transfer and scanning; retained content persists.                                           |
| ECS cluster (aws.ecs.cluster)                                                            | existing       | Separate native resource                                                 | Cluster identity is distinct from service/task revisions.                                                                                      | Bounded Fargate path; Container Insights disabled. It is regional and related networking is supplied to services rather than nesting a cluster in a subnet.                                                                                                                                                                       | Group ECS resources under a cluster workflow without merging their native identities.                                      | Running tasks and optional telemetry, not an invented cluster capacity charge.                                  |
| Container definition (aws.ecs.container-definition)                                      | existing       | Owned task configuration                                                 | Container is part of a task-definition revision and has no separate native resource identity.                                                  | One essential non-root/read-only container, bounded TCP port, digest-pinned image, health executable and nonblocking logs. Health command is a reviewed constrained form, not arbitrary user bootstrap.                                                                                                                           | Edit within task definition; show health/log/image readiness and port matching.                                            | Task CPU/memory, log ingestion and image use; avoid per-container double counting.                              |
| Fargate service (aws.ecs.service)                                                        | existing       | Separate native resource                                                 | Service owns desired count and deployment lifecycle distinct from task definition/cluster.                                                     | Private awsvpc Fargate at platform1.4.0; desiredCount0 is safe staging intent, not proof of a running workload. Explicit subnets/SG/task/cluster roles and readiness are needed.                                                                                                                                                  | Show stopped-versus-running intent and ALB integration; retain native service identity.                                    | Desired task count, CPU/memory runtime, networking and logs.                                                    |
| Fargate task definition (aws.ecs.task-definition)                                        | existing       | Separate revisioned native resource                                      | Task definition has family/revision lifecycle; it should not be a bag of service options.                                                      | Linux Fargate, awsvpc and bounded CPU/memory pairs with architecture consistency; execution/task role distinction and owned container are explicit. More capacity modes require new supported schemas.                                                                                                                            | Offer task template helper and owned container editor; show execution role separately from application task role.          | CPU/memory of running tasks and downstream dependencies, not double-charge idle definition.                     |
| Application Load Balancer (aws.elb.application-load-balancer)                            | yes            | Separate native resource; scheme is variation                            | ALB identity, subnet/SG/retention lifecycle differ from listener and target group.                                                             | IPv4 application only, two-AZ topology, defensive parsing, invalid-header drop and retention. Internal/internet-facing stays a scheme option. NLB/GWLB need separate contracts, not an unsupported dropdown.                                                                                                                      | Provide an ALB setup sequence with network, listener and target group helpers.                                             | ALB hours/LCUs, transfer and retained serving infrastructure.                                                   |
| ALB backend access (aws.elb.backend-access-configuration)                                | yes            | Owned configuration with native SG rule projections                      | Access binds target-group backend intent to two dedicated peer security groups; it is not another load balancer.                               | Exact TCP peer ingress/egress on one backend/health port; no broad CIDR or arbitrary policy. Owner and SG bindings must remain canonical, and generated rules retain identities.                                                                                                                                                  | Edit from target-group setup and expose the peer access path.                                                              | Traffic consequences and related resources; no separate backend-access capacity charge.                         |
| ALB HTTPS listener (aws.elb.https-listener)                                              | yes            | Owned native listener resource                                           | Listener belongs to ALB but has a distinct native identity and certificate lifecycle reference.                                                | HTTPS443, one reviewed TLS policy, one forward action, exact server name and regional DNS certificate. DNS mapping is external. Current shared port help incorrectly describes HTTP backend semantics for this HTTPS viewer port; propose targeted help correction in a reviewed successor.                                       | Create from ALB; distinguish viewer TLS from unencrypted HTTP backend.                                                     | ALB/use charges and TLS/hostname readiness; listener itself is not another ALB.                                 |
| ALB target group (aws.elb.target-group)                                                  | yes            | Separate reusable native resource with bounded attachment                | Target group has native identity and health/lifecycle settings independent of ALB.                                                             | HTTP/HTTP1, one EC2 instance or one private Fargate service, exact backend port/health and graceful startup constraints. EC2 native attachment is generated; ECS integrates through service configuration.                                                                                                                        | Keep backendMode as a variation and offer target/peer-access helpers.                                                      | Backend resources and ALB routing/health; avoid charging generated attachment twice.                            |
| EventBridge event bus (aws.eventbridge.event-bus)                                        | existing       | Separate native resource; default/custom is variation                    | Custom bus has native identity; default bus is an existing service namespace handled by bounded renderer intent.                               | DEFAULT/CUSTOM selection does not imply a second EventBridge service. Rules and resource policy remain distinct owner graphs. Cross-account/Region targets and arbitrary policies are not implied.                                                                                                                                | Explain default versus newly created custom bus and scope rules beneath it.                                                | Events, routing and destinations; actual event sources are independent.                                         |
| EventBridge rule (aws.eventbridge.rule)                                                  | existing       | Separate owned native resource                                           | Rule belongs to a bus and owns targets, with its own stable native address.                                                                    | Event pattern versus bounded rate schedule is configuration. Source/detail/filter enums constrain the application contract; arbitrary cron/JSON patterns require typed extension, not raw text.                                                                                                                                   | Create a rule under bus and edit target/delivery intent beneath it.                                                        | Matched events/schedules and target execution.                                                                  |
| EventBridge target (aws.eventbridge.target)                                              | existing       | Owned target configuration/resource projection                           | Target is owned by a rule, even though Terraform emits a separate resource and CF nests Targets.                                               | Target type/delivery mode, age/retry and optional DLQ are explicit; at-least-once needs application idempotency. Typed IAM and target roles must follow supported destination rules.                                                                                                                                              | Add beneath rule; show delivery/retry/DLQ and runtime handler requirements.                                                | Delivery attempts, destination executions and DLQ storage.                                                      |
| FSx for Lustre (aws.fsx.lustre-file-system)                                              | existing       | Separate family resource, grouped product variation in UI                | FSx product selector may vary family, but native filesystem identity and family-specific behavior must remain separate definitions.            | Bounded persistent Lustre SSD throughput/capacity and subnet/SG, with typed S3 repository association. Current CF metadata omits that existing association. FileSystemType import is now explicit and order independent.                                                                                                          | Keep one FSx product entry and explicit Lustre variant, with storage/throughput units and S3 dependency.                   | Provisioned storage/throughput, backup and S3/transfer activity.                                                |
| FSx for NetApp ONTAP (aws.fsx.ontap-file-system)                                         | existing       | Separate family resource, grouped product variation in UI                | ONTAP has HA/capacity and SVM/volume lifecycle different from Lustre/OpenZFS/Windows.                                                          | Bounded storage, throughput per HA pair, topology and backup. Native CloudFormation FileSystem type alone is ambiguous; fixed importer requires ONTAP discriminator.                                                                                                                                                              | FSx family selector can guide setup without erasing independent filesystem/SVM/volume IDs.                                 | Provisioned SSD, throughput, HA/storage and backup/transfer.                                                    |
| FSx ONTAP storage virtual machine (aws.fsx.ontap-storage-virtual-machine)                | existing       | Separate contained native resource                                       | SVM has its own native identity and may own multiple volumes.                                                                                  | Exactly one canonical ONTAP filesystem. It is a configuration entry point for that product but must retain export identity. Wider directory/auth/protocol features need contracts.                                                                                                                                                | Create from ONTAP setup and show explicit filesystem ownership.                                                            | Filesystem/storage use; avoid inventing an extra full-filesystem charge.                                        |
| FSx ONTAP volume (aws.fsx.ontap-volume)                                                  | existing       | Separate contained native resource                                       | Volume has native lifecycle, size and junction path distinct from filesystem/SVM.                                                              | Exactly one ONTAP SVM owner and bounded size/path. Residual importer: AWS::FSx::Volume also supports OpenZFS, so native type alone must not assert ONTAP; propose VolumeType discrimination.                                                                                                                                      | Create beneath SVM and preserve independently addressable volume.                                                          | Provisioned/used filesystem storage and backup behavior.                                                        |
| FSx for OpenZFS (aws.fsx.openzfs-file-system)                                            | existing       | Separate family resource, grouped product variation in UI                | Different native Terraform family and filesystem semantics justify separate definition beneath FSx product.                                    | Bounded deployment/storage/throughput, explicit subnet/SG, backup and optional client CIDR. Additional volume resources/data export modes need contracts.                                                                                                                                                                         | Use family-specific setup and clarify allowed clients, capacity and network scope.                                         | Storage, throughput, backup and transfer; pricing is not interchangeable with ONTAP.                            |
| FSx for Windows File Server (aws.fsx.windows-file-system)                                | existing       | Separate family resource, grouped product variation in UI                | Windows AD and deployment topology differ from other FSx families.                                                                             | SINGLE_AZ_2/MULTI_AZ_1 is a variation; two-AZ choice needs exact paired subnets/preferred subnet and directory prerequisite. Product defaults without AD are not deployment-ready.                                                                                                                                                | Keep Windows variant and explicit AD readiness rather than silently applying defaults.                                     | Storage/throughput, Multi-AZ availability, backups and directory dependencies.                                  |
| IAM instance profile (aws.iam.instance-profile)                                          | existing       | Separate native resource                                                 | Profile has native identity and account scope distinct from a role or EC2 instance.                                                            | One reviewed role, path / and protected ownership. Regional graph binding does not change account-wide IAM name uniqueness. No new permissions come from attaching a profile.                                                                                                                                                     | Offer from EC2 role setup with clear role/profile distinction.                                                             | No direct capacity charge; permissions and trust govern downstream access.                                      |
| IAM managed policy attachment (aws.iam.managed-policy-attachment)                        | existing       | Owned policy-reference configuration                                     | Attachment/boundary is a role relationship; underlying external policy is referenced, not created.                                             | AttachmentKind is a variation with different permission semantics. Boundaries limit identity grants rather than granting access. Exact policy references/adoption and lifecycle matter.                                                                                                                                           | Keep beneath IAM role and clearly distinguish grant from permissions boundary.                                             | No direct capacity rate; can enable downstream charged use.                                                     |
| IAM policy condition (aws.iam.policy-condition)                                          | existing       | Owned nested policy configuration                                        | Condition belongs to a statement, not a standalone service/resource.                                                                           | Bounded operators, keys and typed values; do not infer arbitrary IAM evaluation or security from a string. Ordering/ownership is canonical.                                                                                                                                                                                       | Edit under statement in Guided/Professional policy views.                                                                  | Security scope, no standalone service capacity.                                                                 |
| IAM policy document (aws.iam.policy-document)                                            | existing       | Owned graph configuration with owner-specific projections                | Trust, inline, resource and generated grant kinds share graph structure, while owner/target dictates native projection and lifecycle.          | Keep policyKind variation, explicit parent/edge and generated adoption rules. Do not mix generated grants with custom policy ownership or silently delete a shared grant.                                                                                                                                                         | Show beneath owner with purpose, provenance and effective source edges.                                                    | Permissions scope; some owned projections have native identities but no capacity unit.                          |
| IAM policy statement (aws.iam.policy-statement)                                          | existing       | Owned nested policy configuration                                        | Statement identity and typed scope belong inside a policy document.                                                                            | Actions/effect/principal and resource references are constrained; resourceNode uses reviewed service attributes, never arbitrary model ARN synthesis. Wildcards and custom grants need explicit review.                                                                                                                           | Edit canonical statement/conditions and show generated versus user ownership.                                              | Security authority; no direct capacity unit.                                                                    |
| IAM role (aws.iam.role)                                                                  | existing       | Separate native resource                                                 | Role has account-scoped identity, trust and session lifecycle independent of workloads.                                                        | Execution/task/application roles can share a definition while their relationship/trust semantics stay explicit. One-hour session scope is bounded; raw/custom permissions are not inferred from source.                                                                                                                           | Offer role helpers per workload purpose, preserve trust and policies underneath.                                           | No direct capacity charge; downstream use and permission scope matter.                                          |
| KMS symmetric encryption key (aws.kms.key)                                               | existing       | Separate native resource                                                 | Key has retention/rotation/deletion identity independent of encrypted resources.                                                               | Single-Region symmetric AWS_KMS encrypt/decrypt key with exact owned key policy and reviewed admin principal. No automatic broad decrypt grants or live key usability assertion.                                                                                                                                                  | Require explicit policy/admin and compatible consumer binding; show delayed deletion/retention.                            | Key storage and cryptographic requests; retention continues key existence.                                      |
| Lambda function (aws.lambda.function)                                                    | existing       | Separate native resource; architecture/memory are variations             | Function runtime identity and execution lifecycle differ from role, VPC settings and artifacts.                                                | Bounded Node24 runtime, arm64/x86_64, memory/time/concurrency and tracing. Infrastructure-only creation is not business code generation. Explicit trigger/downstream/runtime contracts remain necessary.                                                                                                                          | Lead with artifact/behavior readiness and execution role, then owned VPC/permission settings.                              | Invocations, duration/memory, concurrency, telemetry and network dependencies.                                  |
| Lambda VPC access configuration (aws.lambda.vpc-access-configuration)                    | existing       | Owned function configuration                                             | VPC access is a nested function setting with subnet/SG relationships, not another Lambda service.                                              | Explicit egressRequirement does not create routes/NAT/endpoint permissions automatically. Exact VPC/Region topology and role ENI permission prerequisites remain separate.                                                                                                                                                        | Edit under function with complete egress path and constrained subnet/SG choices.                                           | Related NAT/transfer and operational connectivity; no separate function capacity unit.                          |
| RDS PostgreSQL instance (aws.rds.db-instance)                                            | yes            | Separate native resource; multiAz is variation                           | Standalone DB owns data/storage/credentials/backup. Aurora cluster/members must not be collapsed into this identity.                           | Bounded private PostgreSQL16, gp3, managed credentials, TLS parameter group and two-AZ subnet group. Multi-AZ is a configuration choice within supported standalone mode. Engine availability remains external. Import now discriminates literal postgres and absent cluster membership.                                          | Database product grouping with explicit standalone/Aurora workflow; retain every native identity.                          | Instance/storage/backup, Multi-AZ capacity and managed credentials; retain/protection imply deliberate cleanup. |
| RDS PostgreSQL TLS parameters (aws.rds.db-parameter-group)                               | yes            | Separate reusable native resource                                        | Named standalone parameter group can be reused and differs from Aurora cluster parameters.                                                     | postgres16 and forced TLS only, protected user ownership; arbitrary parameter bags/families require typed admission.                                                                                                                                                                                                              | Helper from DB setup with explicit reusable identity.                                                                      | Indirect operational/reboot consequences; no standalone capacity charge.                                        |
| RDS DB subnet group (aws.rds.db-subnet-group)                                            | yes            | Separate reusable native resource                                        | One named native group can serve standalone RDS and Aurora, with its own lifecycle.                                                            | 2-16 canonical subnets, distinct physical AZs and one VPC/Region. It describes placement and is not a VPC/subnet container. Shared old/new positive export now tested.                                                                                                                                                            | Helper selects explicit subnets and shows coverage; preserve sharing and references.                                       | No direct storage capacity; determines deployment topology and resilience.                                      |
| AWS Region (aws.region.boundary)                                                         | existing       | Visual boundary; no deployable native resource                           | Region is a document context/placement boundary, not an AWS resource created by export.                                                        | Actual UI binds regionName to document Region. Multi-Region application/provider orchestration remains unsupported. All installed regional availability descriptors stay unknown.                                                                                                                                                 | Keep single Region and state availability as externally verified readiness.                                                | Boundary itself has no capacity charge; prices/use vary with deployed Region.                                   |
| Route53 public hosted zone (aws.route53.public-hosted-zone)                              | yes            | Separate native resource                                                 | Zone has distinct authority, delegation, lifecycle and DNS identity.                                                                           | New public zone, one canonical domain, external delegation, no force destroy and explicit domain-control attestation. No private/existing/cross-account zone or arbitrary record API is inferred. Import HostedZone type alone cannot prove public semantics if VPCs are present.                                                 | Show authority/delegation prerequisite and certificate/alias relationships; attestation needs separate UI fix.             | Hosted zone and DNS queries; retained zones/records can continue charges.                                       |
| S3 bucket (aws.s3.bucket)                                                                | existing       | Separate native resource; policy/ownership variants remain configuration | Bucket has durable named storage identity; CORS/lifecycle/notification are owned settings with target-specific projections.                    | Private block-public, enforced owner, versioning, protection and SSE-S3 only. Shared naming rules are bounded; globally available names and live account state are not checked. CloudFront signed read and events are distinct paths.                                                                                             | Show storage and owned controls, avoid duplicate Terraform control cards.                                                  | Stored objects/versions, requests, transfer and lifecycle transitions; retention can preserve charges/data.     |
| S3 CORS configuration (aws.s3.bucket-cors-configuration)                                 | existing       | Owned bucket configuration                                               | CORS belongs to bucket; Terraform resource projection does not make it a standalone AWS service.                                               | Bounded origins/methods/headers/cache max-age are separate from object authorization. No public-read permission follows from CORS.                                                                                                                                                                                                | Edit beneath bucket and distinguish browser permission from IAM/public access.                                             | Requests/cache behavior; no separate full-bucket capacity estimate.                                             |
| S3 lifecycle configuration (aws.s3.bucket-lifecycle-configuration)                       | existing       | Owned bucket configuration                                               | Object retention/transition policy belongs to bucket and has stable owned projection.                                                          | Explicit expiry/noncurrent versions and bounded transition intent can delete data. Bucket retain/protection does not stop object lifecycle expiration.                                                                                                                                                                            | Explain data expiration separately from resource deletion protection.                                                      | Stored versions, transitions, retrieval/minimum-duration implications require separate pricing context.         |
| S3 notification configuration (aws.s3.bucket-notification-configuration)                 | existing       | Owned bucket configuration                                               | Notification is one canonical bucket-owned setting; target choice is variation.                                                                | At-least-once unordered events, bounded event/filter and Lambda/EventBridge destinations. Overlapping filters/permissions are checked; consumer idempotency is application behavior.                                                                                                                                              | Configure from bucket and show handler/permission/event-contract readiness.                                                | Event deliveries, target execution and request volume.                                                          |
| Secrets Manager secret (aws.secretsmanager.secret)                                       | existing       | Separate native resource                                                 | Secret metadata, encryption and recovery have independent identity; value population is external.                                              | No plaintext/generation is compiled. AWS-managed/customer-key choice stays variation with explicit KMS/role edges. Recovery/retention and population readiness are distinct.                                                                                                                                                      | Show external population requirement without prompting for secret values in diagram fields.                                | Secret storage/API/rotation-related use and KMS requests.                                                       |
| SNS subscription (aws.sns.subscription)                                                  | existing       | Owned native subscription resource                                       | Subscription belongs to topic but retains native lifecycle/address; protocol is configuration variation.                                       | Only Lambda/SQS destinations and bounded filter/raw delivery are compiled. Human subscriptionName is semantic metadata; current StableIdentity/stable_identity target bindings are fictitious and separately proposed for correction.                                                                                             | Edit under topic and distinguish destination permission from retry/idempotency behavior.                                   | Delivery attempts and destination use; no extra topic capacity charge.                                          |
| SNS topic (aws.sns.topic)                                                                | existing       | Separate native resource; Standard/FIFO is variation                     | Topic has native identity and owns subscriptions/policy; queue type does not justify duplicate service cards.                                  | Bounded KMS encryption/dedup/retention with typed publishers/subscribers. FIFO compatibility and raw/filter semantics need exact destination rules.                                                                                                                                                                               | Keep type choice within topic and show subscriptions/delivery contracts.                                                   | Publishing/delivery, transfer and encryption-related requests.                                                  |
| SQS queue (aws.sqs.queue)                                                                | existing       | Separate native resource; Standard/FIFO is variation                     | Queue stores messages and has its own native identity; DLQ remains a real separate queue.                                                      | Bounded visibility/retention/long-polling/encryption/dedup. DLQ redrive is owned source-queue config; retries are not exactly-once application processing.                                                                                                                                                                        | Show timeout/retention units, consumer behavior and separate DLQ queue.                                                    | Requests, payload/message volume, retention and downstream executions.                                          |
| SQS redrive configuration (aws.sqs.redrive-configuration)                                | existing       | Owned source queue configuration with native policy projections          | Redrive owns policy intent; destination DLQ has a separate queue identity and must not become a boolean.                                       | Bounded receive-count, BY_QUEUE allow policy and manual review replay. Queue type/Region/ownership and shared generated resources remain exact.                                                                                                                                                                                   | Configure beneath source queue with visible DLQ target and replay expectation.                                             | Retained failed messages and replay/delivery requests.                                                          |
| Step Functions state machine (aws.stepfunctions.state-machine)                           | existing       | Separate native resource; bounded operation definition is configuration  | Workflow has native identity, role and execution lifecycle; flow/state choices are typed behavior, not new AWS service cards.                  | Bounded Standard catalog operations with error-only no-execution-data logs and typed Lambda task edges. Generated CF error log group is missing from mapping metadata; separate proposal adds its type. Arbitrary ASL/Express and business semantics need new contracts.                                                          | Show workflow/role/task behavior and logging ownership together.                                                           | State transitions, execution telemetry and task destinations.                                                   |

## Exact configuration, placement and export review — every 71

The decision, workflow and source-reference records below are retained from the
original review. Exact field schemas, defaults, ports, mappings and unsupported
capabilities are duplicated catalog data: consult the reviewed
[catalog artifact](../../packages/provider-aws/src/compiled/catalog-v1.json),
[presentation artifact](../../packages/provider-aws/src/compiled/connection-presentation-v1.json)
and
[service-extension artifact](../../packages/provider-aws/src/compiled/service-extension-v1.json)
at the binding above. The immutable full review (private historical evidence,
omitted from this distribution) preserves every original field table, mapping
dump and negative-probe receipt.

### ACM public DNS certificate — `aws.acm.public-dns-certificate`

Decision: **Separate native resource**. Certificate issuance, renewal and
retention have their own identity and can serve several ALB listeners. Keep
purpose/Region as configuration. Current scope is new public RSA-2048, one
canonical domain and managed DNS validation. us-east-1 viewer intent does not
create cross-Region orchestration. Existing/imported/private/wildcard/SAN/email
certificates stay outside export scope. Native importer type alone does not
prove public DNS intent.

Workflow: Expose a certificate helper from ALB/CloudFront and show its zone,
intended use, Region and pending external issuance. Cost/operations:
Certificate/export options and downstream serving costs; no live certificate
readiness check.

Primary references:
[Public DNS certificate](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-certificatemanager-certificate.html),
[CloudFront viewer certificate Region](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html),
[Public hosted zone](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-route53-hostedzone.html);
[AWS::CertificateManager::Certificate](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-certificatemanager-certificate.html)
(current document SHA-256
`8de0270f1019aad2681f69f3facdb7153729f3b61a97c07616ae89478c4ba10c`).

Source/test references at exact base:
`apps/web/src/features/editor/model/dns-acm-service-setup.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/services/cloudfront.ts`,
`packages/provider-aws/src/catalog/services/dns-acm.ts`,
`packages/provider-aws/src/catalog/services/elb.ts`,
`services/iac-compiler/dns_acm.go`. Asset
`{"file":null,"iconId":"aws.cloudmarkup.icons.acm-public-dns-certificate","placeholderReason":"missing","serviceName":"ACM public DNS certificate","state":"placeholder"}`.

### API Gateway HTTP API — `aws.apigateway.http-api`

Decision: **Separate native resource; protocol variation remains bounded**. HTTP
API has its own native identity; REST/WebSocket require different resource
families and later contracts. JWT is required and CORS is fixed false. An API
invocation edge is distinct from JWT issuer/audience relationships. No arbitrary
endpoint, domain, WAF or private API is implied. Default notes-api name is
template intent.

Workflow: Explain HTTP API scope and require concrete CORS policy before
introducing a switch. Cost/operations: Requests, data transfer and related
Lambda/Cognito use.

Primary references:
[Working with HTTP APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api.html);
[AWS::ApiGatewayV2::Api](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-apigatewayv2-api.html)
(current document SHA-256
`a503cde76dd75bc27b752c81cec42f5e8db2972c06ae52d75a189cd4bcee675c`).

Source/test references at exact base:
`apps/web/src/features/editor/model/add-service-command.test.ts`,
`apps/web/src/features/editor/model/connection-workflow.test.ts`,
`apps/web/src/features/editor/model/provider-catalog-adapter.test.ts`,
`apps/web/src/features/editor/model/service-catalog-view-model.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/notes-api-connections.ts`,
`packages/provider-aws/src/catalog/services/api-gateway-http-api.ts`,
`packages/provider-aws/src/catalog/services/index.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`packages/provider-aws/src/networking-catalog.test.ts`,
`packages/provider-aws/src/validation.test.ts`,
`services/iac-compiler/cloudformation_renderer.go`,
`services/iac-compiler/cloudformation_resources.go`,
`services/iac-compiler/terraform_artifacts.go`,
`services/iac-compiler/terraform_attribute_test.go`,
`services/iac-compiler/terraform_renderer.go`,
`services/iac-compiler/terraform_resources.go`,
`services/iac-compiler/terraform_test.go`. Asset
`{"automatedSecurityResult":"passed","awsServiceFamily":"Amazon API Gateway","destinationAssetId":"aws.cloudmarkup.provider-icons.asset.api-gateway","file":"api-gateway-http-api.svg","iconId":"aws.cloudmarkup.icons.apigateway","mappingType":"service-family","mediaType":"image/svg+xml","normalizedBytes":1764,"normalizedSha256":"sha256:08f0cb8f93f8d390425d3925054004c17422cabb7eee14edbabe238e678278af","serviceName":"API Gateway HTTP API","sourceBytes":1764,"sourceMember":"Architecture-Service-Icons_04302026/Arch_Networking-Content-Delivery/48/Arch_Amazon-API-Gateway_48.svg","sourceSha256":"sha256:08f0cb8f93f8d390425d3925054004c17422cabb7eee14edbabe238e678278af","state":"approved","transformationSteps":["validate-svg-v2","normalize-svg-text-v1","verify-selected-source-v1"],"viewBox":"0 0 64 64"}`.

### Aurora PostgreSQL Serverless v2 cluster — `aws.aurora.postgresql-cluster`

Decision: **Separate native resource**. Aurora cluster owns storage,
credentials, backup and capacity; standalone RDS and members have different
lifecycle/export identities. Bounded PostgreSQL 16, nonzero Serverless v2
capacity and Aurora Standard are product choices. EngineMode remains
provisioned. One two-AZ subnet group, TLS cluster group and private SG path are
required. No Data API, scale-to-zero or customer KMS is compiled. Import now
requires literal PostgreSQL engine.

Workflow: Group RDS/Aurora under database product selection; keep actual cluster
and members inspectable. Cost/operations: ACUs, storage, I/O, backups and
managed credentials; nonzero floor and retention can continue charges.

Primary references:
[RDS-managed master credentials](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-secrets-manager.html),
[Aurora PostgreSQL DB cluster](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-rds-dbcluster.html);
[AWS::RDS::DBCluster](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-rds-dbcluster.html)
(current document SHA-256
`b2ee0522a9c5f0befeddcd4af2d3dc93bb010740a8f39c9c4bcc14d308ec9b5f`).

Source/test references at exact base:
`apps/web/src/features/editor/model/aurora-service-setup.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/services/aurora-postgres.ts`,
`services/iac-compiler/aurora.go`. Asset
`{"file":null,"iconId":"aws.cloudmarkup.icons.aurora-postgresql-cluster","placeholderReason":"missing","serviceName":"Aurora PostgreSQL Serverless v2 cluster","state":"placeholder"}`.

### Aurora PostgreSQL cluster TLS parameters — `aws.aurora.postgresql-cluster-parameter-group`

Decision: **Separate reusable native resource**. A named cluster parameter group
is independently addressable and can be shared. It is not the standalone DB
parameter group. Only aurora-postgresql16 with forced TLS and retained user
ownership is supported. Additional settings/families need typed schemas and
compiler evidence. Native type alone does not establish PostgreSQL family in
imports.

Workflow: Offer a TLS parameter-group helper while preserving an explicit
reusable resource and references. Cost/operations: No standalone capacity
charge; affects cluster behavior and reboot/application readiness.

Primary references:
[RDS-managed master credentials](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-secrets-manager.html),
[Aurora PostgreSQL DB cluster](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-rds-dbcluster.html);
[AWS::RDS::DBClusterParameterGroup](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-rds-dbclusterparametergroup.html)
(current document SHA-256
`ae449b4b9cfb65e89090979ddcf5680224203f5e35d48cd8965d46c0c7a14e6a`).

Source/test references at exact base:
`apps/web/src/features/editor/model/aurora-service-setup.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/services/aurora-postgres.ts`,
`services/iac-compiler/aurora.go`. Asset
`{"file":null,"iconId":"aws.cloudmarkup.icons.aurora-postgresql-cluster-parameter-group","placeholderReason":"missing","serviceName":"Aurora PostgreSQL cluster TLS parameters","state":"placeholder"}`.

### Aurora PostgreSQL Serverless v2 member — `aws.aurora.postgresql-instance`

Decision: **Separate cluster member resource**. Members have their own
DBInstance identifiers, AZ, failover tier and lifecycle; they cannot become a
count-only cluster option. Current scope is db.serverless, private access and
one canonical cluster edge; storage/credentials/backup remain cluster intent.
Root graph placement is logical, and membership is relational. Shared
CloudFormation DBInstance import is now engine/cluster discriminated.

Workflow: Create members from a cluster helper with explicit AZ and promotion
tier; preserve each identity. Cost/operations: Serverless member capacity and
availability decisions; two members are not free redundancy.

Primary references:
[RDS-managed master credentials](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-secrets-manager.html),
[Aurora PostgreSQL DB cluster](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-rds-dbcluster.html);
[AWS::RDS::DBInstance](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-rds-dbinstance.html)
(current document SHA-256
`ae0dbd7e1269fcd9d7199360c329de8d07f94ced43d7b1d9696d6f2ab3ccbad6`).

Source/test references at exact base:
`apps/web/src/features/editor/model/aurora-service-setup.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/services/aurora-postgres.ts`,
`services/iac-compiler/aurora.go`. Asset
`{"file":null,"iconId":"aws.cloudmarkup.icons.aurora-postgresql-instance","placeholderReason":"missing","serviceName":"Aurora PostgreSQL Serverless v2 member","state":"placeholder"}`.

### CloudFront alias configuration — `aws.cloudfront.alias-configuration`

Decision: **Owned configuration with native DNS projections**. Alias expresses
exact distribution/certificate ownership and generates A/AAAA records; it is not
a second CloudFront service. One exact domain, viewer certificate and matching
attested public zone; parent and owner edge must agree. Managed aliases do not
prove registrar delegation. Native DNS projections must retain stable ownership.

Workflow: Keep in distribution settings and show DNS/certificate readiness.
Cost/operations: DNS queries and distribution usage; avoid treating projected
records as extra service cards.

Primary references:
[CloudFront distribution](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-cloudfront-distribution.html),
[Private S3 origin access](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html),
[Viewer certificate requirements](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html).

Source/test references at exact base:
`apps/web/src/features/editor/model/cloudfront-service-setup.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/services/cloudfront.ts`,
`packages/provider-aws/src/cloudfront.test.ts`,
`services/iac-compiler/cloudfront.go`. Asset `null`.

### CloudFront static cache policy — `aws.cloudfront.cache-policy`

Decision: **Separate reusable native resource**. Cache policy has an independent
ID and lifecycle and may be shared by distributions. Static public-content cache
only: ordered TTLs, no viewer cookies/headers/query strings, gzip/Brotli and
retention. This is unsuitable for personalized content without a new reviewed
cache-key/origin-request contract.

Workflow: Offer a static-cache preset, retaining the visible reusable policy and
TTL tradeoff. Cost/operations: Cache effectiveness affects origin requests and
transfer; retained policy alone is not a throughput resource.

Primary references:
[CloudFront distribution](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-cloudfront-distribution.html),
[Private S3 origin access](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html),
[Viewer certificate requirements](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html);
[AWS::CloudFront::CachePolicy](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-cloudfront-cachepolicy.html)
(current document SHA-256
`57c5b775f363ec9c06df515811073e04601c9c7f3852909194a8b413c5b16afb`).

Source/test references at exact base:
`apps/web/src/features/editor/model/cloudfront-service-setup.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/services/cloudfront.ts`,
`services/iac-compiler/cloudfront.go`. Asset
`{"file":null,"iconId":"aws.cloudmarkup.icons.cloudfront-cache-policy","placeholderReason":"missing","serviceName":"CloudFront static cache policy","state":"placeholder"}`.

### CloudFront distribution — `aws.cloudfront.distribution`

Decision: **Separate native resource**. Global distribution, enabled state and
domain have independent identity; viewer certificate mode is a configuration
variation. Signed private S3 origin is read-only while viewers remain public.
Explicit content attestation has no default and needs the separate UI fix. The
existing OAC is missing from CF generated-type metadata; source proposal remains
isolated. Default-viewer regional origin works without cross-Region certificate
orchestration.

Workflow: Lead with public viewer behavior, origin protection and enabled state;
show one distribution plus owned OAC/policy intent. Cost/operations: Requests,
transfer, price class and cache behavior; disabled default is an explicit
readiness choice.

Primary references:
[CloudFront distribution](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-cloudfront-distribution.html),
[Private S3 origin access](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html),
[Viewer certificate requirements](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html);
[AWS::CloudFront::Distribution](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-cloudfront-distribution.html)
(current document SHA-256
`3d5d580534b150fbd430193836840f146de7dd6cc209a18863419196e8ecfca9`).

Source/test references at exact base:
`apps/web/src/features/editor/model/cloudfront-service-setup.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/services/cloudfront.ts`,
`packages/provider-aws/src/cloudfront.test.ts`,
`packages/provider-aws/src/provider-extension-artifacts.test.ts`,
`services/iac-compiler/cloudfront.go`. Asset
`{"file":null,"iconId":"aws.cloudmarkup.icons.cloudfront-distribution","placeholderReason":"missing","serviceName":"CloudFront distribution","state":"placeholder"}`.

### CloudWatch log group — `aws.cloudwatch.log-group`

Decision: **Separate native resource**. Named log group, retention and lifecycle
differ from its producer. STANDARD only, bounded retention values and
prevent-destroy are intentional. ECS can share log groups; Lambda port limits
remain exact. Generated Step Functions logs are a separate owned projection, not
this explicit node.

Workflow: Surface log delivery and retention near workload setup; distinguish
generated and user-owned logs. Cost/operations: Ingestion, storage, queries and
retained data.

Primary references:
[Working with log groups and log streams](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/Working-with-log-groups-and-streams.html);
[AWS::Logs::LogGroup](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-logs-loggroup.html)
(current document SHA-256
`97f71ec6a066ef57fa5a69aa394737a2d0175f182c40542ac3a54c005c57e4e8`).

Source/test references at exact base:
`apps/web/src/features/editor/model/add-service-command.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/notes-api-connections.ts`,
`packages/provider-aws/src/catalog/services/cloudwatch-log-group.ts`,
`packages/provider-aws/src/catalog/services/ecs-fargate.ts`,
`packages/provider-aws/src/catalog/services/index.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`packages/provider-aws/src/policy/projection-v1.test.ts`,
`packages/provider-aws/src/validation.test.ts`,
`services/iac-compiler/cloudformation_renderer.go`,
`services/iac-compiler/cloudformation_resources.go`,
`services/iac-compiler/ecs.go`, `services/iac-compiler/ecs_test.go`,
`services/iac-compiler/terraform_artifacts.go`,
`services/iac-compiler/terraform_attribute_test.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_renderer.go`,
`services/iac-compiler/terraform_resources.go`,
`services/iac-compiler/terraform_test.go`. Asset
`{"automatedSecurityResult":"passed","awsServiceFamily":"Amazon CloudWatch","destinationAssetId":"aws.cloudmarkup.provider-icons.asset.cloudwatch-logs","file":"cloudwatch-logs.svg","iconId":"aws.cloudmarkup.icons.cloudwatch-logs","mappingType":"service-family","mediaType":"image/svg+xml","normalizedBytes":2226,"normalizedSha256":"sha256:99037d73616ac8362bb324d3f98426288acb61784f02e070ccf09c859bb05897","serviceName":"CloudWatch log group","sourceBytes":2307,"sourceMember":"Resource-Icons_04302026/Res_Management-Governance/Res_Amazon-CloudWatch_Logs_48.svg","sourceSha256":"sha256:d395fbcdfe2a524b8cb8ea1f157be8f8cb02e29e635607acbfa9644a31ff4e12","state":"approved","transformationSteps":["remove-unused-root-xlink-namespace-v1","validate-svg-v2","normalize-svg-text-v1","verify-selected-source-v1"],"viewBox":"0 0 48 48"}`.

### CloudWatch metric alarm — `aws.cloudwatch.metric-alarm`

Decision: **Separate native resource**. Alarm has a native identity and
lifecycle distinct from a metric producer. This definition is a bounded Lambda
Errors/Sum alarm, not generic metric/composite monitoring. notBreaching can hide
missing data and no notification action is inferred.

Workflow: Label it as Lambda error monitoring and explain threshold, period and
missing data. Cost/operations: Alarm/metric evaluation and downstream
notification use.

Primary references:
[Using Amazon CloudWatch alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/AlarmThatSendsEmail.html);
[AWS::CloudWatch::Alarm](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-cloudwatch-alarm.html)
(current document SHA-256
`6569861bbf929f39bc937ccdb29e668da21ab0e137191493ea7754405654a68a`).

Source/test references at exact base:
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/notes-api-connections.ts`,
`packages/provider-aws/src/catalog/services/cloudwatch-metric-alarm.ts`,
`packages/provider-aws/src/catalog/services/index.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`services/iac-compiler/cloudformation_renderer.go`,
`services/iac-compiler/cloudformation_resources.go`,
`services/iac-compiler/terraform_artifacts.go`,
`services/iac-compiler/terraform_attribute_test.go`,
`services/iac-compiler/terraform_renderer.go`,
`services/iac-compiler/terraform_resources.go`,
`services/iac-compiler/terraform_test.go`. Asset
`{"automatedSecurityResult":"passed","awsServiceFamily":"Amazon CloudWatch","destinationAssetId":"aws.cloudmarkup.provider-icons.asset.cloudwatch-alarm","file":"cloudwatch-metric-alarm.svg","iconId":"aws.cloudmarkup.icons.cloudwatch-alarm","mappingType":"exact-resource","mediaType":"image/svg+xml","normalizedBytes":2282,"normalizedSha256":"sha256:ccbf07e48a8188e8bd612a812cc2e734143b47e51185519d8754fbc40f2fe804","serviceName":"CloudWatch metric alarm","sourceBytes":2363,"sourceMember":"Resource-Icons_04302026/Res_Management-Governance/Res_Amazon-CloudWatch_Alarm_48.svg","sourceSha256":"sha256:1ffcc967c3e9915777169b6100f015a311aa1eda304d23c626c258db1b8633ad","state":"approved","transformationSteps":["remove-unused-root-xlink-namespace-v1","validate-svg-v2","normalize-svg-text-v1","verify-selected-source-v1"],"viewBox":"0 0 48 48"}`.

### Cognito user pool — `aws.cognito.user-pool`

Decision: **Separate native resource**. Directory and users have a lifecycle
separate from app clients. Email identity, verified-email recovery and bounded
MFA/password choices are explicit. Optional MFA does not require every user to
enroll. Existing users/data migration and full threat protection are outside
this review.

Workflow: Keep app clients beneath the pool and distinguish directory settings
from application credentials. Cost/operations: User authentication activity and
optional messaging/features.

Primary references:
[Getting started with user pools](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pool-as-user-directory.html);
[AWS::Cognito::UserPool](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-cognito-userpool.html)
(current document SHA-256
`d7326a238ef75ff01063d26f0772dbbfae7baa9e0e55830d1adbbca23343a547`).

Source/test references at exact base:
`apps/web/src/features/editor/model/add-service-command.test.ts`,
`apps/web/src/features/editor/model/connection-workflow.test.ts`,
`apps/web/src/features/editor/model/service-setup.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/notes-api-connections.ts`,
`packages/provider-aws/src/catalog/services/cognito-user-pool-client.ts`,
`packages/provider-aws/src/catalog/services/cognito-user-pool.ts`,
`packages/provider-aws/src/catalog/services/index.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`packages/provider-aws/src/validation.test.ts`,
`services/iac-compiler/cloudformation_renderer.go`,
`services/iac-compiler/cloudformation_resources.go`,
`services/iac-compiler/terraform_artifacts.go`,
`services/iac-compiler/terraform_attribute_test.go`,
`services/iac-compiler/terraform_renderer.go`,
`services/iac-compiler/terraform_resources.go`,
`services/iac-compiler/terraform_test.go`. Asset
`{"automatedSecurityResult":"passed","awsServiceFamily":"Amazon Cognito","destinationAssetId":"aws.cloudmarkup.provider-icons.asset.cognito","file":"cognito.svg","iconId":"aws.cloudmarkup.icons.cognito","mappingType":"service-family","mediaType":"image/svg+xml","normalizedBytes":4876,"normalizedSha256":"sha256:5b1accb392778148bb8fa124156325fcea50efe6829b2e313d85eef289857cce","serviceName":"Cognito user pool","sourceBytes":4957,"sourceMember":"Architecture-Service-Icons_04302026/Arch_Security-Identity/48/Arch_Amazon-Cognito_48.svg","sourceSha256":"sha256:66a89c507aced4afefe99d39fa7d5b7bd22e3f6bed03f511a031bf44f57f34ce","state":"approved","transformationSteps":["remove-unused-root-xlink-namespace-v1","validate-svg-v2","normalize-svg-text-v1","verify-selected-source-v1"],"viewBox":"0 0 64 64"}`.

### Cognito user pool app client — `aws.cognito.user-pool-client`

Decision: **Owned native child resource**. App client belongs to one pool but
has its own ID and lifecycle; changing token validity is configuration, not a
separate service. SRP/refresh authentication and a public client without
generated secret are fixed. One canonical owner supplies the JWT audience;
client registration alone does not implement frontend login.

Workflow: Create from pool settings and expose validity units clearly.
Cost/operations: Pool use, token/session security and downstream app behavior.

Primary references:
[User pool app clients](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-client-apps.html);
[AWS::Cognito::UserPoolClient](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-cognito-userpoolclient.html)
(current document SHA-256
`68818aeb864aa984547da1c2e7e57ab5d1172bf844b4c599f12d43716f253b33`).

Source/test references at exact base:
`apps/web/src/features/editor/model/add-service-command.test.ts`,
`apps/web/src/features/editor/model/connection-workflow.test.ts`,
`apps/web/src/features/editor/model/service-setup.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/notes-api-connections.ts`,
`packages/provider-aws/src/catalog/services/cognito-user-pool-client.ts`,
`packages/provider-aws/src/catalog/services/index.ts`,
`packages/provider-aws/src/connection-presentation.test.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`packages/provider-aws/src/validation.test.ts`,
`services/iac-compiler/cloudformation_renderer.go`,
`services/iac-compiler/cloudformation_resources.go`,
`services/iac-compiler/terraform_artifacts.go`,
`services/iac-compiler/terraform_attribute_test.go`,
`services/iac-compiler/terraform_renderer.go`,
`services/iac-compiler/terraform_resources.go`,
`services/iac-compiler/terraform_test.go`. Asset
`{"automatedSecurityResult":"passed","awsServiceFamily":"Amazon Cognito","destinationAssetId":"aws.cloudmarkup.provider-icons.asset.cognito","file":"cognito.svg","iconId":"aws.cloudmarkup.icons.cognito-app-client","mappingType":"service-family","mediaType":"image/svg+xml","normalizedBytes":4876,"normalizedSha256":"sha256:5b1accb392778148bb8fa124156325fcea50efe6829b2e313d85eef289857cce","serviceName":"Cognito user pool app client","sourceBytes":4957,"sourceMember":"Architecture-Service-Icons_04302026/Arch_Security-Identity/48/Arch_Amazon-Cognito_48.svg","sourceSha256":"sha256:66a89c507aced4afefe99d39fa7d5b7bd22e3f6bed03f511a031bf44f57f34ce","state":"approved","transformationSteps":["remove-unused-root-xlink-namespace-v1","validate-svg-v2","normalize-svg-text-v1","verify-selected-source-v1"],"viewBox":"0 0 64 64"}`.

### DynamoDB table — `aws.dynamodb.table`

Decision: **Separate native resource; billing variation is configuration**.
Table identity/data lifecycle must remain separate from consumers. Current table
is on-demand with string partition key, encryption, PITR and protection. Sort
keys, indexes, streams and provisioned capacity need additional contracts rather
than unsupported enum options. Regional service is not subnet-contained.

Workflow: Explain key/data contract and protection; show runtime data behavior
separately. Cost/operations: Requests, stored data and recovery/backup features.

Primary references:
[Core components of Amazon DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.CoreComponents.html);
[AWS::DynamoDB::Table](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-dynamodb-table.html)
(current document SHA-256
`56cf1bea4a4bb98466be8de575b3f32df500a245027ab65f33d75adb30a87e4f`).

Source/test references at exact base:
`apps/web/src/features/editor/model/connection-workflow.test.ts`,
`apps/web/src/features/editor/model/service-catalog-view-model.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/notes-api-connections.ts`,
`packages/provider-aws/src/catalog/services/dynamodb-table.ts`,
`packages/provider-aws/src/catalog/services/index.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`packages/provider-aws/src/event-driven-catalog.test.ts`,
`packages/provider-aws/src/policy/projection-v1.test.ts`,
`packages/provider-aws/src/validation.test.ts`,
`services/iac-compiler/cloudformation_renderer.go`,
`services/iac-compiler/cloudformation_resources.go`,
`services/iac-compiler/cmd/cloudmarkup-iac/cli_test.go`,
`services/iac-compiler/terraform_artifacts.go`,
`services/iac-compiler/terraform_attribute_test.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_renderer.go`,
`services/iac-compiler/terraform_resources.go`,
`services/iac-compiler/terraform_test.go`. Asset
`{"automatedSecurityResult":"passed","awsServiceFamily":"Amazon DynamoDB","destinationAssetId":"aws.cloudmarkup.provider-icons.asset.dynamodb-table","file":"dynamodb-table.svg","iconId":"aws.cloudmarkup.icons.dynamodb","mappingType":"exact-resource","mediaType":"image/svg+xml","normalizedBytes":1494,"normalizedSha256":"sha256:e44886fcc96ad78f49b95f9813fffc40e3e50dc991ce02cf57b56ecfc3ba5f27","serviceName":"DynamoDB table","sourceBytes":1575,"sourceMember":"Resource-Icons_04302026/Res_Databases/Res_Amazon-DynamoDB_Table_48.svg","sourceSha256":"sha256:201cc55e7a235d6f935f73a64540769f65b0d425d52ce4dd692fb92ab3e0941c","state":"approved","transformationSteps":["remove-unused-root-xlink-namespace-v1","validate-svg-v2","normalize-svg-text-v1","verify-selected-source-v1"],"viewBox":"0 0 48 48"}`.

### EBS data volume — `aws.ebs.volume`

Decision: **Separate native resource**. Data volume has its own AZ, encryption,
retention and export identity independent of EC2 root disk. Encrypted gp3 only
with bounded size/IOPS/throughput; one AZ and optional customer-key
relationship. Multi-attach is fixed false. Root EC2 storage remains EC2 launch
configuration.

Workflow: Create a data volume in an AZ and then attach explicitly; keep
root/data terminology clear. Cost/operations: Provisioned GiB, IOPS/throughput
above included baseline and retained unattached storage.

Primary references:
[Linux EC2 device naming](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/device_naming.html),
[EBS native volume](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-volume.html);
[AWS::EC2::Volume](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-volume.html)
(current document SHA-256
`a58d57588411e1ad46466559dfee4829712e1dc7e8ec4d0e183964483c02cdbf`).

Source/test references at exact base:
`apps/web/src/features/editor/model/ebs-service-setup.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/services/ebs.ts`,
`packages/provider-aws/src/ebs.test.ts`, `services/iac-compiler/ebs.go`. Asset
`{"file":null,"iconId":"aws.ebs.volume.icon","placeholderReason":"missing","serviceName":"EBS data volume","state":"placeholder"}`.

### EBS volume attachment — `aws.ebs.volume-attachment`

Decision: **Owned native attachment resource**. Attachment has a distinct native
identity and references a volume and instance. Device name alone must not
replace those identities. Single canonical volume owner and same-AZ instance,
Linux device allowlist, no forced detach and external guest formatting/mounting.
Retention and guest state require explicit cleanup interpretation.

Workflow: Create from volume settings; explain EC2 device mapping versus guest
device/mount readiness. Cost/operations: Attachment itself is relational;
underlying EC2/EBS charges and retained data matter.

Primary references:
[Linux EC2 device naming](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/device_naming.html),
[EBS native volume](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-volume.html);
[AWS::EC2::VolumeAttachment](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-volumeattachment.html)
(current document SHA-256
`5df3e76ebe24d93fce77c87864262c5e2f19af1bafe19619df685a46dce93062`).

Source/test references at exact base:
`apps/web/src/features/editor/model/ebs-service-setup.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/services/ebs.ts`,
`services/iac-compiler/ebs.go`. Asset
`{"file":null,"iconId":"aws.ebs.volume-attachment.icon","placeholderReason":"missing","serviceName":"EBS volume attachment","state":"placeholder"}`.

### Availability Zone — `aws.ec2.availability-zone`

Decision: **Visual boundary; no deployable AWS resource**. AZ represents
placement, not a newly created AWS service/resource. Explicit physical AZ name
must belong to the modeled Region; two distinct AZ nodes do not prove two
distinct physical zones. VPC containment is a diagram convention rather than AZ
ownership by a VPC.

Workflow: Explain that VPC spans AZs and subnets select an AZ; retain existing
graph convention until structural review. Cost/operations: Placement and
resilience can change resource costs; boundary has no direct resource charge.

Primary references:
[AWS Regions and Availability Zones](https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions-availability-zones.html).

Source/test references at exact base:
`apps/web/src/features/editor/model/parent-connection-command.test.ts`,
`apps/web/src/features/editor/model/service-setup.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/networking-connections.ts`,
`packages/provider-aws/src/catalog/services/availability-zone.ts`,
`packages/provider-aws/src/catalog/services/ebs.ts`,
`packages/provider-aws/src/catalog/services/subnet.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`packages/provider-aws/src/ec2-compute.test.ts`,
`packages/provider-aws/src/networking-catalog.test.ts`,
`packages/provider-aws/src/networking-validation.test.ts`,
`packages/provider-aws/src/provider-extension-artifacts.test.ts`,
`services/iac-compiler/cloudformation_renderer.go`,
`services/iac-compiler/terraform_networking.go`,
`services/iac-compiler/terraform_renderer.go`. Asset
`{"automatedSecurityResult":"passed","awsServiceFamily":"AWS Global Infrastructure","destinationAssetId":"aws.cloudmarkup.provider-icons.asset.region-boundary","file":"region-boundary.svg","iconId":"aws.cloudmarkup.icons.availability-zone","mappingType":"service-family","mediaType":"image/svg+xml","normalizedBytes":1015,"normalizedSha256":"sha256:93b8ad471815805be0622b0ea3f94c7bc53697f818776c4180ab243e90018754","serviceName":"Availability Zone","sourceBytes":1096,"sourceMember":"Architecture-Group-Icons_04302026/Region_32.svg","sourceSha256":"sha256:848203d40c55e213c84c1b8a3e14c2fa92aaa793b31a5c17a5fd1737ef58b8ca","state":"approved","transformationSteps":["remove-unused-root-xlink-namespace-v1","validate-svg-v2","normalize-svg-text-v1","verify-selected-source-v1"],"viewBox":"0 0 40 40"}`.

### Gateway VPC endpoint — `aws.ec2.gateway-vpc-endpoint`

Decision: **Separate native resource; S3/DynamoDB choice is variation**. Gateway
endpoint has native identity, VPC/route-table bindings and lifecycle. Gateway
only and service enum S3/DynamoDB; restricted policy is owned typed
configuration. Endpoint policy complements rather than replaces
resource/identity permission. It does not provide arbitrary internet egress.

Workflow: Use service selection within one gateway-endpoint card and show route
tables/policy. Cost/operations: Gateway endpoint is a connectivity choice;
related transfer/service usage remains separate.

Primary references:
[Gateway endpoints for Amazon S3 and DynamoDB](https://docs.aws.amazon.com/vpc/latest/privatelink/gateway-endpoints.html);
[AWS::EC2::VPCEndpoint](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-vpcendpoint.html)
(current document SHA-256
`ccbf43fdefa157642cab91252ac0fed028a9ebc19f2791a3538d2a8052bd7f61`).

Source/test references at exact base:
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/networking-connections.ts`,
`packages/provider-aws/src/catalog/services/gateway-vpc-endpoint.ts`,
`packages/provider-aws/src/catalog/services/iam-policy-document.ts`,
`packages/provider-aws/src/catalog/services/index.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`packages/provider-aws/src/networking-catalog.test.ts`,
`packages/provider-aws/src/networking-policy.test.ts`,
`packages/provider-aws/src/networking-validation.test.ts`,
`packages/provider-aws/src/provider-extension-artifacts.test.ts`,
`services/iac-compiler/cloudformation_renderer.go`,
`services/iac-compiler/terraform_artifacts.go`,
`services/iac-compiler/terraform_networking.go`,
`services/iac-compiler/terraform_renderer.go`,
`services/iac-compiler/terraform_resources.go`. Asset
`{"automatedSecurityResult":"passed","awsServiceFamily":"Amazon Virtual Private Cloud","destinationAssetId":"aws.cloudmarkup.provider-icons.asset.vpc-endpoint","file":"vpc-endpoint.svg","iconId":"aws.cloudmarkup.icons.gateway-vpc-endpoint","mappingType":"service-family","mediaType":"image/svg+xml","normalizedBytes":2433,"normalizedSha256":"sha256:b6018f88c4f16a1dab2f962ebe712bb9f3907e4b7e1ec85f10b3204db8d1274d","serviceName":"Gateway VPC endpoint","sourceBytes":2514,"sourceMember":"Resource-Icons_04302026/Res_Networking-Content-Delivery/Res_Amazon-VPC_Endpoints_48.svg","sourceSha256":"sha256:08ca5b0393a5df5a5342d0d9612ff27df86b413087ed15222530c3add811fbf6","state":"approved","transformationSteps":["remove-unused-root-xlink-namespace-v1","validate-svg-v2","normalize-svg-text-v1","verify-selected-source-v1"],"viewBox":"0 0 48 48"}`.

### EC2 instance — `aws.ec2.instance`

Decision: **Separate native resource**. Instance lifecycle, AMI and native
address remain independent from volumes/profile. Private Linux/HVM/EBS root with
bounded t3/t4g and architecture attestation, IMDSv2 and encrypted gp3 root only.
Root disk settings belong here; additional data volumes remain EBS resources. No
source-created AMI, SSH ingress or bootstrap/user-data is inferred.

Workflow: Require the AMI compatibility evidence and private network path; offer
profile/storage helpers. Cost/operations: Instance hours, burst credits,
monitoring, root disk and retained volumes.

Primary references:
[AMI identity and compatibility](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/AMIs.html),
[EC2 instance properties and replacement](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-instance.html),
[EC2 instance profile](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-iam-instanceprofile.html);
[AWS::EC2::Instance](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-instance.html)
(current document SHA-256
`b7b1f0203efadc9cc268f311d47d73a393578d9f81ae5b5f2b78a642f883fb16`).

Source/test references at exact base:
`apps/web/src/features/editor/model/service-setup.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/ec2-connections.ts`,
`packages/provider-aws/src/catalog/services/ebs.ts`,
`packages/provider-aws/src/catalog/services/ec2-compute.ts`,
`packages/provider-aws/src/catalog/services/elb.ts`,
`packages/provider-aws/src/ec2-compute.test.ts`, `services/iac-compiler/ec2.go`.
Asset
`{"file":null,"iconId":"aws.cloudmarkup.icons.ec2-instance","placeholderReason":"missing","serviceName":"EC2 instance","state":"placeholder"}`.

### Internet gateway — `aws.ec2.internet-gateway`

Decision: **Separate native resource**. Gateway can attach to a VPC and retains
a native identity. Attachment and a route are separate typed relationships.
Gateway existence alone does not make a subnet public or expose a private
instance.

Workflow: Show gateway attachment and route together in Guided setup.
Cost/operations: Gateway/route intent is distinct from transfer/resource usage.

Primary references:
[Connect your VPC to the internet using an internet gateway](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html);
[AWS::EC2::InternetGateway](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-internetgateway.html)
(current document SHA-256
`2283e003e4a28174721e21d885dc3fe03b8d0899cd88aee805be619b41f79707`).

Source/test references at exact base:
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/networking-connections.ts`,
`packages/provider-aws/src/catalog/services/index.ts`,
`packages/provider-aws/src/catalog/services/internet-gateway.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`packages/provider-aws/src/networking-catalog.test.ts`,
`packages/provider-aws/src/networking-validation.test.ts`,
`services/iac-compiler/cloudformation_renderer.go`,
`services/iac-compiler/terraform_artifacts.go`,
`services/iac-compiler/terraform_networking.go`,
`services/iac-compiler/terraform_renderer.go`,
`services/iac-compiler/terraform_resources.go`. Asset
`{"automatedSecurityResult":"passed","awsServiceFamily":"Amazon Virtual Private Cloud","destinationAssetId":"aws.cloudmarkup.provider-icons.asset.internet-gateway","file":"internet-gateway.svg","iconId":"aws.cloudmarkup.icons.internet-gateway","mappingType":"exact-resource","mediaType":"image/svg+xml","normalizedBytes":1986,"normalizedSha256":"sha256:309ffcbc86514075952e296609a5fc853cbab2b886308c935bd5f105bb7a2055","serviceName":"Internet gateway","sourceBytes":2067,"sourceMember":"Resource-Icons_04302026/Res_Networking-Content-Delivery/Res_Amazon-VPC_Internet-Gateway_48.svg","sourceSha256":"sha256:d31cd837a33508372a7d43a556daa0138b6e2004c94a76e2f7f8b977409659aa","state":"approved","transformationSteps":["remove-unused-root-xlink-namespace-v1","validate-svg-v2","normalize-svg-text-v1","verify-selected-source-v1"],"viewBox":"0 0 48 48"}`.

### NAT gateway — `aws.ec2.nat-gateway`

Decision: **Separate native resource; supported availability mode is
variation**. NAT has native identity, zonal placement and allocation lifecycle.
Public zonal NAT requires caller-supplied allocation ID and subnet/IGW routes.
EIP is not created or adopted by this definition. Private/regional NAT and IPv6
paths are unsupported contracts.

Workflow: Explain allocation prerequisite and per-AZ resilience/cost choice.
Cost/operations: Gateway hours and processed/transfer data, including idle
infrastructure.

Primary references:
[NAT gateway basics](https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-basics.html);
[AWS::EC2::NatGateway](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-natgateway.html)
(current document SHA-256
`872609d80cc01617777e4a07d82d17d9cda34ea809c2cc03af09bd75d8a34db4`).

Source/test references at exact base:
`apps/web/src/features/editor/model/service-setup.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/networking-connections.ts`,
`packages/provider-aws/src/catalog/services/index.ts`,
`packages/provider-aws/src/catalog/services/nat-gateway.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`packages/provider-aws/src/networking-catalog.test.ts`,
`packages/provider-aws/src/networking-validation.test.ts`,
`services/iac-compiler/cloudformation_renderer.go`,
`services/iac-compiler/terraform_artifacts.go`,
`services/iac-compiler/terraform_networking.go`,
`services/iac-compiler/terraform_renderer.go`,
`services/iac-compiler/terraform_resources.go`. Asset
`{"automatedSecurityResult":"passed","awsServiceFamily":"Amazon Virtual Private Cloud","destinationAssetId":"aws.cloudmarkup.provider-icons.asset.nat-gateway","file":"nat-gateway.svg","iconId":"aws.cloudmarkup.icons.nat-gateway","mappingType":"exact-resource","mediaType":"image/svg+xml","normalizedBytes":3178,"normalizedSha256":"sha256:3d3c284241fcde69ac1f9f064d3b101062dde9ce6e2fd5f9c29030f828fe4317","serviceName":"NAT gateway","sourceBytes":3259,"sourceMember":"Resource-Icons_04302026/Res_Networking-Content-Delivery/Res_Amazon-VPC_NAT-Gateway_48.svg","sourceSha256":"sha256:dcb6c564523dd54b0a7475e99f926d92001b7295413b598f766922efc07bd768","state":"approved","transformationSteps":["remove-unused-root-xlink-namespace-v1","validate-svg-v2","normalize-svg-text-v1","verify-selected-source-v1"],"viewBox":"0 0 48 48"}`.

### Route — `aws.ec2.route`

Decision: **Owned native route resource**. Route belongs to a route table but
has a stable native export address. One destination CIDR and exactly one modeled
gateway/NAT target; no implicit default route or guessed target. Root creation
is forbidden.

Workflow: Edit from route-table settings without flattening away the route
identity. Cost/operations: Traffic destination changes connectivity/transfer
behavior; route is not its own throughput service.

Primary references:
[Routes in a route table](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Route_Tables.html#route-table-routes);
[AWS::EC2::Route](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-route.html)
(current document SHA-256
`568800f04952488dcd6251d774c4ce8ddd839703770e732292d932d224f4112d`).

Source/test references at exact base:
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/networking-connections.ts`,
`packages/provider-aws/src/catalog/services/index.ts`,
`packages/provider-aws/src/catalog/services/route.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`packages/provider-aws/src/networking-catalog.test.ts`,
`packages/provider-aws/src/networking-policy.test.ts`,
`packages/provider-aws/src/networking-validation.test.ts`,
`services/iac-compiler/cloudformation_renderer.go`,
`services/iac-compiler/terraform_artifacts.go`,
`services/iac-compiler/terraform_networking.go`,
`services/iac-compiler/terraform_renderer.go`,
`services/iac-compiler/terraform_resources.go`. Asset `null`.

### Route table — `aws.ec2.route-table`

Decision: **Separate native resource**. Route table can be shared by subnets and
owns routes/associations. Canonical VPC plus explicit subnet associations;
public/private tier needs complete route checks. Default names are template
labels, not live uniqueness evidence.

Workflow: Create reusable table, then owned routes and associations.
Cost/operations: Associated gateways and transfer paths drive charges.

Primary references:
[Route tables for your VPC](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Route_Tables.html);
[AWS::EC2::RouteTable](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-routetable.html)
(current document SHA-256
`67b950c9fd81e4cc66ef21f474b21f2122ec0e41c6b2dc925f360c1209a8e617`).

Source/test references at exact base:
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/networking-connections.ts`,
`packages/provider-aws/src/catalog/services/index.ts`,
`packages/provider-aws/src/catalog/services/route-table-association.ts`,
`packages/provider-aws/src/catalog/services/route-table.ts`,
`packages/provider-aws/src/catalog/services/route.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`packages/provider-aws/src/networking-catalog.test.ts`,
`packages/provider-aws/src/networking-policy.test.ts`,
`packages/provider-aws/src/networking-validation.test.ts`,
`packages/provider-aws/src/provider-extension-artifacts.test.ts`,
`services/iac-compiler/cloudformation_renderer.go`,
`services/iac-compiler/terraform_artifacts.go`,
`services/iac-compiler/terraform_networking.go`,
`services/iac-compiler/terraform_renderer.go`,
`services/iac-compiler/terraform_resources.go`. Asset
`{"automatedSecurityResult":"passed","awsServiceFamily":"Amazon Virtual Private Cloud","destinationAssetId":"aws.cloudmarkup.provider-icons.asset.vpc-family","file":"vpc-family.svg","iconId":"aws.cloudmarkup.icons.route-table","mappingType":"service-family","mediaType":"image/svg+xml","normalizedBytes":3248,"normalizedSha256":"sha256:a2b399070a51a39e566e3c4fd9d6277d624950aee99c4a54a54f436ed3c36bbc","serviceName":"Route table","sourceBytes":3329,"sourceMember":"Architecture-Service-Icons_04302026/Arch_Networking-Content-Delivery/48/Arch_Amazon-Virtual-Private-Cloud_48.svg","sourceSha256":"sha256:7b842e6a64b2238b159d2470e9dc2389f0d1d373a2236abe20aed971b1f69ded","state":"approved","transformationSteps":["remove-unused-root-xlink-namespace-v1","validate-svg-v2","normalize-svg-text-v1","verify-selected-source-v1"],"viewBox":"0 0 64 64"}`.

### Subnet route-table association — `aws.ec2.route-table-association`

Decision: **Owned native association resource**. Association has distinct native
identity even though graph marks it nondeployable. Exactly one owner table and
target subnet; one subnet cannot gain competing canonical table associations. It
is not an independent AWS service.

Workflow: Create from route table or subnet helper while preserving
inverse/ownership. Cost/operations: Relational mapping; costs belong to
traffic/infrastructure.

Primary references:
[Subnet route table associations](https://docs.aws.amazon.com/vpc/latest/userguide/subnet-route-tables.html);
[AWS::EC2::SubnetRouteTableAssociation](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-subnetroutetableassociation.html)
(current document SHA-256
`ba7a01640536f43a689cf4bf58bf18d27c4547fcdba076fe53ccaf78e8eea08f`).

Source/test references at exact base:
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/networking-connections.ts`,
`packages/provider-aws/src/catalog/services/index.ts`,
`packages/provider-aws/src/catalog/services/route-table-association.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`packages/provider-aws/src/networking-catalog.test.ts`,
`packages/provider-aws/src/networking-validation.test.ts`,
`services/iac-compiler/cloudformation_renderer.go`,
`services/iac-compiler/terraform_artifacts.go`,
`services/iac-compiler/terraform_networking.go`,
`services/iac-compiler/terraform_renderer.go`,
`services/iac-compiler/terraform_resources.go`. Asset `null`.

### Security group — `aws.ec2.security-group`

Decision: **Separate native resource**. Group has native identity and can be
referenced by multiple resources. One explicit VPC; ingress/egress rules are
owned configurations with native projections. Absence of a configured rule must
not imply an AWS default policy.

Workflow: Show effective inbound/outbound paths and related rules from the
group. Cost/operations: Security/capacity effects are indirect; avoid a
fictitious SG hourly estimate.

Primary references:
[Control traffic to your AWS resources using security groups](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html);
[AWS::EC2::SecurityGroup](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-securitygroup.html)
(current document SHA-256
`f377d7f0e35b42f1e0c628df4de53e0b1052142723a2117752666f6a11b6cef6`).

Source/test references at exact base:
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/ec2-connections.ts`,
`packages/provider-aws/src/catalog/connections/fsx-connections.ts`,
`packages/provider-aws/src/catalog/connections/networking-connections.ts`,
`packages/provider-aws/src/catalog/services/aurora-postgres.ts`,
`packages/provider-aws/src/catalog/services/ec2-compute.ts`,
`packages/provider-aws/src/catalog/services/ecs-fargate.ts`,
`packages/provider-aws/src/catalog/services/elb.ts`,
`packages/provider-aws/src/catalog/services/fsx.ts`,
`packages/provider-aws/src/catalog/services/index.ts`,
`packages/provider-aws/src/catalog/services/rds-postgres.ts`,
`packages/provider-aws/src/catalog/services/security-group-egress-rule.ts`,
`packages/provider-aws/src/catalog/services/security-group-ingress-rule.ts`,
`packages/provider-aws/src/catalog/services/security-group.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`packages/provider-aws/src/ec2-compute.test.ts`,
`packages/provider-aws/src/networking-catalog.test.ts`,
`packages/provider-aws/src/networking-policy.test.ts`,
`packages/provider-aws/src/networking-validation.test.ts`,
`packages/provider-aws/src/provider-extension-artifacts.test.ts`,
`services/iac-compiler/cloudformation_renderer.go`,
`services/iac-compiler/terraform_artifacts.go`,
`services/iac-compiler/terraform_networking.go`,
`services/iac-compiler/terraform_renderer.go`,
`services/iac-compiler/terraform_resources.go`. Asset
`{"automatedSecurityResult":"passed","awsServiceFamily":"Amazon Virtual Private Cloud","destinationAssetId":"aws.cloudmarkup.provider-icons.asset.vpc-family","file":"vpc-family.svg","iconId":"aws.cloudmarkup.icons.security-group","mappingType":"service-family","mediaType":"image/svg+xml","normalizedBytes":3248,"normalizedSha256":"sha256:a2b399070a51a39e566e3c4fd9d6277d624950aee99c4a54a54f436ed3c36bbc","serviceName":"Security group","sourceBytes":3329,"sourceMember":"Architecture-Service-Icons_04302026/Arch_Networking-Content-Delivery/48/Arch_Amazon-Virtual-Private-Cloud_48.svg","sourceSha256":"sha256:7b842e6a64b2238b159d2470e9dc2389f0d1d373a2236abe20aed971b1f69ded","state":"approved","transformationSteps":["remove-unused-root-xlink-namespace-v1","validate-svg-v2","normalize-svg-text-v1","verify-selected-source-v1"],"viewBox":"0 0 64 64"}`.

### Security group egress rule — `aws.ec2.security-group-egress-rule`

Decision: **Owned native rule resource**. Rule belongs to one group; separate
native identity avoids inline/standalone conflicts. CIDR/protocol/port bounds
are explicit, including special ICMP/all-protocol semantics. Peer-group rules
generated for ALB are a separate canonical ownership path.

Workflow: Edit beneath group with destination and protocol-specific units.
Cost/operations: Controls access/traffic; no independent service capacity.

Primary references:
[Security group rules](https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html);
[AWS::EC2::SecurityGroupEgress](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-securitygroupegress.html)
(current document SHA-256
`ccf3a5b6616f3f227992e2a80cf662599a661c923f41e3447da33e20f5207b4d`).

Source/test references at exact base:
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/networking-connections.ts`,
`packages/provider-aws/src/catalog/services/index.ts`,
`packages/provider-aws/src/catalog/services/security-group-egress-rule.ts`,
`packages/provider-aws/src/networking-catalog.test.ts`,
`packages/provider-aws/src/networking-policy.test.ts`,
`packages/provider-aws/src/networking-validation.test.ts`,
`packages/provider-aws/src/provider-extension-artifacts.test.ts`,
`services/iac-compiler/cloudformation_renderer.go`,
`services/iac-compiler/terraform_artifacts.go`,
`services/iac-compiler/terraform_networking.go`,
`services/iac-compiler/terraform_renderer.go`,
`services/iac-compiler/terraform_resources.go`. Asset `null`.

### Security group ingress rule — `aws.ec2.security-group-ingress-rule`

Decision: **Owned native rule resource**. Owned rule identity and direction must
be preserved. Source CIDR and TCP/UDP/ICMP/all-protocol constraints are
explicit. Do not silently synthesize open ingress from a connection label.

Workflow: Show source authority and port/protocol meaning near the group.
Cost/operations: Exposure/traffic consequences, not an independent charged
service.

Primary references:
[Security group rules](https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html);
[AWS::EC2::SecurityGroupIngress](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-securitygroupingress.html)
(current document SHA-256
`dbe741d83e018a9f8955853a6b9940e468c082c1b98068884264437d4982882e`).

Source/test references at exact base:
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/networking-connections.ts`,
`packages/provider-aws/src/catalog/services/index.ts`,
`packages/provider-aws/src/catalog/services/security-group-ingress-rule.ts`,
`packages/provider-aws/src/networking-catalog.test.ts`,
`packages/provider-aws/src/networking-policy.test.ts`,
`packages/provider-aws/src/networking-validation.test.ts`,
`services/iac-compiler/cloudformation_renderer.go`,
`services/iac-compiler/terraform_artifacts.go`,
`services/iac-compiler/terraform_networking.go`,
`services/iac-compiler/terraform_renderer.go`,
`services/iac-compiler/terraform_resources.go`. Asset `null`.

### Subnet — `aws.ec2.subnet`

Decision: **Placement boundary with native resource projection**. Subnet is both
a diagram container and a native deployable identity; false deployable flag must
not be read as no export. Explicit CIDR, access tier and AZ; no IPv6
autoassignment. Tier alone does not establish internet reachability, routes or
public IPv4.

Workflow: Keep subnet visual containment and native identity; clarify required
route configuration. Cost/operations: Addresses, routing and associated
workloads/gateways.

Primary references:
[Configure subnets for your VPC](https://docs.aws.amazon.com/vpc/latest/userguide/configure-subnets.html);
[AWS::EC2::Subnet](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-subnet.html)
(current document SHA-256
`e2b78b87f508123754f7a60b683c219ba1a8c2f0ffb0a074c2e048059c706768`).

Source/test references at exact base:
`apps/web/src/features/editor/model/parent-connection-command.test.ts`,
`apps/web/src/features/editor/model/service-setup.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/ec2-connections.ts`,
`packages/provider-aws/src/catalog/connections/fsx-connections.ts`,
`packages/provider-aws/src/catalog/connections/networking-connections.ts`,
`packages/provider-aws/src/catalog/services/aurora-postgres.ts`,
`packages/provider-aws/src/catalog/services/ec2-compute.ts`,
`packages/provider-aws/src/catalog/services/ecs-fargate.ts`,
`packages/provider-aws/src/catalog/services/elb.ts`,
`packages/provider-aws/src/catalog/services/fsx.ts`,
`packages/provider-aws/src/catalog/services/index.ts`,
`packages/provider-aws/src/catalog/services/nat-gateway.ts`,
`packages/provider-aws/src/catalog/services/rds-postgres.ts`,
`packages/provider-aws/src/catalog/services/subnet.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`packages/provider-aws/src/ec2-compute.test.ts`,
`packages/provider-aws/src/networking-catalog.test.ts`,
`packages/provider-aws/src/networking-validation.test.ts`,
`packages/provider-aws/src/provider-extension-artifacts.test.ts`,
`services/iac-compiler/cloudformation_renderer.go`,
`services/iac-compiler/terraform_artifacts.go`,
`services/iac-compiler/terraform_networking.go`,
`services/iac-compiler/terraform_renderer.go`,
`services/iac-compiler/terraform_resources.go`. Asset
`{"automatedSecurityResult":"passed","awsServiceFamily":"Amazon Virtual Private Cloud","destinationAssetId":"aws.cloudmarkup.provider-icons.asset.vpc-family","file":"vpc-family.svg","iconId":"aws.cloudmarkup.icons.subnet","mappingType":"service-family","mediaType":"image/svg+xml","normalizedBytes":3248,"normalizedSha256":"sha256:a2b399070a51a39e566e3c4fd9d6277d624950aee99c4a54a54f436ed3c36bbc","serviceName":"Subnet","sourceBytes":3329,"sourceMember":"Architecture-Service-Icons_04302026/Arch_Networking-Content-Delivery/48/Arch_Amazon-Virtual-Private-Cloud_48.svg","sourceSha256":"sha256:7b842e6a64b2238b159d2470e9dc2389f0d1d373a2236abe20aed971b1f69ded","state":"approved","transformationSteps":["remove-unused-root-xlink-namespace-v1","validate-svg-v2","normalize-svg-text-v1","verify-selected-source-v1"],"viewBox":"0 0 64 64"}`.

### Virtual private cloud — `aws.ec2.vpc`

Decision: **Placement boundary with native resource projection**. VPC contains
network intent and has a native resource identity despite boundary rendering.
Bounded IPv4 CIDR and DNS settings with default tenancy. Region/AZ relationships
are graph conventions; multiple VPCs cannot silently share SG/subnet ownership.

Workflow: Offer network setup as a grouped workflow; avoid making every regional
service a VPC child. Cost/operations: Associated network services and data
transfer, not a blanket VPC capacity rate.

Primary references:
[What is Amazon VPC?](https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html);
[AWS::EC2::VPC](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-vpc.html)
(current document SHA-256
`2dc6f656d19aab1bad42671ff88ef3bd038de4dc1e2b5bae5da7c87848f20986`).

Source/test references at exact base:
`apps/web/src/features/editor/model/parent-connection-command.test.ts`,
`apps/web/src/features/editor/model/service-setup.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/networking-connections.ts`,
`packages/provider-aws/src/catalog/services/availability-zone.ts`,
`packages/provider-aws/src/catalog/services/elb.ts`,
`packages/provider-aws/src/catalog/services/gateway-vpc-endpoint.ts`,
`packages/provider-aws/src/catalog/services/index.ts`,
`packages/provider-aws/src/catalog/services/route-table.ts`,
`packages/provider-aws/src/catalog/services/vpc.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`packages/provider-aws/src/ec2-compute.test.ts`,
`packages/provider-aws/src/networking-catalog.test.ts`,
`packages/provider-aws/src/networking-validation.test.ts`,
`services/iac-compiler/cloudformation_renderer.go`,
`services/iac-compiler/terraform_artifacts.go`,
`services/iac-compiler/terraform_networking.go`,
`services/iac-compiler/terraform_renderer.go`,
`services/iac-compiler/terraform_resources.go`. Asset
`{"automatedSecurityResult":"passed","awsServiceFamily":"Amazon Virtual Private Cloud","destinationAssetId":"aws.cloudmarkup.provider-icons.asset.vpc-boundary","file":"vpc-boundary.svg","iconId":"aws.cloudmarkup.icons.vpc","mappingType":"exact-resource","mediaType":"image/svg+xml","normalizedBytes":3524,"normalizedSha256":"sha256:fc17f3431522948c8f905089a2ee26f20f9dcb3b4dd79eb5659857c596d30a29","serviceName":"Virtual private cloud","sourceBytes":3605,"sourceMember":"Architecture-Group-Icons_04302026/Virtual-private-cloud-VPC_32.svg","sourceSha256":"sha256:a225286901ea59f74d52c37ccaa2660f9e2728a76cd4ee0892c29c7a386ef98c","state":"approved","transformationSteps":["remove-unused-root-xlink-namespace-v1","validate-svg-v2","normalize-svg-text-v1","verify-selected-source-v1"],"viewBox":"0 0 40 40"}`.

### Published image identity — `aws.ecr.image-reference`

Decision: **Owned external artifact configuration**. Digest-pinned image is a
reference to published content, not a new repository/service. Publication
status, manifest kind and architecture are caller assertions; no image
build/push or live existence check occurs. Publication-required cannot claim
runnable tasks.

Workflow: Keep in repository/container setup and distinguish artifact readiness
from infrastructure readiness. Cost/operations: Image storage/transfer and
scanning belong to repository/use.

Primary references:
[ECR repository native contract](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecr-repository.html),
[ECS task definition parameters](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html).

Source/test references at exact base:
`apps/web/src/features/editor/model/ecs-service-setup.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/services/ecs-fargate.ts`,
`services/iac-compiler/ecs.go`. Asset `null`.

### ECR repository — `aws.ecr.repository`

Decision: **Separate native resource**. Repository retains named image storage
and policy lifecycle. AES256, immutable tags, scan-on-push and retention are
bounded. Image digest/publication remains owned metadata; no generated
application/container artifact is implied.

Workflow: Provide repository plus explicit published-image reference.
Cost/operations: Stored image bytes, transfer and scanning; retained content
persists.

Primary references:
[ECR repository native contract](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecr-repository.html),
[ECS task definition parameters](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html);
[AWS::ECR::Repository](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecr-repository.html)
(current document SHA-256
`c763bcd7d2d4944fec58e03b7249d52e09932eea0202444689dea3d1f0a23522`).

Source/test references at exact base:
`apps/web/src/features/editor/model/ecs-service-setup.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/services/ecs-fargate.ts`,
`packages/provider-aws/src/ecs-fargate.test.ts`,
`packages/provider-aws/src/provider-extension-artifacts.test.ts`,
`services/iac-compiler/ecs.go`. Asset
`{"file":null,"iconId":"aws.cloudmarkup.icons.ecr-repository","placeholderReason":"missing","serviceName":"ECR repository","state":"placeholder"}`.

### ECS cluster — `aws.ecs.cluster`

Decision: **Separate native resource**. Cluster identity is distinct from
service/task revisions. Bounded Fargate path; Container Insights disabled. It is
regional and related networking is supplied to services rather than nesting a
cluster in a subnet.

Workflow: Group ECS resources under a cluster workflow without merging their
native identities. Cost/operations: Running tasks and optional telemetry, not an
invented cluster capacity charge.

Primary references:
[ECR repository native contract](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecr-repository.html),
[ECS task definition parameters](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html);
[AWS::ECS::Cluster](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecs-cluster.html)
(current document SHA-256
`6698c439b253490ae2a7fa7a9312a04bec12e798856d1036808b553d430dad83`).

Source/test references at exact base:
`apps/web/src/features/editor/model/ecs-service-setup.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/services/ecs-fargate.ts`,
`services/iac-compiler/ecs.go`. Asset
`{"file":null,"iconId":"aws.cloudmarkup.icons.ecs-cluster","placeholderReason":"missing","serviceName":"ECS cluster","state":"placeholder"}`.

### Container definition — `aws.ecs.container-definition`

Decision: **Owned task configuration**. Container is part of a task-definition
revision and has no separate native resource identity. One essential
non-root/read-only container, bounded TCP port, digest-pinned image, health
executable and nonblocking logs. Health command is a reviewed constrained form,
not arbitrary user bootstrap.

Workflow: Edit within task definition; show health/log/image readiness and port
matching. Cost/operations: Task CPU/memory, log ingestion and image use; avoid
per-container double counting.

Primary references:
[ECR repository native contract](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecr-repository.html),
[ECS task definition parameters](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html).

Source/test references at exact base:
`apps/web/src/features/editor/model/ecs-service-setup.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/services/ecs-fargate.ts`,
`services/iac-compiler/ecs.go`. Asset `null`.

### Fargate service — `aws.ecs.service`

Decision: **Separate native resource**. Service owns desired count and
deployment lifecycle distinct from task definition/cluster. Private awsvpc
Fargate at platform1.4.0; desiredCount0 is safe staging intent, not proof of a
running workload. Explicit subnets/SG/task/cluster roles and readiness are
needed.

Workflow: Show stopped-versus-running intent and ALB integration; retain native
service identity. Cost/operations: Desired task count, CPU/memory runtime,
networking and logs.

Primary references:
[ECR repository native contract](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecr-repository.html),
[ECS task definition parameters](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html);
[AWS::ECS::Service](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecs-service.html)
(current document SHA-256
`256e19b494228b3d482a231cf122631e3ab82a312aa2dd398fd1fb47638940e2`).

Source/test references at exact base:
`apps/web/src/features/editor/model/ecs-service-setup.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/services/ecs-fargate.ts`,
`packages/provider-aws/src/catalog/services/elb.ts`,
`services/iac-compiler/ecs.go`. Asset
`{"file":null,"iconId":"aws.cloudmarkup.icons.ecs-service","placeholderReason":"missing","serviceName":"Fargate service","state":"placeholder"}`.

### Fargate task definition — `aws.ecs.task-definition`

Decision: **Separate revisioned native resource**. Task definition has
family/revision lifecycle; it should not be a bag of service options. Linux
Fargate, awsvpc and bounded CPU/memory pairs with architecture consistency;
execution/task role distinction and owned container are explicit. More capacity
modes require new supported schemas.

Workflow: Offer task template helper and owned container editor; show execution
role separately from application task role. Cost/operations: CPU/memory of
running tasks and downstream dependencies, not double-charge idle definition.

Primary references:
[ECR repository native contract](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecr-repository.html),
[ECS task definition parameters](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html);
[AWS::ECS::TaskDefinition](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecs-taskdefinition.html)
(current document SHA-256
`45cc25a57b6fdab38d6b259365fe7e5b6b26dee8bf6209bfdb702ef2a365c958`).

Source/test references at exact base:
`apps/web/src/features/editor/model/ecs-service-setup.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/services/ecs-fargate.ts`,
`packages/provider-aws/src/ecs-fargate.test.ts`,
`packages/provider-aws/src/provider-extension-artifacts.test.ts`,
`services/iac-compiler/ecs.go`. Asset
`{"file":null,"iconId":"aws.cloudmarkup.icons.ecs-task-definition","placeholderReason":"missing","serviceName":"Fargate task definition","state":"placeholder"}`.

### Application Load Balancer — `aws.elb.application-load-balancer`

Decision: **Separate native resource; scheme is variation**. ALB identity,
subnet/SG/retention lifecycle differ from listener and target group. IPv4
application only, two-AZ topology, defensive parsing, invalid-header drop and
retention. Internal/internet-facing stays a scheme option. NLB/GWLB need
separate contracts, not an unsupported dropdown.

Workflow: Provide an ALB setup sequence with network, listener and target group
helpers. Cost/operations: ALB hours/LCUs, transfer and retained serving
infrastructure.

Primary references:
[ALB security group paths](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-update-security-groups.html),
[ALB native contract](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-loadbalancer.html),
[ECS ALB integration](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/alb.html),
[HTTPS listener](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-listener.html),
[ALB target group](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-targetgroup.html);
[AWS::ElasticLoadBalancingV2::LoadBalancer](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-loadbalancer.html)
(current document SHA-256
`4e5430af023cc837a3c346087bbeec0432e3413c9c61556946d4257c55bae6d8`).

Source/test references at exact base:
`apps/web/src/features/editor/model/elb-service-setup.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/services/elb.ts`,
`services/iac-compiler/elb.go`. Asset
`{"file":null,"iconId":"aws.elb.application-load-balancer.icon","placeholderReason":"missing","serviceName":"Application Load Balancer","state":"placeholder"}`.

### ALB backend access — `aws.elb.backend-access-configuration`

Decision: **Owned configuration with native SG rule projections**. Access binds
target-group backend intent to two dedicated peer security groups; it is not
another load balancer. Exact TCP peer ingress/egress on one backend/health port;
no broad CIDR or arbitrary policy. Owner and SG bindings must remain canonical,
and generated rules retain identities.

Workflow: Edit from target-group setup and expose the peer access path.
Cost/operations: Traffic consequences and related resources; no separate
backend-access capacity charge.

Primary references:
[ALB security group paths](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-update-security-groups.html),
[ALB native contract](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-loadbalancer.html),
[ECS ALB integration](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/alb.html),
[HTTPS listener](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-listener.html),
[ALB target group](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-targetgroup.html).

Source/test references at exact base:
`apps/web/src/features/editor/model/elb-service-setup.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/services/elb.ts`,
`services/iac-compiler/elb.go`. Asset `null`.

### ALB HTTPS listener — `aws.elb.https-listener`

Decision: **Owned native listener resource**. Listener belongs to ALB but has a
distinct native identity and certificate lifecycle reference. HTTPS443, one
reviewed TLS policy, one forward action, exact server name and regional DNS
certificate. DNS mapping is external. Current shared port help incorrectly
describes HTTP backend semantics for this HTTPS viewer port; propose targeted
help correction in a reviewed successor.

Workflow: Create from ALB; distinguish viewer TLS from unencrypted HTTP backend.
Cost/operations: ALB/use charges and TLS/hostname readiness; listener itself is
not another ALB.

Primary references:
[ALB security group paths](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-update-security-groups.html),
[ALB native contract](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-loadbalancer.html),
[ECS ALB integration](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/alb.html),
[HTTPS listener](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-listener.html),
[ALB target group](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-targetgroup.html);
[AWS::ElasticLoadBalancingV2::Listener](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-listener.html)
(current document SHA-256
`3de0b081e48405b8c54cc9bb69b66bd200d07c270add15ed637fd440956bf190`).

Source/test references at exact base:
`apps/web/src/features/editor/model/elb-service-setup.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/services/elb.ts`,
`services/iac-compiler/elb.go`. Asset
`{"file":null,"iconId":"aws.elb.https-listener.icon","placeholderReason":"missing","serviceName":"ALB HTTPS listener","state":"placeholder"}`.

### ALB target group — `aws.elb.target-group`

Decision: **Separate reusable native resource with bounded attachment**. Target
group has native identity and health/lifecycle settings independent of ALB.
HTTP/HTTP1, one EC2 instance or one private Fargate service, exact backend
port/health and graceful startup constraints. EC2 native attachment is
generated; ECS integrates through service configuration.

Workflow: Keep backendMode as a variation and offer target/peer-access helpers.
Cost/operations: Backend resources and ALB routing/health; avoid charging
generated attachment twice.

Primary references:
[ALB security group paths](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-update-security-groups.html),
[ALB native contract](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-loadbalancer.html),
[ECS ALB integration](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/alb.html),
[HTTPS listener](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-listener.html),
[ALB target group](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-targetgroup.html);
[AWS::ElasticLoadBalancingV2::TargetGroup](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-targetgroup.html)
(current document SHA-256
`b751a5ef5b02b5fbf9848b4495ecd6796b5eb17df7acd6ce8c3c56c578aba555`).

Source/test references at exact base:
`apps/web/src/features/editor/model/elb-service-setup.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/services/elb.ts`,
`packages/provider-aws/src/elb.test.ts`,
`packages/provider-aws/src/provider-extension-artifacts.test.ts`,
`services/iac-compiler/elb.go`. Asset
`{"file":null,"iconId":"aws.elb.target-group.icon","placeholderReason":"missing","serviceName":"ALB target group","state":"placeholder"}`.

### EventBridge event bus — `aws.eventbridge.event-bus`

Decision: **Separate native resource; default/custom is variation**. Custom bus
has native identity; default bus is an existing service namespace handled by
bounded renderer intent. DEFAULT/CUSTOM selection does not imply a second
EventBridge service. Rules and resource policy remain distinct owner graphs.
Cross-account/Region targets and arbitrary policies are not implied.

Workflow: Explain default versus newly created custom bus and scope rules
beneath it. Cost/operations: Events, routing and destinations; actual event
sources are independent.

Primary references:
[Amazon EventBridge rules](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rules.html);
[AWS::Events::EventBus](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-events-eventbus.html)
(current document SHA-256
`aad92b39484c49406b1981680050d408dc47f196801520399043227eb185aa66`).

Source/test references at exact base:
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/catalog/services/eventbridge-eventing.ts`,
`packages/provider-aws/src/catalog/services/iam-policy-document.ts`,
`packages/provider-aws/src/catalog/services/index.ts`,
`packages/provider-aws/src/event-driven-catalog.test.ts`,
`packages/provider-aws/src/provider-extension-artifacts.test.ts`,
`packages/provider-aws/src/validation.test.ts`,
`services/iac-compiler/cloudformation_eventing.go`,
`services/iac-compiler/cloudformation_renderer.go`,
`services/iac-compiler/cloudformation_resources.go`,
`services/iac-compiler/terraform_artifacts.go`,
`services/iac-compiler/terraform_eventing.go`,
`services/iac-compiler/terraform_eventing_test.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_renderer.go`,
`services/iac-compiler/terraform_test.go`. Asset
`{"automatedSecurityResult":"passed","awsServiceFamily":"Amazon EventBridge","destinationAssetId":"aws.cloudmarkup.provider-icons.asset.eventbridge","file":"eventbridge.svg","iconId":"aws.cloudmarkup.icons.eventbridge","mappingType":"service-family","mediaType":"image/svg+xml","normalizedBytes":3835,"normalizedSha256":"sha256:b1d5f73b5f2500b807576c84ff7108a5498e813a4c16ace4227df15f14962925","serviceName":"EventBridge event bus","sourceBytes":3916,"sourceMember":"Architecture-Service-Icons_04302026/Arch_Application-Integration/48/Arch_Amazon-EventBridge_48.svg","sourceSha256":"sha256:78f7fead59316ad6ac38cc262582bec81fc6649d0f6fdd5327708c08bede65e9","state":"approved","transformationSteps":["remove-unused-root-xlink-namespace-v1","validate-svg-v2","normalize-svg-text-v1","verify-selected-source-v1"],"viewBox":"0 0 64 64"}`.

### EventBridge rule — `aws.eventbridge.rule`

Decision: **Separate owned native resource**. Rule belongs to a bus and owns
targets, with its own stable native address. Event pattern versus bounded rate
schedule is configuration. Source/detail/filter enums constrain the application
contract; arbitrary cron/JSON patterns require typed extension, not raw text.

Workflow: Create a rule under bus and edit target/delivery intent beneath it.
Cost/operations: Matched events/schedules and target execution.

Primary references:
[Amazon EventBridge rules](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rules.html);
[AWS::Events::Rule](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-events-rule.html)
(current document SHA-256
`081c55ce7bd8443ef42666bf35c70eaca26ee179c968eefad54e96dfd3fb476e`).

Source/test references at exact base:
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/catalog/services/eventbridge-eventing.ts`,
`packages/provider-aws/src/catalog/services/index.ts`,
`packages/provider-aws/src/event-driven-catalog.test.ts`,
`packages/provider-aws/src/provider-extension-artifacts.test.ts`,
`services/iac-compiler/cloudformation_renderer.go`,
`services/iac-compiler/cloudformation_resources.go`,
`services/iac-compiler/terraform_artifacts.go`,
`services/iac-compiler/terraform_eventing.go`,
`services/iac-compiler/terraform_eventing_test.go`,
`services/iac-compiler/terraform_renderer.go`. Asset
`{"automatedSecurityResult":"passed","awsServiceFamily":"Amazon EventBridge","destinationAssetId":"aws.cloudmarkup.provider-icons.asset.eventbridge-rule","file":"eventbridge-rule.svg","iconId":"aws.cloudmarkup.icons.eventbridge-rule","mappingType":"exact-resource","mediaType":"image/svg+xml","normalizedBytes":1886,"normalizedSha256":"sha256:a5bedb712ef040289efccbf9a12c7e31f1b3f3cbc054a38e47fb85b80b164c03","serviceName":"EventBridge rule","sourceBytes":1967,"sourceMember":"Resource-Icons_04302026/Res_Application-Integration/Res_Amazon-EventBridge_Rule_48.svg","sourceSha256":"sha256:86af2bfb6281bd6dc7ffbdb7e5ca7858b6aee1341a72f6b743ddf6d1e6b601ec","state":"approved","transformationSteps":["remove-unused-root-xlink-namespace-v1","validate-svg-v2","normalize-svg-text-v1","verify-selected-source-v1"],"viewBox":"0 0 48 48"}`.

### EventBridge target — `aws.eventbridge.target`

Decision: **Owned target configuration/resource projection**. Target is owned by
a rule, even though Terraform emits a separate resource and CF nests Targets.
Target type/delivery mode, age/retry and optional DLQ are explicit;
at-least-once needs application idempotency. Typed IAM and target roles must
follow supported destination rules.

Workflow: Add beneath rule; show delivery/retry/DLQ and runtime handler
requirements. Cost/operations: Delivery attempts, destination executions and DLQ
storage.

Primary references:
[Amazon EventBridge rules](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rules.html).

Source/test references at exact base:
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/catalog/services/eventbridge-eventing.ts`,
`packages/provider-aws/src/catalog/services/index.ts`,
`packages/provider-aws/src/event-driven-catalog.test.ts`,
`services/iac-compiler/cloudformation_renderer.go`,
`services/iac-compiler/terraform_eventing.go`,
`services/iac-compiler/terraform_eventing_test.go`,
`services/iac-compiler/terraform_renderer.go`. Asset `null`.

### FSx for Lustre — `aws.fsx.lustre-file-system`

Decision: **Separate family resource, grouped product variation in UI**. FSx
product selector may vary family, but native filesystem identity and
family-specific behavior must remain separate definitions. Bounded persistent
Lustre SSD throughput/capacity and subnet/SG, with typed S3 repository
association. Current CF metadata omits that existing association. FileSystemType
import is now explicit and order independent.

Workflow: Keep one FSx product entry and explicit Lustre variant, with
storage/throughput units and S3 dependency. Cost/operations: Provisioned
storage/throughput, backup and S3/transfer activity.

Primary references:
[Amazon FSx file systems](https://docs.aws.amazon.com/fsx/latest/APIReference/API_CreateFileSystem.html),
[FSx storage capacity by deployment type and HA pairs](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-fsx-filesystem.html#cfn-fsx-filesystem-storagecapacity);
[AWS::FSx::FileSystem](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-fsx-filesystem.html)
(current document SHA-256
`17ac7ee42c1180f06892bb8df544ab8f1d71b748364e8ba58fd91a51c05f3ccf`).

Source/test references at exact base:
`apps/web/src/features/editor/model/service-catalog-view-model.test.ts`,
`apps/web/src/features/editor/model/service-variant-command.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/fsx-connections.ts`,
`packages/provider-aws/src/catalog/services/fsx-capacity.ts`,
`packages/provider-aws/src/catalog/services/fsx.ts`,
`packages/provider-aws/src/fsx-capacity-catalog.test.ts`,
`services/iac-compiler/fsx.go`. Asset
`{"automatedSecurityResult":"passed","awsServiceFamily":"Amazon FSx for Lustre","destinationAssetId":"aws.cloudmarkup.provider-icons.asset.fsx-lustre","file":"fsx-lustre.svg","iconId":"aws.cloudmarkup.icons.fsx-lustre-file-system","mappingType":"service-family","mediaType":"image/svg+xml","normalizedBytes":2654,"normalizedSha256":"sha256:eed07dddc84ea6736f79234cbce80605dc809c61006f66f3a3b3cd17c2fc4bf7","serviceName":"FSx for Lustre","sourceBytes":2735,"sourceMember":"Architecture-Service-Icons_04302026/Arch_Storage/48/Arch_Amazon-FSx-for-Lustre_48.svg","sourceSha256":"sha256:2ab0ca3a6833ec65cb4bbbd2ee3210aa9c07e93b734a853502db970f55f1b393","state":"approved","transformationSteps":["remove-unused-root-xlink-namespace-v1","validate-svg-v2","normalize-svg-text-v1","verify-selected-source-v1"],"viewBox":"0 0 64 64"}`.

### FSx for NetApp ONTAP — `aws.fsx.ontap-file-system`

Decision: **Separate family resource, grouped product variation in UI**. ONTAP
has HA/capacity and SVM/volume lifecycle different from Lustre/OpenZFS/Windows.
Bounded storage, throughput per HA pair, topology and backup. Native
CloudFormation FileSystem type alone is ambiguous; fixed importer requires ONTAP
discriminator.

Workflow: FSx family selector can guide setup without erasing independent
filesystem/SVM/volume IDs. Cost/operations: Provisioned SSD, throughput,
HA/storage and backup/transfer.

Primary references:
[Amazon FSx file systems](https://docs.aws.amazon.com/fsx/latest/APIReference/API_CreateFileSystem.html),
[FSx storage capacity by deployment type and HA pairs](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-fsx-filesystem.html#cfn-fsx-filesystem-storagecapacity);
[AWS::FSx::FileSystem](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-fsx-filesystem.html)
(current document SHA-256
`17ac7ee42c1180f06892bb8df544ab8f1d71b748364e8ba58fd91a51c05f3ccf`).

Source/test references at exact base:
`apps/web/src/features/editor/model/service-variant-command.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/fsx-connections.ts`,
`packages/provider-aws/src/catalog/services/fsx-capacity.ts`,
`packages/provider-aws/src/catalog/services/fsx.ts`,
`packages/provider-aws/src/fsx-capacity-catalog.test.ts`,
`services/iac-compiler/fsx.go`. Asset
`{"automatedSecurityResult":"passed","awsServiceFamily":"Amazon FSx for NetApp ONTAP","destinationAssetId":"aws.cloudmarkup.provider-icons.asset.fsx-ontap","file":"fsx-ontap.svg","iconId":"aws.cloudmarkup.icons.fsx-ontap-file-system","mappingType":"service-family","mediaType":"image/svg+xml","normalizedBytes":3552,"normalizedSha256":"sha256:dafbcf238c17dddc8c51ad0b89c4069260b49e512ff38ad84f0ca1272dfe3b7c","serviceName":"FSx for NetApp ONTAP","sourceBytes":3633,"sourceMember":"Architecture-Service-Icons_04302026/Arch_Storage/48/Arch_Amazon-FSx-for-NetApp-ONTAP_48.svg","sourceSha256":"sha256:1884e767357a924fa5fae50c7d2d8ceb78bb2f0cd84afbd4e0c128f85cd3e024","state":"approved","transformationSteps":["remove-unused-root-xlink-namespace-v1","validate-svg-v2","normalize-svg-text-v1","verify-selected-source-v1"],"viewBox":"0 0 64 64"}`.

### FSx ONTAP storage virtual machine — `aws.fsx.ontap-storage-virtual-machine`

Decision: **Separate contained native resource**. SVM has its own native
identity and may own multiple volumes. Exactly one canonical ONTAP filesystem.
It is a configuration entry point for that product but must retain export
identity. Wider directory/auth/protocol features need contracts.

Workflow: Create from ONTAP setup and show explicit filesystem ownership.
Cost/operations: Filesystem/storage use; avoid inventing an extra
full-filesystem charge.

Primary references:
[Amazon FSx file systems](https://docs.aws.amazon.com/fsx/latest/APIReference/API_CreateFileSystem.html);
[AWS::FSx::StorageVirtualMachine](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-fsx-storagevirtualmachine.html)
(current document SHA-256
`9842d09d9a5806e9b6280f0c2ebec33c0853af15024af72279c233c3e3ce1a51`).

Source/test references at exact base:
`apps/web/src/features/editor/model/service-variant-command.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/fsx-connections.ts`,
`packages/provider-aws/src/catalog/services/fsx.ts`,
`services/iac-compiler/fsx.go`. Asset
`{"automatedSecurityResult":"passed","awsServiceFamily":"Amazon FSx for NetApp ONTAP","destinationAssetId":"aws.cloudmarkup.provider-icons.asset.fsx-ontap","file":"fsx-ontap.svg","iconId":"aws.cloudmarkup.icons.fsx-ontap-storage-virtual-machine","mappingType":"service-family","mediaType":"image/svg+xml","normalizedBytes":3552,"normalizedSha256":"sha256:dafbcf238c17dddc8c51ad0b89c4069260b49e512ff38ad84f0ca1272dfe3b7c","serviceName":"FSx ONTAP storage virtual machine","sourceBytes":3633,"sourceMember":"Architecture-Service-Icons_04302026/Arch_Storage/48/Arch_Amazon-FSx-for-NetApp-ONTAP_48.svg","sourceSha256":"sha256:1884e767357a924fa5fae50c7d2d8ceb78bb2f0cd84afbd4e0c128f85cd3e024","state":"approved","transformationSteps":["remove-unused-root-xlink-namespace-v1","validate-svg-v2","normalize-svg-text-v1","verify-selected-source-v1"],"viewBox":"0 0 64 64"}`.

### FSx ONTAP volume — `aws.fsx.ontap-volume`

Decision: **Separate contained native resource**. Volume has native lifecycle,
size and junction path distinct from filesystem/SVM. Exactly one ONTAP SVM owner
and bounded size/path. Residual importer: AWS::FSx::Volume also supports
OpenZFS, so native type alone must not assert ONTAP; propose VolumeType
discrimination.

Workflow: Create beneath SVM and preserve independently addressable volume.
Cost/operations: Provisioned/used filesystem storage and backup behavior.

Primary references:
[Amazon FSx file systems](https://docs.aws.amazon.com/fsx/latest/APIReference/API_CreateFileSystem.html);
[AWS::FSx::Volume](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-fsx-volume.html)
(current document SHA-256
`f1d6d07539bc7d2192f93feb14110b0f6ab2cb28dc07b5ea790cbbf33e71db18`).

Source/test references at exact base:
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/fsx-connections.ts`,
`packages/provider-aws/src/catalog/services/fsx.ts`,
`packages/provider-aws/src/fsx-catalog.test.ts`, `services/iac-compiler/fsx.go`.
Asset
`{"automatedSecurityResult":"passed","awsServiceFamily":"Amazon FSx for NetApp ONTAP","destinationAssetId":"aws.cloudmarkup.provider-icons.asset.fsx-ontap","file":"fsx-ontap.svg","iconId":"aws.cloudmarkup.icons.fsx-ontap-volume","mappingType":"service-family","mediaType":"image/svg+xml","normalizedBytes":3552,"normalizedSha256":"sha256:dafbcf238c17dddc8c51ad0b89c4069260b49e512ff38ad84f0ca1272dfe3b7c","serviceName":"FSx ONTAP volume","sourceBytes":3633,"sourceMember":"Architecture-Service-Icons_04302026/Arch_Storage/48/Arch_Amazon-FSx-for-NetApp-ONTAP_48.svg","sourceSha256":"sha256:1884e767357a924fa5fae50c7d2d8ceb78bb2f0cd84afbd4e0c128f85cd3e024","state":"approved","transformationSteps":["remove-unused-root-xlink-namespace-v1","validate-svg-v2","normalize-svg-text-v1","verify-selected-source-v1"],"viewBox":"0 0 64 64"}`.

### FSx for OpenZFS — `aws.fsx.openzfs-file-system`

Decision: **Separate family resource, grouped product variation in UI**.
Different native Terraform family and filesystem semantics justify separate
definition beneath FSx product. Bounded deployment/storage/throughput, explicit
subnet/SG, backup and optional client CIDR. Additional volume resources/data
export modes need contracts.

Workflow: Use family-specific setup and clarify allowed clients, capacity and
network scope. Cost/operations: Storage, throughput, backup and transfer;
pricing is not interchangeable with ONTAP.

Primary references:
[Amazon FSx file systems](https://docs.aws.amazon.com/fsx/latest/APIReference/API_CreateFileSystem.html);
[AWS::FSx::FileSystem](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-fsx-filesystem.html)
(current document SHA-256
`17ac7ee42c1180f06892bb8df544ab8f1d71b748364e8ba58fd91a51c05f3ccf`).

Source/test references at exact base:
`apps/web/src/features/editor/model/service-variant-command.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/fsx-catalog.test.ts`, `services/iac-compiler/fsx.go`.
Asset
`{"automatedSecurityResult":"passed","awsServiceFamily":"Amazon FSx for OpenZFS","destinationAssetId":"aws.cloudmarkup.provider-icons.asset.fsx-openzfs","file":"fsx-openzfs.svg","iconId":"aws.cloudmarkup.icons.fsx-openzfs-file-system","mappingType":"service-family","mediaType":"image/svg+xml","normalizedBytes":2345,"normalizedSha256":"sha256:7be886c608c5c741091b81476f2097b09dc6cf91a0e71a10879e7942cb268695","serviceName":"FSx for OpenZFS","sourceBytes":2426,"sourceMember":"Architecture-Service-Icons_04302026/Arch_Storage/48/Arch_Amazon-FSx-for-OpenZFS_48.svg","sourceSha256":"sha256:233e0f0928c29f4402d28561cea8bad4d96b15fd20c8830452d52acf6aa3deeb","state":"approved","transformationSteps":["remove-unused-root-xlink-namespace-v1","validate-svg-v2","normalize-svg-text-v1","verify-selected-source-v1"],"viewBox":"0 0 64 64"}`.

### FSx for Windows File Server — `aws.fsx.windows-file-system`

Decision: **Separate family resource, grouped product variation in UI**. Windows
AD and deployment topology differ from other FSx families.
SINGLE_AZ_2/MULTI_AZ_1 is a variation; two-AZ choice needs exact paired
subnets/preferred subnet and directory prerequisite. Product defaults without AD
are not deployment-ready.

Workflow: Keep Windows variant and explicit AD readiness rather than silently
applying defaults. Cost/operations: Storage/throughput, Multi-AZ availability,
backups and directory dependencies.

Primary references:
[Amazon FSx file systems](https://docs.aws.amazon.com/fsx/latest/APIReference/API_CreateFileSystem.html);
[AWS::FSx::FileSystem](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-fsx-filesystem.html)
(current document SHA-256
`17ac7ee42c1180f06892bb8df544ab8f1d71b748364e8ba58fd91a51c05f3ccf`).

Source/test references at exact base:
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/fsx-catalog.test.ts`, `services/iac-compiler/fsx.go`.
Asset
`{"automatedSecurityResult":"passed","awsServiceFamily":"Amazon FSx for Windows File Server","destinationAssetId":"aws.cloudmarkup.provider-icons.asset.fsx-windows","file":"fsx-windows.svg","iconId":"aws.cloudmarkup.icons.fsx-windows-file-system","mappingType":"service-family","mediaType":"image/svg+xml","normalizedBytes":2321,"normalizedSha256":"sha256:0cbe961d60ac47ffac094736303848a2584bfdb27c32027cf1f20cc294c746ef","serviceName":"FSx for Windows File Server","sourceBytes":2402,"sourceMember":"Architecture-Service-Icons_04302026/Arch_Storage/48/Arch_Amazon-FSx-for-WFS_48.svg","sourceSha256":"sha256:8f3f663a9e42f6200cff62058b08bbd06f6a186e716904be55310a586a4a9cf0","state":"approved","transformationSteps":["remove-unused-root-xlink-namespace-v1","validate-svg-v2","normalize-svg-text-v1","verify-selected-source-v1"],"viewBox":"0 0 64 64"}`.

### IAM instance profile — `aws.iam.instance-profile`

Decision: **Separate native resource**. Profile has native identity and account
scope distinct from a role or EC2 instance. One reviewed role, path / and
protected ownership. Regional graph binding does not change account-wide IAM
name uniqueness. No new permissions come from attaching a profile.

Workflow: Offer from EC2 role setup with clear role/profile distinction.
Cost/operations: No direct capacity charge; permissions and trust govern
downstream access.

Primary references:
[AMI identity and compatibility](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/AMIs.html),
[EC2 instance properties and replacement](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-instance.html),
[EC2 instance profile](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-iam-instanceprofile.html);
[AWS::IAM::InstanceProfile](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-iam-instanceprofile.html)
(current document SHA-256
`d760281020935e4c0999f57dbe28f7ec8f247e6d7d39c0614a48a104c43cfbc3`).

Source/test references at exact base:
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/ec2-connections.ts`,
`packages/provider-aws/src/catalog/services/ec2-compute.ts`,
`packages/provider-aws/src/ec2-compute.test.ts`, `services/iac-compiler/ec2.go`.
Asset
`{"file":null,"iconId":"aws.cloudmarkup.icons.iam-instance-profile","placeholderReason":"missing","serviceName":"IAM instance profile","state":"placeholder"}`.

### IAM managed policy attachment — `aws.iam.managed-policy-attachment`

Decision: **Owned policy-reference configuration**. Attachment/boundary is a
role relationship; underlying external policy is referenced, not created.
AttachmentKind is a variation with different permission semantics. Boundaries
limit identity grants rather than granting access. Exact policy
references/adoption and lifecycle matter.

Workflow: Keep beneath IAM role and clearly distinguish grant from permissions
boundary. Cost/operations: No direct capacity rate; can enable downstream
charged use.

Primary references:
[Permissions boundaries for IAM entities](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html).

Source/test references at exact base:
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/owned-configuration-connections.ts`,
`packages/provider-aws/src/catalog/services/iam-managed-policy-attachment.ts`,
`packages/provider-aws/src/catalog/services/index.ts`,
`packages/provider-aws/src/networking-validation.test.ts`,
`packages/provider-aws/src/provider-extension-artifacts.test.ts`,
`packages/provider-aws/src/validation.test.ts`,
`services/iac-compiler/cloudformation_iam.go`,
`services/iac-compiler/cloudformation_renderer.go`,
`services/iac-compiler/ecs_test.go`, `services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_networking.go`,
`services/iac-compiler/terraform_renderer.go`,
`services/iac-compiler/terraform_test.go`, `services/iac-compiler/types.go`.
Asset `null`.

### IAM policy condition — `aws.iam.policy-condition`

Decision: **Owned nested policy configuration**. Condition belongs to a
statement, not a standalone service/resource. Bounded operators, keys and typed
values; do not infer arbitrary IAM evaluation or security from a string.
Ordering/ownership is canonical.

Workflow: Edit under statement in Guided/Professional policy views.
Cost/operations: Security scope, no standalone service capacity.

Primary references:
[IAM JSON policy Condition element](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_condition.html).

Source/test references at exact base:
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/owned-configuration-connections.ts`,
`packages/provider-aws/src/catalog/services/iam-policy-condition.ts`,
`packages/provider-aws/src/catalog/services/index.ts`,
`packages/provider-aws/src/nested-policy-placement.test.ts`,
`packages/provider-aws/src/policy/projection-v1.test.ts`,
`services/iac-compiler/cloudformation_renderer.go`,
`services/iac-compiler/kms_test.go`, `services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_renderer.go`, `services/iac-compiler/types.go`.
Asset `null`.

### IAM policy document — `aws.iam.policy-document`

Decision: **Owned graph configuration with owner-specific projections**. Trust,
inline, resource and generated grant kinds share graph structure, while
owner/target dictates native projection and lifecycle. Keep policyKind
variation, explicit parent/edge and generated adoption rules. Do not mix
generated grants with custom policy ownership or silently delete a shared grant.

Workflow: Show beneath owner with purpose, provenance and effective source
edges. Cost/operations: Permissions scope; some owned projections have native
identities but no capacity unit.

Primary references:
[IAM JSON policy elements reference](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements.html),
[Endpoint policies for gateway endpoints](https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-access.html).

Source/test references at exact base:
`apps/web/src/features/editor/model/connection-workflow.test.ts`,
`apps/web/src/features/editor/model/provider-catalog-adapter.test.ts`,
`apps/web/src/features/editor/model/secret-policy-scope.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/catalog/connections/kms-connections.ts`,
`packages/provider-aws/src/catalog/connections/networking-connections.ts`,
`packages/provider-aws/src/catalog/connections/notes-api-connections.ts`,
`packages/provider-aws/src/catalog/connections/owned-configuration-connections.ts`,
`packages/provider-aws/src/catalog/services/iam-policy-document.ts`,
`packages/provider-aws/src/catalog/services/iam-policy-statement.ts`,
`packages/provider-aws/src/catalog/services/index.ts`,
`packages/provider-aws/src/catalog/services/kms-key.ts`,
`packages/provider-aws/src/cloudfront.test.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`packages/provider-aws/src/ec2-compute.test.ts`,
`packages/provider-aws/src/event-driven-catalog.test.ts`,
`packages/provider-aws/src/kms-key.test.ts`,
`packages/provider-aws/src/nested-policy-placement.test.ts`,
`packages/provider-aws/src/networking-catalog.test.ts`,
`packages/provider-aws/src/networking-policy.test.ts`,
`packages/provider-aws/src/networking-validation.test.ts`,
`packages/provider-aws/src/policy/projection-v1.test.ts`,
`packages/provider-aws/src/provider-extension-artifacts.test.ts`,
`packages/provider-aws/src/secrets-manager.test.ts`,
`packages/provider-aws/src/validation.test.ts`,
`services/iac-compiler/cloudformation_renderer.go`,
`services/iac-compiler/compiler_test.go`, `services/iac-compiler/ec2.go`,
`services/iac-compiler/ecs.go`, `services/iac-compiler/ecs_test.go`,
`services/iac-compiler/kms.go`, `services/iac-compiler/kms_test.go`,
`services/iac-compiler/terraform_eventing.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_networking.go`,
`services/iac-compiler/terraform_networking_test.go`,
`services/iac-compiler/terraform_renderer.go`,
`services/iac-compiler/terraform_test.go`, `services/iac-compiler/types.go`.
Asset `null`.

### IAM policy statement — `aws.iam.policy-statement`

Decision: **Owned nested policy configuration**. Statement identity and typed
scope belong inside a policy document. Actions/effect/principal and resource
references are constrained; resourceNode uses reviewed service attributes, never
arbitrary model ARN synthesis. Wildcards and custom grants need explicit review.

Workflow: Edit canonical statement/conditions and show generated versus user
ownership. Cost/operations: Security authority; no direct capacity unit.

Primary references:
[IAM JSON policy elements](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements.html).

Source/test references at exact base:
`apps/web/src/features/editor/model/add-service-command.test.ts`,
`apps/web/src/features/editor/model/connection-workflow.test.ts`,
`apps/web/src/features/editor/model/provider-catalog-adapter.test.ts`,
`apps/web/src/features/editor/model/secret-policy-scope.test.ts`,
`apps/web/src/features/editor/model/service-catalog-view-model.test.ts`,
`apps/web/src/features/editor/model/service-setup.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/catalog/connections/kms-connections.ts`,
`packages/provider-aws/src/catalog/connections/notes-api-connections.ts`,
`packages/provider-aws/src/catalog/connections/owned-configuration-connections.ts`,
`packages/provider-aws/src/catalog/connections/secrets-connections.ts`,
`packages/provider-aws/src/catalog/services/iam-policy-condition.ts`,
`packages/provider-aws/src/catalog/services/iam-policy-statement.ts`,
`packages/provider-aws/src/catalog/services/index.ts`,
`packages/provider-aws/src/catalog/services/kms-key.ts`,
`packages/provider-aws/src/catalog/services/secretsmanager-secret.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`packages/provider-aws/src/ec2-compute.test.ts`,
`packages/provider-aws/src/event-driven-catalog.test.ts`,
`packages/provider-aws/src/kms-key.test.ts`,
`packages/provider-aws/src/nested-policy-placement.test.ts`,
`packages/provider-aws/src/networking-policy.test.ts`,
`packages/provider-aws/src/policy/projection-v1.test.ts`,
`packages/provider-aws/src/secrets-manager.test.ts`,
`packages/provider-aws/src/validation.test.ts`,
`services/iac-compiler/cloudformation_curated_test.go`,
`services/iac-compiler/cloudformation_renderer.go`,
`services/iac-compiler/cloudformation_test.go`,
`services/iac-compiler/cmd/cloudmarkup-iac/cli_test.go`,
`services/iac-compiler/compiler_test.go`, `services/iac-compiler/ec2.go`,
`services/iac-compiler/ecs.go`, `services/iac-compiler/ecs_test.go`,
`services/iac-compiler/kms.go`, `services/iac-compiler/kms_test.go`,
`services/iac-compiler/secrets.go`, `services/iac-compiler/secrets_test.go`,
`services/iac-compiler/terraform_eventing_test.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_networking_test.go`,
`services/iac-compiler/terraform_renderer.go`,
`services/iac-compiler/terraform_test.go`, `services/iac-compiler/types.go`.
Asset
`{"automatedSecurityResult":"passed","awsServiceFamily":"AWS Identity and Access Management","destinationAssetId":"aws.cloudmarkup.provider-icons.asset.iam","file":"iam.svg","iconId":"aws.cloudmarkup.icons.iam-policy","mappingType":"service-family","mediaType":"image/svg+xml","normalizedBytes":2067,"normalizedSha256":"sha256:51290231062315c93a9125030858a3a1f06037f1c0ccc8beb02dc5b57fe09443","serviceName":"IAM policy statement","sourceBytes":2148,"sourceMember":"Architecture-Service-Icons_04302026/Arch_Security-Identity/48/Arch_AWS-Identity-and-Access-Management_48.svg","sourceSha256":"sha256:81954dcfb86d5f410f7084345e459cd5c7ca1d76032d34f771ad379c94e062b6","state":"approved","transformationSteps":["remove-unused-root-xlink-namespace-v1","validate-svg-v2","normalize-svg-text-v1","verify-selected-source-v1"],"viewBox":"0 0 64 64"}`.

### IAM role — `aws.iam.role`

Decision: **Separate native resource**. Role has account-scoped identity, trust
and session lifecycle independent of workloads. Execution/task/application roles
can share a definition while their relationship/trust semantics stay explicit.
One-hour session scope is bounded; raw/custom permissions are not inferred from
source.

Workflow: Offer role helpers per workload purpose, preserve trust and policies
underneath. Cost/operations: No direct capacity charge; downstream use and
permission scope matter.

Primary references:
[IAM roles](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html);
[AWS::IAM::Role](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-iam-role.html)
(current document SHA-256
`0a93415aed52fdc56ae2deff49b3045a9fbaf878509e94798ed651499d1fb155`).

Source/test references at exact base:
`apps/web/src/features/editor/model/connection-workflow.test.ts`,
`apps/web/src/features/editor/model/provider-catalog-adapter.test.ts`,
`apps/web/src/features/editor/model/secret-policy-scope.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/ec2-connections.ts`,
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/catalog/connections/notes-api-connections.ts`,
`packages/provider-aws/src/catalog/connections/owned-configuration-connections.ts`,
`packages/provider-aws/src/catalog/services/ec2-compute.ts`,
`packages/provider-aws/src/catalog/services/ecs-fargate.ts`,
`packages/provider-aws/src/catalog/services/iam-managed-policy-attachment.ts`,
`packages/provider-aws/src/catalog/services/iam-policy-document.ts`,
`packages/provider-aws/src/catalog/services/iam-role.ts`,
`packages/provider-aws/src/catalog/services/index.ts`,
`packages/provider-aws/src/connection-presentation.test.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`packages/provider-aws/src/ec2-compute.test.ts`,
`packages/provider-aws/src/event-driven-catalog.test.ts`,
`packages/provider-aws/src/networking-validation.test.ts`,
`packages/provider-aws/src/policy/projection-v1.test.ts`,
`packages/provider-aws/src/provider-extension-artifacts.test.ts`,
`packages/provider-aws/src/secrets-manager.test.ts`,
`packages/provider-aws/src/validation.test.ts`,
`services/iac-compiler/cloudformation_iam.go`,
`services/iac-compiler/cloudformation_renderer.go`,
`services/iac-compiler/cloudformation_resources.go`,
`services/iac-compiler/ec2.go`, `services/iac-compiler/ec2_test.go`,
`services/iac-compiler/ecs.go`, `services/iac-compiler/ecs_test.go`,
`services/iac-compiler/nested_policy_catalog_test.go`,
`services/iac-compiler/secrets.go`, `services/iac-compiler/secrets_test.go`,
`services/iac-compiler/terraform_artifacts.go`,
`services/iac-compiler/terraform_attribute_test.go`,
`services/iac-compiler/terraform_eventing_test.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_renderer.go`,
`services/iac-compiler/terraform_resources.go`,
`services/iac-compiler/terraform_test.go`. Asset
`{"automatedSecurityResult":"passed","awsServiceFamily":"AWS Identity and Access Management","destinationAssetId":"aws.cloudmarkup.provider-icons.asset.iam-role","file":"iam-role.svg","iconId":"aws.cloudmarkup.icons.iam-role","mappingType":"exact-resource","mediaType":"image/svg+xml","normalizedBytes":3196,"normalizedSha256":"sha256:25faf332dcf14a16d5f8a0dfc80799f92d53f8d614d0d7f64dd01e3700c1c5a8","serviceName":"IAM role","sourceBytes":3277,"sourceMember":"Resource-Icons_04302026/Res_Security-Identity/Res_AWS-Identity-Access-Management_Role_48.svg","sourceSha256":"sha256:e47256f0e788e6bda40d17b0da4cf9abab170a29dfc7a22f579e13f4891407da","state":"approved","transformationSteps":["remove-unused-root-xlink-namespace-v1","validate-svg-v2","normalize-svg-text-v1","verify-selected-source-v1"],"viewBox":"0 0 48 48"}`.

### KMS symmetric encryption key — `aws.kms.key`

Decision: **Separate native resource**. Key has retention/rotation/deletion
identity independent of encrypted resources. Single-Region symmetric AWS_KMS
encrypt/decrypt key with exact owned key policy and reviewed admin principal. No
automatic broad decrypt grants or live key usability assertion.

Workflow: Require explicit policy/admin and compatible consumer binding; show
delayed deletion/retention. Cost/operations: Key storage and cryptographic
requests; retention continues key existence.

Primary references:
[AWS KMS key resource and policy requirements](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-kms-key.html);
[AWS::KMS::Key](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-kms-key.html)
(current document SHA-256
`970f5cc65afc86935fc3ef52537ca000bacbe07ab8f569d5908daa963c0eb269`).

Source/test references at exact base:
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/ec2-connections.ts`,
`packages/provider-aws/src/catalog/connections/kms-connections.ts`,
`packages/provider-aws/src/catalog/connections/secrets-connections.ts`,
`packages/provider-aws/src/catalog/services/ebs.ts`,
`packages/provider-aws/src/catalog/services/ec2-compute.ts`,
`packages/provider-aws/src/catalog/services/kms-key.ts`,
`packages/provider-aws/src/catalog/services/secretsmanager-secret.ts`,
`packages/provider-aws/src/ec2-compute.test.ts`,
`packages/provider-aws/src/kms-key.test.ts`,
`packages/provider-aws/src/provider-extension-artifacts.test.ts`,
`packages/provider-aws/src/secrets-manager.test.ts`,
`services/iac-compiler/kms.go`. Asset
`{"file":null,"iconId":"aws.cloudmarkup.icons.kms-key","placeholderReason":"missing","serviceName":"KMS symmetric encryption key","state":"placeholder"}`.

### Lambda function — `aws.lambda.function`

Decision: **Separate native resource; architecture/memory are variations**.
Function runtime identity and execution lifecycle differ from role, VPC settings
and artifacts. Bounded Node24 runtime, arm64/x86_64, memory/time/concurrency and
tracing. Infrastructure-only creation is not business code generation. Explicit
trigger/downstream/runtime contracts remain necessary.

Workflow: Lead with artifact/behavior readiness and execution role, then owned
VPC/permission settings. Cost/operations: Invocations, duration/memory,
concurrency, telemetry and network dependencies.

Primary references:
[Configuring Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/configuration-function-common.html),
[Connecting Lambda functions to a VPC](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html);
[AWS::Lambda::Function](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-lambda-function.html)
(current document SHA-256
`22071528d80f09221d1e13a87f9c239b10f1d49fe9c84211adabdcec33691b02`).

Source/test references at exact base:
`apps/web/src/features/editor/model/add-service-command.test.ts`,
`apps/web/src/features/editor/model/catalog-drag-payload.test.ts`,
`apps/web/src/features/editor/model/configuration-command.test.ts`,
`apps/web/src/features/editor/model/connection-docks.test.ts`,
`apps/web/src/features/editor/model/connection-workflow.test.ts`,
`apps/web/src/features/editor/model/parent-connection-command.test.ts`,
`apps/web/src/features/editor/model/provider-catalog-adapter.test.ts`,
`apps/web/src/features/editor/model/service-catalog-view-model.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/catalog/connections/lambda-s3-connections.ts`,
`packages/provider-aws/src/catalog/connections/networking-connections.ts`,
`packages/provider-aws/src/catalog/connections/notes-api-connections.ts`,
`packages/provider-aws/src/catalog/connections/owned-configuration-connections.ts`,
`packages/provider-aws/src/catalog/services/iam-policy-document.ts`,
`packages/provider-aws/src/catalog/services/index.ts`,
`packages/provider-aws/src/catalog/services/lambda-function.ts`,
`packages/provider-aws/src/catalog/services/lambda-vpc-access-configuration.ts`,
`packages/provider-aws/src/connection-presentation.test.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`packages/provider-aws/src/event-driven-catalog.test.ts`,
`packages/provider-aws/src/networking-catalog.test.ts`,
`packages/provider-aws/src/networking-policy.test.ts`,
`packages/provider-aws/src/networking-validation.test.ts`,
`packages/provider-aws/src/policy/projection-v1.test.ts`,
`packages/provider-aws/src/provider-extension-artifacts.test.ts`,
`packages/provider-aws/src/validation.test.ts`,
`services/iac-compiler/cloudformation_iam.go`,
`services/iac-compiler/cloudformation_renderer.go`,
`services/iac-compiler/cloudformation_resources.go`,
`services/iac-compiler/compatibility.go`, `services/iac-compiler/fsx.go`,
`services/iac-compiler/generator_compatibility_test.go`,
`services/iac-compiler/terraform_artifacts.go`,
`services/iac-compiler/terraform_attribute_test.go`,
`services/iac-compiler/terraform_eventing.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_networking.go`,
`services/iac-compiler/terraform_renderer.go`,
`services/iac-compiler/terraform_resources.go`,
`services/iac-compiler/terraform_test.go`. Asset
`{"automatedSecurityResult":"passed","awsServiceFamily":"AWS Lambda","destinationAssetId":"aws.cloudmarkup.provider-icons.asset.lambda-function","file":"lambda-function.svg","iconId":"aws.cloudmarkup.icons.lambda","mappingType":"exact-resource","mediaType":"image/svg+xml","normalizedBytes":1715,"normalizedSha256":"sha256:bc7dc73f47c189a15d4c04f5b38968bbb30448ec1091d2c4785004dfc278fd20","serviceName":"Lambda function","sourceBytes":1796,"sourceMember":"Resource-Icons_04302026/Res_Compute/Res_AWS-Lambda_Lambda-Function_48.svg","sourceSha256":"sha256:fedc74964e42037598104090d2c9641c702c5d862461010e54d173c555f6a274","state":"approved","transformationSteps":["remove-unused-root-xlink-namespace-v1","validate-svg-v2","normalize-svg-text-v1","verify-selected-source-v1"],"viewBox":"0 0 48 48"}`.

### Lambda VPC access configuration — `aws.lambda.vpc-access-configuration`

Decision: **Owned function configuration**. VPC access is a nested function
setting with subnet/SG relationships, not another Lambda service. Explicit
egressRequirement does not create routes/NAT/endpoint permissions automatically.
Exact VPC/Region topology and role ENI permission prerequisites remain separate.

Workflow: Edit under function with complete egress path and constrained
subnet/SG choices. Cost/operations: Related NAT/transfer and operational
connectivity; no separate function capacity unit.

Primary references:
[Connecting outbound traffic to resources in a VPC](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html).

Source/test references at exact base:
`apps/web/src/features/editor/model/provider-catalog-adapter.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/networking-connections.ts`,
`packages/provider-aws/src/catalog/services/lambda-vpc-access-configuration.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`packages/provider-aws/src/networking-catalog.test.ts`,
`packages/provider-aws/src/networking-policy.test.ts`,
`packages/provider-aws/src/networking-validation.test.ts`,
`packages/provider-aws/src/provider-extension-artifacts.test.ts`,
`services/iac-compiler/cloudformation_renderer.go`,
`services/iac-compiler/terraform_networking.go`,
`services/iac-compiler/terraform_renderer.go`. Asset `null`.

### RDS PostgreSQL instance — `aws.rds.db-instance`

Decision: **Separate native resource; multiAz is variation**. Standalone DB owns
data/storage/credentials/backup. Aurora cluster/members must not be collapsed
into this identity. Bounded private PostgreSQL16, gp3, managed credentials, TLS
parameter group and two-AZ subnet group. Multi-AZ is a configuration choice
within supported standalone mode. Engine availability remains external. Import
now discriminates literal postgres and absent cluster membership.

Workflow: Database product grouping with explicit standalone/Aurora workflow;
retain every native identity. Cost/operations: Instance/storage/backup, Multi-AZ
capacity and managed credentials; retain/protection imply deliberate cleanup.

Primary references:
[RDS-managed master credentials](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-secrets-manager.html),
[RDS PostgreSQL DB instance](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-rds-dbinstance.html);
[AWS::RDS::DBInstance](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-rds-dbinstance.html)
(current document SHA-256
`ae0dbd7e1269fcd9d7199360c329de8d07f94ced43d7b1d9696d6f2ab3ccbad6`).

Source/test references at exact base:
`apps/web/src/features/editor/model/rds-service-setup.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/services/rds-postgres.ts`,
`services/iac-compiler/rds.go`. Asset
`{"file":null,"iconId":"aws.cloudmarkup.icons.rds-db-instance","placeholderReason":"missing","serviceName":"RDS PostgreSQL instance","state":"placeholder"}`.

### RDS PostgreSQL TLS parameters — `aws.rds.db-parameter-group`

Decision: **Separate reusable native resource**. Named standalone parameter
group can be reused and differs from Aurora cluster parameters. postgres16 and
forced TLS only, protected user ownership; arbitrary parameter bags/families
require typed admission.

Workflow: Helper from DB setup with explicit reusable identity. Cost/operations:
Indirect operational/reboot consequences; no standalone capacity charge.

Primary references:
[RDS-managed master credentials](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-secrets-manager.html),
[RDS PostgreSQL DB instance](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-rds-dbinstance.html);
[AWS::RDS::DBParameterGroup](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-rds-dbparametergroup.html)
(current document SHA-256
`d34ba3594ec12a31d4d8f37569b6937b405f5b9404944d0efb59301d2c5122d8`).

Source/test references at exact base:
`apps/web/src/features/editor/model/rds-service-setup.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/services/rds-postgres.ts`,
`services/iac-compiler/rds.go`. Asset
`{"file":null,"iconId":"aws.cloudmarkup.icons.rds-db-parameter-group","placeholderReason":"missing","serviceName":"RDS PostgreSQL TLS parameters","state":"placeholder"}`.

### RDS DB subnet group — `aws.rds.db-subnet-group`

Decision: **Separate reusable native resource**. One named native group can
serve standalone RDS and Aurora, with its own lifecycle. 2-16 canonical subnets,
distinct physical AZs and one VPC/Region. It describes placement and is not a
VPC/subnet container. Shared old/new positive export now tested.

Workflow: Helper selects explicit subnets and shows coverage; preserve sharing
and references. Cost/operations: No direct storage capacity; determines
deployment topology and resilience.

Primary references:
[RDS-managed master credentials](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-secrets-manager.html),
[RDS PostgreSQL DB instance](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-rds-dbinstance.html);
[AWS::RDS::DBSubnetGroup](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-rds-dbsubnetgroup.html)
(current document SHA-256
`ef7ed8e4a927afd2d62467507f4991f5687cca127b384c139ec42dd20c2f921d`).

Source/test references at exact base:
`apps/web/src/features/editor/model/rds-service-setup.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/services/aurora-postgres.ts`,
`packages/provider-aws/src/catalog/services/rds-postgres.ts`,
`services/iac-compiler/rds.go`. Asset
`{"file":null,"iconId":"aws.cloudmarkup.icons.rds-db-subnet-group","placeholderReason":"missing","serviceName":"RDS DB subnet group","state":"placeholder"}`.

### AWS Region — `aws.region.boundary`

Decision: **Visual boundary; no deployable native resource**. Region is a
document context/placement boundary, not an AWS resource created by export.
Actual UI binds regionName to document Region. Multi-Region application/provider
orchestration remains unsupported. All installed regional availability
descriptors stay unknown.

Workflow: Keep single Region and state availability as externally verified
readiness. Cost/operations: Boundary itself has no capacity charge; prices/use
vary with deployed Region.

Primary references:
[AWS Regions and Availability Zones](https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions-availability-zones.html).

Source/test references at exact base:
`apps/web/src/features/editor/model/parent-connection-command.test.ts`,
`apps/web/src/features/editor/model/service-setup.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/networking-connections.ts`,
`packages/provider-aws/src/catalog/services/region-boundary.ts`,
`packages/provider-aws/src/catalog/services/vpc.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`packages/provider-aws/src/ec2-compute.test.ts`,
`packages/provider-aws/src/networking-catalog.test.ts`,
`packages/provider-aws/src/networking-validation.test.ts`,
`packages/provider-aws/src/provider-extension-artifacts.test.ts`,
`services/iac-compiler/cloudformation_renderer.go`,
`services/iac-compiler/terraform_networking.go`,
`services/iac-compiler/terraform_renderer.go`. Asset
`{"automatedSecurityResult":"passed","awsServiceFamily":"AWS Global Infrastructure","destinationAssetId":"aws.cloudmarkup.provider-icons.asset.region-boundary","file":"region-boundary.svg","iconId":"aws.cloudmarkup.icons.region","mappingType":"service-family","mediaType":"image/svg+xml","normalizedBytes":1015,"normalizedSha256":"sha256:93b8ad471815805be0622b0ea3f94c7bc53697f818776c4180ab243e90018754","serviceName":"AWS Region","sourceBytes":1096,"sourceMember":"Architecture-Group-Icons_04302026/Region_32.svg","sourceSha256":"sha256:848203d40c55e213c84c1b8a3e14c2fa92aaa793b31a5c17a5fd1737ef58b8ca","state":"approved","transformationSteps":["remove-unused-root-xlink-namespace-v1","validate-svg-v2","normalize-svg-text-v1","verify-selected-source-v1"],"viewBox":"0 0 40 40"}`.

### Route53 public hosted zone — `aws.route53.public-hosted-zone`

Decision: **Separate native resource**. Zone has distinct authority, delegation,
lifecycle and DNS identity. New public zone, one canonical domain, external
delegation, no force destroy and explicit domain-control attestation. No
private/existing/cross-account zone or arbitrary record API is inferred. Import
HostedZone type alone cannot prove public semantics if VPCs are present.

Workflow: Show authority/delegation prerequisite and certificate/alias
relationships; attestation needs separate UI fix. Cost/operations: Hosted zone
and DNS queries; retained zones/records can continue charges.

Primary references:
[Public DNS certificate](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-certificatemanager-certificate.html),
[CloudFront viewer certificate Region](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html),
[Public hosted zone](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-route53-hostedzone.html);
[AWS::Route53::HostedZone](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-route53-hostedzone.html)
(current document SHA-256
`5777e00a082747fead3016b1c07b43fd7a62a5743f6ea8ab1fb0d8968e8b140b`).

Source/test references at exact base:
`apps/web/src/features/editor/model/dns-acm-service-setup.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/services/dns-acm.ts`,
`packages/provider-aws/src/dns-acm.test.ts`, `services/iac-compiler/dns_acm.go`.
Asset
`{"file":null,"iconId":"aws.cloudmarkup.icons.route53-public-hosted-zone","placeholderReason":"missing","serviceName":"Route53 public hosted zone","state":"placeholder"}`.

### S3 bucket — `aws.s3.bucket`

Decision: **Separate native resource; policy/ownership variants remain
configuration**. Bucket has durable named storage identity;
CORS/lifecycle/notification are owned settings with target-specific projections.
Private block-public, enforced owner, versioning, protection and SSE-S3 only.
Shared naming rules are bounded; globally available names and live account state
are not checked. CloudFront signed read and events are distinct paths.

Workflow: Show storage and owned controls, avoid duplicate Terraform control
cards. Cost/operations: Stored objects/versions, requests, transfer and
lifecycle transitions; retention can preserve charges/data.

Primary references:
[General purpose bucket naming rules](https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html),
[Amazon S3 event notifications](https://docs.aws.amazon.com/AmazonS3/latest/userguide/EventNotifications.html),
[S3 notification object-key filtering](https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-how-to-filtering.html);
[AWS::S3::Bucket](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-s3-bucket.html)
(current document SHA-256
`ca73ad76ac94f772cbced1cb79c3589d67a1da4c7ee9b23bf78cb024250bb3d1`).

Source/test references at exact base:
`apps/web/src/features/editor/model/service-catalog-view-model.test.ts`,
`apps/web/src/features/editor/model/service-variant-command.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/catalog/connections/fsx-connections.ts`,
`packages/provider-aws/src/catalog/connections/lambda-s3-connections.ts`,
`packages/provider-aws/src/catalog/services/cloudfront.ts`,
`packages/provider-aws/src/catalog/services/fsx.ts`,
`packages/provider-aws/src/catalog/services/iam-policy-document.ts`,
`packages/provider-aws/src/catalog/services/index.ts`,
`packages/provider-aws/src/catalog/services/s3-accuracy.ts`,
`packages/provider-aws/src/catalog/services/s3-eventing.ts`,
`packages/provider-aws/src/event-driven-catalog.test.ts`,
`packages/provider-aws/src/policy/projection-v1.test.ts`,
`packages/provider-aws/src/provider-extension-artifacts.test.ts`,
`packages/provider-aws/src/s3-accuracy-catalog.test.ts`,
`packages/provider-aws/src/validation.test.ts`,
`services/iac-compiler/cloudformation_eventing.go`,
`services/iac-compiler/cloudformation_iam.go`,
`services/iac-compiler/cloudformation_renderer.go`,
`services/iac-compiler/cloudformation_resources.go`,
`services/iac-compiler/cloudfront.go`,
`services/iac-compiler/cloudfront_test.go`, `services/iac-compiler/fsx.go`,
`services/iac-compiler/fsx_test.go`, `services/iac-compiler/s3_accuracy.go`,
`services/iac-compiler/terraform_artifacts.go`,
`services/iac-compiler/terraform_eventing.go`,
`services/iac-compiler/terraform_eventing_test.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_renderer.go`,
`services/iac-compiler/terraform_test.go`. Asset
`{"automatedSecurityResult":"passed","awsServiceFamily":"Amazon Simple Storage Service","destinationAssetId":"aws.cloudmarkup.provider-icons.asset.s3-bucket","file":"s3-bucket.svg","iconId":"aws.cloudmarkup.icons.s3","mappingType":"exact-resource","mediaType":"image/svg+xml","normalizedBytes":7535,"normalizedSha256":"sha256:5e032f4c9a8d8dd725c8c4bd5d6664bb581ba64cbdf13c869fea510a8b478aa7","serviceName":"S3 bucket","sourceBytes":7616,"sourceMember":"Resource-Icons_04302026/Res_Storage/Res_Amazon-Simple-Storage-Service_Bucket_48.svg","sourceSha256":"sha256:ac5ba6de5ce1e914c9b9606cad1800692fe52ca308ef5bf3556bbebe062f7d9e","state":"approved","transformationSteps":["remove-unused-root-xlink-namespace-v1","validate-svg-v2","normalize-svg-text-v1","verify-selected-source-v1"],"viewBox":"0 0 48 48"}`.

### S3 CORS configuration — `aws.s3.bucket-cors-configuration`

Decision: **Owned bucket configuration**. CORS belongs to bucket; Terraform
resource projection does not make it a standalone AWS service. Bounded
origins/methods/headers/cache max-age are separate from object authorization. No
public-read permission follows from CORS.

Workflow: Edit beneath bucket and distinguish browser permission from IAM/public
access. Cost/operations: Requests/cache behavior; no separate full-bucket
capacity estimate.

Primary references:
[Using cross-origin resource sharing with Amazon S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/cors.html).

Source/test references at exact base:
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/catalog/services/index.ts`,
`packages/provider-aws/src/catalog/services/s3-eventing.ts`,
`services/iac-compiler/cloudformation_renderer.go`,
`services/iac-compiler/terraform_eventing.go`,
`services/iac-compiler/terraform_renderer.go`. Asset `null`.

### S3 lifecycle configuration — `aws.s3.bucket-lifecycle-configuration`

Decision: **Owned bucket configuration**. Object retention/transition policy
belongs to bucket and has stable owned projection. Explicit expiry/noncurrent
versions and bounded transition intent can delete data. Bucket retain/protection
does not stop object lifecycle expiration.

Workflow: Explain data expiration separately from resource deletion protection.
Cost/operations: Stored versions, transitions, retrieval/minimum-duration
implications require separate pricing context.

Primary references:
[Managing the lifecycle of objects](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html).

Source/test references at exact base:
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/catalog/services/index.ts`,
`packages/provider-aws/src/catalog/services/s3-eventing.ts`,
`services/iac-compiler/cloudformation_renderer.go`,
`services/iac-compiler/terraform_eventing.go`,
`services/iac-compiler/terraform_renderer.go`. Asset `null`.

### S3 notification configuration — `aws.s3.bucket-notification-configuration`

Decision: **Owned bucket configuration**. Notification is one canonical
bucket-owned setting; target choice is variation. At-least-once unordered
events, bounded event/filter and Lambda/EventBridge destinations. Overlapping
filters/permissions are checked; consumer idempotency is application behavior.

Workflow: Configure from bucket and show handler/permission/event-contract
readiness. Cost/operations: Event deliveries, target execution and request
volume.

Primary references:
[Amazon S3 event notifications](https://docs.aws.amazon.com/AmazonS3/latest/userguide/EventNotifications.html).

Source/test references at exact base:
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/catalog/services/index.ts`,
`packages/provider-aws/src/catalog/services/s3-eventing.ts`,
`services/iac-compiler/cloudformation_renderer.go`,
`services/iac-compiler/terraform_eventing.go`,
`services/iac-compiler/terraform_renderer.go`. Asset `null`.

### Secrets Manager secret — `aws.secretsmanager.secret`

Decision: **Separate native resource**. Secret metadata, encryption and recovery
have independent identity; value population is external. No plaintext/generation
is compiled. AWS-managed/customer-key choice stays variation with explicit
KMS/role edges. Recovery/retention and population readiness are distinct.

Workflow: Show external population requirement without prompting for secret
values in diagram fields. Cost/operations: Secret storage/API/rotation-related
use and KMS requests.

Primary references:
[Secrets Manager encryption permissions](https://docs.aws.amazon.com/secretsmanager/latest/userguide/security-encryption.html),
[Secrets Manager metadata, encryption and lifecycle](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-secretsmanager-secret.html);
[AWS::SecretsManager::Secret](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-secretsmanager-secret.html)
(current document SHA-256
`ad2f2398d82fcb019ae374fcc7e75d387e4b1c6e2cc5a88a96b77ac7cc154172`).

Source/test references at exact base:
`apps/web/src/features/editor/model/secret-policy-scope.test.ts`,
`apps/web/src/features/editor/model/service-setup.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/secrets-connections.ts`,
`packages/provider-aws/src/catalog/services/ecs-fargate.ts`,
`packages/provider-aws/src/catalog/services/secretsmanager-secret.ts`,
`packages/provider-aws/src/secrets-manager.test.ts`,
`services/iac-compiler/secrets.go`. Asset
`{"file":null,"iconId":"aws.cloudmarkup.icons.secretsmanager-secret","placeholderReason":"missing","serviceName":"Secrets Manager secret","state":"placeholder"}`.

### SNS subscription — `aws.sns.subscription`

Decision: **Owned native subscription resource**. Subscription belongs to topic
but retains native lifecycle/address; protocol is configuration variation. Only
Lambda/SQS destinations and bounded filter/raw delivery are compiled. Human
subscriptionName is semantic metadata; current StableIdentity/stable_identity
target bindings are fictitious and separately proposed for correction.

Workflow: Edit under topic and distinguish destination permission from
retry/idempotency behavior. Cost/operations: Delivery attempts and destination
use; no extra topic capacity charge.

Primary references:
[Amazon SNS topics and subscriptions](https://docs.aws.amazon.com/sns/latest/dg/sns-create-subscribe-endpoint-to-topic.html);
[AWS::SNS::Subscription](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-sns-subscription.html)
(current document SHA-256
`013babb863831ac1f4dc2870cfcf0c7e6e8a74bfe103d060b81e3433ab70962d`).

Source/test references at exact base:
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/catalog/services/index.ts`,
`packages/provider-aws/src/catalog/services/sns-eventing.ts`,
`packages/provider-aws/src/event-driven-catalog.test.ts`,
`services/iac-compiler/cloudformation_eventing.go`,
`services/iac-compiler/cloudformation_renderer.go`,
`services/iac-compiler/generator_compatibility_test.go`,
`services/iac-compiler/terraform_eventing.go`,
`services/iac-compiler/terraform_eventing_test.go`,
`services/iac-compiler/terraform_renderer.go`. Asset `null`.

### SNS topic — `aws.sns.topic`

Decision: **Separate native resource; Standard/FIFO is variation**. Topic has
native identity and owns subscriptions/policy; queue type does not justify
duplicate service cards. Bounded KMS encryption/dedup/retention with typed
publishers/subscribers. FIFO compatibility and raw/filter semantics need exact
destination rules.

Workflow: Keep type choice within topic and show subscriptions/delivery
contracts. Cost/operations: Publishing/delivery, transfer and encryption-related
requests.

Primary references:
[Amazon SNS topics and subscriptions](https://docs.aws.amazon.com/sns/latest/dg/sns-create-subscribe-endpoint-to-topic.html);
[AWS::SNS::Topic](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-sns-topic.html)
(current document SHA-256
`58b9d524de945edbeadfef8fd83cba427afd008b7ffcd8ff22f389d4e504d1e4`).

Source/test references at exact base:
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/catalog/services/iam-policy-document.ts`,
`packages/provider-aws/src/catalog/services/index.ts`,
`packages/provider-aws/src/catalog/services/sns-eventing.ts`,
`packages/provider-aws/src/event-driven-catalog.test.ts`,
`packages/provider-aws/src/provider-extension-artifacts.test.ts`,
`packages/provider-aws/src/validation.test.ts`,
`services/iac-compiler/cloudformation_eventing.go`,
`services/iac-compiler/cloudformation_renderer.go`,
`services/iac-compiler/cloudformation_resources.go`,
`services/iac-compiler/terraform_artifacts.go`,
`services/iac-compiler/terraform_eventing.go`,
`services/iac-compiler/terraform_eventing_test.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_renderer.go`,
`services/iac-compiler/terraform_test.go`. Asset
`{"automatedSecurityResult":"passed","awsServiceFamily":"Amazon Simple Notification Service","destinationAssetId":"aws.cloudmarkup.provider-icons.asset.sns-topic","file":"sns-topic.svg","iconId":"aws.cloudmarkup.icons.sns","mappingType":"exact-resource","mediaType":"image/svg+xml","normalizedBytes":2633,"normalizedSha256":"sha256:893eea1b6ccfa9e2d5b9ce707e7984370530543d5f71bebd140c3efb8a3dfb1c","serviceName":"SNS topic","sourceBytes":2714,"sourceMember":"Resource-Icons_04302026/Res_Application-Integration/Res_Amazon-Simple-Notification-Service_Topic_48.svg","sourceSha256":"sha256:1e3d19286abcc04364d5a2e8f83faa1dddf1657d68a1d9e9c6bfe351f0c5e242","state":"approved","transformationSteps":["remove-unused-root-xlink-namespace-v1","validate-svg-v2","normalize-svg-text-v1","verify-selected-source-v1"],"viewBox":"0 0 48 48"}`.

### SQS queue — `aws.sqs.queue`

Decision: **Separate native resource; Standard/FIFO is variation**. Queue stores
messages and has its own native identity; DLQ remains a real separate queue.
Bounded visibility/retention/long-polling/encryption/dedup. DLQ redrive is owned
source-queue config; retries are not exactly-once application processing.

Workflow: Show timeout/retention units, consumer behavior and separate DLQ
queue. Cost/operations: Requests, payload/message volume, retention and
downstream executions.

Primary references:
[Amazon SQS queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-queue-types.html);
[AWS::SQS::Queue](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-sqs-queue.html)
(current document SHA-256
`4ad3d40837435b8904c44d39c2d6f21fb4f0496d13f960c52430782d2c85a43d`).

Source/test references at exact base:
`apps/web/src/features/editor/model/connection-workflow.test.ts`,
`apps/web/src/features/editor/model/service-catalog-view-model.test.ts`,
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/catalog/services/iam-policy-document.ts`,
`packages/provider-aws/src/catalog/services/index.ts`,
`packages/provider-aws/src/catalog/services/sqs-eventing.ts`,
`packages/provider-aws/src/event-driven-catalog.test.ts`,
`packages/provider-aws/src/policy/projection-v1.test.ts`,
`packages/provider-aws/src/provider-extension-artifacts.test.ts`,
`packages/provider-aws/src/validation.test.ts`,
`services/iac-compiler/cloudformation_eventing.go`,
`services/iac-compiler/cloudformation_renderer.go`,
`services/iac-compiler/cloudformation_resources.go`,
`services/iac-compiler/terraform_artifacts.go`,
`services/iac-compiler/terraform_eventing.go`,
`services/iac-compiler/terraform_eventing_test.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_renderer.go`,
`services/iac-compiler/terraform_test.go`. Asset
`{"automatedSecurityResult":"passed","awsServiceFamily":"Amazon Simple Queue Service","destinationAssetId":"aws.cloudmarkup.provider-icons.asset.sqs-queue","file":"sqs-queue.svg","iconId":"aws.cloudmarkup.icons.sqs","mappingType":"exact-resource","mediaType":"image/svg+xml","normalizedBytes":1810,"normalizedSha256":"sha256:f3366e173fd675b3a53088661d2f9a20a1bf78da723e4e7039306723ee373515","serviceName":"SQS queue","sourceBytes":1891,"sourceMember":"Resource-Icons_04302026/Res_Application-Integration/Res_Amazon-Simple-Queue-Service_Queue_48.svg","sourceSha256":"sha256:39915b6e2eb2d77286a905bb0ca94912bca36605d518433db3b3f0d113e5d07d","state":"approved","transformationSteps":["remove-unused-root-xlink-namespace-v1","validate-svg-v2","normalize-svg-text-v1","verify-selected-source-v1"],"viewBox":"0 0 48 48"}`.

### SQS redrive configuration — `aws.sqs.redrive-configuration`

Decision: **Owned source queue configuration with native policy projections**.
Redrive owns policy intent; destination DLQ has a separate queue identity and
must not become a boolean. Bounded receive-count, BY_QUEUE allow policy and
manual review replay. Queue type/Region/ownership and shared generated resources
remain exact.

Workflow: Configure beneath source queue with visible DLQ target and replay
expectation. Cost/operations: Retained failed messages and replay/delivery
requests.

Primary references:
[Using dead-letter queues in Amazon SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html).

Source/test references at exact base:
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/catalog/services/index.ts`,
`packages/provider-aws/src/catalog/services/sqs-eventing.ts`,
`services/iac-compiler/cloudformation_renderer.go`,
`services/iac-compiler/terraform_eventing.go`,
`services/iac-compiler/terraform_renderer.go`. Asset `null`.

### Step Functions state machine — `aws.stepfunctions.state-machine`

Decision: **Separate native resource; bounded operation definition is
configuration**. Workflow has native identity, role and execution lifecycle;
flow/state choices are typed behavior, not new AWS service cards. Bounded
Standard catalog operations with error-only no-execution-data logs and typed
Lambda task edges. Generated CF error log group is missing from mapping
metadata; separate proposal adds its type. Arbitrary ASL/Express and business
semantics need new contracts.

Workflow: Show workflow/role/task behavior and logging ownership together.
Cost/operations: State transitions, execution telemetry and task destinations.

Primary references:
[AWS Step Functions state machines](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-statemachines.html);
[AWS::StepFunctions::StateMachine](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-stepfunctions-statemachine.html)
(current document SHA-256
`957fd9353992b72831d73b85be0f9f114fe054c00b798b3a11dafb8b16f72566`).

Source/test references at exact base:
`packages/provider-aws/src/catalog-v1.test.ts`,
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/catalog/services/index.ts`,
`packages/provider-aws/src/catalog/services/step-functions-eventing.ts`,
`packages/provider-aws/src/event-driven-catalog.test.ts`,
`services/iac-compiler/cloudformation_renderer.go`,
`services/iac-compiler/cloudformation_resources.go`,
`services/iac-compiler/terraform_artifacts.go`,
`services/iac-compiler/terraform_eventing.go`,
`services/iac-compiler/terraform_eventing_test.go`,
`services/iac-compiler/terraform_renderer.go`,
`services/iac-compiler/terraform_test.go`. Asset
`{"automatedSecurityResult":"passed","awsServiceFamily":"AWS Step Functions","destinationAssetId":"aws.cloudmarkup.provider-icons.asset.step-functions","file":"step-functions.svg","iconId":"aws.cloudmarkup.icons.step-functions","mappingType":"service-family","mediaType":"image/svg+xml","normalizedBytes":1979,"normalizedSha256":"sha256:8d975d2e7cf3a02529aeb6477c35f84c365928957df016de1608d4d3288873ef","serviceName":"Step Functions state machine","sourceBytes":2060,"sourceMember":"Architecture-Service-Icons_04302026/Arch_Application-Integration/48/Arch_AWS-Step-Functions_48.svg","sourceSha256":"sha256:c1bb81d6504d283c6b31cbd9516fa6b8364010ea3c30ae614507114ca34192ad","state":"approved","transformationSteps":["remove-unused-root-xlink-namespace-v1","validate-svg-v2","normalize-svg-text-v1","verify-selected-source-v1"],"viewBox":"0 0 64 64"}`.

## Connection rule matrix — every 137

The following sweep uses the actual current resolver. Every descriptor is
discovered from both endpoints; implementation registration is checked
against110/27; wrong port, reversed direction, wrong catalog digest and
endpoint/source/target saturation are exercised. For same-service rules reversal
is tested through invalid port direction. Descriptive owner rules are catalog
graph contracts, not automatic resolver implementations.
Configuration/parent/owner consistency and family positive exports remain
separate admission requirements.

| Rule                                                             | Source service.port → target service.port                                                                                                                                         | State           | Max pair / source / target | Empty prerequisite preview                                                    | Probe refusals                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | -------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| aws.acm.certificate-validates-in-zone                            | aws.acm.public-dns-certificate.aws.acm.public-dns-certificate.validation-zone → aws.route53.public-hosted-zone.aws.route53.public-hosted-zone.certificate                         | implemented     | [1,1,128]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                           |
| aws.apigateway.http-api-invokes-lambda                           | aws.apigateway.http-api.aws.apigateway.http-api.invocation → aws.lambda.function.aws.lambda.function.synchronous-invocation                                                       | implemented     | [8,32,8]                   | {"success":false,"findings":["aws.apigateway.finding.route-required"]}        | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded"]                                                                                                                     |
| aws.aurora.cluster-has-instance                                  | aws.aurora.postgresql-cluster.aws.aurora.postgresql-cluster.instance → aws.aurora.postgresql-instance.aws.aurora.postgresql-instance.cluster                                      | implemented     | [1,2,1]                    | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded"]                                                           |
| aws.aurora.cluster-uses-parameter-group                          | aws.aurora.postgresql-cluster-parameter-group.aws.aurora.postgresql-cluster-parameter-group.cluster → aws.aurora.postgresql-cluster.aws.aurora.postgresql-cluster.parameter-group | implemented     | [1,128,1]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded"]                                                           |
| aws.aurora.cluster-uses-security-group                           | aws.aurora.postgresql-cluster.aws.aurora.postgresql-cluster.security-group → aws.ec2.security-group.aws.ec2.security-group.aurora-cluster                                         | implemented     | [1,5,128]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                                                                                     |
| aws.aurora.cluster-uses-subnet-group                             | aws.rds.db-subnet-group.aws.rds.db-subnet-group.aurora-cluster → aws.aurora.postgresql-cluster.aws.aurora.postgresql-cluster.subnet-group                                         | implemented     | [1,128,1]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded"]                                                           |
| aws.cloudfront.alias-uses-certificate                            | aws.cloudfront.alias-configuration.aws.cloudfront.alias-configuration.certificate → aws.acm.public-dns-certificate.aws.acm.public-dns-certificate.cloudfront-alias                | implemented     | [1,1,1]                    | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded"] |
| aws.cloudfront.distribution-owns-alias                           | aws.cloudfront.alias-configuration.aws.cloudfront.alias-configuration.distribution → aws.cloudfront.distribution.aws.cloudfront.distribution.alias                                | implemented     | [1,1,1]                    | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded"] |
| aws.cloudfront.reads-s3-origin                                   | aws.cloudfront.distribution.aws.cloudfront.distribution.s3-origin → aws.s3.bucket.aws.s3.bucket.cloudfront-origin                                                                 | implemented     | [1,1,1]                    | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded"] |
| aws.cloudfront.uses-cache-policy                                 | aws.cloudfront.distribution.aws.cloudfront.distribution.cache-policy → aws.cloudfront.cache-policy.aws.cloudfront.cache-policy.distribution                                       | implemented     | [1,1,128]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                           |
| aws.cognito.app-client-authorizes-http-api                       | aws.cognito.user-pool-client.aws.cognito.user-pool-client.jwt-audience → aws.apigateway.http-api.aws.apigateway.http-api.jwt-audience                                             | implemented     | [1,100,1]                  | {"success":true,"findings":["aws.cognito.finding.jwt-issuer-required"]}       | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded"]                                                           |
| aws.cognito.user-pool-authorizes-http-api                        | aws.cognito.user-pool.aws.cognito.user-pool.jwt-issuer → aws.apigateway.http-api.aws.apigateway.http-api.jwt-issuer                                                               | implemented     | [1,100,1]                  | {"success":true,"findings":["aws.cognito.finding.jwt-audience-required"]}     | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded"]                                                           |
| aws.cognito.user-pool-configures-app-client                      | aws.cognito.user-pool.aws.cognito.user-pool.app-client-parent → aws.cognito.user-pool-client.aws.cognito.user-pool-client.user-pool                                               | not-implemented | [1,100,1]                  | {"success":false,"findings":["cloudmarkup.connection.rule-not-implemented"]}  | ["cloudmarkup.connection.rule-not-implemented","cloudmarkup.connection.catalog-mismatch"]                                                                                                                                                                                                                                                                                                                                  |
| aws.ebs.attachment-uses-instance                                 | aws.ebs.volume-attachment.aws.ebs.volume-attachment.instance → aws.ec2.instance.aws.ec2.instance.data-volume                                                                      | implemented     | [1,1,4]                    | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                           |
| aws.ebs.availability-zone-contains-volume                        | aws.ebs.volume.aws.ebs.volume.availability-zone → aws.ec2.availability-zone.aws.ec2.availability-zone.ebs-volume                                                                  | implemented     | [1,1,128]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                           |
| aws.ebs.volume-owns-attachment                                   | aws.ebs.volume-attachment.aws.ebs.volume-attachment.volume → aws.ebs.volume.aws.ebs.volume.attachment                                                                             | implemented     | [1,1,1]                    | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded"] |
| aws.ebs.volume-uses-key                                          | aws.ebs.volume.aws.ebs.volume.encryption-key → aws.kms.key.aws.kms.key.ebs-volume                                                                                                 | implemented     | [1,1,128]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                           |
| aws.ec2.availability-zone-contains-subnet                        | aws.ec2.availability-zone.aws.ec2.availability-zone.subnet-placement → aws.ec2.subnet.aws.ec2.subnet.availability-zone                                                            | not-implemented | [1,100,1]                  | {"success":false,"findings":["cloudmarkup.connection.rule-not-implemented"]}  | ["cloudmarkup.connection.rule-not-implemented","cloudmarkup.connection.catalog-mismatch"]                                                                                                                                                                                                                                                                                                                                  |
| aws.ec2.gateway-endpoint-associates-route-table                  | aws.ec2.gateway-vpc-endpoint.aws.ec2.gateway-vpc-endpoint.route-table-association → aws.ec2.route-table.aws.ec2.route-table.gateway-endpoint-association                          | implemented     | [1,100,16]                 | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                                                                                     |
| aws.ec2.gateway-endpoint-owns-policy                             | aws.iam.policy-document.aws.iam.policy-document.gateway-endpoint-resource-policy → aws.ec2.gateway-vpc-endpoint.aws.ec2.gateway-vpc-endpoint.resource-policy                      | not-implemented | [1,1,1]                    | {"success":false,"findings":["cloudmarkup.connection.rule-not-implemented"]}  | ["cloudmarkup.connection.rule-not-implemented","cloudmarkup.connection.catalog-mismatch"]                                                                                                                                                                                                                                                                                                                                  |
| aws.ec2.instance-uses-security-group                             | aws.ec2.instance.aws.ec2.instance.security-group → aws.ec2.security-group.aws.ec2.security-group.instance                                                                         | implemented     | [1,5,128]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                                                                                     |
| aws.ec2.instance-uses-subnet                                     | aws.ec2.instance.aws.ec2.instance.subnet → aws.ec2.subnet.aws.ec2.subnet.instance                                                                                                 | implemented     | [1,1,128]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                           |
| aws.ec2.route-table-association-targets-subnet                   | aws.ec2.route-table-association.aws.ec2.route-table-association.subnet → aws.ec2.subnet.aws.ec2.subnet.route-table-association                                                    | implemented     | [1,1,1]                    | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded"] |
| aws.ec2.route-table-owns-route                                   | aws.ec2.route.aws.ec2.route.route-table → aws.ec2.route-table.aws.ec2.route-table.route                                                                                           | not-implemented | [1,1,100]                  | {"success":false,"findings":["cloudmarkup.connection.rule-not-implemented"]}  | ["cloudmarkup.connection.rule-not-implemented","cloudmarkup.connection.catalog-mismatch"]                                                                                                                                                                                                                                                                                                                                  |
| aws.ec2.route-table-owns-subnet-association                      | aws.ec2.route-table-association.aws.ec2.route-table-association.route-table → aws.ec2.route-table.aws.ec2.route-table.subnet-association                                          | not-implemented | [1,1,100]                  | {"success":false,"findings":["cloudmarkup.connection.rule-not-implemented"]}  | ["cloudmarkup.connection.rule-not-implemented","cloudmarkup.connection.catalog-mismatch"]                                                                                                                                                                                                                                                                                                                                  |
| aws.ec2.route-targets-internet-gateway                           | aws.ec2.route.aws.ec2.route.internet-gateway-target → aws.ec2.internet-gateway.aws.ec2.internet-gateway.route-target                                                              | implemented     | [1,1,100]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                           |
| aws.ec2.route-targets-nat-gateway                                | aws.ec2.route.aws.ec2.route.nat-gateway-target → aws.ec2.nat-gateway.aws.ec2.nat-gateway.route-target                                                                             | implemented     | [1,1,100]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                           |
| aws.ec2.security-group-owns-egress-rule                          | aws.ec2.security-group-egress-rule.aws.ec2.security-group-egress-rule.security-group → aws.ec2.security-group.aws.ec2.security-group.egress-rule                                  | not-implemented | [1,1,100]                  | {"success":false,"findings":["cloudmarkup.connection.rule-not-implemented"]}  | ["cloudmarkup.connection.rule-not-implemented","cloudmarkup.connection.catalog-mismatch"]                                                                                                                                                                                                                                                                                                                                  |
| aws.ec2.security-group-owns-ingress-rule                         | aws.ec2.security-group-ingress-rule.aws.ec2.security-group-ingress-rule.security-group → aws.ec2.security-group.aws.ec2.security-group.ingress-rule                               | not-implemented | [1,1,100]                  | {"success":false,"findings":["cloudmarkup.connection.rule-not-implemented"]}  | ["cloudmarkup.connection.rule-not-implemented","cloudmarkup.connection.catalog-mismatch"]                                                                                                                                                                                                                                                                                                                                  |
| aws.ec2.subnet-contains-nat-gateway                              | aws.ec2.subnet.aws.ec2.subnet.nat-gateway-placement → aws.ec2.nat-gateway.aws.ec2.nat-gateway.subnet                                                                              | not-implemented | [1,1,1]                    | {"success":false,"findings":["cloudmarkup.connection.rule-not-implemented"]}  | ["cloudmarkup.connection.rule-not-implemented","cloudmarkup.connection.catalog-mismatch"]                                                                                                                                                                                                                                                                                                                                  |
| aws.ec2.vpc-associates-security-group                            | aws.ec2.vpc.aws.ec2.vpc.security-group-association → aws.ec2.security-group.aws.ec2.security-group.vpc                                                                            | implemented     | [1,100,1]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded"]                                                           |
| aws.ec2.vpc-attaches-internet-gateway                            | aws.ec2.vpc.aws.ec2.vpc.internet-gateway-attachment → aws.ec2.internet-gateway.aws.ec2.internet-gateway.vpc-attachment                                                            | implemented     | [1,1,1]                    | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded"] |
| aws.ec2.vpc-contains-availability-zone                           | aws.ec2.vpc.aws.ec2.vpc.availability-zone-placement → aws.ec2.availability-zone.aws.ec2.availability-zone.vpc                                                                     | not-implemented | [1,100,1]                  | {"success":false,"findings":["cloudmarkup.connection.rule-not-implemented"]}  | ["cloudmarkup.connection.rule-not-implemented","cloudmarkup.connection.catalog-mismatch"]                                                                                                                                                                                                                                                                                                                                  |
| aws.ec2.vpc-contains-gateway-endpoint                            | aws.ec2.vpc.aws.ec2.vpc.gateway-endpoint-placement → aws.ec2.gateway-vpc-endpoint.aws.ec2.gateway-vpc-endpoint.vpc                                                                | not-implemented | [1,16,1]                   | {"success":false,"findings":["cloudmarkup.connection.rule-not-implemented"]}  | ["cloudmarkup.connection.rule-not-implemented","cloudmarkup.connection.catalog-mismatch"]                                                                                                                                                                                                                                                                                                                                  |
| aws.ec2.vpc-contains-route-table                                 | aws.ec2.vpc.aws.ec2.vpc.route-table-placement → aws.ec2.route-table.aws.ec2.route-table.vpc                                                                                       | not-implemented | [1,100,1]                  | {"success":false,"findings":["cloudmarkup.connection.rule-not-implemented"]}  | ["cloudmarkup.connection.rule-not-implemented","cloudmarkup.connection.catalog-mismatch"]                                                                                                                                                                                                                                                                                                                                  |
| aws.ecr.repository-owns-image                                    | aws.ecr.image-reference.aws.ecr.image-reference.repository → aws.ecr.repository.aws.ecr.repository.image                                                                          | implemented     | [1,1,64]                   | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                           |
| aws.ecs.container-uses-image                                     | aws.ecr.image-reference.aws.ecr.image-reference.container → aws.ecs.container-definition.aws.ecs.container-definition.image                                                       | implemented     | [1,128,1]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded"]                                                           |
| aws.ecs.container-uses-secret                                    | aws.secretsmanager.secret.aws.secretsmanager.secret.ecs-container → aws.ecs.container-definition.aws.ecs.container-definition.secret                                              | implemented     | [8,128,8]                  | {"success":false,"findings":["cloudmarkup.connection.invalid-configuration"]} | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded"]                                                                                                                     |
| aws.ecs.container-writes-logs                                    | aws.ecs.container-definition.aws.ecs.container-definition.log-group → aws.cloudwatch.log-group.aws.cloudwatch.log-group.ecs-container                                             | implemented     | [1,1,128]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                           |
| aws.ecs.service-uses-cluster                                     | aws.ecs.cluster.aws.ecs.cluster.service → aws.ecs.service.aws.ecs.service.cluster                                                                                                 | implemented     | [1,128,1]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded"]                                                           |
| aws.ecs.service-uses-security-group                              | aws.ecs.service.aws.ecs.service.security-group → aws.ec2.security-group.aws.ec2.security-group.ecs-service                                                                        | implemented     | [1,5,128]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                                                                                     |
| aws.ecs.service-uses-subnet                                      | aws.ecs.service.aws.ecs.service.subnet → aws.ec2.subnet.aws.ec2.subnet.ecs-service                                                                                                | implemented     | [1,16,128]                 | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                                                                                     |
| aws.ecs.service-uses-task                                        | aws.ecs.task-definition.aws.ecs.task-definition.service → aws.ecs.service.aws.ecs.service.task                                                                                    | implemented     | [1,128,1]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded"]                                                           |
| aws.ecs.task-owns-container                                      | aws.ecs.container-definition.aws.ecs.container-definition.task → aws.ecs.task-definition.aws.ecs.task-definition.container                                                        | implemented     | [1,1,1]                    | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded"] |
| aws.ecs.task-uses-application-role                               | aws.iam.role.aws.iam.role.assumable-role → aws.ecs.task-definition.aws.ecs.task-definition.application-role                                                                       | implemented     | [1,1,1]                    | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded"] |
| aws.ecs.task-uses-execution-role                                 | aws.iam.role.aws.iam.role.assumable-role → aws.ecs.task-definition.aws.ecs.task-definition.execution-role                                                                         | implemented     | [1,1,1]                    | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded"] |
| aws.elb.alb-owns-listener                                        | aws.elb.https-listener.aws.elb.https-listener.alb → aws.elb.application-load-balancer.aws.elb.application-load-balancer.listener                                                  | implemented     | [1,1,1]                    | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded"] |
| aws.elb.alb-uses-security-group                                  | aws.elb.application-load-balancer.aws.elb.application-load-balancer.security-group → aws.ec2.security-group.aws.ec2.security-group.alb                                            | implemented     | [1,1,128]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                           |
| aws.elb.alb-uses-subnet                                          | aws.elb.application-load-balancer.aws.elb.application-load-balancer.subnet → aws.ec2.subnet.aws.ec2.subnet.alb                                                                    | implemented     | [1,16,128]                 | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                                                                                     |
| aws.elb.alb-uses-vpc                                             | aws.elb.application-load-balancer.aws.elb.application-load-balancer.vpc → aws.ec2.vpc.aws.ec2.vpc.alb                                                                             | implemented     | [1,1,128]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                           |
| aws.elb.backend-access-uses-alb-group                            | aws.elb.backend-access-configuration.aws.elb.backend-access-configuration.alb-group → aws.ec2.security-group.aws.ec2.security-group.alb-access-source                             | implemented     | [1,1,128]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                           |
| aws.elb.backend-access-uses-target-group                         | aws.elb.backend-access-configuration.aws.elb.backend-access-configuration.backend-group → aws.ec2.security-group.aws.ec2.security-group.alb-access-target                         | implemented     | [1,1,128]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                           |
| aws.elb.listener-forwards-to-target-group                        | aws.elb.https-listener.aws.elb.https-listener.target-group → aws.elb.target-group.aws.elb.target-group.listener                                                                   | implemented     | [1,1,1]                    | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded"] |
| aws.elb.listener-uses-certificate                                | aws.elb.https-listener.aws.elb.https-listener.certificate → aws.acm.public-dns-certificate.aws.acm.public-dns-certificate.alb-listener                                            | implemented     | [1,1,128]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                           |
| aws.elb.target-group-owns-backend-access                         | aws.elb.backend-access-configuration.aws.elb.backend-access-configuration.target-group → aws.elb.target-group.aws.elb.target-group.backend-access                                 | implemented     | [1,1,1]                    | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded"] |
| aws.elb.target-group-targets-ec2                                 | aws.elb.target-group.aws.elb.target-group.ec2-backend → aws.ec2.instance.aws.ec2.instance.alb-target                                                                              | implemented     | [1,1,1]                    | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded"] |
| aws.elb.target-group-targets-ecs                                 | aws.elb.target-group.aws.elb.target-group.ecs-backend → aws.ecs.service.aws.ecs.service.alb-target                                                                                | implemented     | [1,1,1]                    | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded"] |
| aws.elb.target-group-uses-vpc                                    | aws.elb.target-group.aws.elb.target-group.vpc → aws.ec2.vpc.aws.ec2.vpc.alb-target-group                                                                                          | implemented     | [1,1,128]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                           |
| aws.eventbridge.event-bus-associates-rule                        | aws.eventbridge.event-bus.aws.eventbridge.event-bus.rules → aws.eventbridge.rule.aws.eventbridge.rule.event-bus                                                                   | implemented     | [1,300,1]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded"]                                                           |
| aws.eventbridge.event-bus-owns-resource-policy                   | aws.iam.policy-document.aws.iam.policy-document.event-bus-resource-policy → aws.eventbridge.event-bus.aws.eventbridge.event-bus.resource-policy                                   | implemented     | [1,1,1]                    | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded"] |
| aws.eventbridge.rule-owns-target                                 | aws.eventbridge.rule.aws.eventbridge.rule.targets → aws.eventbridge.target.aws.eventbridge.target.rule                                                                            | implemented     | [1,5,1]                    | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded"]                                                           |
| aws.eventbridge.target-invokes-lambda                            | aws.eventbridge.target.aws.eventbridge.target.lambda → aws.lambda.function.aws.lambda.function.asynchronous-invocation                                                            | implemented     | [1,1,100]                  | {"success":false,"findings":["aws.eventing.finding.permission-prerequisite"]} | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                           |
| aws.eventbridge.target-publishes-to-sns                          | aws.eventbridge.target.aws.eventbridge.target.topic → aws.sns.topic.aws.sns.topic.publish                                                                                         | implemented     | [1,1,100]                  | {"success":false,"findings":["aws.eventing.finding.permission-prerequisite"]} | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                           |
| aws.eventbridge.target-sends-to-sqs                              | aws.eventbridge.target.aws.eventbridge.target.queue → aws.sqs.queue.aws.sqs.queue.message-send                                                                                    | implemented     | [1,1,100]                  | {"success":false,"findings":["aws.eventing.finding.permission-prerequisite"]} | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                           |
| aws.eventbridge.target-starts-state-machine                      | aws.eventbridge.target.aws.eventbridge.target.state-machine → aws.stepfunctions.state-machine.aws.stepfunctions.state-machine.start-execution                                     | implemented     | [1,1,100]                  | {"success":false,"findings":["aws.eventing.finding.permission-prerequisite"]} | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                           |
| aws.eventbridge.target-uses-dead-letter-queue                    | aws.eventbridge.target.aws.eventbridge.target.dead-letter-queue → aws.sqs.queue.aws.sqs.queue.dead-letter-target                                                                  | implemented     | [1,1,100]                  | {"success":false,"findings":["aws.eventing.finding.permission-prerequisite"]} | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                           |
| aws.fsx.lustre-file-system-uses-security-group                   | aws.fsx.lustre-file-system.aws.fsx.lustre-file-system.security-groups → aws.ec2.security-group.aws.ec2.security-group.fsx                                                         | implemented     | [1,5,256]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                                                                                     |
| aws.fsx.lustre-file-system-uses-subnet                           | aws.fsx.lustre-file-system.aws.fsx.lustre-file-system.subnets → aws.ec2.subnet.aws.ec2.subnet.fsx                                                                                 | implemented     | [1,1,256]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                                                                                     |
| aws.fsx.lustre-imports-s3                                        | aws.fsx.lustre-file-system.aws.fsx.lustre-file-system.s3-repository → aws.s3.bucket.aws.s3.bucket.object-api                                                                      | implemented     | [1,1,256]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                                                                                     |
| aws.fsx.ontap-file-system-uses-security-group                    | aws.fsx.ontap-file-system.aws.fsx.ontap-file-system.security-groups → aws.ec2.security-group.aws.ec2.security-group.fsx                                                           | implemented     | [1,5,256]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                                                                                     |
| aws.fsx.ontap-file-system-uses-subnet                            | aws.fsx.ontap-file-system.aws.fsx.ontap-file-system.subnets → aws.ec2.subnet.aws.ec2.subnet.fsx                                                                                   | implemented     | [1,1,256]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                                                                                     |
| aws.fsx.ontap-svm-uses-file-system                               | aws.fsx.ontap-storage-virtual-machine.aws.fsx.ontap-storage-virtual-machine.file-system → aws.fsx.ontap-file-system.aws.fsx.ontap-file-system.storage-virtual-machines            | implemented     | [1,1,256]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                           |
| aws.fsx.ontap-volume-uses-svm                                    | aws.fsx.ontap-volume.aws.fsx.ontap-volume.storage-virtual-machine → aws.fsx.ontap-storage-virtual-machine.aws.fsx.ontap-storage-virtual-machine.volumes                           | implemented     | [1,1,256]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                           |
| aws.fsx.openzfs-file-system-uses-security-group                  | aws.fsx.openzfs-file-system.aws.fsx.openzfs-file-system.security-groups → aws.ec2.security-group.aws.ec2.security-group.fsx                                                       | implemented     | [1,5,256]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                                                                                     |
| aws.fsx.openzfs-file-system-uses-subnet                          | aws.fsx.openzfs-file-system.aws.fsx.openzfs-file-system.subnets → aws.ec2.subnet.aws.ec2.subnet.fsx                                                                               | implemented     | [1,1,256]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                                                                                     |
| aws.fsx.windows-file-system-uses-security-group                  | aws.fsx.windows-file-system.aws.fsx.windows-file-system.security-groups → aws.ec2.security-group.aws.ec2.security-group.fsx                                                       | implemented     | [1,5,256]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                                                                                     |
| aws.fsx.windows-file-system-uses-subnet                          | aws.fsx.windows-file-system.aws.fsx.windows-file-system.subnets → aws.ec2.subnet.aws.ec2.subnet.fsx                                                                               | implemented     | [1,2,256]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                                                                                     |
| aws.iam.instance-profile-supplies-instance                       | aws.iam.instance-profile.aws.iam.instance-profile.instance → aws.ec2.instance.aws.ec2.instance.instance-profile                                                                   | implemented     | [1,128,1]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded"]                                                           |
| aws.iam.policy-contains-statement                                | aws.iam.policy-statement.aws.iam.policy-statement.policy-document → aws.iam.policy-document.aws.iam.policy-document.statement                                                     | not-implemented | [1,1,256]                  | {"success":false,"findings":["cloudmarkup.connection.rule-not-implemented"]}  | ["cloudmarkup.connection.rule-not-implemented","cloudmarkup.connection.catalog-mismatch"]                                                                                                                                                                                                                                                                                                                                  |
| aws.iam.policy-statement-authorizes-dynamodb-table               | aws.iam.policy-statement.aws.iam.policy-statement.dynamodb-resource → aws.dynamodb.table.aws.dynamodb.table.policy-resource                                                       | not-implemented | [1,1,64]                   | {"success":false,"findings":["cloudmarkup.connection.rule-not-implemented"]}  | ["cloudmarkup.connection.rule-not-implemented","cloudmarkup.connection.catalog-mismatch"]                                                                                                                                                                                                                                                                                                                                  |
| aws.iam.policy-statement-authorizes-eventbridge-bus              | aws.iam.policy-statement.aws.iam.policy-statement.eventbridge-resource → aws.eventbridge.event-bus.aws.eventbridge.event-bus.policy-resource                                      | implemented     | [1,128,128]                | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                                                                                     |
| aws.iam.policy-statement-authorizes-kms-key                      | aws.iam.policy-statement.aws.iam.policy-statement.kms-resource → aws.kms.key.aws.kms.key.policy-resource                                                                          | not-implemented | [1,1,128]                  | {"success":false,"findings":["cloudmarkup.connection.rule-not-implemented"]}  | ["cloudmarkup.connection.rule-not-implemented","cloudmarkup.connection.catalog-mismatch"]                                                                                                                                                                                                                                                                                                                                  |
| aws.iam.policy-statement-authorizes-lambda-function              | aws.iam.policy-statement.aws.iam.policy-statement.lambda-resource → aws.lambda.function.aws.lambda.function.policy-resource                                                       | not-implemented | [1,1,64]                   | {"success":false,"findings":["cloudmarkup.connection.rule-not-implemented"]}  | ["cloudmarkup.connection.rule-not-implemented","cloudmarkup.connection.catalog-mismatch"]                                                                                                                                                                                                                                                                                                                                  |
| aws.iam.policy-statement-authorizes-log-group                    | aws.iam.policy-statement.aws.iam.policy-statement.log-group-resource → aws.cloudwatch.log-group.aws.cloudwatch.log-group.policy-resource                                          | not-implemented | [1,1,64]                   | {"success":false,"findings":["cloudmarkup.connection.rule-not-implemented"]}  | ["cloudmarkup.connection.rule-not-implemented","cloudmarkup.connection.catalog-mismatch"]                                                                                                                                                                                                                                                                                                                                  |
| aws.iam.policy-statement-authorizes-s3-bucket                    | aws.iam.policy-statement.aws.iam.policy-statement.s3-resource → aws.s3.bucket.aws.s3.bucket.policy-resource                                                                       | implemented     | [1,128,128]                | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                                                                                     |
| aws.iam.policy-statement-authorizes-secret                       | aws.iam.policy-statement.aws.iam.policy-statement.secret-resource → aws.secretsmanager.secret.aws.secretsmanager.secret.policy-resource                                           | not-implemented | [1,1,128]                  | {"success":false,"findings":["cloudmarkup.connection.rule-not-implemented"]}  | ["cloudmarkup.connection.rule-not-implemented","cloudmarkup.connection.catalog-mismatch"]                                                                                                                                                                                                                                                                                                                                  |
| aws.iam.policy-statement-authorizes-sns-topic                    | aws.iam.policy-statement.aws.iam.policy-statement.sns-resource → aws.sns.topic.aws.sns.topic.policy-resource                                                                      | implemented     | [1,128,128]                | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                                                                                     |
| aws.iam.policy-statement-authorizes-sqs-queue                    | aws.iam.policy-statement.aws.iam.policy-statement.sqs-resource → aws.sqs.queue.aws.sqs.queue.policy-resource                                                                      | implemented     | [1,128,128]                | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                                                                                     |
| aws.iam.policy-statement-authorizes-step-functions-state-machine | aws.iam.policy-statement.aws.iam.policy-statement.step-functions-resource → aws.stepfunctions.state-machine.aws.stepfunctions.state-machine.policy-resource                       | implemented     | [1,128,128]                | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                                                                                     |
| aws.iam.role-assumed-by-eventbridge-target                       | aws.iam.role.aws.iam.role.assumable-role → aws.eventbridge.target.aws.eventbridge.target.execution-role                                                                           | implemented     | [1,1,1]                    | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded"] |
| aws.iam.role-assumed-by-lambda                                   | aws.iam.role.aws.iam.role.assumable-role → aws.lambda.function.aws.lambda.function.execution-role                                                                                 | implemented     | [1,1,1]                    | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded"] |
| aws.iam.role-assumed-by-step-functions                           | aws.iam.role.aws.iam.role.assumable-role → aws.stepfunctions.state-machine.aws.stepfunctions.state-machine.execution-role                                                         | implemented     | [1,1,1]                    | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded"] |
| aws.iam.role-binds-instance-profile                              | aws.iam.role.aws.iam.role.assumable-role → aws.iam.instance-profile.aws.iam.instance-profile.role                                                                                 | implemented     | [1,1,1]                    | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded"] |
| aws.iam.role-owns-generated-permission                           | aws.iam.policy-document.aws.iam.policy-document.role-generated-permission → aws.iam.role.aws.iam.role.generated-permission                                                        | not-implemented | [1,1,64]                   | {"success":false,"findings":["cloudmarkup.connection.rule-not-implemented"]}  | ["cloudmarkup.connection.rule-not-implemented","cloudmarkup.connection.catalog-mismatch"]                                                                                                                                                                                                                                                                                                                                  |
| aws.iam.role-owns-inline-policy                                  | aws.iam.policy-document.aws.iam.policy-document.role-inline-policy → aws.iam.role.aws.iam.role.custom-inline-policy                                                               | not-implemented | [1,1,32]                   | {"success":false,"findings":["cloudmarkup.connection.rule-not-implemented"]}  | ["cloudmarkup.connection.rule-not-implemented","cloudmarkup.connection.catalog-mismatch"]                                                                                                                                                                                                                                                                                                                                  |
| aws.iam.role-owns-managed-policy-attachment                      | aws.iam.managed-policy-attachment.aws.iam.managed-policy-attachment.role-managed-policy → aws.iam.role.aws.iam.role.managed-policy                                                | not-implemented | [1,1,32]                   | {"success":false,"findings":["cloudmarkup.connection.rule-not-implemented"]}  | ["cloudmarkup.connection.rule-not-implemented","cloudmarkup.connection.catalog-mismatch"]                                                                                                                                                                                                                                                                                                                                  |
| aws.iam.role-owns-permissions-boundary                           | aws.iam.managed-policy-attachment.aws.iam.managed-policy-attachment.role-permissions-boundary → aws.iam.role.aws.iam.role.permissions-boundary                                    | not-implemented | [1,1,1]                    | {"success":false,"findings":["cloudmarkup.connection.rule-not-implemented"]}  | ["cloudmarkup.connection.rule-not-implemented","cloudmarkup.connection.catalog-mismatch"]                                                                                                                                                                                                                                                                                                                                  |
| aws.iam.role-owns-trust-policy                                   | aws.iam.policy-document.aws.iam.policy-document.role-trust-policy → aws.iam.role.aws.iam.role.trust-policy                                                                        | not-implemented | [1,1,1]                    | {"success":false,"findings":["cloudmarkup.connection.rule-not-implemented"]}  | ["cloudmarkup.connection.rule-not-implemented","cloudmarkup.connection.catalog-mismatch"]                                                                                                                                                                                                                                                                                                                                  |
| aws.iam.statement-owns-condition                                 | aws.iam.policy-condition.aws.iam.policy-condition.statement-condition → aws.iam.policy-statement.aws.iam.policy-statement.condition                                               | not-implemented | [1,1,128]                  | {"success":false,"findings":["cloudmarkup.connection.rule-not-implemented"]}  | ["cloudmarkup.connection.rule-not-implemented","cloudmarkup.connection.catalog-mismatch"]                                                                                                                                                                                                                                                                                                                                  |
| aws.kms.key-encrypts-instance-root                               | aws.kms.key.aws.kms.key.root-volume-encryption → aws.ec2.instance.aws.ec2.instance.root-encryption-key                                                                            | implemented     | [1,128,1]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded"]                                                           |
| aws.kms.key-encrypts-secret                                      | aws.kms.key.aws.kms.key.secret-encryption → aws.secretsmanager.secret.aws.secretsmanager.secret.encryption-key                                                                    | implemented     | [1,128,1]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded"]                                                           |
| aws.kms.key-owns-resource-policy                                 | aws.iam.policy-document.aws.iam.policy-document.kms-key-resource-policy → aws.kms.key.aws.kms.key.resource-policy                                                                 | not-implemented | [1,1,1]                    | {"success":false,"findings":["cloudmarkup.connection.rule-not-implemented"]}  | ["cloudmarkup.connection.rule-not-implemented","cloudmarkup.connection.catalog-mismatch"]                                                                                                                                                                                                                                                                                                                                  |
| aws.lambda.monitored-by-alarm                                    | aws.lambda.function.aws.lambda.function.telemetry → aws.cloudwatch.metric-alarm.aws.cloudwatch.metric-alarm.metric                                                                | implemented     | [1,16,1]                   | {"success":false,"findings":["aws.lambda.finding.unsupported-alarm-metric"]}  | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded"]                                                           |
| aws.lambda.owns-invocation-permission                            | aws.iam.policy-document.aws.iam.policy-document.lambda-service-grant → aws.lambda.function.aws.lambda.function.invocation-permission                                              | not-implemented | [1,1,64]                   | {"success":false,"findings":["cloudmarkup.connection.rule-not-implemented"]}  | ["cloudmarkup.connection.rule-not-implemented","cloudmarkup.connection.catalog-mismatch"]                                                                                                                                                                                                                                                                                                                                  |
| aws.lambda.owns-vpc-access-configuration                         | aws.lambda.vpc-access-configuration.aws.lambda.vpc-access-configuration.function → aws.lambda.function.aws.lambda.function.vpc-access                                             | not-implemented | [1,1,1]                    | {"success":false,"findings":["cloudmarkup.connection.rule-not-implemented"]}  | ["cloudmarkup.connection.rule-not-implemented","cloudmarkup.connection.catalog-mismatch"]                                                                                                                                                                                                                                                                                                                                  |
| aws.lambda.publishes-to-sns                                      | aws.lambda.function.aws.lambda.function.event-publish → aws.sns.topic.aws.sns.topic.publish                                                                                       | implemented     | [1,64,128]                 | {"success":false,"findings":["aws.eventing.finding.permission-prerequisite"]} | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                                                                                     |
| aws.lambda.puts-events-on-eventbridge                            | aws.lambda.function.aws.lambda.function.event-publish → aws.eventbridge.event-bus.aws.eventbridge.event-bus.publish                                                               | implemented     | [1,64,128]                 | {"success":false,"findings":["aws.eventing.finding.permission-prerequisite"]} | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                                                                                     |
| aws.lambda.reads-dynamodb-table                                  | aws.lambda.function.aws.lambda.function.data-read → aws.dynamodb.table.aws.dynamodb.table.table-api                                                                               | implemented     | [1,16,64]                  | {"success":false,"findings":["aws.lambda.finding.execution-role-required"]}   | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                                                                                     |
| aws.lambda.reads-s3-bucket                                       | aws.lambda.function.aws.lambda.function.data-read → aws.s3.bucket.aws.s3.bucket.object-api                                                                                        | implemented     | [1,16,64]                  | {"success":false,"findings":["aws.eventing.finding.permission-prerequisite"]} | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                                                                                     |
| aws.lambda.sends-message-to-sqs                                  | aws.lambda.function.aws.lambda.function.message-send → aws.sqs.queue.aws.sqs.queue.message-send                                                                                   | implemented     | [1,64,128]                 | {"success":false,"findings":["aws.eventing.finding.permission-prerequisite"]} | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                                                                                     |
| aws.lambda.starts-step-functions-state-machine                   | aws.lambda.function.aws.lambda.function.workload-invocation → aws.stepfunctions.state-machine.aws.stepfunctions.state-machine.start-execution                                     | implemented     | [1,32,64]                  | {"success":false,"findings":["aws.eventing.finding.permission-prerequisite"]} | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                                                                                     |
| aws.lambda.uses-sqs-dead-letter-queue                            | aws.lambda.function.aws.lambda.function.dead-letter-destination → aws.sqs.queue.aws.sqs.queue.dead-letter-target                                                                  | implemented     | [1,1,64]                   | {"success":false,"findings":["aws.eventing.finding.permission-prerequisite"]} | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                           |
| aws.lambda.vpc-access-uses-security-group                        | aws.lambda.vpc-access-configuration.aws.lambda.vpc-access-configuration.security-group → aws.ec2.security-group.aws.ec2.security-group.lambda-vpc-access                          | implemented     | [1,5,100]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                                                                                     |
| aws.lambda.vpc-access-uses-subnet                                | aws.lambda.vpc-access-configuration.aws.lambda.vpc-access-configuration.subnet → aws.ec2.subnet.aws.ec2.subnet.lambda-vpc-access                                                  | implemented     | [1,16,100]                 | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                                                                                     |
| aws.lambda.writes-dynamodb-table                                 | aws.lambda.function.aws.lambda.function.data-write → aws.dynamodb.table.aws.dynamodb.table.table-api                                                                              | implemented     | [1,16,64]                  | {"success":false,"findings":["aws.lambda.finding.execution-role-required"]}   | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                                                                                     |
| aws.lambda.writes-log-group                                      | aws.lambda.function.aws.lambda.function.logging → aws.cloudwatch.log-group.aws.cloudwatch.log-group.logs                                                                          | implemented     | [1,1,1]                    | {"success":false,"findings":["aws.lambda.finding.logging-role-required"]}     | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded"] |
| aws.lambda.writes-s3-bucket                                      | aws.lambda.function.aws.lambda.function.data-write → aws.s3.bucket.aws.s3.bucket.object-api                                                                                       | implemented     | [1,16,64]                  | {"success":false,"findings":["aws.eventing.finding.permission-prerequisite"]} | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                                                                                     |
| aws.rds.instance-uses-parameter-group                            | aws.rds.db-parameter-group.aws.rds.db-parameter-group.instance → aws.rds.db-instance.aws.rds.db-instance.parameter-group                                                          | implemented     | [1,128,1]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded"]                                                           |
| aws.rds.instance-uses-security-group                             | aws.rds.db-instance.aws.rds.db-instance.security-group → aws.ec2.security-group.aws.ec2.security-group.rds-instance                                                               | implemented     | [1,5,128]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                                                                                     |
| aws.rds.instance-uses-subnet-group                               | aws.rds.db-subnet-group.aws.rds.db-subnet-group.instance → aws.rds.db-instance.aws.rds.db-instance.subnet-group                                                                   | implemented     | [1,128,1]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded"]                                                           |
| aws.rds.subnet-group-uses-subnet                                 | aws.rds.db-subnet-group.aws.rds.db-subnet-group.subnet → aws.ec2.subnet.aws.ec2.subnet.rds-subnet-group                                                                           | implemented     | [1,16,128]                 | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                                                                                     |
| aws.region.contains-vpc                                          | aws.region.boundary.aws.region.boundary.vpc-placement → aws.ec2.vpc.aws.ec2.vpc.region                                                                                            | not-implemented | [1,100,1]                  | {"success":false,"findings":["cloudmarkup.connection.rule-not-implemented"]}  | ["cloudmarkup.connection.rule-not-implemented","cloudmarkup.connection.catalog-mismatch"]                                                                                                                                                                                                                                                                                                                                  |
| aws.s3.bucket-notifies-lambda                                    | aws.s3.bucket.aws.s3.bucket.notifications → aws.lambda.function.aws.lambda.function.asynchronous-invocation                                                                       | implemented     | [1,64,64]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                                                                                     |
| aws.s3.bucket-owns-cors-configuration                            | aws.s3.bucket-cors-configuration.aws.s3.bucket-cors-configuration.bucket → aws.s3.bucket.aws.s3.bucket.cors-configuration                                                         | implemented     | [1,1,1]                    | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded"] |
| aws.s3.bucket-owns-lifecycle-configuration                       | aws.s3.bucket-lifecycle-configuration.aws.s3.bucket-lifecycle-configuration.bucket → aws.s3.bucket.aws.s3.bucket.lifecycle-configuration                                          | implemented     | [1,1,1]                    | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded"] |
| aws.s3.bucket-owns-notification-configuration                    | aws.s3.bucket-notification-configuration.aws.s3.bucket-notification-configuration.bucket → aws.s3.bucket.aws.s3.bucket.notification-configuration                                 | implemented     | [1,1,100]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                           |
| aws.s3.bucket-owns-resource-policy                               | aws.iam.policy-document.aws.iam.policy-document.s3-bucket-resource-policy → aws.s3.bucket.aws.s3.bucket.resource-policy                                                           | implemented     | [1,1,1]                    | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded"] |
| aws.s3.bucket-sends-events-to-eventbridge                        | aws.s3.bucket.aws.s3.bucket.eventbridge → aws.eventbridge.event-bus.aws.eventbridge.event-bus.aws-service-events                                                                  | implemented     | [1,1,1000]                 | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                           |
| aws.sns.subscription-invokes-lambda                              | aws.sns.subscription.aws.sns.subscription.lambda-delivery → aws.lambda.function.aws.lambda.function.asynchronous-invocation                                                       | implemented     | [1,1,64]                   | {"success":false,"findings":["aws.eventing.finding.permission-prerequisite"]} | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                           |
| aws.sns.subscription-sends-to-sqs                                | aws.sns.subscription.aws.sns.subscription.queue-delivery → aws.sqs.queue.aws.sqs.queue.message-send                                                                               | implemented     | [1,1,100]                  | {"success":false,"findings":["aws.eventing.finding.permission-prerequisite"]} | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                           |
| aws.sns.topic-owns-resource-policy                               | aws.iam.policy-document.aws.iam.policy-document.sns-topic-resource-policy → aws.sns.topic.aws.sns.topic.resource-policy                                                           | implemented     | [1,1,1]                    | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded"] |
| aws.sns.topic-owns-subscription                                  | aws.sns.topic.aws.sns.topic.subscriptions → aws.sns.subscription.aws.sns.subscription.topic                                                                                       | implemented     | [1,100,1]                  | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded"]                                                           |
| aws.sqs.queue-owns-redrive-configuration                         | aws.sqs.redrive-configuration.aws.sqs.redrive-configuration.queue → aws.sqs.queue.aws.sqs.queue.redrive-configuration                                                             | implemented     | [1,1,1]                    | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded"] |
| aws.sqs.queue-owns-resource-policy                               | aws.iam.policy-document.aws.iam.policy-document.sqs-queue-resource-policy → aws.sqs.queue.aws.sqs.queue.resource-policy                                                           | implemented     | [1,1,1]                    | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.target-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded"] |
| aws.sqs.queue-triggers-lambda                                    | aws.sqs.queue.aws.sqs.queue.event-source → aws.lambda.function.aws.lambda.function.event-source                                                                                   | implemented     | [1,32,32]                  | {"success":false,"findings":["aws.eventing.finding.permission-prerequisite"]} | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                                                                                     |
| aws.sqs.queue-uses-dead-letter-queue                             | aws.sqs.queue.aws.sqs.queue.redrive → aws.sqs.queue.aws.sqs.queue.dead-letter-target                                                                                              | implemented     | [1,1,10]                   | {"success":true,"findings":[]}                                                | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.source-port-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                                                                          |
| aws.stepfunctions.state-machine-invokes-lambda                   | aws.stepfunctions.state-machine.aws.stepfunctions.state-machine.lambda-task → aws.lambda.function.aws.lambda.function.synchronous-invocation                                      | implemented     | [16,64,64]                 | {"success":false,"findings":["aws.eventing.finding.permission-prerequisite"]} | ["cloudmarkup.connection.invalid-port","cloudmarkup.connection.unsupported-direction","cloudmarkup.connection.catalog-mismatch","cloudmarkup.connection.endpoint-pair-cardinality-exceeded","cloudmarkup.connection.source-cardinality-exceeded","cloudmarkup.connection.target-cardinality-exceeded"]                                                                                                                     |

The matrix retains every relationship and its observed success/negative-evidence
summary. Expanded implementation/configuration/lifecycle copies belong to the
[catalog artifact](../../packages/provider-aws/src/compiled/catalog-v1.json);
the immutable full review (private historical evidence, omitted from this
distribution) retains the complete per-probe JSON. The purpose, bounds and
source references below are unchanged historical review records, not new
execution authority.

### `aws.acm.certificate-validates-in-zone`

Exact rule `1.0.0`;
`{"portId":"aws.acm.public-dns-certificate.validation-zone","serviceId":"aws.acm.public-dns-certificate"}`
→
`{"portId":"aws.route53.public-hosted-zone.certificate","serviceId":"aws.route53.public-hosted-zone"}`.
Max endpoint pair/source/target `[1,1,128]`. Bind one exact caller-attested
public zone for managed certificate DNS validation; no registrar delegation or
live DNS activity occurs. Exact versioned empty binding, endpoints and bounded
cardinality; native typed references only. Provisioning and external authority
remain independent.

Primary references:
[Public DNS certificate](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-certificatemanager-certificate.html),
[CloudFront viewer certificate Region](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html),
[Public hosted zone](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-route53-hostedzone.html).
Source/tests: `packages/provider-aws/src/catalog/services/dns-acm.ts`,
`packages/provider-aws/src/cloudfront.test.ts`,
`packages/provider-aws/src/dns-acm.test.ts`, `services/iac-compiler/dns_acm.go`.

### `aws.apigateway.http-api-invokes-lambda`

Exact rule `1.0.0`;
`{"portId":"aws.apigateway.http-api.invocation","serviceId":"aws.apigateway.http-api"}`
→
`{"portId":"aws.lambda.function.synchronous-invocation","serviceId":"aws.lambda.function"}`.
Max endpoint pair/source/target `[8,32,8]`. This connection makes the Lambda
function the handler for a specific notes API route and previews the required
invoke permission. The resolver emits one version-bound integration edge. The
future compiler will materialize API Gateway v2 route/integration resources and
a resource-scoped Lambda permission.

Primary references:
[Lambda integrations for HTTP APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html).
Source/tests: `apps/web/src/features/editor/model/connection-workflow.test.ts`,
`apps/web/src/features/editor/model/provider-catalog-adapter.test.ts`,
`packages/provider-aws/src/catalog/connections/notes-api-connections.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`packages/provider-aws/src/event-driven-catalog.test.ts`,
`packages/provider-aws/src/validation.test.ts`.

### `aws.aurora.cluster-has-instance`

Exact rule `1.0.0`;
`{"portId":"aws.aurora.postgresql-cluster.instance","serviceId":"aws.aurora.postgresql-cluster"}`
→
`{"portId":"aws.aurora.postgresql-instance.cluster","serviceId":"aws.aurora.postgresql-instance"}`.
Max endpoint pair/source/target `[1,2,1]`. Connect reviewed database
networking/configuration. No ingress, credentials, permission or runtime health
is inferred. Exact versioned empty binding, endpoints and bounded cardinality;
native typed references only. Provisioning and external authority remain
independent.

Primary references:
[RDS-managed master credentials](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-secrets-manager.html),
[Aurora PostgreSQL DB cluster](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-rds-dbcluster.html).
Source/tests: `packages/provider-aws/src/aurora-postgres.test.ts`,
`packages/provider-aws/src/catalog/services/aurora-postgres.ts`,
`services/iac-compiler/aurora.go`.

### `aws.aurora.cluster-uses-parameter-group`

Exact rule `1.0.0`;
`{"portId":"aws.aurora.postgresql-cluster-parameter-group.cluster","serviceId":"aws.aurora.postgresql-cluster-parameter-group"}`
→
`{"portId":"aws.aurora.postgresql-cluster.parameter-group","serviceId":"aws.aurora.postgresql-cluster"}`.
Max endpoint pair/source/target `[1,128,1]`. Connect reviewed database
networking/configuration. No ingress, credentials, permission or runtime health
is inferred. Exact versioned empty binding, endpoints and bounded cardinality;
native typed references only. Provisioning and external authority remain
independent.

Primary references:
[RDS-managed master credentials](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-secrets-manager.html),
[Aurora PostgreSQL DB cluster](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-rds-dbcluster.html).
Source/tests: `packages/provider-aws/src/catalog/services/aurora-postgres.ts`,
`services/iac-compiler/aurora.go`.

### `aws.aurora.cluster-uses-security-group`

Exact rule `1.0.0`;
`{"portId":"aws.aurora.postgresql-cluster.security-group","serviceId":"aws.aurora.postgresql-cluster"}`
→
`{"portId":"aws.ec2.security-group.aurora-cluster","serviceId":"aws.ec2.security-group"}`.
Max endpoint pair/source/target `[1,5,128]`. Connect reviewed database
networking/configuration. No ingress, credentials, permission or runtime health
is inferred. Exact versioned empty binding, endpoints and bounded cardinality;
native typed references only. Provisioning and external authority remain
independent.

Primary references:
[RDS-managed master credentials](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-secrets-manager.html),
[Aurora PostgreSQL DB cluster](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-rds-dbcluster.html).
Source/tests: `packages/provider-aws/src/catalog/services/aurora-postgres.ts`,
`services/iac-compiler/aurora.go`.

### `aws.aurora.cluster-uses-subnet-group`

Exact rule `1.0.0`;
`{"portId":"aws.rds.db-subnet-group.aurora-cluster","serviceId":"aws.rds.db-subnet-group"}`
→
`{"portId":"aws.aurora.postgresql-cluster.subnet-group","serviceId":"aws.aurora.postgresql-cluster"}`.
Max endpoint pair/source/target `[1,128,1]`. Connect reviewed database
networking/configuration. No ingress, credentials, permission or runtime health
is inferred. Exact versioned empty binding, endpoints and bounded cardinality;
native typed references only. Provisioning and external authority remain
independent.

Primary references:
[RDS-managed master credentials](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-secrets-manager.html),
[Aurora PostgreSQL DB cluster](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-rds-dbcluster.html).
Source/tests: `packages/provider-aws/src/catalog/services/aurora-postgres.ts`,
`services/iac-compiler/aurora.go`.

### `aws.cloudfront.alias-uses-certificate`

Exact rule `1.0.0`;
`{"portId":"aws.cloudfront.alias-configuration.certificate","serviceId":"aws.cloudfront.alias-configuration"}`
→
`{"portId":"aws.acm.public-dns-certificate.cloudfront-alias","serviceId":"aws.acm.public-dns-certificate"}`.
Max endpoint pair/source/target `[1,1,1]`. Bind exact private S3/cache/owned
alias dependencies. The private origin connection generates only read-only
exact-bucket/distribution-qualified policy. Exact versioned empty binding,
endpoints and bounded cardinality; native typed references only. Provisioning
and external authority remain independent.

Primary references:
[CloudFront distribution](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-cloudfront-distribution.html),
[Private S3 origin access](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html),
[Viewer certificate requirements](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html).
Source/tests: `packages/provider-aws/src/catalog/services/cloudfront.ts`,
`services/iac-compiler/cloudfront.go`.

### `aws.cloudfront.distribution-owns-alias`

Exact rule `1.0.0`;
`{"portId":"aws.cloudfront.alias-configuration.distribution","serviceId":"aws.cloudfront.alias-configuration"}`
→
`{"portId":"aws.cloudfront.distribution.alias","serviceId":"aws.cloudfront.distribution"}`.
Max endpoint pair/source/target `[1,1,1]`. Bind exact private S3/cache/owned
alias dependencies. The private origin connection generates only read-only
exact-bucket/distribution-qualified policy. Exact versioned empty binding,
endpoints and bounded cardinality; native typed references only. Provisioning
and external authority remain independent.

Primary references:
[CloudFront distribution](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-cloudfront-distribution.html),
[Private S3 origin access](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html),
[Viewer certificate requirements](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html).
Source/tests:
`apps/web/src/features/editor/model/cloudfront-service-setup.test.ts`,
`packages/provider-aws/src/catalog/services/cloudfront.ts`,
`services/iac-compiler/cloudfront.go`.

### `aws.cloudfront.reads-s3-origin`

Exact rule `1.0.0`;
`{"portId":"aws.cloudfront.distribution.s3-origin","serviceId":"aws.cloudfront.distribution"}`
→ `{"portId":"aws.s3.bucket.cloudfront-origin","serviceId":"aws.s3.bucket"}`.
Max endpoint pair/source/target `[1,1,1]`. Bind exact private S3/cache/owned
alias dependencies. The private origin connection generates only read-only
exact-bucket/distribution-qualified policy. Exact versioned empty binding,
endpoints and bounded cardinality; native typed references only. Provisioning
and external authority remain independent.

Primary references:
[CloudFront distribution](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-cloudfront-distribution.html),
[Private S3 origin access](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html),
[Viewer certificate requirements](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/cloudfront-connections.ts`,
`packages/provider-aws/src/catalog/services/cloudfront.ts`,
`packages/provider-aws/src/cloudfront.test.ts`,
`services/iac-compiler/cloudfront.go`.

### `aws.cloudfront.uses-cache-policy`

Exact rule `1.0.0`;
`{"portId":"aws.cloudfront.distribution.cache-policy","serviceId":"aws.cloudfront.distribution"}`
→
`{"portId":"aws.cloudfront.cache-policy.distribution","serviceId":"aws.cloudfront.cache-policy"}`.
Max endpoint pair/source/target `[1,1,128]`. Bind exact private S3/cache/owned
alias dependencies. The private origin connection generates only read-only
exact-bucket/distribution-qualified policy. Exact versioned empty binding,
endpoints and bounded cardinality; native typed references only. Provisioning
and external authority remain independent.

Primary references:
[CloudFront distribution](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-cloudfront-distribution.html),
[Private S3 origin access](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html),
[Viewer certificate requirements](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html).
Source/tests: `packages/provider-aws/src/catalog/services/cloudfront.ts`,
`services/iac-compiler/cloudfront.go`.

### `aws.cognito.app-client-authorizes-http-api`

Exact rule `1.0.0`;
`{"portId":"aws.cognito.user-pool-client.jwt-audience","serviceId":"aws.cognito.user-pool-client"}`
→
`{"portId":"aws.apigateway.http-api.jwt-audience","serviceId":"aws.apigateway.http-api"}`.
Max endpoint pair/source/target `[1,100,1]`. API Gateway accepts tokens only
when they were created for this secretless notes app client. The resolver adds
the typed audience relationship without accepting a pasted client ID or client
secret.

Primary references:
[JWT authorizer workflow](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/notes-api-connections.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`packages/provider-aws/src/validation.test.ts`.

### `aws.cognito.user-pool-authorizes-http-api`

Exact rule `1.0.0`;
`{"portId":"aws.cognito.user-pool.jwt-issuer","serviceId":"aws.cognito.user-pool"}`
→
`{"portId":"aws.apigateway.http-api.jwt-issuer","serviceId":"aws.apigateway.http-api"}`.
Max endpoint pair/source/target `[1,100,1]`. API Gateway checks that bearer
tokens came from this user pool before the notes function is invoked. The
relationship supplies the user-pool issuer to an API Gateway v2 JWT authorizer;
a separate app-client edge supplies the audience.

Primary references:
[Control access to HTTP APIs with JWT authorizers](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/notes-api-connections.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`packages/provider-aws/src/validation.test.ts`.

### `aws.cognito.user-pool-configures-app-client`

Exact rule `1.0.0`;
`{"portId":"aws.cognito.user-pool.app-client-parent","serviceId":"aws.cognito.user-pool"}`
→
`{"portId":"aws.cognito.user-pool-client.user-pool","serviceId":"aws.cognito.user-pool-client"}`.
Max endpoint pair/source/target `[1,100,1]`. The app client belongs to this user
directory and cannot exist at the catalog root. This relationship supplies
UserPoolId and matches the required semantic parent relationship.

Primary references:
[User pool app clients](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-client-apps.html).
Source/tests: `apps/web/src/features/editor/model/connection-workflow.test.ts`,
`packages/provider-aws/src/catalog/connections/notes-api-connections.ts`,
`packages/provider-aws/src/validation.test.ts`.

### `aws.ebs.attachment-uses-instance`

Exact rule `1.0.0`;
`{"portId":"aws.ebs.volume-attachment.instance","serviceId":"aws.ebs.volume-attachment"}`
→ `{"portId":"aws.ec2.instance.data-volume","serviceId":"aws.ec2.instance"}`.
Max endpoint pair/source/target `[1,1,4]`. Bind exact EBS AZ, volume owner,
same-AZ EC2 instance and selected KMS key. No IAM or guest preparation is
generated. Exact versioned empty binding, endpoints and bounded cardinality;
native typed references only. Provisioning and external authority remain
independent.

Primary references:
[Linux EC2 device naming](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/device_naming.html),
[EBS native volume](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-volume.html).
Source/tests: `packages/provider-aws/src/catalog/services/ebs.ts`,
`services/iac-compiler/ebs.go`.

### `aws.ebs.availability-zone-contains-volume`

Exact rule `1.0.0`;
`{"portId":"aws.ebs.volume.availability-zone","serviceId":"aws.ebs.volume"}` →
`{"portId":"aws.ec2.availability-zone.ebs-volume","serviceId":"aws.ec2.availability-zone"}`.
Max endpoint pair/source/target `[1,1,128]`. Bind exact EBS AZ, volume owner,
same-AZ EC2 instance and selected KMS key. No IAM or guest preparation is
generated. Exact versioned empty binding, endpoints and bounded cardinality;
native typed references only. Provisioning and external authority remain
independent.

Primary references:
[Linux EC2 device naming](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/device_naming.html),
[EBS native volume](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-volume.html).
Source/tests: `packages/provider-aws/src/catalog/services/ebs.ts`,
`packages/provider-aws/src/ebs.test.ts`, `services/iac-compiler/ebs.go`.

### `aws.ebs.volume-owns-attachment`

Exact rule `1.0.0`;
`{"portId":"aws.ebs.volume-attachment.volume","serviceId":"aws.ebs.volume-attachment"}`
→ `{"portId":"aws.ebs.volume.attachment","serviceId":"aws.ebs.volume"}`. Max
endpoint pair/source/target `[1,1,1]`. Bind exact EBS AZ, volume owner, same-AZ
EC2 instance and selected KMS key. No IAM or guest preparation is generated.
Exact versioned empty binding, endpoints and bounded cardinality; native typed
references only. Provisioning and external authority remain independent.

Primary references:
[Linux EC2 device naming](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/device_naming.html),
[EBS native volume](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-volume.html).
Source/tests: `packages/provider-aws/src/catalog/services/ebs.ts`,
`packages/provider-aws/src/ebs.test.ts`, `services/iac-compiler/ebs.go`.

### `aws.ebs.volume-uses-key`

Exact rule `1.0.0`;
`{"portId":"aws.ebs.volume.encryption-key","serviceId":"aws.ebs.volume"}` →
`{"portId":"aws.kms.key.ebs-volume","serviceId":"aws.kms.key"}`. Max endpoint
pair/source/target `[1,1,128]`. Bind exact EBS AZ, volume owner, same-AZ EC2
instance and selected KMS key. No IAM or guest preparation is generated. Exact
versioned empty binding, endpoints and bounded cardinality; native typed
references only. Provisioning and external authority remain independent.

Primary references:
[Linux EC2 device naming](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/device_naming.html),
[EBS native volume](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-volume.html).
Source/tests: `packages/provider-aws/src/catalog/services/ebs.ts`,
`packages/provider-aws/src/ebs.test.ts`, `services/iac-compiler/ebs.go`.

### `aws.ec2.availability-zone-contains-subnet`

Exact rule `1.0.0`;
`{"portId":"aws.ec2.availability-zone.subnet-placement","serviceId":"aws.ec2.availability-zone"}`
→ `{"portId":"aws.ec2.subnet.availability-zone","serviceId":"aws.ec2.subnet"}`.
Max endpoint pair/source/target `[1,100,1]`. Choose the one Availability Zone
for this subnet. Public or private intent comes from its access tier and
reviewed routes, not from the visual boundary alone. Records the subnet's
exclusive zone parent; deterministic validation checks Region, VPC ancestry,
CIDR overlap, and routing posture separately.

Primary references:
[Configure subnets](https://docs.aws.amazon.com/vpc/latest/userguide/configure-subnets.html).
Source/tests:
`apps/web/src/features/editor/model/aws-networking-placement.test.ts`,
`packages/provider-aws/src/catalog/connections/networking-connections.ts`,
`packages/provider-aws/src/catalog/services/subnet.ts`,
`packages/provider-aws/src/ec2-compute.test.ts`,
`packages/provider-aws/src/networking-catalog.test.ts`,
`packages/provider-aws/src/networking-validation.test.ts`,
`packages/provider-aws/src/rds-postgres.test.ts`,
`services/iac-compiler/ec2_test.go`, `services/iac-compiler/elb.go`,
`services/iac-compiler/elb_test.go`, `services/iac-compiler/rds_test.go`,
`services/iac-compiler/terraform_networking.go`,
`services/iac-compiler/terraform_networking_test.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.ec2.gateway-endpoint-associates-route-table`

Exact rule `1.0.0`;
`{"portId":"aws.ec2.gateway-vpc-endpoint.route-table-association","serviceId":"aws.ec2.gateway-vpc-endpoint"}`
→
`{"portId":"aws.ec2.route-table.gateway-endpoint-association","serviceId":"aws.ec2.route-table"}`.
Max endpoint pair/source/target `[1,100,16]`. Choose every route table whose
subnets should use this gateway endpoint. The managed service stays outside the
VPC while eligible traffic uses the endpoint route. Adds one exact
endpoint-to-route-table association edge; endpoint service identity and same-VPC
ancestry remain node and validation facts.

Primary references:
[Gateway endpoints](https://docs.aws.amazon.com/vpc/latest/privatelink/gateway-endpoints.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/networking-connections.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`packages/provider-aws/src/networking-catalog.test.ts`,
`packages/provider-aws/src/networking-validation.test.ts`,
`services/iac-compiler/cloudformation_networking.go`,
`services/iac-compiler/terraform_networking.go`,
`services/iac-compiler/terraform_networking_test.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.ec2.gateway-endpoint-owns-policy`

Exact rule `1.0.0`;
`{"portId":"aws.iam.policy-document.gateway-endpoint-resource-policy","serviceId":"aws.iam.policy-document"}`
→
`{"portId":"aws.ec2.gateway-vpc-endpoint.resource-policy","serviceId":"aws.ec2.gateway-vpc-endpoint"}`.
Max endpoint pair/source/target `[1,1,1]`. Use an endpoint policy only when you
need to narrow which S3 or DynamoDB actions and resources may use this endpoint.
Review it like any other resource policy. Binds at most one user-owned canonical
resource policy document to the endpoint; policy validation remains separate
from route-table association.

Primary references:
[Control access to VPC endpoints using endpoint policies](https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-access.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/networking-connections.ts`,
`packages/provider-aws/src/catalog/services/iam-policy-document.ts`,
`packages/provider-aws/src/networking-catalog.test.ts`,
`packages/provider-aws/src/networking-policy.test.ts`,
`packages/provider-aws/src/networking-validation.test.ts`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_networking.go`,
`services/iac-compiler/terraform_networking_test.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.ec2.instance-uses-security-group`

Exact rule `1.0.0`;
`{"portId":"aws.ec2.instance.security-group","serviceId":"aws.ec2.instance"}` →
`{"portId":"aws.ec2.security-group.instance","serviceId":"aws.ec2.security-group"}`.
Max endpoint pair/source/target `[1,5,128]`. Connect existing reviewed
resources. This connection adds no role, trust, permissions, network rules or
application behavior. The exact empty versioned binding supplies an explicit
native resource reference. Same-VPC, role trust, image and key readiness are
separately validated; a connection cannot prove deployment/PassRole/key
authority.

Primary references:
[AMI identity and compatibility](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/AMIs.html),
[EC2 instance properties and replacement](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-instance.html),
[EC2 instance profile](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-iam-instanceprofile.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/ec2-connections.ts`,
`packages/provider-aws/src/ec2-compute.test.ts`, `services/iac-compiler/ec2.go`.

### `aws.ec2.instance-uses-subnet`

Exact rule `1.0.0`;
`{"portId":"aws.ec2.instance.subnet","serviceId":"aws.ec2.instance"}` →
`{"portId":"aws.ec2.subnet.instance","serviceId":"aws.ec2.subnet"}`. Max
endpoint pair/source/target `[1,1,128]`. Connect existing reviewed resources.
This connection adds no role, trust, permissions, network rules or application
behavior. The exact empty versioned binding supplies an explicit native resource
reference. Same-VPC, role trust, image and key readiness are separately
validated; a connection cannot prove deployment/PassRole/key authority.

Primary references:
[AMI identity and compatibility](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/AMIs.html),
[EC2 instance properties and replacement](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-instance.html),
[EC2 instance profile](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-iam-instanceprofile.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/ec2-connections.ts`,
`packages/provider-aws/src/ec2-compute.test.ts`, `services/iac-compiler/ec2.go`.

### `aws.ec2.route-table-association-targets-subnet`

Exact rule `1.0.0`;
`{"portId":"aws.ec2.route-table-association.subnet","serviceId":"aws.ec2.route-table-association"}`
→
`{"portId":"aws.ec2.subnet.route-table-association","serviceId":"aws.ec2.subnet"}`.
Max endpoint pair/source/target `[1,1,1]`. Choose the one subnet controlled by
this association. The route table owner and subnet target must belong to the
same VPC. Adds the direct association-target edge only; node-owned configuration
stores no duplicate subnet or route-table identifier.

Primary references:
[Route tables](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Route_Tables.html).
Source/tests: `apps/web/src/features/editor/model/connection-workflow.test.ts`,
`packages/provider-aws/src/catalog/connections/networking-connections.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`packages/provider-aws/src/networking-catalog.test.ts`,
`packages/provider-aws/src/networking-validation.test.ts`,
`services/iac-compiler/cloudformation_networking.go`,
`services/iac-compiler/ec2_test.go`, `services/iac-compiler/elb_render.go`,
`services/iac-compiler/elb_test.go`, `services/iac-compiler/rds_test.go`,
`services/iac-compiler/terraform_networking.go`,
`services/iac-compiler/terraform_networking_test.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.ec2.route-table-owns-route`

Exact rule `1.0.0`;
`{"portId":"aws.ec2.route.route-table","serviceId":"aws.ec2.route"}` →
`{"portId":"aws.ec2.route-table.route","serviceId":"aws.ec2.route-table"}`. Max
endpoint pair/source/target `[1,1,100]`. Add routes from the route table's
Routes menu. Each route keeps its destination and selected internet or NAT
target together for review. Binds a graph-backed route configuration to one
route-table slot with user/generated lifecycle, exact target edges, and
adoption-before-customization semantics.

Primary references:
[Route tables](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Route_Tables.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/networking-connections.ts`,
`packages/provider-aws/src/catalog/services/route.ts`,
`packages/provider-aws/src/networking-catalog.test.ts`,
`packages/provider-aws/src/networking-policy.test.ts`,
`packages/provider-aws/src/networking-validation.test.ts`,
`services/iac-compiler/cloudformation_networking.go`,
`services/iac-compiler/elb_render.go`, `services/iac-compiler/elb_test.go`,
`services/iac-compiler/terraform_networking.go`,
`services/iac-compiler/terraform_networking_test.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.ec2.route-table-owns-subnet-association`

Exact rule `1.0.0`;
`{"portId":"aws.ec2.route-table-association.route-table","serviceId":"aws.ec2.route-table-association"}`
→
`{"portId":"aws.ec2.route-table.subnet-association","serviceId":"aws.ec2.route-table"}`.
Max endpoint pair/source/target `[1,1,100]`. Associate every supported subnet
explicitly. This keeps its selected route table visible instead of relying on an
unseen main route table. Binds a route-table-association configuration to one
owner slot; a separate exact edge identifies its one subnet target.

Primary references:
[Route tables](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Route_Tables.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/networking-connections.ts`,
`packages/provider-aws/src/catalog/services/route-table-association.ts`,
`packages/provider-aws/src/networking-catalog.test.ts`,
`packages/provider-aws/src/networking-validation.test.ts`,
`services/iac-compiler/cloudformation_networking.go`,
`services/iac-compiler/ec2_test.go`, `services/iac-compiler/elb_render.go`,
`services/iac-compiler/elb_test.go`, `services/iac-compiler/rds_test.go`,
`services/iac-compiler/terraform_networking.go`,
`services/iac-compiler/terraform_networking_test.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.ec2.route-targets-internet-gateway`

Exact rule `1.0.0`;
`{"portId":"aws.ec2.route.internet-gateway-target","serviceId":"aws.ec2.route"}`
→
`{"portId":"aws.ec2.internet-gateway.route-target","serviceId":"aws.ec2.internet-gateway"}`.
Max endpoint pair/source/target `[1,1,100]`. Use this target for a public route
only when the route table, subnet, gateway, and VPC all agree. A default route
is visible and never inferred. Adds the direct route-target edge; destination
CIDR remains on the route node and same-VPC attachment validation fails closed.

Primary references:
[Connect to the internet using an internet gateway](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/networking-connections.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`packages/provider-aws/src/elb.test.ts`,
`packages/provider-aws/src/networking-catalog.test.ts`,
`packages/provider-aws/src/networking-validation.test.ts`,
`services/iac-compiler/cloudformation_networking.go`,
`services/iac-compiler/elb_render.go`, `services/iac-compiler/elb_test.go`,
`services/iac-compiler/terraform_networking.go`,
`services/iac-compiler/terraform_networking_test.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.ec2.route-targets-nat-gateway`

Exact rule `1.0.0`;
`{"portId":"aws.ec2.route.nat-gateway-target","serviceId":"aws.ec2.route"}` →
`{"portId":"aws.ec2.nat-gateway.route-target","serviceId":"aws.ec2.nat-gateway"}`.
Max endpoint pair/source/target `[1,1,100]`. Use a NAT target when a private
subnet needs outbound IPv4 access that a gateway endpoint cannot provide. Prefer
a NAT in the same Availability Zone. Adds the direct route-target edge;
validators enforce private routing intent, public NAT placement, same VPC, and
cross-zone cost warnings.

Primary references:
[NAT gateway basics](https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-basics.html).
Source/tests:
`apps/web/src/features/editor/model/architecture-presentation-projection.test.ts`,
`packages/provider-aws/src/catalog/connections/networking-connections.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`packages/provider-aws/src/networking-catalog.test.ts`,
`packages/provider-aws/src/networking-validation.test.ts`,
`services/iac-compiler/cloudformation_networking.go`,
`services/iac-compiler/terraform_networking.go`,
`services/iac-compiler/terraform_networking_test.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.ec2.security-group-owns-egress-rule`

Exact rule `1.0.0`;
`{"portId":"aws.ec2.security-group-egress-rule.security-group","serviceId":"aws.ec2.security-group-egress-rule"}`
→
`{"portId":"aws.ec2.security-group.egress-rule","serviceId":"aws.ec2.security-group"}`.
Max endpoint pair/source/target `[1,1,100]`. Keep outbound access as narrow as
the workload allows. Review protocol, port range, and destination under the
security group's policy details. Binds one graph-backed egress policy
configuration to its security group with explicit lifecycle and deterministic
CIDR/protocol/port validation.

Primary references:
[Control traffic to your AWS resources using security groups](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/networking-connections.ts`,
`packages/provider-aws/src/catalog/services/security-group-egress-rule.ts`,
`packages/provider-aws/src/networking-catalog.test.ts`,
`packages/provider-aws/src/networking-policy.test.ts`,
`packages/provider-aws/src/networking-validation.test.ts`,
`services/iac-compiler/cloudformation_curated_test.go`,
`services/iac-compiler/cloudformation_networking.go`,
`services/iac-compiler/elb.go`, `services/iac-compiler/terraform_networking.go`,
`services/iac-compiler/terraform_networking_test.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.ec2.security-group-owns-ingress-rule`

Exact rule `1.0.0`;
`{"portId":"aws.ec2.security-group-ingress-rule.security-group","serviceId":"aws.ec2.security-group-ingress-rule"}`
→
`{"portId":"aws.ec2.security-group.ingress-rule","serviceId":"aws.ec2.security-group"}`.
Max endpoint pair/source/target `[1,1,100]`. Add only the inbound protocol, port
range, and source the workload needs. The security group is a policy
association, not a box that contains the workload. Binds one graph-backed
ingress policy configuration to its security group with explicit lifecycle,
bounded CIDR inputs, and deterministic rule validation.

Primary references:
[Control traffic to your AWS resources using security groups](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/networking-connections.ts`,
`packages/provider-aws/src/catalog/services/security-group-ingress-rule.ts`,
`packages/provider-aws/src/elb.test.ts`,
`packages/provider-aws/src/networking-catalog.test.ts`,
`packages/provider-aws/src/networking-policy.test.ts`,
`packages/provider-aws/src/networking-validation.test.ts`,
`services/iac-compiler/cloudformation_networking.go`,
`services/iac-compiler/elb.go`, `services/iac-compiler/elb_test.go`,
`services/iac-compiler/terraform_networking.go`,
`services/iac-compiler/terraform_networking_test.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.ec2.subnet-contains-nat-gateway`

Exact rule `1.0.0`;
`{"portId":"aws.ec2.subnet.nat-gateway-placement","serviceId":"aws.ec2.subnet"}`
→ `{"portId":"aws.ec2.nat-gateway.subnet","serviceId":"aws.ec2.nat-gateway"}`.
Max endpoint pair/source/target `[1,1,1]`. Place the NAT gateway in a public
subnet that can reach the internet gateway. Private subnets can then choose it
for outbound IPv4 access. Constrains the supported NAT posture to one zonal
public NAT per public subnet; public routing, allocation, same-VPC, and
cross-zone findings remain validator-owned.

Primary references:
[NAT gateway basics](https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-basics.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/networking-connections.ts`,
`packages/provider-aws/src/catalog/services/nat-gateway.ts`,
`packages/provider-aws/src/networking-catalog.test.ts`,
`packages/provider-aws/src/networking-validation.test.ts`,
`services/iac-compiler/terraform_networking.go`,
`services/iac-compiler/terraform_networking_test.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.ec2.vpc-associates-security-group`

Exact rule `1.0.0`;
`{"portId":"aws.ec2.vpc.security-group-association","serviceId":"aws.ec2.vpc"}`
→
`{"portId":"aws.ec2.security-group.vpc","serviceId":"aws.ec2.security-group"}`.
Max endpoint pair/source/target `[1,100,1]`. Associate the security group with
the VPC where its selected network interfaces will live. Workloads use it as
policy; they are never placed inside it. Adds the exact VPC scope edge with
one-VPC-per-group cardinality and no containment semantics for associated
workloads.

Primary references:
[Control traffic to your AWS resources using security groups](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html).
Source/tests:
`apps/web/src/features/editor/model/architecture-presentation-projection.test.ts`,
`packages/provider-aws/src/catalog/connections/networking-connections.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`packages/provider-aws/src/ec2-compute.test.ts`,
`packages/provider-aws/src/networking-catalog.test.ts`,
`packages/provider-aws/src/networking-validation.test.ts`,
`services/iac-compiler/aurora_topology_test.go`,
`services/iac-compiler/cloudformation_networking.go`,
`services/iac-compiler/ec2_test.go`, `services/iac-compiler/elb.go`,
`services/iac-compiler/elb_test.go`,
`services/iac-compiler/terraform_networking.go`,
`services/iac-compiler/terraform_networking_test.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.ec2.vpc-attaches-internet-gateway`

Exact rule `1.0.0`;
`{"portId":"aws.ec2.vpc.internet-gateway-attachment","serviceId":"aws.ec2.vpc"}`
→
`{"portId":"aws.ec2.internet-gateway.vpc-attachment","serviceId":"aws.ec2.internet-gateway"}`.
Max endpoint pair/source/target `[1,1,1]`. Attach the internet gateway to the
VPC before a public subnet route can use it. Attachment alone does not make any
subnet public. Adds the exact VPC attachment edge with one-to-one cardinality;
route-table validation separately proves public routing intent.

Primary references:
[Connect to the internet using an internet gateway](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/networking-connections.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`packages/provider-aws/src/networking-catalog.test.ts`,
`packages/provider-aws/src/networking-validation.test.ts`,
`services/iac-compiler/cloudformation_networking.go`,
`services/iac-compiler/elb_test.go`,
`services/iac-compiler/terraform_networking.go`,
`services/iac-compiler/terraform_networking_test.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.ec2.vpc-contains-availability-zone`

Exact rule `1.0.0`;
`{"portId":"aws.ec2.vpc.availability-zone-placement","serviceId":"aws.ec2.vpc"}`
→
`{"portId":"aws.ec2.availability-zone.vpc","serviceId":"aws.ec2.availability-zone"}`.
Max endpoint pair/source/target `[1,100,1]`. Use Availability Zone boundaries to
separate subnets that can continue operating when another zone has a problem.
Provides a deterministic VPC-to-zone placement parent used by subnet topology
validation; it does not claim that a VPC owns the AWS Availability Zone.

Primary references:
[AWS Regions and Availability Zones](https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions-availability-zones.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/networking-connections.ts`,
`packages/provider-aws/src/catalog/services/availability-zone.ts`,
`packages/provider-aws/src/ec2-compute.test.ts`,
`packages/provider-aws/src/networking-catalog.test.ts`,
`packages/provider-aws/src/networking-validation.test.ts`,
`services/iac-compiler/ebs.go`, `services/iac-compiler/ebs_rejection_test.go`,
`services/iac-compiler/ec2_test.go`, `services/iac-compiler/elb.go`,
`services/iac-compiler/elb_test.go`, `services/iac-compiler/rds_test.go`,
`services/iac-compiler/terraform_networking.go`,
`services/iac-compiler/terraform_networking_test.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.ec2.vpc-contains-gateway-endpoint`

Exact rule `1.0.0`;
`{"portId":"aws.ec2.vpc.gateway-endpoint-placement","serviceId":"aws.ec2.vpc"}`
→
`{"portId":"aws.ec2.gateway-vpc-endpoint.vpc","serviceId":"aws.ec2.gateway-vpc-endpoint"}`.
Max endpoint pair/source/target `[1,16,1]`. Add the endpoint to the VPC, then
choose the route tables that should reach S3 or DynamoDB without sending that
traffic through a NAT gateway. Binds the gateway endpoint's VPC scope while
preserving S3 and DynamoDB as managed services outside customer-controlled VPC
containment.

Primary references:
[Gateway endpoints](https://docs.aws.amazon.com/vpc/latest/privatelink/gateway-endpoints.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/networking-connections.ts`,
`packages/provider-aws/src/catalog/services/gateway-vpc-endpoint.ts`,
`packages/provider-aws/src/networking-catalog.test.ts`,
`packages/provider-aws/src/networking-validation.test.ts`,
`services/iac-compiler/terraform_networking.go`,
`services/iac-compiler/terraform_networking_test.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.ec2.vpc-contains-route-table`

Exact rule `1.0.0`;
`{"portId":"aws.ec2.vpc.route-table-placement","serviceId":"aws.ec2.vpc"}` →
`{"portId":"aws.ec2.route-table.vpc","serviceId":"aws.ec2.route-table"}`. Max
endpoint pair/source/target `[1,100,1]`. Keep the route table in the VPC whose
subnets it controls, then associate each subnet explicitly so no hidden
main-table behavior is assumed. Binds route-table VPC scope without implying a
subnet association; route and association configurations remain independently
reviewed graph facts.

Primary references:
[Route tables](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Route_Tables.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/networking-connections.ts`,
`packages/provider-aws/src/catalog/services/route-table.ts`,
`packages/provider-aws/src/networking-catalog.test.ts`,
`packages/provider-aws/src/networking-validation.test.ts`,
`services/iac-compiler/ec2_test.go`, `services/iac-compiler/elb_test.go`,
`services/iac-compiler/terraform_networking.go`,
`services/iac-compiler/terraform_networking_test.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.ecr.repository-owns-image`

Exact rule `1.0.0`;
`{"portId":"aws.ecr.image-reference.repository","serviceId":"aws.ecr.image-reference"}`
→ `{"portId":"aws.ecr.repository.image","serviceId":"aws.ecr.repository"}`. Max
endpoint pair/source/target `[1,1,64]`. Connect reviewed user-owned resources.
This binding creates no permissions, topology, image or running application.
Canonical versioned endpoints preserve exact native references and ownership.
Secret bindings declare only an environment name and external population status;
execution-role read authority remains an independent explicit policy.

Primary references:
[ECR repository native contract](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecr-repository.html),
[ECS task definition parameters](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html).
Source/tests: `packages/provider-aws/src/catalog/services/ecs-fargate.ts`,
`services/iac-compiler/ecs.go`.

### `aws.ecs.container-uses-image`

Exact rule `1.0.0`;
`{"portId":"aws.ecr.image-reference.container","serviceId":"aws.ecr.image-reference"}`
→
`{"portId":"aws.ecs.container-definition.image","serviceId":"aws.ecs.container-definition"}`.
Max endpoint pair/source/target `[1,128,1]`. Connect reviewed user-owned
resources. This binding creates no permissions, topology, image or running
application. Canonical versioned endpoints preserve exact native references and
ownership. Secret bindings declare only an environment name and external
population status; execution-role read authority remains an independent explicit
policy.

Primary references:
[ECR repository native contract](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecr-repository.html),
[ECS task definition parameters](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html).
Source/tests: `packages/provider-aws/src/catalog/services/ecs-fargate.ts`,
`services/iac-compiler/ecs.go`.

### `aws.ecs.container-uses-secret`

Exact rule `1.0.0`;
`{"portId":"aws.secretsmanager.secret.ecs-container","serviceId":"aws.secretsmanager.secret"}`
→
`{"portId":"aws.ecs.container-definition.secret","serviceId":"aws.ecs.container-definition"}`.
Max endpoint pair/source/target `[8,128,8]`. Connect reviewed user-owned
resources. This binding creates no permissions, topology, image or running
application. Canonical versioned endpoints preserve exact native references and
ownership. Secret bindings declare only an environment name and external
population status; execution-role read authority remains an independent explicit
policy.

Primary references:
[ECR repository native contract](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecr-repository.html),
[ECS task definition parameters](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/ecs-connections.ts`,
`packages/provider-aws/src/catalog/services/ecs-fargate.ts`,
`services/iac-compiler/ecs.go`.

### `aws.ecs.container-writes-logs`

Exact rule `1.0.0`;
`{"portId":"aws.ecs.container-definition.log-group","serviceId":"aws.ecs.container-definition"}`
→
`{"portId":"aws.cloudwatch.log-group.ecs-container","serviceId":"aws.cloudwatch.log-group"}`.
Max endpoint pair/source/target `[1,1,128]`. Connect reviewed user-owned
resources. This binding creates no permissions, topology, image or running
application. Canonical versioned endpoints preserve exact native references and
ownership. Secret bindings declare only an environment name and external
population status; execution-role read authority remains an independent explicit
policy.

Primary references:
[ECR repository native contract](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecr-repository.html),
[ECS task definition parameters](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html).
Source/tests: `packages/provider-aws/src/catalog/services/ecs-fargate.ts`,
`services/iac-compiler/ecs.go`.

### `aws.ecs.service-uses-cluster`

Exact rule `1.0.0`;
`{"portId":"aws.ecs.cluster.service","serviceId":"aws.ecs.cluster"}` →
`{"portId":"aws.ecs.service.cluster","serviceId":"aws.ecs.service"}`. Max
endpoint pair/source/target `[1,128,1]`. Connect reviewed user-owned resources.
This binding creates no permissions, topology, image or running application.
Canonical versioned endpoints preserve exact native references and ownership.
Secret bindings declare only an environment name and external population status;
execution-role read authority remains an independent explicit policy.

Primary references:
[ECR repository native contract](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecr-repository.html),
[ECS task definition parameters](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html).
Source/tests: `packages/provider-aws/src/catalog/services/ecs-fargate.ts`,
`services/iac-compiler/ecs.go`.

### `aws.ecs.service-uses-security-group`

Exact rule `1.0.0`;
`{"portId":"aws.ecs.service.security-group","serviceId":"aws.ecs.service"}` →
`{"portId":"aws.ec2.security-group.ecs-service","serviceId":"aws.ec2.security-group"}`.
Max endpoint pair/source/target `[1,5,128]`. Connect reviewed user-owned
resources. This binding creates no permissions, topology, image or running
application. Canonical versioned endpoints preserve exact native references and
ownership. Secret bindings declare only an environment name and external
population status; execution-role read authority remains an independent explicit
policy.

Primary references:
[ECR repository native contract](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecr-repository.html),
[ECS task definition parameters](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html).
Source/tests: `packages/provider-aws/src/catalog/services/ecs-fargate.ts`,
`services/iac-compiler/ecs.go`.

### `aws.ecs.service-uses-subnet`

Exact rule `1.0.0`;
`{"portId":"aws.ecs.service.subnet","serviceId":"aws.ecs.service"}` →
`{"portId":"aws.ec2.subnet.ecs-service","serviceId":"aws.ec2.subnet"}`. Max
endpoint pair/source/target `[1,16,128]`. Connect reviewed user-owned resources.
This binding creates no permissions, topology, image or running application.
Canonical versioned endpoints preserve exact native references and ownership.
Secret bindings declare only an environment name and external population status;
execution-role read authority remains an independent explicit policy.

Primary references:
[ECR repository native contract](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecr-repository.html),
[ECS task definition parameters](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html).
Source/tests: `packages/provider-aws/src/catalog/services/ecs-fargate.ts`,
`services/iac-compiler/ecs.go`.

### `aws.ecs.service-uses-task`

Exact rule `1.0.0`;
`{"portId":"aws.ecs.task-definition.service","serviceId":"aws.ecs.task-definition"}`
→ `{"portId":"aws.ecs.service.task","serviceId":"aws.ecs.service"}`. Max
endpoint pair/source/target `[1,128,1]`. Connect reviewed user-owned resources.
This binding creates no permissions, topology, image or running application.
Canonical versioned endpoints preserve exact native references and ownership.
Secret bindings declare only an environment name and external population status;
execution-role read authority remains an independent explicit policy.

Primary references:
[ECR repository native contract](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecr-repository.html),
[ECS task definition parameters](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html).
Source/tests: `packages/provider-aws/src/catalog/services/ecs-fargate.ts`,
`services/iac-compiler/ecs.go`.

### `aws.ecs.task-owns-container`

Exact rule `1.0.0`;
`{"portId":"aws.ecs.container-definition.task","serviceId":"aws.ecs.container-definition"}`
→
`{"portId":"aws.ecs.task-definition.container","serviceId":"aws.ecs.task-definition"}`.
Max endpoint pair/source/target `[1,1,1]`. Connect reviewed user-owned
resources. This binding creates no permissions, topology, image or running
application. Canonical versioned endpoints preserve exact native references and
ownership. Secret bindings declare only an environment name and external
population status; execution-role read authority remains an independent explicit
policy.

Primary references:
[ECR repository native contract](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecr-repository.html),
[ECS task definition parameters](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html).
Source/tests: `packages/provider-aws/src/catalog/services/ecs-fargate.ts`,
`services/iac-compiler/ecs.go`.

### `aws.ecs.task-uses-application-role`

Exact rule `1.0.0`;
`{"portId":"aws.iam.role.assumable-role","serviceId":"aws.iam.role"}` →
`{"portId":"aws.ecs.task-definition.application-role","serviceId":"aws.ecs.task-definition"}`.
Max endpoint pair/source/target `[1,1,1]`. Connect reviewed user-owned
resources. This binding creates no permissions, topology, image or running
application. Canonical versioned endpoints preserve exact native references and
ownership. Secret bindings declare only an environment name and external
population status; execution-role read authority remains an independent explicit
policy.

Primary references:
[ECR repository native contract](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecr-repository.html),
[ECS task definition parameters](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html).
Source/tests: `packages/provider-aws/src/catalog/services/ecs-fargate.ts`,
`services/iac-compiler/ecs.go`.

### `aws.ecs.task-uses-execution-role`

Exact rule `1.0.0`;
`{"portId":"aws.iam.role.assumable-role","serviceId":"aws.iam.role"}` →
`{"portId":"aws.ecs.task-definition.execution-role","serviceId":"aws.ecs.task-definition"}`.
Max endpoint pair/source/target `[1,1,1]`. Connect reviewed user-owned
resources. This binding creates no permissions, topology, image or running
application. Canonical versioned endpoints preserve exact native references and
ownership. Secret bindings declare only an environment name and external
population status; execution-role read authority remains an independent explicit
policy.

Primary references:
[ECR repository native contract](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecr-repository.html),
[ECS task definition parameters](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html).
Source/tests: `packages/provider-aws/src/catalog/services/ecs-fargate.ts`,
`services/iac-compiler/ecs.go`.

### `aws.elb.alb-owns-listener`

Exact rule `1.0.0`;
`{"portId":"aws.elb.https-listener.alb","serviceId":"aws.elb.https-listener"}` →
`{"portId":"aws.elb.application-load-balancer.listener","serviceId":"aws.elb.application-load-balancer"}`.
Max endpoint pair/source/target `[1,1,1]`. Bind exact ALB
network/listener/certificate/backend dependencies. No IAM or viewer ingress is
generated. Exact versioned empty binding, endpoints and bounded cardinality;
native typed references only. Provisioning and external authority remain
independent.

Primary references:
[ALB security group paths](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-update-security-groups.html),
[ALB native contract](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-loadbalancer.html),
[ECS ALB integration](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/alb.html),
[HTTPS listener](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-listener.html),
[ALB target group](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-targetgroup.html).
Source/tests: `apps/web/src/features/editor/model/elb-service-setup.test.ts`,
`packages/provider-aws/src/catalog/services/elb.ts`,
`services/iac-compiler/elb.go`.

### `aws.elb.alb-uses-security-group`

Exact rule `1.0.0`;
`{"portId":"aws.elb.application-load-balancer.security-group","serviceId":"aws.elb.application-load-balancer"}`
→
`{"portId":"aws.ec2.security-group.alb","serviceId":"aws.ec2.security-group"}`.
Max endpoint pair/source/target `[1,1,128]`. Bind exact ALB
network/listener/certificate/backend dependencies. No IAM or viewer ingress is
generated. Exact versioned empty binding, endpoints and bounded cardinality;
native typed references only. Provisioning and external authority remain
independent.

Primary references:
[ALB security group paths](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-update-security-groups.html),
[ALB native contract](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-loadbalancer.html),
[ECS ALB integration](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/alb.html),
[HTTPS listener](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-listener.html),
[ALB target group](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-targetgroup.html).
Source/tests: `packages/provider-aws/src/catalog/services/elb.ts`,
`services/iac-compiler/elb.go`.

### `aws.elb.alb-uses-subnet`

Exact rule `1.0.0`;
`{"portId":"aws.elb.application-load-balancer.subnet","serviceId":"aws.elb.application-load-balancer"}`
→ `{"portId":"aws.ec2.subnet.alb","serviceId":"aws.ec2.subnet"}`. Max endpoint
pair/source/target `[1,16,128]`. Bind exact ALB
network/listener/certificate/backend dependencies. No IAM or viewer ingress is
generated. Exact versioned empty binding, endpoints and bounded cardinality;
native typed references only. Provisioning and external authority remain
independent.

Primary references:
[ALB security group paths](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-update-security-groups.html),
[ALB native contract](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-loadbalancer.html),
[ECS ALB integration](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/alb.html),
[HTTPS listener](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-listener.html),
[ALB target group](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-targetgroup.html).
Source/tests: `packages/provider-aws/src/catalog/services/elb.ts`,
`services/iac-compiler/elb.go`.

### `aws.elb.alb-uses-vpc`

Exact rule `1.0.0`;
`{"portId":"aws.elb.application-load-balancer.vpc","serviceId":"aws.elb.application-load-balancer"}`
→ `{"portId":"aws.ec2.vpc.alb","serviceId":"aws.ec2.vpc"}`. Max endpoint
pair/source/target `[1,1,128]`. Bind exact ALB
network/listener/certificate/backend dependencies. No IAM or viewer ingress is
generated. Exact versioned empty binding, endpoints and bounded cardinality;
native typed references only. Provisioning and external authority remain
independent.

Primary references:
[ALB security group paths](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-update-security-groups.html),
[ALB native contract](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-loadbalancer.html),
[ECS ALB integration](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/alb.html),
[HTTPS listener](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-listener.html),
[ALB target group](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-targetgroup.html).
Source/tests: `packages/provider-aws/src/catalog/services/elb.ts`,
`services/iac-compiler/elb.go`.

### `aws.elb.backend-access-uses-alb-group`

Exact rule `1.0.0`;
`{"portId":"aws.elb.backend-access-configuration.alb-group","serviceId":"aws.elb.backend-access-configuration"}`
→
`{"portId":"aws.ec2.security-group.alb-access-source","serviceId":"aws.ec2.security-group"}`.
Max endpoint pair/source/target `[1,1,128]`. Bind exact ALB
network/listener/certificate/backend dependencies. No IAM or viewer ingress is
generated. Exact versioned empty binding, endpoints and bounded cardinality;
native typed references only. Provisioning and external authority remain
independent.

Primary references:
[ALB security group paths](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-update-security-groups.html),
[ALB native contract](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-loadbalancer.html),
[ECS ALB integration](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/alb.html),
[HTTPS listener](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-listener.html),
[ALB target group](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-targetgroup.html).
Source/tests: `packages/provider-aws/src/catalog/services/elb.ts`,
`services/iac-compiler/elb.go`.

### `aws.elb.backend-access-uses-target-group`

Exact rule `1.0.0`;
`{"portId":"aws.elb.backend-access-configuration.backend-group","serviceId":"aws.elb.backend-access-configuration"}`
→
`{"portId":"aws.ec2.security-group.alb-access-target","serviceId":"aws.ec2.security-group"}`.
Max endpoint pair/source/target `[1,1,128]`. Bind exact ALB
network/listener/certificate/backend dependencies. No IAM or viewer ingress is
generated. Exact versioned empty binding, endpoints and bounded cardinality;
native typed references only. Provisioning and external authority remain
independent.

Primary references:
[ALB security group paths](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-update-security-groups.html),
[ALB native contract](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-loadbalancer.html),
[ECS ALB integration](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/alb.html),
[HTTPS listener](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-listener.html),
[ALB target group](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-targetgroup.html).
Source/tests: `packages/provider-aws/src/catalog/services/elb.ts`,
`services/iac-compiler/elb.go`.

### `aws.elb.listener-forwards-to-target-group`

Exact rule `1.0.0`;
`{"portId":"aws.elb.https-listener.target-group","serviceId":"aws.elb.https-listener"}`
→
`{"portId":"aws.elb.target-group.listener","serviceId":"aws.elb.target-group"}`.
Max endpoint pair/source/target `[1,1,1]`. Bind exact ALB
network/listener/certificate/backend dependencies. No IAM or viewer ingress is
generated. Exact versioned empty binding, endpoints and bounded cardinality;
native typed references only. Provisioning and external authority remain
independent.

Primary references:
[ALB security group paths](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-update-security-groups.html),
[ALB native contract](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-loadbalancer.html),
[ECS ALB integration](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/alb.html),
[HTTPS listener](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-listener.html),
[ALB target group](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-targetgroup.html).
Source/tests: `packages/provider-aws/src/catalog/services/elb.ts`,
`services/iac-compiler/elb.go`.

### `aws.elb.listener-uses-certificate`

Exact rule `1.0.0`;
`{"portId":"aws.elb.https-listener.certificate","serviceId":"aws.elb.https-listener"}`
→
`{"portId":"aws.acm.public-dns-certificate.alb-listener","serviceId":"aws.acm.public-dns-certificate"}`.
Max endpoint pair/source/target `[1,1,128]`. Bind exact ALB
network/listener/certificate/backend dependencies. No IAM or viewer ingress is
generated. Exact versioned empty binding, endpoints and bounded cardinality;
native typed references only. Provisioning and external authority remain
independent.

Primary references:
[ALB security group paths](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-update-security-groups.html),
[ALB native contract](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-loadbalancer.html),
[ECS ALB integration](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/alb.html),
[HTTPS listener](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-listener.html),
[ALB target group](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-targetgroup.html).
Source/tests: `packages/provider-aws/src/catalog/services/elb.ts`,
`services/iac-compiler/elb.go`.

### `aws.elb.target-group-owns-backend-access`

Exact rule `1.0.0`;
`{"portId":"aws.elb.backend-access-configuration.target-group","serviceId":"aws.elb.backend-access-configuration"}`
→
`{"portId":"aws.elb.target-group.backend-access","serviceId":"aws.elb.target-group"}`.
Max endpoint pair/source/target `[1,1,1]`. Bind exact ALB
network/listener/certificate/backend dependencies. No IAM or viewer ingress is
generated. Exact versioned empty binding, endpoints and bounded cardinality;
native typed references only. Provisioning and external authority remain
independent.

Primary references:
[ALB security group paths](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-update-security-groups.html),
[ALB native contract](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-loadbalancer.html),
[ECS ALB integration](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/alb.html),
[HTTPS listener](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-listener.html),
[ALB target group](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-targetgroup.html).
Source/tests: `apps/web/src/features/editor/model/elb-service-setup.test.ts`,
`packages/provider-aws/src/catalog/services/elb.ts`,
`services/iac-compiler/elb.go`.

### `aws.elb.target-group-targets-ec2`

Exact rule `1.0.0`;
`{"portId":"aws.elb.target-group.ec2-backend","serviceId":"aws.elb.target-group"}`
→ `{"portId":"aws.ec2.instance.alb-target","serviceId":"aws.ec2.instance"}`. Max
endpoint pair/source/target `[1,1,1]`. Bind exact ALB
network/listener/certificate/backend dependencies. No IAM or viewer ingress is
generated. Exact versioned empty binding, endpoints and bounded cardinality;
native typed references only. Provisioning and external authority remain
independent.

Primary references:
[ALB security group paths](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-update-security-groups.html),
[ALB native contract](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-loadbalancer.html),
[ECS ALB integration](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/alb.html),
[HTTPS listener](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-listener.html),
[ALB target group](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-targetgroup.html).
Source/tests: `packages/provider-aws/src/catalog/services/elb.ts`,
`services/iac-compiler/elb.go`.

### `aws.elb.target-group-targets-ecs`

Exact rule `1.0.0`;
`{"portId":"aws.elb.target-group.ecs-backend","serviceId":"aws.elb.target-group"}`
→ `{"portId":"aws.ecs.service.alb-target","serviceId":"aws.ecs.service"}`. Max
endpoint pair/source/target `[1,1,1]`. Bind exact ALB
network/listener/certificate/backend dependencies. No IAM or viewer ingress is
generated. Exact versioned empty binding, endpoints and bounded cardinality;
native typed references only. Provisioning and external authority remain
independent.

Primary references:
[ALB security group paths](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-update-security-groups.html),
[ALB native contract](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-loadbalancer.html),
[ECS ALB integration](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/alb.html),
[HTTPS listener](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-listener.html),
[ALB target group](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-targetgroup.html).
Source/tests: `packages/provider-aws/src/catalog/services/elb.ts`,
`packages/provider-aws/src/elb.test.ts`, `services/iac-compiler/elb.go`.

### `aws.elb.target-group-uses-vpc`

Exact rule `1.0.0`;
`{"portId":"aws.elb.target-group.vpc","serviceId":"aws.elb.target-group"}` →
`{"portId":"aws.ec2.vpc.alb-target-group","serviceId":"aws.ec2.vpc"}`. Max
endpoint pair/source/target `[1,1,128]`. Bind exact ALB
network/listener/certificate/backend dependencies. No IAM or viewer ingress is
generated. Exact versioned empty binding, endpoints and bounded cardinality;
native typed references only. Provisioning and external authority remain
independent.

Primary references:
[ALB security group paths](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-update-security-groups.html),
[ALB native contract](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-loadbalancer.html),
[ECS ALB integration](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/alb.html),
[HTTPS listener](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-listener.html),
[ALB target group](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-targetgroup.html).
Source/tests: `packages/provider-aws/src/catalog/services/elb.ts`,
`services/iac-compiler/elb.go`.

### `aws.eventbridge.event-bus-associates-rule`

Exact rule `1.0.0`;
`{"portId":"aws.eventbridge.event-bus.rules","serviceId":"aws.eventbridge.event-bus"}`
→
`{"portId":"aws.eventbridge.rule.event-bus","serviceId":"aws.eventbridge.rule"}`.
Max endpoint pair/source/target `[1,300,1]`. The rule listens only to this bus
and keeps its filter separate from every target. Binds EventBusName through an
exact association without implying physical containment or cross-bus matching.

Primary references:
[AWS event-driven architecture guidance](https://docs.aws.amazon.com/whitepapers/latest/serverless-architectures-lambda/event-driven-architectures.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`services/iac-compiler/cloudformation_eventing.go`,
`services/iac-compiler/terraform_eventing.go`,
`services/iac-compiler/terraform_eventing_test.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.eventbridge.event-bus-owns-resource-policy`

Exact rule `1.0.0`;
`{"portId":"aws.iam.policy-document.event-bus-resource-policy","serviceId":"aws.iam.policy-document"}`
→
`{"portId":"aws.eventbridge.event-bus.resource-policy","serviceId":"aws.eventbridge.event-bus"}`.
Max endpoint pair/source/target `[1,1,1]`. This resource policy belongs to one
exact service and stays separate from execution-role permissions. Binds one
canonical resource-policy document to one owner slot; principals, actions,
scopes, conditions, lifecycle, and adoption remain typed graph facts.

Primary references:
[AWS event-driven architecture guidance](https://docs.aws.amazon.com/whitepapers/latest/serverless-architectures-lambda/event-driven-architectures.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/catalog/services/iam-policy-document.ts`,
`packages/provider-aws/src/validation.test.ts`,
`services/iac-compiler/terraform_eventing.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.eventbridge.rule-owns-target`

Exact rule `1.0.0`;
`{"portId":"aws.eventbridge.rule.targets","serviceId":"aws.eventbridge.rule"}` →
`{"portId":"aws.eventbridge.target.rule","serviceId":"aws.eventbridge.target"}`.
Max endpoint pair/source/target `[1,5,1]`. Each target keeps its destination,
retry window, and optional dead-letter queue visible and reviewable. Binds one
graph-backed target to one rule; AWS target cardinality is capped and
target-type exclusivity is validated from the exact outgoing edge.

Primary references:
[AWS event-driven architecture guidance](https://docs.aws.amazon.com/whitepapers/latest/serverless-architectures-lambda/event-driven-architectures.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/catalog/services/eventbridge-eventing.ts`,
`packages/provider-aws/src/event-driven-catalog.test.ts`,
`services/iac-compiler/cloudformation_eventing.go`,
`services/iac-compiler/terraform_eventing.go`,
`services/iac-compiler/terraform_eventing_test.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.eventbridge.target-invokes-lambda`

Exact rule `1.0.0`;
`{"portId":"aws.eventbridge.target.lambda","serviceId":"aws.eventbridge.target"}`
→
`{"portId":"aws.lambda.function.asynchronous-invocation","serviceId":"aws.lambda.function"}`.
Max endpoint pair/source/target `[1,1,100]`. The full matched event is delivered
to this exact target with bounded retry and at-least-once behavior. Declares
exact lambda:InvokeFunction target scope; target-specific resource policy or
execution-role requirements remain visible and compiler rendering is pending.

Primary references:
[AWS event-driven architecture guidance](https://docs.aws.amazon.com/whitepapers/latest/serverless-architectures-lambda/event-driven-architectures.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/event-driven-catalog.test.ts`,
`services/iac-compiler/cloudformation_eventing.go`,
`services/iac-compiler/generator_compatibility_test.go`,
`services/iac-compiler/terraform_eventing.go`,
`services/iac-compiler/terraform_eventing_test.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.eventbridge.target-publishes-to-sns`

Exact rule `1.0.0`;
`{"portId":"aws.eventbridge.target.topic","serviceId":"aws.eventbridge.target"}`
→ `{"portId":"aws.sns.topic.publish","serviceId":"aws.sns.topic"}`. Max endpoint
pair/source/target `[1,1,100]`. The full matched event is delivered to this
exact target with bounded retry and at-least-once behavior. Declares exact
sns:Publish target scope; target-specific resource policy or execution-role
requirements remain visible and compiler rendering is pending.

Primary references:
[AWS event-driven architecture guidance](https://docs.aws.amazon.com/whitepapers/latest/serverless-architectures-lambda/event-driven-architectures.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`services/iac-compiler/cloudformation_eventing.go`,
`services/iac-compiler/terraform_eventing.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.eventbridge.target-sends-to-sqs`

Exact rule `1.0.0`;
`{"portId":"aws.eventbridge.target.queue","serviceId":"aws.eventbridge.target"}`
→ `{"portId":"aws.sqs.queue.message-send","serviceId":"aws.sqs.queue"}`. Max
endpoint pair/source/target `[1,1,100]`. The full matched event is delivered to
this exact target with bounded retry and at-least-once behavior. Declares exact
sqs:SendMessage target scope; target-specific resource policy or execution-role
requirements remain visible and compiler rendering is pending.

Primary references:
[AWS event-driven architecture guidance](https://docs.aws.amazon.com/whitepapers/latest/serverless-architectures-lambda/event-driven-architectures.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/event-driven-catalog.test.ts`,
`services/iac-compiler/cloudformation_eventing.go`,
`services/iac-compiler/terraform_eventing.go`,
`services/iac-compiler/terraform_eventing_test.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.eventbridge.target-starts-state-machine`

Exact rule `1.0.0`;
`{"portId":"aws.eventbridge.target.state-machine","serviceId":"aws.eventbridge.target"}`
→
`{"portId":"aws.stepfunctions.state-machine.start-execution","serviceId":"aws.stepfunctions.state-machine"}`.
Max endpoint pair/source/target `[1,1,100]`. The full matched event is delivered
to this exact target with bounded retry and at-least-once behavior. Declares
exact states:StartExecution target scope; target-specific resource policy or
execution-role requirements remain visible and compiler rendering is pending.

Primary references:
[AWS event-driven architecture guidance](https://docs.aws.amazon.com/whitepapers/latest/serverless-architectures-lambda/event-driven-architectures.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/event-driven-catalog.test.ts`,
`services/iac-compiler/cloudformation_eventing.go`,
`services/iac-compiler/terraform_eventing.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.eventbridge.target-uses-dead-letter-queue`

Exact rule `1.0.0`;
`{"portId":"aws.eventbridge.target.dead-letter-queue","serviceId":"aws.eventbridge.target"}`
→ `{"portId":"aws.sqs.queue.dead-letter-target","serviceId":"aws.sqs.queue"}`.
Max endpoint pair/source/target `[1,1,100]`. The full matched event is delivered
to this exact target with bounded retry and at-least-once behavior. Declares
exact sqs:SendMessage target scope; target-specific resource policy or
execution-role requirements remain visible and compiler rendering is pending.

Primary references:
[AWS event-driven architecture guidance](https://docs.aws.amazon.com/whitepapers/latest/serverless-architectures-lambda/event-driven-architectures.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/event-driven-catalog.test.ts`,
`services/iac-compiler/cloudformation_eventing.go`,
`services/iac-compiler/generator_compatibility_test.go`,
`services/iac-compiler/terraform_eventing.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.fsx.lustre-file-system-uses-security-group`

Exact rule `1.0.0`;
`{"portId":"aws.fsx.lustre-file-system.security-groups","serviceId":"aws.fsx.lustre-file-system"}`
→
`{"portId":"aws.ec2.security-group.fsx","serviceId":"aws.ec2.security-group"}`.
Max endpoint pair/source/target `[1,5,256]`. Uses security group. Choose the
exact resource in your diagram; review the combined network and access settings
before export. Explicit same-Region graph association. Subnet/security-group
relationships grant no ingress or IAM permission. Lustre S3 import uses the AWS
FSx service-linked role and never a Lambda file-system mount.

Primary references:
[Amazon FSx file systems](https://docs.aws.amazon.com/fsx/latest/APIReference/API_CreateFileSystem.html).
Source/tests: .

### `aws.fsx.lustre-file-system-uses-subnet`

Exact rule `1.0.0`;
`{"portId":"aws.fsx.lustre-file-system.subnets","serviceId":"aws.fsx.lustre-file-system"}`
→ `{"portId":"aws.ec2.subnet.fsx","serviceId":"aws.ec2.subnet"}`. Max endpoint
pair/source/target `[1,1,256]`. Uses subnet. Choose the exact resource in your
diagram; review the combined network and access settings before export. Explicit
same-Region graph association. Subnet/security-group relationships grant no
ingress or IAM permission. Lustre S3 import uses the AWS FSx service-linked role
and never a Lambda file-system mount.

Primary references:
[Amazon FSx file systems](https://docs.aws.amazon.com/fsx/latest/APIReference/API_CreateFileSystem.html).
Source/tests: .

### `aws.fsx.lustre-imports-s3`

Exact rule `1.0.0`;
`{"portId":"aws.fsx.lustre-file-system.s3-repository","serviceId":"aws.fsx.lustre-file-system"}`
→ `{"portId":"aws.s3.bucket.object-api","serviceId":"aws.s3.bucket"}`. Max
endpoint pair/source/target `[1,1,256]`. Imports files from S3. Choose the exact
resource in your diagram; review the combined network and access settings before
export. Explicit same-Region graph association. Subnet/security-group
relationships grant no ingress or IAM permission. Lustre S3 import uses the AWS
FSx service-linked role and never a Lambda file-system mount.

Primary references:
[Amazon FSx file systems](https://docs.aws.amazon.com/fsx/latest/APIReference/API_CreateFileSystem.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/fsx-connections.ts`,
`services/iac-compiler/fsx.go`.

### `aws.fsx.ontap-file-system-uses-security-group`

Exact rule `1.0.0`;
`{"portId":"aws.fsx.ontap-file-system.security-groups","serviceId":"aws.fsx.ontap-file-system"}`
→
`{"portId":"aws.ec2.security-group.fsx","serviceId":"aws.ec2.security-group"}`.
Max endpoint pair/source/target `[1,5,256]`. Uses security group. Choose the
exact resource in your diagram; review the combined network and access settings
before export. Explicit same-Region graph association. Subnet/security-group
relationships grant no ingress or IAM permission. Lustre S3 import uses the AWS
FSx service-linked role and never a Lambda file-system mount.

Primary references:
[Amazon FSx file systems](https://docs.aws.amazon.com/fsx/latest/APIReference/API_CreateFileSystem.html).
Source/tests: .

### `aws.fsx.ontap-file-system-uses-subnet`

Exact rule `1.0.0`;
`{"portId":"aws.fsx.ontap-file-system.subnets","serviceId":"aws.fsx.ontap-file-system"}`
→ `{"portId":"aws.ec2.subnet.fsx","serviceId":"aws.ec2.subnet"}`. Max endpoint
pair/source/target `[1,1,256]`. Uses subnet. Choose the exact resource in your
diagram; review the combined network and access settings before export. Explicit
same-Region graph association. Subnet/security-group relationships grant no
ingress or IAM permission. Lustre S3 import uses the AWS FSx service-linked role
and never a Lambda file-system mount.

Primary references:
[Amazon FSx file systems](https://docs.aws.amazon.com/fsx/latest/APIReference/API_CreateFileSystem.html).
Source/tests: .

### `aws.fsx.ontap-svm-uses-file-system`

Exact rule `1.0.0`;
`{"portId":"aws.fsx.ontap-storage-virtual-machine.file-system","serviceId":"aws.fsx.ontap-storage-virtual-machine"}`
→
`{"portId":"aws.fsx.ontap-file-system.storage-virtual-machines","serviceId":"aws.fsx.ontap-file-system"}`.
Max endpoint pair/source/target `[1,1,256]`. Uses ONTAP file system. Choose the
exact resource in your diagram; review the combined network and access settings
before export. Explicit same-Region graph association. Subnet/security-group
relationships grant no ingress or IAM permission. Lustre S3 import uses the AWS
FSx service-linked role and never a Lambda file-system mount.

Primary references:
[Amazon FSx file systems](https://docs.aws.amazon.com/fsx/latest/APIReference/API_CreateFileSystem.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/fsx-connections.ts`,
`services/iac-compiler/fsx.go`.

### `aws.fsx.ontap-volume-uses-svm`

Exact rule `1.0.0`;
`{"portId":"aws.fsx.ontap-volume.storage-virtual-machine","serviceId":"aws.fsx.ontap-volume"}`
→
`{"portId":"aws.fsx.ontap-storage-virtual-machine.volumes","serviceId":"aws.fsx.ontap-storage-virtual-machine"}`.
Max endpoint pair/source/target `[1,1,256]`. Uses storage virtual machine.
Choose the exact resource in your diagram; review the combined network and
access settings before export. Explicit same-Region graph association.
Subnet/security-group relationships grant no ingress or IAM permission. Lustre
S3 import uses the AWS FSx service-linked role and never a Lambda file-system
mount.

Primary references:
[Amazon FSx file systems](https://docs.aws.amazon.com/fsx/latest/APIReference/API_CreateFileSystem.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/fsx-connections.ts`,
`services/iac-compiler/fsx.go`.

### `aws.fsx.openzfs-file-system-uses-security-group`

Exact rule `1.0.0`;
`{"portId":"aws.fsx.openzfs-file-system.security-groups","serviceId":"aws.fsx.openzfs-file-system"}`
→
`{"portId":"aws.ec2.security-group.fsx","serviceId":"aws.ec2.security-group"}`.
Max endpoint pair/source/target `[1,5,256]`. Uses security group. Choose the
exact resource in your diagram; review the combined network and access settings
before export. Explicit same-Region graph association. Subnet/security-group
relationships grant no ingress or IAM permission. Lustre S3 import uses the AWS
FSx service-linked role and never a Lambda file-system mount.

Primary references:
[Amazon FSx file systems](https://docs.aws.amazon.com/fsx/latest/APIReference/API_CreateFileSystem.html).
Source/tests: .

### `aws.fsx.openzfs-file-system-uses-subnet`

Exact rule `1.0.0`;
`{"portId":"aws.fsx.openzfs-file-system.subnets","serviceId":"aws.fsx.openzfs-file-system"}`
→ `{"portId":"aws.ec2.subnet.fsx","serviceId":"aws.ec2.subnet"}`. Max endpoint
pair/source/target `[1,1,256]`. Uses subnet. Choose the exact resource in your
diagram; review the combined network and access settings before export. Explicit
same-Region graph association. Subnet/security-group relationships grant no
ingress or IAM permission. Lustre S3 import uses the AWS FSx service-linked role
and never a Lambda file-system mount.

Primary references:
[Amazon FSx file systems](https://docs.aws.amazon.com/fsx/latest/APIReference/API_CreateFileSystem.html).
Source/tests: .

### `aws.fsx.windows-file-system-uses-security-group`

Exact rule `1.0.0`;
`{"portId":"aws.fsx.windows-file-system.security-groups","serviceId":"aws.fsx.windows-file-system"}`
→
`{"portId":"aws.ec2.security-group.fsx","serviceId":"aws.ec2.security-group"}`.
Max endpoint pair/source/target `[1,5,256]`. Uses security group. Choose the
exact resource in your diagram; review the combined network and access settings
before export. Explicit same-Region graph association. Subnet/security-group
relationships grant no ingress or IAM permission. Lustre S3 import uses the AWS
FSx service-linked role and never a Lambda file-system mount.

Primary references:
[Amazon FSx file systems](https://docs.aws.amazon.com/fsx/latest/APIReference/API_CreateFileSystem.html).
Source/tests: .

### `aws.fsx.windows-file-system-uses-subnet`

Exact rule `1.0.0`;
`{"portId":"aws.fsx.windows-file-system.subnets","serviceId":"aws.fsx.windows-file-system"}`
→ `{"portId":"aws.ec2.subnet.fsx","serviceId":"aws.ec2.subnet"}`. Max endpoint
pair/source/target `[1,2,256]`. Uses subnet. Choose the exact resource in your
diagram; review the combined network and access settings before export. Explicit
same-Region graph association. Subnet/security-group relationships grant no
ingress or IAM permission. Lustre S3 import uses the AWS FSx service-linked role
and never a Lambda file-system mount.

Primary references:
[Amazon FSx file systems](https://docs.aws.amazon.com/fsx/latest/APIReference/API_CreateFileSystem.html).
Source/tests: .

### `aws.iam.instance-profile-supplies-instance`

Exact rule `1.0.0`;
`{"portId":"aws.iam.instance-profile.instance","serviceId":"aws.iam.instance-profile"}`
→
`{"portId":"aws.ec2.instance.instance-profile","serviceId":"aws.ec2.instance"}`.
Max endpoint pair/source/target `[1,128,1]`. Connect existing reviewed
resources. This connection adds no role, trust, permissions, network rules or
application behavior. The exact empty versioned binding supplies an explicit
native resource reference. Same-VPC, role trust, image and key readiness are
separately validated; a connection cannot prove deployment/PassRole/key
authority.

Primary references:
[AMI identity and compatibility](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/AMIs.html),
[EC2 instance properties and replacement](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-instance.html),
[EC2 instance profile](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-iam-instanceprofile.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/ec2-connections.ts`,
`packages/provider-aws/src/ec2-compute.test.ts`, `services/iac-compiler/ec2.go`.

### `aws.iam.policy-contains-statement`

Exact rule `1.0.0`;
`{"portId":"aws.iam.policy-statement.policy-document","serviceId":"aws.iam.policy-statement"}`
→
`{"portId":"aws.iam.policy-document.statement","serviceId":"aws.iam.policy-document"}`.
Max endpoint pair/source/target `[1,1,256]`. Each statement describes one clear
permission purpose inside the policy. Stable statement node IDs and
deterministic ordering preserve exact selection, duplication, and removal
semantics.

Primary references:
[IAM JSON policy elements reference](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements.html).
Source/tests: `apps/web/src/features/editor/model/connection-workflow.test.ts`,
`apps/web/src/features/editor/model/secret-policy-scope.test.ts`,
`packages/provider-aws/src/catalog/connections/notes-api-connections.ts`,
`packages/provider-aws/src/catalog/connections/owned-configuration-connections.ts`,
`packages/provider-aws/src/catalog/services/iam-policy-statement.ts`,
`packages/provider-aws/src/cloudfront.test.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`packages/provider-aws/src/ec2-compute.test.ts`,
`packages/provider-aws/src/kms-key.test.ts`,
`packages/provider-aws/src/networking-policy.test.ts`,
`packages/provider-aws/src/policy/projection-v1.test.ts`,
`packages/provider-aws/src/secrets-manager.test.ts`,
`packages/provider-aws/src/validation.test.ts`,
`services/iac-compiler/cloudfront.go`,
`services/iac-compiler/cloudfront_test.go`, `services/iac-compiler/ec2.go`,
`services/iac-compiler/ec2_test.go`, `services/iac-compiler/ecs.go`,
`services/iac-compiler/ecs_test.go`, `services/iac-compiler/kms.go`,
`services/iac-compiler/kms_test.go`, `services/iac-compiler/secrets.go`,
`services/iac-compiler/secrets_test.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_networking_test.go`,
`services/iac-compiler/terraform_renderer.go`,
`services/iac-compiler/terraform_test.go`.

### `aws.iam.policy-statement-authorizes-dynamodb-table`

Exact rule `1.0.0`;
`{"portId":"aws.iam.policy-statement.dynamodb-resource","serviceId":"aws.iam.policy-statement"}`
→
`{"portId":"aws.dynamodb.table.policy-resource","serviceId":"aws.dynamodb.table"}`.
Max endpoint pair/source/target `[1,1,64]`. CloudMarkup uses the selected table
instead of accepting a typed or pasted ARN. The relationship resolves resource
scope from graph identity and prevents wildcard or free-form resource
declarations.

Primary references:
[Identity-based policy examples for DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/security_iam_id-based-policy-examples.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/notes-api-connections.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`packages/provider-aws/src/validation.test.ts`.

### `aws.iam.policy-statement-authorizes-eventbridge-bus`

Exact rule `1.0.0`;
`{"portId":"aws.iam.policy-statement.eventbridge-resource","serviceId":"aws.iam.policy-statement"}`
→
`{"portId":"aws.eventbridge.event-bus.policy-resource","serviceId":"aws.eventbridge.event-bus"}`.
Max endpoint pair/source/target `[1,128,128]`. This edge uses the selected graph
resource instead of a pasted ARN or wildcard. Supplies one typed
architecture-node ARN scope to the canonical policy projection with exact
lifecycle and owner provenance.

Primary references:
[AWS event-driven architecture guidance](https://docs.aws.amazon.com/whitepapers/latest/serverless-architectures-lambda/event-driven-architectures.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/validation.test.ts`.

### `aws.iam.policy-statement-authorizes-kms-key`

Exact rule `1.0.0`;
`{"portId":"aws.iam.policy-statement.kms-resource","serviceId":"aws.iam.policy-statement"}`
→ `{"portId":"aws.kms.key.policy-resource","serviceId":"aws.kms.key"}`. Max
endpoint pair/source/target `[1,1,128]`. Select the key explicitly and review
each administrator or user statement before export. Exact canonical owner and
resource bindings carry graph identity, user ownership and policy scope. Only
the owning key policy may render owner-local KMS resource scope.

Primary references:
[AWS KMS key resource and policy requirements](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-kms-key.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/kms-connections.ts`.

### `aws.iam.policy-statement-authorizes-lambda-function`

Exact rule `1.0.0`;
`{"portId":"aws.iam.policy-statement.lambda-resource","serviceId":"aws.iam.policy-statement"}`
→
`{"portId":"aws.lambda.function.policy-resource","serviceId":"aws.lambda.function"}`.
Max endpoint pair/source/target `[1,1,64]`. CloudMarkup uses the selected
function instead of accepting a typed or pasted ARN. The relationship resolves
the exact function ARN from graph identity and keeps resource-side service
grants canonical.

Primary references:
[Using resource-based policies for Lambda](https://docs.aws.amazon.com/lambda/latest/dg/access-control-resource-based.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/notes-api-connections.ts`.

### `aws.iam.policy-statement-authorizes-log-group`

Exact rule `1.0.0`;
`{"portId":"aws.iam.policy-statement.log-group-resource","serviceId":"aws.iam.policy-statement"}`
→
`{"portId":"aws.cloudwatch.log-group.policy-resource","serviceId":"aws.cloudwatch.log-group"}`.
Max endpoint pair/source/target `[1,1,64]`. CloudMarkup uses the selected log
group instead of accepting a typed or pasted ARN. The relationship resolves the
exact log-group ARN from graph identity and prevents wildcard resource scope.

Primary references:
[Permissions reference for CloudWatch Logs](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/permissions-reference-cwl.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/notes-api-connections.ts`.

### `aws.iam.policy-statement-authorizes-s3-bucket`

Exact rule `1.0.0`;
`{"portId":"aws.iam.policy-statement.s3-resource","serviceId":"aws.iam.policy-statement"}`
→ `{"portId":"aws.s3.bucket.policy-resource","serviceId":"aws.s3.bucket"}`. Max
endpoint pair/source/target `[1,128,128]`. This edge uses the selected graph
resource instead of a pasted ARN or wildcard. Supplies one typed
architecture-node ARN scope to the canonical policy projection with exact
lifecycle and owner provenance.

Primary references:
[AWS event-driven architecture guidance](https://docs.aws.amazon.com/whitepapers/latest/serverless-architectures-lambda/event-driven-architectures.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/validation.test.ts`.

### `aws.iam.policy-statement-authorizes-secret`

Exact rule `1.0.0`;
`{"portId":"aws.iam.policy-statement.secret-resource","serviceId":"aws.iam.policy-statement"}`
→
`{"portId":"aws.secretsmanager.secret.policy-resource","serviceId":"aws.secretsmanager.secret"}`.
Max endpoint pair/source/target `[1,1,128]`. Choose encryption or access
explicitly. A secret starts empty; populate it externally before use. Encryption
does not grant permission to retrieve it. The exact typed relationship renders a
KMS ARN or a secret's full generated ARN. Key-user and secret-access authority
remain separate user-reviewed policy intent; no grants, secret values, runtime
retrieval or lifecycle changes are inferred.

Primary references:
[Secrets Manager encryption permissions](https://docs.aws.amazon.com/secretsmanager/latest/userguide/security-encryption.html),
[Secrets Manager metadata, encryption and lifecycle](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-secretsmanager-secret.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/secrets-connections.ts`,
`packages/provider-aws/src/secrets-manager.test.ts`,
`services/iac-compiler/secrets.go`.

### `aws.iam.policy-statement-authorizes-sns-topic`

Exact rule `1.0.0`;
`{"portId":"aws.iam.policy-statement.sns-resource","serviceId":"aws.iam.policy-statement"}`
→ `{"portId":"aws.sns.topic.policy-resource","serviceId":"aws.sns.topic"}`. Max
endpoint pair/source/target `[1,128,128]`. This edge uses the selected graph
resource instead of a pasted ARN or wildcard. Supplies one typed
architecture-node ARN scope to the canonical policy projection with exact
lifecycle and owner provenance.

Primary references:
[AWS event-driven architecture guidance](https://docs.aws.amazon.com/whitepapers/latest/serverless-architectures-lambda/event-driven-architectures.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/validation.test.ts`.

### `aws.iam.policy-statement-authorizes-sqs-queue`

Exact rule `1.0.0`;
`{"portId":"aws.iam.policy-statement.sqs-resource","serviceId":"aws.iam.policy-statement"}`
→ `{"portId":"aws.sqs.queue.policy-resource","serviceId":"aws.sqs.queue"}`. Max
endpoint pair/source/target `[1,128,128]`. This edge uses the selected graph
resource instead of a pasted ARN or wildcard. Supplies one typed
architecture-node ARN scope to the canonical policy projection with exact
lifecycle and owner provenance.

Primary references:
[AWS event-driven architecture guidance](https://docs.aws.amazon.com/whitepapers/latest/serverless-architectures-lambda/event-driven-architectures.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/validation.test.ts`.

### `aws.iam.policy-statement-authorizes-step-functions-state-machine`

Exact rule `1.0.0`;
`{"portId":"aws.iam.policy-statement.step-functions-resource","serviceId":"aws.iam.policy-statement"}`
→
`{"portId":"aws.stepfunctions.state-machine.policy-resource","serviceId":"aws.stepfunctions.state-machine"}`.
Max endpoint pair/source/target `[1,128,128]`. This edge uses the selected graph
resource instead of a pasted ARN or wildcard. Supplies one typed
architecture-node ARN scope to the canonical policy projection with exact
lifecycle and owner provenance.

Primary references:
[AWS event-driven architecture guidance](https://docs.aws.amazon.com/whitepapers/latest/serverless-architectures-lambda/event-driven-architectures.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`.

### `aws.iam.role-assumed-by-eventbridge-target`

Exact rule `1.0.0`;
`{"portId":"aws.iam.role.assumable-role","serviceId":"aws.iam.role"}` →
`{"portId":"aws.eventbridge.target.execution-role","serviceId":"aws.eventbridge.target"}`.
Max endpoint pair/source/target `[1,1,1]`. EventBridge uses this role only to
start the connected workflow; Lambda, SNS, and SQS targets use their reviewed
resource policies instead. Binds one conditional target execution role and exact
events.amazonaws.com sts:AssumeRole trust requirement without inferring a shared
workload identity.

Primary references:
[AWS event-driven architecture guidance](https://docs.aws.amazon.com/whitepapers/latest/serverless-architectures-lambda/event-driven-architectures.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/event-driven-catalog.test.ts`,
`services/iac-compiler/cloudformation_eventing.go`,
`services/iac-compiler/terraform_eventing.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.iam.role-assumed-by-lambda`

Exact rule `1.0.0`;
`{"portId":"aws.iam.role.assumable-role","serviceId":"aws.iam.role"}` →
`{"portId":"aws.lambda.function.execution-role","serviceId":"aws.lambda.function"}`.
Max endpoint pair/source/target `[1,1,1]`. Lambda assumes this role when the
notes function calls DynamoDB or writes logs. The relationship supplies the role
ARN and exposes the fixed Lambda service trust effect; it does not infer
application permissions.

Primary references:
[Lambda execution role](https://docs.aws.amazon.com/lambda/latest/dg/lambda-intro-execution-role.html).
Source/tests: `apps/web/src/features/editor/model/connection-workflow.test.ts`,
`packages/provider-aws/src/catalog/connections/notes-api-connections.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`packages/provider-aws/src/event-driven-catalog.test.ts`,
`packages/provider-aws/src/networking-validation.test.ts`,
`packages/provider-aws/src/validation.test.ts`,
`services/iac-compiler/cloudformation_resources.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_networking.go`,
`services/iac-compiler/terraform_renderer.go`,
`services/iac-compiler/terraform_resources.go`,
`services/iac-compiler/terraform_test.go`.

### `aws.iam.role-assumed-by-step-functions`

Exact rule `1.0.0`;
`{"portId":"aws.iam.role.assumable-role","serviceId":"aws.iam.role"}` →
`{"portId":"aws.stepfunctions.state-machine.execution-role","serviceId":"aws.stepfunctions.state-machine"}`.
Max endpoint pair/source/target `[1,1,1]`. The workflow uses this role for its
reviewed task permissions; it is not shared automatically with a Lambda
function. Binds one execution role and exact states.amazonaws.com sts:AssumeRole
trust requirement to the state machine.

Primary references:
[AWS event-driven architecture guidance](https://docs.aws.amazon.com/whitepapers/latest/serverless-architectures-lambda/event-driven-architectures.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/event-driven-catalog.test.ts`,
`services/iac-compiler/cloudformation_eventing.go`,
`services/iac-compiler/terraform_eventing.go`,
`services/iac-compiler/terraform_eventing_test.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.iam.role-binds-instance-profile`

Exact rule `1.0.0`;
`{"portId":"aws.iam.role.assumable-role","serviceId":"aws.iam.role"}` →
`{"portId":"aws.iam.instance-profile.role","serviceId":"aws.iam.instance-profile"}`.
Max endpoint pair/source/target `[1,1,1]`. Connect existing reviewed resources.
This connection adds no role, trust, permissions, network rules or application
behavior. The exact empty versioned binding supplies an explicit native resource
reference. Same-VPC, role trust, image and key readiness are separately
validated; a connection cannot prove deployment/PassRole/key authority.

Primary references:
[AMI identity and compatibility](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/AMIs.html),
[EC2 instance properties and replacement](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-instance.html),
[EC2 instance profile](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-iam-instanceprofile.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/ec2-connections.ts`,
`packages/provider-aws/src/ec2-compute.test.ts`, `services/iac-compiler/ec2.go`.

### `aws.iam.role-owns-generated-permission`

Exact rule `1.0.0`;
`{"portId":"aws.iam.policy-document.role-generated-permission","serviceId":"aws.iam.policy-document"}`
→ `{"portId":"aws.iam.role.generated-permission","serviceId":"aws.iam.role"}`.
Max endpoint pair/source/target `[1,1,64]`. CloudMarkup created these
permissions because the role or function is connected to another service.
Generated ownership and provenance keep release authority tied to the exact
connection edges that still require the policy.

Primary references:
[IAM JSON policy elements reference](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements.html).
Source/tests: `apps/web/src/features/editor/model/connection-workflow.test.ts`,
`packages/provider-aws/src/catalog/connections/notes-api-connections.ts`,
`packages/provider-aws/src/catalog/connections/owned-configuration-connections.ts`,
`packages/provider-aws/src/catalog/services/iam-policy-document.ts`,
`packages/provider-aws/src/validation.test.ts`,
`services/iac-compiler/cloudformation_redrive_logging_test.go`,
`services/iac-compiler/generation_golden_fixtures_test.go`,
`services/iac-compiler/terraform_eventing_test.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_renderer.go`,
`services/iac-compiler/terraform_test.go`.

### `aws.iam.role-owns-inline-policy`

Exact rule `1.0.0`;
`{"portId":"aws.iam.policy-document.role-inline-policy","serviceId":"aws.iam.policy-document"}`
→ `{"portId":"aws.iam.role.custom-inline-policy","serviceId":"aws.iam.role"}`.
Max endpoint pair/source/target `[1,1,32]`. You explicitly added these
permissions to this role. Removing an unrelated service connection will not
delete them. The user-owned identity-inline document remains distinct from
provider-generated permission documents and cleanup authority.

Primary references:
[IAM JSON policy elements reference](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/owned-configuration-connections.ts`,
`packages/provider-aws/src/catalog/services/iam-policy-document.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`packages/provider-aws/src/ecs-fargate.test.ts`,
`packages/provider-aws/src/policy/projection-v1.test.ts`,
`packages/provider-aws/src/secrets-manager.test.ts`,
`packages/provider-aws/src/validation.test.ts`, `services/iac-compiler/ecs.go`,
`services/iac-compiler/ecs_render.go`, `services/iac-compiler/ecs_test.go`,
`services/iac-compiler/generation_golden_fixtures_test.go`,
`services/iac-compiler/generation_golden_test.go`,
`services/iac-compiler/iam_s3_test.go`, `services/iac-compiler/secrets.go`,
`services/iac-compiler/secrets_test.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_renderer.go`,
`services/iac-compiler/terraform_test.go`.

### `aws.iam.role-owns-managed-policy-attachment`

Exact rule `1.0.0`;
`{"portId":"aws.iam.managed-policy-attachment.role-managed-policy","serviceId":"aws.iam.managed-policy-attachment"}`
→ `{"portId":"aws.iam.role.managed-policy","serviceId":"aws.iam.role"}`. Max
endpoint pair/source/target `[1,1,32]`. This managed policy grants its
permissions to the role and remains separate from custom inline policies. The
graph-backed reference preserves exact attachment identity without accepting
pasted account-specific ARNs.

Primary references:
[IAM JSON policy elements reference](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/owned-configuration-connections.ts`,
`packages/provider-aws/src/catalog/services/iam-managed-policy-attachment.ts`,
`packages/provider-aws/src/networking-validation.test.ts`,
`packages/provider-aws/src/provider-extension-artifacts.test.ts`,
`services/iac-compiler/cloudformation_iam.go`, `services/iac-compiler/ecs.go`,
`services/iac-compiler/ecs_test.go`, `services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_networking.go`,
`services/iac-compiler/terraform_networking_test.go`,
`services/iac-compiler/terraform_renderer.go`,
`services/iac-compiler/terraform_test.go`.

### `aws.iam.role-owns-permissions-boundary`

Exact rule `1.0.0`;
`{"portId":"aws.iam.managed-policy-attachment.role-permissions-boundary","serviceId":"aws.iam.managed-policy-attachment"}`
→ `{"portId":"aws.iam.role.permissions-boundary","serviceId":"aws.iam.role"}`.
Max endpoint pair/source/target `[1,1,1]`. This boundary limits the maximum
permissions the role can receive; it does not grant permissions by itself. The
provider rule enforces zero-or-one boundary cardinality independently from
managed-policy attachments.

Primary references:
[IAM JSON policy elements reference](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/owned-configuration-connections.ts`,
`packages/provider-aws/src/catalog/services/iam-managed-policy-attachment.ts`,
`packages/provider-aws/src/provider-extension-artifacts.test.ts`,
`packages/provider-aws/src/validation.test.ts`,
`services/iac-compiler/cloudformation_iam.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_renderer.go`,
`services/iac-compiler/terraform_test.go`.

### `aws.iam.role-owns-trust-policy`

Exact rule `1.0.0`;
`{"portId":"aws.iam.policy-document.role-trust-policy","serviceId":"aws.iam.policy-document"}`
→ `{"portId":"aws.iam.role.trust-policy","serviceId":"aws.iam.role"}`. Max
endpoint pair/source/target `[1,1,1]`. This trust policy controls who or what
may use the role; it does not grant the role application permissions. Exactly
one trust document is owner-bound to the role and requires principals in its
canonical statements.

Primary references:
[IAM JSON policy elements reference](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements.html).
Source/tests:
`apps/web/src/features/editor/model/provider-catalog-adapter.test.ts`,
`packages/provider-aws/src/catalog/connections/notes-api-connections.ts`,
`packages/provider-aws/src/catalog/connections/owned-configuration-connections.ts`,
`packages/provider-aws/src/catalog/services/iam-policy-document.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`packages/provider-aws/src/ec2-compute.test.ts`,
`packages/provider-aws/src/provider-extension-artifacts.test.ts`,
`packages/provider-aws/src/validation.test.ts`, `services/iac-compiler/ec2.go`,
`services/iac-compiler/ec2_test.go`, `services/iac-compiler/ecs.go`,
`services/iac-compiler/ecs_test.go`, `services/iac-compiler/secrets_test.go`,
`services/iac-compiler/terraform_eventing_test.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_renderer.go`,
`services/iac-compiler/terraform_test.go`.

### `aws.iam.statement-owns-condition`

Exact rule `1.0.0`;
`{"portId":"aws.iam.policy-condition.statement-condition","serviceId":"aws.iam.policy-condition"}`
→
`{"portId":"aws.iam.policy-statement.condition","serviceId":"aws.iam.policy-statement"}`.
Max endpoint pair/source/target `[1,1,128]`. This advanced condition belongs to
one statement and limits when that statement applies. Typed child-node
conditions avoid raw JSON and retain stable identifiers and deterministic
ordering.

Primary references:
[IAM JSON policy elements reference](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements.html).
Source/tests: `apps/web/src/features/editor/model/secret-policy-scope.test.ts`,
`packages/provider-aws/src/catalog/connections/owned-configuration-connections.ts`,
`packages/provider-aws/src/catalog/services/iam-policy-condition.ts`,
`packages/provider-aws/src/policy/projection-v1.test.ts`,
`services/iac-compiler/ec2.go`, `services/iac-compiler/ecs.go`,
`services/iac-compiler/kms_test.go`, `services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.kms.key-encrypts-instance-root`

Exact rule `1.0.0`;
`{"portId":"aws.kms.key.root-volume-encryption","serviceId":"aws.kms.key"}` →
`{"portId":"aws.ec2.instance.root-encryption-key","serviceId":"aws.ec2.instance"}`.
Max endpoint pair/source/target `[1,128,1]`. Connect existing reviewed
resources. This connection adds no role, trust, permissions, network rules or
application behavior. The exact empty versioned binding supplies an explicit
native resource reference. Same-VPC, role trust, image and key readiness are
separately validated; a connection cannot prove deployment/PassRole/key
authority.

Primary references:
[AMI identity and compatibility](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/AMIs.html),
[EC2 instance properties and replacement](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-instance.html),
[EC2 instance profile](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-iam-instanceprofile.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/ec2-connections.ts`,
`services/iac-compiler/ec2.go`.

### `aws.kms.key-encrypts-secret`

Exact rule `1.0.0`;
`{"portId":"aws.kms.key.secret-encryption","serviceId":"aws.kms.key"}` →
`{"portId":"aws.secretsmanager.secret.encryption-key","serviceId":"aws.secretsmanager.secret"}`.
Max endpoint pair/source/target `[1,128,1]`. Choose encryption or access
explicitly. A secret starts empty; populate it externally before use. Encryption
does not grant permission to retrieve it. The exact typed relationship renders a
KMS ARN or a secret's full generated ARN. Key-user and secret-access authority
remain separate user-reviewed policy intent; no grants, secret values, runtime
retrieval or lifecycle changes are inferred.

Primary references:
[Secrets Manager encryption permissions](https://docs.aws.amazon.com/secretsmanager/latest/userguide/security-encryption.html),
[Secrets Manager metadata, encryption and lifecycle](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-secretsmanager-secret.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/secrets-connections.ts`,
`packages/provider-aws/src/secrets-manager.test.ts`,
`services/iac-compiler/secrets.go`.

### `aws.kms.key-owns-resource-policy`

Exact rule `1.0.0`;
`{"portId":"aws.iam.policy-document.kms-key-resource-policy","serviceId":"aws.iam.policy-document"}`
→ `{"portId":"aws.kms.key.resource-policy","serviceId":"aws.kms.key"}`. Max
endpoint pair/source/target `[1,1,1]`. Select the key explicitly and review each
administrator or user statement before export. Exact canonical owner and
resource bindings carry graph identity, user ownership and policy scope. Only
the owning key policy may render owner-local KMS resource scope.

Primary references:
[AWS KMS key resource and policy requirements](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-kms-key.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/kms-connections.ts`,
`packages/provider-aws/src/catalog/services/kms-key.ts`,
`services/iac-compiler/kms.go`.

### `aws.lambda.monitored-by-alarm`

Exact rule `1.0.0`;
`{"portId":"aws.lambda.function.telemetry","serviceId":"aws.lambda.function"}` →
`{"portId":"aws.cloudwatch.metric-alarm.metric","serviceId":"aws.cloudwatch.metric-alarm"}`.
Max endpoint pair/source/target `[1,16,1]`. The alarm watches errors from this
function instead of every Lambda function. The relationship supplies the Lambda
FunctionName dimension to the catalog's bounded AWS/Lambda Errors metric alarm.

Primary references:
[Types of metrics for Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-metrics-types.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/notes-api-connections.ts`,
`services/iac-compiler/cloudformation_resources.go`,
`services/iac-compiler/terraform_renderer.go`,
`services/iac-compiler/terraform_resources.go`,
`services/iac-compiler/terraform_test.go`.

### `aws.lambda.owns-invocation-permission`

Exact rule `1.0.0`;
`{"portId":"aws.iam.policy-document.lambda-service-grant","serviceId":"aws.iam.policy-document"}`
→
`{"portId":"aws.lambda.function.invocation-permission","serviceId":"aws.lambda.function"}`.
Max endpoint pair/source/target `[1,1,64]`. A supported trigger may need a
separate permission allowing that AWS service to invoke this function.
Service-grant documents model resource-side Lambda permissions separately from
execution-role identity policies.

Primary references:
[IAM JSON policy elements reference](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements.html).
Source/tests: `apps/web/src/features/editor/model/connection-workflow.test.ts`,
`packages/provider-aws/src/catalog/connections/notes-api-connections.ts`,
`packages/provider-aws/src/catalog/connections/owned-configuration-connections.ts`,
`packages/provider-aws/src/catalog/services/iam-policy-document.ts`,
`packages/provider-aws/src/provider-extension-artifacts.test.ts`,
`services/iac-compiler/s3_accuracy_test.go`,
`services/iac-compiler/terraform_eventing_test.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_renderer.go`,
`services/iac-compiler/terraform_test.go`.

### `aws.lambda.owns-vpc-access-configuration`

Exact rule `1.0.0`;
`{"portId":"aws.lambda.vpc-access-configuration.function","serviceId":"aws.lambda.vpc-access-configuration"}`
→
`{"portId":"aws.lambda.function.vpc-access","serviceId":"aws.lambda.function"}`.
Max endpoint pair/source/target `[1,1,1]`. Configure VPC access on the function,
then select its subnets and security groups. The function remains a managed
Lambda service rather than becoming contained by the VPC. Binds at most one
graph-backed VPC configuration to the Lambda owner slot; subnet and
security-group associations remain separate exact edges.

Primary references:
[Configure a Lambda function to connect to a VPC](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/networking-connections.ts`,
`packages/provider-aws/src/catalog/services/lambda-vpc-access-configuration.ts`,
`packages/provider-aws/src/networking-catalog.test.ts`,
`packages/provider-aws/src/networking-policy.test.ts`,
`packages/provider-aws/src/networking-validation.test.ts`,
`packages/provider-aws/src/provider-extension-artifacts.test.ts`,
`services/iac-compiler/cloudformation_networking.go`,
`services/iac-compiler/terraform_networking.go`,
`services/iac-compiler/terraform_networking_test.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.lambda.publishes-to-sns`

Exact rule `1.0.0`;
`{"portId":"aws.lambda.function.event-publish","serviceId":"aws.lambda.function"}`
→ `{"portId":"aws.sns.topic.publish","serviceId":"aws.sns.topic"}`. Max endpoint
pair/source/target `[1,64,128]`. The function publishes one reviewed event
contract; each explicit subscription decides which consumers receive it.
Declares exact sns:Publish scope and at-least-once event-contract metadata; FIFO
message-group requirements are validated separately.

Primary references:
[AWS event-driven architecture guidance](https://docs.aws.amazon.com/whitepapers/latest/serverless-architectures-lambda/event-driven-architectures.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/event-driven-catalog.test.ts`,
`services/iac-compiler/terraform_eventing.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.lambda.puts-events-on-eventbridge`

Exact rule `1.0.0`;
`{"portId":"aws.lambda.function.event-publish","serviceId":"aws.lambda.function"}`
→
`{"portId":"aws.eventbridge.event-bus.publish","serviceId":"aws.eventbridge.event-bus"}`.
Max endpoint pair/source/target `[1,64,128]`. The function publishes an explicit
event contract to the bus; rules then decide which targets receive it. Declares
exact events:PutEvents scope and at-least-once outbound event-contract metadata
without inferring source or detail-type fields.

Primary references:
[AWS event-driven architecture guidance](https://docs.aws.amazon.com/whitepapers/latest/serverless-architectures-lambda/event-driven-architectures.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/event-driven-catalog.test.ts`,
`services/iac-compiler/terraform_eventing.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.lambda.reads-dynamodb-table`

Exact rule `1.0.0`;
`{"portId":"aws.lambda.function.data-read","serviceId":"aws.lambda.function"}` →
`{"portId":"aws.dynamodb.table.table-api","serviceId":"aws.dynamodb.table"}`.
Max endpoint pair/source/target `[1,16,64]`. The function reads from this table.
CloudMarkup also previews one generated read-only policy statement attached to
the function's role. The atomic recipe adds the read edge, one generated IAM
statement, and role/table scope edges. The read action set is fixed and resource
scope is a typed node reference.

Primary references:
[Using Lambda with Amazon DynamoDB](https://docs.aws.amazon.com/lambda/latest/dg/with-ddb.html).
Source/tests:
`apps/web/src/features/editor/model/configuration-command.test.ts`,
`apps/web/src/features/editor/model/connection-workflow.test.ts`,
`apps/web/src/features/editor/model/provider-catalog-adapter.test.ts`,
`packages/provider-aws/src/catalog/connections/notes-api-connections.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`packages/provider-aws/src/event-driven-catalog.test.ts`,
`services/iac-compiler/generation_golden_fixtures_test.go`,
`services/iac-compiler/generator_compatibility_test.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_renderer.go`,
`services/iac-compiler/terraform_test.go`.

### `aws.lambda.reads-s3-bucket`

Exact rule `1.0.0`;
`{"portId":"aws.lambda.function.data-read","serviceId":"aws.lambda.function"}` →
`{"portId":"aws.s3.bucket.object-api","serviceId":"aws.s3.bucket"}`. Max
endpoint pair/source/target `[1,16,64]`. Connect the Lambda execution role
first. Review the exact object permission before applying. Atomic relationship
plus generated role policy with a graph-bound bucket object ARN and exact
connection provenance. No ListBucket, DeleteObject, wildcard action or arbitrary
ARN.

Primary references:
[Using Lambda with Amazon S3](https://docs.aws.amazon.com/lambda/latest/dg/with-s3.html).
Source/tests: `services/iac-compiler/fsx.go`,
`services/iac-compiler/terraform_iam.go`.

### `aws.lambda.sends-message-to-sqs`

Exact rule `1.0.0`;
`{"portId":"aws.lambda.function.message-send","serviceId":"aws.lambda.function"}`
→ `{"portId":"aws.sqs.queue.message-send","serviceId":"aws.sqs.queue"}`. Max
endpoint pair/source/target `[1,64,128]`. This arrow points from the function to
the queue because the function actively sends. Choose ordered message groups
only when the event contract provides a stable key. Declares exact
sqs:SendMessage scope plus ordering and at-least-once metadata; FIFO
compatibility is deterministic validation rather than inferred from labels.

Primary references:
[AWS event-driven architecture guidance](https://docs.aws.amazon.com/whitepapers/latest/serverless-architectures-lambda/event-driven-architectures.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/event-driven-catalog.test.ts`,
`services/iac-compiler/terraform_eventing.go`,
`services/iac-compiler/terraform_eventing_test.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.lambda.starts-step-functions-state-machine`

Exact rule `1.0.0`;
`{"portId":"aws.lambda.function.workload-invocation","serviceId":"aws.lambda.function"}`
→
`{"portId":"aws.stepfunctions.state-machine.start-execution","serviceId":"aws.stepfunctions.state-machine"}`.
Max endpoint pair/source/target `[1,32,64]`. Use this when the function hands
off to a reviewed multi-step workflow; the input contract remains explicit.
Declares exact states:StartExecution scope and an outbound operation binding
without embedding state-machine details in application source.

Primary references:
[AWS event-driven architecture guidance](https://docs.aws.amazon.com/whitepapers/latest/serverless-architectures-lambda/event-driven-architectures.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/event-driven-catalog.test.ts`,
`services/iac-compiler/terraform_eventing.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.lambda.uses-sqs-dead-letter-queue`

Exact rule `1.0.0`;
`{"portId":"aws.lambda.function.dead-letter-destination","serviceId":"aws.lambda.function"}`
→ `{"portId":"aws.sqs.queue.dead-letter-target","serviceId":"aws.sqs.queue"}`.
Max endpoint pair/source/target `[1,1,64]`. Use a DLQ for asynchronous
invocation records that still fail after Lambda retries; investigate before
replay. Declares exact sqs:SendMessage scope for one Lambda DLQ association;
async destinations and automatic replay remain unsupported.

Primary references:
[AWS event-driven architecture guidance](https://docs.aws.amazon.com/whitepapers/latest/serverless-architectures-lambda/event-driven-architectures.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/event-driven-catalog.test.ts`,
`services/iac-compiler/cloudformation_eventing.go`,
`services/iac-compiler/terraform_eventing.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.lambda.vpc-access-uses-security-group`

Exact rule `1.0.0`;
`{"portId":"aws.lambda.vpc-access-configuration.security-group","serviceId":"aws.lambda.vpc-access-configuration"}`
→
`{"portId":"aws.ec2.security-group.lambda-vpc-access","serviceId":"aws.ec2.security-group"}`.
Max endpoint pair/source/target `[1,5,100]`. Choose security groups that allow
only the traffic this function needs. The groups remain associated policies
scoped to the same VPC as the selected subnets. Adds the exact
configuration-to-security-group association; same-VPC and rule-policy checks
remain deterministic validation facts.

Primary references:
[Configure a Lambda function to connect to a VPC](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/networking-connections.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`packages/provider-aws/src/networking-catalog.test.ts`,
`packages/provider-aws/src/networking-validation.test.ts`,
`services/iac-compiler/cloudformation_networking.go`,
`services/iac-compiler/terraform_networking.go`,
`services/iac-compiler/terraform_networking_test.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.lambda.vpc-access-uses-subnet`

Exact rule `1.0.0`;
`{"portId":"aws.lambda.vpc-access-configuration.subnet","serviceId":"aws.lambda.vpc-access-configuration"}`
→ `{"portId":"aws.ec2.subnet.lambda-vpc-access","serviceId":"aws.ec2.subnet"}`.
Max endpoint pair/source/target `[1,16,100]`. Select private subnets in more
than one Availability Zone when the workload needs resilient VPC access.
Internet access still depends on their routes. Adds the exact
configuration-to-subnet association; validators enforce same-VPC selection,
subnet access posture, and multi-AZ recommendations.

Primary references:
[Configure a Lambda function to connect to a VPC](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/networking-connections.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`packages/provider-aws/src/networking-catalog.test.ts`,
`packages/provider-aws/src/networking-validation.test.ts`,
`services/iac-compiler/cloudformation_networking.go`,
`services/iac-compiler/terraform_networking.go`,
`services/iac-compiler/terraform_networking_test.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.lambda.writes-dynamodb-table`

Exact rule `1.0.0`;
`{"portId":"aws.lambda.function.data-write","serviceId":"aws.lambda.function"}`
→ `{"portId":"aws.dynamodb.table.table-api","serviceId":"aws.dynamodb.table"}`.
Max endpoint pair/source/target `[1,16,64]`. The function writes to this table.
CloudMarkup also previews one generated write-only policy statement attached to
the function's role. The atomic recipe adds the write edge, one generated IAM
statement, and role/table scope edges. The write action set is fixed and
resource scope is a typed node reference.

Primary references:
[Using Lambda with Amazon DynamoDB](https://docs.aws.amazon.com/lambda/latest/dg/with-ddb.html).
Source/tests: `apps/web/src/features/editor/model/connection-workflow.test.ts`,
`apps/web/src/features/editor/model/provider-catalog-adapter.test.ts`,
`packages/provider-aws/src/catalog/connections/notes-api-connections.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`packages/provider-aws/src/event-driven-catalog.test.ts`,
`packages/provider-aws/src/validation.test.ts`,
`services/iac-compiler/generation_golden_fixtures_test.go`,
`services/iac-compiler/generator_compatibility_test.go`,
`services/iac-compiler/terraform_eventing_test.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_renderer.go`,
`services/iac-compiler/terraform_test.go`.

### `aws.lambda.writes-log-group`

Exact rule `1.0.0`;
`{"portId":"aws.lambda.function.logging","serviceId":"aws.lambda.function"}` →
`{"portId":"aws.cloudwatch.log-group.logs","serviceId":"aws.cloudwatch.log-group"}`.
Max endpoint pair/source/target `[1,1,1]`. The notes function can create a
stream and write application log events only in this selected group. The
connection exposes the exact logs:CreateLogStream and logs:PutLogEvents effects
scoped to the log-group target.

Primary references:
[Sending Lambda logs to CloudWatch Logs](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-cloudwatchlogs.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/notes-api-connections.ts`,
`packages/provider-aws/src/connection-resolution.test.ts`,
`packages/provider-aws/src/event-driven-catalog.test.ts`,
`services/iac-compiler/cloudformation_redrive_logging_test.go`,
`services/iac-compiler/cloudformation_resources.go`,
`services/iac-compiler/generator_compatibility_test.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_renderer.go`,
`services/iac-compiler/terraform_test.go`.

### `aws.lambda.writes-s3-bucket`

Exact rule `1.0.0`;
`{"portId":"aws.lambda.function.data-write","serviceId":"aws.lambda.function"}`
→ `{"portId":"aws.s3.bucket.object-api","serviceId":"aws.s3.bucket"}`. Max
endpoint pair/source/target `[1,16,64]`. Connect the Lambda execution role
first. Review the exact object permission before applying. Atomic relationship
plus generated role policy with a graph-bound bucket object ARN and exact
connection provenance. No ListBucket, DeleteObject, wildcard action or arbitrary
ARN.

Primary references:
[Using Lambda with Amazon S3](https://docs.aws.amazon.com/lambda/latest/dg/with-s3.html).
Source/tests: `services/iac-compiler/fsx.go`,
`services/iac-compiler/terraform_iam.go`.

### `aws.rds.instance-uses-parameter-group`

Exact rule `1.0.0`;
`{"portId":"aws.rds.db-parameter-group.instance","serviceId":"aws.rds.db-parameter-group"}`
→
`{"portId":"aws.rds.db-instance.parameter-group","serviceId":"aws.rds.db-instance"}`.
Max endpoint pair/source/target `[1,128,1]`. Connect reviewed database
networking/configuration. No ingress, credentials, permission or runtime health
is inferred. Exact versioned empty binding, endpoints and bounded cardinality;
native typed references only. Provisioning and external authority remain
independent.

Primary references:
[RDS-managed master credentials](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-secrets-manager.html),
[RDS PostgreSQL DB instance](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-rds-dbinstance.html).
Source/tests: `packages/provider-aws/src/catalog/services/rds-postgres.ts`,
`services/iac-compiler/rds.go`.

### `aws.rds.instance-uses-security-group`

Exact rule `1.0.0`;
`{"portId":"aws.rds.db-instance.security-group","serviceId":"aws.rds.db-instance"}`
→
`{"portId":"aws.ec2.security-group.rds-instance","serviceId":"aws.ec2.security-group"}`.
Max endpoint pair/source/target `[1,5,128]`. Connect reviewed database
networking/configuration. No ingress, credentials, permission or runtime health
is inferred. Exact versioned empty binding, endpoints and bounded cardinality;
native typed references only. Provisioning and external authority remain
independent.

Primary references:
[RDS-managed master credentials](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-secrets-manager.html),
[RDS PostgreSQL DB instance](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-rds-dbinstance.html).
Source/tests: `packages/provider-aws/src/catalog/services/rds-postgres.ts`,
`packages/provider-aws/src/rds-postgres.test.ts`,
`services/iac-compiler/rds.go`.

### `aws.rds.instance-uses-subnet-group`

Exact rule `1.0.0`;
`{"portId":"aws.rds.db-subnet-group.instance","serviceId":"aws.rds.db-subnet-group"}`
→
`{"portId":"aws.rds.db-instance.subnet-group","serviceId":"aws.rds.db-instance"}`.
Max endpoint pair/source/target `[1,128,1]`. Connect reviewed database
networking/configuration. No ingress, credentials, permission or runtime health
is inferred. Exact versioned empty binding, endpoints and bounded cardinality;
native typed references only. Provisioning and external authority remain
independent.

Primary references:
[RDS-managed master credentials](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-secrets-manager.html),
[RDS PostgreSQL DB instance](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-rds-dbinstance.html).
Source/tests: `packages/provider-aws/src/catalog/services/rds-postgres.ts`,
`services/iac-compiler/rds.go`.

### `aws.rds.subnet-group-uses-subnet`

Exact rule `1.0.0`;
`{"portId":"aws.rds.db-subnet-group.subnet","serviceId":"aws.rds.db-subnet-group"}`
→ `{"portId":"aws.ec2.subnet.rds-subnet-group","serviceId":"aws.ec2.subnet"}`.
Max endpoint pair/source/target `[1,16,128]`. Connect reviewed database
networking/configuration. No ingress, credentials, permission or runtime health
is inferred. Exact versioned empty binding, endpoints and bounded cardinality;
native typed references only. Provisioning and external authority remain
independent.

Primary references:
[RDS-managed master credentials](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-secrets-manager.html),
[RDS PostgreSQL DB instance](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-rds-dbinstance.html).
Source/tests: `packages/provider-aws/src/catalog/services/rds-postgres.ts`,
`services/iac-compiler/rds.go`.

### `aws.region.contains-vpc`

Exact rule `1.0.0`;
`{"portId":"aws.region.boundary.vpc-placement","serviceId":"aws.region.boundary"}`
→ `{"portId":"aws.ec2.vpc.region","serviceId":"aws.ec2.vpc"}`. Max endpoint
pair/source/target `[1,100,1]`. Place the VPC in the Region boundary selected
for this architecture. The boundary helps people read the diagram; it does not
create a second Region setting. Binds one VPC parent to the exact Region
boundary while the Architecture Document provider Region remains the canonical
regional value.

Primary references:
[What is Amazon VPC?](https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html).
Source/tests: `packages/provider-aws/src/aurora-postgres.test.ts`,
`packages/provider-aws/src/catalog/connections/networking-connections.ts`,
`packages/provider-aws/src/catalog/services/vpc.ts`,
`packages/provider-aws/src/ec2-compute.test.ts`,
`packages/provider-aws/src/networking-catalog.test.ts`,
`packages/provider-aws/src/networking-validation.test.ts`,
`packages/provider-aws/src/rds-postgres.test.ts`,
`services/iac-compiler/aurora_topology_test.go`,
`services/iac-compiler/ec2_test.go`,
`services/iac-compiler/ecs_rejection_test.go`,
`services/iac-compiler/rds_rejection_test.go`,
`services/iac-compiler/terraform_networking.go`,
`services/iac-compiler/terraform_networking_test.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.s3.bucket-notifies-lambda`

Exact rule `1.0.0`;
`{"portId":"aws.s3.bucket.notifications","serviceId":"aws.s3.bucket"}` →
`{"portId":"aws.lambda.function.asynchronous-invocation","serviceId":"aws.lambda.function"}`.
Max endpoint pair/source/target `[1,64,64]`. Choose the object event and
optional key filters. The function receives an asynchronous S3 event and must
tolerate duplicates and reordered delivery. Binds exact bucket and Lambda ports
with object event/filter configuration and a resource-scoped
lambda:InvokeFunction service-grant requirement qualified by SourceArn and
SourceAccount.

Primary references:
[AWS event-driven architecture guidance](https://docs.aws.amazon.com/whitepapers/latest/serverless-architectures-lambda/event-driven-architectures.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/event-driven-catalog.test.ts`,
`packages/provider-aws/src/validation.test.ts`.

### `aws.s3.bucket-owns-cors-configuration`

Exact rule `1.0.0`;
`{"portId":"aws.s3.bucket-cors-configuration.bucket","serviceId":"aws.s3.bucket-cors-configuration"}`
→ `{"portId":"aws.s3.bucket.cors-configuration","serviceId":"aws.s3.bucket"}`.
Max endpoint pair/source/target `[1,1,1]`. This setting belongs to exactly one
resource and remains separate from unrelated configuration. Binds one typed
graph-backed configuration to one exact owner slot with user/generated lifecycle
and adoption enforced by graph provenance.

Primary references:
[AWS event-driven architecture guidance](https://docs.aws.amazon.com/whitepapers/latest/serverless-architectures-lambda/event-driven-architectures.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/catalog/services/s3-eventing.ts`,
`services/iac-compiler/cloudformation_eventing.go`,
`services/iac-compiler/terraform_eventing.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.s3.bucket-owns-lifecycle-configuration`

Exact rule `1.0.0`;
`{"portId":"aws.s3.bucket-lifecycle-configuration.bucket","serviceId":"aws.s3.bucket-lifecycle-configuration"}`
→
`{"portId":"aws.s3.bucket.lifecycle-configuration","serviceId":"aws.s3.bucket"}`.
Max endpoint pair/source/target `[1,1,1]`. This setting belongs to exactly one
resource and remains separate from unrelated configuration. Binds one typed
graph-backed configuration to one exact owner slot with user/generated lifecycle
and adoption enforced by graph provenance.

Primary references:
[AWS event-driven architecture guidance](https://docs.aws.amazon.com/whitepapers/latest/serverless-architectures-lambda/event-driven-architectures.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/catalog/services/s3-eventing.ts`,
`services/iac-compiler/cloudformation_eventing.go`,
`services/iac-compiler/terraform_eventing.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.s3.bucket-owns-notification-configuration`

Exact rule `1.0.0`;
`{"portId":"aws.s3.bucket-notification-configuration.bucket","serviceId":"aws.s3.bucket-notification-configuration"}`
→
`{"portId":"aws.s3.bucket.notification-configuration","serviceId":"aws.s3.bucket"}`.
Max endpoint pair/source/target `[1,1,100]`. This setting belongs to exactly one
resource and remains separate from unrelated configuration. Binds one typed
graph-backed configuration to one exact owner slot with user/generated lifecycle
and adoption enforced by graph provenance.

Primary references:
[AWS event-driven architecture guidance](https://docs.aws.amazon.com/whitepapers/latest/serverless-architectures-lambda/event-driven-architectures.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/catalog/services/s3-eventing.ts`,
`services/iac-compiler/cloudformation_eventing.go`,
`services/iac-compiler/terraform_eventing.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.s3.bucket-owns-resource-policy`

Exact rule `1.0.0`;
`{"portId":"aws.iam.policy-document.s3-bucket-resource-policy","serviceId":"aws.iam.policy-document"}`
→ `{"portId":"aws.s3.bucket.resource-policy","serviceId":"aws.s3.bucket"}`. Max
endpoint pair/source/target `[1,1,1]`. This resource policy belongs to one exact
service and stays separate from execution-role permissions. Binds one canonical
resource-policy document to one owner slot; principals, actions, scopes,
conditions, lifecycle, and adoption remain typed graph facts.

Primary references:
[AWS event-driven architecture guidance](https://docs.aws.amazon.com/whitepapers/latest/serverless-architectures-lambda/event-driven-architectures.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/catalog/services/iam-policy-document.ts`,
`packages/provider-aws/src/cloudfront.test.ts`,
`packages/provider-aws/src/validation.test.ts`,
`services/iac-compiler/cloudfront.go`,
`services/iac-compiler/cloudfront_test.go`,
`services/iac-compiler/terraform_eventing.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.s3.bucket-sends-events-to-eventbridge`

Exact rule `1.0.0`;
`{"portId":"aws.s3.bucket.eventbridge","serviceId":"aws.s3.bucket"}` →
`{"portId":"aws.eventbridge.event-bus.aws-service-events","serviceId":"aws.eventbridge.event-bus"}`.
Max endpoint pair/source/target `[1,1,1000]`. Use EventBridge when separate
consumers should own separate matching rules instead of sharing one bucket
notification configuration. Associates one bucket with the same-Region default
EventBridge bus; custom buses and direct PutEvents are not substituted for AWS
service-event delivery.

Primary references:
[AWS event-driven architecture guidance](https://docs.aws.amazon.com/whitepapers/latest/serverless-architectures-lambda/event-driven-architectures.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/event-driven-catalog.test.ts`.

### `aws.sns.subscription-invokes-lambda`

Exact rule `1.0.0`;
`{"portId":"aws.sns.subscription.lambda-delivery","serviceId":"aws.sns.subscription"}`
→
`{"portId":"aws.lambda.function.asynchronous-invocation","serviceId":"aws.lambda.function"}`.
Max endpoint pair/source/target `[1,1,64]`. The Lambda receives the SNS envelope
and must validate the bound event contract and handle duplicate delivery.
Requires a resource-scoped lambda:InvokeFunction service grant qualified by the
owning topic SourceArn and preserves at-least-once subscription delivery.

Primary references:
[AWS event-driven architecture guidance](https://docs.aws.amazon.com/whitepapers/latest/serverless-architectures-lambda/event-driven-architectures.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/event-driven-catalog.test.ts`,
`services/iac-compiler/cloudformation_eventing.go`,
`services/iac-compiler/generator_compatibility_test.go`,
`services/iac-compiler/terraform_eventing.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.sns.subscription-sends-to-sqs`

Exact rule `1.0.0`;
`{"portId":"aws.sns.subscription.queue-delivery","serviceId":"aws.sns.subscription"}`
→ `{"portId":"aws.sqs.queue.message-send","serviceId":"aws.sqs.queue"}`. Max
endpoint pair/source/target `[1,1,100]`. Use a queue subscription when a
consumer needs durable buffering and independent retry. Requires an exact queue
resource-policy statement for sns:SendMessage qualified by the owning topic
SourceArn; FIFO combinations remain validation-bound.

Primary references:
[AWS event-driven architecture guidance](https://docs.aws.amazon.com/whitepapers/latest/serverless-architectures-lambda/event-driven-architectures.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/event-driven-catalog.test.ts`,
`services/iac-compiler/cloudformation_eventing.go`,
`services/iac-compiler/generator_compatibility_test.go`,
`services/iac-compiler/terraform_eventing.go`,
`services/iac-compiler/terraform_eventing_test.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.sns.topic-owns-resource-policy`

Exact rule `1.0.0`;
`{"portId":"aws.iam.policy-document.sns-topic-resource-policy","serviceId":"aws.iam.policy-document"}`
→ `{"portId":"aws.sns.topic.resource-policy","serviceId":"aws.sns.topic"}`. Max
endpoint pair/source/target `[1,1,1]`. This resource policy belongs to one exact
service and stays separate from execution-role permissions. Binds one canonical
resource-policy document to one owner slot; principals, actions, scopes,
conditions, lifecycle, and adoption remain typed graph facts.

Primary references:
[AWS event-driven architecture guidance](https://docs.aws.amazon.com/whitepapers/latest/serverless-architectures-lambda/event-driven-architectures.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/catalog/services/iam-policy-document.ts`,
`packages/provider-aws/src/validation.test.ts`,
`services/iac-compiler/terraform_eventing.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.sns.topic-owns-subscription`

Exact rule `1.0.0`;
`{"portId":"aws.sns.topic.subscriptions","serviceId":"aws.sns.topic"}` →
`{"portId":"aws.sns.subscription.topic","serviceId":"aws.sns.subscription"}`.
Max endpoint pair/source/target `[1,100,1]`. Each subscription is one visible
fan-out branch with its own target and optional filter. Binds one graph-backed
subscription configuration to exactly one topic; protocol, filter, retry,
raw-delivery, and delivery semantics remain typed node configuration.

Primary references:
[AWS event-driven architecture guidance](https://docs.aws.amazon.com/whitepapers/latest/serverless-architectures-lambda/event-driven-architectures.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/catalog/services/sns-eventing.ts`,
`packages/provider-aws/src/event-driven-catalog.test.ts`,
`services/iac-compiler/cloudformation_eventing.go`,
`services/iac-compiler/terraform_eventing.go`,
`services/iac-compiler/terraform_eventing_test.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.sqs.queue-owns-redrive-configuration`

Exact rule `1.0.0`;
`{"portId":"aws.sqs.redrive-configuration.queue","serviceId":"aws.sqs.redrive-configuration"}`
→
`{"portId":"aws.sqs.queue.redrive-configuration","serviceId":"aws.sqs.queue"}`.
Max endpoint pair/source/target `[1,1,1]`. This setting belongs to exactly one
resource and remains separate from unrelated configuration. Binds one typed
graph-backed configuration to one exact owner slot with user/generated lifecycle
and adoption enforced by graph provenance.

Primary references:
[AWS event-driven architecture guidance](https://docs.aws.amazon.com/whitepapers/latest/serverless-architectures-lambda/event-driven-architectures.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/catalog/services/sqs-eventing.ts`,
`services/iac-compiler/cloudformation_eventing.go`,
`services/iac-compiler/terraform_eventing.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.sqs.queue-owns-resource-policy`

Exact rule `1.0.0`;
`{"portId":"aws.iam.policy-document.sqs-queue-resource-policy","serviceId":"aws.iam.policy-document"}`
→ `{"portId":"aws.sqs.queue.resource-policy","serviceId":"aws.sqs.queue"}`. Max
endpoint pair/source/target `[1,1,1]`. This resource policy belongs to one exact
service and stays separate from execution-role permissions. Binds one canonical
resource-policy document to one owner slot; principals, actions, scopes,
conditions, lifecycle, and adoption remain typed graph facts.

Primary references:
[AWS event-driven architecture guidance](https://docs.aws.amazon.com/whitepapers/latest/serverless-architectures-lambda/event-driven-architectures.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/catalog/services/iam-policy-document.ts`,
`packages/provider-aws/src/validation.test.ts`,
`services/iac-compiler/terraform_eventing.go`,
`services/iac-compiler/terraform_eventing_test.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_renderer.go`.

### `aws.sqs.queue-triggers-lambda`

Exact rule `1.0.0`;
`{"portId":"aws.sqs.queue.event-source","serviceId":"aws.sqs.queue"}` →
`{"portId":"aws.lambda.function.event-source","serviceId":"aws.lambda.function"}`.
Max endpoint pair/source/target `[1,32,32]`. This arrow points from the queue to
the function because Lambda polls and consumes. Choose batch, wait, and
concurrency bounds, and retry only failed records. Declares an SQS event-source
mapping with exact consume actions, bounded batch/window/concurrency, partial
batch response, same-Region requirement, and at-least-once semantics.

Primary references:
[AWS event-driven architecture guidance](https://docs.aws.amazon.com/whitepapers/latest/serverless-architectures-lambda/event-driven-architectures.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/event-driven-catalog.test.ts`.

### `aws.sqs.queue-uses-dead-letter-queue`

Exact rule `1.0.0`;
`{"portId":"aws.sqs.queue.redrive","serviceId":"aws.sqs.queue"}` →
`{"portId":"aws.sqs.queue.dead-letter-target","serviceId":"aws.sqs.queue"}`. Max
endpoint pair/source/target `[1,1,10]`. A DLQ is another queue. Choose the
failed-receive count and investigate before manually replaying messages. Binds
one source queue to one Standard/Standard or FIFO/FIFO dead-letter queue with
bounded maxReceiveCount, byQueue policy posture, manual replay, and cycle
validation.

Primary references:
[AWS event-driven architecture guidance](https://docs.aws.amazon.com/whitepapers/latest/serverless-architectures-lambda/event-driven-architectures.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/event-driven-catalog.test.ts`.

### `aws.stepfunctions.state-machine-invokes-lambda`

Exact rule `1.0.0`;
`{"portId":"aws.stepfunctions.state-machine.lambda-task","serviceId":"aws.stepfunctions.state-machine"}`
→
`{"portId":"aws.lambda.function.synchronous-invocation","serviceId":"aws.lambda.function"}`.
Max endpoint pair/source/target `[16,64,64]`. Choose a task timeout and retry
count that fit the function timeout and idempotency behavior. Declares an exact
Lambda task operation with lambda:InvokeFunction scope, bounded timeout/retry
semantics, and no raw ASL or payload template.

Primary references:
[AWS event-driven architecture guidance](https://docs.aws.amazon.com/whitepapers/latest/serverless-architectures-lambda/event-driven-architectures.html).
Source/tests:
`packages/provider-aws/src/catalog/connections/event-driven-connections.ts`,
`packages/provider-aws/src/event-driven-catalog.test.ts`,
`services/iac-compiler/cloudformation_eventing.go`,
`services/iac-compiler/generator_compatibility_test.go`,
`services/iac-compiler/terraform_eventing.go`,
`services/iac-compiler/terraform_eventing_test.go`,
`services/iac-compiler/terraform_iam.go`,
`services/iac-compiler/terraform_renderer.go`.

## Registered validators — every 33

| ID                                                      | Implementation / version                                                     | Affected definitions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Primary references                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| aws.cloudmarkup.validation.api-route-authentication     | aws.cloudmarkup.validation.evaluate-api-route-authentication / 1 / 1.0.0     | ["aws.apigateway.http-api","aws.cognito.user-pool","aws.cognito.user-pool-client","aws.lambda.function"]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | [Control access to HTTP APIs with JWT authorizers](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| aws.cloudmarkup.validation.aurora-postgres-readiness    | aws.cloudmarkup.validation.aurora-postgres-readiness.evaluate / 1 / 1.0.0    | ["aws.aurora.postgresql-cluster","aws.aurora.postgresql-cluster-parameter-group","aws.aurora.postgresql-instance","aws.ec2.security-group","aws.ec2.subnet","aws.rds.db-subnet-group"]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | [RDS-managed master credentials](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-secrets-manager.html), [Aurora PostgreSQL DB cluster](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-rds-dbcluster.html)                                                                                                                                                                                                                                                                                                                                                                                                                          |
| aws.cloudmarkup.validation.cloudfront-readiness         | aws.cloudmarkup.validation.cloudfront-readiness.evaluate / 1 / 1.0.0         | ["aws.acm.public-dns-certificate","aws.cloudfront.alias-configuration","aws.cloudfront.cache-policy","aws.cloudfront.distribution","aws.s3.bucket"]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | [CloudFront distribution](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-cloudfront-distribution.html), [Private S3 origin access](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html), [Viewer certificate requirements](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html)                                                                                                                                                                                                                                                      |
| aws.cloudmarkup.validation.compiler-readiness           | aws.cloudmarkup.validation.evaluate-compiler-readiness / 1 / 1.0.0           | ["aws.acm.public-dns-certificate","aws.apigateway.http-api","aws.aurora.postgresql-cluster","aws.aurora.postgresql-cluster-parameter-group","aws.aurora.postgresql-instance","aws.cloudfront.alias-configuration","aws.cloudfront.cache-policy","aws.cloudfront.distribution","aws.cloudwatch.log-group","aws.cloudwatch.metric-alarm","aws.cognito.user-pool","aws.cognito.user-pool-client","aws.dynamodb.table","aws.ebs.volume","aws.ebs.volume-attachment","aws.ec2.availability-zone","aws.ec2.gateway-vpc-endpoint","aws.ec2.instance","aws.ec2.internet-gateway","aws.ec2.nat-gateway","aws.ec2.route","aws.ec2.route-table","aws.ec2.route-table-association","aws.ec2.security-group","aws.ec2.security-group-egress-rule","aws.ec2.security-group-ingress-rule","aws.ec2.subnet","aws.ec2.vpc","aws.ecr.image-reference","aws.ecr.repository","aws.ecs.cluster","aws.ecs.container-definition","aws.ecs.service","aws.ecs.task-definition","aws.elb.application-load-balancer","aws.elb.backend-access-configuration","aws.elb.https-listener","aws.elb.target-group","aws.iam.instance-profile","aws.iam.managed-policy-attachment","aws.iam.policy-condition","aws.iam.policy-document","aws.iam.policy-statement","aws.iam.role","aws.kms.key","aws.lambda.function","aws.lambda.vpc-access-configuration","aws.rds.db-instance","aws.rds.db-parameter-group","aws.rds.db-subnet-group","aws.region.boundary","aws.route53.public-hosted-zone","aws.secretsmanager.secret"] | [Provider compiler mapping authoring](PROVIDER_CATALOG.md#add-a-compiler-mapping)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| aws.cloudmarkup.validation.connection-cardinality       | aws.cloudmarkup.validation.evaluate-connection-cardinality / 1 / 1.0.0       | ["aws.acm.public-dns-certificate","aws.apigateway.http-api","aws.aurora.postgresql-cluster","aws.aurora.postgresql-cluster-parameter-group","aws.aurora.postgresql-instance","aws.cloudfront.alias-configuration","aws.cloudfront.cache-policy","aws.cloudfront.distribution","aws.cloudwatch.log-group","aws.cloudwatch.metric-alarm","aws.cognito.user-pool","aws.cognito.user-pool-client","aws.dynamodb.table","aws.ebs.volume","aws.ebs.volume-attachment","aws.ec2.availability-zone","aws.ec2.gateway-vpc-endpoint","aws.ec2.instance","aws.ec2.internet-gateway","aws.ec2.nat-gateway","aws.ec2.route","aws.ec2.route-table","aws.ec2.route-table-association","aws.ec2.security-group","aws.ec2.security-group-egress-rule","aws.ec2.security-group-ingress-rule","aws.ec2.subnet","aws.ec2.vpc","aws.ecr.image-reference","aws.ecr.repository","aws.ecs.cluster","aws.ecs.container-definition","aws.ecs.service","aws.ecs.task-definition","aws.elb.application-load-balancer","aws.elb.backend-access-configuration","aws.elb.https-listener","aws.elb.target-group","aws.iam.instance-profile","aws.iam.managed-policy-attachment","aws.iam.policy-condition","aws.iam.policy-document","aws.iam.policy-statement","aws.iam.role","aws.kms.key","aws.lambda.function","aws.lambda.vpc-access-configuration","aws.rds.db-instance","aws.rds.db-parameter-group","aws.rds.db-subnet-group","aws.region.boundary","aws.route53.public-hosted-zone","aws.secretsmanager.secret"] | [Provider connection authoring](PROVIDER_CATALOG.md#add-a-connection-rule)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| aws.cloudmarkup.validation.connection-questions         | aws.cloudmarkup.validation.evaluate-connection-questions / 1 / 1.0.0         | ["aws.apigateway.http-api","aws.dynamodb.table","aws.lambda.function"]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | [Provider connection authoring](PROVIDER_CATALOG.md#add-a-connection-rule)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| aws.cloudmarkup.validation.dns-certificate-readiness    | aws.cloudmarkup.validation.dns-certificate-readiness.evaluate / 1 / 1.0.0    | ["aws.acm.public-dns-certificate","aws.route53.public-hosted-zone"]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | [Public DNS certificate](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-certificatemanager-certificate.html), [CloudFront viewer certificate Region](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html), [Public hosted zone](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-route53-hostedzone.html)                                                                                                                                                                                                                                                      |
| aws.cloudmarkup.validation.dynamodb-protection          | aws.cloudmarkup.validation.evaluate-dynamodb-protection / 1 / 1.0.0          | ["aws.dynamodb.table"]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | [DynamoDB encryption at rest](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/EncryptionAtRest.html), [Point-in-time recovery for DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/PointInTimeRecovery.html)                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| aws.cloudmarkup.validation.ebs-readiness                | aws.cloudmarkup.validation.ebs-readiness.evaluate / 1 / 1.0.0                | ["aws.ebs.volume","aws.ebs.volume-attachment","aws.ec2.availability-zone","aws.ec2.instance","aws.kms.key"]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | [Linux EC2 device naming](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/device_naming.html), [EBS native volume](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-volume.html)                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| aws.cloudmarkup.validation.ec2-readiness                | aws.cloudmarkup.validation.ec2-readiness.evaluate / 1 / 1.0.0                | ["aws.ec2.instance","aws.ec2.security-group","aws.ec2.subnet","aws.iam.instance-profile","aws.iam.role","aws.kms.key"]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | [AMI identity and compatibility](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/AMIs.html), [EC2 instance properties and replacement](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-instance.html), [EC2 instance profile](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-iam-instanceprofile.html)                                                                                                                                                                                                                                                                                                  |
| aws.cloudmarkup.validation.ecs-fargate-readiness        | aws.cloudmarkup.validation.ecs-fargate-readiness.evaluate / 1 / 1.0.0        | ["aws.cloudwatch.log-group","aws.ec2.security-group","aws.ec2.subnet","aws.ecr.image-reference","aws.ecr.repository","aws.ecs.cluster","aws.ecs.container-definition","aws.ecs.service","aws.ecs.task-definition","aws.iam.role","aws.secretsmanager.secret"]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | [ECR repository native contract](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecr-repository.html), [ECS task definition parameters](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html)                                                                                                                                                                                                                                                                                                                                                                                                                 |
| aws.cloudmarkup.validation.elb-readiness                | aws.cloudmarkup.validation.elb-readiness.evaluate / 1 / 1.0.0                | ["aws.acm.public-dns-certificate","aws.ec2.instance","aws.ec2.security-group","aws.ec2.subnet","aws.ec2.vpc","aws.ecs.service","aws.elb.application-load-balancer","aws.elb.backend-access-configuration","aws.elb.https-listener","aws.elb.target-group"]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | [ALB security group paths](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-update-security-groups.html), [ALB native contract](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-loadbalancer.html), [ECS ALB integration](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/alb.html), [HTTPS listener](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-listener.html), [ALB target group](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-targetgroup.html) |
| aws.cloudmarkup.validation.event-delivery               | aws.cloudmarkup.validation.evaluate-event-delivery / 1 / 1.0.0               | ["aws.eventbridge.event-bus","aws.eventbridge.rule","aws.eventbridge.target","aws.iam.policy-document","aws.iam.policy-statement","aws.lambda.function","aws.s3.bucket","aws.s3.bucket-notification-configuration","aws.sns.subscription","aws.sns.topic","aws.sqs.queue","aws.sqs.redrive-configuration","aws.stepfunctions.state-machine"]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | [Using Lambda with Amazon SQS](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html), [Using dead-letter queues in Amazon SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| aws.cloudmarkup.validation.event-topology               | aws.cloudmarkup.validation.evaluate-event-topology / 1 / 1.0.0               | ["aws.eventbridge.event-bus","aws.eventbridge.rule","aws.eventbridge.target","aws.lambda.function","aws.s3.bucket","aws.s3.bucket-notification-configuration","aws.sns.subscription","aws.sns.topic","aws.sqs.queue","aws.sqs.redrive-configuration","aws.stepfunctions.state-machine"]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | [Building serverless applications with event-driven architectures](https://docs.aws.amazon.com/lambda/latest/dg/concepts-event-driven-architectures.html)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| aws.cloudmarkup.validation.fsx-readiness                | aws.cloudmarkup.validation.fsx-readiness.evaluate / 1 / 1.0.0                | ["aws.ec2.security-group","aws.ec2.subnet","aws.fsx.lustre-file-system","aws.fsx.ontap-file-system","aws.fsx.ontap-storage-virtual-machine","aws.fsx.ontap-volume","aws.fsx.openzfs-file-system","aws.fsx.windows-file-system","aws.s3.bucket"]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | [Amazon FSx file systems](https://docs.aws.amazon.com/fsx/latest/APIReference/API_CreateFileSystem.html)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| aws.cloudmarkup.validation.fsx-storage-capacity         | aws.cloudmarkup.validation.fsx-storage-capacity.evaluate / 1 / 1.0.0         | ["aws.fsx.lustre-file-system","aws.fsx.ontap-file-system"]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | [FSx storage capacity by deployment type and HA pairs](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-fsx-filesystem.html#cfn-fsx-filesystem-storagecapacity)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| aws.cloudmarkup.validation.iam-policy-safety            | aws.cloudmarkup.validation.evaluate-iam-policy-safety / 1 / 1.0.0            | ["aws.iam.managed-policy-attachment","aws.iam.policy-condition","aws.iam.policy-document","aws.iam.policy-statement","aws.iam.role"]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | [IAM JSON policy elements reference](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements.html)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| aws.cloudmarkup.validation.iam-wildcards                | aws.cloudmarkup.validation.evaluate-iam-wildcards / 1 / 1.0.0                | ["aws.iam.policy-statement"]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | [Apply least-privilege permissions](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| aws.cloudmarkup.validation.kms-key-readiness            | aws.cloudmarkup.validation.kms-key-readiness.evaluate / 1 / 1.0.0            | ["aws.iam.policy-document","aws.iam.policy-statement","aws.kms.key"]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | [AWS KMS key resource and policy requirements](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-kms-key.html)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| aws.cloudmarkup.validation.lambda-dynamodb-actions      | aws.cloudmarkup.validation.evaluate-lambda-dynamodb-actions / 1 / 1.0.0      | ["aws.dynamodb.table","aws.iam.policy-statement","aws.iam.role","aws.lambda.function"]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | [Identity-based policy examples for DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/security_iam_id-based-policy-examples.html)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| aws.cloudmarkup.validation.lambda-execution-role        | aws.cloudmarkup.validation.evaluate-lambda-execution-role / 1 / 1.0.0        | ["aws.iam.role","aws.lambda.function"]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | [Lambda execution role](https://docs.aws.amazon.com/lambda/latest/dg/lambda-intro-execution-role.html)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| aws.cloudmarkup.validation.lambda-runtime-bounds        | aws.cloudmarkup.validation.evaluate-lambda-runtime-bounds / 1 / 1.0.0        | ["aws.lambda.function"]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | [Configuring Lambda function options](https://docs.aws.amazon.com/lambda/latest/dg/configuration-function-common.html)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| aws.cloudmarkup.validation.lambda-trigger-compatibility | aws.cloudmarkup.validation.evaluate-lambda-trigger-compatibility / 1 / 1.0.0 | ["aws.lambda.function"]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | [Lambda event-driven invocation](https://docs.aws.amazon.com/lambda/latest/dg/concepts-event-driven-architectures.html)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| aws.cloudmarkup.validation.lambda-vpc-access            | aws.cloudmarkup.validation.evaluate-lambda-vpc-access / 1 / 1.1.0            | ["aws.ec2.gateway-vpc-endpoint","aws.ec2.nat-gateway","aws.ec2.route","aws.ec2.route-table","aws.ec2.route-table-association","aws.ec2.security-group","aws.ec2.subnet","aws.ec2.vpc","aws.iam.managed-policy-attachment","aws.iam.role","aws.lambda.function","aws.lambda.vpc-access-configuration"]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | [Giving Lambda functions access to resources in an Amazon VPC](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html), [Enable internet access for VPC-connected Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc-internet.html)                                                                                                                                                                                                                                                                                                                                                                                                           |
| aws.cloudmarkup.validation.log-retention                | aws.cloudmarkup.validation.evaluate-log-retention / 1 / 1.0.0                | ["aws.cloudwatch.log-group"]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | [Change log data retention in CloudWatch Logs](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/Working-with-log-groups-and-streams.html)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| aws.cloudmarkup.validation.network-placement            | aws.cloudmarkup.validation.evaluate-network-placement / 1 / 1.0.0            | ["aws.dynamodb.table","aws.ec2.availability-zone","aws.ec2.gateway-vpc-endpoint","aws.ec2.internet-gateway","aws.ec2.nat-gateway","aws.ec2.route","aws.ec2.route-table","aws.ec2.route-table-association","aws.ec2.security-group","aws.ec2.security-group-egress-rule","aws.ec2.security-group-ingress-rule","aws.ec2.subnet","aws.ec2.vpc","aws.lambda.function","aws.lambda.vpc-access-configuration","aws.region.boundary"]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | [What is Amazon VPC?](https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html), [Subnet CIDR blocks](https://docs.aws.amazon.com/vpc/latest/userguide/subnet-sizing.html)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| aws.cloudmarkup.validation.network-routing              | aws.cloudmarkup.validation.evaluate-network-routing / 1 / 1.1.0              | ["aws.ec2.gateway-vpc-endpoint","aws.ec2.internet-gateway","aws.ec2.nat-gateway","aws.ec2.route","aws.ec2.route-table","aws.ec2.route-table-association","aws.ec2.subnet","aws.ec2.vpc","aws.iam.policy-document"]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | [Gateway endpoints](https://docs.aws.amazon.com/vpc/latest/privatelink/gateway-endpoints.html), [Pricing for NAT gateways](https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-pricing.html), [Subnet route tables](https://docs.aws.amazon.com/vpc/latest/userguide/subnet-route-tables.html)                                                                                                                                                                                                                                                                                                                                                                                  |
| aws.cloudmarkup.validation.rds-postgres-readiness       | aws.cloudmarkup.validation.rds-postgres-readiness.evaluate / 1 / 1.0.0       | ["aws.ec2.security-group","aws.ec2.subnet","aws.rds.db-instance","aws.rds.db-parameter-group","aws.rds.db-subnet-group"]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | [RDS-managed master credentials](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-secrets-manager.html), [RDS PostgreSQL DB instance](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-rds-dbinstance.html)                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| aws.cloudmarkup.validation.region-availability          | aws.cloudmarkup.validation.evaluate-region-availability / 1 / 1.0.0          | ["aws.acm.public-dns-certificate","aws.apigateway.http-api","aws.aurora.postgresql-cluster","aws.aurora.postgresql-cluster-parameter-group","aws.aurora.postgresql-instance","aws.cloudfront.alias-configuration","aws.cloudfront.cache-policy","aws.cloudfront.distribution","aws.cloudwatch.log-group","aws.cloudwatch.metric-alarm","aws.cognito.user-pool","aws.cognito.user-pool-client","aws.dynamodb.table","aws.ebs.volume","aws.ebs.volume-attachment","aws.ec2.availability-zone","aws.ec2.gateway-vpc-endpoint","aws.ec2.instance","aws.ec2.internet-gateway","aws.ec2.nat-gateway","aws.ec2.route","aws.ec2.route-table","aws.ec2.route-table-association","aws.ec2.security-group","aws.ec2.security-group-egress-rule","aws.ec2.security-group-ingress-rule","aws.ec2.subnet","aws.ec2.vpc","aws.ecr.image-reference","aws.ecr.repository","aws.ecs.cluster","aws.ecs.container-definition","aws.ecs.service","aws.ecs.task-definition","aws.elb.application-load-balancer","aws.elb.backend-access-configuration","aws.elb.https-listener","aws.elb.target-group","aws.iam.instance-profile","aws.kms.key","aws.lambda.function","aws.lambda.vpc-access-configuration","aws.rds.db-instance","aws.rds.db-parameter-group","aws.rds.db-subnet-group","aws.region.boundary","aws.route53.public-hosted-zone","aws.secretsmanager.secret"]                                                                                                                                    | [AWS services by Region](https://aws.amazon.com/about-aws/global-infrastructure/regional-product-services/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| aws.cloudmarkup.validation.s3-bucket-name               | aws.cloudmarkup.validation.s3-bucket-name.evaluate / 1 / 1.0.0               | ["aws.s3.bucket"]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | [General purpose bucket naming rules](https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| aws.cloudmarkup.validation.s3-notification-filters      | aws.cloudmarkup.validation.s3-notification-filters.evaluate / 1 / 1.0.0      | ["aws.s3.bucket"]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | [S3 notification object-key filtering](https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-how-to-filtering.html)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| aws.cloudmarkup.validation.secret-readiness             | aws.cloudmarkup.validation.secret-readiness.evaluate / 1 / 1.0.0             | ["aws.iam.policy-statement","aws.kms.key","aws.secretsmanager.secret"]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | [Secrets Manager encryption permissions](https://docs.aws.amazon.com/secretsmanager/latest/userguide/security-encryption.html), [Secrets Manager metadata, encryption and lifecycle](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-secretsmanager-secret.html)                                                                                                                                                                                                                                                                                                                                                                                     |
| aws.cloudmarkup.validation.security-group-policy        | aws.cloudmarkup.validation.evaluate-security-group-policy / 1 / 1.0.0        | ["aws.ec2.security-group","aws.ec2.security-group-egress-rule","aws.ec2.security-group-ingress-rule"]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | [Configure security group rules](https://docs.aws.amazon.com/vpc/latest/userguide/working-with-security-group-rules.html)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## Primary documentation coverage and citation limits

Current primary AWS pages were browsed and downloaded for exact source
verification. The receipt records98 requested references and95 usable markdown
bodies at2026-10-06T14:47:34.401Z. All55 native CloudFormation mapping rows have
a retrieved current resource page. The133 direct metadata field roots were
checked; SNS StableIdentity is the one unrecognized native property. This
lexical/type check does not prove every nested value, semantic alias, generated
relationship, AWS entitlement or deployability. Renderer/validator tests and the
human decisions above provide the remaining bounded review. Raw AWS documents
are not reproduced in this report.

Three catalog education paths have no usable markdown and current HTML redirects
were checked: CloudWatch AlarmThatSendsEmail→CloudWatch_Alarms, Cognito user
directory→cognito-guided-setup, Lambda
configuration-function-common→lambda-functions. Cognito redirect is a workshop
landing page; prefer a specific current user-pool reference when refreshing
education.

| Reference                                                                                                                                                                                          | Kind / affected definitions                                                                                                                                                                          | Retrieved / hash                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [CloudFront viewer certificate Region](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html)                                                      | catalog-documentation / aws.acm.public-dns-certificate, aws.cloudfront.alias-configuration, aws.cloudfront.cache-policy, aws.cloudfront.distribution, aws.route53.public-hosted-zone                 | SHA-256 a8b9e234cc9c51fc5d3094ec7dfe254ba3a288121d67c1b185467859a572793f |
| [Private S3 origin access](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)                                                       | catalog-documentation / aws.cloudfront.alias-configuration, aws.cloudfront.cache-policy, aws.cloudfront.distribution                                                                                 | SHA-256 bfc5a9b74c0110c9fcea993fcd6bf10df73a5a52d036c5759d2eb442d46b5a51 |
| [Working with log groups and log streams](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/Working-with-log-groups-and-streams.html)                                                       | catalog-documentation / aws.cloudwatch.log-group                                                                                                                                                     | SHA-256 62494b6dd43fee024d8d1e3c404204c59b2c7fa2570efa8efa71036edf024471 |
| [Using Amazon CloudWatch alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/AlarmThatSendsEmail.html)                                                                          | catalog-documentation / aws.cloudwatch.metric-alarm                                                                                                                                                  | markdown status 404; HTML redirect reviewed                              |
| [Core components of Amazon DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.CoreComponents.html)                                                              | catalog-documentation / aws.dynamodb.table                                                                                                                                                           | SHA-256 5d89ed0b83c02bc2d931990f3f070baf3b96b3be466c209d5e621a26021fe759 |
| [ECS ALB integration](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/alb.html)                                                                                                        | catalog-documentation / aws.elb.application-load-balancer, aws.elb.backend-access-configuration, aws.elb.https-listener, aws.elb.target-group                                                        | SHA-256 738141c4c216e6a806a552994d2ca978fee07f840e6fe12f655bf2dcec93b437 |
| [ECS task definition parameters](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html)                                                                      | catalog-documentation / aws.ecr.image-reference, aws.ecr.repository, aws.ecs.cluster, aws.ecs.container-definition, aws.ecs.service, aws.ecs.task-definition                                         | SHA-256 28c8a102b9d61db02261135fe5645396ed8c016c35d2f3b24d4f2cdf4b9642dc |
| [RDS-managed master credentials](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-secrets-manager.html)                                                                            | catalog-documentation / aws.aurora.postgresql-cluster, aws.aurora.postgresql-cluster-parameter-group, aws.aurora.postgresql-instance                                                                 | SHA-256 5b193fb24987e8e31bfd677ec38566a06669c6cfaea872abe1c848fd8b825909 |
| [RDS-managed master credentials](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-secrets-manager.html)                                                                                  | catalog-documentation / aws.rds.db-instance, aws.rds.db-parameter-group, aws.rds.db-subnet-group                                                                                                     | SHA-256 f1f8317db4cc03620558d8db459bb5588d936eae89d299f3d757d0e0d3ea6da3 |
| [General purpose bucket naming rules](https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html)                                                                                | catalog-documentation / aws.s3.bucket                                                                                                                                                                | SHA-256 b0be9f27112989d04a518689db30d78694ce4673133c1f01791f743315f467ad |
| [Using cross-origin resource sharing with Amazon S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/cors.html)                                                                              | catalog-documentation / aws.s3.bucket-cors-configuration                                                                                                                                             | SHA-256 6ad0a430ff6982fe541211825aed940282a8cd8364cd94e4e94044d01fb01e0d |
| [Amazon S3 event notifications](https://docs.aws.amazon.com/AmazonS3/latest/userguide/EventNotifications.html)                                                                                     | catalog-documentation / aws.s3.bucket, aws.s3.bucket-notification-configuration                                                                                                                      | SHA-256 8f282d1fb752ddd869a5fb0a8169d4b60f97c6231945b77286e79acb4a9921c7 |
| [S3 notification object-key filtering](https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-how-to-filtering.html)                                                                   | catalog-documentation / aws.s3.bucket                                                                                                                                                                | SHA-256 1d9aef150957a6e9337bdcfcc31d6c096d428282c57bac8fc8b43964fcc2843c |
| [Managing the lifecycle of objects](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html)                                                                              | catalog-documentation / aws.s3.bucket-lifecycle-configuration                                                                                                                                        | SHA-256 31d1fada0f2c176c6fd5eb2b420de843f6df75a88423a6592c39dabd595da10e |
| [Working with HTTP APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api.html)                                                                                               | catalog-documentation / aws.apigateway.http-api                                                                                                                                                      | SHA-256 e1cc1a0260cdda294af52cdaa2b5004911b969730bd8c61f283f3ef54ec01093 |
| [AWS::ApiGatewayV2::Api](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-apigatewayv2-api.html)                                                                | exact-native-contract / aws.apigateway.http-api                                                                                                                                                      | SHA-256 a503cde76dd75bc27b752c81cec42f5e8db2972c06ae52d75a189cd4bcee675c |
| [AWS::CertificateManager::Certificate](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-certificatemanager-certificate.html)                                    | exact-native-contract / aws.acm.public-dns-certificate, aws.route53.public-hosted-zone                                                                                                               | SHA-256 8de0270f1019aad2681f69f3facdb7153729f3b61a97c07616ae89478c4ba10c |
| [AWS::CloudFront::CachePolicy](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-cloudfront-cachepolicy.html)                                                    | exact-native-contract / aws.cloudfront.cache-policy                                                                                                                                                  | SHA-256 57c5b775f363ec9c06df515811073e04601c9c7f3852909194a8b413c5b16afb |
| [AWS::CloudFront::Distribution](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-cloudfront-distribution.html)                                                  | exact-native-contract / aws.cloudfront.alias-configuration, aws.cloudfront.cache-policy, aws.cloudfront.distribution                                                                                 | SHA-256 3d5d580534b150fbd430193836840f146de7dd6cc209a18863419196e8ecfca9 |
| [AWS::CloudFront::OriginAccessControl](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-cloudfront-originaccesscontrol.html)                                    | owned-or-shared-native-contract /                                                                                                                                                                    | SHA-256 e3192a8213f5547f9084a3b98950021db58d536c3ef4ee711758e8b492fecbce |
| [AWS::CloudWatch::Alarm](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-cloudwatch-alarm.html)                                                                | exact-native-contract / aws.cloudwatch.metric-alarm                                                                                                                                                  | SHA-256 6569861bbf929f39bc937ccdb29e668da21ab0e137191493ea7754405654a68a |
| [AWS::Cognito::UserPool](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-cognito-userpool.html)                                                                | exact-native-contract / aws.cognito.user-pool                                                                                                                                                        | SHA-256 d7326a238ef75ff01063d26f0772dbbfae7baa9e0e55830d1adbbca23343a547 |
| [AWS::Cognito::UserPoolClient](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-cognito-userpoolclient.html)                                                    | exact-native-contract / aws.cognito.user-pool-client                                                                                                                                                 | SHA-256 68818aeb864aa984547da1c2e7e57ab5d1172bf844b4c599f12d43716f253b33 |
| [AWS::DynamoDB::Table](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-dynamodb-table.html)                                                                    | exact-native-contract / aws.dynamodb.table                                                                                                                                                           | SHA-256 56cf1bea4a4bb98466be8de575b3f32df500a245027ab65f33d75adb30a87e4f |
| [AWS::EC2::Instance](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-instance.html)                                                                        | exact-native-contract / aws.ec2.instance, aws.iam.instance-profile                                                                                                                                   | SHA-256 b7b1f0203efadc9cc268f311d47d73a393578d9f81ae5b5f2b78a642f883fb16 |
| [AWS::EC2::InternetGateway](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-internetgateway.html)                                                          | exact-native-contract / aws.ec2.internet-gateway                                                                                                                                                     | SHA-256 2283e003e4a28174721e21d885dc3fe03b8d0899cd88aee805be619b41f79707 |
| [AWS::EC2::NatGateway](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-natgateway.html)                                                                    | exact-native-contract / aws.ec2.nat-gateway                                                                                                                                                          | SHA-256 872609d80cc01617777e4a07d82d17d9cda34ea809c2cc03af09bd75d8a34db4 |
| [AWS::EC2::Route](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-route.html)                                                                              | exact-native-contract / aws.ec2.route                                                                                                                                                                | SHA-256 568800f04952488dcd6251d774c4ce8ddd839703770e732292d932d224f4112d |
| [AWS::EC2::RouteTable](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-routetable.html)                                                                    | exact-native-contract / aws.ec2.route-table                                                                                                                                                          | SHA-256 67b950c9fd81e4cc66ef21f474b21f2122ec0e41c6b2dc925f360c1209a8e617 |
| [AWS::EC2::SecurityGroup](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-securitygroup.html)                                                              | exact-native-contract / aws.ec2.security-group                                                                                                                                                       | SHA-256 f377d7f0e35b42f1e0c628df4de53e0b1052142723a2117752666f6a11b6cef6 |
| [AWS::EC2::SecurityGroupEgress](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-securitygroupegress.html)                                                  | exact-native-contract / aws.ec2.security-group-egress-rule                                                                                                                                           | SHA-256 ccf3a5b6616f3f227992e2a80cf662599a661c923f41e3447da33e20f5207b4d |
| [AWS::EC2::SecurityGroupIngress](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-securitygroupingress.html)                                                | exact-native-contract / aws.ec2.security-group-ingress-rule                                                                                                                                          | SHA-256 dbe741d83e018a9f8955853a6b9940e468c082c1b98068884264437d4982882e |
| [AWS::EC2::Subnet](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-subnet.html)                                                                            | exact-native-contract / aws.ec2.subnet                                                                                                                                                               | SHA-256 e2b78b87f508123754f7a60b683c219ba1a8c2f0ffb0a074c2e048059c706768 |
| [AWS::EC2::SubnetRouteTableAssociation](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-subnetroutetableassociation.html)                                  | exact-native-contract / aws.ec2.route-table-association                                                                                                                                              | SHA-256 ba7a01640536f43a689cf4bf58bf18d27c4547fcdba076fe53ccaf78e8eea08f |
| [AWS::EC2::Volume](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-volume.html)                                                                            | exact-native-contract / aws.ebs.volume, aws.ebs.volume-attachment                                                                                                                                    | SHA-256 a58d57588411e1ad46466559dfee4829712e1dc7e8ec4d0e183964483c02cdbf |
| [AWS::EC2::VolumeAttachment](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-volumeattachment.html)                                                        | exact-native-contract / aws.ebs.volume-attachment                                                                                                                                                    | SHA-256 5df3e76ebe24d93fce77c87864262c5e2f19af1bafe19619df685a46dce93062 |
| [AWS::EC2::VPC](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-vpc.html)                                                                                  | exact-native-contract / aws.ec2.vpc                                                                                                                                                                  | SHA-256 2dc6f656d19aab1bad42671ff88ef3bd038de4dc1e2b5bae5da7c87848f20986 |
| [AWS::EC2::VPCEndpoint](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-vpcendpoint.html)                                                                  | exact-native-contract / aws.ec2.gateway-vpc-endpoint                                                                                                                                                 | SHA-256 ccbf43fdefa157642cab91252ac0fed028a9ebc19f2791a3538d2a8052bd7f61 |
| [AWS::ECR::Repository](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecr-repository.html)                                                                    | exact-native-contract / aws.ecr.image-reference, aws.ecr.repository, aws.ecs.cluster, aws.ecs.container-definition, aws.ecs.service, aws.ecs.task-definition                                         | SHA-256 c763bcd7d2d4944fec58e03b7249d52e09932eea0202444689dea3d1f0a23522 |
| [AWS::ECS::Cluster](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecs-cluster.html)                                                                          | exact-native-contract / aws.ecs.cluster                                                                                                                                                              | SHA-256 6698c439b253490ae2a7fa7a9312a04bec12e798856d1036808b553d430dad83 |
| [AWS::ECS::Service](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecs-service.html)                                                                          | exact-native-contract / aws.ecs.service                                                                                                                                                              | SHA-256 256e19b494228b3d482a231cf122631e3ab82a312aa2dd398fd1fb47638940e2 |
| [AWS::ECS::TaskDefinition](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecs-taskdefinition.html)                                                            | exact-native-contract / aws.ecs.task-definition                                                                                                                                                      | SHA-256 45cc25a57b6fdab38d6b259365fe7e5b6b26dee8bf6209bfdb702ef2a365c958 |
| [AWS::ElasticLoadBalancingV2::Listener](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-listener.html)                                  | exact-native-contract / aws.elb.application-load-balancer, aws.elb.backend-access-configuration, aws.elb.https-listener, aws.elb.target-group                                                        | SHA-256 3de0b081e48405b8c54cc9bb69b66bd200d07c270add15ed637fd440956bf190 |
| [AWS::ElasticLoadBalancingV2::LoadBalancer](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-loadbalancer.html)                          | exact-native-contract / aws.elb.application-load-balancer, aws.elb.backend-access-configuration, aws.elb.https-listener, aws.elb.target-group                                                        | SHA-256 4e5430af023cc837a3c346087bbeec0432e3413c9c61556946d4257c55bae6d8 |
| [AWS::ElasticLoadBalancingV2::TargetGroup](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-targetgroup.html)                            | exact-native-contract / aws.elb.application-load-balancer, aws.elb.backend-access-configuration, aws.elb.https-listener, aws.elb.target-group                                                        | SHA-256 b751a5ef5b02b5fbf9848b4495ecd6796b5eb17df7acd6ce8c3c56c578aba555 |
| [AWS::Events::EventBus](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-events-eventbus.html)                                                                  | exact-native-contract / aws.eventbridge.event-bus                                                                                                                                                    | SHA-256 aad92b39484c49406b1981680050d408dc47f196801520399043227eb185aa66 |
| [AWS::Events::Rule](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-events-rule.html)                                                                          | exact-native-contract / aws.eventbridge.rule                                                                                                                                                         | SHA-256 081c55ce7bd8443ef42666bf35c70eaca26ee179c968eefad54e96dfd3fb476e |
| [AWS::FSx::FileSystem](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-fsx-filesystem.html)                                                                    | exact-native-contract / aws.fsx.lustre-file-system, aws.fsx.ontap-file-system, aws.fsx.openzfs-file-system, aws.fsx.windows-file-system                                                              | SHA-256 17ac7ee42c1180f06892bb8df544ab8f1d71b748364e8ba58fd91a51c05f3ccf |
| [FSx storage capacity by deployment type and HA pairs](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-fsx-filesystem.html#cfn-fsx-filesystem-storagecapacity) | catalog-documentation / aws.fsx.lustre-file-system, aws.fsx.ontap-file-system                                                                                                                        | SHA-256 17ac7ee42c1180f06892bb8df544ab8f1d71b748364e8ba58fd91a51c05f3ccf |
| [AWS::FSx::StorageVirtualMachine](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-fsx-storagevirtualmachine.html)                                              | exact-native-contract / aws.fsx.ontap-storage-virtual-machine                                                                                                                                        | SHA-256 9842d09d9a5806e9b6280f0c2ebec33c0853af15024af72279c233c3e3ce1a51 |
| [AWS::FSx::Volume](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-fsx-volume.html)                                                                            | exact-native-contract / aws.fsx.ontap-volume                                                                                                                                                         | SHA-256 f1d6d07539bc7d2192f93feb14110b0f6ab2cb28dc07b5ea790cbbf33e71db18 |
| [AWS::IAM::InstanceProfile](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-iam-instanceprofile.html)                                                          | exact-native-contract / aws.ec2.instance, aws.iam.instance-profile                                                                                                                                   | SHA-256 d760281020935e4c0999f57dbe28f7ec8f247e6d7d39c0614a48a104c43cfbc3 |
| [AWS::IAM::Role](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-iam-role.html)                                                                                | exact-native-contract / aws.iam.role                                                                                                                                                                 | SHA-256 0a93415aed52fdc56ae2deff49b3045a9fbaf878509e94798ed651499d1fb155 |
| [AWS::KMS::Key](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-kms-key.html)                                                                                  | exact-native-contract / aws.kms.key                                                                                                                                                                  | SHA-256 970f5cc65afc86935fc3ef52537ca000bacbe07ab8f569d5908daa963c0eb269 |
| [AWS::Lambda::Function](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-lambda-function.html)                                                                  | exact-native-contract / aws.lambda.function                                                                                                                                                          | SHA-256 22071528d80f09221d1e13a87f9c239b10f1d49fe9c84211adabdcec33691b02 |
| [AWS::Logs::LogGroup](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-logs-loggroup.html)                                                                      | exact-native-contract / aws.cloudwatch.log-group                                                                                                                                                     | SHA-256 97f71ec6a066ef57fa5a69aa394737a2d0175f182c40542ac3a54c005c57e4e8 |
| [AWS::RDS::DBCluster](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-rds-dbcluster.html)                                                                      | exact-native-contract / aws.aurora.postgresql-cluster, aws.aurora.postgresql-cluster-parameter-group, aws.aurora.postgresql-instance                                                                 | SHA-256 b2ee0522a9c5f0befeddcd4af2d3dc93bb010740a8f39c9c4bcc14d308ec9b5f |
| [AWS::RDS::DBClusterParameterGroup](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-rds-dbclusterparametergroup.html)                                          | exact-native-contract / aws.aurora.postgresql-cluster-parameter-group                                                                                                                                | SHA-256 ae449b4b9cfb65e89090979ddcf5680224203f5e35d48cd8965d46c0c7a14e6a |
| [AWS::RDS::DBInstance](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-rds-dbinstance.html)                                                                    | exact-native-contract / aws.rds.db-instance, aws.rds.db-parameter-group, aws.rds.db-subnet-group, aws.aurora.postgresql-instance                                                                     | SHA-256 ae0dbd7e1269fcd9d7199360c329de8d07f94ced43d7b1d9696d6f2ab3ccbad6 |
| [AWS::RDS::DBParameterGroup](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-rds-dbparametergroup.html)                                                        | exact-native-contract / aws.rds.db-parameter-group                                                                                                                                                   | SHA-256 d34ba3594ec12a31d4d8f37569b6937b405f5b9404944d0efb59301d2c5122d8 |
| [AWS::RDS::DBSubnetGroup](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-rds-dbsubnetgroup.html)                                                              | exact-native-contract / aws.rds.db-subnet-group                                                                                                                                                      | SHA-256 ef7ed8e4a927afd2d62467507f4991f5687cca127b384c139ec42dd20c2f921d |
| [AWS::Route53::HostedZone](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-route53-hostedzone.html)                                                            | exact-native-contract / aws.acm.public-dns-certificate, aws.route53.public-hosted-zone                                                                                                               | SHA-256 5777e00a082747fead3016b1c07b43fd7a62a5743f6ea8ab1fb0d8968e8b140b |
| [AWS::S3::Bucket](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-s3-bucket.html)                                                                              | exact-native-contract / aws.s3.bucket                                                                                                                                                                | SHA-256 ca73ad76ac94f772cbced1cb79c3589d67a1da4c7ee9b23bf78cb024250bb3d1 |
| [AWS::SecretsManager::Secret](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-secretsmanager-secret.html)                                                      | exact-native-contract / aws.secretsmanager.secret                                                                                                                                                    | SHA-256 ad2f2398d82fcb019ae374fcc7e75d387e4b1c6e2cc5a88a96b77ac7cc154172 |
| [AWS::SNS::Subscription](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-sns-subscription.html)                                                                | exact-native-contract / aws.sns.subscription                                                                                                                                                         | SHA-256 013babb863831ac1f4dc2870cfcf0c7e6e8a74bfe103d060b81e3433ab70962d |
| [AWS::SNS::Topic](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-sns-topic.html)                                                                              | exact-native-contract / aws.sns.topic                                                                                                                                                                | SHA-256 58b9d524de945edbeadfef8fd83cba427afd008b7ffcd8ff22f389d4e504d1e4 |
| [AWS::SQS::Queue](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-sqs-queue.html)                                                                              | exact-native-contract / aws.sqs.queue                                                                                                                                                                | SHA-256 4ad3d40837435b8904c44d39c2d6f21fb4f0496d13f960c52430782d2c85a43d |
| [AWS::StepFunctions::StateMachine](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-stepfunctions-statemachine.html)                                            | exact-native-contract / aws.stepfunctions.state-machine                                                                                                                                              | SHA-256 957fd9353992b72831d73b85be0f9f114fe054c00b798b3a11dafb8b16f72566 |
| [AMI identity and compatibility](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/AMIs.html)                                                                                                    | catalog-documentation / aws.ec2.instance, aws.iam.instance-profile                                                                                                                                   | SHA-256 f7c624729bc0091c74cf68a96bde5f999f7d7ae5a9a79ca3c622f04366fe553b |
| [Linux EC2 device naming](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/device_naming.html)                                                                                                  | catalog-documentation / aws.ebs.volume, aws.ebs.volume-attachment                                                                                                                                    | SHA-256 9efad3898739ad3701f3443f362faf972503ddbe84d566e8103dbcf8e6ceca33 |
| [Using dead-letter queues in Amazon SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)                                                   | catalog-documentation / aws.sqs.redrive-configuration                                                                                                                                                | SHA-256 e268f1a2b257f5c6086a06f17de6f31d459da342d3f71d81a3c0a096e2225dfb |
| [Amazon SQS queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-queue-types.html)                                                                               | catalog-documentation / aws.sqs.queue                                                                                                                                                                | SHA-256 6a1b8bb96c425b3fae561e78facbff19ffc471e7964c511f3d7bd0a71f6a35fc |
| [Getting started with user pools](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pool-as-user-directory.html)                                                              | catalog-documentation / aws.cognito.user-pool                                                                                                                                                        | markdown status 404; HTML redirect reviewed                              |
| [User pool app clients](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-client-apps.html)                                                                             | catalog-documentation / aws.cognito.user-pool-client                                                                                                                                                 | SHA-256 3f4691bcff336e2e2c51da72eda87ec1fc5045cfac7a913b5a2a2ac0c5a31055 |
| [ALB security group paths](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-update-security-groups.html)                                                          | catalog-documentation / aws.elb.application-load-balancer, aws.elb.backend-access-configuration, aws.elb.https-listener, aws.elb.target-group                                                        | SHA-256 a8131afd331c7647cc542579bad2e3a63dc19982119bc19dfb3410a32b76a7a5 |
| [Amazon EventBridge rules](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rules.html)                                                                                                 | catalog-documentation / aws.eventbridge.event-bus, aws.eventbridge.rule, aws.eventbridge.target                                                                                                      | SHA-256 fb97408ef0ebd15d724b8382ce15b680b93b4af3e22c69c4d30052e836e0cef8 |
| [Amazon FSx file systems](https://docs.aws.amazon.com/fsx/latest/APIReference/API_CreateFileSystem.html)                                                                                           | catalog-documentation / aws.fsx.lustre-file-system, aws.fsx.ontap-file-system, aws.fsx.ontap-storage-virtual-machine, aws.fsx.ontap-volume, aws.fsx.openzfs-file-system, aws.fsx.windows-file-system | SHA-256 5abef86af344957196be0f128774a5662866e7e9c2eb7e0c9550e22b4cf20353 |
| [AWS Regions and Availability Zones](https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions-availability-zones.html)                                                         | catalog-documentation / aws.ec2.availability-zone, aws.region.boundary                                                                                                                               | SHA-256 846e9c7fbceddcb1390d7c03321f8e0cc472bcdab8b35f654396f1735a2862bb |
| [Permissions boundaries for IAM entities](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html)                                                                        | catalog-documentation / aws.iam.managed-policy-attachment                                                                                                                                            | SHA-256 23e6c71470ccfd72df6584824dc9af7741e4b4cd153bb03f17a0aea7c0c85968 |
| [IAM roles](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html)                                                                                                                        | catalog-documentation / aws.iam.role                                                                                                                                                                 | SHA-256 c1cc09ba23926d16218d319cf3f29c7408180e890f1668f871a0b20be95ef766 |
| [IAM JSON policy Condition element](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_condition.html)                                                                   | catalog-documentation / aws.iam.policy-condition                                                                                                                                                     | SHA-256 3788ec74a4f7220cdb938f5272f71f03502a9fe04a77eda85be6b94d5114fc37 |
| [IAM JSON policy elements](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements.html)                                                                                      | catalog-documentation / aws.iam.policy-document, aws.iam.policy-statement                                                                                                                            | SHA-256 4588b07f71b50e9d707b16d9c3e112ba44d2151e93edfd09d8872fb28058fe8c |
| [Configuring Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/configuration-function-common.html)                                                                                    | catalog-documentation / aws.lambda.function                                                                                                                                                          | markdown status 404; HTML redirect reviewed                              |
| [Connecting outbound traffic to resources in a VPC](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html)                                                                           | catalog-documentation / aws.lambda.function, aws.lambda.vpc-access-configuration                                                                                                                     | SHA-256 4a06ff57f9d369d23a9caf1db0028b4140c766fd3402cd767cf83a76dd3a53c6 |
| [Secrets Manager encryption permissions](https://docs.aws.amazon.com/secretsmanager/latest/userguide/security-encryption.html)                                                                     | catalog-documentation / aws.secretsmanager.secret                                                                                                                                                    | SHA-256 144f7f518f4648d1530ca73ffd832425ad8bcde2f6ec7a27dbef868d117bfdde |
| [Amazon SNS topics and subscriptions](https://docs.aws.amazon.com/sns/latest/dg/sns-create-subscribe-endpoint-to-topic.html)                                                                       | catalog-documentation / aws.sns.subscription, aws.sns.topic                                                                                                                                          | SHA-256 7725f323703796b5a88868503843ff29e9a3deb3c05f163d8cdff2d84b792787 |
| [AWS Step Functions state machines](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-statemachines.html)                                                                              | catalog-documentation / aws.stepfunctions.state-machine                                                                                                                                              | SHA-256 477b81b364be498b1d3e5fa45e3c136ec2e365f13cd492d62a5a4aa59d0c6c65 |
| [Gateway endpoints for Amazon S3 and DynamoDB](https://docs.aws.amazon.com/vpc/latest/privatelink/gateway-endpoints.html)                                                                          | catalog-documentation / aws.ec2.gateway-vpc-endpoint                                                                                                                                                 | SHA-256 cb35fbfd9d2592f32368ac817c1b10b24f95a21f0922d5ba55c5cb1a553ffc97 |
| [Endpoint policies for gateway endpoints](https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-access.html)                                                                            | catalog-documentation / aws.iam.policy-document                                                                                                                                                      | SHA-256 9921d2fd37e1e0ef0681340dde5d2b2dc1c6c87b61555f0d66852c8bb68b7f79 |
| [Configure subnets for your VPC](https://docs.aws.amazon.com/vpc/latest/userguide/configure-subnets.html)                                                                                          | catalog-documentation / aws.ec2.subnet                                                                                                                                                               | SHA-256 b47d552ac1e3c2ad5366772bbf5c0706a2918fe856cc0677cecc8ac57d9416e9 |
| [NAT gateway basics](https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-basics.html)                                                                                                     | catalog-documentation / aws.ec2.nat-gateway                                                                                                                                                          | SHA-256 98caf8b526b5b7725bad7f1aefeda28ede6962fa7dc6fe23e9e6f5310f79643d |
| [Security group rules](https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html)                                                                                                 | catalog-documentation / aws.ec2.security-group-egress-rule, aws.ec2.security-group-ingress-rule                                                                                                      | SHA-256 ba0660a32e6d775416530da0e946ab87eda4cc2af48995344498fb3bb04c6574 |
| [Subnet route table associations](https://docs.aws.amazon.com/vpc/latest/userguide/subnet-route-tables.html)                                                                                       | catalog-documentation / aws.ec2.route-table-association                                                                                                                                              | SHA-256 d63a07b5d059c517ad9ffa8e8e06416cf87ad4a37020362084297bc6f05e0885 |
| [Connect your VPC to the internet using an internet gateway](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html)                                                           | catalog-documentation / aws.ec2.internet-gateway                                                                                                                                                     | SHA-256 d2424947a66d2d9e50f0b32a6d6da1b76a73dc6c7c517e81a39e04568d9874ea |
| [Route tables for your VPC](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Route_Tables.html)                                                                                                | catalog-documentation / aws.ec2.route-table                                                                                                                                                          | SHA-256 68b7fc8b84ca1f699b6357e171b87688d7f477def997dd45c415822202d70d68 |
| [Routes in a route table](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Route_Tables.html#route-table-routes)                                                                               | catalog-documentation / aws.ec2.route                                                                                                                                                                | SHA-256 68b7fc8b84ca1f699b6357e171b87688d7f477def997dd45c415822202d70d68 |
| [Control traffic to your AWS resources using security groups](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html)                                                           | catalog-documentation / aws.ec2.security-group                                                                                                                                                       | SHA-256 3620b5f300a52f69715494b820b74111601049f06c659d60579d1049e12cf445 |
| [What is Amazon VPC?](https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html)                                                                                                    | catalog-documentation / aws.ec2.vpc                                                                                                                                                                  | SHA-256 5ad043e5caf64e6049c71c94bb9110fd17c0d8e43536b989cc10779582489585 |

## Icon coverage — actual source display routes for every 71

Current asset set
`{"digest":"sha256:af28ecd568953e0c1de66c9b183f6737758e35dfcc7467ee5991fe9c19939878","id":"aws.cloudmarkup.provider-icons","providerId":"aws.cloudmarkup","version":"1.19.0"}`.
`{"services":71,"iconReferences":53,"approved":30,"missing":23,"newMissing":15,"noIconContract":18}`.
A neutral provider icon remains a missing/generic fallback, not approved AWS
imagery. Source routes are catalog
`CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon`,
canvas `ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon`, details
`SelectedResourceInspector → CatalogServiceIcon`. These routes are source/model
evidence, not a live authenticated browser trial.

| Definition                                    | Added | Icon / state / asset                                                                   | Catalog                                                                     | Canvas                                                       | Inspector                                      |
| --------------------------------------------- | ----- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------- |
| aws.acm.public-dns-certificate                | true  | ["aws.cloudmarkup.icons.acm-public-dns-certificate","placeholder",null]                | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.apigateway.http-api                       | false | ["aws.cloudmarkup.icons.apigateway","approved","api-gateway-http-api.svg"]             | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.aurora.postgresql-cluster                 | true  | ["aws.cloudmarkup.icons.aurora-postgresql-cluster","placeholder",null]                 | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.aurora.postgresql-cluster-parameter-group | true  | ["aws.cloudmarkup.icons.aurora-postgresql-cluster-parameter-group","placeholder",null] | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.aurora.postgresql-instance                | true  | ["aws.cloudmarkup.icons.aurora-postgresql-instance","placeholder",null]                | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.cloudfront.alias-configuration            | true  | ["no contract","no-icon-contract",null]                                                | owned configuration/boundary as applicable                                  | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | no provider icon requested                     |
| aws.cloudfront.cache-policy                   | true  | ["aws.cloudmarkup.icons.cloudfront-cache-policy","placeholder",null]                   | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.cloudfront.distribution                   | true  | ["aws.cloudmarkup.icons.cloudfront-distribution","placeholder",null]                   | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.cloudwatch.log-group                      | false | ["aws.cloudmarkup.icons.cloudwatch-logs","approved","cloudwatch-logs.svg"]             | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.cloudwatch.metric-alarm                   | false | ["aws.cloudmarkup.icons.cloudwatch-alarm","approved","cloudwatch-metric-alarm.svg"]    | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.cognito.user-pool                         | false | ["aws.cloudmarkup.icons.cognito","approved","cognito.svg"]                             | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.cognito.user-pool-client                  | false | ["aws.cloudmarkup.icons.cognito-app-client","approved","cognito.svg"]                  | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.dynamodb.table                            | false | ["aws.cloudmarkup.icons.dynamodb","approved","dynamodb-table.svg"]                     | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.ebs.volume                                | true  | ["aws.ebs.volume.icon","placeholder",null]                                             | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.ebs.volume-attachment                     | true  | ["aws.ebs.volume-attachment.icon","placeholder",null]                                  | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.ec2.availability-zone                     | false | ["aws.cloudmarkup.icons.availability-zone","approved","region-boundary.svg"]           | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.ec2.gateway-vpc-endpoint                  | false | ["aws.cloudmarkup.icons.gateway-vpc-endpoint","approved","vpc-endpoint.svg"]           | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.ec2.instance                              | false | ["aws.cloudmarkup.icons.ec2-instance","placeholder",null]                              | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.ec2.internet-gateway                      | false | ["aws.cloudmarkup.icons.internet-gateway","approved","internet-gateway.svg"]           | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.ec2.nat-gateway                           | false | ["aws.cloudmarkup.icons.nat-gateway","approved","nat-gateway.svg"]                     | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.ec2.route                                 | false | ["no contract","no-icon-contract",null]                                                | owned configuration/boundary as applicable                                  | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | no provider icon requested                     |
| aws.ec2.route-table                           | false | ["aws.cloudmarkup.icons.route-table","approved","vpc-family.svg"]                      | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.ec2.route-table-association               | false | ["no contract","no-icon-contract",null]                                                | owned configuration/boundary as applicable                                  | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | no provider icon requested                     |
| aws.ec2.security-group                        | false | ["aws.cloudmarkup.icons.security-group","approved","vpc-family.svg"]                   | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.ec2.security-group-egress-rule            | false | ["no contract","no-icon-contract",null]                                                | owned configuration/boundary as applicable                                  | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | no provider icon requested                     |
| aws.ec2.security-group-ingress-rule           | false | ["no contract","no-icon-contract",null]                                                | owned configuration/boundary as applicable                                  | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | no provider icon requested                     |
| aws.ec2.subnet                                | false | ["aws.cloudmarkup.icons.subnet","approved","vpc-family.svg"]                           | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.ec2.vpc                                   | false | ["aws.cloudmarkup.icons.vpc","approved","vpc-boundary.svg"]                            | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.ecr.image-reference                       | false | ["no contract","no-icon-contract",null]                                                | owned configuration/boundary as applicable                                  | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | no provider icon requested                     |
| aws.ecr.repository                            | false | ["aws.cloudmarkup.icons.ecr-repository","placeholder",null]                            | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.ecs.cluster                               | false | ["aws.cloudmarkup.icons.ecs-cluster","placeholder",null]                               | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.ecs.container-definition                  | false | ["no contract","no-icon-contract",null]                                                | owned configuration/boundary as applicable                                  | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | no provider icon requested                     |
| aws.ecs.service                               | false | ["aws.cloudmarkup.icons.ecs-service","placeholder",null]                               | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.ecs.task-definition                       | false | ["aws.cloudmarkup.icons.ecs-task-definition","placeholder",null]                       | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.elb.application-load-balancer             | true  | ["aws.elb.application-load-balancer.icon","placeholder",null]                          | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.elb.backend-access-configuration          | true  | ["no contract","no-icon-contract",null]                                                | owned configuration/boundary as applicable                                  | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | no provider icon requested                     |
| aws.elb.https-listener                        | true  | ["aws.elb.https-listener.icon","placeholder",null]                                     | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.elb.target-group                          | true  | ["aws.elb.target-group.icon","placeholder",null]                                       | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.eventbridge.event-bus                     | false | ["aws.cloudmarkup.icons.eventbridge","approved","eventbridge.svg"]                     | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.eventbridge.rule                          | false | ["aws.cloudmarkup.icons.eventbridge-rule","approved","eventbridge-rule.svg"]           | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.eventbridge.target                        | false | ["no contract","no-icon-contract",null]                                                | owned configuration/boundary as applicable                                  | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | no provider icon requested                     |
| aws.fsx.lustre-file-system                    | false | ["aws.cloudmarkup.icons.fsx-lustre-file-system","approved","fsx-lustre.svg"]           | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.fsx.ontap-file-system                     | false | ["aws.cloudmarkup.icons.fsx-ontap-file-system","approved","fsx-ontap.svg"]             | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.fsx.ontap-storage-virtual-machine         | false | ["aws.cloudmarkup.icons.fsx-ontap-storage-virtual-machine","approved","fsx-ontap.svg"] | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.fsx.ontap-volume                          | false | ["aws.cloudmarkup.icons.fsx-ontap-volume","approved","fsx-ontap.svg"]                  | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.fsx.openzfs-file-system                   | false | ["aws.cloudmarkup.icons.fsx-openzfs-file-system","approved","fsx-openzfs.svg"]         | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.fsx.windows-file-system                   | false | ["aws.cloudmarkup.icons.fsx-windows-file-system","approved","fsx-windows.svg"]         | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.iam.instance-profile                      | false | ["aws.cloudmarkup.icons.iam-instance-profile","placeholder",null]                      | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.iam.managed-policy-attachment             | false | ["no contract","no-icon-contract",null]                                                | owned configuration/boundary as applicable                                  | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | no provider icon requested                     |
| aws.iam.policy-condition                      | false | ["no contract","no-icon-contract",null]                                                | owned configuration/boundary as applicable                                  | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | no provider icon requested                     |
| aws.iam.policy-document                       | false | ["no contract","no-icon-contract",null]                                                | owned configuration/boundary as applicable                                  | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | no provider icon requested                     |
| aws.iam.policy-statement                      | false | ["aws.cloudmarkup.icons.iam-policy","approved","iam.svg"]                              | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.iam.role                                  | false | ["aws.cloudmarkup.icons.iam-role","approved","iam-role.svg"]                           | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.kms.key                                   | false | ["aws.cloudmarkup.icons.kms-key","placeholder",null]                                   | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.lambda.function                           | false | ["aws.cloudmarkup.icons.lambda","approved","lambda-function.svg"]                      | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.lambda.vpc-access-configuration           | false | ["no contract","no-icon-contract",null]                                                | owned configuration/boundary as applicable                                  | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | no provider icon requested                     |
| aws.rds.db-instance                           | true  | ["aws.cloudmarkup.icons.rds-db-instance","placeholder",null]                           | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.rds.db-parameter-group                    | true  | ["aws.cloudmarkup.icons.rds-db-parameter-group","placeholder",null]                    | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.rds.db-subnet-group                       | true  | ["aws.cloudmarkup.icons.rds-db-subnet-group","placeholder",null]                       | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.region.boundary                           | false | ["aws.cloudmarkup.icons.region","approved","region-boundary.svg"]                      | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.route53.public-hosted-zone                | true  | ["aws.cloudmarkup.icons.route53-public-hosted-zone","placeholder",null]                | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.s3.bucket                                 | false | ["aws.cloudmarkup.icons.s3","approved","s3-bucket.svg"]                                | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.s3.bucket-cors-configuration              | false | ["no contract","no-icon-contract",null]                                                | owned configuration/boundary as applicable                                  | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | no provider icon requested                     |
| aws.s3.bucket-lifecycle-configuration         | false | ["no contract","no-icon-contract",null]                                                | owned configuration/boundary as applicable                                  | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | no provider icon requested                     |
| aws.s3.bucket-notification-configuration      | false | ["no contract","no-icon-contract",null]                                                | owned configuration/boundary as applicable                                  | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | no provider icon requested                     |
| aws.secretsmanager.secret                     | false | ["aws.cloudmarkup.icons.secretsmanager-secret","placeholder",null]                     | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.sns.subscription                          | false | ["no contract","no-icon-contract",null]                                                | owned configuration/boundary as applicable                                  | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | no provider icon requested                     |
| aws.sns.topic                                 | false | ["aws.cloudmarkup.icons.sns","approved","sns-topic.svg"]                               | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.sqs.queue                                 | false | ["aws.cloudmarkup.icons.sqs","approved","sqs-queue.svg"]                               | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |
| aws.sqs.redrive-configuration                 | false | ["no contract","no-icon-contract",null]                                                | owned configuration/boundary as applicable                                  | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | no provider icon requested                     |
| aws.stepfunctions.state-machine               | false | ["aws.cloudmarkup.icons.step-functions","approved","step-functions.svg"]               | CatalogServiceIcon → bound registry → approved asset or NeutralProviderIcon | ArchitectureNodes → CatalogServiceIcon / NeutralProviderIcon | SelectedResourceInspector → CatalogServiceIcon |

### Decision needed: 15 new official AWS icon mappings

Hunter can satisfy the repository owner gate by directly approving this exact
mapping set and its stated terms. A separate third-party signature or
outside-counsel approval is not required by this pipeline. His actual decision
must be recorded under a fresh owner-record ID and actual approval date; no such
decision has yet been inferred or recorded.

- Official source: AWS architecture icon package 2026-04-30,
  `Icon-package_04302026.4705b90f5aa45b019271a2699e9ce9b97b941ee1.zip`.
- Archive SHA-256:
  `699fe7a2481aa712b6b74faff0aaab6382d3bb7243bba3abd3ba909d6bf7b912`.
- Exact 15-map JSON SHA-256:
  `sha256:15d9eebef388c7d762ce01baafe23fcd1c4f3a6bd1cdacc1eebc46f0c0d4ff66`.
  Exact proposed mapping receipt is retained in the source handoff.
- Catalog 0.30.0 /
  `84c6691236f5767565afc3d49fd9ec25786c61a4c49883387dfcf1a6e9f3ec35`; source
  `9ab1ddb4085b2397ee40095a286d5c6d10e852c2`.
- Contact sheet Library ID: `libfile_1f266c2c4a008191aa6479e237764455`; returned
  name `service-review-icon-preview.png`, version 0. Upload confirmed; current
  helper could not persist local extended attributes on Windows. No URL
  invented.

| Service/resource                                                                           | Official proposed file           | Mapping kind   |
| ------------------------------------------------------------------------------------------ | -------------------------------- | -------------- |
| ACM public DNS certificate (`aws.acm.public-dns-certificate`)                              | `acm.svg`                        | service-family |
| Aurora PostgreSQL Serverless v2 cluster (`aws.aurora.postgresql-cluster`)                  | `aurora.svg`                     | service-family |
| Aurora PostgreSQL cluster TLS parameters (`aws.aurora.postgresql-cluster-parameter-group`) | `aurora.svg`                     | service-family |
| Aurora PostgreSQL Serverless v2 member (`aws.aurora.postgresql-instance`)                  | `aurora-postgresql-instance.svg` | exact-resource |
| CloudFront static cache policy (`aws.cloudfront.cache-policy`)                             | `cloudfront.svg`                 | service-family |
| CloudFront distribution (`aws.cloudfront.distribution`)                                    | `cloudfront.svg`                 | service-family |
| RDS PostgreSQL instance (`aws.rds.db-instance`)                                            | `rds.svg`                        | service-family |
| RDS PostgreSQL TLS parameters (`aws.rds.db-parameter-group`)                               | `rds.svg`                        | service-family |
| RDS DB subnet group (`aws.rds.db-subnet-group`)                                            | `rds.svg`                        | service-family |
| Route53 public hosted zone (`aws.route53.public-hosted-zone`)                              | `route53-hosted-zone.svg`        | exact-resource |
| EBS volume attachment (`aws.ebs.volume-attachment`)                                        | `ebs.svg`                        | service-family |
| EBS data volume (`aws.ebs.volume`)                                                         | `ebs-gp3-volume.svg`             | exact-resource |
| Application Load Balancer (`aws.elb.application-load-balancer`)                            | `application-load-balancer.svg`  | exact-resource |
| ALB HTTPS listener (`aws.elb.https-listener`)                                              | `elastic-load-balancing.svg`     | service-family |
| ALB target group (`aws.elb.target-group`)                                                  | `elastic-load-balancing.svg`     | service-family |

The JSON binds every opaque icon ID to its full official archive member,
destination asset ID and output file. Four entries use exact resource artwork
(Aurora PostgreSQL instance, hosted zone, ALB, gp3 volume); the remaining eleven
use explicitly labeled official service-family artwork. There are ten canonical
SVG files and fifteen new mappings. All passed the existing SVG policy and
rendered at 48/24 px; no vendor artwork was generated or recolored.

Approval wording that would record the actual decision:

> I approve the exact 15 official AWS icon mappings and contact sheet listed
> here, from the checksum-bound 2026-04-30 AWS archive, for product UI,
> documentation and diagram export. Preserve the 30 existing approved mappings.
> Use these only to identify AWS services/resources, with visible service names;
> they are not Cloud Markup branding or claims of AWS endorsement. Retain the
> existing supplementary-icon-with-visible-name-v1 accessibility contract. The
> eight older missing icons are excluded from this decision.

This is a proposed human decision, **not an approval receipt**. A shorter direct
approval can also suffice if it unambiguously refers to this exact set and these
terms.

After explicit approval, the existing promotion path requires: (1) a fresh
authentic record/date/reviewer decision in the concise `SOURCE_REVIEW.md`; (2)
the candidate approval projection exactly matching that record, including
source, surfaces, trademark and accessibility fields; (3) intentional asset-set
version progression (candidate 1.20.0); (4) exact current catalog/digest/opaque
icon IDs, canonical aliases and checksummed normalized bytes; (5) successful
promotion dry-run before any write, then asset/registry/bundle/security checks.
The old `CC-AWS-ICONS-OWNER-APPROVAL-2026-09-23` must not be reused for these
changed mappings. The staged candidate intentionally demonstrates that refusal
and is not promotable without a new actual decision. No production deployment is
authorized by icon approval.

Older missing icons, kept separate: EC2 instance, IAM instance profile, KMS key,
Secrets Manager secret, ECR repository, ECS cluster, ECS task definition and ECS
service. They remain missing; none is falsely reported complete.

No icon wiring patch can safely promote these15 under the old approval. The
prepared candidate preserves the 30 approved mappings, uses ten canonical
official SVGs with four exact-resource and eleven explicitly labeled family
mappings, and intentionally fails the owner-gate dry-run. The eight older
missing assets are separate prerequisites. Approve the exact 15-map
receipt/contact sheet and record a fresh actual owner decision, then run the
existing promotion/registry/bundle/security path; icon approval does not
authorize a deployment.

## Importer correction and compatibility

The patch replaces the CloudFormation single-service map with de-duplicated
candidate lists. PostgreSQL standalone requires literal Engine=postgres and
absent DBClusterIdentifier. Aurora member requires literal
Engine=aurora-postgresql plus nonempty literal cluster identity or exact
same-template Ref to a literal Aurora PostgreSQL cluster. DBCluster also
requires literal aurora-postgresql. FSx requires literal FileSystemType
LUSTRE/ONTAP/OPENZFS/WINDOWS. Missing/intrinsic/conflicting/future candidate
evidence remains native/unresolved with bounded mapping diagnostic where
ambiguous. Logical IDs, deployment identifiers, references, redaction and
unknown ownership are preserved. A literal external cluster ID recognizes kind
only, not managed ownership. Terraform parsing remains unchanged.

Importer version1.0.2 and parser authority2.9.0 remain intact. New ambiguous
observations may be corrected or remain unresolved; stored receipts/snapshots
are not rewritten. The sixteen actual API snapshot tests verify existing
authority/digest boundaries. No API contract/schema, AI design proposal,
provider permission, database migration, importer-adoption authority or compiler
production behavior changes. Residual specialized import issues remain explicit
above.

## Exact patches and integration/rollback order

| Patch                                               | SHA-256 / bytes                                                          | Changed paths                                                                                                                                                                              | State / exact-base applicability                                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| service-correctness-importer.patch                  | 0be12118c9cc7cc9a285c453a57ea0966a0f44eeba7d50097986376c9dbb8a1a / 16824 | ["packages/repository-importer/src/service.ts","packages/repository-importer/src/service.test.ts"]                                                                                         | Applied only in isolated correctness checkout; 63 focused regressions passed. Base apply check=true                           |
| service-full-mixed-compiler-test.patch              | 61fe4743baf8c0344e805a4e7f61d2de871b5f5f8cc818187d5006cc3f53f81f / 5299  | ["services/iac-compiler/full_catalog_mixed_test.go"]                                                                                                                                       | Applied new synthetic test only; complete local compiler suite passed. Base apply check=true                                  |
| service-review-oac-metadata-candidate.patch         | 4b6339e178045f5f5eb00d55f09861e483dd8e7c9ab12620f1decbbacaa28de4 / 926   | ["packages/provider-aws/src/catalog/services/cloudfront.ts"]                                                                                                                               | Proposal only; NOT applied or regenerated. Catalog transition review required. Base apply check=true                          |
| service-review-fsx-sfn-sns-metadata-candidate.patch | a57683752c2e8a4a2988f2edbbac7f37a75600047cb2f705b7cfacb3589f26a2 / 3372  | ["packages/provider-aws/src/catalog/services/fsx.ts","packages/provider-aws/src/catalog/services/step-functions-eventing.ts","packages/provider-aws/src/catalog/services/sns-eventing.ts"] | Proposal only; NOT applied or regenerated. Preserve native exports; catalog transition review required. Base apply check=true |

No patches are committed or pushed. Review/apply importer patch and mixed
compiler regression independently to the exact base or explicitly rebase with
new receipts. The prior attestation patch and visual/browser changes need their
owners’ merge review. Keep metadata proposals outside admission until the
transition decision below; they have not been regenerated, typechecked as a
successor catalog, or tested together. Icon promotion remains separately gated.
The release owner then binds one combined source and runs required
CI/visual/staff checks. No release command is issued here.

Rollback of the importer patch restores previous parser behavior without
mutating stored snapshots. Rollback of a reviewed future catalog transition uses
preserved exact predecessor artifacts/source/image and unchanged revision bytes.
Never relabel an old digest as a successor, reconstruct redacted source values
or reset/delete projects as an implicit integration step. The following
transition design is concrete but remains a proposal.

### Catalog metadata correction: bounded transition design

Status: proposal only. No current catalog, digest, registry, saved revision,
generator tuple, asset manifest or production resource was changed.

Source is `9ab1ddb4085b2397ee40095a286d5c6d10e852c2`. Installed catalog is
`aws.cloudmarkup.notes-api-catalog@0.30.0`, digest
`sha256:84c6691236f5767565afc3d49fd9ec25786c61a4c49883387dfcf1a6e9f3ec35`.

#### Concrete correction

The existing CloudFormation renderer emits one
`AWS::CloudFront::OriginAccessControl` for each bounded distribution. The
distribution declaration currently lists no generated type. The source-only OAC
patch adds that type conditionally for the distribution, preserving the
cache-policy declaration. Terraform already declares its OAC type.

This describes existing behavior. It adds no AWS resource, IAM grant,
permission, runtime execution, new card, graph ID, configuration field or
deployment key. The renderer still uses the exact service principal,
`s3:GetObject` and distribution SourceArn restriction. Signed origin access does
not authenticate viewers.
[AWS OAC documentation](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html).

The full review also found separate metadata omissions for the existing FSx
Lustre data-repository association and Step Functions error log group, plus SNS
subscription pseudo-property bindings. Those are packaged in a different
candidate patch and require the same transition decision.

#### Why applying the leaf patch is insufficient

Canonical catalog bytes determine the immutable catalog digest. Regeneration
after this metadata correction changes that digest. Both the TypeScript current
catalog resolver and Go compatibility registry admit only the exact installed
tuple. Replacing 0.30's bytes or accepting an old digest as the successor would
misstate provenance. The current helper's old-project refusal would also block
editing/compilation through affected consumers.

Relevant boundaries: `packages/provider-aws/src/current-catalog.ts`, generated
catalog/accessors/connection presentation/service extension, all compiler
`isCurrentAwsCatalog` checks, `services/iac-compiler/types.go` and
`catalog_compatibility_test.go`, the three application-generator compatibility
tuples, API AI grounding, project/editor setup, solution export and exact asset
catalog pins. Catalog metadata is not a deployment authorization.

#### Preferred product direction: one current catalog, reviewed transition

Hunter's October 4 instruction states there are no customer users and existing
projects are his tests. Root/provider instructions also prefer one current
catalog during pre-live beta. Permanent history machinery is therefore not the
default recommendation.

1. Agree on a successor version, inventory the specific test-project revisions
   affected, and make the proposed successor artifacts and exact impact
   reviewable offline. Do not replace installed 0.30 yet.
2. Review each desired test architecture as a newly created successor-bound
   revision/project with explicit provenance. Preserve graph/deployment keys and
   configuration intent where applicable; verify the new revision rather than
   relabel the original. A generic automatic migration framework is not proposed
   for this metadata-only change.
3. Run affected exact binding, UI, AI and both export checks on one combined
   candidate. Record any test project intentionally left on 0.30 and the
   resulting current-helper refusal. Retain the original bytes and rollback
   source/image.
4. Switch the single current catalog only after the concrete transition is
   reviewed. Keep original stored revisions unchanged. Permanent deletion,
   reset, archive mutation or live changes require separate specific authority.

This option avoids indefinite registry history. It does mean old revisions
cannot be promised current-app editing/compilation after the switch. The review
must make that limitation explicit and complete the desired fresh revisions
before switching. This task performs none of those project or live mutations.

#### Alternative: temporary exact 0.30 + successor support

If test-project continuity requires editing/exporting 0.30 during validation,
use one explicit, temporary predecessor and one successor. Pin both complete
artifact tuples and static consumer registrations; set a reviewed removal
checkpoint after Hunter validates successor-bound copies. No arbitrary version
loader, network registry, inferred digest alias or indefinite history.

This is larger than the preferred transition: every TS resolver, renderer guard,
generator tuple and schema/presentation/extension/asset binding must dispatch
using the revision's exact tuple. Preserving only a Go registry entry is
insufficient because current-only family guards and TS consumers would still
reject the predecessor. Original 0.30 outputs/provenance must stay unchanged.

#### Required evidence before integration

- Exact old/current and proposed successor digests; tampered, unknown and
  same-version/different-digest refusals. No old revision receives successor
  provenance without a new reviewed revision.
- Both default-viewer and ACM-alias CloudFront goldens: one existing OAC;
  cache-policy declaration remains empty; no broadening of bucket/KMS rights.
- Repeated exact-input byte equality and stable native addresses, policy scope,
  retained resources and outputs. Successor provenance may name its new tuple;
  it must not claim the predecessor digest.
- Guided/Professional creation/editing, all 71 fields/definitions, all 137
  relationship descriptors, AI schema/reference authority and all three
  application-generator tuples.
- Saved-project selection and old-version refusal or temporary dispatch behavior
  matching the chosen transition. Test original revision bytes before/after.
- Import remains observation-only; no retroactive rewrite of prior parser
  receipts. Metadata does not make generated OAC/log/association resources new
  independently selectable cards.
- Catalog generation/checks, mapping regressions, compiler goldens and combined
  release-owner checks. This source-only proposal is not integration-ready.

#### Icons and rollback

The fifteen-icon owner decision remains pending. Metadata corrections do not
approve assets. The existing thirty approved mappings and exact approval record
remain intact. A successor catalog pin would need the normal asset integrity
review; changed mapping approval cannot reuse the old owner record.

Importer fixes and the new mixed compiler test can be reviewed/applied
independently on the exact 9ab base. OAC and the other catalog proposals stay
outside that patch. Rollback of importer code restores previous parsing behavior
without altering saved snapshots; new observations are never silently rewritten.
Catalog rollback uses the preserved exact predecessor artifacts and
image/source, with stored revision identity unchanged. No deployment is
initiated here.

## Patch bodies for source handoff

### service-correctness-importer.patch

```diff
diff --git a/packages/repository-importer/src/service.test.ts b/packages/repository-importer/src/service.test.ts
index ef03722d..3c4b0217 100644
--- a/packages/repository-importer/src/service.test.ts
+++ b/packages/repository-importer/src/service.test.ts
@@ -67,6 +67,332 @@ import {
 const timestamp = "2026-08-19T12:00:00Z";
 const commitSha = "1".repeat(40);

+describe("literal CloudFormation catalog classification", () => {
+  const cluster = {
+    Type: "AWS::RDS::DBCluster",
+    Properties: { Engine: "aurora-postgresql" },
+  };
+  async function importResources(
+    resources: Readonly<Record<string, unknown>>,
+    reverseCatalog = false,
+  ) {
+    const root = await mkdtemp(join(tmpdir(), "cloudmarkup-classification-"));
+    await write(
+      root,
+      "template.json",
+      JSON.stringify({ Resources: resources }),
+    );
+    const input = request();
+    if (reverseCatalog)
+      input.catalog = {
+        ...input.catalog,
+        services: [...input.catalog.services].reverse(),
+      };
+    return service.importRepository({ sourceDirectory: root, request: input });
+  }
+  it.each([undefined, "aurora-mysql", "mysql", "postgres", { Ref: "Engine" }])(
+    "does not identify a DBCluster as PostgreSQL from ambiguous engine %j",
+    async (engine) => {
+      const result = await importResources({
+        Cluster: {
+          Type: "AWS::RDS::DBCluster",
+          Properties: engine === undefined ? {} : { Engine: engine },
+        },
+      });
+      const fact = result.facts.find(
+        (value) => value.logicalKey === "cloudformation.Cluster",
+      );
+      expect(fact).toMatchObject({
+        confidence: "unresolved",
+        resourceType: "cloudformation.aws.rds.dbcluster",
+        deploymentIdentifier: "Cluster",
+        ownership: "unknown",
+      });
+      expect(fact?.serviceType).toBeUndefined();
+      expect(fact?.diagnostics.map((value) => value.code)).toContain(
+        "cloudmarkup.import.ambiguous-resource-mapping",
+      );
+    },
+  );
+  it.each([
+    {
+      properties: { Engine: "postgres" },
+      expected: "aws.rds.db-instance",
+    },
+    {
+      properties: {
+        Engine: "aurora-postgresql",
+        DBClusterIdentifier: { Ref: "Cluster" },
+      },
+      expected: "aws.aurora.postgresql-instance",
+    },
+    {
+      properties: {
+        Engine: "aurora-postgresql",
+        DBClusterIdentifier: "synthetic-existing-cluster",
+      },
+      expected: "aws.aurora.postgresql-instance",
+    },
+  ])(
+    "classifies exact engine/cluster evidence as $expected",
+    async ({ properties, expected }) => {
+      const resources = {
+        Cluster: cluster,
+        Database: { Type: "AWS::RDS::DBInstance", Properties: properties },
+      };
+      const first = await importResources(resources);
+      const reversed = await importResources(resources, true);
+      const fact = (result: RepositoryImportResultV1) =>
+        result.facts.find(
+          (value) => value.logicalKey === "cloudformation.Database",
+        );
+      expect(fact(first)).toMatchObject({
+        kind: "resource",
+        confidence: "confirmed",
+        resourceType: expected,
+        serviceType: expected,
+        deploymentIdentifier: "Database",
+        ownership: "unknown",
+      });
+      expect(fact(reversed)).toEqual(fact(first));
+      expect(first.diagnostics).toEqual([]);
+      expect(first.observedSolution.designAuthority).toBe("none");
+      expect(
+        repositoryImportResultV1Schema.parse(JSON.parse(JSON.stringify(first))),
+      ).toEqual(first);
+    },
+  );
+  it.each([
+    {},
+    { Engine: "mysql" },
+    { Engine: "aurora-mysql", DBClusterIdentifier: { Ref: "Cluster" } },
+    {
+      Engine: { Ref: "EngineParameter" },
+      DBClusterIdentifier: { Ref: "Cluster" },
+    },
+    { Engine: "postgres", DBClusterIdentifier: { Ref: "Cluster" } },
+    { Engine: "postgres", DBClusterIdentifier: null },
+    { Engine: "aurora-postgresql" },
+    { Engine: "aurora-postgresql", DBClusterIdentifier: "" },
+    { Engine: "aurora-postgresql", DBClusterIdentifier: "   " },
+    { Engine: "aurora-postgresql", DBClusterIdentifier: 123 },
+    {
+      Engine: "aurora-postgresql",
+      DBClusterIdentifier: { Ref: "MissingCluster" },
+    },
+    {
+      Engine: "aurora-postgresql",
+      DBClusterIdentifier: { Ref: "AWS::NoValue" },
+    },
+    {
+      Engine: "aurora-postgresql",
+      DBClusterIdentifier: { "Fn::ImportValue": "ExternalCluster" },
+    },
+    {
+      Engine: "aurora-postgresql",
+      DBClusterIdentifier: {
+        "Fn::If": ["UseCluster", { Ref: "Cluster" }, { Ref: "AWS::NoValue" }],
+      },
+    },
+  ])(
+    "keeps ambiguous/unsupported DBInstance properties unresolved: %j",
+    async (properties) => {
+      const result = await importResources({
+        Cluster: cluster,
+        Database: { Type: "AWS::RDS::DBInstance", Properties: properties },
+      });
+      const fact = result.facts.find(
+        (value) => value.logicalKey === "cloudformation.Database",
+      );
+      expect(fact).toMatchObject({
+        kind: "resource",
+        confidence: "unresolved",
+        resourceType: "cloudformation.aws.rds.dbinstance",
+      });
+      expect(fact).not.toHaveProperty("serviceType");
+      expect(result.diagnostics).toContainEqual(
+        expect.objectContaining({
+          code: "cloudmarkup.import.ambiguous-resource-mapping",
+          path: "template.json",
+        }),
+      );
+      expect(result.observedSolution.designAuthority).toBe("none");
+    },
+  );
+  it.each([
+    { Type: "AWS::RDS::DBCluster", Properties: { Engine: "postgres" } },
+    { Type: "AWS::RDS::DBCluster", Properties: { Engine: { Ref: "Engine" } } },
+    {
+      Type: "AWS::RDS::DBInstance",
+      Properties: { Engine: "aurora-postgresql" },
+    },
+  ])(
+    "does not confirm Aurora membership from a conflicting cluster reference: %j",
+    async (referenced) => {
+      const result = await importResources({
+        Cluster: referenced,
+        Database: {
+          Type: "AWS::RDS::DBInstance",
+          Properties: {
+            Engine: "aurora-postgresql",
+            DBClusterIdentifier: { Ref: "Cluster" },
+          },
+        },
+      });
+      expect(
+        result.facts.find(
+          (value) => value.logicalKey === "cloudformation.Database",
+        ),
+      ).toMatchObject({
+        confidence: "unresolved",
+        resourceType: "cloudformation.aws.rds.dbinstance",
+      });
+    },
+  );
+  it("imports a mixed standalone RDS and two-member Aurora template without collapsing identities", async () => {
+    const member = {
+      Type: "AWS::RDS::DBInstance",
+      Properties: {
+        Engine: "aurora-postgresql",
+        DBClusterIdentifier: { Ref: "Cluster" },
+        DBInstanceClass: "db.serverless",
+      },
+    };
+    const result = await importResources({
+      Cluster: cluster,
+      MemberA: member,
+      MemberB: member,
+      Standalone: {
+        Type: "AWS::RDS::DBInstance",
+        Properties: { Engine: "postgres" },
+      },
+    });
+    expect(
+      result.facts
+        .filter((fact) => fact.kind === "resource")
+        .map((fact) => ({
+          key: fact.logicalKey,
+          serviceType: fact.serviceType,
+        }))
+        .sort((left, right) => left.key.localeCompare(right.key)),
+    ).toEqual([
+      {
+        key: "cloudformation.Cluster",
+        serviceType: "aws.aurora.postgresql-cluster",
+      },
+      {
+        key: "cloudformation.MemberA",
+        serviceType: "aws.aurora.postgresql-instance",
+      },
+      {
+        key: "cloudformation.MemberB",
+        serviceType: "aws.aurora.postgresql-instance",
+      },
+      { key: "cloudformation.Standalone", serviceType: "aws.rds.db-instance" },
+    ]);
+    expect(result.diagnostics).toEqual([]);
+  });
+  it.each([
+    ["LUSTRE", "aws.fsx.lustre-file-system"],
+    ["ONTAP", "aws.fsx.ontap-file-system"],
+    ["OPENZFS", "aws.fsx.openzfs-file-system"],
+    ["WINDOWS", "aws.fsx.windows-file-system"],
+  ])(
+    "classifies the exact FSx family %s independently of catalog order",
+    async (family, expected) => {
+      const resources = {
+        FileSystem: {
+          Type: "AWS::FSx::FileSystem",
+          Properties: { FileSystemType: family },
+        },
+      };
+      for (const reverse of [false, true]) {
+        const result = await importResources(resources, reverse);
+        expect(
+          result.facts.find(
+            (value) => value.logicalKey === "cloudformation.FileSystem",
+          ),
+        ).toMatchObject({
+          serviceType: expected,
+          resourceType: expected,
+          confidence: "confirmed",
+        });
+      }
+    },
+  );
+  it.each([undefined, "OTHER", { Ref: "FamilyParameter" }])(
+    "does not guess an ambiguous FSx family: %j",
+    async (family) => {
+      const result = await importResources({
+        FileSystem: {
+          Type: "AWS::FSx::FileSystem",
+          Properties: { FileSystemType: family },
+        },
+      });
+      const fact = result.facts.find(
+        (value) => value.logicalKey === "cloudformation.FileSystem",
+      );
+      expect(fact).toMatchObject({
+        confidence: "unresolved",
+        resourceType: "cloudformation.aws.fsx.filesystem",
+      });
+      expect(fact).not.toHaveProperty("serviceType");
+    },
+  );
+  it("imports the exact existing Aurora and standalone RDS compiler golden outputs with correct distinct identities", async () => {
+    const root = await mkdtemp(join(tmpdir(), "cloudmarkup-db-export-import-"));
+    for (const family of ["aurora", "rds"]) {
+      const template = await readFile(
+        new URL(
+          `../../../services/iac-compiler/testdata/${family}-goldens-v1/template.json`,
+          import.meta.url,
+        ),
+        "utf8",
+      );
+      await write(root, family + "/template.json", template);
+    }
+    const input = request();
+    const before = hashCanonicalValue(input.approvedArchitecture);
+    const result = await service.importRepository({
+      sourceDirectory: root,
+      request: input,
+    });
+    const databaseFacts = result.facts.filter(
+      (fact) =>
+        fact.kind === "resource" &&
+        ["aws.rds.db-instance", "aws.aurora.postgresql-instance"].includes(
+          fact.serviceType ?? "",
+        ),
+    );
+    expect(
+      databaseFacts.filter(
+        (fact) => fact.source.path === "aurora/template.json",
+      ),
+    ).toHaveLength(1);
+    expect(
+      databaseFacts.filter((fact) => fact.source.path === "rds/template.json"),
+    ).toHaveLength(1);
+    for (const fact of databaseFacts)
+      expect(fact).toMatchObject({
+        confidence: "confirmed",
+        serviceType:
+          fact.source.path === "aurora/template.json"
+            ? "aws.aurora.postgresql-instance"
+            : "aws.rds.db-instance",
+      });
+    expect(hashCanonicalValue(input.approvedArchitecture)).toBe(before);
+    expect(result.observedSolution.designAuthority).toBe("none");
+    expect(result.diagnostics).not.toContainEqual(
+      expect.objectContaining({
+        code: "cloudmarkup.import.ambiguous-resource-mapping",
+      }),
+    );
+    expect(
+      repositoryImportResultV1Schema.parse(JSON.parse(JSON.stringify(result))),
+    ).toEqual(result);
+  });
+});
+
 function request(): RepositoryImportRequestV1 {
   const generated = createNotesGenerationRequest({
     mode: "complete-supported-pattern",
diff --git a/packages/repository-importer/src/service.ts b/packages/repository-importer/src/service.ts
index 184f1133..899b5092 100644
--- a/packages/repository-importer/src/service.ts
+++ b/packages/repository-importer/src/service.ts
@@ -706,19 +706,91 @@ function catalogMaps(catalog: ProviderCatalogArtifactV1) {
   >();
   const cloudformation = new Map<
     string,
-    ProviderCatalogArtifactV1["services"][number]
+    ProviderCatalogArtifactV1["services"][number][]
   >();
   for (const service of catalog.services) {
     for (const mapping of service.mappings) {
       if (mapping.target === "terraform" && mapping.kind === "resource") {
         terraform.set(mapping.resourceType, service);
-      } else if (mapping.target === "cloudformation")
-        cloudformation.set(mapping.typeName, service);
+      } else if (mapping.target === "cloudformation") {
+        const candidates = cloudformation.get(mapping.typeName) ?? [];
+        if (!candidates.some((candidate) => candidate.id === service.id))
+          candidates.push(service);
+        cloudformation.set(mapping.typeName, candidates);
+      }
     }
   }
   return { terraform, cloudformation, providerId: catalog.provider.id };
 }

+function resolveCloudFormationService(
+  resource: JsonObject,
+  resources: JsonObject,
+  maps: ReturnType<typeof catalogMaps>,
+) {
+  const candidates = maps.cloudformation.get(String(resource.Type)) ?? [];
+  const properties = objectValue(resource.Properties);
+  if (resource.Type === "AWS::RDS::DBCluster") {
+    return candidates.length === 1 &&
+      candidates[0]?.id === "aws.aurora.postgresql-cluster" &&
+      properties?.["Engine"] === "aurora-postgresql"
+      ? candidates[0]
+      : undefined;
+  }
+  if (resource.Type === "AWS::RDS::DBInstance") {
+    const supportedIds = [
+      "aws.rds.db-instance",
+      "aws.aurora.postgresql-instance",
+    ];
+    if (candidates.some((candidate) => !supportedIds.includes(candidate.id)))
+      return undefined;
+    if (
+      properties?.["Engine"] === "postgres" &&
+      !Object.hasOwn(properties, "DBClusterIdentifier")
+    )
+      return candidates.find((candidate) => candidate.id === supportedIds[0]);
+    if (properties?.["Engine"] !== "aurora-postgresql") return undefined;
+    const cluster = properties["DBClusterIdentifier"];
+    let clusterIdentified =
+      typeof cluster === "string" && cluster.trim() !== "";
+    const reference = objectValue(cluster);
+    if (
+      reference !== undefined &&
+      Object.keys(reference).length === 1 &&
+      typeof reference.Ref === "string"
+    ) {
+      const referencedCluster = objectValue(resources[reference.Ref]);
+      clusterIdentified =
+        referencedCluster?.Type === "AWS::RDS::DBCluster" &&
+        objectValue(referencedCluster.Properties)?.["Engine"] ===
+          "aurora-postgresql";
+    }
+    return clusterIdentified
+      ? candidates.find((candidate) => candidate.id === supportedIds[1])
+      : undefined;
+  }
+  if (resource.Type === "AWS::FSx::FileSystem") {
+    const familyIds: Readonly<Record<string, string>> = {
+      LUSTRE: "aws.fsx.lustre-file-system",
+      ONTAP: "aws.fsx.ontap-file-system",
+      OPENZFS: "aws.fsx.openzfs-file-system",
+      WINDOWS: "aws.fsx.windows-file-system",
+    };
+    if (
+      candidates.some(
+        (candidate) => !Object.values(familyIds).includes(candidate.id),
+      )
+    )
+      return undefined;
+    const family = properties?.["FileSystemType"];
+    return typeof family === "string"
+      ? candidates.find((candidate) => candidate.id === familyIds[family])
+      : undefined;
+  }
+  if (candidates.length === 1) return candidates[0];
+  return undefined;
+}
+
 function commonFact(
   target: RepositoryImportedFactV1["target"],
   parserId: string,
@@ -1449,7 +1521,21 @@ function parseCloudFormation(
   for (const logicalId of Object.keys(resources).sort(compareUtf16)) {
     const resource = objectValue(resources[logicalId]);
     if (resource === undefined || typeof resource.Type !== "string") continue;
-    const service = maps.cloudformation.get(resource.Type);
+    const service = resolveCloudFormationService(resource, resources, maps);
+    const mappingDiagnostics =
+      service === undefined &&
+      ((maps.cloudformation.get(resource.Type)?.length ?? 0) > 1 ||
+        resource.Type === "AWS::RDS::DBCluster")
+        ? [
+            cleanDiagnostic(
+              "ambiguous-resource-mapping",
+              "warning",
+              "The native resource type does not establish its catalog variant from literal engine, family or cluster identity. Review the source before relying on classification.",
+              file.path,
+            ),
+          ]
+        : [];
+    context.diagnostics.push(...mappingDiagnostics);
     const properties = sanitizeValue(resource.Properties ?? {}, context);
     const references = [
       ...new Set([
@@ -1476,6 +1562,7 @@ function parseCloudFormation(
       configurationDigest: hashCanonicalValue(properties),
       references,
       external: false,
+      diagnostics: mappingDiagnostics,
     });
     keys.set(logicalId, fact);
     if (resource.Type.startsWith("AWS::IAM::")) {

```

### service-full-mixed-compiler-test.patch

```diff
diff --git a/services/iac-compiler/full_catalog_mixed_test.go b/services/iac-compiler/full_catalog_mixed_test.go
new file mode 100644
--- /dev/null
+++ b/services/iac-compiler/full_catalog_mixed_test.go
@@ -0,0 +1,129 @@
+package compiler
+
+import (
+	"context"
+	"encoding/json"
+	"reflect"
+	"strings"
+	"testing"
+)
+
+// The shared network and subnet group keep their existing identities while
+// standalone PostgreSQL and two Aurora members retain distinct lifecycles.
+func TestStandaloneRdsAndTwoMemberAuroraCoexist(t *testing.T) {
+	model := rdsModel(false)
+	aurora := auroraModel(true)
+	for _, resource := range aurora.Resources {
+		if existing, ok := modelResource(model, resource.ID); ok {
+			if !reflect.DeepEqual(existing, resource) {
+				t.Fatalf("shared fixture resource %s differs", resource.ID)
+			}
+			continue
+		}
+		model.Resources = append(model.Resources, resource)
+	}
+	for _, connection := range aurora.Connections {
+		found := false
+		for _, existing := range model.Connections {
+			if existing.ID == connection.ID {
+				if !reflect.DeepEqual(existing, connection) {
+					t.Fatalf("shared fixture edge %s differs", connection.ID)
+				}
+				found = true
+				break
+			}
+		}
+		if !found {
+			model.Connections = append(model.Connections, connection)
+		}
+	}
+	model.Outputs = append(model.Outputs, aurora.Outputs...)
+	sortModel(model)
+	before := cloneNormalized(t, model)
+	compile := func(input *NormalizedSolution, target string) *TargetArtifact {
+		architecture := decodeMap(t, architectureFromNormalized(t, input))
+		architecture["workloadBehavior"].(map[string]any)["workloads"] = []any{}
+		bytes, err := json.Marshal(architecture)
+		if err != nil {
+			t.Fatal(err)
+		}
+		result := Compile(context.Background(), CompileRequest{Request: Request{Architecture: bytes, Target: TargetKind(target)}})
+		if !result.Succeeded() || result.Artifact == nil {
+			t.Fatalf("mixed immutable architecture compile failed: %v", result.Diagnostics)
+		}
+		return result.Artifact
+	}
+	for _, target := range []string{"terraform", "cloudformation"} {
+		t.Run(target, func(t *testing.T) {
+			artifact := compile(model, target)
+			if artifact == nil {
+				t.Fatal("mixed database export absent")
+			}
+			if !reflect.DeepEqual(model, before) {
+				t.Fatal("mixed export changed source identities")
+			}
+			if target == "terraform" {
+				content := fileContent(t, artifact, "infrastructure/data.tf")
+				for _, declaration := range []string{`resource "aws_db_instance" "database"`, `resource "aws_rds_cluster" "aurora_cluster"`, `resource "aws_rds_cluster_instance" "aurora_a"`, `resource "aws_rds_cluster_instance" "aurora_b"`} {
+					if !strings.Contains(content, declaration) {
+						t.Fatalf("lost native address %s", declaration)
+					}
+				}
+				if strings.Count(content, `resource "aws_db_subnet_group"`) != 1 {
+					t.Fatal("shared subnet group duplicated")
+				}
+			} else {
+				var template map[string]any
+				if err := json.Unmarshal([]byte(fileContent(t, artifact, cloudFormationTemplatePath)), &template); err != nil {
+					t.Fatal(err)
+				}
+				counts := map[string]int{}
+				postgres, auroraMembers := 0, 0
+				for _, raw := range template["Resources"].(map[string]any) {
+					resource := raw.(map[string]any)
+					typ := resource["Type"].(string)
+					counts[typ]++
+					if typ == "AWS::RDS::DBInstance" {
+						properties := resource["Properties"].(map[string]any)
+						switch properties["Engine"] {
+						case "postgres":
+							postgres++
+							if _, present := properties["DBClusterIdentifier"]; present {
+								t.Fatal("standalone database became cluster member")
+							}
+						case "aurora-postgresql":
+							auroraMembers++
+							if _, present := properties["DBClusterIdentifier"].(map[string]any)["Ref"]; !present {
+								t.Fatal("member lost typed cluster identity")
+							}
+						}
+					}
+				}
+				if postgres != 1 || auroraMembers != 2 || counts["AWS::RDS::DBCluster"] != 1 || counts["AWS::RDS::DBSubnetGroup"] != 1 {
+					t.Fatalf("mixed native resource identities lost: %v", counts)
+				}
+			}
+			for _, file := range artifact.Files {
+				if strings.Contains(file.Content, `"MasterUserPassword"`) || strings.Contains(file.Content, "master_password =") || strings.Contains(file.Content, "rds:*") {
+					t.Fatal("mixed export introduced credential or broad permission")
+				}
+			}
+			if !reflect.DeepEqual(artifact, compile(cloneNormalized(t, model), target)) {
+				t.Fatal("identical immutable input changed export or provenance")
+			}
+			reordered := cloneNormalized(t, model)
+			for i, j := 0, len(reordered.Resources)-1; i < j; i, j = i+1, j-1 {
+				reordered.Resources[i], reordered.Resources[j] = reordered.Resources[j], reordered.Resources[i]
+			}
+			for i, j := 0, len(reordered.Connections)-1; i < j; i, j = i+1, j-1 {
+				reordered.Connections[i], reordered.Connections[j] = reordered.Connections[j], reordered.Connections[i]
+			}
+			again := compile(reordered, target)
+			// The source hash correctly describes the exact submitted bytes;
+			// native files and addresses must remain independent of input order.
+			if !reflect.DeepEqual(artifact.Files, again.Files) {
+				t.Fatal("input order altered mixed native files")
+			}
+		})
+	}
+}

```

### service-review-oac-metadata-candidate.patch

```diff
diff --git a/packages/provider-aws/src/catalog/services/cloudfront.ts b/packages/provider-aws/src/catalog/services/cloudfront.ts
index defc17e..546e708 100644
--- a/packages/provider-aws/src/catalog/services/cloudfront.ts
+++ b/packages/provider-aws/src/catalog/services/cloudfront.ts
@@ -404,7 +404,10 @@ export const awsCloudfrontServices = Object.entries(cloudfrontProperties).map(
                 kind: "relationship-resource",
                 rendererContractId: "cloudmarkup.iac.cloudfront-cloudformation",
                 rendererContractVersion: "1.0.0",
-                generatedResourceTypes: [],
+                generatedResourceTypes:
+                  id === "aws.cloudfront.distribution"
+                    ? ["AWS::CloudFront::OriginAccessControl"]
+                    : [],
               },
               configurationBindings: [],
               semanticConfigurationKeys: Object.keys(properties),

```

### service-review-fsx-sfn-sns-metadata-candidate.patch

```diff
diff --git a/packages/provider-aws/src/catalog/services/fsx.ts b/packages/provider-aws/src/catalog/services/fsx.ts
index 473aa58..6d1504e 100644
--- a/packages/provider-aws/src/catalog/services/fsx.ts
+++ b/packages/provider-aws/src/catalog/services/fsx.ts
@@ -317,7 +317,10 @@ function service(input: {
           kind: "relationship-resource",
           rendererContractId: "cloudmarkup.iac.fsx-cloudformation",
           rendererContractVersion: "1.0.0",
-          generatedResourceTypes: [],
+          generatedResourceTypes:
+            input.id === "aws.fsx.lustre-file-system"
+              ? ["AWS::FSx::DataRepositoryAssociation"]
+              : [],
         },
         configurationBindings: keys
           .filter((k) => targetNames[k])
diff --git a/packages/provider-aws/src/catalog/services/step-functions-eventing.ts b/packages/provider-aws/src/catalog/services/step-functions-eventing.ts
index 0303020..ed43c6f 100644
--- a/packages/provider-aws/src/catalog/services/step-functions-eventing.ts
+++ b/packages/provider-aws/src/catalog/services/step-functions-eventing.ts
@@ -371,6 +371,15 @@ export const stepFunctionsStateMachine = defineProviderServiceV1({
             generatedResourceTypes: ["aws_cloudwatch_log_group"],
           },
         }
-      : mapping,
+      : {
+          ...mapping,
+          projection: {
+            kind: "relationship-resource",
+            rendererContractId:
+              "aws.stepfunctions.state-machine.catalog-operations",
+            rendererContractVersion: "1.0.0",
+            generatedResourceTypes: ["AWS::Logs::LogGroup"],
+          },
+        },
   ),
 });
diff --git a/packages/provider-aws/src/catalog/services/sns-eventing.ts b/packages/provider-aws/src/catalog/services/sns-eventing.ts
index 8242272..60364ee 100644
--- a/packages/provider-aws/src/catalog/services/sns-eventing.ts
+++ b/packages/provider-aws/src/catalog/services/sns-eventing.ts
@@ -462,7 +462,6 @@ export const snsSubscription = defineProviderServiceV1(
       terraformResourceType: "aws_sns_topic_subscription",
       cloudFormationTypeName: "AWS::SNS::Subscription",
       terraformConfigurationBindings: [
-        { configurationKey: "subscriptionName", targetName: "stable_identity" },
         { configurationKey: "protocol", targetName: "protocol" },
         {
           configurationKey: "rawMessageDelivery",
@@ -472,7 +471,6 @@ export const snsSubscription = defineProviderServiceV1(
         { configurationKey: "filterKeys", targetName: "filter_policy.keys" },
       ],
       cloudFormationConfigurationBindings: [
-        { configurationKey: "subscriptionName", targetName: "StableIdentity" },
         { configurationKey: "protocol", targetName: "Protocol" },
         {
           configurationKey: "rawMessageDelivery",
@@ -481,7 +479,11 @@ export const snsSubscription = defineProviderServiceV1(
         { configurationKey: "filterScope", targetName: "FilterPolicyScope" },
         { configurationKey: "filterKeys", targetName: "FilterPolicy.Keys" },
       ],
-      semanticConfigurationKeys: ["retryPolicy", "deliverySemantics"],
+      semanticConfigurationKeys: [
+        "subscriptionName",
+        "retryPolicy",
+        "deliverySemantics",
+      ],
       terraformPortBindings: [
         { portId: "aws.sns.subscription.topic", targetAttribute: "topic_arn" },
         {

```

## Evidence index

| Evidence                                        | SHA-256                                                          | Bytes   |
| ----------------------------------------------- | ---------------------------------------------------------------- | ------- |
| service-full-catalog-inventory.json             | b4daf8b6dea41b3b219bb8757a0bb0f463ec459bd0d549132201db752693b368 | 1956556 |
| service-full-catalog-summary.json               | e1dd71262b2f245d202f306cd7b1feba44758ec556e5fa10fc5bff6e4c874d40 | 2288    |
| service-full-runtime-coverage.json              | c65bc15d5b66cc13e7993aaf6dae1b29003d89885f777c168e4510f007510d51 | 1390513 |
| service-full-ui-coverage.json                   | 6041e441c2269b52c1c46cdfd159f317fae15a7aba53691c39168ed641a253aa | 279982  |
| service-full-documentation-audit.json           | 8373078a6ef5a5ef89c2c298a23474204e2848fa8d1526eecadcb21746dddfe9 | 59745   |
| service-full-primary-documentation-receipt.json | 41b2633532ffb8e93c99a4e8765d9c72af6d67d29f908c6c13486e76b9427d23 | 77961   |
| service-full-patch-receipt.json                 | f3d531abb831579a08ebb654d48b110fec4f7ee7dcc97bf206dbfcab0c7aea1a | 2052    |
| service-review-icon-coverage.json               | 26c6aa3a4a45e884ed4d550733792bd91a2e4e994f7354ff2e4cecf5326302eb | 33701   |

The prior17-definition detailed review, minimal attestation patch and icon
preview remain preserved in Library report
`libfile_57ad9084b1d88191b3e1c5c2e293e59f` and contact sheet
`libfile_1f266c2c4a008191aa6479e237764455`. No authenticated rendering or
production mutation is implied by a Library artifact.
