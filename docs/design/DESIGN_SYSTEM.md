# Product design system

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

## Status and scope

This document remains the authoritative visual-system specification for the
application shell, architecture editor, shared components and deterministic
diagram renderer. M9 controlled-beta integration and hardening is active. The
beta composes the shared `packages/ui` tokens and components with the authorized
editor and application workflows; the diagram renderer retains its separate
deterministic export boundary. Current activation, exact release evidence and
remaining acceptance obligations belong in
[Project Status](../PUBLIC_STATUS.md). This specification does not establish
that every described state has release-level visual or accessibility evidence.

All values in this document are provisional engineering defaults, not approved
final branding. The visible shell names the application **Cloud Markup** through
the shared brand lockup; final artwork may still be supplied and reviewed. A
value may be refined after measured accessibility, legibility, and performance
evidence, but its semantic role and ownership must remain stable or receive an
explicit compatibility decision.

The visual system cannot create deployment meaning. The Architecture Document,
Graph Command engine, provider catalog, connection resolver, validation report,
revision state, authorization decision, and export request remain authoritative.
Guided and Professional modes select assistance copy only. They use the same
component tree, geometry, density, fields, actions, disclosures, semantic
tokens, and status meanings.

See:

- [UI specification](UI_SPEC.md);
- [Guided and Professional modes](GUIDED_AND_PROFESSIONAL_MODES.md);
- [Content style guide](CONTENT_STYLE_GUIDE.md);
- [Accessibility](ACCESSIBILITY.md);
- [Asset policy](ASSET_POLICY.md);
- [ADR-0014: Design-system ownership](../adr/0014-design-system-ownership.md);
- [ADR-0016: Component isolation and visual testing](../adr/0016-component-isolation-and-visual-testing.md);
  and
- [ADR-0018: Shared editor presentation and assistance-only modes](../adr/0018-shared-editor-presentation-and-assistance-only-modes.md);
  and
- [ADR-0024: Canvas-first editor with on-demand surfaces](../adr/0024-canvas-first-on-demand-editor-surfaces.md).

## Design principles

- **Quiet structure, explicit status.** Layout and neutral surfaces stay
  restrained so resources, relationships, questions, and findings remain
  legible.
- **Product content first.** Provider icons support recognition but never become
  product branding or imply provider endorsement.
- **Meaning has more than one cue.** Text, shape, pattern, iconography, and
  accessible descriptions accompany color.
- **One semantic system.** Guided and Professional presentations use the same
  validation severity, connection meaning, lifecycle, selection, and export
  state.
- **Local and deterministic.** Interface assets are local reviewed inputs.
  Diagram output pins renderer, catalog, font, and asset-set versions.
- **Content before decoration.** Animation, elevation, and illustration never
  delay or obscure a required action, failure, assumption, or uncertainty.

## Ownership and token contract

The `packages/ui` workspace owns provider-neutral design tokens, primitives,
composite components, focus behavior, density profiles, action-icon wrappers,
and the UI-facing `IconRegistry` contract. It does not own graph semantics,
provider service facts, validation policy, billing truth, or authorization.

The web application consumes `packages/ui` through declared public exports.
Provider packages own their approved asset manifests and bytes; application
composition registers those assets without exposing provider-specific imports to
feature components. Diagram rendering consumes the same semantic roles and an
exact pinned asset manifest, but it has a separate deterministic renderer
implementation.

CSS custom-property examples use the `--cm-` prefix. Component code must consume
semantic roles such as `--cm-color-text-danger`, not raw palette positions such
as `red-700`. Raw values may live behind the semantic layer inside
`packages/ui`.

## Provisional foundation tokens

### Typography

Runtime UI uses platform fonts initially so the shell has no remote font
dependency. Diagram exports must later pin and package an approved font set;
they cannot depend on fonts that happen to be installed on the rendering host.

| Token                  | Provisional value                                                                         | Use                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `--cm-font-sans`       | `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`     | Interface copy; system fonts only until a reviewed local font is supplied    |
| `--cm-font-mono`       | `ui-monospace, "Cascadia Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace` | Code, identifiers, ports, paths, and numeric usage detail; system fonts only |
| `--cm-font-size-1`     | `0.75rem` / 12 px                                                                         | Metadata and compact badges; never primary instructions                      |
| `--cm-font-size-2`     | `0.875rem` / 14 px                                                                        | Default controls, tables, and compact supporting copy                        |
| `--cm-font-size-3`     | `1rem` / 16 px                                                                            | Default body and explanatory copy                                            |
| `--cm-font-size-4`     | `1.25rem` / 20 px                                                                         | Card, panel, and dialog titles                                               |
| `--cm-font-size-5`     | `1.5rem` / 24 px                                                                          | Page titles                                                                  |
| `--cm-font-size-6`     | `2rem` / 32 px                                                                            | Dashboard or onboarding headline                                             |
| `--cm-line-tight`      | `1.2`                                                                                     | Display headings only                                                        |
| `--cm-line-heading`    | `1.35`                                                                                    | Product headings                                                             |
| `--cm-line-body`       | `1.5`                                                                                     | Body, labels with help, and findings                                         |
| `--cm-line-code`       | `1.55`                                                                                    | Code and logs                                                                |
| `--cm-weight-regular`  | `400`                                                                                     | Body                                                                         |
| `--cm-weight-medium`   | `500`                                                                                     | Controls and labels                                                          |
| `--cm-weight-semibold` | `600`                                                                                     | Headings, selected tabs, and status labels                                   |
| `--cm-weight-bold`     | `700`                                                                                     | Rare, short emphasis                                                         |

