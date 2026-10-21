# AWS platform deployment architecture

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

## Status and authority

Prompt 27 established the initial resource-bearing AWS CDK topology through
local, deterministic synthesis and review. Current environment activation and
exact release evidence belong in [STATUS](../PUBLIC_STATUS.md). This
architecture document does not authorize live provider, customer-cloud or
deployment operations.

The durable topology is accepted in
[ADR-0027](../adr/0027-aws-platform-capability-lifecycle-topology.md). The
provider-neutral product architecture remains authoritative in
[System Overview](SYSTEM_OVERVIEW.md), and local product development remains the
AWS-independent workflow documented in
[Local development](../development/LOCAL_DEVELOPMENT.md).

The versioned non-secret aggregate operator contract and staged setup sequence
are authoritative in Deployment inputs and operator setup. Passing that
validator is a prerequisite for future environment review; it is not deployment
authority and does not replace this topology.

## Environment configuration

`infra/platform/lib/config/environment-config.ts` owns one strict configuration
schema. It validates and freezes non-secret environment targets, lifecycle,
capacity, retention, budget, rate/concurrency, feature, integration-reference,
optional domain, and tag inputs before synthesis. Unsupported or unsafe values
fail closed.

| Environment | Target status                                                                                                                                                                                                                                                   | Lifecycle baseline                                                                                                        |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `dev`       | Reviewed account `000000000000`, Region `us-east-1`; these are non-secret synthesis coordinates                                                                                                                                                                 | `DESTROY` marker without automatic bucket emptying; one-day database backup, 15-minute auto-pause, 30-day logs            |
| `beta`      | Explicit candidate for account `000000000000`, Region `us-east-1`; exact domain, application-account certificate, `createDnsRecords=false`, and image digests are mandatory; cross-account DNS coordinates remain setup/operator inputs outside application CDK | Deletion protection, retained state, no auto-pause or scale-to-zero, 14-day database backup, 90-day operational retention |
| `staging`   | No committed target; callers must provide an explicit account and Region                                                                                                                                                                                        | Explicit target required; non-production `DESTROY` never implies automatic object/version cleanup                         |
| `prod`      | No committed target; callers must provide an explicit account and Region and cannot inherit `dev`                                                                                                                                                               | Deletion protection, retained resources, no auto-pause, 14-day database backup, 365-day fixture values                    |

The product root domain is `cloudmarkup.com`. Any future public or application
hostname must use that root or one of its subdomains through explicit
environment configuration. No DNS zone, certificate, application hostname, or
deployment is created or implied by this document.

The numeric development and production values are safe Prompt 27 configuration
fixtures, not approved SLO, disaster-recovery, legal-retention, or billing
policy. Production configuration validation prevents disabling deletion
protection or changing its removal policy from `retain`. Runtime validation
requires the exact declared feature-key set and Boolean values before feature
prerequisites or IAM are evaluated. API reserved concurrency is an integer from
1 through 1,000. Worker concurrency is an integer from 2 through 1,000 because
the SQS event source rejects a maximum concurrency below two; the development
and production fixtures use 5 and 25. Each WAF five-minute rate limit is an
integer from 10 through 2,000,000,000 and the webhook limit cannot exceed the
aggregate API limit. The Cost Anomaly USD threshold must be positive and cannot
exceed the positive monthly budget.

Normal configuration can contain logical secret names, non-secret identifiers,
and exact Bedrock resource ARNs. It rejects literal access keys, API keys,
signing secrets, passwords, private keys, tokens, and known credential formats.
Synthesis never retrieves a secret.

The default logical references are:

| Purpose                | Logical reference                                                                   | Current access                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Database administrator | `cloudmarkup-<environment>/database/admin`                                          | Generated and owned by Aurora; only the API role receives database-secret read access                        |
| Stripe API             | `cloudmarkup/<environment>/stripe/api-key`                                          | No runtime read grant; deployed Checkout/Portal provider composition remains absent                          |
| Stripe webhook         | `cloudmarkup/<environment>/stripe/webhook-signing-secret` plus optional `-previous` | The isolated ingress receives only exact current/previous reference read grants when test billing is enabled |
| GitHub App private key | `cloudmarkup/<environment>/github/app-private-key`                                  | No read grant while GitHub export is disabled; never available to the general API                            |
| Amazon Bedrock         | No secret; exact model or inference-profile ARNs are configuration                  | No invocation policy while AI authoring is disabled                                                          |

