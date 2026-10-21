# Terraform validation runner instructions

- This package may execute only the fixed static-validation command matrix. It
  must never expose a general command runner, shell string, plan/apply path,
  provisioner, customer credential, network client, or customer-account lookup.
- Treat Terraform files and tool output as untrusted. Validate exact content
  digests, paths, provider/module sources, forbidden HCL constructs, limits,
  diagnostics, and Evidence before returning data.
- The local adapter must use a pinned container image, `shell: false`, an exact
  ephemeral workspace, no network, no privileges/capabilities, no host paths in
  output, and hard CPU/memory/process/output/time limits.
- Optional analyzers remain approved fixed configuration. Missing optional tools
  are explicit skipped diagnostics; artifacts cannot add binaries, arguments,
  configuration, plugins, or policy.
- Tests use fake executors. Do not run Terraform, Docker, providers, scanners,
  customer content, uploads, or deployment as part of ordinary repository tests.
