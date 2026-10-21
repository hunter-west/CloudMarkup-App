# Guided and Professional Modes

> **Specification status:** This document defines normative product behavior.
> Current implementation and activation are recorded in
> [Project Status](../PUBLIC_STATUS.md). The specification does not establish
> production composition, cloud access or deployment authority.

## Purpose and authority

### Current implementation clarification (2026-10-06)

At source `9407c8dc`, Guided may show a suggested-next-step banner with Review
issue or Browse services and Dismiss suggestion controls. Professional omits
that assistance banner. The same issue review, catalog navigation and editing
capabilities remain available through the normal shared controls; the banner
does not apply a change or unlock a feature. Both modes expose the same
connection fields, technical details and confirmation rules.

This is a current implementation exception to the strict identical-control
requirement in
[ADR-0018](../adr/0018-shared-editor-presentation-and-assistance-only-modes.md),
whose original decision is retained. Admitting this assistance exception as
policy or making the banner shared requires a separate owner decision. This
clarification changes no product behavior, authorization or entitlement.

The application offers Guided and Professional presentation modes so that people
can choose explanatory or concise assistance without learning different editors.
This document makes that copy-only distinction precise. It refines the audience
requirements in
[Personas and Experience](../product/PERSONAS_AND_EXPERIENCE.md), preserves the
shared semantics required by
[ADR-0006](../adr/0006-guided-professional-shared-semantics.md), and applies the
shared presentation direction in
[ADR-0018](../adr/0018-shared-editor-presentation-and-assistance-only-modes.md).

The Architecture Document, Intent Document, Provider Catalog, Graph Commands,
validation report, immutable revisions, artifacts, authorization decisions,
entitlements, and usage accounting remain authoritative. A presentation mode
must not reproduce or override their rules.

## Shared semantic contract

For the same authorized actor, input document, catalog and rule versions,
semantic choices, and command preconditions, both modes must produce identical:

- Graph Commands, including atomic batch ordering and preconditions;
- accepted or rejected command results and generated-resource provenance;
- document values, stable identities, and compilation-content hashes;
- finding identifiers, severities, affected locations, evidence, and report
  completeness;
- draft and immutable revision state;
- compiler inputs and diagnostics;
- diagram source revision and renderer inputs;
- IaC and combined artifact contents; and
- authorization, entitlement, quota, audit, and outcomes for Cloud Markup
  credits.

Editor layout, geometry, density, fields, field order, workflow stages,
controls, actions, shortcuts, and disclosure state are identical for the same
viewport, permissions, product state, and independently selected personal
preferences. They are non-semantic presentation state and must not enter a
semantic command, Architecture Document, Intent Document, revision, compiler
input, or artifact manifest. Both modes consume the same exact-catalog-bound
connection-presentation and service-extension artifacts. They render the same
dock IDs, sides, order, counts, status, menus, exact-edge fan-out/highlight,
cardinality, compact 176-by-72 node state, directional aggregate anchors, owned
slots, policy kinds, and target-readiness facts. A mode may select its artifact-
supplied assistance sentence in the same reserved slot; it cannot regroup a
port, change an edge anchor, add a policy kind, or promote target support.

Dock/menu open state, service collapse, Inspector or Workspace popup
destination, scroll, focus, highlight, and policy-editor form buffers or
disclosures are transient presentation state. Graph-backed owned-configuration
nodes and edges remain semantic document state. Switching mode preserves both
categories of state and issues no command.

Mode selects assistance copy only: explanation length, examples, definitions,
and whether a plain-language or exact term leads inside the same content slot.
Guided may recommend a catalog-backed default, but the value becomes deployment
meaning only after the user can review it and the shared command engine records
it explicitly. Neither mode may bypass or alter confirmation, authorization,
validation, or atomicity.

## Selection and persistence

- A new authenticated user starts in Guided mode unless they explicitly select
  Professional during onboarding or before their first editor visit.
- Switching mode updates a personal experience preference outside project and
  architecture state. The preference is restored for that user on later sessions
  and projects.
- A mode switch is immediate presentation state only. It issues no Graph
  Command, creates no revision, invalidates no finding, starts no job, and
  consumes no AI credit.
- Mode is not encoded in the project URL. A shared or bookmarked project opens
  with the viewing user's preference, subject to the same capabilities and
  project state.
