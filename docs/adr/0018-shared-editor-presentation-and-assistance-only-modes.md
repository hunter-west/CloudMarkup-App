# ADR-0018: Shared editor presentation and assistance-only experience modes

- **Status:** Accepted
- **Date:** 2026-08-01
- **Owners:** CloudCanvas product and engineering
- **Supersedes:** ADR-0006 only for mode-specific editor density, control
  layout, workflow staging, and disclosure defaults
- **Refines:** ADR-0014 and ADR-0016
- **Superseded by:** None

## Context

Guided and Professional were introduced as presentations over one semantic
architecture model. ADR-0006 correctly requires the same document, commands,
validation, revisions, compiler inputs, exports, authorization, and
entitlements, but it also assigns denser controls, keyboard-oriented workflows,
and advanced-configuration access to Professional. ADR-0014 correspondingly
allows modes to select comfortable or compact density, and ADR-0016 names
Guided/Professional density as a visual-test dimension.

The bounded M1 editor exposed the cost of that presentation split. The same task
acquired different component branches, field grouping, disclosure defaults,
dialog stages, action placement, and geometry. Switching modes could therefore
remount stateful controls, move actions, or teach two interfaces even when both
branches eventually dispatched the same domain command. Duplicated canvas and
global controls also made common actions slower to find.

The editor still needs two useful writing postures. Someone learning the
workspace benefits from a little more explanation, while an experienced user
benefits from concise technical language. Those needs do not require different
controls or geometry.

## Decision

CloudCanvas will use one editor component and control tree for Guided and
Professional presentations. For the same viewport, permissions, product state,
and independently selected personal preferences, both modes have identical:

- application-header and editor-control positions;
- panel geometry, spacing, density, resize behavior, and initial layout;
- fields, field grouping, field order, validation, and disclosure controls;
- dialog and sheet stages, action order, confirmation gates, and shortcuts;
- menus, command-palette actions, keyboard alternatives, and disabled reasons;
  and
- technical-detail availability, disclosure defaults, and disclosure state.

Mode may select only assistance copy: explanation length, examples, definitions,
and whether plain-language or exact terminology leads within the same content
slot. It cannot add, remove, reorder, resize, collapse, or replace a control,
field, stage, action, evidence row, or technical-detail surface. A live mode
switch preserves the mounted interaction state, including dirty values, errors,
selection, tabs, disclosures, previews, and command history.

Reusable comfortable and compact density profiles remain owned by `packages/ui`,
but experience mode does not select either profile. Any future density
preference is independent of Guided/Professional and must preserve the same
controls and accessibility requirements. This refines the mode-selection clause
in ADR-0014 without changing provider-neutral design-system ownership.

### Immediate editor controls

The project editor uses a compact global header as the primary command surface.
In addition to project identity and truthful status, it exposes:

- Undo and Redo, bound to the current project-scoped command history;
- **Commands**, which opens the same command registry and retains catalog Add
  commands instead of a separate Quick Add surface;
- a **Canvas** popover containing **Arrange automatically**, **Fit
  architecture**, **Fit selection**, and **Architecture list**; and
- **Help**, which opens the shared keyboard-shortcut reference.

Header controls, the command palette, keyboard shortcuts, and alternative
list/tree paths dispatch the same action descriptors and disabled reasons. Menus
close after an action and restore focus to their trigger. The canvas keeps only
direct viewport controls such as zoom and the minimap; it does not repeat a
large command toolbar or a second Fit action.

### Shared editor geometry

Editor geometry is independent of experience mode. Catalog and Inspector use
edge resizing rather than prominent handles: an approximately 8 px transparent
hit edge contains a 1 px visible boundary that strengthens on hover, focus, and
active resize. Keyboard resize uses the documented 8 px step and 32 px
Shift-modified step.

The current desktop shell uses a 224 px Catalog minimum, a 240 px Inspector
minimum, viewport-derived maxima that preserve at least a 320 px usable canvas,
and a Workspace range from 160 px to approximately 80% of available editor
height. Workspace keeps its tab/header region visible and gives its content one
scroll owner. These are presentation constraints only; resizing, opening, or
closing a surface never changes graph coordinates or deployment meaning.

Responsive posture may reflow the shared controls into drawers or sheets under
ADR-0013. Viewport-driven reflow is not a mode difference and preserves action
order, focus destination, dirty state, and semantic capability.

### Shared connection flow

Supported connections use the same concise two-stage dialog in both modes:

1. **Set up connection:** choose one compatible relationship and complete the
   same ordered configuration fields, recommendations, and validation;
