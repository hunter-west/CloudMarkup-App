# GitHub App repository export

## What this does

Cloud Markup can deliver one already approved Solution package to a GitHub
repository as a feature branch and pull request. It first shows the complete
file and semantic difference for the selected destination. Nothing is written
until that preview is approved and checked again.

This is export, not deployment. The service cannot merge the pull request, write
the default branch, run a workflow, use customer cloud credentials, or deploy
anything.

Only a GitHub App is supported. Personal access tokens are not accepted by any
configuration, API, persistence, or adapter contract.

## Normal flow

1. An authorized organization administrator creates a short-lived installation
   link intent. The server binds its one-time state digest to the exact
   organization and principal and returns only the exact GitHub App setup URL.
2. The user explicitly continues to GitHub. A trusted callback authority must
   convert GitHub's redirect into an opaque one-time callback receipt; the
   browser never submits or derives an installation ID.
3. The browser removes the opaque callback values from the URL immediately and
   submits the intent ID plus receipt. The server verifies the receipt, state,
   expiry, tenant, principal, and `install` action, claims the exact intent, and
   inspects the exact installation through the App adapter. Installation
   persistence and intent completion then finalize in one database transaction.
   A transient or unknown consumption, inspection, or finalization outcome runs
   exact-bound recovery. A consumed claim is released to pending for retry; if
   finalization committed but its response was lost, the completed state is
   preserved and retry returns that installation without creating a duplicate.
4. Cloud Markup obtains a short-lived installation token inside a disposable
   adapter session and discovers only repositories granted to that installation.
5. The user selects a repository, base branch, destination folder, and a new
   feature-branch name.
6. Cloud Markup reads the selected base and calculates the complete affected
   repository diff. The preview includes file changes, architecture/workload/
   external-resource/IaC/application/diagram/Evidence changes, ownership,
   generator/lock changes, workflow files, and blocking or readiness issues.
7. If workflows are selected, the user previews and confirms every exact path
   and digest. The App must already have Workflows write permission; Cloud
   Markup never requests or silently expands it. The optional Prompt 40A set is
   exactly `cloudmarkup-validate.yml`, `cloudmarkup-plan.yml`,
   `cloudmarkup-deploy.yml`, `cloudmarkup-smoke.yml`, and
   `cloudmarkup-drift.yml` under `.github/workflows/`.
8. Execution re-reads the base and affected files. Any changed merge base, file,
   artifact, installation, permission, or preview expires the approval.
9. The adapter creates a new feature ref, one commit containing the exact
   approved package, and one pull request. It never updates the default ref.

Direct installation-ID linking is hard-denied before GitHub inspection. If the
trusted callback verifier or callback-host composition is absent, completion
fails closed with a safe service-unavailable error and audit event; a guessed or
browser-supplied installation ID is never accepted as proof.

The M9 continuation includes a production App/OAuth callback host and a real
PostgreSQL connection/discovery composition, behind the separate default-off
`integrations.github.connectionsEnabled` flag. `/api/github/setup` starts the
application-controlled OAuth S256 flow; `/api/github/callback` verifies it and
returns a bounded receipt in the URL fragment. GitHub must use the exact
registered setup and callback URLs, with user authorization during installation
disabled because this host initiates its own authorization flow. The adapter
verifies the exact App identity, installation/account identity, selected-only
repository access, and either personal account ownership or current organization
administrator membership. It rejects suspended or over-permissioned installs.

Callback state, the secure cookie, and receipts use purpose-separated encrypted
seals derived from the exact App client secret. Receipt authority is bound to
the initiating organization, principal, authentication session, intent, and
expiry; no browser-selected installation ID grants authority. The callback
window strips the fragment immediately and relays only through a bounded,
same-origin, memory-only channel to the initiating authenticated window. That
window completes the one-time intent. PostgreSQL stores state digests, not OAuth
codes or receipt secrets, and rechecks current tenant membership at every query
and transaction boundary. Provider waits do not hold database locks.

The production resolver reads only two exact full secret ARNs at AWSCURRENT,
with bounded response/time handling and no cache or secret logging. The retained
beta API role stays immutable: its separate owner-bootstrap permission flag and
the application connection flag both default off. Registration, runtime policy,
real PostgreSQL execution and an authenticated provider smoke test are required
before activation. Connecting/discovering a repository does not compose hosted
artifact generation or repository writes; production export preview/execution
remains an explicit service-unavailable result until the immutable artifact
repository and execution path are supplied. This candidate is not yet deployed.

If workflow permission is unavailable, export can proceed without workflow
files. The preview says plainly that customer-owned validation, planning,
deployment, smoke, and drift automation is not ready and identifies every
omitted workflow. Cloud Markup never requests or silently adds a permission to
an existing GitHub App.

## Ownership and regeneration

The immutable Solution export manifest is authoritative for generated,
user-owned, and user-provided paths. A repository file is replaceable only when
its previous generated baseline still matches. User-owned and unmanaged files
are preserved; a collision blocks the preview instead of overwriting content.
Files removed from a newer package are deleted only when the prior manifest
proves that the unchanged path was generated and replaceable.

