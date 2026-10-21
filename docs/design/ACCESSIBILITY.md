# Accessibility

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

> **Specification status:** This document defines normative accessibility
> requirements for Cloud Markup interfaces and artifacts. The current bounded UI
> includes semantic component, isolated visual, and Chromium workflow evidence,
> including a synthetic AWS networking editor fixture, but no release-level
> accessibility conformance claim exists.

## Standard and scope

Cloud Markup targets WCAG 2.2 Level AA for public, personal, organization,
project, editor, review, billing, usage, job, and export experiences. The target
also applies to authentication handoffs under Cloud Markup control,
deterministic diagram outputs, and supported responsive layouts.

Accessibility is a correctness requirement. It cannot be reduced by choosing
Professional mode, using a narrow screen, or interacting with a graph. A person
must be able to understand and complete every critical workflow without relying
only on color, icon shape, canvas position, pointer dragging, hover, animation,
sound, or provider-logo recognition.

This specification works with the [Design System](DESIGN_SYSTEM.md),
[UI Specification](UI_SPEC.md), and
[Guided and Professional Modes](GUIDED_AND_PROFESSIONAL_MODES.md). The
Architecture Document and shared domain commands remain authoritative; an
accessible alternative invokes the same validated commands as the canvas.

## Perceivable structure and content

### Page structure

- Every page has one descriptive page title and one visible level-one heading.
- Landmarks identify header, navigation, main content, complementary panels, and
  footer where present. Repeated navigation has an accessible name.
- A skip link moves focus to the primary content. Editor layouts also provide
  skip links to the service catalog, graph representation, inspector, bottom
  workspace, and status area.
- Heading order follows content structure and does not depend on visual size.
- Tables use headers and captions where needed. Lists and trees use their native
  or correctly authored semantic structures.
- Icon-only controls have stable action names. Service identity uses catalog
  `displayName`, never an opaque provider icon ID.

### Text, zoom, and reflow

- Text supports browser zoom to 200% without loss of content or action.
- Non-canvas content reflows at 400% equivalent zoom to a single logical column
  except where a two-dimensional table, code diff, or diagram genuinely requires
  two-dimensional scrolling.
- Text spacing overrides at WCAG test values do not clip labels, values,
  instructions, or status.
- The interface does not disable browser zoom or require a fixed device
  orientation.
- Truncation retains access to the complete value by focus and activation, not
  hover alone. Sensitive values remain redacted.

### Color and non-color cues

- Normal text meets at least 4.5:1 contrast. Large text meets at least 3:1.
  Interactive boundaries, meaningful graphics, focus indicators, and state
  changes meet at least 3:1 against adjacent colors.
- Every validation severity includes text and an icon or shape in addition to
  color.
- Every edge meaning combines line pattern, arrowhead, optional icon, and a text
  label. Direction and relationship type remain available in the list/tree
  representation.
- Networking boundary tiers combine visible Region/VPC/AZ/subnet labels with
  distinct border treatments. Public/private intent, association counts, route
  purpose, managed-service placement, and Lambda VPC access remain available as
  text in the node, owner summary, edge label, or synchronized list rather than
  color or nesting alone.
- Selection, generated provenance, compatibility, permission, stale state, and
  validation state each have non-color indicators and accessible text.
- Data visualizations include a text summary and data table or list where the
  underlying values matter.

### Forced colors and contrast preferences

- In forced-colors mode, system colors and visible borders replace decorative
  fills and shadows. Focus, selection, checked state, disabled state, findings,
  nodes, ports, and edges remain distinguishable.
- Icons that convey state use `currentColor`, a visible system-color outline, or
  an equivalent forced-colors treatment.
- Background images and provider icons are not the only service or status
  identifier.
- High-contrast behavior is verified for every representative isolated state
  listed below.

## Keyboard and non-canvas operation

### Global keyboard rules

- All functions are operable with a keyboard, with no keyboard trap.
- Tab and Shift+Tab follow the visible workflow order. Composite widgets use
  roving focus or `aria-activedescendant` according to their established
  pattern; they do not add every internal item to the page tab sequence.
- Enter activates links and primary actions. Space activates buttons and
  selection controls. Escape closes the topmost dismissible surface without
  applying changes.
- Menus, tabs, listboxes, trees, grids, dialogs, and comboboxes follow the
  applicable WAI-ARIA Authoring Practices interaction pattern.
