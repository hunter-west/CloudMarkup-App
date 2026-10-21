# Personas and Experience

## Purpose

This document is the canonical product record for Cloud Markup audiences,
presentation modes, visual direction, and device posture. The
[Product Specification](PRODUCT_SPEC.md) defines capabilities; this document
defines how those capabilities meet novice and professional needs without
changing architecture semantics.

The implementation-ready presentation contract is split across the
[information architecture](../design/INFORMATION_ARCHITECTURE.md),
[UI specification](../design/UI_SPEC.md),
[Guided and Professional mode specification](../design/GUIDED_AND_PROFESSIONAL_MODES.md),
[content style guide](../design/CONTENT_STYLE_GUIDE.md),
[design system](../design/DESIGN_SYSTEM.md), and
[accessibility specification](../design/ACCESSIBILITY.md). Those documents
specify the complete target experience. Current implementation and activation
are recorded in [Project Status](../PUBLIC_STATUS.md).

## Audiences

### Guided user

A learner, application developer, or occasional cloud user who needs plain
language, safe reviewed defaults, contextual education, visible assumptions, and
clear configuration and connection help. Guidance must make important cloud
consequences understandable without changing the shared fields or workflow.

### Professional user

A cloud architect, platform engineer, or experienced software engineer who
expects concise technical language, efficient keyboard use, precise
relationships, complete validation evidence, and fewer explanatory
interruptions. They use the same controls, configuration, and evidence.

### Organization owner

The organization-scoped administrator for membership, billing, entitlements,
limits, and sensitive lifecycle actions. Authorization policy v1 defines owner,
administrator, editor, and viewer: editors can build and run project workflows,
administrators add membership/integration/audit administration, and only owners
can assign ownership or perform organization-sensitive lifecycle actions.

One person may use more than one posture over time. Experience mode is not a
permanent persona assignment.

## One product, two presentation modes

| Concern            | Shared product behavior                                                                    | Guided assistance                             | Professional assistance                  |
| ------------------ | ------------------------------------------------------------------------------------------ | --------------------------------------------- | ---------------------------------------- |
| Language           | Same labels, accessible names, content slots, facts, and actions                           | Plain-language explanation may lead           | Exact terminology may lead               |
| Configuration      | Same fields, groups, order, validation, disclosure controls, and density                   | Explains choices and consequences             | Uses concise technical descriptions      |
| Connections        | Same two stages, fields, preview, actions, shortcuts, and **Technical details** disclosure | Explains implications and supporting changes  | Uses concise exact relationship language |
| Findings           | Same finding, evidence, affected paths, order, actions, and technical detail               | Adds contextual remediation help              | Uses concise rule and path language      |
| Usage presentation | Same Cloud Markup credits and authorized technical-usage disclosure                        | Explains the customer-facing unit             | Uses concise technical copy              |
| Interaction pace   | Same component/control tree, geometry, density, confirmation gates, and keyboard paths     | More assistance within reserved content slots | Fewer words in the same slots            |

Both modes use the same:

- Architecture, Workload, External Resource, and Application Contract source
  documents plus stable identities;
- command and graph-operation engine;
- provider catalog and validation rules;
- draft, immutable Solution Revision, and artifact lifecycle;
- deterministic generation, compiler, ownership, and export boundaries;
- Active Issue sources and independently leveled Evidence; and
- authorization, quota, audit, and billing rules.

Assistance may vary wording, contextual education, recommendations, and optional
technical disclosure within the same reserved surfaces. Both modes use one
component tree with identical controls, dimensions, geometry, density, fields,
order, dialog stages, actions, and shortcuts. They use the same source
documents, validation, generation, ownership, issues, Evidence, revision, and
export behavior. Switching preserves mounted interaction state, every source
document, and proof status; it cannot change architecture or deployment meaning.
See [ADR-0006](../adr/0006-guided-professional-shared-semantics.md) and
[ADR-0018](../adr/0018-shared-editor-presentation-and-assistance-only-modes.md).

## Visual direction

Cloud Markup should feel approachable, calm, trustworthy, modern, and
professional. It should not be childish, visually noisy, or an imitation of the
AWS Console.

The product is light-first. Cloud Markup branding remains visually primary while
official provider service icons supply accurate resource recognition. Interface
action icons, Cloud Markup brand assets, provider assets, empty-state
illustrations, and generated architecture thumbnails have separate ownership and
review rules. Safe placeholders keep the application usable until official
provider assets are supplied and approved. See
[ADR-0019](../adr/0019-product-owner-governance-for-official-provider-icons.md).

Accessibility is a correctness requirement. Color, icon shape, canvas position,
or experience mode cannot be the only way to communicate architecture meaning,
status, findings, or available actions.

## Device posture

Full architecture editing is desktop-first because dense graph manipulation,
inspectors, code review, and keyboard workflows need sufficient space.
Responsive behavior remains required.

On narrow screens, the initial product prioritizes:

- viewing and navigating an architecture;
- reviewing assumptions, revisions, diffs, and comments;
- inspecting validation findings;
- monitoring compilation and export status; and
- approving or downloading already-reviewed exports where authorization permits.

Narrow-screen parity for complex graph editing is not a beta requirement.
Unsupported editing affordances must degrade explicitly rather than corrupting
or hiding semantic state.

## Experience acceptance

- The same revision opened in either mode has the same source-document
  projections, validation, generation inputs/output, ownership, Active Issues,
  Evidence, compiler input, and export contents.
- Switching modes preserves the mounted component tree, dimensions, draft state,
  selection, dirty values, errors, stages, controls, previews, progress, and
  proof state.
- Guided defaults become explicit Architecture Document values before they can
  affect infrastructure.
- Both modes expose the same fields, shortcuts, actions, disabled reasons,
  validated commands/operations, generation coverage, evidence requirements, and
  authorization.
- Desktop and narrow-screen presentations expose accurate state and accessible
  alternatives for critical review actions.

## Non-goals and unresolved details

- Separate Guided and Professional architecture models are prohibited.
- Guided mode is not an accuracy-reduced or security-reduced product.
- Professional mode does not bypass confirmation, authorization, validation, or
  billing controls.
- Exact breakpoints, component styling, keyboard maps, copy, onboarding steps,
  and performance budgets belong to the scheduled UX/design prompts and measured
  implementation work.
