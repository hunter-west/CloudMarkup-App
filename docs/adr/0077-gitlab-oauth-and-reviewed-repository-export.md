# ADR-0077: GitLab OAuth and reviewed repository export

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Proposed
- **Date:** 2026-10-01
- **Owners:** Cloud Markup engineering
- **Supersedes:** None

## Context and decision

The post-beta product plan requires a second repository provider. Select
GitLab.com as the initial adapter. Preserve
[canonical repository authority](0025-canonical-solution-repository-and-evidence-contracts.md)
and the existing
[GitHub App connection](0042-github-installation-ownership-callback.md). Do not
represent GitLab OAuth as a GitHub installation or reuse its identifiers,
permissions, stored receipts or public contracts.

Use confidential authorization-code OAuth with S256 PKCE, unpredictable one-time
state and an exact registered HTTPS callback. The application must bind each
intent to its verified actor, session, workspace and expiry before exchanging a
code. Request `api`: GitLab's `write_repository` scope supports Git transport,
not the REST commit and merge-request APIs. Disclose that the OAuth grant covers
the user's API access; Cloud Markup's selected-project authorization is an
additional application restriction, not a narrower provider token. Verify token
information against the configured application, exact scope and active provider
user. Never accept pasted personal access tokens.

Store access/refresh credentials only as authenticated encrypted server-side
grant material, with tenant, connection, purpose and key-version binding. The
durable store and one-time callback composition are implemented locally;
production composition remains off without reviewed OAuth/secret/KMS identities.
Operational key management and activation remain incomplete. Refresh requires an
exclusive durable claim and a conditional replacement of the exact previous
grant version. GitLab refresh invalidates both prior tokens. An unknown refresh
outcome requires reconnecting, never automatic repetition with the old token.
Disconnect denies new application use immediately; provider revocation may need
separate recovery. No secret enters browser storage, ordinary database fields,
logs, analytics or AI input.

The application must approve one immutable export artifact, selected project,
base SHA, fresh `cloudmarkup/export-<128-bit-id>` branch and exact file changes.
Before writing, recheck current application authority, provider project access,
repository eligibility, source ownership and destination conflicts. Create a
single REST commit with the approved full `start_sha` and `force: false`. Never
use per-file `last_commit_id` as a branch compare-and-swap guarantee. GitLab
rejects an already existing destination branch in its service layer; Gitaly
conditionally updates from zero for a missing branch or the specified parent for
a branch observed concurrently. Thus a different concurrent head cannot be
overwritten. A concurrent creation at exactly the same base can pass that latter
comparison; this is not an unconditional atomic name reservation. Unique
application-owned names, durable attempts and readback remain mandatory.

Treat a returned commit as provisional. Verify its exact parent, intent marker,
branch head, complete tree, file modes, content hashes and approved artifact
bytes. GitLab can apply LFS/content transformations; changed bytes must fail
verification. A lost response preserves the attempt and uses read-only recovery;
absence alone never authorizes another write. Do not force-push, rebase, merge,
delete an existing branch, overwrite user-owned files or silently retry a
mutation. Create only a draft merge request after artifact verification.
Recovery can report a closed or merged request without reopening it.

Use the fixed `https://gitlab.com` origin, numeric project identity, a
ten-second operation budget including admission and streamed responses, bounded
pagination, body/entry/file limits, no redirects and no automatic network
retries. HTTP errors never carry provider bodies, tokens or source. All
credentials are server-owned; mutable buffers are cleared after use, although
JavaScript and HTTP serialization cannot guarantee erasure of every temporary
string.

## Encrypted grant storage contract

The API adapter uses KMS envelope encryption with a fresh AES-256 data key and
96-bit random GCM nonce per grant. A strict version-1 envelope stores only the
wrapped key, exact KMS key ARN, nonce, authentication tag, ciphertext and a
binding digest. The digest covers the configured OAuth application, workspace,
connection, actor, provider user and grant version in a fixed-order tuple. KMS
encryption context contains only the digest and a fixed purpose; raw tenant
identifiers and credentials never enter the context logged by CloudTrail.
AES-GCM additional authenticated data also binds the algorithm, key ARN and
wrapped key. A swapped grant or changed header cannot authorize decryption.

A server-configured exact symmetric key ARN controls new encryption. At most
three previous keys in the same account and Region can be explicitly retained
for reads during rotation. Aliases, cross-account/Region keys and keys selected
only from persisted data are rejected. Key rotation requires explicit
read-old/seal-new persistence under the existing conditional grant update; the
vault does not migrate or delete stored grants automatically. KMS key policy,
provisioning, rotation scheduling and live activation remain separate work.

