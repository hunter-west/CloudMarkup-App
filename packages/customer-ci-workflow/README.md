# `@cloudmarkup/customer-ci-workflow`

This package deterministically generates and validates the optional,
customer-owned GitHub Actions workflow set for Cloud Markup Solution packages.
It produces reviewed YAML bytes, a checksum manifest, a plain-language security
preview, sanitized Terraform plan analysis, saved-plan integrity checks, and
fake Evidence lifecycle records.

It has no filesystem, network, process, GitHub, AWS, credential, Terraform, or
deployment authority. The generated workflows execute only after a customer
reviews and exports them through the existing GitHub App feature-branch/pull-
request boundary. Customers own GitHub environments, OIDC roles, Terraform
state, approvals, workflow execution, and every cloud mutation.

The v1 profile is deliberately narrow: GitHub Actions, AWS OIDC, Terraform,
three environments (`dev`, `staging`, and `production`), separate environment-
scoped role variables, exact action commit pins, an approved backend file, an
exact provider lock, bounded deterministic backend and Terraform-source parsers,
encrypted saved-plan retention, exact-plan deploy, no-cloud-role digest-bound
smoke, and read-only drift inspection. Plan, deploy, smoke, and drift recheck
the exact private repository identity before protected artifact or OIDC work.
Jobs with job-scoped OIDC permission run the closed branch, workflow/run commit,
repository, subject, role, and applicable kill-switch admissions before their
first external action. These early checks use the GitHub-hosted runner's native
shell/Node trust boundary and do not request an OIDC token; every action remains
full-commit pinned. Deploy re-hashes the decrypted plan in the final apply
shell. Smoke resolves all A/AAAA answers, rejects any non-global address,
disables proxies and redirects, and pins one validated address for every retry
without a second target lookup.

Beta and production activation remain blocked until both an operationally
reviewed CLI distribution, digest, installation procedure, and support policy
exist and the selected GitHub Environment rules are authoritatively verified at
the execution boundary. Deterministic tests perform no live GitHub/AWS
operation, Terraform plan/apply, or deployment.

```powershell
pnpm check:customer-ci-workflow
```
