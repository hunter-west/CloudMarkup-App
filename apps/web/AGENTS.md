# Web instructions

These rules specialize the repository [instructions](../../AGENTS.md) for
`apps/web`.

- Treat the web app as a presentation and interaction adapter. Semantic
  mutations must use public domain operations; do not duplicate graph,
  validation, tenancy, or provider rules in React state.
- Coordinates, grouping, labels, and visual layout cannot affect deployment
  semantics or stable resource identities.
- Consume other workspaces only through declared package exports. Use versioned
  API contracts for server communication.
- Build accessible behavior first: semantic roles/names, keyboard and focus
  paths, visible errors/status, and no color-only meaning.
- Test user-observable behavior with the shared Vitest/React Testing Library
  setup. Avoid brittle DOM, implementation-detail, and React Flow internal
  assertions.
- Extend the existing authentication, React Flow and server-state boundaries
  through their current owners. New product workflows require an authorized
  scope and matching contracts.

For web implementation changes, use `pnpm check:web`; add `pnpm check:storybook`
for shared editor/component story changes and `pnpm check:e2e` for browser
interaction changes under the root
[verification cadence](../../AGENTS.md#verification-cadence). Review with the
web-accessibility, contracts, security, and generated-files sections of
[CODE_REVIEW.md](../../docs/engineering/CODE_REVIEW.md).