- Switching preserves the mounted component tree, geometry, unsaved field input,
  errors, selection, navigation destination, workflow stage, command history,
  disclosures, previews, and all advanced values. Only assistance copy changes.
- Catalog size, collapsed sections or services, last popup destinations,
  tutorials dismissed, and similar non-semantic choices are personal interface
  preferences. They may be persisted independently of the mode preference and
  must never enter an architecture revision.
- The current M1 editor keeps Catalog size, service collapse state, and active
  Inspector or Workspace destination in the editor session only. It does not
  claim a persisted workspace-preference contract.
- **Reset workspace** restores the same first-use shell defaults in both modes.
  It does not reset architecture data, draft history, validation state, or the
  user's chosen mode.
- If preference loading fails, the current session remains usable in Guided mode
  and explains that the preference was not restored. It must not infer a project
  change.

Organization policy can govern capabilities, data disclosure, and entitlements.
It cannot use mode as an authorization role. Exact non-owner role names and
permissions remain an M2 decision.

## Presentation profiles

The shared editor contract and the allowed assistance-copy differences are
required; they are not separate feature sets.

| Concern               | Shared editor contract                                                                                         | Guided assistance                                     | Professional assistance                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------- |
| Language              | Same content slot, control label, accessible name, facts, and action                                           | Plain-language explanation may lead                   | Exact term may lead; wording remains concise      |
| Editor tree           | Same compact header, 336px Catalog, 92px/48px launchers, shared popup, geometry, density, fields, and order    | Optional explanation in reserved assistance slots     | Help remains available on demand                  |
| Service nodes         | Same expanded/176x72 compact state, configured name/icon, bottom arrow, aggregate dots, and exact handles      | May explain inputs and outputs in the shared tooltip  | May lead with exact group terminology             |
| Configuration         | Same schema fields, groups, order, validation, defaults, and disclosure state                                  | Explains unfamiliar choices and consequences          | Uses concise technical descriptions               |
| Connections           | Same **Set up connection** and **Review and connect** stages, fields, preview, actions, and keyboard shortcuts | Explains relationship purpose and consequences        | Leads with concise exact terminology              |
| Connection docks      | Same stable groups, aggregate anchors, hover/focus names, menus, fan-out, focus, and exact port/rule evidence  | Explains group purpose and why it matters             | Leads with group/port/rule/cardinality detail     |
| Learn                 | Same provider-owned Connections, Security, Cost, Operations, readiness, limitation, and documentation topics   | Uses reviewed beginner service guidance               | Uses reviewed concise technical service guidance  |
| Owned policies        | Same role sections, structured statement editor, fields, order, validation, commands, and cleanup authority    | Explains generated/custom/trust/boundary distinctions | Leads with exact actions, scope, conditions, IDs  |
| Target readiness      | Same six modeling/configuration/validation/Terraform/CloudFormation/generated-code entries and exact reasons   | Explains what can be done now and why work is pending | Leads with exact target and implementation status |
| Findings              | Same state, evidence, affected paths, actions, order, and **Technical details** disclosure                     | Adds beginner-oriented remediation context            | Uses concise rule and path language               |
| Shortcuts             | Same shortcuts and visible hints in tooltips, menus, Help, and Commands                                        | May explain what the shortcut does                    | May use a shorter explanation                     |
| Education             | Same contextual-help trigger and reserved assistance region                                                    | May include definitions and optional first-use help   | No unsolicited tour; definitions remain on demand |
| Consequential changes | Same exact preview, confirmation gate, action order, and disabled reasons                                      | Explains the consequence before confirmation          | Uses a concise consequence                        |
| Technical details     | Same disclosure, default, authorization, content, and preserved open/closed state                              | Plain-language introduction may precede evidence      | Exact terminology may lead                        |
| Usage                 | Same Cloud Markup credits balance/state and authorized technical-usage disclosure                              | Explains the customer-facing unit                     | Uses concise technical-usage copy when authorized |

The same first-use editor geometry applies in both modes: the persistent 336px
Catalog is open, the fixed 92px Inspector and 48px Workspace launchers are
visible, and no rich popup is open. Architecture is its own Inspector
destination, while Configure, Connect, Learn, IaC, Assistant, Issues, Code,
Activity, and Jobs share the one-at-a-time popup behavior. An empty Issues
destination must say whether validation is complete, incomplete, stale,
unavailable, or complete with no findings; absence never implies a clean result.

