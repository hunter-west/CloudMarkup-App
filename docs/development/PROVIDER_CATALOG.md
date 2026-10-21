# Provider catalog development

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

## Purpose and current boundary

Provider catalogs are reviewed, versioned release artifacts that connect the
provider-neutral Architecture Document to provider-specific services, ports,
relationships, validation, education, and compiler mapping declarations.
`@cloudmarkup/provider-sdk` owns the version-1 semantic catalog contract plus
the separately compiled connection-presentation and service-extension contracts.
`@cloudmarkup/provider-aws` supplies the first bounded production-oriented slice
through static local source files. Each extension artifact binds the exact
semantic catalog ID, version, and digest; neither may reinterpret graph
semantics.

Catalog presence alone does not make a service supported. Every real service or
relationship must satisfy the
[MVP curated-support rule](../product/MVP_SCOPE.md#curated-support-rule).
Provider-specific facts cannot move into `@cloudmarkup/domain`.

## Installed AWS catalog 0.30.0

The installed catalog source contains 73 definitions, 139 connections and 34
validators. Its exact digest is
`sha256:8e9b1b23bbcdf723352044baddd8e79468d70ed5a719af914036992daf91fb94`.
Current services, configurations, validators and export mappings retain the
prepared 0.29.0 behavior. Removing historical migration metadata changes the
artifact identity, so 0.30.0 has a new version and digest.

AI grounding, generators and the native compiler require the exact installed
binding. Mutable draft opening separately checks the saved graph against the
current catalog in `graph-preparation/catalog-opening`. Compatible catalog
additions prepare a binding-only graph command on a clone and persist only on
the next authorized save. Service configuration schema version changes expose a
lossless adaptation for explicit review. Unknown fields, removed definitions,
invalid values and unsupported migrations retain the original with issue paths
and a recovery download. No field, node or connection is dropped, and unknown
document versions still fail closed. Immutable historical revisions and their
export evidence are never rebound. Git preserves old source; no arbitrary
historical replay dispatcher is installed.

The two additional proof-level definitions are a regional WAF Web ACL and its
explicit owned ALB association. Their current-catalog configuration, connection
resolution, validation and native CloudFormation export cover a bounded managed
rule group and origin-IP rate rule. Both default to count mode. Sampling and
request logging are disabled, and the ACL is retained on removal/replacement.
The association uses exact modeled ACL/ALB ARNs; no IAM or deployment authority
is inferred. The new icon identities use neutral missing-artwork placeholders.

This is CloudFormation infrastructure proof, not full MVP support. Terraform,
CloudFront/global scope, HTTP API targets, arbitrary statements, external or
cross-Region targets, request logging/sampling and live traffic qualification
remain unavailable. Existing ALB behavior remains intact. The source plan
records current-catalog and native export qualification; release admission,
dependent synthetic baselines and frozen model/evaluation qualification remain
separate from this source capability.

The following numbered release descriptions are historical development records.
Their retention/upgrade claims describe earlier implementations; the installed
boundary above and the package README define current behavior.

## Historical AWS source catalog 0.22.0

The current source artifact is `0.22.0`, digest
`sha256:4bc61d0bd4b648d426ed01c30e9932146f9d5b49baa56937d2af207a5948732d`. It
contains 48 resource, boundary and owned-configuration definitions, 97
connection descriptors and 26 validation descriptors. These are bounded slices
of 16 service families, not 48 independent AWS services. The 50-family plan
identifies the remaining families; the KMS, Secrets Manager and EC2 foundations
leave 34 families awaiting implementation. [STATUS](../PUBLIC_STATUS.md)
separately owns which exact source is deployed.

Catalog 0.18 corrects Lustre PERSISTENT_2 SSD and single-HA-pair ONTAP capacity
admission. Its Terraform renderer derives the required preferred subnet from the
existing unique subnet relationship. Catalog 0.19 also rejects unsupported
shared-namespace S3 names and malformed or overlapping direct Lambda filters;
its Terraform EventBridge notification uses the provider-required boolean. Both
export targets apply the version-bound validation. Explicit catalog upgrades
preserve configured values and require users to resolve findings. See the FSx
plan and S3 plan.

The exact 0.17, 0.18, 0.19, 0.20 and 0.21 catalog/extension snapshots and
historical behavior remain installed. No historical artifact, migration, name,
capacity, filter or destination is silently rewritten. The source-pinned
[second audit](../engineering/POST_REFACTOR_SECOND_AUDIT.md) describes its 0.17
findings; these capacity/S3 successors address bounded defects, while AI list
proposal support and stale education claims remain separate work.

Service extension readiness marks 46 definitions supported for the reviewed
Terraform/CloudFormation projections and the Region/AZ boundaries not
applicable. All 48 regional-availability entries remain unknown. This does not
prove arbitrary AWS configuration, hosted Terraform activation or unrestricted
application generation. The numbered sections below describe named historical
versions; current readiness comes from the exact service-extension artifact.

### Private Linux EC2 compute foundation

Catalog 0.22 adds `aws.ec2.instance` and `aws.iam.instance-profile`: two cards
and one compute family. Instance profiles belong to existing IAM; inline root
storage does not count as standalone EBS. Exact source schemas drive setup and
Inspector controls. Explicit static AMI Region/architecture/root device/minimum
and root-only declarations, a reviewed T3/x86_64 or T4g/arm64 type, one modeled
subnet, one to five same-VPC security groups and a real profile are required.
Profile roles need canonical user-owned unconditional EC2-only trust. The five
new atomic connections bind existing resources without inferred IAM grants.

Both targets emit private addressing, required IMDSv2, explicit monitoring/
standard CPU-credit intent and encrypted baseline gp3 root storage. Root
deletion is explicit and defaults to retention. Terraform uses actual profile
name and 125 MiB/s throughput; CloudFormation owns one primary interface and
uses native root device/Iops fields, without inventing unsupported Throughput or
profile Tags properties. Reviewed outputs expose instance ID/private addresses
and profile name/ARN. Offline warnings retain image/launch/PassRole/ key
permissions, workload suitability and retained-disk cost/recovery as external
evidence. Imports, existing ENIs, public IP, Windows/Spot/fleets/ASG, data
disks, SSH/password/user-data/bootstrap and generated applications remain
outside the slice. Frozen 0.21 graphs receive no EC2/profile authority. See the
EC2 plan.

### Regional Secrets Manager metadata foundation

Catalog 0.21 adds one service card and one family. Required non-secret name,
purpose, external-population value mode, explicit encryption choice, 7-30 day
Terraform recovery window and mandatory retention use the same catalog-derived
setup and Inspector controls. Terraform exports `aws_secretsmanager_secret` with
`prevent_destroy`; CloudFormation exports `AWS::SecretsManager::Secret` with
removal/replacement Retain. Both create empty metadata. Populate externally
before use; values, versions, generated passwords, rotation, replicas, database
attachments, imported secrets and runtime retrieval are outside this slice.

Customer-managed mode requires one exact enabled regional KMS key connection. It
grants no permissions; explicit key-user/deployment authority remains a separate
reviewed key-policy choice. User-owned role identity-inline statements may
independently choose GetSecretValue or DescribeSecret and must bind one typed
full secret ARN with matching owner, membership and scope edges. No pasted or
wildcard ARN, principal, condition, write/admin action or application behavior
is inferred. Frozen 0.20 graphs receive no secret reference authority. The wave
plan records implementation evidence and coordinator-owned admission.

### Regional symmetric KMS foundation

Catalog 0.20 adds one AWS-generated regional symmetric encryption key. Strict
fields fix `SYMMETRIC_DEFAULT`, `ENCRYPT_DECRYPT`, `AWS_KMS`, single Region and
retention; rotation accepts 90–2,560 days and deletion waiting accepts 7–30
days. The key-policy slot requires one user-owned canonical resource document
with matching semantic parent and exact ownership edge. Every statement requires
its own exact membership and owning-key scope, explicit same-account/partition
IAM role ARNs, reviewed unconditional allow actions, and a separate
administrator statement permitting `kms:PutKeyPolicy`. No role or deployment
account is inferred.

Only the key's validated typed self-reference becomes KMS's owner-local
`Resource: "*"`; pasted/wildcard resources, actions and principals stay
forbidden. Terraform uses inline `policy`, lockout bypass false and
`prevent_destroy`. CloudFormation uses inline `KeyPolicy`, lockout bypass false,
`DeletionPolicy: Retain` and `UpdateReplacePolicy: Retain`. Rotation period is
omitted when rotation is disabled. Caller authority, role existence and regional
availability remain outside offline proof. Other key types, aliases, grants,
cross-account policy, service-encryption connections and application
cryptographic behavior remain unsupported. The foundation plan records golden,
negative and compatibility evidence plus pending release gates.

## AWS catalog 0.16.0 historical nested policy placement

Exact catalog 0.16.0 is bound to
`sha256:b8ae0f69d0fceae28e631e9036b745d2e8988967daee0a0b217e0da392d704d6`. It
changes only three service definition versions and absolute placement bounds:
policy documents at depth four, statements at five and conditions at six. This
admits the existing Region/VPC/gateway-endpoint policy hierarchy. The exact
0.15.0 migration preserves graph data, identities, ownership, configuration,
mappings and layout; historical catalog bytes are reproducible unchanged.

Both existing compiler targets and the notes/event application generators admit
the new exact coordinate. Regression checks compare unchanged Terraform source
and CloudFormation resource/parameter/output/condition sections with 0.15.0. No
new service, renderer, application behavior or runtime capability is added.

The installed IAM validators now recognize exact gateway endpoint
resource-policy ownership and explicit identity-inline role permissions. They
require matching semantic parents, typed owner bindings and table-scoped
actions; malformed, duplicate and unrelated ownership cannot satisfy a
permission requirement.

## AWS catalog 0.15.0 historical curated CloudFormation scope

Exact catalog `0.15.0` is additive over immutable initial CloudFormation release
`0.14.0`. It is bound to
`sha256:5454b1255486921e0240ccd67f3ee1effd5e0b25eb2aaee082e13221528bef3e`. The
fail-closed migration accepts only the exact `0.14.0` artifact and changes
reviewed CloudFormation implementation readiness without rewriting architecture,
Terraform mappings, application artifacts, or historical catalogs.

The current release promotes only compiler-evidenced VPC/subnet/route/gateway/
endpoint/security-group/Lambda-VPC mappings and S3/SQS/SNS/EventBridge/Step
Functions/Lambda-event-source mappings. Implemented declarations have matching
structured-renderer, source-linked negative, reproducibility, cross-target IAM,
networking, event/filter/retry/DLQ, artifact, parameter/output/tag, policy
ownership, CLI/export/workflow, and Terraform regression evidence.

Ambient Region and Availability Zone remain placement rather than standalone
resources. Owned S3 configuration and SQS redrive behavior are embedded in
native CloudFormation resources, the default EventBridge bus is referenced
rather than created, and application ZIP coordinates are parameters for the same
target-neutral Prompt 32A checksum contract. These are documented target
differences, not architecture differences.

Catalog readiness adds no template fragment callback, source generator, build,
credential, provider/AWS validation, packaging/upload, change-set, stack,
repository synchronization, or deployment authority. Unsupported interface
endpoints, arbitrary filters/ASL, recursive cycles, incompatible FIFO/DLQ modes,
cross-account/cross-Region eventing, and unbounded retries remain explicit
source-linked findings before export.

## AWS catalog 0.14.0 historical initial CloudFormation scope

Exact catalog `0.14.0` is additive over immutable event application release
`0.13.0`. It is bound to
`sha256:bed0eb4d2ec40a08a4c10db9f84177b8c25c4901f03d794499586ac4a4a170f4` and
retains 38 service/configuration definitions, 75 connection descriptors, and 19
validation descriptors. The fail-closed migration accepts only the exact
`0.13.0` artifact and republishes unchanged semantic behavior.

The release promotes CloudFormation readiness only for the compiler-evidenced
initial API Gateway, Lambda, DynamoDB, Cognito, IAM, and CloudWatch family.
Implemented declarations require matching structured-renderer goldens,
target-specific negative cases, reproducibility, local structural validation,
IAM/artifact assertions, and Terraform regression evidence. Logical IDs derive
from deployment keys and stable graph IDs. Generated/custom policies,
permissions boundaries, managed attachments, trust, and invocation permissions
retain their typed graph/configuration ownership.

In this historical release, networking and event CloudFormation declarations
remain metadata-only and pending. Catalog readiness adds no template fragment,
callback, provider execution, source generation, build, credential, AWS
validation, package/upload, change-set, stack, repository synchronization, or
deployment authority. Exact `0.14.0` admitted the existing application
generators unchanged so both IaC targets bind one Prompt 32A artifact contract.

## AWS catalog 0.13.0 event application scope

Exact catalog `0.13.0` is additive over immutable Terraform event release
`0.12.0`. It is bound to
`sha256:7a346f839851cba07c6e59d5311f630897a1181967e9ceb8fb3ba4755305ec8d` and
retains 38 service/configuration definitions, 75 connection descriptors, and 19
validation descriptors. The fail-closed migration accepts only the exact
`0.12.0` artifact and preserves all earlier version-specific compilation inputs.

The release leaves reviewed event Terraform metadata and compiler bytes
unchanged while adding exact generated-application readiness for the six curated
Workload/event-contract patterns: S3 upload metadata processing, SQS Lambda
consumer with DLQ, SNS fan-out consumers, EventBridge schedule, EventBridge
event target Lambda, and Step Functions Lambda tasks. Readiness requires the
exact reviewed event generator/template/pattern/dispatcher tuple, complete
operation and contract coverage, and a passing Prompt 32A artifact manifest.
Missing or mismatched coverage remains starter, custom-required, or
application-code-required; catalog metadata alone never upgrades it.

Terraform binds the final immutable ZIP/checksum and target-neutral artifact
metadata. IAM and resource policy remain derived from typed graph edges and
owned configuration rather than generated source. CloudFormation event mappings
remain metadata-only and pending. Catalog `0.13.0` adds no provider execution,
source execution, plan/apply, credentials, cloud access, model authority,
repository synchronization, or deployment behavior.

## AWS catalog 0.12.0 historical event Terraform scope

Exact catalog `0.12.0` is additive over immutable event-contract release
`0.11.0`. It is bound to
`sha256:5cdfca9761d0d6875eef22abd51f94a7cc7109f065f92f9b454e4585f9cfb410` and
retains 38 service/configuration definitions, 75 connection descriptors, and 19
validation descriptors. A fail-closed no-inference migration accepts only the
exact checked `0.11.0` identity and digest; historical service, relationship,
configuration, validation, presentation, and extension truth is reproduced from
immutable version-specific inputs rather than mutable current definitions.

Catalog `0.12.0` promotes the reviewed event Terraform declarations and target
readiness to `implemented` where deterministic compiler evidence exists. This
includes S3 bucket notification configuration, SQS queue redrive/DLQ and Lambda
event-source mapping, SNS subscriptions, EventBridge bus/rule/target and bounded
retry/DLQ configuration, Standard Step Functions, Lambda invocation permission,
typed IAM/resource-policy effects, and generated support resources. Exact HCL
references express dependencies; arbitrary `depends_on` is not part of the
mapping or compiler contract.

Identity and resource permissions are derived only from typed edges and owned
configuration, use reviewed action sets and exact resource scopes, and retain
generated provenance. Custom policy documents remain separately user-owned and
cannot be replaced or removed by generated cleanup. Unsupported topology,
direction, missing permission coverage, FIFO combinations, arbitrary filters,
cycles, and retry modes produce stable source-linked diagnostics and no partial
artifact.

CloudFormation mapping declarations remain `metadata-only` and pending. In
historical catalog `0.12.0`, deterministic event application generation had not
yet landed: Terraform could only bind the stable application artifact contract
or report `APPLICATION_CODE_REQUIRED`, and the four curated editor templates
were infrastructure-ready only. Catalog `0.13.0` supersedes that
application-readiness statement.

The shared editor continues to consume catalog connection presentation and
service-extension artifacts. Stable grouped docks, readable fan-out, delivery/
duplicate/ordering/retry/cost guidance, and assistance-mode wording are
presentation only; all graph changes still use the same versioned deterministic
command engine.

## AWS catalog 0.11.0 historical event contracts

Exact catalog `0.11.0` is additive over the immutable `0.10.0` networking
release. It is bound to
`sha256:33aba8e2c5881ba3c25055ddc333b7b4a151b83d9acbb3e99088bf984bda6852` and
contains 38 service/configuration definitions, 75 connection descriptors, and 19
validation descriptors. The exact checked `0.10.0` artifact remains the
historical compiler input; its services, relationships, validation, and digest
are not reconstructed from mutable current source.

The bounded event-driven slice adds S3 bucket; SQS queue with owned redrive/DLQ
configuration; SNS topic and subscription; EventBridge bus, rule, and target;
and a curated Standard Step Functions state machine. S3 lifecycle, CORS, and
notification settings are separate graph-backed owned configurations. A DLQ is
an ordinary SQS queue selected through a redrive relationship, not a container
or a second queue type. Lambda retains its existing identity and gains only
reviewed producer/consumer relationships and event-specific education.

The 35 additive relationships distinguish each direction and AWS mechanism: S3
notification to Lambda or the default EventBridge bus; Lambda send/publish/
put/start actions; SQS event-source invocation and redrive; SNS subscription
fan-out; EventBridge bus/rule/owned-target flow; Lambda and Step Functions
invocation; the explicit EventBridge execution role required for a Step
Functions target; resource-policy ownership; IAM resource scope; and owned
configuration membership. Producer, event, publish, subscribe, consume, and
invoke ports have exact input/output cardinality and stable dock groups. A
single bidirectional-looking edge never substitutes for separate Lambda-to-SQS
send and SQS-to-Lambda consumption contracts.

S3, SQS, SNS, EventBridge, Step Functions, and Lambda remain regional managed
services outside customer VPC containment. Their placement does not imply
network reachability. Canonical S3 bucket, SQS queue, SNS topic, and EventBridge
bus resource policies use typed policy-document owner slots. Connection IAM
effects are wildcard-free and separate identity permissions from resource-side
Lambda invocation grants. Generated support resources declare exact owner,
adoption, sharing, and cleanup provenance.

Nine provider-local Workload relationship records state the required operation
and event-contract binding, at-least-once or ordering implications, duplicate
handling expectations, and source/destination direction. They are metadata for
future reviewed application integration only: Prompt 44 does not generate,
infer, or render application payloads or source.

Deterministic event topology and delivery validation cover event and DLQ cycles,
duplicate S3 notifications, default-bus requirements, FIFO naming/dedup and
producer compatibility, SNS protocols/filters, EventBridge target/retry/DLQ
constraints, SQS visibility versus Lambda timeout/batching, and curated Step
Functions retry/timeout conflicts. FIFO SNS-to-Lambda, Lambda/EventBridge FIFO
DLQs, and EventBridge FIFO SQS targets without the unsupported message-group
parameter block fail closed. Validation reports exact findings and does not
select destinations, policies, ordering, or retry posture for the user.

Terraform and CloudFormation declarations are mapping metadata only, and every
event target-readiness entry is `pending`. Nested CloudFormation declarations
are omitted when the provider SDK cannot honestly represent a nested child; they
are never relabeled as standalone resources. Prompt 44 adds no compiler,
UI/editor, application renderer, provider execution, plan/apply, credential,
cloud, or deployment behavior. Cross-account/cross-Region delivery,
customer-managed KMS, EventBridge Pipes/archive/replay/schema discovery/API
destinations, uncurated SNS delivery protocols, Express workflows, activities,
arbitrary ASL, arbitrary filter JSON, and raw provider-property bags are
explicitly unsupported.

## AWS catalog 0.10.0 scope

The exact `0.8.0` catalog remains the immutable curated authenticated-notes
family consumed by the standalone application source generator and preserved by
the Go compiler's legacy path. Exact `0.9.0` remains the immutable historical
release that introduced networking semantics as metadata-only intent. Current
catalog `0.10.0` is additive over both; it does not reinterpret their IDs. The
legacy family's 12 concepts are:

- API Gateway HTTP API;
- Lambda function;
- DynamoDB table;
- Cognito user pool and user-pool app client;
- IAM role plus graph-backed IAM policy document, statement, condition, and
  managed-policy attachment configurations; and
- CloudWatch log group and single-metric alarm.

Typed relationships connect authentication, invocation, distinct data read/write
access, authorization, logging, monitoring, policy ownership,
statement/condition membership, managed-policy attachment, permissions
boundaries, and Lambda invocation grants. Reviewed deterministic resolver
registrations cover HTTP route to Lambda, Cognito issuer and audience to the
API, IAM role to Lambda, Lambda data read and data write to DynamoDB, Lambda to
a log group, and Lambda to a basic Errors alarm. Remaining descriptor-only
relationships cannot claim standalone mutation or compiler support.

Lambda continues to declare generic capability ports for invocation/event
sources, data/object/message/event/workload/configuration/telemetry, and role,
VPC, dead-letter, logging, and observability associations. Rules—not capability
names—remain authoritative, and every semantic port still belongs to one exact
stable dock. The established notes validation packs continue to cover
authentication, canonical IAM ownership, principals, actions, resources,
conditions, and wildcard safety, Lambda role/runtime/handler bounds,
loaded-document and owner-slot cardinality, trigger compatibility, DynamoDB
permissions and protection, log retention, unresolved connection questions,
Region availability, and exact compiler readiness. The additive networking slice
extends these facts; it does not reinterpret them.

Catalog `0.9.0` introduced 14 production-oriented networking concepts without
changing those identities: AWS Region, VPC, Availability Zone, and public or
private subnet boundaries; route table, route, and route-table/subnet
association; internet gateway; zonal public NAT gateway; S3 or DynamoDB gateway
VPC endpoint; security group plus separate ingress and egress rule
configurations; and Lambda VPC-access configuration. Catalog `0.10.0` preserves
those service, port, dock, relationship, configuration, and policy identities
while adding the reviewed Terraform projection, stricter deterministic
validation, and exact application-reachability binding. That historical `0.10.0`
artifact has 26 service definitions, 40 exact relationship descriptors and 17
validation descriptors.

### Stable networking semantics

Containment is deliberately narrow:

- the document's Region boundary contains VPC placement;
- a VPC contains Availability Zone placement plus route-table and gateway-
  endpoint scope;
- a subnet belongs to exactly one Availability Zone; and
- one supported zonal public NAT gateway may be placed in its public subnet.

The Availability Zone boundary is a view of zonal placement, not a claim that a
customer owns the AWS Availability Zone. Route tables control subnets through
explicit graph-backed association configurations. Internet gateways attach to
VPCs. Security groups are associated stateful policies with owned ingress and
egress rules; they never contain workloads. Lambda remains outside VPC
containment and owns at most one VPC-access configuration, which selects exact
same-VPC subnets and security groups. S3 and DynamoDB remain managed services
outside the customer VPC; a gateway endpoint selects the service and route
tables without reparenting either service.

The 20 networking relationships separate six placement relationships, six
structured owner-slot relationships, and eight direct associations. The eight
associations have deterministic, edge-only resolver registrations. Placement,
route/rule/configuration ownership, and endpoint-policy ownership remain
descriptor-only in the free-form connection workflow because their established
canonical reparent, owned-configuration, or policy operations own the mutation.
A descriptor's `not-implemented` connection status therefore prevents a second
mutation path; it does not mean the graph fact is unmodeled. Direct association
resolvers add only the reviewed edge and declare empty supporting-resource and
IAM effects. The NAT gateway takes a reviewed existing allocation ID; no rule
silently creates an Elastic IP address.

The exact owned slots are route-table routes and subnet associations,
security-group ingress and egress rules, one optional canonical gateway-
endpoint resource policy, and one optional Lambda VPC-access configuration.
Routes and route-table associations may be user-authored or generated and
require adoption before generated customization. Security-group rules, endpoint
policies, and Lambda VPC choices stay user-owned because network and permission
intent must not receive a broad default.

Every networking semantic port is assigned to one stable input or output dock,
and every relationship has one concise label. Guided explanations lead with
placement or selection; Professional explanations expose exact ports,
cardinality, provenance, and readiness. Connection, Security, Cost, and
Operations details remain in the catalog's secondary education fields. This is
catalog-authored presentation data: the editor may consume it without changing
graph or compiler meaning, and target readiness remains authoritative for
generation support.

### Routing choices and deterministic validation

`accessTier` records reviewed public/private intent, but routes prove the
posture. Every supported subnet has an explicit route-table association. A
public subnet needs a reviewed internet-gateway attachment and default route; a
private subnet cannot point its default route directly to an internet gateway.
General outbound IPv4 from a private subnet can target a supported zonal public
NAT gateway. Eligible S3 or DynamoDB traffic can instead use a gateway endpoint
associated with the selected route tables, avoiding NAT for that service
traffic.

The four new deterministic rule packs validate network placement, routing,
security-group policy, and Lambda VPC access. They check Region/VPC/AZ ancestry,
IPv4 CIDR containment and overlap, same-VPC associations and gateway targets,
route and endpoint completeness, duplicate service endpoints, endpoint-policy
mode, ingress/egress direction and scope, Lambda subnet/security-group
cardinality, same-VPC and multi-AZ selection, reviewed Lambda ENI permission,
explicit egress requirements, target limitations, and configured organization
policy constraints. Recommendations call out one-zone concentration, zonal NAT
resilience, cross-zone transfer, and NAT hourly/data-processing cost. A public
subnet does not give Lambda a public IP address. Security-, topology-, or
cost-bearing decisions produce findings without invented auto-fixes.

The slice explicitly excludes IPv6/dual-stack and NAT64, secondary CIDRs and
IPAM, local/Wavelength/Outpost zones, private or regional NAT, interface and
Gateway Load Balancer endpoints, cross-Region endpoints, implicit main/default
route resources, advanced transit/peering/VPN/firewall and route targets,
inline/default or non-CIDR security-group rules, cross-VPC security groups, and
automatic Lambda VPC permission generation. The established notes concepts
continue to list their own unsupported raw provider properties.

The additive mapping contract records relationship-resource, owned-resource, and
owner-nested-block projection metadata. The exact `0.10.0` Go renderer uses the
subnet's required Availability Zone and that zone's exact VPC ancestor to
produce `aws_subnet.vpc_id`; the earlier Terraform ancestry gap is closed.
CloudFormation was pending in that historical version. The later renderer must
preserve the same reviewed ancestry projection and suppress default allow-all
IPv4 egress before emitting standalone narrow egress rules. Current exact
support is recorded above; a metadata-only declaration is never executable
support.

### Readiness boundary

Networking modeling, strict configuration, stable docks, owned slots, and
deterministic validation are supported in catalog `0.10.0`. Managed networking
resources and graph-backed routes, associations, rules, endpoint policies, and
Lambda VPC access now have implemented Terraform readiness backed by the exact
reviewed renderer. Region and Availability Zone remain ambient placement with no
managed-resource mapping and `not-applicable` renderer readiness. In exact
`0.10.0`, CloudFormation remains metadata-only and pending for every managed
networking projection; `0.15.0` and its admitted successors add that renderer.

The Go compiler accepts only exact `0.8.0` legacy and exact `0.10.0` networking
catalog bindings; exact historical `0.9.0` is rejected rather than partially
rendered. The application source generator remains exact-`0.8.0` and does not
embed networking. A separate exact-`0.10.0` projection emits deterministic
source-referenced reachability assumptions and a downstream data-only
smoke/Evidence configuration. It changes no generated source and grants no
network, plan/apply, credential, cloud API, or deployment authority.

## Source layout

AWS source is statically imported from:

```text
packages/provider-aws/src/catalog/
  provider.ts
  source.ts
  services/
  connections/
  validation-rules/
  migrations/
  connection-presentation.ts
  service-extension.ts
```

Files are explicit reviewed inputs. Do not scan directories dynamically, load
module paths from catalog data, fetch catalog or schema data at runtime, or
hotlink assets. `source.ts`, `connection-presentation.ts`, and
`service-extension.ts` are the explicit assembly roots for their separate
artifacts.

## Artifact separation

The three artifacts have deliberately different authority:

- the semantic catalog owns exact service/port inventory, compatibility rules,
  configuration schemas, effects, lifecycle, validation, and compiler mapping
  declarations;
- connection-presentation v1 maps every semantic port to exactly one stable dock
  and every rule to one concise relationship label; and
- service-extension v1 maps every service to target-readiness entries and zero
  or more owned-configuration slots.

The extension artifacts carry their own version, canonicalization marker, and
digest and bind the exact semantic catalog ID, version, and digest. They are not
Architecture Document fields. A presentation regrouping cannot change an edge,
Graph Command, semantic hash, provenance, or deployment address. A slot or
readiness change that alters supported semantic behavior requires a reviewed
catalog/compatibility decision rather than UI-only reinterpretation.

The provider-neutral dock taxonomy is `triggers`, `data`, `messaging`,
`invocation`, `identity`, `networking`, `observability`, and `other`. Use only
the groups needed by the service. Each dock declares side/order, one strict
input-only or output-only direction policy, an explicit cardinality range,
multiple-edge/exclusivity facts, and assistance text. Input is always left;
output is always right; mixed direction is split into separate docks. The
compiler rejects unknown services/ports/rules, missing or duplicate port
assignments, direction/placement mismatch, mixed direction, range/multiplicity
errors, unstable IDs/orders, and missing or extra relationship labels. A
declared port without a reviewed rule remains a visible informational dot and
cannot create an edge.

## Owned configurations, policies, and readiness

Owned configurations reuse Architecture nodes and exact binding edges. The
configuration node ID is the stable attachment ID; the one validated owner-slot
edge identifies its owner and slot. Node and edge lifecycle/provenance must
match. Slot metadata declares the graph binding, minimum/maximum cardinality,
allowed user/generated ownership, adoption policy, policy kinds, target
readiness, and mode assistance. Do not add a parallel attachment array or store
deployment-relevant configuration only in React state.

The canonical policy contract distinguishes identity-inline, trust, resource,
generated-permission, and service-grant documents from managed-policy
attachments and permissions boundaries. Documents contain typed statement nodes;
statements contain typed condition nodes and use exact graph relationships or
bounded expressions for resource scope. Policy kind and statement `allow`/
`deny` effect are separate. Projection rejects ambiguous ownership,
policy-kind/principal mismatch, empty actions or required resources, malformed
conditions, duplicate equivalent statements, lifecycle drift, unsupported
action/service pairs where evidence exists, and wildcard action/resource/
principal scope.

Target readiness is a six-part matrix: modeling, configuration, validation,
Terraform, CloudFormation, and generated application code. Each entry is
`supported`, `pending`, `unsupported`, or `not-applicable` with a precise
reason. Current notes-API and owned-policy projections have reviewed Terraform
and CloudFormation compiler evidence for their exact admitted catalogs. Catalog
metadata must never promote a renderer before matching compiler, negative,
reproducibility and golden evidence exist.

Catalog `0.10.0` applies the same contract to networking. Route-table routes and
subnet associations, security-group ingress and egress rules, endpoint resource
policy, and Lambda VPC access are graph nodes joined by exact owner-slot edges.
A route target, subnet selection, security-group selection, gateway attachment,
or endpoint/table selection is a separate association edge; storing a duplicate
provider ID inside the owner node would create a second truth and is prohibited.

Networking readiness was asymmetric in `0.10.0`: Terraform was supported and
CloudFormation pending. Exact `0.15.0` and its admitted successors add the
reviewed CloudFormation projections. Ambient Region/AZ boundaries remain not
applicable to either renderer, and networking does not generate application
source. Exact `0.9.0` remains a historical metadata-only artifact and is not
promoted or silently repinned at the compiler boundary. The separate
reachability artifact is supporting evidence, not application source generation.

## Add a service

1. Confirm the service is authorized for the active milestone and record how it
   will satisfy every curated-support criterion.
2. Add one definition file under `services/`, export it from
   `services/index.ts`, and add exact entries to both
   `connection-presentation.ts` and `service-extension.ts`.
3. Choose stable dot-namespaced service, resource or boundary, configuration,
   port, capability, dock, owned-slot, documentation, mapping, and icon IDs.
   Only graph-only, nondeployable internal configuration concepts may use a
   `null` icon ID; every deployable service and visible boundary requires one.
   IDs are compatibility inputs; display labels are not substitutes.
4. Declare either a `resource` node kind or a provider-semantic `boundary` node
   kind. State root placement, allowed parent service/relationship types,
   maximum depth where meaningful, and region constraints. Do not represent
   association as containment.
5. Provide a bounded Draft 2020-12 object schema. It must use
   `additionalProperties: false`; its `$id` must be
   `urn:cloudmarkup:configuration:<schemaId>:<schemaVersion>`. Required fields,
   defaults, ranges, enums, patterns, and UI hints must agree. Every property
   needs one UI hint with `securityImpact`, `costImpact`, and `valueSource`.
   Non-literal sources use Architecture Document reference values:
   `node-reference`, `secret-reference`, or `variable-reference`; never place a
   secret or credential in a JSON Schema default.
6. Define exact semantic input/output ports: capability, direction, required
   state, `one` or `many` aggregate cardinality, and the compatible relationship
   types supplied by separate rules. Port IDs are graph facts, not React Flow
   handle IDs. A port with no implemented rule is visibly unsupported, not
   connectable.
7. Assign every semantic port to exactly one stable visual dock. Declare the
   provider-neutral group/category, label, description, boundary side, order,
   strict input-only or output-only direction, explicit minimum/maximum range,
   multiple-edge behavior, exclusivity, Guided assistance, and Professional
   technical metadata. Input docks must be left, output docks must be right, and
   mixed docks must be split. Do not declare a port or dock merely to imply a
   service exists; a reviewed future-capability port may remain as an honest
   informational dot but must not become connectable until a compatible rule
   exists.
8. Declare every applicable service-owned configuration slot with its exact
   graph binding, configuration kind, cardinality, allowed user/generated
   ownership, adoption rule, applicable policy kinds, and generated-resource
   behavior. Future resource-policy, lifecycle, CORS, notification,
   encryption/key-policy, logging, retry, or dead-letter blocks use this generic
   contract when actually supported.
9. Declare target readiness separately for modeling, configuration, validation,
   Terraform, CloudFormation, and generated application code, with a precise
   reason for each `supported`, `pending`, `unsupported`, or `not-applicable`
   status. Metadata-only mappings are never export support.
10. Set region availability to `known` only with reviewed evidence and explicit
    coverage. Otherwise use `unknown` with a useful reason; never infer
    availability from an omitted value.
11. Add distinct Guided and Professional service explanations plus four reviewed
    consideration entries labeled `Connections:`, `Security:`, `Cost:`, and
    `Operations:`. Add only reviewed Cloud Markup or official HTTPS
    documentation references. Both modes receive the same fields, actions,
    consideration topics, graph meaning, and readiness facts; only the
    assistance wording may differ.
12. List excluded provider capabilities explicitly. An omitted raw cloud
    property is not silently supported.
13. Reference an opaque icon ID for every deployable service and visible
    boundary. A hidden nondeployable configuration concept may explicitly use
    `null` and is excluded from palette/icon registration. Do not add a file
    path, URL, or image data; official assets belong to the controlled pipeline.
14. Use `production-oriented` only for reviewed metadata that is intentionally
    awaiting provider-rule or compiler evidence. Use `curated` only when every
    curated-support criterion is satisfied.
15. Add synthetic valid/invalid configuration, presentation totality, dock
    direction/cardinality, owned-slot, target-readiness, validation, and
    compatibility tests. Never use an AWS account ID, ARN, credential, token,
    customer value, or secret.

Generation must fail if a service is missing its presentation or service-
extension entry, any semantic port is unassigned or multiply assigned, a dock or
slot is invalid, or the extension binds a different catalog ID, version, or
digest.

## Add a connection rule

1. Add a descriptor under `connections/`, export it from the directory index,
   and add one concise user-facing relationship label to
   `connection-presentation.ts`.
2. Give the rule a stable ID and semantic version, one exact relationship type,
   one exact output source service/port, one exact input target service/port,
   explicit per-source, per-target, and endpoint-pair maxima, educational
   content, target support, and any required validation-rule IDs.
3. Verify that both semantic endpoints resolve to their declared stable visual
   groups. The groups are presentation metadata only; the rule and resulting
   Architecture edge continue to carry exact ports. State the rule's
   implications for semantic-port, dock, and slot cardinality, including any
   exclusive relationship.
4. Treat the rule as the authoritative compatibility declaration. Services and
   ports do not list reciprocal rule IDs, so a generic capability such as Lambda
   data read does not hard-code every future target service. The catalog and
   extension compilers validate exact endpoints, direction, total dock
   assignment, and compatible cardinality.
5. Define a strict connection configuration schema and UI hints. List each
   question and mark whether it uses a reviewed catalog default or requires
   explicit user input. Permission intent must not receive a broader default.
6. Declare generated permission effects and every generated supporting
   node/edge, including canonical owned-configuration nodes where applicable.
   State missing-information findings, provenance dependency IDs, cleanup order,
   sharing, deletion, adoption-before-customization, and what remains
   user-owned. Use empty arrays when the rule creates no supporting element or
   IAM effect; do not omit the decision.
7. Mark target support and implementation separately. Use `not-implemented` with
   a precise reason or assign a stable reviewed `implementationId`. Artifact
   data never contains a callback or module path, and target readiness cannot
   claim Terraform or CloudFormation rendering without compiler evidence.
8. For an implemented rule, add a provider-owned registration with
   `defineProviderConnectionRuleRegistrationV1`. Its ID, interface version, and
   semantic version must exactly match the descriptor.
9. Return only a proposed supporting-change plan. The SDK adds the direct edge,
   validates the complete Graph Command v1 batch, and applies it to an immutable
   preview. Never mutate the request document, generate random identities, read
   the clock, retrieve provider data, or access credentials.
10. Add positive and negative cases for exact ports and visual-group resolution,
    direction, aggregate occupancy, rule/slot cardinality, one-of-many grouped
    edge removal, missing or ambiguous decisions, configuration uniqueness,
    prerequisites, least-privilege effects, canonical policy materialization,
    deterministic command identities, generated provenance, safe cleanup,
    preservation of user-owned configuration, sharing, adoption, and target
    readiness.

The connection API is preview-first. `resolve` returns a complete atomic command
batch and preview; it does not mutate the graph. `cleanup` releases only the
selected connection's provenance dependencies. Shared generated elements remain
while referenced, adopted/customized elements block automatic cleanup, and a
user-authored owned configuration is never inside a generated cleanup closure.
`adopt` returns a separate explicit Graph Command preview.

Whole-document IAM review uses the deterministic canonical policy projection. It
classifies exact graph-backed owner slots, policy documents, statements,
conditions, and resource-scope relationships, then validates ownership,
policy-kind principal rules, actions, scope, conditions, lifecycle, duplicates,
wildcards, and target readiness. It never treats a preview effect or UI summary
as a second policy truth and never replaces exact scope with a wildcard.

## Add a validator

1. Add a serialized descriptor under `validation-rules/` with stable rule,
   interface, semantic implementation, service, and documentation identities.
2. Implement the rule as reviewed TypeScript using `defineValidationRuleV1` from
   `@cloudmarkup/domain`.
3. Pair descriptor and implementation through
   `ProviderValidationRuleRegistrationV1` in provider-owned source.
4. Emit stable, value-safe findings with exact typed affected paths and explicit
   target/environment applicability. Preserve `unknown` rather than guessing
   provider or environment facts.
5. Offer an auto-fix only as a complete deterministic Graph Command v1 batch
   that preserves user meaning and ownership. Permission, authentication,
   retention, cost, and generated-resource choices are not safe defaults.
6. Test stable rule IDs, deterministic finding IDs/order, severities, paths,
   applicability, negative cases, and exact fix presence or absence.

The artifact stores the descriptor only. Never serialize a callback, source
text, module path, dynamic import, or arbitrary rule code.

The IAM safety implementation recognizes the exact catalog-declared S3, SQS, SNS
and EventBridge resource-policy owner slots and typed resource scopes. An owner
must match its service, ports, edge schema/version and policy parent; unknown or
malformed bindings do not establish ownership. Typed scope recognition also
requires the exact catalog descriptor and does not depend on a legacy
`resourceNode` value. This corrects existing descriptor implementation without
changing catalog bytes, policy authority or auto-fix behavior. See the repair
plan for compatibility, negative-case evidence and release state.

## Add a compiler mapping

Mapping declarations are closed version-1 metadata:

- Terraform resource mappings name the provider source and resource type.
- CloudFormation resource mappings name the CloudFormation type.
- Configuration and port bindings reference keys and ports declared by the
  service.
- Bindings identify semantic compiler targets. Future compiler implementations
  own any reviewed shape conversion, such as a boolean posture becoming a
  provider enum or a scalar becoming a one-item list.
- `metadata-only` records design intent without claiming compiler behavior.
- `implemented` is allowed only after the matching reviewed compiler mapping,
  golden fixtures, invalid cases, compatibility evidence, and reproducibility
  checks exist.

Mappings contain no HCL, CloudFormation template body, callback, command, or
deployment instruction. Terraform is the first and broader production target.
CloudFormation is implemented only where an exact catalog version, renderer,
golden/negative/reproducibility evidence, and target-specific validation agree.
Metadata-only declarations never imply output support. Add CloudFormation
metadata only when an exact AWS resource type exists and the declared fields can
be represented by that resource. Omit an uncertain placeholder instead of
guessing.

For the networking slice, reviewed metadata names `aws_vpc`, `aws_subnet`,
`aws_route_table`, `aws_route`, `aws_route_table_association`,
`aws_internet_gateway`, `aws_nat_gateway`, `aws_vpc_endpoint`,
`aws_security_group`, and the standalone
`aws_vpc_security_group_ingress_rule`/`egress_rule` resources, plus their exact
CloudFormation VPC, subnet, route table, route, subnet-association, internet-
gateway, NAT-gateway, VPC-endpoint, security-group, ingress, and egress types.

Exact `0.10.0` marks the Terraform declarations implemented. The reviewed
renderer derives subnet `vpc_id` from exact AZ/VPC ancestry; projects route,
subnet-association, internet-gateway, NAT, endpoint/route-table, and
security-group-rule relationships into deterministic references; and renders
Lambda VPC access as a nested `vpc_config` block on the owning function rather
than fabricating a resource. The optional gateway-endpoint resource policy must
stay canonical and user-owned. Public zonal NAT consumes a caller-supplied
allocation ID and never generates `aws_eip`; Lambda VPC access requires an
explicit user-owned `AWSLambdaVPCAccessExecutionRole` attachment.

Region and Availability Zone have no standalone mapping. CloudFormation was
metadata-only for networking in `0.10.0`; the exact `0.15.0` renderer and
admitted successors implement the reviewed native projections, including Lambda
`VpcConfig`. New or expanded mappings still require their own evidence. Mapping
data contains no HCL, template body, callback, credentials, plan/apply command
or deployment authority.

## Add a catalog migration

Released catalog versions are immutable. A changed catalog receives a new
semantic version and regenerated digest. If saved documents need an upgrade, add
a migration descriptor under `migrations/` and pair it with a reviewed
`ProviderCatalogMigrationV1` implementation.

Migrations must be deterministic, preserve the original revision, operate on
clones, validate their output through the catalog compiler, and never delete,
guess, default, or reinterpret user meaning. Unknown versions or missing paths
fail closed. AWS catalogs `0.1.0` through `0.4.0` were created before a release
or persisted consumer existed.

Catalog `0.6.0` adds the first exact provider-owned document migration from the
pinned `0.5.0` digest. It accepts only the reviewed legacy direct-role DynamoDB
statement shape, preserves existing statement/role-edge/table-edge IDs, semantic
scope, lifecycle, and provenance, creates deterministic policy-document and
membership IDs, and retargets the preserved role edge. The caller supplies the
exact target `0.6.0` digest; the migration never invents it. Reapplying to that
exact target is a no-op. A mismatched pin, ambiguous owner, malformed scope,
identity collision, mixed legacy/current state, or unsupported incident
relationship returns a path-specific diagnostic and no document.

The historical `0.6.0` to `0.7.0` and `0.7.0` to `0.8.0` migrations remain
exact-digest repins. Historical catalog `0.9.0` adds a pure `0.8.0` to `0.9.0`
migration. It accepts only the exact reviewed `0.8.0` provider, catalog,
version, and digest, then returns the additive `0.9.0` source without changing
the supplied Architecture Document. It does not add a Region, VPC, subnet,
route, policy, or Lambda configuration on the user's behalf. Reapplying an
already exact target is handled by the migration boundary as a no-op; mismatched
historical pins fail closed.

Catalog `0.10.0` adds the same fail-closed `0.9.0` to `0.10.0` repin. It accepts
only the exact reviewed `0.9.0` artifact and returns additive validation,
Terraform-projection, and reachability-binding truth without rewriting the
Architecture Document or inventing topology, routes, policies, permissions, or
application changes. Exact-target replay remains a no-op at the migration
boundary; wrong providers, versions, or digests fail closed.

Historical source arrays remain explicit so generation and migration tests can
reproduce exact `0.8.0` and `0.9.0` bytes even though current source exports
assemble `0.10.0`. Never reconstruct a released source from the mutable current-
service array or silently teach an exact-version compiler to accept a repin.

## Focused Codex workflows

Repository-local skills under `.agents/skills/` encode the repeatable parts of
this workflow without broadening milestone scope:

- `$add-aws-service` adds one bounded service definition;
- `$add-connection-rule` adds one relationship and optional reviewed resolver;
- `$add-validation-rule` adds one descriptor and pure provider registration; and
- `$review-iac-mapping` reviews one Terraform or CloudFormation mapping claim.

Each skill names its required inputs/files, steps, outputs, tests, and stop
conditions. Use only the skill matching the requested job. A coordinated
networking change normally invokes the first three skills independently for each
bounded concept, relationship, and validator, then uses `$review-iac-mapping` to
keep every target claim aligned with official evidence and current compiler
support. Stable boundary/association meaning, owner slots, dock assignment,
target readiness, education, explicit exclusions, synthetic tests, and
compatibility review remain required. No skill authorizes UI work, compiler
implementation, cloud access, credentials, plan/apply, or deployment.

## Generate and verify

The AWS generator writes nine checked outputs:

- semantic catalog JSON, SHA-256, and TypeScript accessor;
- connection-presentation JSON, SHA-256, and TypeScript accessor; and
- service-extension JSON, SHA-256, and TypeScript accessor.

All three are regenerated from reviewed static source and compared byte for
byte. The SDK root exports Node-free contracts/accessors; hashing and artifact
compiler entry points are imported from `@cloudmarkup/provider-sdk/compiler`.

From the repository root:

```powershell
pnpm --filter @cloudmarkup/provider-sdk type-check
pnpm --filter @cloudmarkup/provider-sdk build
pnpm --filter @cloudmarkup/provider-aws generate:artifacts
pnpm --filter @cloudmarkup/provider-aws check:artifacts
pnpm check:contracts
pnpm check:assets
pnpm test
pnpm check
pnpm security:check
pnpm format:check
git diff --check
```

Review source and generated changes together. A catalog update is incomplete if
the canonical JSON, SHA-256 file, TypeScript accessor, tests, documentation,
compatibility/migration policy, status, or handoff is stale.
