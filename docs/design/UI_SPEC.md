# Cloud Markup Application Shell and Editor Specification

## Status and authority

This is the normative interaction specification for a future Cloud Markup
application shell and architecture editor. It is not an implementation report.
No route, component, persistence behavior, model integration, compiler,
subscription flow, provider asset, or export surface described here should be
treated as present until implementation and release evidence say so. Current
capability is tracked in [Project Status](../PUBLIC_STATUS.md).

The shell presents the product model defined by the
[Product Specification](../product/PRODUCT_SPEC.md),
[Domain Model](../architecture/DOMAIN_MODEL.md), and
[System Overview](../architecture/SYSTEM_OVERVIEW.md). It consumes versioned
provider-catalog descriptors, connection previews, validation reports, Graph
Commands, revisions, artifacts, capabilities, entitlements, subscription
projections, and usage projections. It must not reproduce their rules in UI code
or documentation. Billing and credit presentation additionally consumes the
[Commercial Model](../product/COMMERCIAL_MODEL.md) and
[Billing and Usage](../architecture/BILLING_AND_USAGE.md) contracts.

Route ownership and shared states are defined in
[Information Architecture](INFORMATION_ARCHITECTURE.md). Mode-specific
presentation is defined in
[Guided and Professional Modes](GUIDED_AND_PROFESSIONAL_MODES.md), visual
semantics in [Design System](DESIGN_SYSTEM.md), and non-pointer operation in
[Accessibility](ACCESSIBILITY.md).

## Non-negotiable interaction invariants

- The typed Architecture Document graph is authoritative; the canvas is a
  projection of it.
- Every semantic mutation is an authorized, versioned Graph Command. Direct
  manipulation, forms, assistant proposals, templates, and connection wizards do
  not receive alternate mutation paths.
- UI layout, viewport, panel arrangement, selection, and mode preference never
  change deployment meaning or stable graph identity.
- A draft is mutable. A revision and artifact are immutable. Compilation and
  export never consume a mutable draft.
- A model response is untrusted proposal data. It is schema-checked, explained,
  previewed, and accepted through deterministic domain behavior before the draft
  changes.
- Provider meaning comes from the exact catalog pinned to the document. The UI
  never guesses ports, relationships, IAM effects, supported regions,
  configuration defaults, or IaC readiness.
- Validation is bound to an exact draft or revision. An incomplete report is
  never labeled clean, and the UI does not invent a product-wide blocking or
  suppression policy.
- Capabilities and entitlements are server-authoritative. Disabled controls,
  hidden navigation, route IDs, and billing redirects are not authorization or
  entitlement evidence.
- The application exports reviewed artifacts; it does not apply infrastructure,
  hold customer cloud credentials, merge pull requests, or verify resources in a
  customer account.

## Application shell

### Overall composition

The default desktop shell contains:

1. a fixed top application bar;
2. an organization or project navigation region when the route needs it;
3. the route's main content;
4. notification history available through the profile menu; and
5. nonvisual live regions for save, validation, job, and error announcements.

Until final naming is approved, the visible shell uses the neutral identity
**Workspace** and neutral document titles, error text, and accessibility labels.
Internal package and migration identifiers do not become display copy. Official
provider marks, once approved, identify provider resources only.

Ordinary desktop application navigation starts at 264px and may be resized only
within 208px to 320px. Its link rows are 36px high with compact group padding.
Tablet and phone navigation uses the responsive drawer and preserves 44px touch
targets; the desktop width does not force a wide overlay.

Every page has one descriptive level-one heading and provides skip links to main
content and, in the editor, catalog, canvas/list, Inspector tools, and Workspace
tools. Headings are visible except in the full-canvas editor, where the single
editor `h1` may be visually hidden—but not removed or hidden from assistive
technology—because the top bar and canvas landmark supply the visible workspace
context. The editor still updates the document title and moves focus to that
heading on route entry. The shell never leaves prior-organization content
visible while a new tenant context loads.

### Top application bar

The desktop top bar uses one compact height and control geometry in both
experience modes. It keeps project context and immediate editor actions together
without creating a second canvas toolbar. From start to end it contains:

1. neutral workspace identity and organization/project context;
2. authoritative save and revision actions when available;
3. **Undo** and **Redo**;
4. **Help**, containing **Commands** and the keyboard-shortcut reference; and
5. the profile menu, containing Appearance and Notifications beside the account
   identity, with a red count on the avatar when notification history is
   nonempty.

Ctrl/Command+K opens Commands directly. The header omits the redundant Project
status control; detailed status remains accessible from the workspace-status
skip link and relevant commands. Authoritative save/revision controls remain
available. Account access always remains visible at reduced widths. Experience
mode stays available from preferences and does not select density or move
actions.

#### Context behavior

- Organization and project controls show authorized choices only. Changing
  organization clears tenant-scoped view state before loading the new context.
- **Draft**, **Revision**, and **Artifact** badges use text as well as styling.
- Environment and region show explicit `Unknown` when unresolved. Catalog
  availability marked unknown remains **Availability not reviewed**, never
  “available.”
- A semantic provider, environment, or region change opens an explicit review
  flow and uses the applicable versioned domain command when one exists. Until
  that contract exists, the context is read-only; the top bar is not an
  untracked deployment selector.
- The mode switch changes assistance copy immediately while preserving the
  mounted editor tree, geometry, selection, form values, errors, disclosures,
  previews, command history, draft version, and all semantic state.
- The credit indicator uses Cloud Markup credits as the primary unit and
  distinguishes remaining, reserved, exhausted, and unavailable data. It is not
  currency or a plan-entitlement indicator.
- Validation status names the evaluated version and distinguishes current,
  stale, running, incomplete, and unavailable. It never collapses
  `security-error` into a generic success/failure dot.

## Desktop editor geometry

At a viewport width of at least 1280px, the architecture canvas fills all
available editor space below the top bar. It is the continuous background;
Catalog, launcher rails, rich popups, canvas controls, status, and minimap float
above it instead of creating grid tracks that shrink it.

| Surface             | Fresh state | Desktop footprint | Desktop behavior                                                                                                        |
| ------------------- | ----------- | ----------------: | ----------------------------------------------------------------------------------------------------------------------- |
| Architecture canvas | Open        |       Full editor | Never collapses; switches to list/tree when effective width is insufficient                                             |
| Catalog             | Open        |        336px wide | Persistent left panel with an opaque fallback; 224px minimum, viewport-capped maximum, and a complete Show/Hide control |
| Inspector tools     | Available   |         92px wide | Fixed right launcher for Architecture, Configure, Connect, Learn, and IaC                                               |
| Workspace tools     | Available   |         48px high | Fixed bottom launcher for Assistant, Issues, Code, Activity, and Jobs                                                   |

Catalog remains the only persistent, resizable desktop work surface. Its
approximately 8px transparent hit edge contains a 1px visual boundary that
strengthens on hover, focus, and active resize; arrow keys resize it by 8px and
Shift+Arrow by 32px. The right and bottom launchers are fixed, compact surfaces
with complete text labels, aligned 1.5-pixel muted gray borders, restrained
shadows, and activation targets that remain usable by pointer and keyboard.
Catalog Show/Hide, launcher, and popup Close controls use balanced top and
bottom padding. Their outlines align with the surface instead of touching an
edge or exposing a mismatched background seam.

Activating any Inspector or Workspace launcher opens one shared rich popup over
the canvas. Only one of those ten destinations is open at a time; activating a
different launcher replaces the popup content, and activating the current
launcher closes it. Inspector popups sit immediately left of the 92px right
launcher. Workspace popups sit immediately above the 48px bottom launcher and
use one internally scrolling content region. Canvas menus can use readable blur
and translucency with opaque accessibility fallbacks; popups retain a border,
radius, restrained drop shadow, a compact padded **Close** control, and the
shared 160ms open/close animation. Reduced-motion preference sets that duration
to zero without delaying focus changes.

The editor workspace below the application bar is the positioning boundary for
all editor menus, dock actions, popovers, modeless Inspector/Workspace surfaces,
and modal tasks. Placement clamps to that boundary instead of the browser
viewport, so an overlay cannot extend over the application bar or below the
whiteboard. Opening a transient contextual surface dismisses any other transient
surface. Opening a modal task dismisses the modeless Inspector or Workspace
surface first; a hidden or covered surface cannot retain interactive authority
behind the dialog.

