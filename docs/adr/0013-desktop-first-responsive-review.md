# ADR-0013: Desktop-first editor with responsive review experiences

- **Status:** Accepted
- **Date:** 2026-07-25
- **Owners:** CloudCanvas product and engineering
- **Supersedes:** None
- **Superseded by:** None

## Context

CloudCanvas combines a service catalog, architecture canvas, resource inspector,
connection workflows, findings, code review, and job status. Full graph
construction needs enough space for those relationships and for accessible
keyboard alternatives. Pretending that the complete spatial editor works equally
well on a narrow phone would either hide consequential state or create a second
reduced semantic workflow.

People still need to review architectures, assumptions, revisions, findings,
comments, export status, billing state, and organization settings away from a
desktop. Responsive support is therefore a product requirement, not permission
to make every viewport a construction canvas.

Guided and Professional modes already share one semantic model under
[ADR-0006](0006-guided-professional-shared-semantics.md). Device posture must
preserve the same rule.

## Decision

CloudCanvas will provide a desktop-first full architecture editor and
responsive, read/review-first tablet and phone experiences.

The wide-screen editor exposes the service catalog, canvas, inspector, bottom
workspace, keyboard commands, and list/tree architecture alternative. Responsive
layouts reflow these same product surfaces into named pages, tabs, and
full-height drawers. They use the same Architecture Document, permissions,
validation report, command engine, revisions, exports, and commercial
entitlements.

Tablet layouts prioritize review and may expose bounded editing actions only
when the action has a complete non-drag interaction, preview, and command path.
Phone layouts prioritize navigation, search, architecture list/tree review,
resource detail, findings, comments, revision diffs, approvals, export/job
status, billing/usage, and settings. Full free-form construction, multi-panel
code comparison, and precision canvas layout may be unavailable on a phone.

An unavailable narrow-screen action remains discoverable with a concise reason
and a route to a supported layout. It is not silently hidden if hiding it would
misrepresent permissions, architecture state, or required work. No user-agent
detection changes product semantics; layout follows measured viewport and input
capabilities.

Responsive presentation cannot:

- change or default architecture configuration;
- reinterpret containment or relationships;
- alter validation severity or blocking policy;
- accept AI proposals automatically;
- produce a different diagram or IaC artifact for the same immutable revision
  and export settings; or
- grant an action the current role does not authorize.

Core graph operations require keyboard and list/tree alternatives independent of
pointer dragging. These alternatives are part of desktop accessibility and are
not merely a mobile fallback.

This decision defines product posture only. Responsive application behavior is
planned and not implemented in the current M1 web foundation.

## Consequences

### Positive

- The dense editor can optimize for accurate architecture work without
  pretending a phone is a large canvas.
- Narrow layouts retain high-value review, approval, issue, and status work.
- One command/document model prevents device-specific infrastructure meaning.
- Accessible list/tree interaction improves desktop, tablet, phone, and
  assistive-technology use together.

### Negative

- Some users must move to a larger layout for full construction.
- Every workflow needs explicit responsive states and truthful unsupported
  states.
- Drawer, focus restoration, orientation, zoom, and virtual-keyboard behavior
  add test cost.
- Product copy must explain capability limits without implying a permission or
  data failure.

### Follow-up

- Implement the breakpoints and panel transformations specified in
  [Information architecture](../design/INFORMATION_ARCHITECTURE.md),
  [UI specification](../design/UI_SPEC.md), and
  [Wireframes](../design/WIREFRAMES.md).
- Implement the keyboard and list/tree alternatives in
  [Accessibility](../design/ACCESSIBILITY.md).
- Add responsive component, interaction, and end-to-end evidence under
  [ADR-0016](0016-component-isolation-and-visual-testing.md).
- Establish measured canvas and device performance budgets during M3.

## Alternatives considered

### Full construction parity on every phone

Rejected because dense graph construction, inspectors, code comparison, and
boundary manipulation cannot be made equivalent merely by shrinking or
overlaying panels. It would encourage hidden state and inaccessible precision
gestures.

### Desktop-only product

Rejected because review, validation, revision, export, organization, and billing
work remains valuable on narrow devices and is required by the product
experience.

### Separate mobile document or command model

Rejected because it would fragment revision truth and make device changes
semantically unsafe.

## Compatibility, security, and rollback

This ADR introduces no persisted contract, dependency, data migration, tenant
boundary, or deployment path. Authorization remains server-derived and applies
equally on every layout. If later evidence supports more narrow-screen
construction, it can be added through the existing command model without
superseding this desktop-first posture. A change that creates device-specific
semantics would require a superseding ADR.

## References

- [Product specification](../product/PRODUCT_SPEC.md)
- [Personas and experience](../product/PERSONAS_AND_EXPERIENCE.md)
- [User workflows](../product/USER_WORKFLOWS.md)
- [ADR-0006](0006-guided-professional-shared-semantics.md)
- [Accessibility](../design/ACCESSIBILITY.md)
- [UI specification](../design/UI_SPEC.md)
- [Testing strategy](../architecture/TESTING_STRATEGY.md)