Files outside the selected destination are not mutated. Workflow files remain at
`.github/workflows/` and are reviewed separately. Portable path validation,
case-fold collision checks, file/aggregate/tree limits, symlink/submodule
denial, and repository binary policy run before a candidate can be ready.

The package is exported exactly as approved. This includes architecture-as-code,
Workload Documents/contracts, External Resource records, generated application
source and tests when present, generated IaC, diagram files when bound by the
artifact, manifests and locks, validation/Evidence artifacts or approved
summaries, documentation with relative diagram paths, and the exact five Prompt
40A workflow files when explicitly included. A missing or mismatched required
package file, workflow path/kind/policy/provenance/checksum, diagram binding,
relative link, generator pin, lock, or digest is surfaced rather than repaired
during GitHub export.

## Prompt 40A workflow review

The workflow preview uses the same Guided and Professional structure and
actions. Plain language explains that Cloud Markup creates reviewable files
only: the customer owns GitHub Environment protection, AWS OIDC trust,
purpose-specific roles, Terraform state, secrets, approvals, execution, and
incident response. Technical details expose exact paths and hashes plus every
environment, approved ref, trigger, job permission, action pin, OIDC subject,
role-variable name, non-secret variable, secret placeholder, artifact retention,
workflow/generator/policy/action-pin registry checksums, Terraform tool version,
saved-plan encryption/binding, strict backend/source-parser policy, exact smoke
target digest, and deployment/smoke receipt dependencies.

The generator is deterministic and accepts only development, staging, and
production with distinct customer roles and workspaces. Pull-request validation
has no credential path. Each environment has a separate plan, approval, and
Evidence chain; deploy uses only the exact unexpired saved plan and never
re-plans. Deployment emits a receipt rather than canonical Evidence.
No-cloud-role smoke and OIDC read-only drift are receipt-bound, and
staging/production also require the exact passing predecessor smoke receipt.
Optional ephemeral mode and artifact-attestation fields are unsupported and
rejected in v1.

Repository-bound reviewed workflows also seal immutable `repositoryId` and
`repositoryOwnerId`. Preview and execution compare both against fresh live
GitHub repository/owner identity. A legacy bound workflow artifact without those
IDs is rejected. Workflowless Solution artifacts and portable-unbound artifacts
containing only the exact built-in credentialless validator remain compatible;
any plan/deploy/smoke/drift workflow requires `state: bound` with both immutable
IDs. Optional ephemeral integration remains schema-disabled pending the
separately reviewed target-specific contract required by accepted ADR-0036.

Export confirmation does not activate the workflows. Beta or production use
remains blocked until both the customer has reviewed a published Prompt 33B CLI
distribution, digest, installation procedure, exact pipeline registration, and
support policy and Cloud Markup can authoritatively verify the selected GitHub
Environment policy at the execution boundary. The generated validation file
currently performs inert package-integrity checks only; it does not install or
invoke Terraform and is not the complete operational Prompt 33B pipeline.

## Prompt 40B repository import and synchronization

The same GitHub App can now open a separate disposable read session for one
authorized repository and exact commit. Import requests only Metadata read and
Contents read, retrieves only allow-listed bounded text paths, and destroys the
installation token after acquisition. Branch heads are discovery evidence; the
immutable commit SHA and snapshot digest identify the import.

The service materializes the bounded files in a private temporary directory and
passes deterministic formats through the Prompt 33C importer. It never executes
repository scripts. Only unresolved sanitized application relationships reach
the approved `repository.interpret` model operation. Source-reference grounding
and confidence are revalidated; unsupported or ungrounded claims fail closed,
remain observed-only, and produce Active Issues rather than design truth.

Migration `0016_github_repository_import_sync.sql` stores tenant/project-bound
immutable import records, snapshot lineage, safe file/Evidence/issue/model-claim
projections, idempotent review receipts, progress, and versioned refresh
subscriptions. Tokens, raw file bodies, raw Terraform state, prompts, model
responses, and unsafe provider bodies have no ordinary public projection.

The editor Code workspace discovers installations, repositories, branches, and
pinned commits and renders the approved architecture diagram with repository
annotations. Designed, Imported/observed, Generated, Planned, Deployed, Current
drift, and Differences views share stable approved identities and positions.
Each layer retains its own provenance, completeness, and freshness; repository
evidence cannot fill another layer. Matching, missing, observed-only, changed,
external, unmanaged, and unresolved states remain distinguishable without
changing diagram or deployment meaning.

Review decisions are exact and idempotent. Accept runs only the proposal's
canonical domain operation after a fresh snapshot/branch check; keep observed,
reject, mark external, and ignore remain explicit review outcomes. Ignore needs
a reason. Regenerate calls the existing export-preview boundary; any repository
write still requires a separately reviewed create-only feature branch and pull
request. Manual and verified allow-listed `push` refreshes create new linked
snapshots and never rewrite an old snapshot or accepted design.

Setup and verification are documented in
[GitHub App repository import](../development/GITHUB_APP_REPOSITORY_IMPORT.md).

## Technical details

### Authentication and secrets