Catalog size, open popup destination, service-node collapse state, and any
density preference are presentation state independent of experience mode. The
current editor keeps them for the editor session only; a later preference
contract may persist them per user and device class. These values stay outside
the Architecture Document, content hashes, compiler input, and exported
artifacts.

On a fresh desktop load, Catalog is open, both launcher groups remain visible,
and no rich popup obscures the canvas. Every non-boundary service starts
compact; newly placed services also start compact. Expansion remains an explicit
session-only choice. **Reset workspace** restores those defaults and resets the
last Inspector and Workspace destinations to Configure and Issues. Invoking the
synchronized **Architecture** destination opens its own authoritative list/tree
popup; it is not nested inside Configure. Double-clicking a service selects it
and expands its block on the canvas. Configure is an explicit action inside the
expanded block and on the launcher. At narrower postures, the existing
responsive policy converts these destinations to mutually managed drawers and
bottom sheets before the canvas becomes unusable.

Launcher and popup geometry changes only the safe area used by fit controls and
the minimap. Opening, switching, or closing a popup and resizing or hiding the
Catalog never rewrite node coordinates. **Fit architecture** may account for
those insets while keeping graph identities, layout metadata, and deployment
meaning unchanged.

## Service catalog

The left panel lets an authorized user discover architecture concepts from the
exact versioned provider catalog pinned to the draft.

### Content

- Search matches approved display names, catalog-provided aliases or education,
  and supported capability metadata; it does not synthesize undocumented
  synonyms that imply support.
- Filters may include category, maturity, connection capability, availability
  evidence, and IaC readiness only when those values exist in the catalog.
- Catalog categories are keyboard-operable disclosures derived from the catalog
  view model. Search reveals categories containing matches without creating a
  second category list.
- Recently used services are bounded per-editor presentation state derived from
  successful local add actions. They do not enter the Architecture Document or
  its hashes and are hidden while search results are filtered.
- Each result uses the catalog display name as its first and strongest heading,
  a locally resolved approved icon or neutral placeholder, and concise
  catalog-owned purpose text in both modes.
- The result collection owns its scroll within the fixed-height catalog panel.
  Compact rows retain the service name, critical blocking reason, icon, and add
  controls. Noncritical availability, IaC, connection, maturity, port, and
  identifier facts appear through a labeled information control that supports
  hover, focus, click, and tap.
- The card information control has a 28px borderless-at-rest visual surface on
  fine-pointer desktop layouts. Hover, focus, or open state may reveal its
  boundary. Touch and coarse-pointer layouts promote it to at least 44px.
- **Details** opens a bounded dialog titled with the service name. It organizes
  catalog-authored purpose, common uses, configuration readiness, available
  connections, IaC support, and known limitations into labeled sections, keeps
  long content internally scrollable, closes with Escape, and returns focus to
  its invoking control.
- Service-card **Details** and **Add** use the shared compact action size,
  remain explicitly labeled, and stay on one stable action row when space
  permits. **Details** occupies the trailing edge requested for inspection;
  **Add** precedes it as the primary mutation. Compact styling cannot reduce
  their required pointer target or keyboard focus treatment.
- Unsupported placement, missing required configuration, and other critical
  add-blocking reasons remain visible on the card. Unknown Region availability
  and metadata-only IaC state remain truthful but may use the information
  surface rather than competing with the primary action.
- Search-empty, catalog-empty, incompatible-version, failed, and permission
  states are distinct.

The current AWS notes-API entries are production-oriented metadata, not curated
service support. Their Terraform and CloudFormation mappings are metadata-only
and their regional availability is unknown. A future shell must surface those
facts and may not relabel them **Supported**, **Export ready**, or **Available
in this region**.

### Add interaction

A pointer drag, catalog **Add** action, command-palette action, and keyboard
placement flow all request the same add-node command. Dropping selects a
presentation position; it does not bypass configuration, permission, catalog, or
graph validation. When exact placement is unavailable, the domain operation can
still be prepared and automatic layout can choose presentation metadata.

The catalog must not directly import provider files in feature code. It consumes
the provider-neutral icon resolver and catalog `displayName`; a missing,
unapproved, or rejected icon resolves to a deterministic accessible placeholder.

## Architecture canvas

The full editor canvas is a responsive visual projection of the current draft or
immutable revision. On desktop it remains the background beneath every floating
editor surface; Catalog and popup visibility change its safe area, not its
semantic content.

### Canvas controls

The canvas keeps only direct viewport controls: zoom out, zoom value, zoom in,
and the optional minimap for sufficiently large graphs. The compact global
header owns **Undo**, **Redo**, and **Help**, with **Commands** inside Help. Its
minimap opens the **Canvas** popover, which owns **Arrange automatically**,
**Fit architecture**, **Fit selection**, and **Architecture list**. The canvas
does not repeat these actions in a persistent toolbar or expose a separate Quick
Add control; catalog Add actions remain in the shared command registry.

For a deterministic local fixture, a compact canvas status distinguishes
checking, unsaved, saving, saved locally, conflict, failure, recovery-required,
and unsupported browser-recovery states. It never calls a browser checkpoint
server-saved or revisioned. An adjacent inline **Details** disclosure explains
that only the Architecture Document is eligible for local IndexedDB recovery;
selection, open popups, search, recent services, viewport, mode, and unfinished
wizard answers remain transient. Expanding it updates the measured top-overlay
safe area and fits the fixture graph into the remaining visible space without
changing node coordinates. Production-backed projects omit this fixture-only
status; it is not a generic server save-state replacement.

Zoom, pan, selection, minimap state, and temporary layout previews are
presentation state. Accepted movement changes only versioned layout metadata
through the command engine. Visual nesting is used only for catalog-supported
semantic boundaries; IAM roles, security groups, route associations, and managed
services use explicit association visuals rather than misleading physical
containment.

Boundary children use parent-relative stored coordinates. Derived boundary
dimensions expand on the editor grid as children approach the right or bottom
content edge, bounded by the documented minimum and maximum; an overflow is a
rejected placement, not silent coordinate clamping. A drop first identifies the
deepest exact visual boundary under the node and then runs the same
exact-catalog placement validation as the Configure popup selector. Invalid
drops clear the preview, restore the prior valid document state, and leave a
visible rule explanation. Moving a boundary changes its own position while its
children retain their local coordinates and move with it visually.
Collapse/expand hides or restores the projection only and is not serialized.

**Arrange automatically** / **Auto layout** runs one deterministic nested,
typed-port layout adapter. Running work is cancellable and cannot mutate the
document. Every non-empty result opens one explicit preview with the same exact
node IDs, parent IDs, old/new coordinates, actions, and **Ctrl+Enter** shortcut
in both modes. Assistance copy may explain that only positions change and how
nested boundaries are arranged. Switching mode preserves the same preview. Apply
reuses the exact prepared atomic position batch and persists no layout-engine
state.

The React Flow minimap is a 152-by-104-pixel overlay that projects every
currently visible graph node, including unknown/imported fallbacks, and keeps
its viewport mask synchronized with canvas pan, zoom, add, move, and removal
state. It has a separate accessible purpose from the numeric zoom indicator and
uses semantic high-contrast-safe styling. On desktop it occupies the canvas safe
area left of the Inspector launcher and above the Workspace launcher or active
popup. It reserves no separate white dock, cannot cover graph controls, and
moves with popup state without rewriting graph coordinates. The minimap adapts
or hides when a narrow posture cannot accommodate it safely.

### Blank and populated states

A blank draft shows three equal starting actions: **Describe an application**,
**Use a template**, and **Add a service**. It also explains that generated IaC
requires a reviewed immutable revision and that Cloud Markup does not deploy.
Choosing an action enters the appropriate canonical workflow; it does not
populate hidden defaults.

A populated draft renders nodes, typed ports, explicit edges, boundaries,
provenance, permission/read-only state, and validation state using the
[Design System](DESIGN_SYSTEM.md). Edge direction and relationship meaning use
text, line pattern, arrowhead, and/or an icon rather than color alone. Unknown
relationship presentation uses a generic labeled line; no visual kind is
inferred from an identifier string.

