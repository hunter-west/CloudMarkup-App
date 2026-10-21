# Deterministic Terraform generation

## Authority and scope

Prompt 29 adds the first render-capable target to the standalone Go compiler.
The Architecture Document remains infrastructure truth; Workload Behavior adds
supported behavior and application-artifact intent; an optional Solution
Revision binds exact immutable provenance. Terraform output is generated truth,
not planned or deployed truth, and it is not Evidence.

The target supports ten immutable AWS catalog bindings. Exact `0.8.0` preserves
the legacy notes family: API Gateway HTTP API/routes/stage/integration/JWT
authorizer, Lambda and invocation permission, Lambda role/trust/owned policies,
DynamoDB, Cognito user pool/client, CloudWatch log group, and Lambda error
alarm. Exact additive `0.10.0` preserves that family and adds the curated
networking projection below. Exact additive `0.12.0` adds the curated event
infrastructure projection while retaining pending application generation. Exact
additive `0.13.0` retains identical event infrastructure bytes and adds the
reviewed event generator/dispatcher compatibility plus final artifact metadata
contract. Exact `0.14.0` retains identical Terraform bytes and adds
initial-family CloudFormation readiness. Exact `0.15.0` again retains the
existing Terraform projection and adds curated networking/eventing
CloudFormation readiness behind the separate target. Exact `0.16.0` adds bounded
nested policy placement; `0.17.0` adds the curated FSx family and relationships.
Exact `0.18.0` validates Lustre PERSISTENT_2 SSD capacity increments and the
ONTAP single-HA-pair capacity limit, and emits ONTAP preferred_subnet_id from
the existing unique subnet relationship. Older catalog output remains unchanged.
Exact `0.19.0` retains those FSx checks and rendering, and rejects unsupported
shared-namespace S3 bucket names and overlapping direct Lambda notification
filters. Filter comparison decodes one transport layer; invalid encoding blocks
export without rewriting graph values. S3 EventBridge delivery uses the provider
boolean attribute `eventbridge = true`; historical catalogs retain their
original output. Other valid infrastructure bytes remain the same apart from
catalog provenance. Exact `0.9.0` and `0.11.0` remain immutable historical
metadata-only releases and are deliberately absent from compiler compatibility.
Any other catalog identity, version, digest, resource, relationship, workload
behavior, configuration, or extension fails with stable source-referenced
diagnostics and no partial artifact.

## Prompt 45 and 45A event-driven target

Catalog `0.12.0` promotes only compiler-evidenced event Terraform mappings to
`implemented`. The deterministic event tree covers S3 bucket notifications; SQS
queue redrive/DLQ and Lambda event-source mappings; SNS subscriptions;
EventBridge bus, rule, schedule, target, bounded retry, and DLQ configuration;
Standard Step Functions and its generated log group; Lambda invocation
permissions; and the required IAM/resource-policy projections. Exact `0.15.0`
implements the equivalent architecture intent in the CloudFormation renderer.

Every integration is selected by an exact typed relationship and owned
configuration. HCL references establish ordering, so the compiler emits no
arbitrary `depends_on`. Generated identity policies, resource policies, service
grants, and generated support resources retain source-edge provenance and exact
resource scope. User-authored policies remain separate and cannot be rewritten
or removed as generated lifecycle closure.

The compiler rejects unsupported event/DLQ cycles, recursive S3 notification,
wrong SQS direction, missing permission coverage, incompatible FIFO topology,
unsupported filters, unbounded retry intent, and unsupported target modes with
stable node/edge/configuration source references. The same normalized graph and
exact revision-bound inputs reproduce identical bytes; checked-in golden
manifests bind both eventing and security digests.

