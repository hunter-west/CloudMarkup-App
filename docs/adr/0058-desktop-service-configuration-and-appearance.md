# ADR-0058: Desktop service configuration and appearance

- **Status:** Accepted
- **Date:** 2026-09-22
- **Owners:** Cloud Markup product and engineering
- **Supersedes:** ADR-0024 only for opaque canvas menu surfaces and service-body
  double-click behavior
- **Superseded by:**
  [ADR-0059](0059-desktop-canvas-readability-and-utilities.md) only for menu
  border weight and utility placement

## Context

Public beta feedback requests one catalog entry per service family,
configuration choices within each service, immediate access to application
purpose and permissions, an expanded service block on the canvas, and light/dark
appearance. Separate typed resources remain necessary for exact compiler
mappings and existing saved projects.

## Decision

The application provider-composition layer supplies product grouping and
related-resource navigation. FSx has one catalog entry with four file system
choices; ONTAP storage virtual machines and volumes are managed from the
associated resource. Cognito app clients and EventBridge rules likewise open
from their owner. CloudWatch exposes its resource type in setup. Independent
network building blocks retain their own entries. Owned policy/configuration
records remain available through their owner, without duplicate catalog cards.

This projection does not rewrite released catalog 0.17 or historical catalog
0.16. Changing a configured variant is an explicitly reviewed atomic
domain-command batch that preserves node ID, deployment key, position and safe
undo. It fails closed for generated resources or dependent connections that
cannot be preserved. Adding a related resource uses the exact provider resolver
to create the resource and association together. No new resource definitions,
domain operation kinds, compiler mappings or database migrations are introduced.

Configure shows application function and IAM permissions before secondary
fields. Technical identity remains in Learn; Technical details and Target
readiness do not appear in Configure. Validation and compiler eligibility still
enforce the underlying contracts.

Double-clicking a service body or using its labeled expansion toggle opens the
larger block at the service's canvas position. Configure remains available
through an explicit button and the Inspector launcher. Expansion and edge-handle
measurements are transient and do not change graph semantics or saved layout.

Canvas menus use two-pixel dark gray borders and readable translucent surfaces
with backdrop blur. Opaque fallback remains for unsupported browsers, reduced
transparency, and forced colors. Shared semantic tokens provide light and dark
appearances, including controls, statuses, code and canvas. The preference is
browser-local, with a system option; it never enters a project or compiler
input. Reduced-motion and keyboard alternatives remain required.

AI creation collects requirements on the Create Project page and waits there for
the existing durable proposal job. The created project is reused on retries. A
short-lived in-memory, project-scoped handoff opens explicit proposal review in
the authenticated editor. Schema validation and exact draft-digest matching
precede the normal atomic command application. Prompts and architecture do not
enter URLs or browser storage. Reloading during creation can recover the saved
project from Projects; in-memory review state is not a new durable contract.

## Consequences

### Positive

- The catalog reflects the service choices users make while exact resource
  contracts remain intact.
- Common configuration tasks require less navigation and implementation metadata
  no longer competes with editable fields.
- Appearance and canvas expansion remain independent from architecture meaning.

### Negative

- Changing an already connected resource to an incompatible variant requires an
  explicit connection review rather than automatic conversion.
- Two appearance palettes and translucent fallback states require contrast and
  browser regression coverage.
- AI creation creates the project before generation; cancellation preserves that
  project.

### Follow-up

Accepted after reviewing provider/domain boundaries, preservation of released
contracts, atomic inverse coverage, denied/stale AI review, and desktop
light/dark browser evidence. Release gates and hosted verification remain
tracked in the linked execution plan.

## Alternatives considered

Replacing all FSx resource definitions with one mutable resource type would
change persisted contracts and compiler bindings merely to change navigation.
Keeping separate catalog cards would preserve the reported friction. Automatic
application of AI output would bypass the established proposal-review boundary.
Persisting prompts in browser storage would add an unnecessary architecture-data
surface.

## References

- Execution plan (private historical evidence, omitted from this distribution)
- [Canvas-first surfaces](0024-canvas-first-on-demand-editor-surfaces.md)
- [Design-system ownership](0014-design-system-ownership.md)
- [Incremental proposals](0056-incremental-beta-diagram-proposals.md)
