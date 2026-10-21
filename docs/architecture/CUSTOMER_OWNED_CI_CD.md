# Customer-owned CI/CD workflow artifacts

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

The aggregate non-secret backend, immutable OIDC identity, role-separation,
environment, exact-plan, smoke, window, attestation, rollback, and drift inputs
are documented in Customer Terraform and CI/CD.

Cloud Markup can add five deterministic GitHub Actions files to an approved
Solution export:

- .github/workflows/cloudmarkup-validate.yml
- .github/workflows/cloudmarkup-plan.yml
- .github/workflows/cloudmarkup-deploy.yml
- .github/workflows/cloudmarkup-smoke.yml
- .github/workflows/cloudmarkup-drift.yml

The fixed filenames are the Prompt 40A export contract. The workflow contents,
manifests, Evidence identifiers, generator identity, and product documentation
use the current Cloud Markup name.

These files are reviewable package data. Cloud Markup does not run them, provide
AWS credentials, own Terraform state, approve a GitHub Environment, merge a pull
request, or deploy. Adding them requires the GitHub App's existing Workflows
write permission plus explicit confirmation of every exact path and digest.
Export remains available without workflow files when that permission or
confirmation is absent.

## Deterministic contract and trust inputs

The customer CI workflow package accepts one strict versioned configuration and
emits exactly five YAML files, a workflow manifest, and a plain-language
preview. Configuration closes:

- private repository owner, repository, immutable owner/repository IDs, reviewed
  OIDC subject mode and exact subject prefix, default branch, and destination
  folder;
- exact dev, staging, and production GitHub Environments, approved branches,
  approvals, and Terraform workspaces;
- Terraform root, the versioned AWS S3 backend descriptor and exact
  `backend.hcl`, native S3 lockfile/encryption/workspace isolation policy,
  provider lock path, and Terraform version;
- the exact `hashicorp/aws` provider allow-list, Linux AMD64 Terraform CLI
  checksum, and reviewed Terraform package-tree digest;
- environment variable names for account, Region, roles, deployment baseline,
  deployment kill switch, and smoke endpoint;
- the RSA public key and exact GitHub Environment secret name used to decrypt a
  saved plan; the private key is never part of generated or exported content;
- immutable Solution Revision identity and digest;
- plan expiry and artifact retention;
- bounded smoke path, timeout, and attempt count; and
- a bounded weekly drift schedule.

Paths and branch names reject traversal, expressions, ambiguous separators, and
unsafe Git references. Environments and workspaces must be distinct. Production
must be protected and require at least one reviewer. Plan, deploy, and read-only
drift are separate purposes. Only plan, deploy, and drift have role variables,
and those three variables must be distinct.

Generation is reproducible. Each action reference comes from a closed
full-commit pin registry. Validation regenerates the expected bytes and rejects
any mismatch, credential shape, secret expression, untrusted privileged
pull-request trigger, unapproved action, unreviewed provider, Terraform module
or provisioner, package-tree drift, plan-time apply, deploy-time re-plan,
drift-time apply, or OIDC use in pull-request validation. The pull-request
workflow performs inert package and exact manifest-bound application-source
policy checks. It applies secret patterns to admitted text and execution-
primitive rules only to generated-replaceable ownership. It does not install or
invoke Terraform, build/test source, or execute provider/repository code.

## Workflow authority

| Workflow | Credentials                                                     | Authority                                                                                   | Retained output                                                         |
| -------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Validate | None                                                            | Inert package, manifest/checksum, ownership-aware source policy, path, and tree checks only | No retained Evidence artifact                                           |
| Plan     | Short-lived plan-role OIDC session                              | Read and plan against one approved backend/workspace after activation gates                 | Encrypted saved plan, exact manifest, sanitized analysis, plan Evidence |
| Deploy   | Short-lived deploy-role OIDC session after environment approval | Apply only the exact unexpired decrypted saved plan                                         | Deployment receipt only; no canonical Evidence claim                    |
| Smoke    | None                                                            | Read-only approved HTTPS probe                                                              | Sanitized result, successor receipt, deployment Evidence                |
| Drift    | Short-lived read-only drift-role OIDC session                   | Refresh-only inspection; never apply                                                        | Sanitized analysis, successor receipt, drift-observation Evidence       |

Repository-wide permissions are minimal. Pull-request validation has only
contents read. Privileged jobs use identity-token write only where OIDC is
needed. Jobs that retrieve a prior run artifact also use actions read. Checkout
never persists repository credentials.

GitHub grants `id-token: write` at job scope rather than immediately before the
credential step. The generated plan, deploy, and drift jobs therefore declare
that permission for the whole job but run the closed branch, executing-workflow
commit, repository identity/visibility, OIDC subject, and resolved-role
admissions before the first `uses:` action; deploy also checks its environment
kill switch there. These inline admissions neither read GitHub's OIDC request
variables nor request a token. They use only the GitHub-hosted runner's built-in
shell and Node.js runtime plus the fixed GitHub repository endpoint. That
runner/runtime is an explicit pre-action trust boundary. Every external action
remains pinned to the reviewed full commit, and the pinned Node 24 setup action
runs only after the pre-action admissions pass.