The KMS SDK uses the derived fixed regional endpoint, one attempt and a
five-second deadline covering current-admission callbacks and the operation.
Current actor/session/connection authorization is rechecked before KMS, before
using returned key material and before returning a result. Caller inputs are
snapshotted before awaiting admission. Plaintext keys, decrypted temporary
buffers and consumed token material are cleared on success and failure; keys
arriving after cancellation are cleared too. JavaScript/runtime copies cannot be
guaranteed erased. Provider errors remain redacted. Crypto binding does not
replace persistent current-version/revocation checks or exclusive refresh
claims.

OAuth grants and decrypted credentials share one one-use token container. The
KMS client is API-owned and pinned to the existing AWS SDK family; Node's crypto
library supplies AES-GCM. Direct KMS Encrypt cannot hold the bounded maximum
two-token payload, and deriving a storage key from the OAuth client secret would
couple client-secret rotation with durable grant recovery. The local lifecycle
migration adds encrypted grant and callback-intent storage. No credential
provisioning, cloud permission or customer-repository write has been activated.

## Connection lifecycle composition

Each OAuth grant is actor-owned within its selected workspace. Current
membership permits workspace access but never delegates another actor's personal
GitLab grant. Management requires recent authentication; every operation checks
current account-session revocation and canonical workspace role under the same
SQL transaction as metadata access. No SQL locks span provider or KMS calls.

A ten-minute browser seal binds the exact application/callback, actor, session,
workspace, intent, state and PKCE verifier. The local browser flow returns to a
dedicated SPA callback and relays the code only in memory to the original
same-origin authenticated tab. Its protected completion POST consumes the
one-time database intent before exchanging a code. This adds no public API
callback or Cognito route exemption. Client-secret rotation expires in-flight
browser seals; durable KMS credentials remain readable with configured keys.
Five authenticated HTTP operations and the account/callback UI are implemented
locally. The callback tab never authenticates or submits completion itself.

A refresh claim is exclusive and tied to the exact grant version and initiating
session. Unknown refresh results require reconnection. A lost SQL
acknowledgement can recover only the exact committed next version and claim
identity. Disconnect denies new use immediately and preserves unresolved
provider revocation. When a refresh may have produced unobserved credentials,
revoking the old token cannot confirm full revocation; retain that uncertainty
for explicit provider-side recovery. Known-token revocation clears encrypted
material only after both known tokens have been revoked. Local migration 0091
and 74 composed PostgreSQL cases pass in an isolated synthetic schema; this is
not activation or live-provider acceptance.

A small database/API clock difference must not reject a valid intent or extend
its lifetime. The browser seal expires at the earlier of the durable database
expiry and ten minutes on the API clock. The database independently checks its
own deadline at every state transition. The browser UI permits thirty seconds of
display-clock skew; that never changes either server deadline.

## Alternatives and consequences

Self-managed GitLab hosts would require a separate host-registration and SSRF
policy and are outside this initial implementation. Personal tokens make secret
ownership and revocation less clear. A custom Git-over-HTTP writer could use the
narrower repository scope but adds pack/protocol and credential execution costs
and still needs separate merge-request authority. Generalizing the current
GitHub installation model would misrepresent OAuth permissions.

GitLab adds a durable secret lifecycle that the GitHub installation-token model
does not require. Connection and export activation must remain separate and
default off until persistence, current-authority callbacks, versioned routes,
UI, native/provider acceptance and operational key rotation are complete.
Existing GitHub contracts, graph mutations, compiler behavior and historical
receipts remain unchanged. Rollback disables GitLab admission while retaining
attempt/receipt history and the ability to revoke encrypted grants.

The adapter adds `[skip ci]` to its fixed commit message and requests no merge
or deployment. This does not prove that repository-owned hooks or policy-driven
automation will not run. The final export approval must identify repository
automation as a possible consequence of the external write. No live provider
write, OAuth registration, credential provisioning or deployment is part of
local implementation or synthetic tests.

## Verification and implementation status

The initial local adapter implements fixed-host transport, OAuth exchange,
refresh/revoke protocol, identity verification, bounded project/tree discovery,
pinned file/blob verification, fresh-branch commit creation and draft
merge-request operations with read-only acknowledgement lookup. Its connection
lifecycle is exposed through five authenticated route contracts and local
account UI. Production-root configuration is wired and defaults off; actual
OAuth/secret/KMS identities and provider-native acceptance remain required.
Durable approval, one-time dispatch receipts and complete artifact readback are
composed locally behind an independent default-off export gate. SHA-1 repository
IDs and portable ASCII paths are the initial supported subset; unsupported
inputs fail closed. Per-file content is limited to 1 MiB, one commit to 512
changed paths and 2 MiB of file content, and a tree to 20,000 entries.

