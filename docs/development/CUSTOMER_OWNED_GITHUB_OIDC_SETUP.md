# Customer-owned GitHub OIDC and Terraform setup

This guide configures the customer side of the generated Prompt 40A workflows.
It does not grant Cloud Markup AWS access. Use dedicated test accounts and
repositories before production.

## 1. Review before export

In the GitHub export preview, verify all five workflow files, semantic and file
diffs, action commit pins, Solution Revision, destination, Terraform paths,
private-repository visibility, immutable repository/owner IDs, OIDC subject mode
and prefix, environment names, approved branches, role variable names, Terraform
CLI and package-tree digests, provider allow-list, plan-encryption public-key
digest and private-key secret name, triggers, permissions, retention, warnings,
and Evidence changes.

Adding workflow files requires:

1. an authorized editor whose organization plan and policy permit GitHub export;
2. an installed GitHub App that already has Workflows write permission; and
3. explicit confirmation of every workflow path and digest.

Cloud Markup does not request a permission upgrade. If permission or
confirmation is absent, export without workflow files and treat CI/CD readiness
as incomplete.

## 2. Create GitHub Environments

Create three distinct environments matching the preview, normally development,
staging, and production. Configure environment protection in GitHub:

- allow only the exact reviewed branches;
- require reviewers for staging as policy requires;
- require one or more reviewers for production;
- prevent self-review where organizational policy requires it;
- restrict deployment branches and tags;
- limit who can edit environment variables and protection rules; and
- set artifact and log retention to organizational policy within the generated
  upper bound.

The workflow also validates the exact repository name and immutable IDs,
environment choice, and approved branch. GitHub Environment protection is still
authoritative. Cloud Markup does not yet have an authoritative
execution-boundary read of the selected Environment's protection rules,
reviewers, and allowed deployment branches. Configuration and preview are not
proof that those rules exist. Keep activation blocked until that verification is
implemented and reviewed.

## 3. Configure GitHub's AWS OIDC provider

In each customer account, configure the GitHub Actions OIDC provider with:

- provider URL: https://token.actions.githubusercontent.com
- audience: sts.amazonaws.com
- no static AWS access key in GitHub

Every role trust policy must constrain both audience and subject. Use the exact
repository owner ID, repository ID, names, and GitHub Environment shown in the
preview. The generated immutable-ID mode expects this exact subject shape:

```text
repo:<OWNER>@<OWNER_ID>/<REPOSITORY>@<REPOSITORY_ID>:environment:<GITHUB_ENVIRONMENT>
```