### Compact service nodes

Every non-boundary service or fallback projection starts as a compact
176-by-72-pixel node when an editor session opens or resets. Newly placed
services also start compact. A user may explicitly expand a node without
changing the Architecture Document. The compact body shows the approved service
icon or accessible fallback plus the configured resource name. A centered,
keyboard-operable arrow at the bottom expands the node; the expanded node
provides the corresponding collapse action. The control has its own accessible
name and does not initiate drag, selection, or connection drawing.

Compact nodes reserve the left side for inputs and the right side for outputs.
At most one visible aggregate blue dot appears on each side, but every exact
catalog group handle remains mounted at the corresponding common side anchor.
Edges may converge visually at that anchor while retaining their stable edge IDs
and exact source/target port IDs. Expanding restores the individual grouped dots
without recomputing, translating, or serializing any connection.

Hovering or focusing an aggregate dot reveals the names of its input or output
groups at a glance. Activating it opens a bounded information surface beside the
owning service with those names, descriptions, and counts, plus a path to expand
the service and open one exact group. The surface re-anchors on viewport changes
and cannot drift to an unrelated canvas position.

Double-clicking a service body selects it and toggles its larger on-canvas
block. The block includes a Configure action. Double-clicking an interactive
dock, popup control, or expand/collapse control performs only that control's
action. Collapse state, popup state, and double-click routing are transient
presentation state and never enter hashes, history, compiler input, or IaC
addressing.

### Stable grouped connection docks

Semantic ports and visual docks are separate. Architecture edges always retain
their exact source and target port IDs. A separately versioned and digested
connection-presentation artifact, bound to the exact semantic catalog, assigns
every port to exactly one dock. Dock IDs, side/order, open state, focus,
highlight, menu scroll, and edge fan-out never enter the Architecture Document,
Graph Commands, semantic hashes, generated-resource provenance, compiler input,
or deployment addresses.

The provider-neutral categories are triggers/incoming events, data/storage,
messages/events, workflow invocation, identity/permissions, networking,
observability, and an explicit Other fallback. Expanded services render every
catalog-declared dock that owns a relevant semantic port; compact services
project those same docks through one directional aggregate per side. The UI does
not add an AWS service or one handle per possible target. Lambda exposes
Triggers, Async events, Event sources, Data & storage, Messages & events,
Invokes, Configuration, Identity & grants, Networking, and Observability when
expanded. A capability without a reviewed connection rule stays visible as
information but is not connectable and does not imply export support.

Docks mount on the external node boundary. Input-only groups use the left and
output-only groups use the right. A provider presentation cannot use a mixed
dock or a top/bottom association dock; it must split the exact input and output
ports into directional groups. In compact state, exact group handles overlap at
the side's stable aggregate anchor while only the aggregate dot is visible. A
service body never renders a scrollable technical-port list or mounts an edge
handle inside a metadata row.

The visible mark is a compact 13px blue dot centered on the exact shared React
Flow handle, with a transparent design-system pointer and keyboard target. The
target and dot expand inversely at small canvas zoom so the rendered target
never falls below 24px. A filled dot offers at least one reviewed compatible
action; a hollow dashed dot is informational. A nonzero connection count and
validation marker remain visible without relying on color, while the accessible
name carries the group, direction, owner, count, availability, and error state.
Persistent labels and exact ports belong in the adjacent information surface
rather than perimeter pills. Pointer hover or keyboard focus reveals one
transient side-positioned tooltip named `Input: <group>` or `Output: <group>`
for an expanded group, and `Inputs: <group names>` or `Outputs: <group names>`
for a compact aggregate. It supplements the existing accessible name through
`aria-describedby`, stays hoverable, dismisses with Escape, remains readable at
small zoom, and disappears while the grouped information surface is open. The
dot, focus path, count/error meaning, and non-color status remain recognizable.

Activating a dock opens one accessible grouped-connection surface. Its **Current
connections** list shows the remote resource name, concise catalog relationship
label, direction, readiness/error state, and **Focus**, **Edit**, and authorized
**Disconnect** actions. Its **Available connections** list shows the compatible
purpose, resolver-filtered services, safe recommendations, and a precise reason
for unavailable choices. Guided assistance may explain why a relationship is
useful; the shared **Technical details** disclosure may expose exact ports,
relationship/rule IDs, cardinality, generated IAM actions, and stable
identifiers. The same controls, dimensions, ordering, and behavior appear in
Professional mode.

The grouped surface is portaled into the document overlay layer so it is not
positioned inside React Flow's transformed canvas. It opens 8px beside the
owning service, aligns vertically with the activated dot, flips to the opposite
side if needed, and clamps to a 16px viewport gutter. Pan, zoom, drag, viewport
scroll, and content-size changes re-anchor it; menu scrolling never changes the
service boundary or edge endpoint.

A dock may aggregate several semantic ports and edges. Each edge keeps its
stable ID and exact ports while sharing a stable input/output handle for the
group. Peers fan out deterministically by stable edge ID after leaving the
anchor. Opening a dock highlights only that group's edges; focusing a list row
selects only that exact edge. Disconnecting one authorized edge uses its own
Graph Command path and cannot recreate, reorder, or remove another edge sharing
the dock. A generated or adopted edge that cannot be removed must show its exact
lifecycle reason.

Scrolling a grouped-connection surface, opening or closing a group, collapsing
or expanding a service, changing mode copy, or reordering a list cannot change
the document, command history, semantic hash, exact port identity, or generated
permissions. Dock and menu motion follows the shared 160ms overlay timing,
becomes immediate under reduced motion, and never delays focus or semantic
state. Every dock action also remains available through an Inspector popup, the
Architecture popup, or a command workflow so the popover is not the only path.

### Selection

- Pointer click or keyboard activation establishes one primary selection.
- Ctrl/Cmd activation adds or removes items from a multi-selection. Shift
  activation may select a contiguous range only in ordered list/tree views.
- The Inspector popup represents the primary selection. A multi-selection shows
  only common, domain-supported actions; it does not invent bulk mutation.
- Selecting a finding moves focus to its first authorized affected location and
  preserves a return path to the finding.
- Selecting an edge exposes both endpoint nodes, ports, direction, relationship
  type, and configuration in text.
- Escape clears a transient menu or drag first, then canvas selection. It never
  discards an edited form or queued command without confirmation.
- Selection may persist across popup changes and mode switches, but not across
  tenant changes or when the selected identity no longer exists.

Every canvas operation has an equivalent list/tree or command-based path. The
canvas must remain usable without provider icons and without color perception.
For containment, the selected-resource Configure popup provides a labeled
boundary selector and explicit action so pointer dragging is never required.
Both modes expose the relationship type, stable boundary identity, stored
coordinates, validator, and command path; Guided copy may additionally explain
root versus boundary placement in the same assistance slot.

The compact global header exposes Undo and Redo for accepted semantic changes.
One atomic Graph Command batch is one history entry, and undo/redo applies
domain-returned commands rather than replacing the document from UI snapshots.
The bounded session history retains at most 100 entries and 2 MiB of serialized
forward-plus-inverse command payloads; advancing the limit moves its validated
in-memory checkpoint forward. Selection, viewport, open popups, mode,
configuration form buffers, connection drafts, and layout previews do not enter
that history. `Ctrl`/`Cmd+Z`, `Ctrl`/`Cmd+Shift+Z`, and `Ctrl+Y` follow the same
path and do not fire from text-entry or composition contexts.

## Resource inspector

The 92px right launcher exposes five independently labeled destinations:
Architecture, Configure, Connect, Learn, and IaC. Activating one opens the
shared Inspector popup beside the selected node, edge, boundary, or
multi-selection when possible, while staying inside the viewport. The popup
heading contains the destination, selected display label, semantic type,
provider/catalog version, lifecycle/provenance state, permission state, and
current validation count. The stable identity is available as technical detail,
not substituted for the accessible name.

**Architecture** owns the synchronized authoritative list/tree alternative used
for keyboard selection and presentation-only movement. It is a separate popup
destination, not a disclosure nested above configuration. Opening, closing, or
selecting within it changes presentation state only.

