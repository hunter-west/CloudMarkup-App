# Solution export package instructions

- Keep this package pure, deterministic, local, and provider-neutral at the
  assembly boundary. Provider-specific rendered bytes arrive only as immutable
  artifact inputs.
- Never add filesystem writes, repository mutation, network clients, cloud SDKs,
  credential access, child processes, Terraform execution, package managers,
  source execution, build behavior, upload, or deployment.
- Treat every path, byte sequence, manifest, artifact, and diagnostic as
  untrusted. Fail closed on ownership ambiguity, content-address mismatch,
  unsafe archive metadata, secret/local material, or bounds violations.
- ZIP output must be byte-reproducible and independently verified. Do not use
  ambient timestamps, machine paths, locale ordering, random IDs, or platform
  filesystem metadata.
- Ordinary tests are read-only. Keep synthetic fixtures credential-free and run
  the focused solution-export gate before handoff.