- Shortcuts invoke the same authorized Graph Commands as visible controls.
  Single-character shortcuts are active only while the relevant graph composite
  has focus and are disabled in text-entry controls. A discoverable shortcut
  reference lists every active shortcut.
- No action requires a multipoint gesture, path-based pointer gesture, drag, or
  simultaneous key press when a simpler alternative can perform it.
- Both modes expose the same keyboard behavior and the same shortcut hints in
  controls, menus, **Commands**, and **Help**.

In the current bounded M1 editor, `C` starts the connection workflow only while
a selected resource in the canvas or synchronized Architecture list composite
has focus. It is not a document-wide shortcut and is ignored in text-entry and
unrelated controls. Every listed port also has a labeled **Connect** button, and
the selected node toolbar and Inspector expose the same resolver-backed action.
In both modes, **Ctrl+Enter** confirms only an already prepared atomic preview.
Escape or **Cancel** closes the dialog without changing the document and
restores focus through the shared dialog behavior.

Capability actions are grouped under labeled headings rather than communicated
by handle position. Every action announces direction, purpose, whether it allows
one or many relationships, current utilization, and unavailable reason when no
provider rule supports the pairing. Both modes use the same labels and expose
authorized opaque IDs and diagnostic paths through the same labeled **Technical
details** disclosure, never color or hover alone. Adding future Lambda
capabilities cannot make pointer-only canvas handles the sole way to discover
them.

Every non-boundary service starts compact when an editor session is created or
reset. Its left input and right output aggregate points are visual groupings
only. Every exact capability group remains named on hover and keyboard focus,
available in the adjacent detail popup, and represented in the synchronized
Architecture list. The visual grouping retains exact edge endpoint identities;
it must not collapse assistive-technology or list actions into an ambiguous
generic port. Expanding the service exposes the same individual group dots and
controls.

### Accessible graph representation

The editor provides a synchronized **Architecture list** in the desktop/tablet
Inspector popup or in place of the visual canvas on phones. The right-side
**Architecture** launcher and **Architecture list** in the global **Canvas**
popover open and focus the same authoritative copy; skip navigation opens and
focuses the containing inspector, while the list is already the primary phone
view. It is not a lossy transcript. It exposes:

- boundaries as expandable tree groups with explicit semantic membership;
- nodes with catalog display name, user label, type, validation summary,
  provenance, compatibility, and permission state;
- input and output ports with compatible-connection actions;
- incoming and outgoing edges with direction, relationship label, endpoints, and
  validation summary;
- nodes and edges not visually located inside the current viewport; and
- current selection, changed state, and the exact draft or revision identity.

For networking documents, the list exposes exact Region-to-VPC-to-AZ-to-subnet
membership and keeps root-managed Lambda, DynamoDB, and security-group resources
outside that containment. Route tables expose their subnet associations and key
routes through owner summaries; security groups expose association counts and
rules; Lambda exposes its VPC access subnets and security groups. A visual
boundary collapse may hide descendant canvas renderings but cannot remove these
semantic facts or change list placement.

The selected resource's labeled **Boundary placement** region lists only
catalog-valid parents, previews the exact target and relative position, reports
rejection as text, and applies the same atomic command as pointer placement.

Port details under each resource start collapsed. The resource-selection row and
disclosure toggle are separate controls; the toggle exposes its controlled
region and expanded state through an exact **Show/Hide details** name.
Validation navigation expands the containing resource before handing focus to an
exact port, while collapsing port details never hides child resources.

The list and canvas share selection but neither derives architecture meaning
from the other. Selecting an item in the list may bring its canvas rendering
into view; doing so changes no serialized position unless the user invokes an
explicit move command.

### Critical-task alternatives

