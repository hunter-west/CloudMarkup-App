# ADR-0040: Regional REST ingress with pre-integration origin admission

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Accepted
- **Date:** 2026-08-31
- **Owners:** Cloud Markup product, platform, and security
- **Supersedes:** ADR-0027's platform-ingress, WAF, and Prompt 27 synth-only
  delivery constraints
- **Refines:** ADR-0005, ADR-0011, ADR-0012, ADR-0022, ADR-0027, and ADR-0028
- **Superseded by:** None

## Context

Cloud Markup's public platform entry point is CloudFront. The prior platform
candidate used API Gateway HTTP API as its API origin, a generated
CloudFront-only header, and a constant-time Lambda check. That check stopped
application/provider processing but ran after API Gateway invoked Lambda. Direct
execute-api traffic could therefore bypass CloudFront-scope WAF rate controls
and consume API and Lambda capacity before denial.

The controlled beta requires pre-invocation origin admission, explicit public
system and webhook routes, Cognito-protected product routes, no Cloud
Markup-held customer AWS keys, deterministic synthesis, and commit-bound
main-branch delivery of the Cloud Markup platform. Platform delivery automation
must not extend to customer IaC, customer cloud credentials, or customer cloud
resources. API Gateway HTTP APIs do not support a directly associated AWS WAF
Web ACL. Adding an ALB, public container service, or private connectivity layer
would materially expand cost, networking, and operational scope.

## Decision

### Platform ingress

The operator-owned platform candidate uses one API Gateway Regional REST API
with an explicit environment-named stage. CloudFront's same-origin `/api/*`
behavior removes the browser-only prefix and prepends that stage as the origin
path. The raw execute-api hostname remains enabled only because it is the
CloudFront origin; it is unsupported for users and integrations.

When `features.waf=true`, the Application stack owns a Regional WAF Web ACL
associated with the REST API stage. Its first rule blocks any request whose
`x-cloudmarkup-edge-origin` header does not exactly match the generated
64-character Secrets Manager value. CloudFormation dynamic references bind the
same value to CloudFront, the Regional rule, and the API and billing Lambda
environments without placing it in an output, GitHub variable, or operator
input. Denial occurs before Lambda integration. The Lambdas retain their
constant-time check as defense in depth against association or configuration
drift.

The Regional origin-admission ACL and CloudFront-scope abuse-control ACL are
separate. Beta requires both controls. Edge may own the global ACL or attach one
reviewed external global ACL. External configuration must provide both the exact
Web ACL ARN and its exact `VisibilityConfig.MetricName`; monitoring must not
infer a CloudWatch dimension from an ARN resource name.

The REST API exposes only:

- `ANY /v1` and `ANY /v1/{proxy+}`, with the Cognito user-pool authorizer and
  exact `cloudmarkup-api/access` scope;
- public `GET /health`, `GET /ready`, `GET /openapi/v1.json`, and
  `GET /runtime-config`; the runtime configuration is `no-store` and contains
  only the reviewed public Cognito browser settings;
- `POST /webhooks/stripe` only when billing is enabled; the route is absent from
  the initial beta while billing is disabled; and
- public-at-Cognito `POST /webhooks/github`. The initial beta has no configured
  GitHub webhook adapter, so the application fails closed with the bounded
  `503 github-disabled` response. The route alone has no repository,
  installation, export, customer-cloud, or deployment authority; a future
  enabled adapter must retain bounded raw-body and provider-signature
  verification as its authority.

API Gateway authorizer claims are not application identity authority. The API
continues to pass the bearer header through the provider-neutral
`PrincipalResolver`, which verifies the token and resolves the current
application principal before tenant authorization.

### Boundaries and admission