Plan generation binds its workflow revision to the planned commit. Deploy,
smoke, and drift require both `github.workflow_sha` and the run SHA to equal the
exact selected plan or deployment commit before any external action. A later
workflow revision therefore cannot operate on an earlier reviewed revision.

No generated file contains an account ID, role ARN, backend credential, provider
credential, state secret, webhook secret, private key, or long-lived access key.
The deploy workflow contains only the exact reviewed GitHub secret reference for
the plan-decryption private key. Role ARNs and account IDs are non-secret GitHub
Environment variables. State and backend secrets use customer-controlled
mechanisms outside the generated package.

## Supply-chain and package controls

The reviewed package allows only `hashicorp/aws`. Its Solution manifest,
repository lock, per-file checksums, Terraform file set, package-relative tree
digest, provider lock source/version/hashes, and Linux AMD64 Terraform CLI
checksum must agree before Terraform can run. Terraform initialization disables
module fetching. Module, provider, and provisioner blocks plus provider alias
assignments are rejected, so exported repository content cannot add a module,
override OIDC role or endpoint authority, select an alias, or add a provisioner
to the reviewed workflow path. These controls do not make arbitrary customer
Terraform safe; they constrain execution to the exact generated package and its
deterministic provider baseline.

Terraform source inspection is a bounded deterministic parser, not a keyword
regular expression. It parses JSON syntax before walking `.tf.json` keys,
including decoded Unicode escapes, and lexes HCL comments, quoted strings,
heredocs, delimiters, blocks, and assignments. Actual `module`, `provider`, or
`provisioner` blocks, provider alias assignments, malformed/unterminated input,
excessive nesting, or excessive tokens/nodes fail closed; those words inside
inert comments, strings, or heredocs do not become a false block claim.

The backend validator separately requires the versioned `aws-s3` descriptor and
the exact `backend.hcl` at the Terraform root. That UTF-8 file has exactly six
assignments—`bucket`, `encrypt`, `key`, `region`, `use_lockfile`, and
`workspace_key_prefix`—with encryption and native locking enabled and Region
equal to the selected environment. Comments, duplicate or unknown keys,
credentials, profiles, endpoint overrides, malformed values, and extra backend
files fail closed.

## Saved-plan integrity

Pull-request validation performs only inert package checks. The trusted plan
workflow repeats those checks, then reaches a hard preflight hold before it can
install Terraform, initialize a backend, run provider code, or request OIDC. If
all separately reviewed activation requirements are later satisfied, it may
assume only the planning role, initialize the selected customer backend and
workspace, and write a Terraform plan file. Raw Terraform JSON is reduced to
hashed resource identities, mode, type, the exact allowed provider name, and
action. Values, before/after state, sensitive fields, outputs, provider
configuration, and raw resource addresses are excluded from summaries and
Evidence.

The plan is encrypted before artifact upload with a fresh AES-256-GCM data key.
That key is wrapped with the reviewed RSA public key using RSA-OAEP-SHA256; RSA
keys shorter than 3072 bits are rejected. The plaintext plan is removed before
upload. Only the deploy job may read the exact environment-scoped private-key
secret, decrypt into bounded runner-temporary storage, verify the plaintext
checksum, apply the verified file, and remove it. Repositories must be private.

The saved-plan manifest binds:

- plaintext and encrypted saved-plan, sanitized-plan, and semantic-analysis
  checksums plus the exact encryption descriptor and public-key digest;
- Terraform version and provider lock digest;
- Solution Revision ID and digest;
- exact Git commit and environment;
- backend configuration and workspace;
- Solution export manifest and repository lock digests;
- infrastructure input and environment configuration digests;
- workflow configuration and policy digests;
- exact resolved target account, commercial AWS partition, Region, digests of
  the three distinct role ARNs, and exact environment-qualified OIDC subject;
  and
- creation and expiry timestamps.

The restricted artifact contains the encrypted plan envelope, manifest,
sanitized analysis, and plan Evidence. It never contains the plaintext binary
plan. Retention is bounded. The plan workflow never applies.

Deployment downloads the named artifact from the explicitly selected plan run.
Before AWS OIDC, it recomputes every applicable binding and rejects stale,
substituted, cross-environment, cross-workspace, cross-backend, cross-commit,
cross-revision, cross-account, cross-Region, cross-role, cross-subject,
lock-mismatched, or tampered input. It never creates a fresh plan. Production
additionally relies on a protected GitHub Environment and required reviewer
approval. A customer-controlled environment variable is an explicit deployment
kill switch. After OIDC and backend initialization, the same shell step that
invokes apply rechecks the exact manifest checksum, expiration, manifest-bound
plan checksum, decrypted plan path/type/size, and decrypted plan bytes
immediately before Terraform. A plan that expires or changes between initial
inspection and apply is rejected.

