# ADR-0027: AWS platform capability and lifecycle topology

- **Status:** Accepted
- **Date:** 2026-08-16
- **Owners:** CloudCanvas product and engineering
- **Supersedes:** None
- **Refines:** ADR-0005, ADR-0011, ADR-0012, ADR-0021, ADR-0022, ADR-0025, and
  ADR-0026
- **Superseded by:** ADR-0040, only for the Regional REST ingress, WAF origin
  admission, and Prompt 27 platform-delivery constraints described below

> **Historical partial-supersession note (2026-09-02):** ADR-0040 replaces this
> record's HTTP API, attachment-ready/disabled WAF, and absence-of-a-platform-
> deployment-workflow statements. ADR-0041 supplies the retained beta platform
> and cross-account DNS trust chain. The four-stack capability/lifecycle
> topology and strict platform/customer-IaC separation remain current; automated
> delivery of the Cloud Markup platform never authorizes deployment of customer
> IaC.

## Context

CloudCanvas has provider-neutral domain, authorization, persistence, commercial,
solution-evidence, and asynchronous-job contracts, plus AWS adapter seams. Its
platform CDK application synthesized an empty placeholder before Prompt 27.
Prompt 27 authorizes the first resource-bearing AWS platform architecture while
explicitly prohibiting deployment, account bootstrap, live integrations,
customer-cloud access, and secret values.

The platform needs independently reviewable data, application, edge, and
operational lifecycles without turning every AWS resource into a stack or
creating circular dependencies. It must preserve the separation between the
CloudCanvas platform and customer-generated IaC, keep local development
AWS-independent, and leave unresolved production policies visible rather than
encoding guesses as architecture facts.

The product owner supplied AWS account `000000000000` and Region `us-east-1` as
reviewed development synthesis inputs for this slice. An account ID and Region
are non-secret deployment coordinates, but they do not authorize credentials,
bootstrap, deployment, or inheritance by staging and production.

## Decision

### Capability and lifecycle ownership

One CloudCanvas CDK stage owns four resource-bearing stacks:

- **Stateful** owns Aurora PostgreSQL Serverless v2/Data API, its generated
  database-secret behavior, and private versioned document and artifact/Evidence
  object storage.
- **Application** owns Cognito, the HTTP API, modular-monolith and bounded
  worker Lambda entry points, current Step Functions/SQS job-delivery
  primitives, integration secret references, feature gates, and their exact
  runtime IAM.
- **Edge** owns private web assets, CloudFront origin protection, same-origin
  `/api/*` routing, baseline response headers, and optional certificate, DNS,
  and WAF attachment interfaces.
- **Observability** owns explicit log retention, alarms, real-metric dashboards,
  tracing configuration, and the notification interface with its rotating
  customer-managed KMS key.

Reusable constructs group cohesive capabilities, not individual AWS resources.
The dependency graph is one-way and acyclic, in the order Observability,
Stateful, Application, then Edge. Observability is the first dependency and owns
deterministic log groups and metric-name interfaces without consuming a later
stack. Stateful depends on those Observability interfaces; Application consumes
typed Stateful references and Observability interfaces; Edge consumes typed
Application references and the necessary Stateful access-log interface. No
earlier stack consumes a later stack, and stacks do not discover one another
through global mutable state. Cross-stack outputs exist only when an operator or
another stack requires the value.

Sandbox resources for Terraform validation and application build/test/package,
including CodeBuild, remain owned by Prompts 32 and 32A. They are not
provisioned or pre-authorized by this topology.

### Typed environment configuration

One strict, versioned configuration boundary validates non-secret inputs before
synthesis. Every environment explicitly supplies its name, account, Region,
removal and deletion-protection behavior, database capacity and pause settings,
retention values, feature flags, optional domain/DNS data, integration
identifiers, secret references, operational limits, and tags. Runtime validation
requires the exact feature-key set with Boolean values before any permission
choice and requires worker concurrency of at least two for the SQS event source.

The reviewed account `000000000000` and Region `us-east-1` are development-only
inputs. Staging and production must supply their own explicit account and Region
values and cannot silently inherit the development target or any
production-sensitive setting. Tests use fictitious account identifiers.

API keys, signing secrets, passwords, private keys, tokens, and customer data
are rejected as normal configuration values. Configuration may contain a
validated Secrets Manager ARN or logical reference, but never the referenced
secret value. Synthesis does not retrieve secrets or depend on AWS credentials.

### Data protection and lifecycle

All S3 buckets block public access, require encrypted transport, and use managed
encryption. Document, artifact, application, export, and Evidence content uses
versioning and explicit lifecycle behavior. Runtime access is constrained by
purpose and reviewed tenant/project key prefixes; an object key never
establishes authorization. The database is encrypted, isolated from public
network access, uses the Data API boundary, and manages its password through
Secrets Manager.