| Task                            | Keyboard/list-tree alternative                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add a service                   | Focus the **Search services** field, open a native catalog-derived category disclosure, review the service summary and support state, then activate the explicit **Add** control. The same add-node command is used.                                                                                                                                                                                                               |
| Connect endpoints               | From a node toolbar, Inspector, or labeled port action in the Architecture list, choose **Connect**; a focused selected resource may also use `C`. Select a rule-engine-compatible target or relationship, answer required questions, review the exact atomic batch, and confirm. Dragging between ports is optional.                                                                                                              |
| Read a connection               | Expand the labeled capability category and connection for either endpoint. Both modes expose direction, purpose, multiplicity, endpoints, IAM effects, findings, and the same **Technical details** disclosure with exact authorized IDs and paths.                                                                                                                                                                                |
| Move a node                     | Open **Move**, choose an ordered position command or enter an allowed coordinate through labeled fields, review the presentation-only result, and apply.                                                                                                                                                                                                                                                                           |
| Reparent a node                 | Open **Change boundary**, choose a catalog-valid parent, review the exact target and semantic containment command, and apply. **No parent** appears only when valid; a subnet offers only Availability Zones, never root, a VPC, or another subnet. A visual drop is optional.                                                                                                                                                     |
| Fit or arrange a boundary       | Choose **Fit boundary to contents** or an available automatic-layout action from the boundary menu, review whether the operation changes presentation only, and apply.                                                                                                                                                                                                                                                             |
| Open item actions               | Focus the item in the architecture list and press Shift+F10 or activate its labeled **Actions** button.                                                                                                                                                                                                                                                                                                                            |
| Edit configuration              | Activate the right-side **Configure** launcher or **Configure** from the item/list; move through labeled schema-driven fields and an error summary; review the exact command before consequential application. Double-clicking a service is an optional pointer shortcut only.                                                                                                                                                     |
| Review or define implementation | Open **Configure**, then the **Implementation** heading. Read mode, runtime, handler, bound triggers/actions, dispatch policy, missing decisions, user-code requirement, and truthful starter-generation availability. When an operation is editable, enter its purpose and strict named input/output contract lines, review the atomic Workload Behavior/Application Contracts command, and apply without entering a code editor. |
| Navigate findings               | Use the Issues heading and severity filters, select a finding, then activate **Go to affected item**. Focus moves to the exact list/tree item or configuration field and the affected path remains available.                                                                                                                                                                                                                      |
| Apply a proposed fix            | Review the complete Graph Command batch, changed paths, preconditions, and conflicts in a dialog, then activate the specifically named apply action.                                                                                                                                                                                                                                                                               |
| Create a revision               | Open **Create revision**, review current validation completeness and applicable gates, then confirm against the exact persisted draft version.                                                                                                                                                                                                                                                                                     |
| Review code or diagram          | Navigate the file tree, diff regions, diagram text summary, and architecture list without requiring canvas pan or zoom.                                                                                                                                                                                                                                                                                                            |
| Export                          | Select the exact immutable artifact, review its manifest and status, choose ZIP or authorized GitHub export, then confirm the named destination and action.                                                                                                                                                                                                                                                                        |

If a visual affordance gains a new semantic action, the synchronized list/tree
or another non-drag control must gain that action in the same change.

## Focus

- Keyboard focus is always visible. The default indicator is a 2px focus ring
  with a 2px offset and meets the design-system contrast requirement against
  adjacent colors.
- Focused and selected are separate states. Selecting a graph item does not hide
  its focus indicator.
- Opening a modal dialog moves focus to its heading or first appropriate
  control. Focus remains contained until the dialog closes. If a modeless
  Inspector or Workspace surface is open, it is dismissed before modal focus is
  established and cannot restore focus over the modal task.
- Closing a dialog, drawer, menu, command palette, popover, or inline workflow
  returns focus to the invoking control. If that control was removed by the
  completed action, focus moves to the nearest stable parent or the next logical
  item and the change is announced.
- Closing an Inspector or Workspace popup returns focus to its right-side or
  bottom launcher. Switching launcher content maintains one popup, preserves
  dirty state, and moves focus to the new heading or first appropriate control
  without sending focus through the canvas.
- The selected-element overview above the Inspector tabs is a named disclosure
  that starts closed for each selected target. Its compact summary remains
  understandable, the tabs remain immediately next in focus order, and toggling
  it does not change selection or move focus away from the control.
- Route changes place focus at the new page heading after the destination title
  updates. Same-page updates do not reset focus.
- Validation, autosave, job, billing, and updates to Cloud Markup credits never
  steal focus.
- Focusing an offscreen graph item may pan the visual canvas only when that
  behavior does not create motion against the user's preference. The list item
  remains the focus owner.
- Hover never reveals the only control needed to continue. Controls shown on
  hover are also shown on focus and available through the item action menu.

## Pointer and touch targets

- Both modes use identical pointer-target geometry. Frequently used desktop
  actions target 32px by 32px or larger; other compact desktop controls remain
  at least 24px by 24px with adequate separation.