Architecture keeps every resource visible as a compact selection row. A resource
with ports has a separate named **Show/Hide details** control, closed by
default. Its child-resource hierarchy remains outside that disclosure, and
validation navigation expands the containing resource before focusing an exact
port.

Configure, Connect, Learn, and IaC place a compact selected-element disclosure
immediately above their tabs. It starts collapsed for each selected target and
retains the icon or fallback, semantic type, and configured title in its
summary. Ownership, placement or relationship detail, and Technical identity
appear only when expanded; the tab row remains outside the disclosure.

Configure, Connect, Learn, and IaC reuse one popup frame and keep their mounted
session state when the user switches destinations. Their launcher controls use
the shared compact button size: slightly reduced type, padding, and gap without
changing focus visibility, complete labels, or minimum activation targets. Long
content scrolls inside the popup instead of increasing its height or leaving
blank space. Closing returns focus to the invoking launcher; reopening restores
the selected destination and safe unsubmitted buffers. On constrained postures
the same destination becomes the existing responsive drawer or sheet.

### Configure

Configure renders forms from the exact catalog configuration schemas and UI
hints. It:

- separates required, recommended, advanced, sensitive-reference, cost, and
  presentation-only fields;
- shows whether a value is explicit, catalog-defaulted in a prepared command,
  inherited through an approved contract, unknown, or unresolved;
- materializes every infrastructure-affecting default in the command and
  Architecture Document before it gains meaning;
- uses typed node, variable, secret-reference, and literal selectors without
  accepting secret material;
- retains hidden advanced values when disclosure changes;
- shows field and cross-field findings at their authoritative paths;
- submits one validated command or atomic batch with exact prior-value
  preconditions; and
- preserves safe input on rejection or conflict.

There is no arbitrary JSON configuration escape hatch. Unsupported fields and
unknown schema versions fail closed.

For a selected workload node, Configure includes an **Implementation** section
projected from the exact Architecture Document v3 Workload Behavior v2 and
Application Contracts v1 records. It shows implementation mode, source
ownership, runtime family, handler or entrypoint, bound triggers, allowed
downstream actions, dispatch policy, unresolved implementation requirements,
whether user-provided code is required, and whether a reviewed starter generator
supports the exact combination. Absence is an unresolved decision; the UI never
infers behavior from a service type, label, or edge.

The section also provides a provider-neutral operation authoring form for the
operation name, required purpose, inputs, and outputs. Input/output lines use
one strict portable grammar: `name:type:classification:required|optional`. The
approved type and classification vocabularies are displayed beside the fields.
The operation name is limited to 512 characters, purpose to 8,000, and each
input/output declaration block to 4,096 characters and 32 nonempty lines.
Parsing rejects control/bidirectional characters and credential-shaped values
and treats the purpose only as declarative plain text. Contract lines accept
only names and the reviewed vocabularies: no values, URLs, source, shell
commands, package/module/provider requests, or arbitrary JSON. Validation errors
identify the field and safe correction without reflecting rejected sensitive
input.

**Preview behavior update** prepares one exact-preconditioned
`replace-workload-and-application-contracts` Graph Command. It replaces the
Workload Behavior and Application Contracts snapshots atomically, preserves the
document, contract-set, revision, workload, and operation identities, and uses
the prepared command unchanged on Apply. The domain command validates both
collections together and returns an exact inverse; a stale or independently
owned contract fails closed. This form writes no source, invokes no model,
installs no dependency, runs no compiler, and deploys nothing.

The section follows the editable configuration and policy controls and starts
collapsed. Its summary communicates implementation state; exact workload,
runtime, trigger, dispatch, contract, and source evidence remains available
inside without competing with the configuration task.

### Owned configurations and structured policy editing

When a service declares owned-configuration slots, Configure projects them from
the exact graph-backed configuration nodes and owner-slot edges. It does not
create a second attachment collection. The slot summary shows stable
configuration identity, kind, display name, user/generated ownership,
provenance/adoption, explicit cardinality, findings, and six-part target
readiness. Infrastructure-affecting edits use exact-preconditioned Graph Command
node/edge/configuration operations or one atomic batch.

Editable policy slots start in one collapsed **Policy configuration (N)**
disclosure below the resource fields. Projection errors, validation findings,
and any reason an action is unavailable remain outside that disclosure and
visible.

An IAM role keeps these sections visibly separate:

- **Generated permissions** — “These were created because this role or function
  is connected to other services.”
- **Custom inline policies** — “You explicitly added these permissions to this
  role.”
- **Trust policy** — “This controls who or what may use this role.”
- **Managed policies** — reviewed managed-policy attachments remain distinct
  from inline documents.
- **Permissions boundary** — “This limits the maximum permissions the role can
  receive.”

Lambda invocation permissions appear as service-specific generated grants, not
role inline policies. Removing a connection may release only its generated
policy subtree when exact provenance and live-reference preconditions allow it.
It never silently removes a user-authored policy, managed-policy attachment, or
permissions boundary.

The structured policy drawer uses existing UI primitives and one canonical graph
projection. It supports policy name; an ordered statement list; add, edit,
duplicate, and remove statement; `allow` or `deny` effect; one or more actions;
typed resource references; optional typed conditions; principals only for policy
kinds that permit them; statement identity; validation summary; and
target-readiness summary. Resource choice prefers Architecture Document nodes,
generated output references, and approved variables before an explicit bounded
advanced value. Account IDs, ARNs, secrets, wildcard action/resource/principal
scope, or arbitrary policy JSON are never implicit defaults.

Validation identifies exact graph paths for empty actions, invalid effect,
forbidden or missing principals, malformed conditions, unsupported
service/action pairs where reviewed evidence exists, unrestricted wildcards,
duplicate equivalent statements, cardinality, ownership/provenance, and target
support. The editor distinguishes modeling, configuration, validation,
Terraform, CloudFormation, and generated-code readiness. It derives the bounded
notes-API policy family's supported Terraform and CloudFormation projections
from the exact catalog binding; source generation remains a separate target. The
[provider guide](../development/PROVIDER_CATALOG.md) records current scope and
known limitations.

Guided and Professional use the same drawer, fields, statement order, actions,
defaults, disclosures, validation, commands, and readiness. Guided assistance
may explain permission purposes, read versus write, wildcard risk, and hide no
field while advanced condition guidance starts collapsed. Professional
assistance may lead with exact actions, resource expressions, condition keys,
stable IDs, and target mapping detail in the same slots. Mode switching
preserves all input, focus, disclosure, and validation state.

Service-owned resource policies, lifecycle rules, CORS, notifications, retry and
dead-letter configurations use the same slot/schema-driven editor when declared
by the exact catalog. Future encryption/key policies or access-logging slots
require their own reviewed declarations. A service-specific editor requires a
separate ADR showing why the generic typed contract cannot safely represent the
behavior.

### Connect

Connect lists the same current typed relationships and exact-catalog-bound
connection groups used by the stable boundary docks. Each group shows its
explicit minimum/maximum range, current utilization, multiplicity/exclusivity,
and implemented-rule-backed semantic-port starts. Starting a group filters
discovery to its assigned ports; the wizard, not the Inspector popup or dock,
resolves the exact compatible target-specific descriptor. No surface derives
compatibility from a label, dock ID, canvas proximity, or provider folklore.

Actions and current relationships use the shared provider-neutral groups:
**Triggers**, **Data & storage**, **Messages & events**, **Invokes**, **Identity
& permissions**, **Networking**, **Observability**, and a safe **Other**
fallback. Semantic capability ports may support several target- specific rules
and several ports may share one dock; neither creates one handle per future
service. A capability with no implemented rule remains an explicit unavailable
fact. The Architecture list retains exact per-port starts within its resource
tree; dock, toolbar, Inspector popup, Architecture popup, and scoped keyboard
workflows remain semantically equivalent.

Both modes present the same groups, concise relationship labels, purpose,
consequence, cardinality, generated IAM effects, supporting configuration,
provenance, target readiness, and compatibility diagnostics. The same
**Technical details** disclosure exposes exact capability, port, dock, rule,
relationship, finding, command, and revision identities. Assistance copy may
differ; the candidate set, fields, resolver preview, validation, command, graph
revision, and semantic hash do not.