### Wording and explanation order

Both modes use the same information order and control placement:

1. what the editor observed or is asking;
2. why it matters in the current context;
3. exact evidence, provider terminology, and affected paths;
4. what will change or what the user can do next; and
5. scope, uncertainty, and unsupported or incomplete work.

Guided may add a plain-language sentence or definition inside the corresponding
assistance slot. Professional may lead that same slot with the exact term and
use fewer words. Neither mode reorders an evidence row, field, action, or stage.
Both modes must state uncertainty, unsupported behavior, permission limits, and
failed or incomplete work with equal accuracy. The
[Content Style Guide](CONTENT_STYLE_GUIDE.md) provides paired examples.

### Configuration and progressive disclosure

- Both modes render the same schema-driven fields, groups, order, validation,
  disclosure controls, and action row from one component tree.
- Mode may change assistance copy beside a field, but it cannot split, combine,
  reorder, hide, or reveal a field or provider property.
- Both modes derive labels, allowed values, defaults, security/cost notes, and
  validation from the same version-bound catalog fields and UI hints.
- Task-critical labels, current values, blocking findings, disabled reasons, and
  the primary action remain visible. Secondary source, constraint, identifier,
  compatibility, implementation, and unavailable-capability evidence uses the
  same compact information control or disclosure in both modes.
- Guided may add explanation inside those shared help surfaces. It must not add
  another card, section, stage, or padding layer that Professional omits.
- Collapsing an advanced group never clears its values. A non-default value in a
  collapsed group is summarized next to the group heading.
- A hidden field with a finding, stale value, unresolved reference, or changed
  value is automatically disclosed or linked without moving focus unexpectedly.
- A catalog default is labeled as a suggestion until it is included in the exact
  command preview. Neither mode silently substitutes a provider value.

### Connections and generated resources

Both modes resolve a supported connection through the same provider-owned rule
and show the same exact atomic batch before confirmation. The preview
identifies:

- source and target ports and the selected relationship;
- direct node, edge, and configuration changes;
- supporting resources and why each is required;
- exact IAM effects when the reviewed rule supplies them;
- security, cost-sensitive, unsupported, and missing-information findings; and
- ownership, sharing, adoption, retention, and removal consequences for
  generated elements.

The same exact-catalog-bound presentation artifact groups semantic ports under
Triggers, Data & storage, Messages & events, Invokes, Identity & permissions,
Networking, Observability, and an explicit fallback. Expanded nodes render the
same external group anchors, counts, status, deterministic stable-ID fan-out,
and grouped menu. A compact node is exactly 176 by 72 pixels, retains the
service icon and configured name, and shows at most one visible input dot on the
left and one output dot on the right. Every exact group handle remains mounted
at its side's aggregate anchor. Expanding from the bottom arrow restores all
grouped dots; opening, scrolling, collapsing, or changing assistance copy cannot
change an exact port, stable edge, document hash, or IaC address. A dock is not
a future-service handle: target compatibility remains in provider rules and an
unavailable capability is not inferred.

The grouped menu has the same Current/Available sections and Focus, Edit,
Connect, authorized Disconnect, keyboard, focus-restoration, and unavailable-
reason behavior in both modes. Opening a dock highlights the same group edges;
selecting one row highlights the same exact edge. Hover or keyboard focus names
the input or output group, and a compact aggregate names every represented group
at a glance. Its activated information surface opens beside the owning service,
not at an unrelated canvas location. Guided may explain the group's purpose or
add optional “Why this matters” assistance. Professional may lead the same
Technical details slot with exact port/rule/cardinality/IAM/ID evidence.

The connection dialog has one component tree and two stages in both modes:

1. **Set up connection** presents the same compatible relationship, ordered
   fields, recommendations, defaults, cardinality, and validation.
2. **Review and connect** presents the same exact endpoints, direct and
   supporting Graph Commands, permission effects, generated-resource provenance,
   findings, atomic confirmation, and disabled reasons.

The dialog inherits the application assistance preference; it does not render a
second Guided/Professional selector. If the exact descriptor requires no
ambiguity choice or configuration fields, both modes enter **Review and
connect** directly. This shortens the task without changing the candidate,
validation, command, geometry, or assistance-mode state.