- Touch and coarse-pointer controls provide at least a 44px by 44px interaction
  target.
- Compact is the default visual density on fine-pointer desktop layouts; the
  touch/coarse-pointer target override remains 44px and does not depend on
  Guided or Professional assistance mode.
- Precision canvas ports and handles retain an invisible 44px by 44px hit region
  in both modes, with overlap resolution that never activates a different
  element silently.
- In compact service projections, one visible input aggregate may occupy the
  left side and one visible output aggregate the right. Exact grouped handles
  retain distinct IDs and relationships even when their visual points overlap.
  Their tooltip and adjacent popup name all represented groups on hover and
  focus; the list/tree exposes the same names and connection actions without
  precision pointing.
- Adjacent compact targets have enough separation to prevent accidental
  activation. When target regions would overlap ambiguously, use a menu or
  stepped selection instead.
- Dragging has cancel and undo behavior and never remains the sole operation
  method.
- Pointer-down alone does not commit a consequential action. Activation occurs
  on release over the intended target or through an explicit confirmation.

## Forms, errors, and changes

- Every field has a persistent programmatic label. Instructions and constraints
  are associated with the field; placeholder text is never the label.
- Required state, accepted units and formats, value source, security/cost notes,
  and read-only state are communicated programmatically and in visible text.
- Errors identify the field and correction without echoing secret or unsafe
  input. A submission error summary links to each invalid field.
- Validation is not triggered only on every keystroke. It runs at a predictable
  boundary such as blur or submission, while destructive format correction
  requires review.
- Schema-driven controls preserve tagged value sources and advanced values.
  Collapsing a section or switching mode cannot clear a value.
- Read-only values are distinguishable from disabled controls and remain
  selectable where safe. A disabled control has an adjacent explanation when the
  reason is not otherwise clear.
- A changed value is indicated with text, not color alone. Reverting names the
  exact value source or prior state.
- Time limits are avoided. When security or external authorization imposes one,
  warn the user, preserve safe work, and provide an extension or restart path
  where allowed.

## Dialogs, drawers, menus, and notifications

- Use a modal dialog only when the user must resolve a bounded decision before
  continuing. Consequential dialogs name the object, exact effect, and shared
  confirmation action.
- Drawers and non-modal panels remain in the page focus order and do not apply a
  focus trap.
- Desktop Inspector and Workspace launchers open one modeless rich popup at a
  time. Every launcher and popup has a visible label, the popup has a heading
  and explicit close action, Escape dismisses it, and dismissal restores the
  invoking launcher. Opening a modal task dismisses that modeless popup without
  moving focus out of the modal. Responsive modal drawers use their existing
  contained-focus behavior.
- Editor menus, connection-dock actions, popovers, modeless popups, and dialogs
  are positioned within the workspace landmark below the application bar. Only
  one transient contextual surface is active at a time, so keyboard and screen-
  reader users do not encounter a visually hidden open menu behind another
  workflow.
- Menus expose unavailable items as disabled only when learning about the
  unavailable action is useful; otherwise omit them without leaving an empty
  menu. A nearby explanation must not disclose unauthorized data.
- Tooltips supplement a visible label or accessible name. They are dismissible,
  hoverable, and available on focus, but never contain required instructions.
- Toasts never contain the only record of failure or success. Persistent status
  remains in the page, job, activity, or issues view.
- Destructive and generated-resource lifecycle confirmations explain shared,
  adopted, customized, retained, and referenced states. They do not promise
  automatic deletion before the command result is known.

## Announcements and screen-reader behavior

Persistent labeled status regions summarize draft synchronization, validation
completeness, long-running jobs, and relevant entitlement state. Detailed
history remains in the associated panel. In the bounded editor,
graph-command/action output and validation lifecycle output use separate polite,
atomic live regions. Validation clears and reannounces for each generation
without overwriting the exact action result; interaction tests register before
the command and observe the validation cycle before asserting that the command
announcement remains available.

- **Polite announcements:** saved, queued offline, selection changed through a
  command, validation completed, job progress stage changed, filter results, and
  mode switched.
- **Assertive announcements:** save failure, stale conflict, invalid command,
  failed atomic batch, validation becoming incomplete, expired authorization,
  and a modal dialog submission error.
- Rapid updates are coalesced. Progress percentages are announced at meaningful
  intervals, not every change.