For an existing relationship, the Connect destination shows exact endpoint

The primary Connect or Edit action appears before relationship detail. Current
relationships show the remote resource and concise relationship name; exact
capability, port, relationship identifier, and remote port use an adjacent
information control. Implemented per-capability starts use a collapsed
**Connection options (N)** disclosure, while catalog capabilities with no rule
use a collapsed **Unavailable capabilities (N)** disclosure. A disabled action's
exact reason and security or validation findings remain visible. ports,
configuration, resolution version, supporting elements, canonical generated
permissions where declared, findings, provenance, target readiness, and
authorized Focus/Edit/Disconnect or exact unavailable lifecycle reason.

### Learn

Learn presents versioned catalog-owned:

- distinct beginner and technical service guidance;
- four reviewed **Connections**, **Security**, **Cost**, and **Operations**
  considerations for every surfaced catalog concept;
- schema-derived configuration signals and availability/reliability evidence;
- unsupported capabilities, explicit gaps, assumptions, and unresolved
  requirements; and
- validated official HTTPS documentation references.

Mode changes assistance copy only; they do not reorder this content or change
facts. Copy must not imply provider endorsement, account-specific verification,
or implemented compilation where none exists.

### IaC

IaC presents catalog mapping identity, target, declared implementation status,
configuration binding summaries, compatibility information, and
compilation-readiness findings. It also shows the exact service or owned-slot
readiness entries for modeling, configuration, validation, Terraform,
CloudFormation, and generated application code. It is not a free-form Terraform
editor and does not collapse these dimensions into one “unsupported” label.

For a draft, this destination says that generated code does not exist and offers
the authorized revision workflow. For an immutable artifact, code belongs in the
artifact review rather than being synthesized from current canvas state.
Metadata-only mappings are labeled **Mapping metadata only — compilation is not
implemented**. Policy modeling/editing/validation may be supported while
Terraform and CloudFormation are **Pending** with their exact reasons. A missing
or unknown mapping never falls back to guessed IaC, and validation evaluates the
selected export target separately.

### Inspector states

No selection shows selection guidance and keyboard alternatives. Unsupported
type/version, incomplete catalog, read-only, deleted selection, conflicting
edit, and loading states are explicit. Switching destinations or modes never
discards dirty form input; navigating away prompts to keep or discard only the
unsubmitted presentation buffer.

## Workspace launchers and popups

The 48px bottom launcher provides five ordered, always-available destinations:
Assistant, Issues, Code, Activity, and Jobs. A badge is a count or status, not a
substitute for the launcher's accessible name.

No Workspace popup is open on a fresh desktop load, so only the compact launcher
height contributes to the canvas safe area. Activating a destination opens the
shared rich popup immediately above the launcher with a short heading, compact
padded **Close** control, restrained drop shadow, and one internally scrolling
content region. On desktop an 8px buffer separates that popup from an open
Catalog, so the two surfaces never appear joined. Switching destination replaces
the content in that same popup; only one Inspector or Workspace popup may be
open at a time. Activating the current launcher or Close dismisses it, restores
focus to its invoker, and preserves the last active destination and safe local
buffers. Reopening restores that destination. The popup and launcher keep the
minimap and canvas controls visible without changing graph positions.

### Assistant

The assistant accepts policy-allowed intent or architecture questions and shows:

- the context that will be shared at a safe, understandable level;
- estimated/reserved Cloud Markup credits before model work where available;
- pending, refused, quota-exhausted, canceled, schema-rejected, failed, and
  completed states;
- schema-constrained proposal operations, rationale, assumptions, and rejected
  gaps; and
- **Review proposal** before any acceptance.

Raw model output never mutates the graph. Accepted operations go through the
same authorization, Graph Command, provider, and validation path as direct
editing. The assistant has an accurate **Not available** state when model
integration, entitlement, policy, or network service is unavailable.

### Issues

Issues renders the exact version-bound validation report. It supports severity,
rule, affected element, and status filtering without changing the report. Every
row includes stable finding identity, severity text, title, affected location,
beginner or technical explanation, rule references, evaluated version, and
available remediation preview.

A stale report is visibly stale. An incomplete report has a prominent
**Validation incomplete** status even with zero findings. Auto-fixes are
complete Graph Command batch previews; the UI never applies one silently or
resolves a reported fix conflict on the user's behalf. Warning review, finding
selection, filters, expansion, learning disclosure, and focus/highlight are
presentation state and never alter the report, Architecture Document, or future
gate result.

Secondary **Project readiness** evidence is a collapsed disclosure by default.
The summary names its browser-local scope and status; expanding it reveals
diagram validity, draft findings, unavailable revision evidence, reviewed
warning counts, target readiness, and report binding. Canonical findings,
filters, validation status, and required actions remain visible outside it.

The current bounded M1 Issues workspace implements the first local slice over
paired draft and compilation reports from the exact bundled AWS evaluator. A
validation-target selector presents those canonical reports separately without
merging findings or treating the unsupported revision target as compilation. It
groups canonical severities by every affected resource; filters error, security,
cost, warning, recommendation, and educational categories; and navigates through
the Architecture and Inspector popups to nodes, boundaries, edges, ports, and
configuration fields. Both modes show **What happened**, **Why it matters**,
**How to fix it**, target applicability, stable finding/rule identities,
affected paths, technical detail, and exact fix commands in the same order.
Guided may add explanation; Professional may use concise exact wording. A
warning or cost warning may be marked **Reviewed this session** only while its
report is complete/current; this is not acknowledgement, suppression,
persistence, or revision eligibility. **Warning acceptance** is shown separately
as **Not available** until the product-wide acknowledgement, suppression, and
gating policy is accepted.

### Code

Code shows generated files only from the currently selected immutable artifact.
It provides file navigation, syntax-highlighted read-only content, complete diff
context, copy/download where authorized, diagnostics, and version/digest
metadata. A draft or revision without a successful artifact displays an accurate
empty or job state; it never generates code in the browser.

### Activity

Activity shows authorized, safe summaries of project lifecycle, accepted
proposals, graph commands, revisions, artifacts, exports, and other audited
events. It is not an editable event log and must redact sensitive bodies. A
summary links to a resource only if the actor can still view it.

### Jobs

Jobs shows intent, model, validation, compilation, formatting, diagram,
artifact, and export work when those workflows exist. Every job has an input
identity, queued/running/succeeded/failed/canceled state, last update, safe
diagnostics, and only domain-supported cancel or retry actions. A succeeded
compiler job is not a deployed infrastructure state.

## Save and synchronization

The M1 development fixture has a separate browser-local recovery status. Its
trailing-edge debounced autosave stores a strict Architecture Document envelope
in IndexedDB and attempts to flush when the page becomes hidden or leaves the
page lifecycle. **Saved locally** means only that this browser acknowledged the
latest local generation; it does not mean server-saved, authorized, revisioned,
audited, synchronized, or eligible for compilation/export. A transaction-time
compare-and-swap conflict or stale-tab notice stops automatic overwrites.
Malformed, tampered, mismatched, or unsupported-future local drafts are not
opened. The recovery disclosure offers **Recover safe copy**, **Discard local
draft**, and **Download diagnostic copy** for every rejected record; diagnostics
are bounded and redacted and never contain the rejected raw draft.

The following production-backed states remain the later backend contract, not
claims about the M1 local adapter:

The top bar and editor announce one of the following mutually exclusive primary
states:

| State                          | Meaning and UI behavior                                                                                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Saved — draft vN**           | The server acknowledged all accepted commands through the displayed draft version.                                                                                |
| **Saving N changes**           | Commands are being submitted in order; navigation warns only when leaving could abandon an unpersisted buffer or queue.                                           |
| **Queued offline — N changes** | Commands are retained locally for review after reconnect. They are not persisted, authorized for the future session, or eligible for revision/compilation/export. |
| **Conflict — review required** | A server version changed or a command precondition failed. Automatic submission stops and neither side is overwritten.                                            |
| **Save failed — retry**        | The request did not receive authoritative acknowledgement. The UI retains safe commands and does not call them saved.                                             |
| **Read-only**                  | Mutation is unavailable because of lifecycle, permission, compatibility, or explicit platform state. The safe reason category is visible.                         |

