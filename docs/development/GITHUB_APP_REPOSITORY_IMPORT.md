# GitHub App repository import and synchronization

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

Environment-specific App identity, endpoint, permission, secret-reference, and
repository-sync inputs are authoritative in GitHub App and repository
synchronization.

## Scope and permissions

Prompt 40B imports source evidence from one authorized GitHub repository at one
exact commit. The default read session requests only Metadata read and Contents
read for the selected repository. It never asks for organization administration,
workflow-run, merge, force-push, cloud credential, or deployment authority.

Workflow-file write is not an import permission. It remains a separate optional
permission used only by the existing reviewed feature-branch/pull-request export
flow. An App installation may support both workflows, but each disposable token
session is narrowed to the permissions required by the operation.

The API composition must inject the GitHub import application, tenant-scoped
snapshot/review/refresh stores, the Prompt 33C importer runner, audit/progress
ports, canonical reconciliation, and the existing export-preview adapter for
regeneration. If any required authority is absent, the public route fails closed
as service unavailable. The default application and Lambda exports do not infer
credentials or silently enable the integration.

## Import workflow

1. Link the GitHub App through the existing verified one-time installation flow.
2. Open an authenticated project editor and select the Code workspace.
3. Select a connected installation, authorized repository, branch, and exact 40-
   or 64-character commit SHA. The branch is discovery context; the commit is
   snapshot identity.
4. Review the selected repository-relative paths and ignored paths. Import
   accepts at most 128 of each, 4,096 selected files, 20,000 tree entries, 8 MiB
   per file, and 128 MiB total. Paths are at most 240 bytes.
5. Start the import. A short-lived installation token reads only the pinned tree
   and allowed blobs, then is discarded. No repository script, package manager,
   Terraform/CDK program, or customer credential is executed.
6. Review the immutable snapshot, exact file changes, source Evidence, Active
   Issues, and the Designed, Imported/observed, Generated, Planned, Deployed,
   Current drift, and Differences views.
7. Apply an explicit review decision. Accept uses the canonical operation
   engine; keep observed, reject, external, and ignore remain review records.
   Ignore requires a reason. Regenerate creates a reviewed export preview only;
   repository mutation still requires the existing feature-branch/pull-request
   workflow.

Manual refresh selects a new exact commit and creates a new snapshot linked to a
previous import. Optional webhook refresh accepts only a verified `push` for the
configured installation, repository, and exact branch. Delivery replay,
repository lifecycle, and tenant checks run before scheduling. Neither refresh
path rewrites an earlier snapshot or approved design.

## Safe source policy

The scanner admits the documented architecture/application/CI text types and
rejects traversal, absolute/backslash/encoded/ADS paths, portable case/NFC
collisions, symlinks, submodules, unsupported binary/types, and limit overflow.
It ignores dependency, VCS, cache, build, coverage, and Terraform working
directories. `.env`, credentials, keys, certificates, Terraform state, and other
sensitive filenames are never retrieved as import evidence. Secret-like values
and bearer/private-key material are redacted before storage or model use.

Deterministic Terraform and CloudFormation evidence flows through the Prompt 33C
importers. Only unresolved application-source relationships are sent to the
approved `repository.interpret` operation, using bounded sanitized excerpts and
deterministic Evidence. Responses require exact source references and bounded
confidence; ungrounded claims are rejected. Accepted model claims remain
observed-only and create reviewable ambiguity issues. Private repository content
uses tenant-isolated, no-cross-tenant-cache-or-training authority.

## Verification

Normal CI uses fake GitHub, importer, model, persistence, and reconciliation
adapters and never contacts GitHub or a model provider.

```powershell
pnpm check:e2e:github-import-refresh
pnpm check:repository-importer
pnpm check:model-gateway
pnpm check:backend
pnpm check:web
pnpm security:check
```

The Prompt 40B gate covers pinned commits, moved branches, revoked installation,
rate limits, path/symlink/size/secret attacks, deterministic Terraform and
CloudFormation imports, ambiguous inference, ungrounded model claims, immutable
refresh, approved-diagram comparison, review decisions, stale snapshots,
idempotency, and absence of direct default-branch writes.

Live import testing is opt-in only against a dedicated installation and a
disposable repository with no customer or production content. Use the existing
environment-injected App credentials described in
[GitHub App export testing](GITHUB_APP_EXPORT_TESTING.md), omit every write-test
variable, and inspect only a known pinned commit. Do not store a private key,
token, repository excerpt, or secret fixture in the repository or shell history.