- Selecting or focusing a node announces its display name, element kind, place
  in the architecture list, validation summary, and read-only state. Full
  configuration is available on demand rather than spoken automatically.
- A successful graph mutation announces the ordered high-level change summary. A
  failed batch announces that no changes were applied.
- A mode switch announces the new presentation and confirms that architecture
  data did not change.
- Validation announces complete, incomplete, or stale before the finding count.
  A zero count alone is never announced as clean.
- Async status uses live text, not animation alone. Cancellation, failure, and
  retry availability are distinct.
- Denial announcements use bounded copy and reveal no cross-tenant resource
  existence.

Deterministic diagrams include an accessible title and description plus a
companion text representation listing boundaries, nodes, connections, direction,
and relevant validation state. The companion text is derived from the same
immutable revision and must not expose redacted values.

## Current canvas limitations and fallback controls

React Flow remains a spatial visual projection. Automated DOM scanning cannot
certify spatial comprehension, screen-reader traversal, magnification geometry,
pointer precision, or how third-party assistive technology announces React Flow
internals. A browser scanner also cannot prove that a person understands the
architecture or the consequences of a command.

The bounded M1 editor therefore provides these non-canvas paths:

- The synchronized **Architecture list** represents every node, boundary, edge,
  and typed port; selects nodes, boundaries, and edges; names direction and
  relationship meaning; and starts connection workflows through labeled port
  controls.
- Catalog **Add**, keyboard activation, the Inspector placement selector,
  connection actions, configuration forms, history controls, and safe-fix
  confirmation invoke the same Graph Command paths without requiring drag.
- Issues exposes text severity, title, resource grouping, affected path, and a
  separately labeled **Go to affected** control for every reported location.
  Navigation opens the appropriate Inspector context and focuses/highlights the
  exact list item, port, edge, boundary, or configuration field.
- Validation completeness, readiness, unavailable warning acceptance, separate
  session-local warning review, and manual-action status use visible text and
  semantic status treatment; color is never the only cue.
- Phone layouts keep the Architecture list and findings as the primary review
  experience rather than presenting precision canvas construction.

Precision dragging, port drawing, pan, zoom, minimap use, automatic layout, and
visual highlighting are supplemental. The current automated evidence covers
selected Chromium axe scans plus semantic, keyboard, focus, forced-colors, and
reduced-motion assertions. It does not certify WCAG conformance, screen-reader
behavior, Firefox or WebKit, touch devices, spatial understanding, or
large-graph accessibility. The human checklist in M1 manual-editor demo records
the available fallback controls without replacing assistive-technology review.

## Motion, animation, and time

- Respect `prefers-reduced-motion` from first render. Do not play an initial
  transition and remove it only after preferences load.
- With reduced motion, panel, dialog, toast, selection, pan, zoom, automatic
  layout, and route transitions are instant or use a non-moving opacity change.
- No status depends on animation. Loading indicators include text.
- Avoid flashing content and any sequence that exceeds the WCAG flash
  thresholds.
- Automatically moving content can be paused, stopped, or hidden. Cloud Markup
  does not use auto-advancing tutorials.
- Canvas auto-layout previews do not continuously animate. The user may review
  the final proposed arrangement before a presentation command is applied.

## Responsive behavior

### Desktop

The full editor exposes skip links and landmarks for the catalog, canvas/list,
inspector, and bottom workspace. Resizing or collapsing panels preserves focus,
selection, and the architecture-list alternative. Catalog is the sole
edge-resizable desktop panel. Inspector tools use a compact right launcher and
Workspace tools use a compact bottom launcher; each opens the same authoritative
content in one modeless rich popup without creating a duplicate document
representation. A skip link or explicit invocation opens and focuses the
corresponding popup when it is closed.

The Catalog resize edge exposes a keyboard-focusable separator with the correct
orientation and current value text. The approximately 8px transparent hit edge
contains a 1px visible boundary that strengthens on hover, focus, and active
resize. Arrow keys move by 8px and Shift+Arrow by 32px. Catalog stops at 224px
and its viewport maximum preserves a 320px usable canvas lane. Reaching a limit
is deterministic and announced without losing focus. Inspector and Workspace
launcher popups are not separators, do not resize, and do not reserve persistent
canvas lanes. Their content has one scrolling region, a labeled close action,
deterministic Escape behavior, and focus restoration.

