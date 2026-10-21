# ADR-0012: Staged Deployment Configuration

- Status: Accepted
- Date: 2026-07-24
- Owners: CloudCanvas product and engineering
- Supersedes: None

## Context

Future CloudCanvas platform deployments will require environment-specific
accounts, regions, domains, identity settings, provider features, billing
identifiers, retention rules, budgets, and operational contacts. Treating all of
these as secrets or embedding them in source and prompts would make review,
automation, and incident response unsafe.

## Decision

Platform deployment configuration will be typed, validated, environment-scoped,
and introduced in stages. Non-secret inputs may be represented in reviewed
configuration, including:

- account and region targets;
- environment names, domains, and DNS ownership;
- OIDC, Cognito, and Bedrock capability settings;
- database retention and recovery policy;
- Stripe Product and Price identifiers;
- GitHub App identifiers and integration settings;
- budgets, alarms, and operational contacts.

Actual API keys, signing secrets, passwords, private keys, customer data, and
other secret values must never be committed to the repository or copied into
prompts. Configuration references secrets through approved secret channels and
resolves them only in the deployment environment that needs them.

Validation occurs before synthesis or deployment, reports missing and invalid
inputs without exposing secrets, and fails closed. Environment overlays cannot
silently inherit production-sensitive values. Introducing this contract does not
authorize platform deployment or customer infrastructure deployment.

## Consequences

### Positive

- Reviewable configuration is distinct from sensitive secret material.
- Environments can be validated consistently before operator action.
- Deployment prerequisites become explicit without placing credentials in source
  control.

### Negative

- Configuration schema and secret references need versioning and migration.
- Operator setup remains required outside the repository.
- Fail-closed validation can delay a deployment until inputs are corrected.

### Follow-up

- Define the typed environment configuration and validation command.
- Document the approved secret store and rotation workflow for each environment.
- Add redaction, missing-input, cross-environment, and synthesized-output tests.

## Alternatives Considered

- Put all settings in environment variables without a schema. Rejected because
  validation and review would be inconsistent.
- Commit encrypted secret values with application configuration. Rejected
  because repository access and secret lifecycle remain coupled.
- Gather deployment secrets in implementation prompts. Rejected because prompts
  are not an approved secret channel.

## References

- [Security Principles](../architecture/SECURITY_PRINCIPLES.md)
- [ADR-0011](0011-separate-platform-and-customer-iac.md)
- [System Overview](../architecture/SYSTEM_OVERVIEW.md)
- [Build Sequence](../PUBLIC_STATUS.md)