The references do not create or populate integration secrets. Operators must
eventually provision and rotate them through an approved secret channel before
enabling an owning feature.

## Stack ownership and dependency order

One `CloudMarkupStage` synthesizes four stacks. They use stable
`cloudmarkup-<environment>-*` names and one-way dependencies:

| Order | Stack         | Owns                                                                                                                                                                                                                                                                                                           | Depends on                                                         |
| ----: | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
|     1 | Observability | API, Lambda, worker, Step Functions, billing, database, validation, and build log groups; service/contract metrics, alarms, and dashboard; rotating customer-managed SNS key/topic; monthly budget and service-cost-anomaly guardrails                                                                         | Nothing                                                            |
|     2 | Stateful      | Private isolated VPC, Aurora PostgreSQL Serverless v2/Data API, generated database secret, access-log bucket, and one private versioned content bucket with purpose prefixes                                                                                                                                   | Observability, so the database log group exists before RDS exports |
|     3 | Application   | Cognito pool/client, Regional REST API, feature-gated stage-associated Regional WAF origin admission, modular API shell, isolated billing and worker shells, separate job and billing FIFO queue/DLQ pairs, minimal Step Functions-to-SQS dispatch, and inert, triggerless validation/build CodeBuild projects | Stateful and Observability                                         |
|     4 | Edge          | Private versioned web-assets bucket, CloudFront Origin Access Control, security headers, `/api/*` forwarding, imported certificate, generic optional DNS outside beta, and feature-gated owned or explicit external CloudFront-scope WAF attachment                                                            | Application and Stateful access-log storage                        |

Observability uses deterministic resource names for metrics instead of taking a
reverse Application dependency. Earlier stacks never consume a later stack, and
there is no resource-per-stack or resource-per-construct pattern.

Prompts 32 and 32A synthesize separate inert Terraform-validation and
application build/test/package CodeBuild projects. They have distinct roles,
artifact prefixes, log groups, and dedicated S3 and CloudWatch Logs interface
endpoints, with no trigger or caller grant. Their image digests remain synthesis
coordinates until reviewed images and offline stores are published and attested;
no sandbox is deployed or executable from this repository.

## Storage, encryption, and tenant prefixes

Every owned S3 bucket blocks public access, requires TLS, and uses S3-managed
encryption. The content and web-assets buckets enable versioning. The content
bucket uses explicit purpose roots:

- `documents/v1/organizations/` for Architecture, Workload, contract, and other
  durable document objects;
- `artifacts/v1/organizations/` for replaceable generated/export/application
  artifacts; and
- `evidence/v1/organizations/` for Evidence objects.

Only the artifact prefix has an expiration rule. Documents and Evidence do not
expire in Prompt 27. Knowledge of a bucket key or prefix is never tenant
authorization; the application must continue to resolve trusted ownership and
published metadata before object access.

Aurora PostgreSQL 16.8 runs in private isolated subnets with no NAT gateway,
public database endpoint, or Lambda VPC attachment. The API uses the Data API
with exact cluster and generated-secret permissions. S3 and database storage use
AWS-managed encryption. Observability alone owns a rotating customer-managed KMS
key for the alarm-notification topic because CloudWatch alarms, AWS Budgets, and
Cost Anomaly Detection require service-publisher key-policy grants. All three
publishers require the exact source account. CloudWatch is limited to
`arn:${partition}:cloudwatch:${region}:${account}:alarm:*`; AWS Budgets is
limited to `arn:${partition}:budgets::${account}:*`; and Cost Anomaly Detection
is limited to `arn:${partition}:ce::${account}:anomalysubscription/*`. No human
notification recipient is configured. The first separately authorized AWS test
deployment must validate the actual Cost Anomaly publisher encryption context
before this condition is accepted as operational evidence.