### Tablet

The architecture list remains primary and panels may become modeless drawers.
Only one secondary panel needs to be visually open at a time, but all content
and actions remain reachable. A drawer transition must not reset the active tab
or dirty form.

### Phone

Phone layouts use the architecture list/tree for review, findings, explanation,
revision/artifact status, comments, and authorized export actions. They do not
present a precision construction canvas. Unsupported editing actions are
identified explicitly; they are not shown as controls that silently fail or
perform a different mutation.

Both modes retain the same semantic data and accessible review actions at every
size. Orientation changes and breakpoint transitions preserve current context
and focus.

## Representative isolated states

Future component-isolation and browser suites must cover the following states
without requiring live provider, model, billing, compiler, or network access.
Fixtures are synthetic, deterministic, version-pinned, and contain no secrets.

### Shell and navigation

- public, authenticated, loading identity, session expired, denied,
  unsupported-version, and not-found;
- paired Guided and Professional first-use and restored-preference states with
  identical control trees, geometry, focus order, fields, stages, actions, and
  disclosures;
- personal, organization, and project context;
- online, offline, saving, queued, conflict, failed, saved, and read-only;
- entitlement available, limit reached, and safely undisclosed;
- desktop, tablet, phone, 200% zoom, 400% reflow, forced colors, and reduced
  motion.

### Panels and catalog

- Catalog open, collapsed, and resized to its 224px and viewport limits; each
  right and bottom launcher popup open, switched, closed, loading, empty,
  failed, retried, read-only, and containing long localized text;
- Catalog pointer and keyboard resize from the full 8px hit edge, 1px visual
  boundary, and limit announcements; fixed launcher footprints, one-popup
  switching, one popup scroll owner, Escape dismissal, and focus restoration;
- workspace-bounded menu/popover/dialog placement, single-transient dismissal,
  and modeless Inspector/Workspace dismissal before modal focus;
- catalog loading, no supported entries, no search results, grouped results,
  placeholder icon, approved icon, unsupported capability, descriptor-only
  relationship, mapping-metadata-only service, and region availability unknown;
- keyboard search, native category-disclosure navigation, Details disclosure,
  and the explicit add-service action.

### Nodes, ports, boundaries, and edges

- node default, hover, focus, selected, multiselected, dragging, read-only, and
  denied;
- every validation severity: `security-error`, `error`, `cost-warning`,
  `warning`, `recommendation`, and `educational-note`;
- complete-with-no-findings, incomplete, stale, incompatible, unsupported, and
  region-unknown;
- user-created, template-created, AI-proposed then accepted, wizard-generated,
  migration-generated, shared, adopted, customized, retained, and releasable
  provenance;
- boundary default, focused, selected, empty, nested, invalid parent,
  presentation-only fit/layout preview, and presentation-only collapsed;
- networking outer Region, primary VPC, secondary Availability Zone, and
  tertiary subnet tiers with readable minimum content space, bounded ancestor
  growth, long labels, and forced-colors borders;
- public and private subnet text, route-table and security-group associations,
  hidden owner summaries, managed services at root, and Lambda VPC access with
  multiple subnet/security-group references;
- port available, focused, compatible, incompatible, cardinality exhausted,
  missing, source, and target;
- service expanded and compact, aggregate input/output focused and activated,
  exact handle/edge identity preserved, hover/focus names, adjacent popup,
  bottom toggle, and double-click plus non-pointer Configure alternatives;
- edge focused, selected, read-only, invalid, incomplete, and each presentation
  kind: synchronous invocation, asynchronous event, read, write, read/write,
  authentication, network route, IAM permission, dependency, and generic;
- overlapping, bidirectional, long-label, offscreen-endpoint, and unknown
  relationship cases with a complete list/tree equivalent;
- combined interaction, validation, provenance, compatibility, and permission
  layers in forced colors and without provider icons.

Presentation kinds without an exact catalog relationship remain visual-system
fixtures only. Network-route and networking-association kinds now have exact
catalog-backed cases; stories and tests must not assign them by CSS, display
name, or inferred containment.

### Inspector and bottom workspace

- Configure, Connect, Learn, and IaC tabs with loading, available, unavailable,
  unsupported, empty, read-only, invalid, dirty, saving, and failed states;
- required, optional, advanced, referenced, literal, default-proposed, redacted,
  and validation-affected fields;
