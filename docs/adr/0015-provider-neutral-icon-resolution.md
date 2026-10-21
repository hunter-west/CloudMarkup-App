# ADR-0015: Provider-neutral icon resolution

- **Status:** Accepted
- **Date:** 2026-07-25
- **Owners:** CloudCanvas product and engineering
- **Supersedes:** None
- **Superseded by:** None

## Context

Provider Catalog v1 gives every service a stable opaque `iconId`. It
intentionally stores no asset path, URL, loader, or image bytes. Official
provider files require provenance, integrity, usage, legal/trademark, security,
and deterministic-export controls under
[ADR-0008](0008-provider-icon-asset-pipeline.md).

Without a defined resolution boundary, React features could import AWS files
directly, derive filenames from service IDs, or create a second service-to-icon
map. That would couple features to one provider, bypass asset review, and make
historical diagram reproduction dependent on bundler or network state.

## Decision

CloudCanvas will resolve catalog `iconId` values through an injected,
provider-neutral, read-only `IconRegistry`.

The provider catalog remains the only service-to-`iconId` source. The registry
maps an exact opaque ID to either:

- an approved local asset from an exact versioned asset set; or
- a reviewed neutral placeholder with an explicit bounded reason.

Resolution is total and deterministic. It never derives a provider, filename,
service, or visual category from ID text. Duplicate registrations fail registry
construction. Missing, pending, withdrawn, rejected, or runtime-corrupt entries
resolve to the local placeholder and cannot change graph, validation,
compilation, authorization, or billing behavior.

The planned UI-facing generic interface is defined in
[Asset policy](../design/ASSET_POLICY.md#provider-neutral-iconregistry).
`packages/ui` owns that abstraction and the provider-neutral `ProviderIcon`
presentation. A future application composition root statically combines provider
registrations. React feature components receive the registry and catalog service
definition and never import provider-specific asset files.

Provider packages own separate strict asset manifests and approved local bytes.
Their catalog source and compiled artifact continue to contain only `iconId`.
Catalog runtime retrieval, asset URLs, dynamic module paths, and executable
loaders remain prohibited.

The web registry may resolve a UI asset handle. The deterministic diagram
renderer resolves sanitized SVG bytes from the same logical manifest identity.
Every diagram manifest pins the exact asset-set ID, version, and digest in
addition to the revision, catalog, renderer, layout, and font inputs.

Catalog icon IDs are compatibility identifiers. Updating approved bytes creates
a new asset-set version while preserving the ID. Renaming an ID is a provider
catalog change requiring a new catalog version/digest and compatibility or
migration decision.

Multiple icon IDs may resolve to the same official provider asset when provider
guidance permits. No synthetic subresource variant is created merely because the
catalog concepts are more specific than the official icon set.

Visible service names come from the catalog. Components pass that text as the
accessible name when the image conveys unique content or mark the image
decorative when adjacent text already names it. Icon shape, color, and provider
recognition are never the only service identification.

This ADR does not approve an AWS source, any provider mark, a final placeholder,
or an asset dependency. No registry or asset file is implemented by this
documentation task.

## Consequences

### Positive

- Feature code stays provider-neutral and uses the existing catalog identity.
- Asset review, runtime UI, and deterministic export have an auditable seam.
- Missing or withdrawn assets degrade safely without disabling architecture
  work.
- Stable IDs allow an asset set to evolve without rewriting saved documents.
- Future providers can register their own exact asset sets without changing
  feature components.

### Negative

- Registry, manifest, build verification, and historical asset retention add
  release work.
- The UI and renderer need different asset representations over one logical
  identity.
- Some catalog concepts will use neutral or shared official icons until an exact
  approved asset exists.
- Icon availability cannot be used as a shortcut for service-support status.

### Follow-up

- Specify and implement the strict asset manifest only after provider source and
  approval owners are named.
- Create the future provider asset public subpath and `packages/ui` registry
  through declared package exports; never use deep imports.
- Add exact catalog coverage, duplicate, unknown, integrity, local-only,
  placeholder, accessible-name, and deterministic-export tests.
- Preserve historical asset sets needed for eligible re-export, subject to legal
  withdrawal and retention policy.
- Decide the official AWS source, approval cadence, and final placeholder before
  provider-icon release.

## Alternatives considered

### Put asset paths in Provider Catalog v1

Rejected because the catalog is canonical semantic data, paths are build/runtime
details, and changing paths would alter its digest and saved-revision
compatibility.

### Import AWS assets directly in React features

Rejected because it creates provider coupling, bypasses the composition seam,
and prevents consistent placeholder and future-provider behavior.

### Resolve filenames from `iconId` or service ID

Rejected because namespace membership is not a file contract, upstream names can
differ, and inference bypasses explicit review.

### Fetch provider icons at runtime

Rejected by ADR-0008 because content, availability, provenance, privacy, and
determinism would be uncontrolled.

### Generate provider-like fallback art

Rejected because it creates recognition and trademark risk. The fallback is
deliberately provider-neutral.

## Compatibility, security, and rollback

This decision complements and does not supersede ADR-0008. Provider Catalog
contract version `1` remains unchanged. No tenant data, credential, network,
compiler, or deployment boundary is added. Future registry and manifest public
contracts require versioning and intentional compatibility evidence. If a
different rendering technology is chosen, it must still consume the same exact
opaque IDs, local approved manifests, pinned asset identity, and safe fallback.

## References

- [Asset policy](../design/ASSET_POLICY.md)
- [Design system](../design/DESIGN_SYSTEM.md)
- [Provider catalog development](../development/PROVIDER_CATALOG.md)
- [ADR-0004](0004-aws-first-provider-strategy.md)
- [ADR-0007](0007-deterministic-diagram-export.md)
- [ADR-0008](0008-provider-icon-asset-pipeline.md)
- [System overview](../architecture/SYSTEM_OVERVIEW.md)
- [Security principles](../architecture/SECURITY_PRINCIPLES.md)
