# ADR-0005: Export without deployment

- **Status:** Accepted
- **Date:** 2026-07-23
- **Owners:** CloudCanvas engineering
- **Supersedes:** None
- **Superseded by:** None

## Context

CloudCanvas must let users take generated Terraform into their engineering
workflow. Direct cloud deployment would require customer cloud credentials,
state and locking ownership, approval and rollback systems, environment drift
handling, policy integration, and a much larger operational trust boundary.

The first release can deliver value through reviewable output without assuming
responsibility for customer infrastructure changes.

## Decision

The first release exports immutable, reviewed artifacts and does not deploy
them.

Supported export paths are:

- download the exact reviewed artifact as a ZIP; and
- after explicit authorization, create a GitHub branch and pull request
  containing the exact reviewed artifact.

The product shows a complete file manifest and diff before export. GitHub export
may create a branch and pull request only; it does not merge, force-push,
trigger deployment intentionally, or mutate a customer cloud account.

CloudCanvas does not request or store customer AWS access keys. It does not run
`terraform apply`, CloudFormation stack operations, arbitrary provisioners,
model-executed commands, or customer-supplied executables. Formatting and static
validation run in an isolated environment with no deployment permission or
customer credentials.

Any future deployment capability requires explicit product approval, a new
threat model, operational ownership design, and an ADR that supersedes this
scope.

## Consequences

### Positive

- The first release has a substantially smaller credential and blast-radius
  surface.
- Users retain existing review, CI, policy, state, and deployment controls.
- The artifact-to-diff-to-export chain can be immutable and auditable.
- CloudCanvas can focus on architecture quality and deterministic generation.

### Negative

- CloudCanvas cannot prove account-specific deployability or detect all
  live-environment constraints.
- Users need an external workflow to plan and apply Terraform.
- GitHub permissions and repository automation can still create indirect risk
  and need careful disclosure.
- “Validated” must be worded precisely so it is not confused with applied or
  account-verified.

### Follow-up

- Define the sandbox and static-validation model before M7.
- Bind ZIP and GitHub exports to reviewed content digests.
- Define GitHub authentication, permissions, idempotency, and partial-failure
  behavior before M8.
- Document clearly that repository workflows may run after a pull request and
  are controlled by the customer repository.

## Alternatives considered

### Direct AWS deployment in MVP

Rejected because it materially expands credentials, state, approval, rollback,
drift, policy, and incident responsibilities.

### Store customer AWS access keys for validation

Rejected because the first release does not need account access and should not
take on that secret and authorization risk.

### ZIP export only

Not selected because a reviewed pull request integrates with common engineering
controls while still avoiding deployment. ZIP remains available as the
lowest-permission path.

### Push directly to a default branch

Rejected because it bypasses review and raises overwrite and deployment-trigger
risk.

## References

- [MVP Scope](../product/MVP_SCOPE.md)
- [User Workflows](../product/USER_WORKFLOWS.md)
- [Security Principles](../architecture/SECURITY_PRINCIPLES.md)
- [Build Sequence](../PUBLIC_STATUS.md)