Production removal retains buckets, database state, log groups, and the database
secret; database deletion protection is mandatory. Development marks resources
`DESTROY`, but that policy does not empty nonempty or versioned buckets. Before
any future development destroy, an operator must explicitly empty only the exact
development buckets, including every object version and delete marker. The CDK
application supplies no automatic bucket cleanup or destructive deployment
command. Retained production data and forward-only migrations require explicit
future rollback and restore procedures.

## API, edge, and authentication boundaries

CloudFront serves the private web-assets bucket through Origin Access Control.
The `/api/*` behavior disables caching, forwards viewer inputs except the Host
header to the Regional REST API, uses a reviewed CloudFront Function to remove
the browser-only `/api` prefix, and prepends the exact environment stage as the
origin path. The default web behavior rewrites extensionless SPA routes to
`index.html`; it never rewrites `/api/*`. Security headers and TLS 1.2 or later
are applied at the distribution.

The CSP keeps inline scripts blocked. It permits
`style-src-attr 'unsafe-inline'` only as a reviewed compatibility seam for the
current React style attributes; it does not grant an inline-script exception.
CloudFront standard/legacy access logging is intentionally disabled because its
query-string field would persist OAuth callback `code` and `state` values in S3.
S3 origin access logs and redacted API access logs remain enabled without making
OAuth callback query values telemetry.

The Regional REST API exposes only explicit resources and methods:

- `ANY /v1` and `ANY /v1/{proxy+}` require the Cognito user-pool authorizer and
  exact `cloudmarkup-api/access` authorization scope;
- `GET /health`, `GET /ready`, and `GET /openapi/v1.json` are public system
  routes; and
- `POST /webhooks/stripe` and `POST /webhooks/github` are public at the Cognito
  layer because their separately bounded provider-verification paths own
  admission when enabled.

The Regional REST API execute endpoint remains enabled so CloudFront can reach
its explicit environment stage. Application and Edge consume the same retained,
randomly generated 64-character `EdgeOriginVerification` value from Stateful
through CloudFormation dynamic Secrets Manager references. The value has no
output, export, GitHub variable, or operator copy. CloudFront sends it as the
`x-cloudmarkup-edge-origin` custom origin header; API and billing Lambdas
receive it for a constant-time defense-in-depth check.

When WAF is enabled, Application owns a Regional Web ACL associated with the
REST API stage. Its single `RequireCloudFrontOriginMarker` rule blocks a request
whose header does not exactly equal the generated value. Denial occurs before an
API method invokes Lambda, closing the former post-invocation capacity bypass
for the synthesized beta topology. The Lambda check remains mandatory so loss or
drift of the association still fails closed at the application boundary.

The execute-api hostname is still public infrastructure and is not a supported
endpoint. A principal able to read the resolved CloudFront origin header or
Regional WAF match value could recover the marker; overly broad
configuration-read permissions, disclosure, association drift, or failed
rotation could bypass or break the intended path. Rotation requires a reviewed
stack update that refreshes every dynamic-reference consumer plus
CloudFront-success, direct missing/wrong-marker zero-invocation denial,
access-review, alarm, rollback, and rotation evidence. None of that live
evidence exists yet.

WAF remains feature-gated and disabled in development; beta requires it. The
Regional origin-admission ACL is independent of the CloudFront-scope ACL. A
reviewed external `us-east-1` global ACL requires both its exact ARN and
`VisibilityConfig.MetricName`; otherwise Edge owns a CloudFront-scope ACL with
separate IP rate controls for `/api/webhooks/` and aggregate `/api/` paths.
Sampled request bodies stay disabled. API Gateway throttles and Lambda reserved
concurrency remain additional controls. Exact thresholds, recipients, and a
non-production abuse drill require manual approval; synthesis is not enforcement
evidence. Outside controlled beta, the generic optional same-account DNS mode
requires an explicit hosted-zone target and a `us-east-1` ACM certificate.
Controlled beta instead rejects application-CDK hosted-zone inputs, imports the
application-account certificate, and keeps `createDnsRecords=false`; its
separate DNS account remains authoritative.