2. **Review and connect:** review the same endpoints, direct and supporting
   changes, permission effects, findings, provenance, and atomic apply action.

Exact rule, port, identifier, command, and diagnostic evidence remains available
to both modes through the same **Technical details** disclosure. The disclosure
has one default and preserves the user's open/closed state across a mode switch.
Both modes expose the same keyboard confirmation only when the same exact
preview is valid.

Connection resolution remains provider-owned and deterministic under the
existing catalog and command boundaries. This ADR changes presentation only; it
does not authorize inferred relationships, partial batches, hidden permissions,
cloud access, compilation, export, or deployment.

### Isolation and verification

Mode-paired component and browser tests render the same fixture, viewport,
permissions, and personal preferences. They must prove equivalent control trees,
geometry, fields, order, stages, actions, shortcuts, focus behavior, and state
preservation while allowing only reviewed copy differences.

Independent comfortable/compact density fixtures may remain design-system tests,
but they are not labeled as Guided/Professional. This refines the representative
matrix in ADR-0016; it does not change Storybook/Playwright ownership,
deterministic fixtures, accessibility assertions, or baseline controls.

## Consequences

### Positive

- Users learn one stable editor and can switch explanation style without
  controls moving or state remounting.
- Common commands are immediate in the global header and remain consistent with
  the command palette and keyboard paths.
- One connection flow reduces duplicated logic and makes state-preservation,
  keyboard, and accessibility evidence more direct.
- Mode-equivalence tests can detect structural drift instead of accepting two
  visually different implementations.
- Density and responsive layout remain reusable presentation capabilities
  without being proxies for presumed expertise.

### Negative

- Guided copy must fit the same layout without creating a separate step or
  larger control tree.
- Technical evidence cannot be made Professional-only; authorization and an
  explicit shared disclosure must handle sensitive or optional detail.
- Existing mode-specific CSS, stories, tests, and documentation require
  migration.
- A compact header needs careful overflow, popover stacking, accessible naming,
  and focus-restoration evidence.

### Follow-up

- Keep the UI specification, mode contract, design system, wireframes,
  accessibility requirements, product documents, and story matrix aligned with
  this decision.
- Test header actions, open Canvas and Help surfaces, identical mode geometry,
  shared connection stages, disclosure-state preservation, edge resizing, and
  Workspace limits.
- Treat any future proposal for mode-specific controls, stages, fields, or
  density as a change requiring an explicit superseding decision.

## Alternatives considered

### Preserve separate Guided and Professional layouts

Rejected because density, field grouping, stage count, and action placement
became a second interface contract and made live switching stateful and brittle.
Additional help does not require a different component tree.

### Keep duplicate global and canvas command surfaces

Rejected because duplicate Undo, Fit, Arrange, Quick Add, and shortcut entry
points compete for attention and can drift in availability or disabled reasons.

### Remove experience modes

Rejected because paired explanatory and concise copy remains useful. The
decision narrows mode to that durable purpose rather than removing it.

### Make Professional the only complete interface

Rejected because hiding fields, technical evidence, shortcuts, or actions in
Guided would create capability ambiguity and undermine safe mode switching.

## Compatibility, security, and rollback

This decision changes no persisted graph, command schema, provider contract,
tenant boundary, authorization rule, compiler input, artifact, credential,
network, or deployment behavior. Mode and editor geometry remain non-semantic
personal presentation state. Technical details are still filtered by verified
authorization and never reveal secrets or cross-tenant data.

Rollback of a local layout is possible while preserving the shared-tree and
assistance-only constraints. Reintroducing mode-specific fields, controls,
stages, density, or capability would require a superseding ADR. ADR-0006 remains
authoritative for shared semantic behavior; only its mode-specific presentation
clauses are superseded by this decision.

## References

- [ADR-0006: Guided and Professional modes share semantics](0006-guided-professional-shared-semantics.md)
- [ADR-0013: Desktop-first responsive review](0013-desktop-first-responsive-review.md)
- [ADR-0014: Design-system ownership](0014-design-system-ownership.md)
- [ADR-0016: Component isolation and visual testing](0016-component-isolation-and-visual-testing.md)
- [UI specification](../design/UI_SPEC.md)
- [Guided and Professional modes](../design/GUIDED_AND_PROFESSIONAL_MODES.md)
- [Design system](../design/DESIGN_SYSTEM.md)
- [Accessibility](../design/ACCESSIBILITY.md)
- [User workflows](../product/USER_WORKFLOWS.md)
- [Product specification](../product/PRODUCT_SPEC.md)