Tests must cover denied/revoked current authority, cross-project substitution,
scope/application/user mismatch, refresh uncertainty, credential clearing,
stream/deadline limits, pagination, content corruption, branch races, modes and
unknown mutation outcomes. Provider-native concurrency and authentication
acceptance remain separate from synthetic HTTP evidence. All 108 existing
OpenAPI operations and 72 released SQL migrations remain unchanged; eleven
connection/project/export operations, one unreleased migration and the pinned
API-owned KMS dependency are additive. The combined API/real-PostgreSQL suite
passes 488 cases, all 355 contract cases pass, and focused web/routing checks
pass 57 cases. Desktop/mobile browser cases verify interrupted export recovery
and accessibility. Full integrated gates and provider-native acceptance remain
pending.

## References

- [GitLab OAuth protocol](https://docs.gitlab.com/api/oauth2/)
- [Access-token scopes](https://docs.gitlab.com/security/tokens/access_token_scopes/)
- [Commit API](https://docs.gitlab.com/api/commits/)
- [Repository files](https://docs.gitlab.com/api/repository_files/)
- [GitLab projects API](https://docs.gitlab.com/api/projects/)
- [Repository tree API](https://docs.gitlab.com/api/repositories/)
- [Merge requests](https://docs.gitlab.com/api/merge_requests/)
- [GitLab commit service](https://gitlab.com/gitlab-org/gitlab/-/raw/master/app/services/commits/create_service.rb)
- [Gitaly conditional reference update](https://gitlab.com/gitlab-org/gitaly/-/raw/master/internal/gitaly/service/operations/commit_files.go)

- [KMS data-key encryption](https://docs.aws.amazon.com/kms/latest/APIReference/API_GenerateDataKey.html)
- [KMS decryption](https://docs.aws.amazon.com/kms/latest/APIReference/API_Decrypt.html)
- [KMS encryption context](https://docs.aws.amazon.com/kms/latest/developerguide/encrypt_context.html)

The account UI links to GitLab's
[authorized applications](https://docs.gitlab.com/integration/oauth_provider/#view-all-authorized-applications)
for manual revocation when a refresh outcome is unknown.

## Selected projects and initial export review

Selected numeric project IDs are an additional application restriction owned by
the connecting actor/workspace. Versioned enable/remove commands use optimistic
concurrency and an atomic audit record. Enabling requires fresh provider access,
a non-archived non-empty repository, Developer access or higher and the exact
grant version used for that check. Removing access advances the version; later
reselection cannot revive an old approval. Retained disabled history is paged,
and at most 100 projects are active per connection. Every eventual export must
recheck that selected version and current provider authority.

The local artifact review helper is deliberately creation-only within a fresh
portable directory. Existing files, symlink ancestors and case aliases block
that destination. It verifies the immutable artifact, predicts the complete Git
tree and checks provisional commit parent/marker, unchanged content, file modes
and exact exported bytes. Native Git is an independent object-hash oracle in
isolated synthetic tests. The helper is composed with durable approval/receipt
state and provider-write authorization. It grants no export authority
independently.

## Resumable reviewed exports and repository entitlement alias

The local export store now records immutable actor/workspace/project/artifact
and selected-project bindings, a 15-minute approval, one-time commit and
draft-MR dispatch claims, and compare-and-swap verification progress. A provider
dispatch is never reset, even when its response is lost. Subsequent calls
recover through reads. No transaction holds SQL locks during provider I/O.

Each request advances one stage. Exact commit/tree proof precedes contiguous
batches of at most 16 exported files, with at most four reads in flight. The
browser can resume that stored progress after an interruption; no background
worker or new deployment authority is introduced. New writes require unexpired
approval and current session, project, selected version, entitlement and
retained artifact admission. Expiry permits read-only recovery but cannot
authorize a new merge request. An unresolved branch or MR remains visible for
manual review; a missing provider acknowledgement never authorizes another POST.
The composed provider scope must bound the whole request step, drain in-flight
reads and clear token material before returning.

Version 1 of the application repository-export policy treats the released
`github-export` commercial feature as a legacy alias for both GitHub and GitLab
repository export. Existing prices, credits, plan versions and historical
commercial keys remain unchanged. Only the current evaluated entitlement for the
same active workspace/billing account and active subscription is accepted, with
the expensive-operation control enabled. Staff or purchased credits alone cannot
confer this feature. This admission is separate from current GitLab
project/grant authority and from the default-off provider activation control.
