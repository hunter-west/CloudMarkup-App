# GitHub repository export

This package is the provider-specific GitHub App delivery boundary for one
already approved, immutable, verified Solution export artifact. It discovers
installation-authorized repositories, calculates a complete read-only preview,
then creates one feature branch, commit, and pull request after an explicit
approval and a fresh stale-state check.

It never accepts personal access tokens. App private keys and webhook secrets
are resolved by secret reference, and short-lived installation tokens stay
inside a disposable adapter session. The service cannot merge, force-push, write
the default branch, run workflows, execute repository content, use cloud
credentials, or deploy.

Workflow files are part of the reviewed artifact but are omitted unless the
caller explicitly selects them. Including them additionally requires an
already-granted GitHub App `workflows: write` permission and exact confirmation
of every previewed workflow digest. The package never changes App permissions.

The fake adapter is the normal automated-test authority. The REST adapter is
covered through deterministic HTTP fixtures; live verification is manually
enabled only for a dedicated test installation and repository.