This decision applies only to Cloud Markup platform ingress. It does not change
the deterministic customer-IaC compiler's supported HTTP API resources or
generated application contracts. The separately authorized GitHub workflow may
automatically deliver reviewed Cloud Markup platform CloudFormation from pushes
to `main`; pull requests remain credentialless. That workflow cannot deploy
customer IaC, access customer cloud credentials, or mutate customer resources.
This decision does not itself bootstrap an account, create a custom API domain,
activate billing, models, or GitHub integrations, or make the marker user
authentication, tenant authorization, provider-signature authority, or a general
secret-distribution mechanism.

When deployed, the resolved value exists in CloudFront and WAF configuration.
Least privilege for configuration-read APIs, association monitoring, controlled
rotation/rollback, and live proof are mandatory before claiming networked-beta
readiness. Acceptance records the deliberate architecture and security decision;
it is not evidence that a deployment, association, direct-origin denial, or
rotation drill succeeded.

## Consequences

### Positive

- Missing or mismatched direct-origin requests are denied before Lambda
  invocation when the Regional association is present.
- CloudFront rate controls and Regional origin admission have independent
  metrics and alarms.
- Explicit resources, methods, scopes, stage settings, Lambda permissions, and
  raw-body provider boundaries remain deterministically synthesizable and
  testable.
- The four-stack ownership and one-way dependency order in ADR-0027 remain
  unchanged.

### Negative

- REST API, Regional WAF, and their association add resources, cost, quotas,
  IAM, monitoring, and deployment failure modes.
- The platform Lambda event changes from API Gateway payload v2 to payload v1;
  every authentication, binary/download, and provider raw-body path needs
  compatibility evidence.
- The execute-api endpoint remains discoverable, and a principal with broad
  CloudFront/WAF configuration-read permission could recover the marker.
- Secrets Manager rotation does not automatically refresh every resolved
  CloudFormation dynamic reference; rotation requires a controlled stack update
  and rollback plan.
- Acceptance does not satisfy deployment admission: networked-beta readiness
  remains gated on the release checks and live proof named below.

### Follow-up

- Run focused template, payload-v1, deterministic-synthesis, security, and full
  repository gates on an immutable candidate.
- During the separately authorized initial beta deployment, prove CloudFront
  success; missing/wrong-marker direct denial with no API or billing Lambda
  invocation; Web ACL association; configuration-read restrictions;
  Regional/global alarm delivery; and marker rotation/rollback.
- Measure REST API and both WAF layers against approved abuse and cost
  thresholds.
- Preserve ADR-0027 as history with an explicit partial-supersession note for
  its platform-ingress, WAF, and Prompt 27 synth-only delivery language.

## Alternatives considered

### Keep HTTP API with only the Lambda marker check

Rejected for beta because direct requests consume integration capacity before
denial and bypass the CloudFront-scope WAF.

### Disable execute-api and use a custom API Gateway domain

Not selected because it adds another certificate/domain lifecycle and does not
remove the need for pre-integration admission. It may be reconsidered if
operator-owned origin DNS materially improves isolation without creating a
second supported public endpoint.

### Use an ALB, Lambda URL, or public container origin

Rejected for this milestone. An ALB/container path adds VPC/public-service
operations and fixed cost. Lambda URL signing conflicts with the current bearer
and provider-webhook transport without a larger reviewed signing proxy.

### Use a private API or private CloudFront origin

Deferred because private REST APIs and CloudFront origin connectivity require a
different networking design and must preserve public Cognito/system/provider
flows. Reconsider if AWS adds a simpler reviewed private-origin mechanism or the
beta topology expands deliberately.

### Return to HTTP API if it gains equivalent admission

Reconsider if API Gateway HTTP API supports a directly associated
pre-integration WAF or another deterministic, least-privilege origin control
with lower operational cost and equivalent evidence.

## References

- [ADR-0027](0027-aws-platform-capability-lifecycle-topology.md)
- [AWS platform deployment architecture](../architecture/AWS_PLATFORM_DEPLOYMENT.md)
- Controlled-beta threat model
- AWS infrastructure review
- Controlled-beta residual risks
- Controlled-beta readiness