Terraform binds Lambda packages through the stable application-artifact
contract. Exact `0.12.0` retains `APPLICATION_CODE_REQUIRED` and its immutable
Prompt 45A warning. Exact `0.13.0`, `0.14.0`, and `0.15.0` accept only the
reviewed event generator/template/pattern/dispatcher tuple and bind each final
`application/artifacts/<workload>/function.zip` plus its target-neutral artifact
manifest and checksum. A missing or mismatched final artifact remains
source-linked and blocks complete readiness. The compiler never creates handler
source, calls the application generator or builder, scans a repository,
downloads a provider, reads credentials, invokes Terraform, plans, applies, or
deploys.

The complete curated patterns are asynchronous S3 image/metadata processing, SQS
Lambda consumer with DLQ, SNS fan-out consumers, EventBridge schedule,
EventBridge Lambda target, and Step Functions Lambda tasks. Application
readiness is complete only for exact `0.13.0`/`0.14.0`/`0.15.0` generation with
complete contract coverage and passing Prompt 32A artifact evidence; otherwise
it remains starter, custom-required, or application-code-required.

## Prompt 43 networking target

Catalog `0.10.0` promotes the reviewed Terraform networking declarations to
`implemented` only where matching deterministic compiler evidence exists. They
remain historical Terraform support. Exact current catalog `0.15.0` promotes the
matching reviewed CloudFormation mappings without changing this Terraform
projection.

| Catalog concept                     | Terraform projection                                                   | CloudFormation declaration                          |
| ----------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------- |
| Region / Availability Zone boundary | ambient placement; no standalone resource                              | ambient placement; no standalone resource           |
| VPC                                 | implemented `aws_vpc`                                                  | implemented `AWS::EC2::VPC`                         |
| Subnet                              | implemented `aws_subnet`; VPC derived through exact AZ ancestry        | implemented `AWS::EC2::Subnet`                      |
| Route table                         | implemented `aws_route_table`                                          | implemented `AWS::EC2::RouteTable`                  |
| Route                               | implemented `aws_route` with one exact internet- or NAT-gateway target | implemented `AWS::EC2::Route`                       |
| Subnet association                  | implemented `aws_route_table_association`                              | implemented `AWS::EC2::SubnetRouteTableAssociation` |
| Internet gateway                    | implemented `aws_internet_gateway` with exact VPC attachment           | implemented `AWS::EC2::InternetGateway`             |
| Zonal public NAT gateway            | implemented `aws_nat_gateway`                                          | implemented `AWS::EC2::NatGateway`                  |
| S3/DynamoDB gateway endpoint        | implemented `aws_vpc_endpoint`                                         | implemented `AWS::EC2::VPCEndpoint`                 |
| Security group                      | implemented `aws_security_group`                                       | implemented `AWS::EC2::SecurityGroup`               |
| Ingress rule                        | implemented `aws_vpc_security_group_ingress_rule`                      | implemented `AWS::EC2::SecurityGroupIngress`        |
| Egress rule                         | implemented `aws_vpc_security_group_egress_rule`                       | implemented `AWS::EC2::SecurityGroupEgress`         |
| Lambda VPC access                   | implemented nested `vpc_config` on the owning `aws_lambda_function`    | implemented nested `VpcConfig`                      |

Region and Availability Zone remain ambient placement context with
`not-applicable` renderer readiness. For exact `0.10.0`, the compiler validates
semantic parents, ports, stable endpoint references, relationship cardinality,
configuration versions, and resource types before rendering. It derives each
subnet's VPC reference through its one exact Availability Zone and VPC ancestry,
uses stable resource-address namespaces, and adds `networking.tf` only to the
`0.10.0` deterministic tree.

The implemented slice supports IPv4 VPC/subnet CIDRs, explicit non-main route
tables and subnet associations, exact internet-gateway and public zonal-NAT
routes, S3/DynamoDB gateway endpoints with selected route tables, standalone
IPv4 CIDR security-group rules, and Lambda subnet/security-group association. A
NAT gateway consumes a reviewed caller-supplied allocation ID and never creates
`aws_eip`. Its public parent subnet must have one exact route-table association
whose default IPv4 route targets an internet gateway attached to the same VPC.
An optional endpoint policy must be a canonical, user-owned resource policy with
service-aligned actions, resources, and explicit principals; it is never
collapsed into generated permissions. Lambda VPC access renders sorted exact
references only when its execution role has an explicit user-owned
`AWSLambdaVPCAccessExecutionRole` attachment. The compiler never invents that
permission.