The Cognito client has no client secret. Cognito JWT validation does not make
Cognito groups or caller-supplied tenant IDs authoritative; the application must
still map the verified subject to a current application principal and authorize
stored organization membership and object ownership.

When no domain is configured, the client uses the explicit local seam
`http://localhost:5173/auth/callback` for callback and `http://localhost:5173`
for logout; it never inherits CDK's `example.com` default. This keeps synthesis
deterministic but is not an accepted production browser-session, token-storage,
renewal, logout, or revocation decision. When a domain is configured, both
values derive from its HTTPS origin, with `/auth/callback` appended only to the
callback URL.

## Synthesized shell versus composed service

The stacks are deployable CloudFormation resources, but their current runtime is
deliberately fail-closed and is not a usable Cloud Markup environment:

- the modular-monolith Lambda bundles `apps/api/src/lambda.ts`, whose default
  composition uses the unavailable application adapter and anonymous principal
  resolver; product routes have no production database, object-store, or
  identity composition;
- the isolated billing webhook returns `503` without reading the request while
  billing is disabled; when explicitly enabled in test mode, it loads only the
  current/optional previous signing secrets, verifies exact raw bytes, and
  enqueues a sanitized identity/digest/order envelope to its encrypted FIFO
  queue with a bounded DLQ; live mode is rejected;
- the Step Functions state machine only sends a bounded job/correlation envelope
  to the encrypted FIFO queue; it is not the durable Async Job lifecycle;
- the worker returns every valid SQS message as a batch failure, so it cannot
  acknowledge work before durable repository and handler composition; and
- ordinary development synthesis receives no web build path, while the explicit
  beta synth requires the production web build and packages it through an S3
  deployment plus CloudFront invalidation. This is deployable asset wiring, not
  evidence that a usable production browser composition exists.

The queue and state machine are delivery projections only. PostgreSQL Async Job
composition, audit-outbox publication, orphan reconciliation, billing queue
consumption and production reconciliation, model/handler invocation, compiler
execution, artifact publication, and Evidence creation remain absent.

The development fixture keeps every optional feature off. The explicit beta
candidate enables beta access, deterministic application generation, static
validation, and WAF, while billing, AI authoring, GitHub export, and customer
plan/deployment workflow export remain off. The runtime validator rejects
missing or unknown feature keys and non-Boolean values before those flags affect
permissions. Disabled Stripe/GitHub features receive no secret-read IAM, and
disabled AI receives no Bedrock IAM. Literal secret values and customer-cloud
permissions are not present in templates.

## Local synth and review

Use a repository PowerShell terminal from the repository root. No AWS profile,
access key, session token, Docker service, network call, account lookup, or
deployed stack is required.

```powershell
pnpm --filter @cloudmarkup/platform test
pnpm check:infra
pnpm cdk:synth
```

The package test covers environment validation, public-access blocking,
encryption, lifecycle, authorization routes, secret isolation, scoped IAM,
queue/DLQ delivery, log retention, production deletion protection, same-origin
routing, deterministic templates, a generated non-output origin marker, exact
header/environment bindings, strict response/cache headers, owned and external
WAF modes, reserved concurrency, safe event vocabulary, grouped alarms/dashboard
widgets, Cost Anomaly resources, and publisher-policy assertions.
`pnpm check:infra` adds linting, strict type checking, build, and synthesis. The
root `pnpm cdk:synth` also reviews the assembly for exactly four nonempty
development stacks, unexpected IAM wildcards, secret literals, customer-compiler
paths, and deployment commands.

The approved `cdk-nag` equivalent is the custom `PlatformSecurityAspect`, CDK
assertion suite, and assembly verifier; no `cdk-nag` dependency or broad
suppression exists. In ordinary identity/resource policies, literal Resource
`"*"` is allowlisted only for X-Ray `GetSamplingRules`,
`GetSamplingStatisticSummaries`, `GetSamplingTargets`, `PutTelemetryRecords`,
and `PutTraceSegments`, and for Step Functions CloudWatch Logs
`CreateLogDelivery`, `DeleteLogDelivery`, `DescribeLogGroups`,
`DescribeResourcePolicies`, `GetLogDelivery`, `ListLogDeliveries`,
`PutResourcePolicy`, and `UpdateLogDelivery`, because those APIs do not support
resource-level scoping.

