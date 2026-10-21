# `@cloudmarkup/platform`

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

## Responsibility

This package defines Cloud Markup's AWS CDK v2 platform stacks:

1. **Observability** owns retained log groups, alarms, dashboard, encrypted
   notification topic, budget, and cost-anomaly controls.
2. **Stateful** owns Aurora PostgreSQL Serverless v2 with Data API, generated
   database secret, private networking, and retained encrypted/versioned S3
   storage.
3. **Application** owns Cognito, the database-migration custom resource, API
   Lambda, Regional REST API, typed API Gateway auth failures, access logging,
   and Regional WAF origin admission.
4. **Edge** owns private web assets, CloudFront same-origin `/api/*` routing,
   SPA fallback, strict response headers/CSP, and CloudFront rate controls.

The dependency order is Observability, Stateful, Application, then Edge. Earlier
stacks never depend on later stacks.

The checked-in account `000000000000` and provider/network identifiers are
non-deployable examples. See
[public platform configuration](../../docs/development/PUBLIC_PLATFORM_CONFIGURATION.md)
before preparing any hosted target.

## Beta deployment profiles

The [beta environment configuration](lib/config/environments/beta.ts) defines
the reviewed core, billing, GitHub-connection, and infrastructure-export
selectors. Use the deployment runbook for source-bound activation and acceptance
state. Migration and runtime contracts are described in the
[platform architecture](../../docs/architecture/AWS_PLATFORM_DEPLOYMENT.md).

## Local verification

From the repository root:

```powershell
pnpm --filter @cloudmarkup/platform test
pnpm check:infra
pnpm beta:synth
pnpm beta:release-gate:artifacts
```

Synthesis is credentialless and writes ignored output under
`artifacts/platform/cdk.out`. It does not deploy.

Beta synthesis binds all four stacks to the dedicated native CloudFormation
bootstrap: qualifier `cmkbeta`, private versioned file-assets bucket, exact
beta-named publishing/lookup/deploy/execution roles, and the
`CloudMarkup-Beta-Runtime-Boundary` permissions boundary on synthesized runtime
roles. The shared `hnb659fds` bootstrap is intentionally not part of beta
delivery. Docker asset publication is disabled and the beta release gate rejects
any Docker asset before deployment.

The complete bootstrap and delivery procedure is in the controlled-beta
deployment runbook. The platform architecture and security boundaries are in
[AWS platform deployment architecture](../../docs/architecture/AWS_PLATFORM_DEPLOYMENT.md).

## DNS and certificate boundary

Application CDK imports an exact us-east-1 certificate ARN and never owns the
public Route 53 zone. Retained native CloudFormation templates under
`infra/application-account` and `infra/dns-account` own the certificate,
cross-account roles, validation CNAME, and output-bound A/AAAA aliases.
`BETA_CREATE_DNS_RECORDS=false` is a beta invariant.

The Stateful stack generates one retained edge-origin verification secret.
CloudFormation dynamic references bind it to CloudFront, API Lambda, and the
Regional WAF without an output, GitHub value, or operator copy. The execute-api
endpoint is public infrastructure but unsupported; WAF rejects missing or wrong
origin markers before Lambda.

## Boundaries

Platform delivery is distinct from customer IaC. The deterministic Go compiler
may generate customer Terraform or CloudFormation, but it cannot deploy, use
credentials, access a network, or execute arbitrary extensions. Platform roles
never assume customer roles or apply customer infrastructure.

Generated `cdk.out`, caches, credentials, and deployment evidence containing
sensitive values must remain untracked. Stateful resources use retained
lifecycle policies and forward-fix migrations; rollback must not delete or
silently replace customer data.