The notes application source generator remains bound to exact `0.8.0`, and its
generated application bytes do not embed subnet, route, endpoint, NAT, or
security-group details. A separate exact-`0.10.0` reachability projection emits
a deterministic, source-referenced assumptions artifact from the normalized
graph. Its downstream data-only smoke/Evidence configuration changes when a
private endpoint or reviewed public-egress path changes, but it does not run a
probe, enable build network access, create Evidence, or alter application
source.

Unsupported modes remain explicit: IPv6/dual-stack, NAT64, secondary CIDRs and
IPAM, private or regional NAT, interface/Gateway Load Balancer endpoints,
advanced route targets, implicit main/default resources, inline/default rules,
cross-VPC security groups, and automatic Lambda ENI permission generation. The
compiler has no plan/apply/state/provider execution, network, credential, AWS
API, or deployment authority.

## Deterministic tree and metadata

The target emits these paths in fixed UTF-16-compatible order:

```text
infrastructure/
  versions.tf
  providers.tf
  variables.tf
  locals.tf
  networking.tf  # exact catalog 0.10.0 only
  identity.tf
  compute.tf
  data.tf
  security.tf
  observability.tf
  outputs.tf
  terraform.tfvars.example
  README.md
```

All HCL is constructed through HashiCorp HCL APIs and parsed before return. The
manifest pins target format `1.0.0`, Terraform `>= 1.5.0, < 2.0.0`, and
`hashicorp/aws >= 6.55.0, < 7.0.0`. Stable addresses use persisted deployment
keys or stable node IDs; collisions receive deterministic node-ID digest
suffixes. File contents, per-file digests, the manifest digest, exact compiler,
catalog, Architecture, Workload, and Solution Revision provenance are returned
through the library/CLI contract. Bytes, file count, inputs, diagnostics, graph
size, and execution are bounded.

## IAM and source ownership

The target never scans source. Supported direct relationships require matching
canonical generated policy documents and statements whose immutable provenance
names the exact source edge. The reciprocal check also rejects every generated
statement or provenance edge that does not match one exact supported
relationship. Generated DynamoDB read/write and log permissions use fixed action
sets and typed target ARNs. API Gateway invocation permission is limited to the
exact Lambda and `$default` route stage/method/path pattern. Lambda trust is
limited to `sts:AssumeRole` by `lambda.amazonaws.com`.

User-authored inline policies remain separate from generated permissions.
Removing one relationship removes only its generated provenance closure; another
edge's permission and every user-owned policy remain. Managed-policy attachments
and permissions boundaries accept only the catalog's reviewed reference forms.
The artifact manifest records policy document, owner, kind, ownership, rendered
address, and generated provenance.

## Application artifacts

Terraform consumes packages; it never builds source.

| Workload mode                         | Terraform artifact contract                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------- |
| `complete-supported-pattern`          | Final Prompt 32A ZIP, checksum, and target-neutral artifact manifest for the exact workload |
| `generated-starter`                   | Stable expected path plus explicit incomplete/custom-required readiness                     |
| `user-provided`, `ai-assisted-custom` | Required validated relative package path and exact base64 SHA-256                           |
| `infrastructure-only`                 | Same explicit inputs plus `APPLICATION_CODE_REQUIRED` and README warning                    |
| `external-artifact`                   | Required S3 bucket, key, immutable object version, and exact base64 SHA-256                 |

Every package path, base64 SHA-256, and external object input carries explicit
validation semantics in the versioned artifact manifest and an HCL `validation`
block. Repository packages must begin with `./` or `../`; absolute machine paths
fail before planning. Sensitive Architecture outputs remain marked sensitive.

