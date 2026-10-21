# ADR-0020: Separate stable docks and model owned configurations as graph concepts

Complete [the ADR-writing checklist](CHECKLIST.md) before acceptance.

- **Status:** Proposed
- **Date:** 2026-08-02
- **Owners:** Cloud Markup maintainers
- **Supersedes:** None
- **Superseded by:** None

## Context

Architecture edges already store exact semantic source and target ports. The web
editor currently reuses those port IDs as React Flow handle IDs and mounts each
handle inside a scrollable technical-port row. React Flow remeasurement after a
row scroll moves the visual endpoint even though the Architecture Document is
unchanged.

Semantic ports also carry a broad connection category, but that category is part
of rule compatibility and is too coarse to define stable node-boundary
placement, mixed associations, menu copy, or visual grouping. Putting visual
dock metadata into the digest pinned by an Architecture Document would also let
a display-only change perturb the document content hash.

IAM behavior has a second ownership problem. Role trust is represented in role
configuration and connection effects; DynamoDB permission is represented as a
connection effect, preview requirement, and generated policy-statement node;
logging permission is currently only an effect and preview. The current policy
statement configuration cannot represent policy kinds, multiple statements,
principals, IAM conditions, or several resource references.

Cloud Markup must retain exact graph identity, fail-closed compatibility, atomic
Graph Commands, generated-resource provenance and adoption, provider neutrality,
assistance-only modes, compiler target honesty, and the no-deploy boundary.

## Decision

Cloud Markup will use four distinct but joined contracts.

1. **Semantic provider catalog.** Semantic ports and connection rules remain the
   compatibility and mutation authority. Port cardinality has an explicit
   required state and aggregate `one`/`many` maximum, with exact provider-rule
   constraints retained separately. No dock or policy projection becomes
   compiler or deployment truth.
2. **Provider presentation artifact.** A separately versioned and digested
   presentation artifact assigns every semantic port to exactly one stable dock
   and supplies label, description, side, order, direction policy, assistance,
   and relationship copy. It references an exact semantic catalog digest but is
   not pinned by the Architecture Document and is never compiler input.
3. **Provider service-extension artifact.** A second separately versioned,
   exact-catalog-bound artifact declares service-level and target-specific
   readiness plus owned-configuration slot identity, kind, graph relationship,
   range cardinality, lifecycle/adoption policy, allowed policy kinds, and
   Guided/Professional assistance. It is reviewed metadata over catalog and
   graph facts, not a persisted attachment collection or renderer claim.
4. **Architecture graph.** Owned configurations are node-backed supported
   architecture concepts, not a second top-level attachment store. A policy
   document is one non-canvas configuration node with a stable ID, exact owner
   slot, semantic name and kind, and lifecycle. Its statements and conditions
   are typed child configuration nodes; graph or explicit resource scopes use
   typed configuration values and exact relationships. Existing Graph Command
   node/edge/configuration, lifecycle, provenance, adoption, validation
   location, normalization, and hashing boundaries therefore remain reusable.
   Non-deployable configuration concepts remain in the document and semantic
   hash but are projected through their owner instead of appearing as normal
   palette entries, canvas cards, or architecture-tree resources. These
   graph-only concepts may explicitly omit an icon ID; deployable services and
   visible boundaries still require exact approved icon registrations, and an
   internal concept never borrows another service's icon identity.

An owned-configuration attachment ID is its policy/configuration node ID. The
owner and slot come from one validated provider-declared relationship; any
semantic parent must agree with that relationship. Deployment-relevant display
names are stored in semantic configuration, while canvas labels remain visual.
Generated and user-owned configurations use the existing lifecycle union and
cannot share cleanup authority.

One canonical policy projection will assemble a policy document from its typed
document, statement, condition, principal, and resource facts. Policy kind
(`identity-inline`, `trust`, `resource`, `generated-permission`, or
`service-grant`) is distinct from statement effect (`allow` or `deny`).
Connection IAM declarations are deterministic templates for materializing this
canonical graph representation; previews and summaries derive from that
representation rather than becoming another policy truth.

The editor maps exact semantic ports to dock handle IDs only at the React Flow
boundary. Architecture edge data retains the exact ports. Starting from a dock
performs node-scoped compatibility discovery filtered to that dock's ports; the
reviewed candidate supplies the exact endpoints before a Graph Command is
created. Menus, highlights, fan-out ranks, zoom treatment, and open state are
presentation state only.

Accepted provider presentation artifacts are strictly directional: an input-only
dock is on the left, an output-only dock is on the right, and a mixed-direction
dock is rejected and must be split. The editor renders every catalog-declared
directional dock as a compact blue boundary dot. A filled dot has a reviewed
compatible action; a hollow dashed dot is informational and cannot create an
unsupported relationship. The visible dot is centered over the shared React Flow
handle, while its transparent keyboard/pointer target keeps the design-system
action size, expands to at least 24 rendered pixels at small canvas zoom, and
keeps any nonzero edge count visible. Hover or keyboard focus exposes a shared,
side-positioned tooltip named `Input: <group>` or `Output: <group>`. It is
linked to the trigger, remains hoverable, dismisses with Escape, scales
inversely with canvas zoom, and is suppressed while the richer grouped surface
is open. This transient label is presentation state only and does not restore
persistent perimeter pills.