Plan, deploy, smoke, and drift also query only the fixed GitHub API repository
endpoint and recheck the exact reviewed owner/name, immutable IDs, and private
visibility before protected artifact or OIDC work. Redirects, a changed response
origin or URL, oversized/malformed responses, renamed/transferred identity, or
public visibility fail closed with a bounded diagnostic.

The reviewed repository-workflow payload seals both `repositoryId` and
`repositoryOwnerId`. GitHub preview and execution compare them with fresh live
repository and owner identity in addition to owner/name/default-branch checks.
Legacy repository-bound workflow artifacts without both immutable IDs fail
closed rather than being silently upgraded. Workflowless exports and
portable-unbound exports containing only the exact built-in credentialless
validator remain compatible. Any plan, deploy, smoke, or drift workflow requires
`state: bound` with both immutable IDs.

There is no generic rollback promise. Recovery is specific to the customer's
application, state, provider behavior, and incident procedure.

## Receipt and Evidence chain

Successful deployment writes a stage receipt bound to the saved-plan manifest
and target-authority digest. It does not create canonical Evidence. Smoke and
drift retrieve that receipt from an exact prior GitHub run, verify its checksum,
environment, commit, Solution Revision, and target authority, and check out the
receipt's commit before further work. Their successor receipts identify the
deployment receipt as the predecessor. A staging or production deployment also
names and verifies both the exact predecessor-environment deployment receipt and
the exact passing predecessor smoke receipt. Only a passing smoke observation is
deployment Evidence; drift Evidence describes drift inspection only.

Evidence remains immutable observation. It cannot update the canonical graph,
authorize a deployment, or silently clear an issue. Drift can report a changed
state with successful inspection Evidence; Prompt 47B may later project that
observation into active issues without merging designed and deployed authority.

## Promotion

Promotion is dev to staging to production. Each stage names the same exact
commit and Solution Revision but creates its own backend/workspace-bound plan,
plan Evidence, approval, deployment receipt, smoke result, and smoke Evidence. A
saved plan or approval is never reused between environments. Staging cannot
start until the exact development deployment and passing smoke runs and receipt
checksums are supplied; production has the same requirement for staging.

The deterministic fake lifecycle accepts the full predecessor lifecycle result,
derives canonical plan/deployment/smoke receipt digests, validates the exact
passed receipt chain and passing smoke Evidence, and emits those predecessor
digests into the next environment's receipt. Development rejects a predecessor.

## Smoke and ephemeral targets

Smoke accepts only an environment-scoped, pre-approved HTTPS base URL with no
embedded credentials, query, or fragment. Its path, timeout, and retries are
bounded, and response bodies are discarded. The runtime URL must match the exact
reviewed per-environment digest. The v1 profile accepts public DNS names over
HTTPS port 443 only, follows no redirects, rejects IP literals and
local/internal host classes, performs no discovery, and records only the
enclosing target authority digest rather than the URL. Immediately before the
probe it resolves both A and AAAA records with a bounded resolver, rejects the
entire answer if any address is loopback, private, link-local, reserved,
documentation-only, multicast, or otherwise non-global, and selects one
deterministically. Curl disables configuration files and proxies and pins that
validated address with `--resolve`; retries reuse it, and redirects remain
disabled, so the probe performs no second target DNS lookup.

Optional ephemeral mode is not implemented in v1. The strict configuration
requires it to remain false, generation rejects attempts to enable it, and the
review shows an explicit unsupported-behavior warning. A future implementation
needs a separately reviewed isolated account/role, bounded target operations,
budget and quota enforcement, cleanup evidence, and fork-safe admission.

Accepted ADR-0036 requires that target-specific contract to be reviewed before
the schema denial changes; a generic Terraform destroy workflow is not inferred.

## Drift

Drift runs manually or on a bounded weekly schedule, one environment at a time.
Each GitHub Environment supplies the exact deployed run and receipt digest.
After baseline verification, the workflow assumes only the read-only drift role
and runs Terraform refresh-only planning with detailed exit status. It never
applies. The raw drift plan and raw JSON are removed before upload.

## Activation status

The deterministic generator, validators, fake lifecycle, and export seams can be
verified without AWS or GitHub. Activation remains hard-held for two independent
reasons:

1. The generated planning workflow stops in its credentialless preflight before
   Terraform setup, provider execution, or OIDC because an operational Prompt
   33B CLI distribution is unavailable. The current source-built template is an
   implementation seam, not that reviewed distribution.
2. Cloud Markup does not yet authoritatively read and verify the selected GitHub
   Environment protection rules, required reviewers, and allowed deployment
   branches at the final execution boundary.

Beta readiness remains blocked until both the Prompt 33B distribution/digest/
installation/support policy and authoritative GitHub Environment-policy
verification are implemented and reviewed. This Prompt does not activate or run
customer workflows.

See
[Customer-owned GitHub OIDC setup](../development/CUSTOMER_OWNED_GITHUB_OIDC_SETUP.md)
for the customer configuration checklist.