S3 and database storage use AWS-managed encryption. Observability owns one
rotating customer-managed KMS key for the alarm-notification topic because the
CloudWatch and AWS Budgets service publishers require key-policy grants. Both
grants require the exact source account. CloudWatch is limited to
`arn:${partition}:cloudwatch:${region}:${account}:alarm:*`; AWS Budgets is
limited to `arn:${partition}:budgets::${account}:*`. The SNS publish policy
mirrors those exact principals and conditions, and Prompt 27 configures no
notification recipient. No other customer-managed key is introduced without a
separately reviewed threat model, policy, recovery path, and operating cost.

Production configuration requires database deletion protection, retained or
snapshotted state, retained versioned customer-content buckets, and no automatic
object deletion. Development may mark resources `DESTROY`, but the platform does
not automatically empty a bucket. Before any future development destroy, an
operator must explicitly empty only the exact development buckets, including all
versions; otherwise CloudFormation leaves nonempty/versioned buckets in place.
Environment configuration must make this difference visible and must reject a
production configuration that weakens the required protection.

### Runtime and integration isolation

IAM grants exact actions against exact queues, state machines, buckets/prefixes,
database/secret resources, log destinations, and enabled integration resources.
Wildcard administrative policies and customer-cloud permissions are prohibited.
The assembly verifier permits literal Resource `"*"` for KMS only inside the
`AWS::KMS::Key` `KeyPolicy`, with the exact enumerated account-root key-admin
actions or the exact `kms:Decrypt`, `kms:GenerateDataKey`, and
`kms:GenerateDataKeyWithoutPlaintext` service-publisher actions. Wildcard
Actions remain prohibited. Tenant authorization remains an application and
persistence responsibility; infrastructure resource access does not promote a
caller-supplied tenant ID into authority.

AI/Bedrock, billing, GitHub export, validation, application generation,
plan/deploy workflow export, and beta access are default-disabled feature
boundaries. Disabled capabilities receive no invocation permission. Bedrock uses
IAM, not an API key, and any later enabled policy must name reviewed model or
inference-profile resources behind the provider-neutral `ModelGateway`. Stripe
and GitHub values remain exact external secret references; no general API or job
worker receives a secret that belongs only to an isolated integration entry
point.

The billing webhook is currently an isolated fail-closed handler that returns a
bounded `503 billing-disabled` response without reading, parsing, logging, or
persisting request bodies or headers. Its Stripe secret references and read
permissions exist only when billing is enabled. Exact-raw-body signature
verification, delivery retry/dead-letter behavior, and reconciliation remain
future requirements. Creating the endpoint does not enable live Stripe mode or
make a browser redirect authoritative.

CloudFront keeps the web bucket private and provides the same-origin `/api/*`
boundary. Standard/legacy CloudFront access logging is intentionally disabled so
OAuth callback `code` and `state` query parameters never enter S3 logs; S3
origin access logs and redacted API logs remain. The CSP permits inline React
style attributes only through the reviewed `style-src-attr 'unsafe-inline'`
compatibility seam and continues to block inline scripts. The default SPA
behavior rewrites extensionless routes to `index.html` but never rewrites
`/api/*`. Custom domains, certificates, hosted zones, and WAF are optional typed
interfaces. WAF is attachment-ready but disabled until a later hardening
decision supplies the policy.

### Synth-only operator delivery boundary

Prompt 27 produces deterministic CloudFormation templates and assertions only.
It adds no deploy command, account bootstrap, AWS access key, GitHub deployment
workflow, or live operator credential. The documented future operator sequence
is:

1. test;
2. synthesize;
3. review the CloudFormation diff and IAM changes;
4. obtain explicit human approval;
5. assume a narrowly scoped, environment-specific OIDC or SSO deployment role;
   and
6. deploy through an operator-controlled process.

Future deployment roles must be separated by environment, tightly condition
their trust, and remain unavailable to the product runtime and pull-request
code. Defining that future trust interface does not create or execute a current
deployment workflow.

Platform CDK remains wholly separate from the customer IaC compiler and
customer-owned workflows. It cannot import compiler implementation, emit
customer IaC, hold customer credentials, deploy customer resources, or turn a
job, artifact, plan, deployment result, or Evidence record into deployment
authority. Synthesized output remains untracked.

### Decisions deliberately left open

This decision does not resolve:

- production multi-Region topology, disaster-recovery objectives, SLOs, or final
  alarm thresholds;
- product retention/deletion policy for artifacts, prompts, audits, revisions,
  Evidence, or billing records;
- enabled Bedrock models, model Regions, prompt/data retention, or evaluation
  thresholds;
- GitHub authentication, repository permissions, branch policy, or
  partial-failure recovery;
- live Stripe pricing, tax, refund, cancellation-access, retention, or
  reconciliation policy;
- browser authentication/session, refresh-token, logout, and revocation design;
- production reconciliation cadence, orphan grace periods, and restore-drill
  objectives; or
- WAF rules and production edge-hardening policy.

Typed hooks and safe fixture values may expose where these later decisions
belong, but must not be described as approved production policy.

## Consequences

