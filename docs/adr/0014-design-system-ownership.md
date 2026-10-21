# ADR-0014: Provider-neutral design-system ownership

- **Status:** Accepted
- **Date:** 2026-07-25
- **Owners:** CloudCanvas product and engineering
- **Supersedes:** None
- **Superseded by:** None

## Context

The application shell, editor, settings, billing, code review, and export
experiences need consistent tokens, accessible interaction, and reusable
components. If each feature owns raw colors, density, focus, node status, or
provider rendering, Guided and Professional modes will drift and visual choices
will begin to duplicate domain or provider rules.

The current repository has a minimal web foundation and no `packages/ui`
workspace. The durable ownership direction is needed before introducing a
component library or UI dependencies.

## Decision

A planned provider-neutral `packages/ui` workspace will own the CloudCanvas
design-token contract, density profiles, accessible primitives, composite
presentation components, action-icon wrappers, provider-icon abstraction, and
component-isolation fixtures.

`packages/ui` will expose declared public exports. It may consume public,
read-only domain, schema, or provider SDK types needed to render data, but it
cannot own or recreate:

- Architecture Document, graph command, lifecycle, or revision semantics;
- provider services, ports, placement, connection, validation, education,
  support, region, or compiler-mapping facts;
- authorization or tenant policy;
- billing entitlement or usage truth;
- AI acceptance rules; or
- compiler, diagram, cloud, credential, or deployment behavior.

`apps/web` owns application composition, routing, API integration, feature
orchestration, and responsive page layout. It consumes `packages/ui` and exact
version-bound product/provider contracts. Provider packages own approved
provider asset manifests and bytes. Feature components receive provider-neutral
registries and catalog data; they do not deep-import provider files.

Semantic token names are the stable interface. Provisional raw values are
defined in [Design system](../design/DESIGN_SYSTEM.md) and may be tuned after
measured evidence. Guided and Professional modes select comfortable or compact
density and disclosure while sharing the same semantic status, focus, selection,
and accessibility roles.

CloudCanvas brand assets remain separately owned under the
[Asset policy](../design/ASSET_POLICY.md). Provider assets do not become design
tokens or CloudCanvas brand material.

Diagram rendering may consume the same named visual roles, but it uses a pinned,
versioned deterministic renderer, font set, and asset set. A browser CSS value
or runtime component tree is not an export contract.

This is an ownership decision only. It adds no package, tokens, components,
dependencies, Storybook, or renderer in the current task.

## Consequences

### Positive

- One visual vocabulary serves shell, editor, review, billing, and export.
- Mode and feature teams cannot silently redefine severity, lifecycle, or focus.
- Provider-specific presentation remains behind an explicit adapter.
- Accessibility fixes can be made once at the owning primitive and verified
  across representative states.
- Provisional brand values can change without renaming semantic roles.

### Negative

- `packages/ui` becomes a reviewed shared dependency with compatibility cost.
- Feature-specific shortcuts must wait for or contribute to shared primitives.
- Browser components and deterministic export rendering still need separate
  implementations and evidence.
- Token evolution requires visual-regression review and release notes where
  output changes.

### Follow-up

- Create `packages/ui` only in the authorized UI milestone and apply a
  package-local `AGENTS.md`.
- Define public token/component exports and dependency direction before feature
  imports.
- Implement the state matrix in
  [Design system](../design/DESIGN_SYSTEM.md#representative-component-state-matrix).
- Apply [ADR-0015](0015-provider-neutral-icon-resolution.md) to provider icons.
- Add component isolation and visual evidence under
  [ADR-0016](0016-component-isolation-and-visual-testing.md).
- Version diagram visual inputs independently of browser implementation.

## Alternatives considered

### Keep all UI primitives inside `apps/web`

Rejected because feature ownership would obscure the reusable token,
accessibility, icon, and component boundary and make later renderer or product
surfaces harder to audit.

### Let provider packages export React components

Rejected because it would couple provider semantics and assets to one UI
framework, encourage feature-level provider imports, and make multi-provider
composition inconsistent.

### Let each feature own its own tokens

Rejected because status, focus, density, and accessibility behavior would drift
and modes could become semantically misleading.

### Use browser CSS as the diagram-renderer contract

Rejected because deterministic export requires pinned renderer, layout, font,
and asset inputs independent of transient browser state.

## Compatibility, security, and rollback

There is no existing UI package or persisted visual contract to migrate. Future
public exports require compatibility evidence. Provider, tenant, secret,
compiler, and deployment boundaries do not change. If the package boundary
proves unsuitable before release, a new ADR may relocate the implementation
while preserving provider neutrality and semantic token ownership.

## References

- [Design system](../design/DESIGN_SYSTEM.md)
- [Asset policy](../design/ASSET_POLICY.md)
- [Guided and Professional modes](../design/GUIDED_AND_PROFESSIONAL_MODES.md)
- [Accessibility](../design/ACCESSIBILITY.md)
- [ADR-0004](0004-aws-first-provider-strategy.md)
- [ADR-0006](0006-guided-professional-shared-semantics.md)
- [System overview](../architecture/SYSTEM_OVERVIEW.md)
- [Testing strategy](../architecture/TESTING_STRATEGY.md)