After reconnect, queued commands are checked against verified identity,
authorization, current draft version, catalog compatibility, and exact command
preconditions. A valid command may be resubmitted; a conflict requires an
explicit review. Reloading or closing the page must not falsely turn a local
queue into saved state.

Revision creation, compilation, diagram generation, ZIP creation, and GitHub
submission are unavailable while the draft is saving, queued offline,
conflicted, or failed.

## Command palette and keyboard efficiency

Ctrl/Cmd+K opens the command palette from any authenticated screen. Results are
grouped as Navigate, Add, Select, Configure, Connect, Validate, View, Revision,
Export, and Help. Only authorized and context-valid actions are executable.
Unavailable results may appear with a safe reason when doing so reveals no
protected information.

The palette dispatches the same actions as visible controls. It never accepts
raw command JSON, bypasses confirmation, changes tenant context without clearing
old data, or performs a semantic action merely by highlighting a result.
Destructive and external side effects retain their normal confirmation and
reauthorization.

Keyboard help lists current shortcuts and alternative workflows. Shortcuts are
disabled while they would conflict with text entry and can be remapped only as
non-semantic personal preferences.

## Overlays and transient feedback

### Dialogs

Dialogs are reserved for consequential confirmation or a short bounded task:
discarding input, applying an atomic connection, adopting/releasing generated
resources, creating a revision, confirming a ZIP, or submitting a GitHub export.
A dialog names the resource, effect, reversibility, and authoritative input
version. The primary action is a verb, not **OK**. Focus is trapped while open
and restored to the invoking control.

Editor overlays use the shared semantic surface, 1.5-pixel muted gray menu
border, radius, restrained elevation, and stacking tokens. Their content cannot
inherit accidental canvas transparency or be clipped by panel overflow. Shared
open and close motion uses the 160ms standard duration with responsive
opening/closing easing; focus and keyboard state change immediately.
Reduced-motion preference sets the duration to zero.

The editor workspace is the shared clipping and positioning boundary. Menus,
popovers, connection docks, modeless surfaces, and dialogs remain between the
application bar and workspace edge. Opening one transient contextual overlay
dismisses the previous transient overlay. Opening a modal dialog dismisses any
modeless Inspector or Workspace surface before focus enters the modal.

Desktop Inspector and Workspace popups use the readable surface treatment and
opaque fallback described in ADR-0058; Catalog uses the same surface and shadow
tokens as a persistent panel. Their shadows distinguish stacking but never
encode selection, validation, ownership, or deployment meaning.

### Drawers and sheets

Drawers hold bounded rich work such as an Inspector destination, Workspace
destination, issue details, project status, or mobile navigation. They do not
cover an unresolved confirmation dialog. On tablet and phone, desktop popup
destinations become mutually managed drawers or full-height sheets with the same
heading, state, and action order; Catalog follows its existing responsive drawer
policy.

### Popovers

Popovers provide short, nonessential context such as a legend, filter, version
summary, or account menu. They close without losing semantic work and never
contain the only path to a critical action or explanation. The
grouped-connection popover is a bounded action surface rather than an owner of
semantic work; every Focus, Edit, Connect, or authorized Disconnect action has
an equivalent Inspector popup, Architecture popup, or command path.

### Context menus

Node, edge, boundary, and list-item context menus expose the same
domain-supported actions available from the inspector or command palette. Menu
availability follows selection, lifecycle, capability, and generated ownership.
Right-click is never the only invocation.

### Notifications

Toasts acknowledge short-lived outcomes and never serve as the sole record of a
save conflict, validation failure, exhausted credits, job failure, or completed
export. Durable outcomes remain in the relevant status region, Issues, Jobs,
Activity, or notification center. Notifications include text status, avoid
secret or cross-tenant content, support pause/dismiss without time pressure, and
link only to authorized resources.

## Onboarding

New actors default to Guided mode unless they explicitly choose Professional.
Onboarding:

1. explains that the workspace designs, validates, and exports but does not
   deploy;
2. introduces organization and project context;
3. lets the user choose prompt, template, or blank creation;
4. demonstrates source-of-truth, draft/revision/artifact, save, validation, and
   export concepts;
5. introduces the list/tree alternative and keyboard help; and
6. ends in contextual guidance rather than a blocking tour.

The user can pause, skip, restart, or switch modes. Skipping never changes
architecture defaults, validation, permissions, or entitlements. Completed steps
are personal experience state outside the graph. Tutorials cannot cover or
intercept urgent error, permission, billing, or security messages.

Projects and first-use setup use the compact default density and one bounded
content column. Choice cards keep equal geometry across assistance modes, avoid
full-width radio/check glyphs, and promote their complete controls to 44px
targets for touch or coarse pointers without expanding desktop spacing.

The current bounded first-use implementation provides one optional Notes API
scenario in Guided mode. It uses the same Catalog, Inspector, connection,
Issues, and Workspace actions as ordinary editing; it may focus those controls
but does not replace them. Its validation step teaches users to review a finding
and a safe fix when available, because review-only warnings may not have an
automatic fix. Dismiss, restart, and completion are personal experience state.
This single scenario does not claim a generalized walkthrough-authoring system
or additional completed tutorials.

## Connection wizard

The connection wizard is a review surface over an exact provider-owned
descriptor and deterministic resolver preview. If the exact resolver is
unavailable or mismatched, the workflow fails visibly without a command. The
wizard does not implement connection logic.

### Stages

1. **Set up connection:** identify source and target nodes, exact ports,
   direction, and one compatible catalog relationship; then collect the same
   ordered descriptor fields, recommendations, and validation in both modes.
2. **Review and connect:** show the complete ordered atomic Graph Command batch,
   including direct and supporting nodes/edges, exact declared IAM actions and
   resource scope, configuration, provenance, generated-resource lifecycle,
   preview findings, draft version, and command identity. A failed or incomplete
   preview is not confirmable; confirmation applies all changes or none.

Both stages use the same fields, field order, validation, Back/Continue/Connect
actions, and keyboard confirmation in both modes. The same **Technical details**
disclosure exposes exact rule, port, identifier, command, and diagnostic
evidence. Mode may change only the assistance copy within the shared layout.

The wizard inherits the application-level assistance mode and does not render a
second Guided/Professional selector. Changing assistance mode remains available
through the owning shell and does not change the candidate, command, validation,
or dialog geometry. When the descriptor requires no ambiguity choice or setup
fields, the wizard enters the review stage directly instead of presenting an
empty setup choice.

Changing any endpoint, question, draft version, or catalog version invalidates
the prior preview. Confirmation reauthorizes and revalidates the exact batch.
The UI never summarizes “permissions added” while hiding actions, resources, or
supporting changes.

The current bounded M1 implementation enters this workflow through stable dock
activation, an exact semantic-port purpose inside its group, the selected-node
toolbar, the Inspector Connect popup, labeled Architecture-popup port controls,
typed drawing where supported, or `C` scoped to a focused graph/list composite.
The dock only filters assigned ports; resolver compatibility supplies canonical
direction and zero, one, or multiple exact candidates. Both modes use the two
shared stages and permit **Ctrl+Enter** only after the same exact preview is
valid. The review exposes exact endpoints, rule and configuration, direct and
supporting nodes/edges, canonical generated policy changes, actions and scope,
owned-configuration identities/provenance, command targets, target readiness,
and declared or explicitly unknown security, cost, reliability, and availability
implications. Cancellation is a no-op. Editing uses the resolver's stable-
identity atomic batch only where the exact generated lifecycle permits it.

Multiple inbound triggers retain separate edge configuration and provenance.
Compatible input contracts may bind to the same workload where catalog and
workload rules allow it. Heterogeneous contracts without an explicit supported
dispatcher produce a visible warning for a draft and fail revision/compilation
readiness; no UI layer guesses the event type. Both modes recommend separate
functions when that is safer and expose the trigger edge, operation, contract,
dispatch identity/version, diagnostic code, and affected path through the same
**Technical details** disclosure.

## Generated-resource lifecycle preview

Generated nodes, edges, and graph-backed owned configurations display their
rule/version/operation provenance, ownership state, dependents, and whether they
are shared or adopted. A connection-removal or resource-lifecycle dialog
previews the exact domain result:

- release one dependency and retain because other provenance remains;
- retain because live graph references remain;
- require adoption before customization;
- retain permanently after explicit adoption;
- delete only when the reviewed release command proves both provenance and live
  references are zero; or
- fail closed because preconditions or ownership no longer match.

The UI does not offer a generic “delete related resources” shortcut, infer
cleanup from canvas proximity, or silently customize/remove a generated
resource. Non-invertible outcomes are labeled before confirmation. User-authored
owned configurations never enter a generated connection's cleanup closure.

## Validation workflow

Validation runs incrementally or on explicit request only when the applicable
workflow supports it. The UI displays:

- exact evaluated draft/revision identity and content hash;
- environment, target, provider, catalog, and engine version;
- running/current/stale/incomplete status;
- all six canonical severities without renaming their semantics;
- executed and skipped rules and safe engine diagnostics;
- stable affected paths and navigation;
- beginner and technical explanations and references; and
- manual remediation or a complete command-batch preview when provided.

The application layer, not the validation engine or UI, will eventually own
revision, compilation, and export gates. Until that policy is accepted, the UI
must present authoritative eligibility returned by the server and must not
describe `security-error` or any other severity as universally “blocking.”

The bounded local summary keeps these claims separate:

- **Diagram validity** reports only whether a complete current draft report has
  an `error` finding; security findings remain separately visible.
- **Draft validation** states whether `error` or `security-error` findings exist
  without inventing a blocking policy.
- **IaC-ready revision** is **Not available** because the browser document is a
  mutable local draft, not a server-authoritative immutable revision.
- **Target-specific readiness** reports modeling, configuration, validation,
  Terraform, CloudFormation, and generated-code status independently. A
  metadata-only target remains **Pending** even when graph modeling and local
  validation are supported; no compiler result is invented.
- **Warning acceptance** is **Not available** because no product-wide
  acknowledgement, suppression, or revision-gate policy is accepted.
- **Warnings reviewed** is scoped independently to the draft or compilation
  target and one exact content hash. It neither removes findings nor survives
  page reload/recovery; undoing to that exact hash may reveal the session
  marker.

A structurally valid local diagram does not prove that every production context
is secure. A complete local report also does not establish revision eligibility,
compiler readiness, cloud verification, export, or deployment.

## Revision creation

**Review revision** opens a dialog or full-height sheet containing:

- current persisted draft version and save status;
- current validation report identity, completeness, and staleness;
- provider, region, graph schema, catalog identity/version/digest, and intended
  compiler compatibility;
- assumptions and unresolved requirements;
- semantic change summary from the preceding revision when available; and
- the server-authoritative eligibility result and any required next actions.

Submission reauthorizes the action and revalidates the exact persisted draft.
Success creates a new immutable revision identity and cannot alter an existing
revision. Compilation is a separate job referencing that revision and its
content digest. A timeout or ambiguous response is resolved by idempotent status
lookup, not by creating another revision blindly.

## Generated code and diagram review

Artifact review always names the immutable artifact and its source revision. The
screen contains:

- an ordered manifest with file paths, media types, sizes, and digests;
- complete generated-code file and diff views;
- formatting/static-validation tool versions, outcome, and safe diagnostics;
- Presentation and Technical diagram profiles rendered from the same immutable
  revision;
- SVG and PNG variants with light opaque and transparent background options when
  present in the artifact;
- accessible diagram title/description plus a companion text architecture
  summary;
- renderer, layout, font, catalog, and asset-set versions/digests;
- validation evidence and architecture/version metadata;
- supported application source and built workload artifacts as separate manifest
  sections with their own generator/template/toolchain provenance and digests
  where present; and
- explicit secret/sensitive-reference redaction.

The diagram preview is an artifact renderer output, never a screenshot of the
browser canvas. It never depends on runtime hotlinks. A large diagram uses the
renderer-declared deterministic fit or tiling result; an oversized PNG that
cannot meet its bounded output policy fails explicitly rather than cropping.
Changing a preview zoom, background checkerboard, tab, or mode does not create a
new diagram or alter artifact bytes.

## Export workflows

### Immutable Solution export job

Creation begins on the exact immutable Solution Revision detail page. The form
selects only an approved environment/target profile and a portable export name;
it never submits tenant identity, coverage, manifest hashes, entitlement, or
artifact authority. Success navigates to a durable project-scoped job URL.

One shared Guided/Professional job page contains the exact revision/target
summary, a native progress element and ordered stage list, exact coverage,
warnings/unresolved behavior, diagnostics, Evidence, and these ordered tabs:
Sources, IaC, Application, Built artifacts, Tests, Diff, and Manifest. The file
navigator is a native nested list of buttons with `aria-current`; bounded UTF-8
content uses the code viewer, while binary entries show only safe metadata and
checksums. Terminal failure uses an assertive status and retains completed-stage
truth. Active progress uses a polite live region and the server's polling delay.

Guided and Professional modes render identical headings, tabs, controls,
disabled reasons, action order, selected job/tab/file, and geometry. Only the
reserved assistance paragraph differs. Infrastructure-only success displays an
application-code-required warning. Expiry removes the grant action but keeps
artifact metadata reviewable. Cross-tenant denial reveals no revision or
artifact details. Deterministic diagrams are implemented; GitHub and CLI actions
retain their own authorization and activation requirements. The current beta
Revisions entry defaults to infrastructure/diagrams and offers an explicit,
review-required application source draft. It does not execute that source.

### ZIP

The ZIP confirmation shows the exact artifact identity and digest, manifest,
verification status, warnings, estimated download size, and entitlement result.
The downloaded file is the reviewed immutable artifact; the UI does not
regenerate it at click time. A digest mismatch, expired artifact, authorization
change, or unavailable export fails closed.

### GitHub

The GitHub workflow:

1. authorizes the minimum repository scope through the approved integration;
2. lets the user select only authorized repositories and a target base;
3. proposes a branch name, pull-request title/body, and complete exact file
   change;
4. shows the diagram, generated-documentation reference, and exact supported
   application-source files included in the reviewed artifact;
5. reauthorizes the target and submits an idempotent request; and
6. reports branch/PR result, changed-base conflict, naming conflict, expired
   authorization, permission loss, or partial failure accurately.

It never generates source, installs dependencies, builds packages, force-pushes,
merges, deploys, writes files outside the reviewed artifact, or interprets
GitHub success as infrastructure success. Retry reuses the export operation
identity and cannot silently create duplicate pull requests.

## Billing and usage surfaces

Billing and usage are organization views, not Architecture Document state.

### Billing

The billing screen shows the trusted local subscription projection, its
effective/last-updated status, plan-derived entitlements and limits, and
owner-only **Manage billing** or approved Checkout action. It does not collect
card data. Returning from Stripe shows **Billing update pending** until a
verified, idempotently processed webhook changes the local projection; a success
URL never displays “plan active” by itself.

Pending, incomplete, stale, past-action-needed, canceled, failed-payment, and
other customer language remain subject to approved commercial/legal policy. The
UI must not invent prices, trials, taxes, refunds, proration, cancellation
access, support promises, or legal assurances.

### Usage

The usage screen emphasizes:

- Cloud Markup credits: organization allocation, available balance, reserved
  amount, settled consumption, and renewal period when defined;
- a history grouped by product operation with safe timestamps and outcomes;
- distinction between credit exhaustion, feature entitlement denial, product
  limit, and billing-platform failure; and
- an authorized opt-in technical disclosure for model/version, token counts,
  pricing-policy version, and estimated provider cost when available.

Credits are not money, card charges, provider tokens, or Stripe metered usage.
An estimate is not an invoice. The UI never edits or “corrects” the append-only
usage ledger; disputes and reconciliation use future authorized workflows.

## Responsive editor behavior