The same **Technical details** disclosure exposes authorized capability, port,
rule, relationship, identifier, diagnostic, and command evidence with the same
default and preserved disclosure state. Both modes expose the same
**Ctrl+Enter** confirmation only after the same exact preview is valid. Guided
may explain relationship purpose and consequences in plain language;
Professional may use concise exact terminology in the same assistance slots.

The current bounded workflow keeps one session-local connection draft across
mode changes and implements these two shared stages for its exact local catalog.
Both modes use the same candidate, field values, resolver result, validation,
actions, keyboard path, and explicit confirmation. Neither a mode switch nor
cancellation changes the Architecture Document.

Multiple inbound triggers remain separate configured edges in both modes. If
their input contracts are incompatible and no explicit supported dispatcher is
declared, both modes show the exact trigger, operation, contract, dispatch, and
finding identities and recommend separate functions rather than guessing an
event type. Assistance wording may differ; the warning or error does not.

### Owned configurations and structured policies

Both modes project the same graph-backed owned-configuration nodes, exact owner-
slot edges, cardinality, lifecycle/provenance, adoption, findings, and target
readiness. They keep role trust policy, custom inline policies, generated
permissions, managed-policy attachments, and permissions boundary in separate
sections with the same labels/order. Lambda invocation permission remains a
service grant, not an inline role policy.

The structured policy editor has one component tree and the same policy name,
statement list, add/edit/duplicate/remove actions, effect, actions, typed
resource references, optional conditions, policy-kind-gated principals, stable
identities, validation, readiness, and Graph Command preview. It never makes raw
arbitrary JSON the default. Both modes preserve advanced values, statement
order, dirty input, errors, focus, and disclosures when switching.

Guided assistance may explain common permission purposes, read versus write,
wildcard risk, generated versus custom ownership, trust, and boundaries, with
condition guidance behind the same progressive disclosure. Professional
assistance may lead with exact actions, resource expressions, principal kind,
condition operator/key, slot/statement IDs, provenance, and target mapping
status. Functionality, fields, defaults, validation, and command output are
identical.

Generated connection cleanup may remove only an exact generated policy subtree
whose provenance and live references permit release. Both modes present the same
retain/remove/adopt result and never include user-authored policies in that
cleanup authority. Target readiness separately reports modeling, configuration,
validation, Terraform, CloudFormation, and generated-code support; assistance
cannot turn pending Terraform or CloudFormation rendering into support.

### Workload implementation readiness

Both modes project the same selected-node Workload Behavior v2 and Application
Contracts v1 records inside Configure/Implementation: implementation mode,
source ownership, runtime, handler/entrypoint, trigger and downstream-action
bindings, dispatch policy, unresolved requirements, user-code requirement, and
starter-generation readiness. Both expose the same operation name, purpose,
Inputs, Outputs, strict portable field grammar, validation, preview, Apply, and
Discard controls.

Both modes expose stable workload, operation, binding, edge, contract, and
dispatcher identities through the same **Technical details** disclosure. Guided
may explain missing choices and next actions in plain language; Professional may
use concise exact terms in the same slots. Preview and Apply use the same
exact-preconditioned atomic `replace-workload-and-application-contracts` Graph
Command. Neither mode may infer source, call a model, request
packages/providers, write source or a repository, compile, or deploy through
this form.

### Findings and readiness

Both modes consume one version-bound validation report and use the same finding,
evidence, affected-location, action, and technical-detail order. Assistance copy
may differ, but every identity, severity, reference, and fix preview remains in
the same control tree.

An incomplete report is never described or styled as clean. `security-error`
drives the security state, but the interface must not label a finding
**blocking** unless future application policy supplies that decision. Finding
acknowledgement, suppression, and product-wide gating remain unresolved.

The current bounded M1 presentation keeps the exact report and severity/resource
groups in both modes. Both show **What happened**, **Why it matters**, **How to
fix it**, target applicability, stable finding and rule IDs, affected paths,
technical detail, the complete Graph Command preview, and every affected
location in one order. Guided may add contextual explanation; Professional may
use concise exact terminology. Readiness input remains identical.