### Positive

- Resource ownership, IAM review, deployment order, and removal behavior are
  visible at capability boundaries.
- Stateful data cannot acquire a reverse dependency on replaceable application
  or edge resources.
- Environment validation and external secret references prevent development
  convenience from silently becoming production configuration.
- Default-disabled integrations keep the initial synthesized permissions and
  external trust surface narrow.
- Platform synthesis can be tested without AWS credentials and without changing
  provider-neutral product contracts.

### Negative

- Cross-stack references and environment overlays become maintained
  compatibility surfaces.
- Aurora minimum capacity, retained versions/backups, CloudWatch telemetry, the
  rotating SNS customer-managed KMS key, Secrets Manager references, CloudFront,
  and optional edge controls create baseline cost even at low traffic.
- A single-Region development topology provides no disaster-recovery evidence.
- Operator deployment, restore, reconciliation, alarm tuning, and incident
  procedures remain additional work before production.

### Follow-up

- Keep CDK assertions for public-access blocking, encryption, production
  deletion protection, log retention, API/integration isolation, exact IAM and
  secret references, configuration rejection, and deterministic synthesis.
- Review synthesized IAM and CloudFormation diffs before any future operator
  deployment design is accepted.
- Add Terraform-validation sandbox resources in Prompt 32 and application
  build/test/package isolation in Prompt 32A, each with its own threat model.
- Resolve the open production topology, retention, authentication, integration,
  reconciliation, SLO, and WAF decisions at their owning milestones.

## Compatibility, security, testing, and rollback

This decision changes no Architecture, Workload, Evidence, commercial,
async-job, or customer-IaC contract. AWS-specific code remains in
`infra/platform`; no provider dependency is added to provider-neutral packages.
Typed platform configuration rejects unsupported versions and invalid
cross-environment values rather than inferring them.

Synthesis is deterministic from reviewed configuration and local source. Tests
must use safe fixtures, inspect every synthesized stack, prove the absence of
unintended wildcard permissions and customer deployment paths, and keep
`cdk.out` untracked. No test requires network access, AWS credentials, secret
resolution, or deployment.

Infrastructure rollback is an operator-controlled future concern. Stateful
production resources retain data or snapshots across replacement/removal;
forward-only database migrations and versioned objects are not reversed by a
CloudFormation rollback. Application, edge, and observability changes may be
rolled back independently only while their typed Stateful references remain
compatible. Any future change to this accepted topology requires a superseding
ADR rather than rewriting this record.

## Alternatives considered

### One stack for every platform resource

Rejected because stateful data, replaceable compute, edge delivery, and
observability have different lifecycles, permissions, and rollback risk.

### One stack or construct per AWS resource

Rejected because it obscures cohesive capability ownership and creates noisy,
fragile cross-stack references.

### Share configuration values and secrets across environments

Rejected because implicit inheritance can expose production settings and makes
review, rotation, and incident containment unreliable.

### Enable every future integration while handlers are unfinished

Rejected because unused secrets and permissions expand the trust and cost
surface without current product behavior.

### Provision CodeBuild and validation sandboxes now

Rejected because Prompts 32 and 32A own their execution threat models,
toolchains, network policy, and evidence contracts.

### Add a deployment workflow with Prompt 27

Rejected because this prompt authorizes synthesis and boundary definition only.
A current workflow or credential would bypass the required diff, approval, and
operator-role decisions.

### Reuse platform CDK for customer infrastructure

Rejected by ADR-0011 and ADR-0005 because it would mix credentials, artifacts,
deployment authority, and deterministic customer compilation.

## References

- [Product specification](../product/PRODUCT_SPEC.md)
- [MVP scope](../product/MVP_SCOPE.md)
- [System overview](../architecture/SYSTEM_OVERVIEW.md)
- [Security principles](../architecture/SECURITY_PRINCIPLES.md)
- [Authorization model](../architecture/AUTHORIZATION_MODEL.md)
- [Billing and usage](../architecture/BILLING_AND_USAGE.md)
- [Solution, repository, and continuous-evidence contracts](../architecture/SOLUTION_REPOSITORY_AND_EVIDENCE.md)
- [Provider-neutral asynchronous job framework](../architecture/ASYNC_JOB_FRAMEWORK.md)
- [Testing strategy](../architecture/TESTING_STRATEGY.md)
- [Project status](../PUBLIC_STATUS.md)
- [Build sequence](../PUBLIC_STATUS.md)
- [ADR-0005](0005-export-without-deploy.md)
- [ADR-0011](0011-separate-platform-and-customer-iac.md)
- [ADR-0012](0012-staged-deployment-configuration.md)
- [ADR-0021](0021-postgresql-data-api-and-object-storage.md)
- [ADR-0022](0022-verified-principal-and-canonical-organization-authorization.md)
- [ADR-0025](0025-canonical-solution-repository-and-evidence-contracts.md)
- [ADR-0026](0026-provider-neutral-durable-async-job-framework.md)