Only inside an `AWS::KMS::Key` `KeyPolicy`, literal Resource `"*"` is
additionally allowed for these exact principal-bound actions:

- the account-root key administrator receives `kms:CancelKeyDeletion`,
  `kms:CreateAlias`, `kms:CreateGrant`, `kms:DeleteAlias`, `kms:DescribeKey`,
  `kms:DisableKey`, `kms:DisableKeyRotation`, `kms:EnableKey`,
  `kms:EnableKeyRotation`, `kms:GetKeyPolicy`, `kms:GetKeyRotationStatus`,
  `kms:ListAliases`, `kms:ListGrants`, `kms:ListKeyPolicies`,
  `kms:ListResourceTags`, `kms:PutKeyPolicy`, `kms:RetireGrant`,
  `kms:RevokeGrant`, `kms:ScheduleKeyDeletion`, `kms:TagResource`,
  `kms:UntagResource`, `kms:UpdateAlias`, and `kms:UpdateKeyDescription`; and
- `cloudwatch.amazonaws.com`, `budgets.amazonaws.com`, and
  `costalerts.amazonaws.com` receive only `kms:Decrypt`, `kms:GenerateDataKey`,
  and `kms:GenerateDataKeyWithoutPlaintext`.

All three service-publisher key statements require the exact source account.
CloudWatch requires SourceArn
`arn:${partition}:cloudwatch:${region}:${account}:alarm:*`; AWS Budgets requires
`arn:${partition}:budgets::${account}:*`; and Cost Anomaly Detection requires
`arn:${partition}:ce::${account}:anomalysubscription/*`. The last pattern covers
every Cost Anomaly subscription in the account, not uniquely the subscription
synthesized here. The SNS topic policy mirrors those exact principals and
SourceAccount/SourceArn conditions for `sns:Publish`. AWS documents
`costalerts.amazonaws.com` and these condition keys, but the enumerated
symmetric-key data-key operations and actual publisher context remain
operationally unverified. The first separately authorized AWS test deployment
must prove encrypted delivery; failure must remain fail closed rather than
silently broadening the policy.

The exact generated `DefaultStackSynthesizer` bootstrap-version assertion and
SSM parameter descriptions are normalized only for deployment-command text
scanning. Wildcard Actions, Resource `"*"` outside the exact cases above, secret
literals, and deployment commands still fail verification.

Review source changes and the local CloudFormation templates without contacting
AWS:

```powershell
git diff -- infra/platform docs/architecture/AWS_PLATFORM_DEPLOYMENT.md docs/architecture/SYSTEM_OVERVIEW.md
Get-ChildItem infra/platform/cdk.out -Recurse -Filter *.template.json |
  Select-String -Pattern 'AWS::IAM::Policy','AWS::S3::Bucket','AWS::RDS::DBCluster'
```

`cdk.out` is generated review output and must not be committed. Do not use a
cloud-aware CDK diff against a deployed stack in this task; no deployed baseline
or operator role exists.

## Controlled platform-operator delivery path

Controlled beta has a one-time SSO bootstrap and one ongoing delivery path.
Retained CloudFormation stacks own the application-account ACM certificate, the
exact GitHub-to-DNS role grant, the DNS-account delivery/execution roles, the
ACM validation CNAME, and the eventual A/AAAA aliases. The cross-account
delivery role has exact-stack CloudFormation and `iam:PassRole` permissions
only; direct Route 53 mutation belongs solely to its sticky CloudFormation
execution role and is bounded to hosted zone `ZSYNTHETIC123456` and the beta
records.

The main-push workflow implements this sequence:

1. run credentialless repository, product, infrastructure, end-to-end, and
   security gates;