- non-policy owned configuration absent, created, valid, invalid, edited,
  associated, removal-previewed, removed, undone, and redone; exact subnet and
  security-group association controls expose names, cardinality, unavailable
  reasons, current relationships, and cleanup consequence without requiring a
  hidden canvas node or pointer connection;
- workload purpose and strict input/output contract authoring with safe parsing,
  atomic preview/apply/undo, stale preconditions, unsupported ownership, and
  credential-shaped input rejection without value reflection;
- Assistant proposed, refused, schema-rejected, timed out, quota-exhausted, and
  ready-for-review;
- Issues complete-empty, findings at every severity, incomplete, stale,
  diagnostic, conflicting fixes, and no-safe-fix;
- Code unavailable, compiling, generated, static-validation failed, and
  immutable artifact review;
- Activity empty, paginated, loading, failed, and redacted;
- Jobs pending, running, succeeded, failed, canceled, retryable, timed out, and
  resource-exhausted.

### Previews, credits, exports, and dialogs

- **Set up connection** and **Review and connect** with the same fields, order,
  actions, shortcuts, focus behavior, and **Technical details** disclosure in
  both modes, including direct changes, supporting resources, exact IAM effects,
  warnings, and failed atomic application;
- generated-resource release retained because shared, retained because live
  references remain, adopted, customized, safely releasable, and rejected;
- Graph Command and auto-fix previews with precondition failure and fix
  conflicts;
- credits available, reserved, low, exhausted, ledger unavailable, estimate
  unavailable, and technical details unauthorized;
- checkout return pending projection, active projection, webhook delay,
  entitlement denied, and portal failure;
- no revision, validation not ready, compilation unavailable, artifact pending,
  artifact ready, manifest/diff review, ZIP succeeded/failed, and GitHub
  authorization expired/conflict/partial failure/success;
- alert, confirmation, destructive action, stale conflict, command palette, long
  content, nested error summary, and focus restoration after the invoking item
  is removed.

Every isolated state includes its accessible name, role, state/value properties,
focus order, keyboard behavior, status text, live-announcement expectation,
pointer target, forced-colors appearance, and reduced-motion behavior.

## Verification

### Automated

- Run semantic, keyboard, focus, contrast, forced-colors, reduced-motion,
  responsive, and zoom assertions against isolated components and selected
  workflows.
- Use the current pinned Storybook isolation, semantic component tests, and
  bounded Playwright Chromium workflows for representative states. The manual
  editor browser flow injects the pinned `apps/web` development-only `axe-core`
  source into selected local editor/Issues/fix-dialog states.
- The AWS networking Chromium specification injects that same local `axe-core`
  source into the fitted synthetic networking canvas, Lambda VPC access help,
  and the Boundary placement Inspector. The transformed canvas target-size rule
  is excluded where viewport clipping makes its result invalid; untransformed
  help and placement controls are scanned separately. This is bounded Chrome/axe
  evidence, not assistive-technology or WCAG conformance.
- Assert four labeled boundary tiers, readable derived sizing, textual
  public/private and association state, owner summaries for hidden
  configurations, managed services outside VPC containment, valid-AZ-only
  keyboard placement, announced invalid drops, and atomic undo/redo.
- Assert no critical action is canvas-only, drag-only, hover-only, icon-only, or
  color-only.
- Assert the synchronized architecture list invokes the same command schema and
  receives the same result as the corresponding canvas action.
- Test mode switching for identical control trees, geometry, accessible names,
  focus order, fields, stages, actions, shortcuts, and disclosure state while
  allowing only assistance-copy differences; also test panel reflow, route
  changes, dialogs, and item deletion for deterministic focus restoration.
- Test compact/expanded service projections against the same serialized graph,
  exact handle IDs, edge endpoints, document hash, and command history. Exercise
  every launcher with keyboard-only open, switch, Escape, explicit close, and
  invoking-control focus restoration.
- Test that menus, connection-dock popovers, Inspector/Workspace modeless
  surfaces, and modal workflows remain within the workspace boundary, that a new
  transient surface dismisses the previous one, and that opening a modal cannot
  leave modeless content interactive or steal modal focus.