The connections-only M9 path uses the exact App private-key/client-secret pair
described above under accepted
[ADR-0042](../adr/0042-github-installation-ownership-callback.md). It does not
read or require a webhook signing secret. The following export and webhook
design has separate activation and secret grants.

- The App ID is a numeric configuration value.
- The App private key and webhook signing secret are logical Secrets Manager
  references. Secret values do not enter environment configuration or database
  rows.
- App JWTs are RS256 signed and request scoped.
- Installation-link state is random, short-lived, one-time, and stored only as a
  digest bound to organization and principal. Callback receipts, raw state, and
  installation tokens are not persisted or logged.
- The UI navigates only to the server-returned `github.com` App setup URL,
  removes callback parameters before other work, and never sends an installation
  ID.
- Installation tokens request the exact repository IDs and minimum permissions,
  expire within GitHub's short-lived window, remain inside
  `withInstallationSession`, and are zeroed/discarded after the callback.
- Errors, audit events, progress, and persistence projections contain no token,
  private key, signature, raw webhook body, or provider response body.

The platform grants the App private-key secret to only the API and export worker
roles when GitHub export is enabled. The webhook secret is granted only to the
API role. Disabled environments receive neither reference nor grant.

### Webhooks

`POST /webhooks/github` is public at the gateway because GitHub cannot use the
product JWT authorizer. Its authority comes only from raw-body
`X-Hub-Signature-256` HMAC verification. The handler bounds the body before
reading it, uses constant-time comparison, and accepts only `installation`,
`installation_repositories`, `repository`, and `ping` with explicit actions.

`X-GitHub-Delivery`, event name, payload digest, state, timestamps, and replay
expiry are persisted. Raw bodies and signatures are not. Reusing a delivery ID
with different bytes or event is rejected. Installation suspension/deletion and
repository deletion/transfer immediately change stored lifecycle state.

### Persistence

Migration `0014_github_app_repository_export.sql` adds:

- organization-scoped App installation metadata and explicit permission levels;
- installation-authorized repository metadata and lifecycle;
- webhook replay/idempotency evidence;
- immutable, digest-bound repository previews;
- tenant/project-scoped idempotent execution receipts;
- immutable progress events; and
- expanded audit target kinds for installations, repositories, previews,
  webhooks, and exports.

No secret or installation token column exists. Preview JSON contains paths,
digests, ownership, semantic deltas, and safe issues—not file bytes.

Migration `0015_github_app_installation_link_intents.sql` adds digest-only,
organization/principal-bound installation-link intents with expiry, atomic
one-time claiming, exact completed installation/integration binding, and the
state needed to release an exact transient claim. Installation upsert and intent
completion occur in one transaction. A committed completion is idempotently read
on retry; permanent invalid/replay outcomes remain denied. The migration also
adds the composite installation identity constraint used by the completion
foreign key. Raw state and callback receipts have no storage column.

### API and authorization

The additive v1 operations are:

- `POST /v1/organizations/{organizationId}/github-app-installation-link-intents`
- `POST /v1/organizations/{organizationId}/github-app-installation-link-completions`
- `GET /v1/organizations/{organizationId}/github-app-installations`
- `GET /v1/organizations/{organizationId}/github-app-installations/{integrationId}/repositories`
- `GET /v1/organizations/{organizationId}/github-app-installations/{integrationId}/repositories/{repositoryId}/branches`
- `POST /v1/projects/{projectId}/github-repository-export-previews`
- `POST /v1/projects/{projectId}/github-repository-exports`

Verified principal context supplies actor and tenant authority. Linking requires
`integrations.manage` for both intent and completion; discovery requires
`integrations.read`; preview and execution require `exports.run`. The removed
bare installation-ID route returns not found, and its legacy domain method is
hard-denied. The execution endpoint requires an `Idempotency-Key`, the exact
preview digest, and exact workflow confirmations.

### Mutation and recovery

Repository mutation uses Git data objects: blobs, a complete tree relative to
the selected base, one commit, and a create-only feature ref. Ref updates never
force and never target the repository default branch. A lost commit response is
recovered only when the feature branch contains the exact proposed bytes. A lost
PR response is recovered by the exact base/head pair. Retries with the same
tenant/project idempotency digest cannot create another PR.

Orphaned blobs/commit objects after a provider-side partial failure do not move
any branch. Rate limits and temporary GitHub failures return safe retryable
errors. Revocation, protection rules, name conflicts, stale bases/files,
oversized/truncated trees, unsupported binaries, and permission failures stop
without weakening validation.

GitHub's relevant platform contracts are documented in its official guidance for
[validating webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries),
[GitHub App permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app),
[installation access tokens](https://docs.github.com/en/rest/apps/apps), and
[Git tree limits](https://docs.github.com/en/rest/git/trees).

## Deliberate exclusions

There is no personal token, GitHub permission installation/update flow,
automatic repository-to-design mutation, workflow run, merge, default-branch
write, force push, Cloud Markup-operated plan/smoke/drift, deployment, payment,
cloud credential, or arbitrary URL/shell/tool authority. Preview, confirmation,
progress, pull-request opening, and idempotent retry are review/export controls
only; they grant no repository merge or customer-cloud execution authority.