Body copy never drops below 14 px. Canvas labels and exported-diagram labels
target at least 12 px at the selected output scale. If fitting a large diagram
would make labels smaller, export reports a legibility warning and uses the
large-diagram behavior in
[Asset policy](ASSET_POLICY.md#large-diagram-behavior).

### Spacing

The base unit is 4 px.

| Token            | Value  |
| ---------------- | ------ |
| `--cm-space-0`   | `0`    |
| `--cm-space-0-5` | `2px`  |
| `--cm-space-1`   | `4px`  |
| `--cm-space-1-5` | `6px`  |
| `--cm-space-2`   | `8px`  |
| `--cm-space-3`   | `12px` |
| `--cm-space-4`   | `16px` |
| `--cm-space-5`   | `20px` |
| `--cm-space-6`   | `24px` |
| `--cm-space-8`   | `32px` |
| `--cm-space-10`  | `40px` |
| `--cm-space-12`  | `48px` |
| `--cm-space-16`  | `64px` |

Spacing is logical-direction aware. Components use inline/block tokens rather
than hardcoded left/right margins so localization does not reverse hierarchy.

### Density

Density is an independent presentation profile. It may change spacing and type
scale, but not controls, field order, disclosure defaults, meaning, or target
availability. Guided/Professional mode never selects density; any future
user-facing density preference remains separate.

| Role                  | Comfortable | Compact |
| --------------------- | ----------- | ------- |
| Text/control size     | 16 px       | 14 px   |
| Visual control height | 40 px       | 32 px   |
| Field block gap       | 16 px       | 12 px   |
| List/table row        | 44 px       | 36 px   |
| Panel padding         | 20 px       | 12 px   |
| Canvas node padding   | 16 px       | 12 px   |
| Toolbar gap           | 8 px        | 4 px    |

Standalone pointer targets are at least 44 by 44 px on touch layouts. Compact
desktop controls retain a minimum 24 by 24 px activation area with at least 8 px
separation and a keyboard path; frequently used toolbar actions target 32 by 32
px or larger. Density never reduces visible focus or error text.

Default application surfaces use the compact profile unless a larger target is
needed for touch, safety, or accessibility. Ordinary desktop navigation rows are
36px high; cards, drawers, disclosures, and inspector sections use one compact
padding layer rather than stacking nested card padding. Secondary explanations
use a disclosure or labeled information control instead of increasing the
always-visible block height. Blocking errors, disabled reasons, security
consequences, and the action needed to continue remain visible.

The shared root token set therefore resolves to the compact values by default:
14px control text, 32px visual controls, 12px field/panel spacing, 36px rows,
and 4px toolbar gaps. A touch/coarse-pointer media posture raises interactive
targets to at least 44px without selecting a different experience mode or
changing semantic content. Projects, onboarding, Catalog, Inspector, and
connection review consume these shared values instead of defining local
comfortable-density defaults.

A supplemental information trigger uses a borderless-at-rest 28px visual surface
on fine-pointer desktop layouts and a minimum 44px target on touch or coarse
pointers. It must support hover, focus, click, tap, Escape, and focus return.

The shared compact action and compact tab variants use the 14px control type
scale, a 28px fine-pointer visual surface, and the shared 8px hit-zone
extension. They retain the default button and tab semantics, focus treatment,
and at least 44px interaction target; touch and coarse-pointer layouts use
explicit 44px visual targets. Service cards pair a compact secondary **Details**
action with a compact primary **Add** action. Compact tabs likewise reduce type
size, padding, and gap while retaining tab roles, active indication, arrow-key
behavior, and activation targets; they are the editor Inspector default. These
controls keep the same labels, order, accessible names, and target geometry
across experience modes.

### Radii

| Token            | Value  | Use                                                 |
| ---------------- | ------ | --------------------------------------------------- |
| `--cm-radius-sm` | `4px`  | Badges, buttons, icon actions, and compact controls |
| `--cm-radius-md` | `8px`  | Inputs, nodes, cards, menus, and toasts             |
| `--cm-radius-lg` | `12px` | Panels, drawers, and dialogs                        |
| `--cm-radius-xl` | `16px` | Large overlays and status pills                     |

### Borders and elevation

| Token                  | Provisional value                  | Use                                           |
| ---------------------- | ---------------------------------- | --------------------------------------------- |
| `--cm-border-hairline` | `1px solid`                        | Default separation                            |
| `--cm-border-strong`   | `2px solid`                        | Selection, active drop target, blocking state |
| `--cm-shadow-1`        | `0 1px 2px rgb(23 32 51 / 0.10)`   | Raised controls and nodes                     |
| `--cm-shadow-2`        | `0 4px 12px rgb(23 32 51 / 0.17)`  | Menus, popovers, and floating toolbars        |
| `--cm-shadow-3`        | `0 12px 32px rgb(23 32 51 / 0.24)` | Dialogs and modal drawers                     |

Elevation communicates stacking, never validation severity. High-contrast and
forced-colors modes may replace shadows with explicit borders.

### Motion

| Token                    | Value                        | Use                           |
| ------------------------ | ---------------------------- | ----------------------------- |
| `--cm-duration-instant`  | `0ms`                        | Required under reduced motion |
| `--cm-duration-fast`     | `80ms`                       | Hover/focus color transition  |
| `--cm-duration-standard` | `160ms`                      | Overlay and panel state       |
| `--cm-duration-slow`     | `240ms`                      | Deliberate drawer transition  |
| `--cm-ease-standard`     | `cubic-bezier(0.2, 0, 0, 1)` | Non-physics movement          |
| `--cm-ease-in`           | `cubic-bezier(0.4, 0, 1, 1)` | Responsive closing motion     |
| `--cm-ease-out`          | `cubic-bezier(0, 0, 0.2, 1)` | Responsive opening motion     |

No product transition exceeds 240 ms by default. Reduced-motion mode disables
canvas fly-to, animated edge flow, parallax, skeleton shimmer, and nonessential
panel movement. Progress remains visible through static text and determinate
values.

## Provisional light-first color roles

These values are working inputs, not final brand approval. Implementation must
measure contrast in every actual text size, state, and layered surface before
release. A failed contrast measurement is fixed at the semantic token, not by a
one-off component override.

### Neutral and action roles

| Token                       | Value     | Purpose                                       |
| --------------------------- | --------- | --------------------------------------------- |
| `--cm-color-app`            | `#F7F8FA` | Application background                        |
| `--cm-color-surface`        | `#FFFFFF` | Primary panel/card surface                    |
| `--cm-color-surface-subtle` | `#EEF0F3` | Recessed controls and grouped rows            |
| `--cm-color-canvas`         | `#F7F8FA` | Architecture canvas                           |
| `--cm-color-canvas-grid`    | `#D8E1EB` | Optional grid; never the only alignment cue   |
| `--cm-color-text`           | `#24262B` | Primary ink                                   |
| `--cm-color-text-muted`     | `#5F6672` | Secondary text                                |
| `--cm-color-text-disabled`  | `#636C79` | Disabled text paired with disabled semantics  |
| `--cm-color-border`         | `#E2E5EB` | Decorative separation                         |
| `--cm-color-border-strong`  | `#7E8795` | Visible form boundaries and handles           |
| `--cm-color-action`         | `#365EC8` | Primary accent, action, and active navigation |
| `--cm-color-action-hover`   | `#2D50AD` | Hover/pressed action                          |
| `--cm-color-action-subtle`  | `#EAF0FF` | Selected row or secondary action              |
| `--cm-color-focus`          | `#365EC8` | Keyboard focus ring                           |
| `--cm-color-selection`      | `#365EC8` | Selected node/edge outline                    |
| `--cm-color-selection-fill` | `#EAF0FF` | Selected surface tint                         |

The approved October 6 refinement adds `--cm-color-surface-raised`: white in
light mode and `#25282E` in dark mode. Popover menus, modal drawers and
account/notification drawers use this opaque surface so underlying content
cannot compete with their labels. Canvas panels retain their existing glass and
opaque fallbacks. Decorative menu outlines use the shared neutral border at one
pixel; form boundaries and focus keep their separate stronger roles. This
bounded readability refinement follows the reconsideration recorded in ADR-0061;
historical decisions remain unchanged.

Dark roles are `#121212` for app/canvas, `#1B1D21` for surfaces, `#25282E` for
raised surfaces (`#22252A` for subtle surfaces), `#E7E9EE` for text, `#B4BAC5`
for secondary text, `#343940` for decorative borders, `#737D8E` for control
borders, `#9CADDF` for actions, `#BCC9EA` for hover, `#151C2F` for text on
actions and `#AABAE7` for focus. Status and selection meanings retain their
existing tokens. Phone and coarse-pointer selects and modal close controls have
at least 44-pixel targets.

### Semantic status roles

| Role                 | Foreground | Surface   | Required non-color cue                            |
| -------------------- | ---------- | --------- | ------------------------------------------------- |
| Informational        | `#315EFB`  | `#EFF6FF` | `Info` label or information glyph                 |
| Success/complete     | `#18794E`  | `#ECFDF3` | `Complete` label and check glyph                  |
| Incomplete/question  | `#8A6100`  | `#FFF8D8` | `Incomplete` label and dotted outline             |
| Warning              | `#8A6100`  | `#FFFBEB` | `Warning` label and triangle glyph                |
| Cost warning         | `#8A6100`  | `#FFF7ED` | `Cost` label and currency/usage glyph             |
| Security             | `#7A1FA2`  | `#FAF5FF` | `Security` label and shield glyph                 |
| Error                | `#B42318`  | `#FEF3F2` | `Error` label and octagon glyph                   |
| AI proposal          | `#6D28D9`  | `#F5F3FF` | `AI proposed` label and dashed outline            |
| Generated            | `#0F766E`  | `#F0FDFA` | `Generated` label and linked-nodes glyph          |
| Unsupported/migrated | `#475569`  | `#F1F5F9` | Exact `Unsupported` or `Migrated` label and hatch |
| Read-only            | `#475569`  | `#F1F5F9` | Lock glyph and `Read-only` text                   |

Semantic foreground colors are not used as low-contrast body text over their
surface without measured evidence. Finding titles include their severity in
text. Charts, edges, node borders, badges, and progress states add patterns,
shapes, or labels.

## Focus, selection, and interaction

- Keyboard focus uses a 2 px `--cm-color-focus` ring with a 2 px surface-colored
  offset. It must not be clipped by scroll containers or node overflow.
- Mouse selection and keyboard focus are separate. Selection uses a 2 px
  `--cm-color-selection` outline and selected state text; focus remains visible
  when the selected item contains the active descendant.
- Hover adds a surface/border change but never reveals the only route to an
  action. Touch and keyboard users can reach the same actions.
- Drop targets use a 2 px border, a text instruction, and a target glyph.
  Invalid targets state why the operation is unavailable.
- Multi-selection reports the count and exposes a textual selection list.
- Context menus, drawers, and dialogs restore focus to their invoking control or
  the nearest surviving logical control when closed.
- Launcher-owned Inspector and Workspace popups restore focus to the invoking
  launcher. Switching tools preserves the one popup and moves focus predictably
  without remounting dirty form state.

## Surface roles

| Surface             | Treatment                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| Application chrome  | `--cm-color-surface`, bottom border, no heavy shadow                                                         |
| Service catalog     | Sole resizable desktop panel; scroll-contained category disclosures, compact rows, and explicit search state |
| Architecture canvas | Canvas semantic surface, optional low-contrast grid, direct zoom controls, and optional minimap              |
| Inspector launchers | Compact right rail for Architecture, Configure, Connect, Learn, and IaC; content opens in one shared popup   |
| Workspace launchers | Compact bottom bar for Assistant, Issues, Code, Activity, and Jobs; content opens in one shared popup        |
| Node                | Surface, 1 px border, `--cm-shadow-1`; expanded and compact projections compose the same status treatments   |
| Provider boundary   | Transparent/subtle tinted field with labeled 2 px perimeter                                                  |
| Menu/popover        | Opaque surface, 1 px border, `--cm-radius-md`, and `--cm-shadow-2`                                           |
| Dialog/drawer/popup | Opaque surface, `--cm-shadow-3`, explicit title, and close/cancel path                                       |
| Code view           | Neutral dark-on-light by default with line numbers, language, copy status, and no color-only diff            |

Panel sizes and collapse state are user preferences only. They cannot change the
document, selected export revision, validation target, or provider/catalog
binding.

Catalog resize uses an approximately 8px transparent hit edge containing a 1px
visual boundary that strengthens on hover, focus, and active resize. Its
separator supports pointer, touch, and keyboard operation in 8px steps or 32px
with Shift. Catalog has a 224px minimum, and its viewport-derived maximum
preserves at least 320px of usable canvas. Its expanded header owns the labeled
**Hide** action, and its collapsed state owns one complete labeled **Show**
action. Inspector and Workspace launchers have fixed compact footprints; their
popup surfaces are not resize separators and do not reserve persistent canvas
lanes. The Inspector popup opens beside the right rail and the Workspace popup
above the bottom bar. Only one launcher-owned popup is visually open at a time.
All rich popup content has one explicit scroll owner.

## Architecture visual semantics

### Source and composition rules

Visual state is derived from authoritative inputs:

- service icon, label, node kind, placement, configuration hints, ports,
  education, support level, region state, mappings, and connection descriptors
  come from the exact pinned provider catalog;
- lifecycle treatment comes from Architecture Document element ownership and
  origin;
- findings and affected locations come from a version-bound validation report;
- proposal treatment comes from a transient, unaccepted proposal overlay;
- read-only treatment comes from authorization, immutable revision, or
  compatibility state; and
- selection, hover, focus, and drag/drop are transient local presentation.

The renderer never infers a semantic state from a service ID substring, icon
shape, line direction, color, screen position, or mode. Multiple states compose:
focus and selection remain visible above status; the highest applicable
validation concern supplies the status badge; lifecycle and read-only badges
remain separately visible.

Node and boundary state is composed from five independent layers in this order
of visual stacking, not semantic precedence:

1. **Interaction:** hover, focus, selection, drag, and drop-target feedback.
2. **Validation:** report completeness plus the highest applicable exact finding
   severity, with access to every finding.
3. **Provenance:** unaccepted AI proposal, generated, adopted, template, or
   migration origin.
4. **Compatibility:** supported, unknown, unsupported, or migrated contract
   state.
5. **Permission:** editable or read-only capability and immutable lifecycle.

Each layer retains its own text and non-color cue. For example, a selected,
generated, unsupported, read-only node with a finding must expose all five facts
rather than choosing one combined badge or color.

Validation blocking policy is not implemented. An `error` or `security-error`
does not become visually or behaviorally `blocking` unless a future
authoritative policy explicitly marks it as blocking. The current validation
contract has `security-error`, but no `security-warning`; ordinary warnings are
not relabeled as security concerns by parsing rule IDs or copy.

### Node states

| State                         | Visual treatment                                                                          | Text/accessible treatment                                           | Authoritative trigger                                                                     |
| ----------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Normal                        | White fill, 1 px neutral border, standard shadow                                          | Service and resource label                                          | Valid rendered node                                                                       |
| Hover                         | Stronger border and subtle action surface                                                 | Actions remain available without hover                              | Pointer hover only                                                                        |
| Selected                      | 2 px blue outline, selected fill, selection handle                                        | `Selected` in selection summary                                     | Local selection                                                                           |
| Incomplete                    | Dotted 2 px amber perimeter and question badge                                            | `Incomplete` plus exact missing question/finding                    | Explicit unresolved configuration/question evidence                                       |
| Warning                       | Amber status bar or corner marker, triangle badge                                         | Severity and finding count                                          | Affected warning finding                                                                  |
| Security                      | Violet status bar, shield badge, optional hatch                                           | Exact `Security` state and finding title                            | Current `security-error`; a future explicit security classification may extend this layer |
| Blocking error                | 2 px red perimeter, octagon badge, blocked-action text                                    | Reason, affected path, and remediation                              | Future authoritative blocking policy only                                                 |
| AI proposed                   | Violet dashed perimeter and `AI proposed` badge; never mixed into accepted graph silently | Proposal origin, review action, and accept/reject controls          | Transient unaccepted proposal                                                             |
| Generated supporting resource | Teal inset stripe, linked-nodes glyph, `Generated` badge                                  | Generator and dependency explanation; adoption action where allowed | `semantic.lifecycle.ownership === "generated"`                                            |
| Unsupported                   | Gray hatch and `Unsupported` badge; actions limited safely                                | Compatibility reason and supported next action                      | Explicit compatibility/catalog result                                                     |
| Migrated                      | Gray/blue side stripe and `Migrated` badge                                                | Source/target version and review requirement                        | Explicit migration result or lifecycle origin                                             |
| Read-only                     | Neutral subdued controls, lock badge; content contrast retained                           | `Read-only` and exact reason                                        | Authorization, immutable revision, or compatibility state                                 |

`ai-accepted` lifecycle origin means accepted architecture truth and does not
retain the `AI proposed` outline. Generated resources remain fully legible; a
subdued appearance must not imply they are optional or safe to delete.

### Compact service projection and connection docks

A non-boundary service node supports expanded and compact projections through a
labeled bottom-edge toggle. The compact projection shows the resolved service
icon and configured resource name in a restrained footprint. Projection state is
transient UI state: it does not update serialized node geometry, graph commands,
stable identities, provider bindings, validation input, or IaC addresses.

Expanded services place individually named input capability groups on the left
and output capability groups on the right. Each blue dot has a hover- and
focus-triggered tooltip containing its concise group name; activating it opens
the complete connection detail in a popup adjacent to the owning service.

Compact services show at most one aggregate input point on the left and one
aggregate output point on the right. Exact provider-catalog handle IDs remain
attached at their corresponding aggregate side, so existing edges visually
converge without changing endpoints or relationship meaning. Hover and focus
name every represented group. Activation opens an adjacent popup with group
names, descriptions, and connection counts, and its explicit detail action
expands the service before opening an exact group. The synchronized Architecture
list remains the complete non-spatial alternative.

Double-clicking the service body selects the service and opens **Configure** as
a pointer convenience. It does not apply to controls inside the node and does
not replace the visible launcher, node/list action, or keyboard route. Toggling
the projection, opening connection detail, and opening Configure dispatch no
Graph Command and change no document hash or compiler input.

### Boundary states

Provider boundaries represent provider-semantic containment, not arbitrary
visual grouping. A boundary has a persistent heading, boundary type, contained
item count, and equivalent list/tree representation.

- Normal boundaries use a 2 px neutral perimeter with a 4% surface tint.
- Hover and valid reparent targets strengthen the perimeter and show explicit
  `Move into …` text.
- Selected boundaries use the selection outline without hiding child status.
- Incomplete, warning, security, and blocking states use the same labeled badges
  as nodes at the boundary heading; child badges remain visible.
- AI-proposed boundaries use the violet dashed treatment.
- Generated boundaries use the teal `Generated` badge and provenance detail.
- Unsupported/migrated boundaries use hatch plus exact status text.
- Read-only boundaries retain legible children and show a lock in the heading.
- Auto-fit or resize handles are visible only when permitted and have keyboard
  alternatives described in [Accessibility](ACCESSIBILITY.md).

The bounded M1 editor implements the neutral normal/selected boundary field,
contained-item count, parent-relative child projection, derived bounded
expansion, and transient collapse/expand behavior against the synthetic
foundation catalog. Both modes use the same **Hide contents** / **Show
contents** controls, labels, target geometry, and state; Guided may add an
optional explanation in the shared assistance slot. This presentation does not
alter containment. The current AWS notes-API catalog still contains resource
nodes only: this behavior does not claim that VPC, subnet, account, Region, or
Availability Zone boundaries are supported.

### Edge relationship vocabulary

Direction is shown with a marker and spoken/text order. Each edge exposes a
readable label in the canvas on demand, in the inspector, and in the list/tree
alternative. Pattern lengths are provisional screen-space values and remain
recognizable at supported zoom levels.

| Relationship role      | Line and marker                                                 | Required label/glyph                                                                 |
| ---------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Synchronous invocation | Solid 2 px line, filled directional arrow                       | `Invoke` or catalog-approved action label                                            |
| Asynchronous event     | `8 4` dashed 2 px line, open directional arrow                  | `Event` plus event glyph                                                             |
| Read                   | Solid 2 px line, hollow directional arrow                       | `Read` and `R` badge                                                                 |
| Write                  | Solid 2.5 px line, filled directional arrow                     | `Write` and `W` badge                                                                |
| Read and write         | Solid 2.5 px line, filled arrow                                 | `Read · Write` and paired `R/W` badge                                                |
| Authentication         | `2 3` dotted 2 px line, directional arrow                       | `Authenticate`/issuer/audience label and shield glyph                                |
| Network route          | `10 3 2 3` dash-dot 2 px line, directional arrow                | `Route` plus protocol/port when authoritative                                        |
| IAM/permission         | Solid 2 px line with a parallel 1 px keyline, directional arrow | `Allow`, `Trust`, or exact permission intent plus key/shield glyph                   |
| Dependency             | `4 4` dashed 1.5 px line, open diamond at dependency target     | `Depends on`, `Contains`, or catalog-approved relationship label                     |
| Generic relationship   | Neutral solid 2 px directed line                                | Catalog-provided relationship label, or `Relationship` when no approved label exists |

Semantic line patterns are not reused as validation-state patterns. Edge
findings add a labeled midpoint badge and high-contrast outer halo while
preserving the base relationship pattern. Selection adds a separate blue halo;
focus adds the focus ring around the edge label/interactive hit target. Edge hit
targets are wider than the visible stroke.

#### Provider presentation-resolution contract

The future provider presentation seam is total, static, injected at application
composition, and provider-neutral to consumers. Provider packages own their
versioned mapping registrations; `packages/ui` owns the provider-neutral visual
vocabulary and rendering. Feature components receive only the resolved
presentation. The logical contract is:

```ts
type EdgeVisualKind =
  | "synchronous-invocation"
  | "asynchronous-event"
  | "read"
  | "write"
  | "read-write"
  | "authentication"
  | "network-route"
  | "iam-permission"
  | "dependency"
  | "generic";

interface EdgePresentationInput<TRelationship, TValidatedConfiguration> {
  readonly catalog: {
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  };
  readonly relationship: TRelationship;
  readonly sourcePortId: string;
  readonly targetPortId: string;
  readonly validatedConfiguration: TValidatedConfiguration;
}

interface EdgePresentation {
  readonly kind: EdgeVisualKind;
  readonly label: string;
  readonly source: "provider-mapping" | "generic-fallback";
  readonly mappingVersion: string;
}

interface EdgePresentationResolver<TRelationship, TValidatedConfiguration> {
  resolve(
    input: EdgePresentationInput<TRelationship, TValidatedConfiguration>,
  ): EdgePresentation;
}
```

The exact relationship and port identities come from the pinned provider
catalog, and configuration is accepted only after the provider contract
validates it. Resolution performs no network access and never parses an
identifier to manufacture a kind or label. An absent, incompatible, or unknown
mapping returns the generic labeled presentation.

### Current AWS presentation mapping

The provider contract currently exposes exact relationship types, endpoints,
ports, configuration, and education but no typed visual-role field. The table
below is approved design intent for a future provider-owned presentation
adapter. It is not implemented and must not be copied into React feature
components or treated as a second service catalog. Before editor implementation,
the provider-neutral presentation seam must return this role from exact
version-bound metadata. Unknown relationships use the generic fallback below;
the UI must never infer a role from ID words or port capability strings.

| AWS catalog connection rule                          | Planned visual role    | Label behavior             |
| ---------------------------------------------------- | ---------------------- | -------------------------- |
| `aws.apigateway.http-api-invokes-lambda`             | Synchronous invocation | Route key plus `Invoke`    |
| `aws.cognito.user-pool-authorizes-http-api`          | Authentication         | `JWT issuer`               |
| `aws.cognito.app-client-authorizes-http-api`         | Authentication         | `JWT audience`             |
| `aws.cognito.user-pool-configures-app-client`        | Dependency/containment | `Contains app client`      |
| `aws.iam.policy-attached-to-role`                    | IAM/permission         | `Policy attached to role`  |
| `aws.iam.policy-statement-authorizes-dynamodb-table` | IAM/permission         | `Authorizes table`         |
| `aws.iam.role-assumed-by-lambda`                     | IAM/permission         | `Execution role` / `Trust` |
| `aws.lambda.reads-dynamodb-table`                    | Read                   | `Reads data`               |
| `aws.lambda.writes-dynamodb-table`                   | Write                  | `Writes data`              |
| `aws.lambda.writes-log-group`                        | Write                  | `Writes logs`              |
| `aws.lambda.monitored-by-alarm`                      | Dependency             | `Monitored by alarm`       |

The three descriptor-only relationships remain descriptive/supporting
relationships; a visual mapping does not make them directly resolvable.
Asynchronous-event and network-route styles have no relationship in the current
AWS slice and are future language, not a support claim.

For an unknown or not-yet-mapped relationship, render a neutral solid 2 px
directed line with a **Relationship** badge. Both modes show the catalog
education summary where available and expose the exact relationship type and
endpoint ports through the same **Technical details** disclosure. The UI never
parses an identifier into words. The accessible description states source label,
target label, direction, and the exact available catalog description.

## Badges and status summaries

- Badges contain short text, an icon/shape, and an accessible name. Color is
  supplemental.
- Lifecycle (`Generated`, `Adopted`), validation (`Security`, `Warning`),
  compatibility (`Unsupported`, `Migrated`), proposal, and authorization
  (`Read-only`) are separate badge groups.
- A collapsed count such as `3 issues` exposes its severity breakdown to
  assistive technology and opens the same filtered issue list.
- `New`, `Beta`, `Supported`, and provider-endorsement language cannot be
  inferred from catalog presence or icon availability.

## Forms

- Every field has a persistent label. Placeholder text is example content, not
  the label.
- Help, security impact, cost impact, required state, source type, and error
- A field may place one labeled information control beside its persistent label.
  The control is never nested inside the label, and source, constraint,
  provider, cost, or security evidence stays associated with the field without
  making the primary form path longer.
- Technical evidence starts collapsed unless it contains a blocking finding or
  is required to understand why the primary action is unavailable. text come
  from catalog/UI contracts where provided.
- Required fields use `Required` text or a legend-defined marker; an asterisk
  alone is insufficient.
- Errors appear adjacent to the field and in a focusable summary. They preserve
  user input unless security requires redaction.
- Secret-reference controls never reveal secret values. They show reference
  state and approved external resolution channel only.
- Recommended defaults are explained and represented explicitly in the command
  preview before becoming architecture meaning.
- Advanced disclosure preserves values and error state when collapsed.
- Destructive actions name the affected object and separate confirmation from
  ordinary save.

## Tables and lists

- Tables use real headers, sortable-state text, row selection labels, and a
  non-table card/list presentation where narrow layouts require it.
- Sort order, filters, and pagination are explicit; empty filtered results
  differ from an empty collection.
- Numeric usage and money align by decimal or end edge and retain units,
  currency, period, and estimation status.
- Compact-density rows never hide row actions behind hover alone.
- Virtualized lists must preserve keyboard order, counts, position information,
  and access to off-screen results.

## Code and diff views

- Code uses the mono role, line numbers, language/target/version, copy/download
  status, and a plain-text accessible representation.
- Syntax color is supplemental. Tokens remain distinguishable in monochrome.
- Diffs use `Added`/`Removed` text, plus/minus glyphs, line prefixes, and
  patterns in addition to color.
- Long lines wrap only when the user enables wrapping; horizontal scrolling
  remains keyboard operable.
- Secret values, sensitive references, platform metadata, and unreviewed
  internal diagnostics remain redacted according to export policy.
- Metadata-only compiler mappings show an explicit unavailable state rather than
  simulated code.

## Dialogs, drawers, popovers, menus, and toasts

- A dialog has one visible title, initial focus chosen by task, a named close or
  cancel action, contained focus, Escape behavior unless safety requires
  deliberate confirmation, and focus restoration.
- Drawers are non-modal only when the canvas and drawer can both be operated
  safely. Narrow layouts use a modal full-height drawer.
- Popovers do not contain multi-step workflows; connection and export workflows
  use a dialog or workspace.
- Tooltips supplement an already named trigger. They appear on pointer hover and
  keyboard focus, remain hoverable, dismiss with Escape, and may use an explicit
  side placement when spatial meaning matters. A tooltip is suppressed while a
  richer popover for the same trigger is open.
- Every overlay uses a shared semantic surface with an opaque fallback and
  visible border, consistent radius, restrained elevation, and overlay stacking
  tokens. Panel or canvas overflow cannot clip it.
- Editor overlays share the editor workspace below the application bar as their
  positioning boundary. Menus, dock actions, popovers, modeless surfaces, and
  dialogs clamp within that boundary instead of overlapping global chrome.
- Only one transient contextual overlay is active at a time. Opening a menu,
  popover, or dock action dismisses the prior transient surface; opening a modal
  task dismisses modeless Inspector/Workspace content before modal focus is
  established.
- Desktop Inspector and Workspace tools use their shared rich popup surface, not
  a menu-sized popover. A right or bottom launcher opens at most one popup;
  changing tools preserves task state, and close restores the invoking launcher.
- Menus and popovers use `--cm-shadow-2`; launcher-owned rich popups use
  `--cm-shadow-3`. Forced-colors mode replaces decorative elevation with a
  visible system-color border.
- Shared overlay entry/exit motion uses the 160ms standard duration, ease-out on
  entry and ease-in on exit, and normally only opacity or a short transform.
  Floating editor panels may also transition their independent inset and size
  when this does not reflow or resize the canvas; active drag resizing remains
  immediate. Focus, dismissal, and inert state update immediately; reduced
  motion uses zero duration.
- Context menus have a non-context-menu action path and keyboard invocation.
- Toasts confirm noncritical outcomes only. Errors requiring action persist in
  the relevant panel or job record. Toasts use a live region, do not steal
  focus, pause dismissal on hover/focus, and offer a history route.

## Loading, progress, offline, and synchronization

- Initial loading uses labeled skeleton regions only when structure is known;
  otherwise use a named progress status. Reduced motion removes shimmer.
- Indeterminate progress says what is happening. Determinate progress includes
  current step and numeric value where truthful.
- Save state distinguishes `Unsaved changes`, `Saving`, `Saved`, `Offline`,
  `Retrying`, `Conflict`, and `Read-only`; an icon or spinner alone is
  insufficient.
- Long-running validation, compilation, diagram, ZIP, and GitHub work belongs to
  a durable job/status surface, not a transient spinner.
- Stale catalog, stale revision, and unsupported version are compatibility
  states with safe next actions, not generic network errors.

## High contrast and forced colors

- Support operating-system forced colors rather than overriding them.
- Use system color keywords for text, canvas, borders, focus, selection, and
  disabled states in forced-colors mode.
- Preserve edge differentiation with stroke patterns, markers, and text labels.
- Provider icons may become monochrome only when usage guidance permits; the
  service name remains visible regardless.
- Background images, subtle shadows, transparency, and provider color cannot be
  required for comprehension.
- Test 200% and 400% zoom, text spacing overrides, and high-contrast settings in
  the future component-isolation matrix.

## Representative component-state matrix

When the UI milestone begins, component-isolation stories and interaction tests
must cover at least:

- shell navigation, Catalog expanded/collapsed/resized, each right and bottom
  launcher popup, one-popup-at-a-time switching, focus restoration,
  independently selected comfortable/compact density, offline, stale, saving,
  conflict, read-only, and permission denied;
- paired Guided/Professional editor fixtures with identical component trees,
  geometry, controls, fields, stages, actions, shortcuts, and disclosure state;
- service catalog item with approved icon, placeholder, unsupported capability,
  no results, loading, and limit reached;
- every node, boundary, and edge state in this document, including composed
  selected-plus-finding and generated-plus-read-only cases;
- expanded and compact service projections, left input and right output dots,
  aggregate-point detail, exact-handle and document-hash preservation, adjacent
  popups, hover/focus names, and double-click plus keyboard alternatives;
- inspector Configure/Connect/Learn/IaC tabs with default, advanced, invalid,
  reference, security-impact, cost-impact, empty, and metadata-only states;
- connection wizard default, required input, warning, IAM-effect preview,
  generated-resource preview, invalid direction/port, descriptor-only, success,
  cleanup, shared-resource, and adopted-resource cases;
- finding list with each exact severity, complete/incomplete report, navigation,
  no safe fix, safe fix, conflict, and failed evaluation;
- dialogs, drawers, menus, toasts, tables, code/diff, progress, empty state,
  error boundary, and responsive review layouts; and
- diagram preview with both profiles, placeholder and approved provider icons,
  transparent/opaque backgrounds, redaction, large graph, and failed job.

Fixtures are synthetic and version-bound. Visual snapshots supplement, but never
replace, semantic, keyboard, focus, screen-reader, and command-equivalence
tests. The future tool decision is recorded in
[ADR-0016](../adr/0016-component-isolation-and-visual-testing.md).

## Current implementation status

The current implementation includes the responsive application shell,
provider-neutral token/component foundation, deterministic icon registry,
neutral provider placeholder, synthetic Storybook states, and semantic component
tests. It also includes controlled React Flow projections of synthetic
Architecture Documents, a synchronized accessible nested-list summary, redundant
status treatment, safe generic fallbacks, expanded and transient compact service
projections with exact grouped connection handles, right-side Inspector and
bottom Workspace launchers with shared on-demand popup surfaces, catalog-backed
service creation, schema-driven configuration review, exact resolver-backed
connection, nested layout, bounded history, browser-local recovery, and exact
AWS validation presentation. Canvas, compact global header, Inspector,
Architecture list, Issues, and scoped keyboard entry points share the same
document, findings, component/control tree, geometry, and Graph Command path
across Guided and Professional modes. Validation focus uses a visible marker and
text in addition to color, with complete list/Inspector fallbacks.

Shared root density now defaults to compact while touch/coarse-pointer controls
retain 44px targets. Editor overlays use one workspace boundary and single-
transient coordination, and a modal task dismisses the modeless Inspector or
Workspace surface. Configure includes a strict provider-neutral workload
purpose/I/O editor that previews one atomic Graph Command; Learn projects the
versioned provider-owned Connections, Security, Cost, and Operations guidance.

This remains a bounded local editor foundation, not the complete M3/M5 product
workflow. It does not include complete provider artwork, approved Playwright
visual baselines, production-composed authentication/persistence, customer-cloud
access, deployment, or release-level accessibility conformance evidence. The
separately bounded deterministic diagram, backend/revision, compiler, and export
foundations do not grant those authorities to browser components. Later
implementation must continue to follow the milestone plan, public package
exports, dependency policy, accessibility specification, and accepted ADRs.

### Browser appearance and canvas surfaces

Light and dark modes share geometry and semantic color tokens. System follows
the browser color-scheme preference; an explicit choice persists for that
browser. Menu outlines use a 1.5-pixel muted gray token. All menus and tutorial
surfaces apply the shared 4px backdrop blur over a 58%-opaque surface, retaining
opaque controls and an opaque fallback for reduced transparency or unsupported
browsers. Native selection, keyboard focus, reduced motion, and forced colors
remain supported. See
[ADR-0058](../adr/0058-desktop-service-configuration-and-appearance.md) and the
[readability refinement](../adr/0059-desktop-canvas-readability-and-utilities.md).
Theme colors override vendor defaults for connection paths and arrowheads.
Service outlines and shadows keep cards distinct from the canvas. Positive
notification and issue counts use red badges with white text and accessible
count descriptions; zero/checking issue counts remain neutral.

Workspace pages use floating glass panels over a shared 24-pixel canvas grid.
The initial editor fit preserves that screen spacing; subsequent viewport zoom
scales it. Compact service tiles use screen-readable text and icons at overview
zoom, preserving node centers, graph coordinates and relationship meaning. See
[the dashboard decision](../adr/0060-desktop-dashboard-and-navigation.md).

Desktop editor drawers use compact 40px headers. Inspectors start at 448px and
support pointer and keyboard resizing. The catalog leaves canvas space above and
below it; nested catalog/dashboard cards use a light tint without hiding the
shared glass. Tours position beside live highlighted targets and use a finite,
reduced-motion-aware pulse. See
[the panel refinement](../adr/0061-desktop-panel-and-layout-continuity.md).
