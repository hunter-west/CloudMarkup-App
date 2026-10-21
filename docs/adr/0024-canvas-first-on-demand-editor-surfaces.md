# ADR-0024: Canvas-first editor with on-demand surfaces

- **Status:** Accepted
- **Date:** 2026-08-03
- **Owners:** CloudCanvas product and engineering
- **Supersedes:** ADR-0018 only for the concrete desktop Inspector and Workspace
  panel geometry, initial open state, and resize behavior
- **Refines:** ADR-0013, ADR-0014, and ADR-0016
- **Superseded by:** None

## Context

The shared M1 editor established one component tree for Guided and Professional
presentations, a resizable desktop Catalog and Inspector, and a vertically
resizable Workspace. That geometry preserved semantic parity, but the
simultaneously persistent surfaces reduced the usable canvas and made dense
configuration, connection, education, code, issue, and activity content harder
to read.

Service nodes have a related scaling pressure. A service such as Lambda can
expose several independently named input and output capability groups. Showing
every capability all the time makes the canvas noisy, while replacing exact
ports with a newly invented generic port would lose relationship identity that
the graph, provider catalog, and future IaC compilation require.

The editor therefore needs a quieter default projection without creating a
second architecture model, a pointer-only workflow, or a mode-specific layout.
The Architecture Document, exact port and edge identities, selection, commands,
validation, and IaC inputs must remain unchanged when presentation surfaces or
nodes open and close.

## Decision

CloudCanvas will use a canvas-first editor shell with compact, on-demand desktop
surfaces and a transient compact projection for service nodes.

### Desktop shell

The Catalog is the only persistent, edge-resizable desktop panel. It retains the
documented pointer and keyboard resize separator and canvas-preserving limits.
Inspector and Workspace content no longer reserve persistent resizable lanes:

- a compact right-side launcher opens **Architecture**, **Configure**,
  **Connect**, **Learn**, or **IaC** in the shared Inspector popup surface; and
- a compact bottom launcher opens **Assistant**, **Issues**, **Code**,
  **Activity**, or **Jobs** in the shared Workspace popup surface.

Only one launcher-owned popup is visually open at a time. Activating a different
launcher replaces the popup content without creating a second copy of the
architecture, form, finding, code, activity, or job state. Activating the
current launcher or its labeled close action closes the surface. Desktop
surfaces are modeless where the canvas remains safe to operate; responsive
postures may use the existing drawer or modal-drawer behavior.

Menus, popovers, and launcher-owned popup surfaces use an opaque semantic
surface, visible border, radius, and the appropriate design-system shadow.
Opening and closing uses the standard 160 ms overlay transition with short
opacity/transform movement. `prefers-reduced-motion` reduces that transition to
zero duration. Closing restores focus to the invoking launcher or, if it no
longer exists, the nearest surviving logical control. Switching launcher content
moves focus predictably within the one surface and preserves dirty form state.

This supersedes ADR-0018 only where it prescribed a persistent resizable desktop
Inspector, an independently height-resizable Workspace, their initial open
geometry, and the associated Inspector/Workspace size limits. ADR-0018 remains
authoritative for one shared Guided/Professional control tree, identical mode
geometry, assistance-copy-only mode differences, compact global commands, the
shared connection flow, and state preservation. Its Catalog resize decision also
remains in force. This ADR does not rewrite ADR-0018's accepted history.

### Compact service projection

Each non-boundary service node may switch between expanded and compact visual
projections through a labeled bottom-edge toggle. Compact state is transient
editor presentation state. It changes no Architecture Document node geometry,
semantic configuration, graph command history, validation target, provider
binding, stable identity, or IaC address. Every non-boundary service starts in
the compact projection when an editor session is created or reset. Newly added
services also start compact; expansion is an explicit session-only choice.

The compact projection shows the provider-neutral resolved service icon and the
configured resource name. It presents at most one aggregate input point on the
left and one aggregate output point on the right. Those points are visual
groupings only:

- every exact provider-catalog capability group and handle identifier remains
  attached to its original edge endpoint;
- incoming and outgoing edges may visually converge at the corresponding
  aggregate point without being rewired or retyped;
- hover and keyboard focus expose concise input/output group names, and
  activation opens an adjacent popup with the complete group names,
  descriptions, and connection counts; and
- expanding restores the individual left-side input and right-side output dots
  and their exact detail actions.

The synchronized Architecture list and Inspector continue to expose the full
port and relationship detail. Aggregation never becomes the sole discovery or
connection path. A provider may add many capabilities through its versioned
catalog without requiring provider-specific node code in the editor.

