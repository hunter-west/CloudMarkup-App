# Repository provider readiness at live 3a9a3c33

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

This source-backed checkpoint distinguishes deployed schema from enabled
runtime. It authorizes no credentials, provider grants, repository writes or
deployment.

| Provider  | Installed source                                                                                                                                                                                             | Readiness and next bounded checkpoint                                                                                                                                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitLab    | Production connection/project/reviewed-export composition exists; source-reviewed beta OAuth/key profile is null. Connection and export flags are separate and fail closed.                                  | Disabled. Owner/group choice, reviewed OAuth scope/application, exact secret/KMS configuration and provider-native acceptance remain required. No import capability is inferred from export source.                                                              |
| Bitbucket | Live main contains only the provider's 0095 persistence migration; connection/import/UI/queue/retention source remains in isolated draft PR60 (private historical evidence, omitted from this distribution). | Disabled and unmerged. First reconcile that existing draft with exact live source; then finish bounded production parser/queue hosting and durable retention cursor. Reviewed export and provider-native immutable identity/concurrency proof remain unfinished. |
| Terraform | 0094 schema is in the installed prefix; schema and catalog mapping presence establish no hosted provider execution.                                                                                          | Preserve existing disabled activation and dedicated execution-isolation acceptance. No plan/apply or provider download is performed.                                                                                                                             |

## Migration reconciliation

Direct inspection of source `3a9a3c330f5060aca769400f457ef00a9c8d7fc8` finds 78
manifest entries through 0096. Manifest SHA-256 is
`61a4f1c86e806ad067162251629419445c4facfccfef5b8cba07033d24edfd5a`. The last
ordered entries are GitLab/billing predecessors followed by 0093 live Stripe
provenance, 0094 hosted Terraform validation submissions, 0095 Bitbucket OAuth
connections and 0096 project cleanup precommit admissions.

Bitbucket 0095 SHA-256 is
`1726be28655d7d0d4fba5723760a74b32c73da53ab8b6a8c4b62cbb271a01041`. The draft's
older migration-order reservation is resolved by this installed prefix; do not
renumber, recreate or insert older SQL. Release-owner live readback already
reports 0096/78. This task inspected source and performed no database/cloud read
or mutation.

## Bounded continuation

Read-only PR metadata confirms PR60 is open, draft and unmerged at
`68d7900016824bfd74e334707ab736ce9943fb1e`, against its old `f74b1845` base. A
local merge-tree preview against exact live `3a9a3c33` reports **62 conflicting
files**. The preview creates no merge, index or checkout changes. Conflicts
include the migration manifest and native fixtures, production
composition/cleanup/export, `EditorRoute`, platform delivery/migrator tests and
protected release gates. A blind merge of the historical 180-file draft is
unsuitable for this small batch; preserve the live prefix and current admission
controls during explicit reconciliation. The complete source-bound path
inventory is retained in the task's `bitbucket-live-merge-preview.json`.

Reconcile PR60 before composing its production host. The draft has focused FIFO
admission and metadata-only expiry components; they do not constitute an
installed scheduler/parser/queue host. Avoid importing the entire historical
draft merely to make a capability visible. Its reviewed export writer is
unimplemented; local Git create-only experiments do not prove Bitbucket-native
addressing, rename/transfer handling or uncertain-outcome recovery.

GitLab's existing startup tests cover disabled secret resolution, ambiguous
flags, null/invalid profile refusal, wrong account/Region, strict profile shape
and canonical per-role capabilities. Retain those controls through release.
Provider configuration and native acceptance need separate authority; no
permission expansion is part of this batch.

## Deployment and rollback

This checkpoint adds no production provider source, dependency, SQL or HTTP
operation. Both providers remain disabled; no new deployment input is requested.
For any later admitted host, retain distinct connection/import/export flags,
disabled-first rollout, current tenant/session/lease checks, prior grant-key
readability and uncertain-write recovery. Roll back by closing provider gates
before replacing source; preserve persistence and audit history.

The active batch plan owns local evidence and the sole release owner owns
combined admission.
