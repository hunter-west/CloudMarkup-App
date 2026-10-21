# Testing GitHub App repository export

## Automated tests

Normal CI is entirely fake or request-fixture based. It does not contact GitHub.

```powershell
pnpm --filter @cloudmarkup/github-repository-export type-check
pnpm --filter @cloudmarkup/github-repository-export test
pnpm exec vitest run --project api-contract
pnpm exec vitest run --project api
pnpm --filter @cloudmarkup/platform test
```

The package suite covers App JWT and minimum-permission installation-token
requests, token disposal, discovery, complete preview, default/protected/
existing branches, ownership, stale files and merge base, path attacks, workflow
permission and exact confirmation, generator/lock warning, binary policy,
webhook HMAC/replay/allowlists/lifecycle and failed-delivery reclaim, rate
limits, lost commit/PR responses, idempotent retry, revocation, and absence of
default-branch, merge, workflow-run, credential, or deployment authority.

The API suite covers strict no-token installation input, authenticated routes,
canonical list envelopes, idempotency, workflow confirmations, safe disabled
webhook behavior, migration checksums, tenant-scoped storage, replay evidence,
audit, and progress. Platform tests cover enabled-only secret references,
least-privilege IAM, and the explicit unsigned-at-gateway but HMAC-verified
GitHub webhook route.

## Human fake-adapter script

1. Run the package suite and confirm the live tests are skipped.
2. In the primary success test, inspect the preview and verify architecture,
   workload, external-resource, IaC, manifest/lock, Evidence, workflow, and
   ownership entries are visible before execution.
3. Verify `main` retains only its original customer file while the feature
   branch receives the package and one PR is recorded.
4. Run the workflow-omitted case. Confirm no session asks for workflow
   permission and the preview contains `workflow-files-omitted`.
5. Run the workflow-denied case. Confirm `workflow-permission-unavailable`, no
   permission expansion request, no branch, and no PR.
6. Run collision, stale-state, protected/existing branch, binary, revoked,
   retry, webhook replay, repository deletion, and transfer cases. Confirm each
   leaves the default branch unchanged.
7. Inspect stored SQL statements. Confirm there is no token, key, credential,
   signature, or raw webhook body.

## Opt-in dedicated GitHub live tests

Never use a personal access token. Create a dedicated GitHub App installation
and a disposable repository containing no customer or production content. The
App needs Metadata read, Contents read/write, and Pull requests write. Do not
grant Workflows permission for the default live write test.

The first gate is read-only discovery. Set these values only in the local test
process or an approved secret-injection environment; do not write the private
key to a repository file or shell history.

```text
CLOUDMARKUP_GITHUB_LIVE_TEST=1
CLOUDMARKUP_GITHUB_LIVE_ACK=dedicated-test-installation-and-repository
CLOUDMARKUP_GITHUB_LIVE_APP_ID=<numeric App ID>
CLOUDMARKUP_GITHUB_LIVE_INSTALLATION_ID=<numeric installation ID>
CLOUDMARKUP_GITHUB_LIVE_PRIVATE_KEY=<injected PEM value>
CLOUDMARKUP_GITHUB_LIVE_REPOSITORY_OWNER=<exact dedicated owner>
CLOUDMARKUP_GITHUB_LIVE_REPOSITORY_NAME=<exact dedicated repository>
```

Run only the live file:

```powershell
pnpm exec vitest run --project github-repository-export github-live.integration.test.ts --reporter=verbose
```

The read-only test requests Metadata/Contents read and confirms the exact
allowlisted repository and its default branch. It returns no token.

The manually enabled write test uses the configured dedicated installation ID
only inside the test harness. It creates a real service intent, then a
`FakeGitHubInstallationLinkCallbackVerifier` supplies a test-only receipt bound
to the returned state and that installation. This keeps the export smoke on the
secure completion API, but it is not production callback-proof evidence. A live
callback-host/verifier test remains unavailable until that adapter is composed.

For the full package test, additionally set the following. Use a new unique
feature branch and empty destination on every run.

```text
CLOUDMARKUP_GITHUB_LIVE_WRITE_TEST=1
CLOUDMARKUP_GITHUB_LIVE_BASE_BRANCH=main
CLOUDMARKUP_GITHUB_LIVE_FEATURE_BRANCH=cloudmarkup-live/<unique-run-id>
CLOUDMARKUP_GITHUB_LIVE_DESTINATION_FOLDER=cloudmarkup-live/<unique-run-id>
```

The write-enabled test generates a deterministic immutable package, previews the
exact diff, deliberately omits workflow files and workflow permission, rechecks
stale state, creates one feature branch/commit/PR, and stops. It does not merge,
run a workflow, use credentials, or deploy.

After the test:

1. Inspect the PR file and semantic diff, package manifest, relative diagram
   links when present, commit parent, and feature/base refs.
2. Confirm the default branch did not move and no workflow ran.
3. Confirm the App installation audit shows only the expected short-lived token
   requests and minimum repository permissions.
4. Close the test PR and delete its feature branch manually after review. The
   test intentionally does not perform cleanup mutation.
5. Unset the private-key environment value and rotate/delete the dedicated test
   secret if required by the test environment policy.

Live tests are absent from normal CI and must never target a production or
customer repository.
