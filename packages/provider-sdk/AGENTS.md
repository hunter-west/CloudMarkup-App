# Provider SDK instructions

These rules specialize the repository [instructions](../../AGENTS.md) for
`packages/provider-sdk`.

- This package owns provider-neutral, versioned provider-catalog contracts,
  deterministic source validation, and read-only catalog access.
- It may depend on public schema/domain contracts but neither `packages/domain`
  nor `packages/schemas` may depend on this package.
- Catalog artifacts are strict data. Do not accept executable templates,
  callbacks, module paths, runtime downloads, asset paths, credentials, or
  deployment commands.
- Keep serialized validator and migration descriptors separate from reviewed
  TypeScript implementations.
- Normalize semantically unordered collections before canonical serialization
  and hashing. Never use clocks, randomness, machine paths, source-file order,
  or network state.
- Fail closed on unknown contract versions, mapping declaration versions, broken
  references, and missing required migrations. Errors expose paths and bounded
  explanations rather than catalog values.
- Icon references are opaque IDs. Image provenance and files belong to the
  controlled asset pipeline, not this SDK.
- Contract changes require a plan plus compatibility, migration, or
  intentional-rejection evidence.

For SDK implementation changes, use `pnpm check:contracts` under the root
[verification cadence](../../AGENTS.md#verification-cadence).