Only `warning` and `cost-warning` findings may be marked **Reviewed this
session**, and only against a complete current report. Review state is scoped
independently to the draft or compilation target and one exact content hash; it
resets on page reload/recovery, and undoing back to that exact hash may reveal
its still-current session marker. It does not alter severity, suppress a
finding, enter history or persistence, establish revision/target readiness, or
resolve the future acknowledgement/gating policy. The readiness summary
therefore shows **Warning acceptance — Not available** separately from
**Warnings reviewed this session**.

### AI assistance and usage disclosure

AI output is always labeled as a proposal. Both modes show assumptions,
unresolved questions, rejected operations, and the exact valid operations
available for user review. Mode does not change the model's authority: only
deterministic domain code can accept a schema-constrained command.

Cloud Markup credits are the primary customer-facing unit in both modes. Raw
model names, provider token counts, and underlying pricing details appear only
inside an authorized, opt-in **Technical usage details** disclosure. Opening or
closing that disclosure does not change accounting. The organization usage
ledger and entitlement result remain authoritative.

## Mode switching in active workflows

| Current context           | Required switch behavior                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Intent review             | Preserve every accepted edit, unresolved question, and current item; re-present the same Intent Document    |
| Configuration form        | Preserve dirty values, field errors, field order, groups, and disclosure state; change assistance copy only |
| Connection dialog         | Preserve stage, answers, disclosure state, and resolved preview in the same component tree                  |
| Boundary placement        | Preserve the exact parent choice, stable-ID detail, coordinates, controls, and order; vary assistance copy  |
| Automatic-layout preview  | Preserve the same prepared batch, exact node/parent/coordinate detail, controls, and order                  |
| Validation navigation     | Keep the same report, selected finding, and affected location                                               |
| Stale draft conflict      | Keep the conflict unresolved and display the same local/server evidence                                     |
| Revision review           | Keep the same immutable revision identity and diff position                                                 |
| Compilation or export job | Keep the same job identity, status, diagnostics, and artifact                                               |
| Billing or usage view     | Keep the same server-authoritative projection, entitlement, and ledger data                                 |
| Denied or read-only view  | Preserve the same capability limits and disclose no additional resource information                         |

If a component cannot preserve this state across a live switch, it must defer
the visual transition until the state is safely represented. It must not save,
discard, or reinterpret data to make the switch succeed.

## Accessibility and responsive behavior

Mode is not an accessibility setting. Guided and Professional modes both meet
the requirements in [Accessibility](ACCESSIBILITY.md), provide complete keyboard
access, and expose the same screen-reader graph summary and non-canvas
workflows.

Both modes use identical target geometry, focus order, accessible names, and
keyboard paths. Guided may provide more instruction, but it must avoid repeated
announcements and allow tutorials to be dismissed.

On phone layouts, both modes use the same accessible list/tree review experience
instead of a precision construction canvas. Mode does not change density or
restore unsupported precision editing.

## Future verification

Implementation is not complete until automated and manual evidence proves:

- new users receive Guided unless Professional was explicitly chosen;
- the personal preference restores without entering project or architecture
  data;
- switching in every context above preserves the mounted control tree, geometry,
  input, errors, selection, stage, disclosure state, focus, and workflow state;
- equivalent choices in both modes produce byte-identical canonical semantic
  documents and identical Graph Command previews;
- validation identities, severities, locations, completeness, and stale state
  are identical;
- immutable revision, compiler input, diagrams, IaC, and combined export are
  mode-independent;
- advanced values survive collapse, mode switches, and workspace reset;
- both modes retain the same compact service state, aggregate anchors, exact
  handles, hover/focus names, adjacent connection surface, and double-click
  Configure behavior;
- both modes expose the same 92px and 48px launchers, one rich popup at a time,
  Architecture destination, focus restoration, shadow, 160ms motion, and
  reduced-motion behavior;
- shortcuts invoke the same authorized commands in both modes;
- unauthorized technical usage details remain undisclosed; and
- desktop, tablet, phone, keyboard, screen-reader, forced-colors, and
  reduced-motion presentations preserve meaning.

The current bounded synthetic editor proves identical document hashes, findings,
severities, navigation targets, safe-fix batches, and history behavior across a
live Guided/Professional switch in selected Chromium and component flows. It
also proves paired assistance copy over the same finding/evidence order and
session-only warning review. This is not evidence that real authentication,
complete product workflows, server revisions, compiler outputs, diagrams, IaC,
exports, or deployment exist.