Grouped connection content is portaled outside the transformed canvas and fixed
beside its owning service. It follows the selected dot vertically, flips sides
when space requires it, clamps to the viewport gutter, and tracks pan, zoom, and
drag without becoming an edge anchor or graph fact.

Provider readiness will separately report modeling, configuration, validation,
Terraform, CloudFormation, and generated-code support with precise reasons.
Existing IaC mappings remain metadata-only until their later compiler prompts.

Architecture Document v2 and Graph Command v1 remain current while the
node-backed representation is sufficient. If a required owned configuration
cannot be represented through typed configuration concepts without ambiguous or
duplicated meaning, a later reviewed ADR amendment must introduce Architecture
Document v3 and Graph Command v2 rather than changing strict v1/v2 artifacts in
place.

## Consequences

### Positive

- Scrolling, expanding, mode wording, and menu state cannot move an edge or
  change architecture semantics.
- Several exact semantic edges can share one stable visual dock while remaining
  individually selectable, editable, and removable.
- Display-only grouping can evolve without changing compiler input or semantic
  document hashes.
- Policy name, kind, statements, conditions, scope, ownership, provenance, and
  readiness have one reviewable representation.
- Existing atomic node/edge commands and generated cleanup guarantees remain
  applicable; no parallel attachment command engine is introduced.
- Future services can declare docks and owned configuration slots without a
  service-specific React component.

### Negative

- The provider toolchain must compile and bind two artifacts and reject a
  presentation artifact that targets the wrong semantic digest.
- Hidden graph concepts make policy projection and validation more involved than
  one nested JSON value.
- Existing IAM graph shapes require a precise provider-owned upgrade and
  compatibility fixtures; generic domain migration cannot infer AWS meaning.
- Direct React Flow drag between ambiguous grouped docks must enter candidate
  review instead of treating a handle ID as a port ID.

### Follow-up

- Add semantic catalog and presentation contract versions, deterministic
  compilation, total port-to-dock validation, and generated artifacts.
- Add explicit range cardinality, owned slots, policy kinds, concise
  relationship labels, and target readiness for all current AWS definitions.
- Add an exact AWS catalog-bound upgrade that preserves existing node and edge
  IDs, policy ownership, provenance, and semantic ports or fails with a precise
  diagnostic.
- Materialize trust, DynamoDB, log, and Lambda invocation permission through the
  canonical policy graph; keep custom policies outside generated cleanup.
- Add shared dock/menu and policy projections, structured UI, stories, browser
  regression evidence, and target-specific export findings.
- Update later compiler prompts to consume the canonical policy projection.

## Alternatives considered

### Keep one visual handle per semantic port

External fixed per-port handles would correct scrolling but would leave large
service cards crowded, expose every future capability, and fail the grouped menu
and shared-dock requirements. Reconsider only for a service with a small,
explicitly justified one-to-one presentation.

### Reuse semantic connection category as the dock

Current categories are validated as connection semantics and lack placement,
order, direction policy, exclusivity, assistance, and identity-specific
grouping. Reconsider only if a future semantic contract proves category and
presentation have identical lifecycle and hash requirements.

### Store docks in the Architecture Document or semantic catalog digest

That would make a visual regrouping change content hashes or require document
migration despite identical infrastructure meaning. It is rejected.

### Add a top-level `attachments[]` collection

This would require Architecture Document v3, Graph Command v2, new validation
locations, lifecycle/reference accounting, and migration of existing policy
nodes. Leaving old nodes beside the new array would create two truths.
Reconsider only when a required configuration cannot be represented safely as
typed graph concepts.

### Store complete policies as arbitrary JSON

Raw JSON weakens schema-driven editing, resource references, wildcard and
principal validation, deterministic normalization, and Guided safety. It is
rejected as the default representation and editor.

## References

- [Product specification](../product/PRODUCT_SPEC.md)
- [Domain model](../architecture/DOMAIN_MODEL.md)
- [System overview](../architecture/SYSTEM_OVERVIEW.md)
- [Testing strategy](../architecture/TESTING_STRATEGY.md)
- [Security principles](../architecture/SECURITY_PRINCIPLES.md)
- [Provider catalog guide](../development/PROVIDER_CATALOG.md)
- [UI specification](../design/UI_SPEC.md)
- [ADR-0001](0001-versioned-architecture-graph.md)
- [ADR-0003](0003-deterministic-compiler-boundary.md)
- [ADR-0004](0004-aws-first-provider-strategy.md)
- [ADR-0006](0006-guided-professional-shared-semantics.md)
- [ADR-0018](0018-shared-editor-presentation-and-assistance-only-modes.md)
- Execution plan (private historical evidence, omitted from this distribution)