2. build the web/API and synthesize CDK-generated CloudFormation from the
   triggering commit;
3. bind the same-run deployment bundle to the commit and artifact digest;
4. obtain short-lived application-account credentials through protected
   `Development` GitHub OIDC;
5. deploy the CDK assembly with rollback enabled;
6. role-chain into the exact DNS delivery role and update only the retained DNS
   records stack, preserving validation inputs and binding aliases to the
   deployed CloudFront output; and
7. wait for stabilization and smoke the public root, health, readiness, and
   unauthenticated no-store runtime configuration.

Hosted application generation and static Terraform validation remain disabled
for first beta, so their CodeBuild projects, ECR images, private endpoints, and
image-digest inputs are not deployment prerequisites. The workflow accepts no
manual activation, runtime digest, assembly digest, or static AWS credential.
Pull requests remain credentialless. The repository does not create the live
OIDC provider or GitHub Environment protection; those controls must restrict the
immutable repository identity, environment, audience, and account and remain
inaccessible to product runtime and pull-request code.

Prompt 40A's `cloudmarkup-plan.yml`, `cloudmarkup-deploy.yml`,
`cloudmarkup-smoke.yml`, and `cloudmarkup-drift.yml` are deterministic optional
customer repository artifacts on a different authority path. They contain
placeholders for customer-created, environment-scoped GitHub OIDC roles and
customer state; Cloud Markup creates neither the roles nor the state, receives
no credential, cannot execute the workflows, and cannot approve or deploy. The
customer's saved-plan manifest and deployment-receipt chain do not authorize
this platform CDK application. No live AWS call is part of Prompt 40A
verification. See [Customer-owned CI/CD](CUSTOMER_OWNED_CI_CD.md).

Rollback must be reviewed per stack in reverse dependency order: Edge,
Application, Stateful, then Observability. Production Stateful rollback cannot
delete or silently replace retained data. Paired database/object backups,
forward-only migration compatibility, restore drills, and recovery objectives
must be accepted before production operation.

## Operational visibility

The Observability stack creates bounded log retention, fixed-field metric
filters, aggregate alarms, and dashboard widgets for:

- API failures, authorization/origin denials, throttling, abuse blocks, and
  enabled-WAF blocked requests;
- billing-webhook failures, signature/processing failures, queue health, and
  stale projections;
- jobs and worker/state-machine failures;
- model usage/route failures/credit denials and ledger/reconciliation failures;
- compiler, generator, application-build, test, and Terraform-validation
  failures;
- diagram, ZIP, GitHub-export, and generated-workflow failures;
- plan, deployment, drift, and general Evidence-processing failures;
- support/admin operation and authorization-denial signals;
- artifact/Evidence retention and write failures; and
- aggregate commercial, Evidence, generation, and security-control failures.

AWS service metrics back Lambda, API Gateway, SQS, Step Functions, CodeBuild,
and enabled Regional and CloudFront WAF signals. The remaining custom metrics
are only synthesized contracts over reviewed fixed-field structured events. Many
production emitters, a trace pipeline, and every operational recipient remain
uncomposed, so the templates do not establish end-to-end monitoring. In
particular, the synthesized surface must never be described as proof that it
observes:

- billing webhook queue backlog/age and dead-letter depth;
- stale billing projections;
- application-level model, ledger, generator, export, Evidence, support, or
  retention behavior that has not emitted the exact reviewed event.

The dashboard displays those service and contract metrics. Alarms publish to one
SNS interface encrypted at rest by the rotating Observability-owned
customer-managed key and in transit by AWS endpoints. CloudWatch alarms, AWS
Budgets, and Cost Anomaly Detection target that topic, but Prompt 48 configures
no downstream human or operator SNS subscription. The monthly budget and
immediate service-dimension Cost Anomaly guardrails use the same interface.
Current thresholds are review fixtures, not accepted SLOs or incident policy,
and missing data is non-breaching.

Before production, operators must approve notification recipients, escalation,
alarm thresholds, reconciliation lag, backup/restore monitoring, clock/access
review, and incident runbooks. Logs must remain correlated and redacted; request
bodies, authorization headers, prompts, architecture bodies, artifacts, payment
data, and secret values are not telemetry.