The notes and curated-event application-generator interfaces remain separate
from the compiler. Mode switches never make AI output authoritative and never
permit source generation inside Terraform.

## External resources and extensions

An external-resource record may affect Terraform only when its architecture
node, exact mapping `1.0.0`, lifecycle authority, behavior, ownership, and
readiness agree:

- `managed-by-generated-iac` may render a managed resource;
- `existing-cloud-managed-elsewhere` is never created and uses explicit
  non-created variable bindings; and
- `imported-current-iac-lifecycle` renders the resource plus one import block
  bound to its exact declared provider-resource address.

Other ownership states and unresolved or contradictory target metadata fail
closed. Target extensions carry a version, digest, source ownership, evidence,
and approval fields. Prompt 29 still rejects every nonempty collection: Prompt
36A validates a candidate and acceptance can add the accepted Prompt 24D record
to a distinct immutable successor Solution Revision/export input, but it does
not assemble extension bytes into deterministic compiler output or materialize a
repository. That later composition requires separate authorization over the
exact accepted artifact and successor revision.

## Closed execution boundary

Compiler production code has no network client, AWS SDK, model client,
credential reader, repository scanner, subprocess runner, or Terraform executor.
It emits no credential, raw secret, absolute local path, arbitrary
provider/module, provisioner, `local-exec`, or `remote-exec`. Planning and
deployment remain customer-owned per ADR-0005; those later layers must bind the
exact Solution Revision and generated artifact digest.

## Verification

From the repository root:

```powershell
pnpm check:compiler
pnpm catalog:check
pnpm schema:check
pnpm check
pnpm security:check
go -C services/iac-compiler run golang.org/x/vuln/cmd/govulncheck@latest ./...
```

Focused Go tests cover the full public compile path, the golden minimal Lambda
digest, authenticated API/Cognito/Lambda/DynamoDB/log/alarm output, every
workload mode, artifact-input validation, IAM ownership/provenance in both
directions, permissions cleanup, sensitive outputs, external reference/import
behavior, extension rejection, secret redaction, collision handling, unsupported
behavior, limits, and visual-only stability. Exact `0.10.0` cases additionally
cover the two-AZ public/private layout, endpoint-only serverless layout, HCL
parsing, deterministic references and addresses, custom/generated policy
separation, variables/outputs, canonical reordering, unsupported networking
diagnostics, exact `0.8.0` compatibility, and exact `0.9.0` rejection.

## Prompt 36A Terraform extension candidates

A Terraform extension candidate is a separate restricted artifact for one exact
approved target extension slot; it is not compiler output. The request binds the
immutable Solution Revision, deterministic baseline tree and digest, protected
baseline paths and resource addresses, candidate-owned paths and exact
resource/data addresses, allowed provider IDs, sources, version constraints and
provider/resource tuples, extension ID, catalog/official-schema pins, validation
policy, and model/prompt provenance.

The coordinator and Terraform runner parse every candidate `.tf` file as HCL,
recompute baseline and candidate digests, and reject path/address collisions,
modules, backend blocks, provisioners, external data commands, shell execution,
state/import/test-run constructs, unknown providers/resources, unapproved files,
and candidate attempts to shadow deterministic ownership. The fixed offline
sequence remains `fmt`, `init -backend=false`, `validate`, and the configured
TFLint/security/policy checks. It never runs `plan`, `apply`, or uses
credentials or network access.

A successful extension check produces only level-4
`ai-extension-parse-static-validity` Evidence bound to the exact final candidate
artifact, baseline compiler artifact, extension slot, canonical model
descriptor, official schemas, policy, and Solution Revision. It cannot fabricate
level-3 deterministic compilation Evidence, change the compiler manifest, or
prove customer-cloud behavior. Blocking findings become Active Issues. Explicit
acceptance may bind the exact accepted Prompt 24D extension and artifact into a
distinct immutable successor Solution Revision/export input, but it does not
materialize or assemble Terraform files, run a plan or apply, or grant
deployment authority.
