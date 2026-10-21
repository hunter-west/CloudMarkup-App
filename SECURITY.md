# Security Policy

Source availability does not imply that a hosted environment is activated or
supported. Use only an explicitly announced release and its stated scope.

Cloud Markup handles architecture data and generates infrastructure definitions,
so security is a product property rather than a final hardening step.

## Reporting a vulnerability

Do not disclose suspected vulnerabilities, credentials, customer data, or
exploitable details in a public issue or discussion.

GitHub private vulnerability reporting is enabled for this public repository.
Use **Security → Report a vulnerability** to send a private report. Do not
substitute a public issue for private reporting.

A useful report includes the affected area, prerequisites, impact, a minimal
reproduction, and suggested mitigations. Remove secrets and customer-identifying
data.

## Supported versions

Until the initial public source release is published, no public version is
supported. After publication, security fixes target the latest published public
source release, beginning with that initial release. Identify the supported
source by its GitHub release tag, exact source commit and archive SHA-256 in the
published release manifest. Earlier snapshots and untagged development branches
are not supported releases.

This policy covers the published source and its documented local profile. It
does not promise general availability or qualify an independently configured
hosted/AWS environment. Source tests and synthesized infrastructure do not prove
that a hosted control works; deployment alone does not close traffic-admission
holds.

## Engineering baseline

All implementation and operation must follow
[Security Principles](docs/architecture/SECURITY_PRINCIPLES.md), including:

- verified identity and explicit tenant authorization;
- least-privilege access and auditable sensitive operations;
- schema validation at every trust boundary;
- untrusted treatment of model input and output;
- prohibition on model-executed commands, product-runtime deployment authority,
  and Cloud Markup execution of customer Terraform or CloudFormation;
- least-privilege, commit-bound CloudFormation delivery for Cloud Markup's own
  platform through the separately reviewed GitHub and AWS role chain;
- isolation and resource limits for generated-code formatting and validation;
- safe handling of secrets, prompts, logs, and artifacts; and
- an OWASP ASVS Level 2-oriented verification plan.

## Out-of-scope security testing

A deployed beta does not by itself authorize penetration testing. Do not probe
the beta origin, AWS accounts, unrelated infrastructure, third-party services,
repository-host accounts, or other tenants without explicit written scope from
the repository owner. Ordinary repository review and tests using authorized
local fixtures remain permitted. Live testing rules, accounts, limits, and
contacts must be documented before invited testers perform security testing.
