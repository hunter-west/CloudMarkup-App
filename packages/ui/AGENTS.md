# UI package instructions

These rules specialize the repository [instructions](../../AGENTS.md) for
`packages/ui`.

- This package owns provider-neutral semantic design tokens, density profiles,
  accessible primitives, and reusable presentation components.
- It must not own or reproduce graph, command, revision, validation, provider,
  authorization, billing, usage, AI, compiler, credential, cloud, or deployment
  behavior.
- Keep public exports small and intentional. Applications consume this package
  only through declared package exports; package consumers must not deep-import
  source files.
- Components communicate meaning with visible text and semantics in addition to
  color or shape. Keyboard interaction and deterministic focus restoration are
  part of the component contract.
- Guided and Professional modes share component geometry, disclosure defaults,
  controls, and semantic state. They may differ only in accurate assistance or
  explanatory wording supplied outside this package; exact evidence remains
  available through shared Technical details and inspector surfaces.
- Runtime code may depend on React only. Do not import provider assets, provider
  SDKs, application features, remote resources, or third-party component
  libraries.
- Keep tests synthetic and user-observable. Use roles, names, keyboard input,
  and focus assertions instead of implementation details.

For UI implementation changes, use `pnpm check:web`; add `pnpm check:storybook`
for component/story changes and `pnpm check:e2e` for browser interaction changes
under the root [verification cadence](../../AGENTS.md#verification-cadence).
