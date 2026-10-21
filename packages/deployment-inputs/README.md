# Cloud Markup deployment inputs

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

`@cloudmarkup/deployment-inputs` is the versioned, non-secret operator-input
boundary required by ADR-0012. It validates platform deployment coordinates,
Amazon Bedrock routing, Stripe identifiers, GitHub App permissions, repository
synchronization, and customer-owned CI/CD setup before synthesis or any future
operator action.

The package does not resolve secrets, contact providers, assume roles,
bootstrap, synthesize, deploy, create Stripe objects, mutate repositories, run
customer Terraform, or invoke a model. The executable emits only structured,
redacted validation results.

Platform GitHub Actions trust is limited to the exact account-local
`token.actions.githubusercontent.com` provider and an environment subject that
binds the reviewed repository owner and repository by immutable GitHub IDs. The
exported schema and validator enforce the same rule; callers cannot bypass the
cross-field trust checks by using the public Zod parser directly. Legacy
name-only v1 inputs are rejected rather than migrated.

Technical compatibility identifiers retain the established `cloudmarkup` and
`@cloudmarkup/*` spellings. Cloud Markup is the human-facing product name.

From the repository root:

```powershell
pnpm deployment-inputs:validate
pnpm check:deployment-inputs
```

The manual beta setup workflow emits a sanitized discovery record, not a
deployment-input file and not deployment authority. Validate that record, then
merge its four observed values into a separately completed operator-owned v1
input:

```powershell
pnpm --filter @cloudmarkup/deployment-inputs build
pnpm --filter @cloudmarkup/deployment-inputs validate:beta-setup -- <setup-discovery.json>
pnpm --filter @cloudmarkup/deployment-inputs merge:beta-setup -- <operator-base-v1.json> <setup-discovery.json> <new-output-v1.json>
```

The merge may update only the application account, primary Region, certificate
ARN, and hosted-zone ID. It validates the complete result with the authoritative
v1 validator, preserves all operator decisions, rejects placeholders and secret
material, and creates a new output without overwriting either input. The source
revision, exact accounts/roles, CDK bootstrap, issued certificate, image scans,
SBOMs, and provenance must all be complete before discovery validation passes.

See Operator setup and the manual-input inventory.