The width postures in
[Information Architecture](INFORMATION_ARCHITECTURE.md#responsive-route-behavior)
are normative initial breakpoints.

Desktop keeps the canvas full-size behind the persistent Catalog, fixed launcher
surfaces, and at most one rich popup. Below the desktop posture, those
destinations become the responsive drawers and sheets below; the breakpoint
transition preserves selection, focus destination, popup visibility intent,
dirty form state, and active destination.

### Tablet

- The main area toggles between visual canvas and list/tree review.
- Catalog and the five Inspector destinations become side drawers; only one
  occupies substantial width at a time. Architecture remains its own
  destination.
- Assistant, Issues, Code, Activity, and Jobs use a bottom sheet.
- Safe configuration and command review remain possible, but precision placement
  and boundary fitting show **Use desktop for precision layout**.
- Connection previews retain the same **Set up connection** and **Review and
  connect** stages in a sheet with persistent Back/Continue/Connect actions;
  revision and export previews retain their documented actions.

### Phone

- List/tree is the primary architecture view; a fit-to-screen image/diagram may
  supplement it but is not the only source of meaning.
- A compact header exposes project/lifecycle and a **Status** sheet containing
  save, mode, credits, validation, jobs, and export.
- Bottom navigation provides Architecture, Issues, Activity, and More.
- Node/edge/boundary details and configuration review open full-height sheets.
- Precision add-by-drag, draw-edge, free placement, multi-panel editing, and
  boundary resize are unavailable. Their alternative actions explain when
  desktop is required.
- Intent, findings, immutable revisions, manifest/diff, jobs, ZIP download, and
  authorized GitHub confirmation remain reviewable.

Responsive presentation never hides an unresolved requirement, validation
diagnostic, export warning, or read-only/unsupported state. It never turns a
desktop-only editing affordance into an implicit semantic default.

## Representative implementation states

Future component isolation and end-to-end testing must cover at least:

- authenticated and unauthenticated shell, organization switching, and all
  route-denied variants;
- independently selected comfortable/compact density, tablet, phone, 200% zoom,
  forced colors, reduced motion, and keyboard-only use;
- paired Guided/Professional fixtures with identical editor control trees,
  geometry, fields, order, dialog stages, actions, shortcuts, and disclosure
  state, allowing only reviewed assistance-copy differences;
- full-canvas desktop with the resizable Catalog open, closed, and reset; the
  fixed 92px Inspector and 48px Workspace launchers; every destination open or
  closed; one-at-a-time popup replacement; restored focus; fixture status
  present and absent; and minimap safe areas for every popup combination;
- blank, populated, read-only, unsupported, loading, offline, saving, queued,
  conflict, and failed editor states;
- catalog default/search-empty/filter-empty/load-failed/placeholder-icon states;
- expanded and compact 176-by-72 service nodes, bottom expand/collapse control,
  configured-name/icon fallback, double-click expansion, explicit Configure,
  boundary nodes, ports, and every defined edge/state combination;
- Lambda with no connections and with several populated connection groups;
- compact Lambda with at most one visible input and output aggregate dot, every
  exact handle preserved, hover/focus names, and expanded group restoration;
- one stable expanded dock with several exact edges and deterministic fan-out;
- grouped-connection popover open, long/scrolled, validation-error, exact-edge
  selected, and keyboard-focused dock states;
- IAM role permissions summary with generated permissions, zero/one/multiple
  custom inline policies, trust policy, managed-policy attachment, and optional
  permissions boundary kept distinct;
- structured policy editor add/edit/duplicate/remove statement, wildcard,
  invalid-principal, malformed-condition, and duplicate-statement findings; and
- target-readiness matrix with modeling/configuration/validation and bounded
  notes-API plus curated networking Terraform support while CloudFormation
  remains pending;

- no/single/multiple selection and a deleted or unauthorized selection;
- the Architecture destination plus Configure, Connect, Learn, and IaC Inspector
  popups, schema errors, hidden advanced values, metadata-only IaC, and
  unsupported configuration;
- assistant unavailable/reserving/running/refused/schema-rejected/proposal
  review, and credit exhaustion;
- validation current/stale/running/incomplete, every severity, diagnostic,
  manual remediation, auto-fix preview, and fix conflict;
- both shared connection stages, **Technical details**, compatible/incompatible/
  unresolved/stale preview/atomic failure/success, and generated-resource
  retain/adopt/release/delete outcomes;
- revision ineligible/submitting/ambiguous/success and compilation job states;
- code/diagram/manifest/diff/verification/oversized-diagram states;
- ZIP ready/expired/digest failure and GitHub authorization/conflict/partial
  failure/idempotent success;
- billing projection pending/stale/updated/denied and usage
  available/reserved/exhausted/technical-detail states; and
- dialogs, drawers, popovers, menus, toasts, notifications, focus restoration,
  and live-region announcements.

Pinned Storybook 10.5.4 is a development-only component-isolation dependency
with synthetic stories and accessibility-addon feedback. It is not browser
visual-regression or conformance evidence. The pinned Playwright Chromium suite
now exercises bounded editor geometry, interaction, connection, layout, history,
recovery, validation navigation/readiness, safe fixes, focus restoration, forced
colors, reduced motion, and selected browser-injected `axe-core` scans. The
isolated manual-notes fixture models an authenticated API architecture while the
shell remains an unverified local mock. Screenshot baselines, cross-browser
evidence, screen-reader testing, complete workflows, and formal visual or
accessibility conformance remain future work.

## Desktop configuration refinement

[ADR-0058](../adr/0058-desktop-service-configuration-and-appearance.md) defines
service-family navigation, reviewable variant changes, browser-local light/dark
appearance, and the AI project-creation prompt and review flow. Configure places
application purpose and IAM permissions first; Technical details and Target
readiness are omitted. Tutorial targets receive four-pixel blue outlines on the
actual open menu. The catalog uses compact chrome and a quiet diagnostics
disclosure.

The
[desktop readability refinement](../adr/0059-desktop-canvas-readability-and-utilities.md)
uses theme-aware two-pixel connection paths with matching arrowheads and thin
service outlines. Catalog, right and bottom launchers, and open canvas panels
share a 76%-opaque blurred background with solid controls and opaque
accessibility fallbacks. The Issues count replaces its icon; positive counts are
red and include accessible text, with neutral zero/checking states.

### Workspace dashboard and entry continuity

The organization Dashboard is the default authenticated landing page when a
single organization is available. It offers Create with AI, blank canvas,
templates, import, recent projects, recorded credit balances and a project
snapshot. Counts describe the loaded latest 100 projects; current credit totals
are not presented as historical trends. Loading, denied, unavailable and empty
states remain distinct. Creation links follow verified capabilities. Create with
AI preselects the prompt on project creation before entering the editor.

Main pages float over the same canvas-colored grid used by the editor. Menu,
profile and tutorial surfaces share clearer 4px glass with accessible opaque
fallbacks. A dismissible first-visit workspace tour anchors beside and
highlights the reorganized navigation and can be restarted from Dashboard. It
stores completion per actor in the browser; it does not claim account-wide
completion.

Opening or creating a project shows a compact progress indicator over the grid
while route code, the authorized draft and initial editing access load. It does
not briefly show the standard navigation sidebar. The opening canvas grid uses a
24-pixel screen spacing matching the workspace/loading background at the initial
fitted zoom. Later zooming scales the grid normally.

Clicking or keyboard-activating the minimap opens Canvas actions. Below 70%
zoom, collapsed services simplify into readable label/icon tiles; below 35%,
they use compact icons with full accessible names and hover titles. Expanding a
distant service keeps the current zoom and pan. Presentation changes do not move
resources or change graph hashes or saved layout.

Desktop Configure, Connect, Learn and Architecture inspectors share a narrow
initial width with drag and keyboard resizing. Boundary headings reserve the
child-content area, and reviewed AI proposals separate colliding siblings only
after nested boundary sizes are known. These presentation moves use the existing
atomic command engine and preserve semantic hashes. See
[ADR-0061](../adr/0061-desktop-panel-and-layout-continuity.md).

## M9 reviewed AI presentation

Feature the AI creation entry on the project home and retain equally accessible
blank, template and import paths. Dashboard cards and menu affordances may use
brief entrance/hover transitions; respect reduced motion and forced colors,
preserve visible keyboard focus and never animate semantic canvas geometry. The
shared AI review presents context, generation/checks and explicit acceptance,
with before/after settings and advisory review wording. Clarifying questions and
assessment-only responses have no apply action. Source exports use the same
credit receipt language and explain that downloaded drafts require review/tests.
See [ADR-0066](../adr/0066-reviewed-canvas-ai-context.md).
