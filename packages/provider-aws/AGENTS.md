# AWS provider instructions

These rules specialize the repository [instructions](../../AGENTS.md) for
`packages/provider-aws`.

- This package implements AWS catalog data through `@cloudmarkup/provider-sdk`;
  it cannot change provider-neutral domain meaning or create a reverse
  dependency from the domain.
- Extend one current catalog during pre-live beta; do not freeze a predecessor
  snapshot for each service wave. Keep the current artifact canonical,
  digest-bound, and generated from reviewed, statically imported files. Runtime
  network retrieval and dynamic module loading are prohibited.
- A service or relationship is not supported until every item in the
  [curated-support rule](../../docs/product/MVP_SCOPE.md#curated-support-rule)
  has evidence. Proof/example entries must remain visibly marked `proof`.
- Catalog semantic code cannot import AWS SDK/CDK clients, credentials,
  persistence, network clients, UI state, model clients, or IaC renderers.
- Validator and migration implementations are reviewed TypeScript registrations.
  Catalog artifacts contain descriptors only and never module paths, callbacks,
  or executable templates.
- Terraform and CloudFormation declarations are mapping metadata, not
  compilation or deployment behavior. `implemented` requires corresponding
  reviewed compiler evidence.
- Icon references are opaque IDs only. Official files enter through the
  separately reviewed asset pipeline.
- Reuse synthetic fixtures and deterministic negative evidence for affected
  behavior. Historical compatibility expansion requires an explicit supported
  consumer need. Never use customer data, credentials, real account identifiers,
  or sensitive architectures.

For catalog changes, use `pnpm check:contracts`; add `pnpm check:assets` for
provider icon/catalog asset changes under the root
[verification cadence](../../AGENTS.md#verification-cadence).