### Opening service details

Double-clicking a non-boundary service node selects it and opens its
**Configure** Inspector popup as a pointer convenience. Double-click is never
the only route: the right-side **Configure** launcher, node/list actions, and
keyboard-accessible Architecture list expose the same selected-resource surface.
Interactive controls inside a node do not inherit the node double-click action.
When Architecture opens, every resource selection row remains visible while its
port details start collapsed behind an independently labeled disclosure.
Collapsing a resource's details does not hide its child-resource hierarchy.
Validation navigation may reveal the containing resource before moving focus to
an exact port.

For Configure, Connect, Learn, and IaC, the selected-element overview above the
tabs starts collapsed for each selected target. Its summary retains the service
or relationship type, icon or fallback, and configured title. Expanding it
reveals ownership, placement or relationship detail, and Technical identity; the
tabs remain outside the disclosure and immediately operable.

Opening Configure, expanding a service, or opening a connection-group popup is
presentation-only. None of those actions dispatches a Graph Command or changes
export/compiler input.

## Consequences

### Positive

- The canvas retains more usable space while rich Inspector and Workspace
  content opens at a readable size near its task context.
- A compact service remains recognizable and connected without displaying every
  capability group continuously.
- Exact endpoint and edge identity remains suitable for deterministic validation
  and future IaC generation.
- One launcher model gives every rich surface consistent dismissal, focus,
  motion, shadow, and responsive behavior.
- Guided and Professional users continue to learn one geometry and one control
  tree.

### Negative

- Opening another launcher replaces the current popup, so users cannot compare
  two Inspector/Workspace surfaces side by side without another approved
  comparison pattern.
- Compact nodes require careful endpoint refresh and edge-routing tests because
  their visual dimensions change without changing the document.
- Aggregate points reduce at-a-glance per-port detail until the user hovers,
  focuses, activates, expands, or uses the list alternative.
- The Catalog now has different desktop persistence and resize behavior from the
  other editor surfaces, which must be documented and tested explicitly.

## Alternatives considered

### Keep all desktop panels persistent and resizable

Rejected because the simultaneous panel lanes consume the working area even when
the user is not reading their content. Persisting the Catalog remains useful for
repeated service discovery; the other surfaces are task-contextual.

### Replace exact ports with one generic input and output

Rejected because a generic endpoint would discard provider-owned capability and
relationship identity, weakening validation, least-privilege review, and IaC
generation. Visual aggregation must retain exact handles underneath.

### Put every launcher workflow in a small popover

Rejected because configuration, connection education, code, issues, activity,
and jobs are rich reading/workflow surfaces. They require drawer-sized content,
scroll ownership, headings, and predictable focus rather than menu semantics.

### Rely on hover or double-click for discovery

Rejected because touch, keyboard, assistive-technology, and novice users need
visible labeled launchers, focus-triggered names, explicit actions, and the
synchronized Architecture list.

## Compatibility, security, and rollback

This decision changes no persisted graph or revision schema, command contract,
provider contract, tenant boundary, authorization rule, compiler input,
artifact, credential, network, billing, export, or deployment behavior. Launcher
and compact-node state is local presentation state. Authorized popup content
follows the same filtering and redaction rules as the surfaces it replaces.

Compatibility evidence must compare expanded and compact projections against the
same Architecture Document and prove that node IDs, exact handle IDs, edge
endpoints, document serialization, hashes, and command history remain stable.
Browser and component tests cover every launcher, one-popup-at-a-time behavior,
Escape and explicit-close dismissal, focus restoration, dirty-state
preservation, double-click plus keyboard alternatives, adjacent connection
detail, forced colors, responsive drawers, and reduced motion.

The UI may roll back visual sizing, placement, or animation details while
preserving the canvas-first launcher contract and exact endpoint identity.
Restoring a persistent resizable Inspector/Workspace, making aggregate ports
semantic, or making hover/double-click the only access path requires a
superseding decision.

## References

- [ADR-0001: Versioned architecture graph](0001-versioned-architecture-graph.md)
- [ADR-0013: Desktop-first responsive review](0013-desktop-first-responsive-review.md)
- [ADR-0014: Design-system ownership](0014-design-system-ownership.md)
- [ADR-0016: Component isolation and visual testing](0016-component-isolation-and-visual-testing.md)
- [ADR-0018: Shared editor presentation and assistance-only modes](0018-shared-editor-presentation-and-assistance-only-modes.md)
- [Design system](../design/DESIGN_SYSTEM.md)
- [Accessibility](../design/ACCESSIBILITY.md)
- [UI specification](../design/UI_SPEC.md)