The policy below contains placeholders, not deployable customer values:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<CUSTOMER_ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:<OWNER>@<OWNER_ID>/<REPOSITORY>@<REPOSITORY_ID>:environment:<GITHUB_ENVIRONMENT>"
        }
      }
    }
  ]
}
```

Use `StringEquals`; do not use wildcard repositories, wildcard environments,
pull-request subjects, or organization-wide subjects. The generated pre-token
check also requires GitHub.com, the exact repository and owner names and IDs,
the selected Environment, and the reviewed Region. Branch admission is a
separate workflow check; keep GitHub Environment branch restrictions aligned
with it.

The contract retains an explicit legacy name-based subject mode only for a
reviewed compatibility case and requires its exact risk acknowledgement. Names
can be reused after rename, transfer, or deletion, so immutable-ID mode is the
default and any repository lifecycle change requires a new trust review. See
GitHub's
[OIDC reference](https://docs.github.com/en/actions/reference/security/oidc) for
the current subject behavior. GitHub Enterprise Server is not supported by this
profile.

## 4. Create distinct roles

Create separate customer-owned roles for every environment and purpose:

- plan: backend access, lock access, provider reads, and only actions needed to
  create a plan;
- deploy: the reviewed apply permissions for the generated infrastructure;
- drift: backend/lock access and provider reads required for refresh-only
  inspection, with no mutation permissions.

Do not reuse role ARNs between purposes. Attach session duration and permission
boundaries appropriate to the short workflow timeout. Review generated Terraform
and provider mappings when deriving IAM; do not infer broad administrator
permissions from this guide.

Cloud Markup cannot prove a customer IAM policy is least privilege. Test
explicit denies and verify through CloudTrail that the plan and drift roles
cannot mutate resources. The generated smoke workflow has no OIDC or cloud role;
it performs only the explicit bounded HTTPS probe.

## 5. Configure environment variables

Create the exact environment-scoped variable names shown in Technical details.
The standard categories are:

- customer account ID and Region;
- plan, deploy, and read-only drift role ARNs;
- deployment enabled kill switch;
- deployed commit;
- deployed Solution Revision digest;
- deployment receipt digest;
- GitHub deployment run ID; and
- approved smoke base URL.

Create the exact environment-scoped plan-decryption private-key secret named in
the preview. It must match the reviewed RSA public key, use at least 3072 bits,
and be readable only by the protected deploy job. The plan job uses only the
public key. Never reuse the private key as a backend or provider credential.

Role ARNs and account IDs are identifiers, not secrets. They must still be
reviewed and environment-scoped. The exact account, Region, three role-ARN
digests, and Environment-qualified OIDC subject become saved-plan target
authority. Never place access keys, provider credentials, state credentials,
private keys, webhook secrets, or tokens in generated files.

After a successful deployment, an authorized customer operation updates the four
deployed-baseline variables from the reviewed deployment receipt. Drift fails
closed if any baseline value differs.

Do not configure an ephemeral-test role for v1. Ephemeral deployment is
schema-disabled and attempts to enable it are rejected. A future reviewed
profile must define its isolated target, budget, quota, cleanup, ownership, and
authenticated-test boundaries before that authority can exist.

## 6. Configure Terraform state and workspaces

Create one approved AWS S3 backend under customer control. V1 requires the
versioned `aws-s3` descriptor, S3 native lockfiles, encryption, and Terraform
workspace-key-prefix isolation. The exact file must be `backend.hcl` at the
reviewed Terraform root and contain exactly these six assignments, one per line,
with no comments, duplicates, credentials, endpoint overrides, or other keys:

```hcl
bucket = "example-cloudmarkup-state"
encrypt = true
key = "cloudmarkup/example-solution.tfstate"
region = "us-east-1"
use_lockfile = true
workspace_key_prefix = "cloudmarkup/workspaces"
```

The names above are visibly fake examples; replace them through the reviewed
configuration. Bucket, key, Region, workspace prefix, file checksum, and package
tree are deterministic inputs. The workflow checks the backend Region against
the approved environment Region before Terraform. Obtain backend credentials
only through the environment's planning/deployment/drift OIDC role and never put
credentials, profiles, custom endpoints, or state values in this file.

Create distinct workspaces for dev, staging, and production. Review:

- backend identity and Region;
- encryption and access logging;
- state and lock least privilege;
- state retention and recovery;
- provider lock file and Terraform version;
- workspace existence and naming;
- destination-folder-relative paths; and
- incident procedures for a stuck lock or inaccessible artifact.

Never commit state files or backend secrets.

The current package admits only `hashicorp/aws`. Review the exact provider lock
source, version, and hashes, the Linux AMD64 Terraform CLI checksum, and the
package-relative Terraform tree digest. Module, provider, and provisioner blocks
and provider alias assignments are rejected; initialization disables module
fetching. A changed Terraform file, provider source, provider lock, CLI binary,
or package tree requires a new reviewed export rather than a local bypass.

The repository check uses a bounded parser: `.tf.json` must be valid JSON and
HCL is lexed with comments, strings, heredocs, and delimiter balance understood.
Actual module/provider/provisioner blocks, provider aliases, malformed or
unterminated input, escaped JSON block keys, and source above the fixed parser
limits fail closed. Do not work around the parser by editing generated workflow
code or weakening the source policy.

## 7. Validate, plan, and promote

Before any credentialed job, run and review the no-credential validation result.
The pull-request workflow performs inert package checks and never invokes
Terraform or provider code. The generated plan workflow enforces a hard
credentialless hold before Terraform setup, provider execution, or OIDC.
Production use remains blocked until the organization has approved a Prompt 33B
CLI distribution, version, digest, installation process, and support policy and
Cloud Markup can authoritatively verify the selected GitHub Environment policy.

For each environment:

1. create a new plan for the exact commit and Solution Revision;
2. review the sanitized semantic analysis and every destructive warning;
3. retain only the restricted encrypted saved-plan artifact for the bounded
   period; the raw plan must never be uploaded;
4. dispatch deployment with the exact plan run ID and manifest checksums;
5. complete the GitHub Environment approval;
6. verify the deployment receipt; deployment itself does not emit canonical
   Evidence;
7. run bounded smoke against that receipt and review its deployment Evidence;
8. update the environment's deployed-baseline variables for drift from the
   reviewed receipt; and
9. before staging, supply the exact development deployment run/checksum and the
   exact passing development smoke run/checksum; before production, supply the
   corresponding exact staging values.

Repeat with a new environment-bound plan for staging and production. Never copy
a dev or staging saved plan into another environment. Never re-plan in the
deployment workflow.

## 8. Operate smoke and drift

Keep the smoke endpoint non-sensitive and safe for retries. It must use HTTPS
and return no secret-bearing body that operators depend on; generated jobs
discard the body. Configure the URL separately in each GitHub Environment and
confirm its SHA-256 digest matches the exact digest shown in the workflow
preview. V1 allows a public DNS name on HTTPS port 443 only; it rejects IP,
localhost, `.local`, `.internal`, credential, query, fragment, changed-target,
and redirect cases. A failed smoke check records sanitized failure Evidence and
blocks promotion by policy. It does not roll back automatically.

Run drift manually after relevant incidents and on the bounded weekly schedule.
Review changed-state Evidence and the sanitized machine-readable artifact.
Refresh-only drift never repairs or applies. Resolve the cause through normal
design, review, plan, and deployment procedures.

## 9. Incident response

If a role, workflow, artifact, or environment may be compromised:

1. turn off the deployment-enabled environment variable;
2. disable the affected GitHub workflow or Environment;
3. revoke or tighten the affected IAM role trust and permission policies;
4. preserve GitHub audit, workflow, artifact, CloudTrail, state-lock, and
   deployment receipt evidence according to policy;
5. invalidate outstanding saved plans by removing artifacts or waiting for
   expiry;
6. rotate any customer secret that may have been exposed outside the generated
   contract;
7. rotate the plan-decryption key pair and invalidate plans encrypted to the old
   key when either key's custody is uncertain;
8. create a new Solution Revision and plan after investigation; and
9. restore execution only after repository, environment, role, backend, action
   pins, and receipt bindings are re-reviewed.

Do not reuse a suspect plan. Do not edit a saved-plan manifest to make it pass.
Do not treat a successful Terraform apply as proof that the application is
healthy. Cloud Markup has no generic rollback authority; follow the customer's
application- and infrastructure-specific recovery runbook.

## 10. Test without AWS

Normal repository tests parse and validate generated YAML, exercise a fake
GitHub adapter and fake lifecycle, mutate every saved-plan binding, verify
receipt chains, and assert that no AWS, Terraform, shell, or deployment adapter
is invoked. They also exercise the strict backend and Terraform-source parsers,
exact endpoint digest, private-repository recheck, plan encryption, and
deployment-plus-smoke promotion chain. Live AWS calls, live GitHub repository
mutation, GitHub Actions execution, and deployment are intentionally absent from
Prompt 40A.
