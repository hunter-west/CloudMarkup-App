# Application build runner instructions

- This package is the only local application execution boundary. It may run only
  the exact generated Node.js 24/TypeScript command matrix; never expose a
  general command runner, shell string, package script, deployment operation,
  credential, customer-account lookup, or network client.
- Treat source, lock metadata, dependency bytes, tool output, and produced files
  as untrusted. Bind exact Solution Revision, generator/build envelope, source,
  package, lock, tool, cache, and image digests before execution.
- The local adapter must use a pinned unprivileged container, `shell: false`, an
  exact disposable workspace, network denied, no capabilities, no host paths in
  returned data, and hard CPU/memory/process/file/output/time limits.
- Generated tests may execute only for an exact conflict-free deterministic
  notes source result, an exact reviewed curated-event source result, or the
  exact HTTP_NO_CONTENT_RELEASE_V1 tuple for the explicit authenticated
  no-content handler. User-provided source is disabled by default; the explicit
  safe profile is static-only and cannot emit a deployable artifact or
  successful complete coverage Evidence.
- Packaging accepts only regular allowlisted outputs, excludes tests, source
  maps, caches, environment files, credentials, and user-owned extension code,
  and produces a deterministic content-addressed Lambda ZIP.
- Tests use fake executors except the explicitly reviewed generated-notes and
  generated-curated-event and generated-http-no-content integration harnesses.
  Those harnesses may use only pinned repository-local Node.js tools and
  reviewed local SDK stubs. Do not run Docker, fetch packages, upload artifacts,
  access AWS, or deploy in ordinary repository tests.

## Explicit fixed host repair controls

The separate host-repair-seed subpath admits only the exact reviewed fixed host
recipe and its one bound extension. Its artifacts have host-only ownership and
cannot enter normal exports or coverage Evidence. Preserve every historical
profile restriction above. Ordinary tests use fake sessions; actual native RAM
execution is restricted to the separately reviewed credentialless proof.
