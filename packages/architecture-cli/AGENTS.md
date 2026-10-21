# Architecture CLI instructions

- Keep this package a thin, deterministic repository-orchestration boundary. It
  may not reimplement schemas, provider rules, Terraform rendering, application
  generation/build, diagram rendering, export packaging, or Evidence authority.
- Read-only commands never mutate the checkout. `generate` may write only a
  fully preflighted, manifest-declared generated change set and must fail closed
  on ownership ambiguity, baseline mismatch, links, non-regular files,
  traversal, case-fold collisions, or user-owned content.
- The CLI never invokes a shell, repository-selected binary, package script,
  network client, cloud credential, Terraform plan/apply, upload, or deployment
  operation. Executable adapters use fixed names plus argument arrays.
- Human and JSON output are bounded, deterministic, source-linked, and
  sanitized. Never expose raw tool output, prompts, tokens, secrets, temporary
  paths, or machine-local paths.
- Keep tests synthetic and credential-free. Process and execution boundaries use
  fakes in ordinary tests.