The
[Controlled-beta Operations Runbooks](../development/CONTROLLED_BETA_OPERATIONS_RUNBOOKS.md)
map this synthesized alarm surface to bounded response procedures. They do not
prove that an alarm recipient, dashboard, trace pipeline, or operator rotation
has been deployed or exercised.

## Low-traffic cost drivers

No current-price estimate is asserted. Review these cost dimensions for every
environment:

- Aurora Serverless v2 capacity, storage, I/O, backups, and retained snapshots;
- S3 current/noncurrent versions, access logs, requests, and retained content;
- CloudFront requests, data transfer, and invalidations; standard/legacy access
  logging is disabled;
- Lambda invocations/duration, API Gateway requests, Step Functions transitions,
  and SQS requests/storage;
- CloudWatch log ingestion/retention, custom metrics, alarms, dashboard, X-Ray,
  SNS, the rotating customer-managed KMS key and its requests, AWS Budgets, and
  the Cost Explorer anomaly monitor/subscription;
- Cognito active users;
- the generated database secret and any later provisioned Secrets Manager
  integration secrets; and
- optional Route 53, ACM-related delivery, WAF, Bedrock, Stripe, and GitHub
  features if later enabled.

The development database may scale to zero after 15 idle minutes, and the VPC
has no NAT gateway. Production intentionally keeps a 0.5 ACU minimum and
disables auto-pause. Retention, traffic, log volume, feature enablement, and
optional edge controls can dominate the low-traffic baseline and require later
measured budgets rather than copied price claims.

## Platform and customer IaC remain separate

`infra/platform` synthesizes CloudFormation for future operator-controlled Cloud
Markup service deployment. `services/iac-compiler` is the standalone,
credential-free deterministic customer artifact compiler. They share no
deployment role, credentials, artifact path, executable flow, or output.

The platform cannot compile, plan, apply, or deploy customer infrastructure, and
customer artifacts cannot invoke this CDK application. Plan/deployment/drift
Evidence never grants a credential or changes designed Architecture, Workload,
External Resource, or Application Contract authority.

## Deferred production decisions

Prompt 48 documents the current threats, data-handling rules, runbooks, and
residual risks; documentation alone does not implement or operate a control. It
does not resolve multi-Region topology, disaster-recovery objectives, SLOs/final
alarm thresholds, downstream alarm recipients/escalation, business/legal
retention periods, Bedrock model/Region and evaluation policy, GitHub
permissions/recovery, live Stripe activation and unresolved
commercial/reconciliation policy, browser session/refresh-token behavior,
production reconciler cadence, restore drills, deployed Regional-WAF association
and direct-origin zero-invocation proof, origin configuration-access review and
rotation testing, global WAF activation/thresholds/abuse drills, the first
encrypted Cost Anomaly delivery test, or an end-to-end alert delivery drill.
These remain explicit open decisions in [Project Status](../PUBLIC_STATUS.md)
and the Controlled-beta Residual-risk Report.

## Prompt 35 Bedrock Runtime deployment boundary

Prompt 35 does not deploy. The application stack's existing optional
`aiAuthoring` grant remains the infrastructure authority: workers receive only
`bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream` on exact
reviewed model and inference-profile resources. No wildcard model resource,
Bedrock control-plane action, Marketplace action, Agent action, or credential
material is added.

For an inference-profile route, platform configuration must include the exact
approved inference-profile ARN and every exact backing foundation-model ARN that
the profile may route to in the approved Regions. The runtime reviewed route's
selected Region/residency record must agree with the deployed worker Region and
the configured resource set; mismatch disables the adapter. System IAM may also
bind the profile ARN condition where supported, but cannot broaden resources.

Development uses the AWS SDK default credential chain and may set
`AWS_PROFILE=cloudmarkup` for the existing SSO profile. Application
configuration never contains an access key, secret, customer credential, Bedrock
API key, or Secrets Manager reference for model access.
