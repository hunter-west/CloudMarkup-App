# ADR-0028: Cloud Markup predeployment identity and clean baseline

> Public distribution clarification: this accepted decision records the original
> repository identity. The public application source destination is
> `hunter-west/CloudMarkup-App`; `hunter-west/CloudMarkup` remains the private
> AWS operations identity. See
> [current repository identities](../PUBLIC_STATUS.md#repository-identities).

- **Status:** Accepted
- **Date:** 2026-08-16
- **Owners:** Cloud Markup product and engineering
- **Supersedes:** None
- **Refines:** ADR-0002, ADR-0012, ADR-0025, and ADR-0027
- **Superseded by:** None

## Context

The product and repository were originally implemented under the CloudCanvas
working name. Before the first application deployment, the product owner
selected Cloud Markup as the permanent product identity, `cloudmarkup.com` as
its root domain, and `hunter-west/CloudMarkup` as the GitHub repository on
`main`.

No software release or deployed Cloud Markup environment exists. AWS account
`000000000000` and Region `us-east-1` are reviewed non-secret development
synthesis coordinates only. No production customer data requires the working
name to remain active, but disposable developer databases, browser storage,
fixtures, and exported test artifacts may still contain it.

## Decision

### Product and repository identity

Use Cloud Markup for all current user-facing product, repository, package,
command, source, test, fixture, Storybook, documentation, and example names.
Product-owned TypeScript packages use `@cloudmarkup/*`; product-owned commands
and binaries use `cloudmarkup-*`; and product-owned environment variables use
the `CLOUDMARKUP_` prefix. The repository identity is `hunter-west/CloudMarkup`
with default branch `main`.

The product root domain is `cloudmarkup.com`. Planned public, application, API,
schema, callback, and related product-owned hostnames must use that root or one
of its subdomains through explicit environment configuration. This decision does
not create DNS, certificates, hosted zones, or a deployment.

### Clean serialized baseline

Adopt Cloud Markup names for every active product-owned serialized identifier,
including document kinds, schema IDs, URNs, media and policy IDs, catalog and
icon namespaces, compiler/tool IDs, repository export directories and manifest
files, local database and storage names, and browser persistence keys.

Old working-name values are rejected explicitly. They are not silently
reinterpreted as Cloud Markup values, and the active implementation exposes no
permanent alias, dual-read path, or compatibility mode. Because no production
environment or release exists, developers reset disposable local state instead
of carrying a migration layer into the first baseline. From an old checkout,
developers run its `pnpm local:cleanup` before switching and clear old browser
site data when needed. The renamed cleanup command targets only Cloud Markup
data.

Accepted and superseded ADR bodies remain unchanged historical records. Their
former-name text is documentation of the context in which each decision was
accepted, not an active identifier or compatibility guarantee. Exact completed
plan evidence may likewise retain an old command or name when changing it would
falsify what ran.

### AWS and deployment boundary

Use Cloud Markup for product-owned CDK stages, stacks, constructs, metric
namespaces, logs, secret references, bucket prefixes, tags, outputs, and future
application domains. This is safe before initial deployment and avoids carrying
the working name into AWS resource identities.

This decision authorizes synthesis and deterministic verification only. It does
not authorize `cdk bootstrap`, `cdk deploy`, AWS credentials, resource creation,
or any customer-IaC execution. Cloud Markup platform CDK remains separate from
customer-generated Terraform and CloudFormation.

## Consequences

### Positive

- The first deployable baseline has one product identity across code, artifacts,
  local development, documentation, and planned infrastructure.
- Current serialized contracts fail closed instead of hiding ambiguous
  cross-name interpretation.
- No permanent migration or alias burden is created solely for disposable
  pre-release data.

### Negative

- Existing disposable local databases, object directories, browser drafts, and
  cached artifacts must be removed and regenerated.
- Historical ADRs, completed-plan evidence, and Git history still contain the
  former name and require explicit classification during repository searches.
- Any untracked external prototype artifact using the working name is not
  accepted by the clean baseline.

## Compatibility, security, testing, and rollback

Contract tests must prove the Cloud Markup identifiers are emitted and the old
working-name values are rejected. Generated schemas, catalogs, OpenAPI, compiler
copies, fixtures, snapshots, and hashes must be regenerated together and pass
their drift checks. Local-development documentation must describe the one-time
reset and the absence of aliases.

The rename adds no secret, credential, network access, tenant authority,
customer-cloud permission, or deployment path. Account `000000000000`, Region
`us-east-1`, repository identity, and root domain are non-secret configuration.
Rollback before deployment is a source-control operation only, but would require
a new decision because this accepted baseline establishes the permanent product
identity.

## Alternatives considered

### Retain old serialized namespaces indefinitely

Rejected because there is no deployed or released compatibility obligation and
doing so would make the permanent product identity inconsistent from its first
baseline.

### Silently treat old and new identifiers as equivalent

Rejected because it would violate fail-closed versioning, obscure provenance,
and make hashes and exported artifacts ambiguous.

### Deploy first and rename later

Rejected because it would create avoidable AWS resource, data-migration, domain,
and compatibility obligations.

## References

- [Product specification](../product/PRODUCT_SPEC.md)
- [System overview](../architecture/SYSTEM_OVERVIEW.md)
- [Domain model](../architecture/DOMAIN_MODEL.md)
- [AWS platform deployment architecture](../architecture/AWS_PLATFORM_DEPLOYMENT.md)
- [Local development](../development/LOCAL_DEVELOPMENT.md)
- [Project status](../PUBLIC_STATUS.md)