- Include incomplete, stale, denied, unsupported, offline, and failed fixtures;
- Assert that new and reset editor sessions start every non-boundary service
  compact; Architecture resource details and selected-element context start
  collapsed with correct controlled-region state; validation reveals an exact
  hidden port; compact findings retain a non-color cue; and Inspector tabs stay
  immediately reachable without changing graph hashes or history.
  Happy-path-only accessibility evidence is insufficient.

Automated scanners supplement, but do not replace, keyboard and assistive
technology review.

### Manual

Before release of an owning milestone, test representative critical workflows
with:

- keyboard only at desktop, tablet, and phone layouts;
- screen reader plus keyboard on at least one Windows browser combination and
  VoiceOver with Safari;
- browser zoom, text-spacing overrides, forced colors, and reduced motion;
- pointer and touch input at independently selected comfortable and compact
  densities; and
- the diagram companion text without viewing the rendered diagram.

The review covers project creation, intent review, adding and configuring a
service, connecting endpoints, navigating and addressing a finding, resolving a
draft conflict, creating a revision, reviewing an artifact, and starting each
authorized export path.

The bounded novice and Professional usability sessions use the M1 onboarding
usability script to record keyboard/non-drag alternatives, teaching
comprehension, mode parity, and truthful future revision/export placeholders.
That script complements this manual accessibility review; it is not
assistive-technology or conformance evidence.

### Release evidence

Accessibility evidence records the tested build, browser and assistive
technology versions, fixture versions, failures, waivers with owner and expiry,
and remediation results. A critical workflow defect, keyboard trap, missing
accessible alternative, focus loss that prevents completion, or materially
incorrect status announcement blocks the affected feature's release claim.

The current shell and synthetic manual-editor foundation provide bounded
automated semantic, keyboard, focus, target-size, and selected Chromium axe
evidence, including the manual notes-API, safe-fix, and AWS networking
hierarchy/help/placement flows. AWS networking editor component evidence covers
canvas mode parity, collapse/hash invariance, valid-AZ-only placement,
invalid-drop announcements, owner-surfaced associations, reviewed association
retargeting, and undo/redo.

The networking editor's bounded automated accessibility scope covers neutral
generic **Owned configurations** labels, identical mounted **Technical details**
structure across assistance modes, the exact 176-by-72 compact wrapper,
invariant dock/edge coordinates through disclosure and scrolling, bottom-side
fallback dock parity, neutral exact route facts, keyboard/list placement,
distinct command/validation announcements, and executable DOM, geometry,
computed-style, forced-colors, axe, and Chromium contracts. Exact generated
direct association rows expose a catalog-labeled change action inside the
Current associations disclosure; the existing reviewed wizard remains the only
apply path.

Storybook itself has no snapshot runner. The separate Linux-only networking
visual spec owns two reviewed pixel baselines and passes 2/2 in the
digest-pinned Playwright container. These screenshots and selected Chrome/axe
scans are bounded evidence, not assistive-technology, manual, multi-browser,
WCAG-conformance, or accessibility-completeness claims.

The fixtures do not contact AWS or contain customer data, and they do not
declare WCAG conformance for the shell, canvas, or complete workflows.
Cross-browser, assistive-technology, zoom/reflow, and manual evidence remains
required before a release-level conformance claim.

<a id="prompt-49-controlled-beta-accessibility-evidence"></a>

## Controlled-beta accessibility evidence

The beta keeps one Guided/Professional component structure and adds visible
non-drag movement plus boundary-placement entry points to the synchronized
Architecture list. The buttons dispatch the same versioned Graph Command used by
the existing keyboard/pointer route; boundary change opens and focuses the
shared Configure placement section. No presentation control changes graph or
deployment meaning.

The continuous-conformance SVG now has a stable title and description and a
companion redacted text alternative listing only safely mapped resources and
connections. It remains evidence visualization, not spatial equivalence or a
claim of complete inventory. Deterministic exported SVG retains its existing
`role="img"`, title, description, revision binding, and redaction tests.

The controlled-beta checklist is
[BETA_ACCESSIBILITY_CHECKLIST.md](BETA_ACCESSIBILITY_CHECKLIST.md). It maps
keyboard, non-canvas, focus, form/error, live-region, color, screen-reader,
drag-alternative, motion, contrast, SVG, and CLI expectations to automated or
code-reviewed evidence and keeps NVDA, VoiceOver, multi-browser, zoom, text-
spacing, OS contrast, touch, and terminal screen-reader work explicitly manual.
Neither axe nor this checklist establishes WCAG conformance.
