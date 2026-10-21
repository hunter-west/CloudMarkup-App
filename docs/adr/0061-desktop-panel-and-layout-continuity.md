# ADR-0061: Desktop panel and layout continuity

- **Status:** Accepted
- **Date:** 2026-09-22
- **Owners:** Cloud Markup product and engineering
- **Supersedes:** ADR-0060 only for glass strength and expansion viewport
  behavior
- **Superseded by:** None

## Context

Desktop testing found that nested opaque surfaces obscured the glass effect,
fixed tour positions missed their targets, service expansion changed zoom
unexpectedly, and boundary metadata occupied child diagram space. Draft loading
also exposed a transient read-only page during editing-access acquisition.

## Decision

Use shared 4px glass over a 58%-opaque surface, with lightly tinted nested
dashboard/catalog cards and accessible opaque fallbacks. Keep 40px desktop panel
headers, a 448px initial inspector with pointer/keyboard resizing, compact
catalog actions and visible canvas margins. Respect reduced motion and preserve
minimum interactive targets.

Tours measure the actual visible target, choose an adjacent side inside the
viewport and update on resize, scroll and panel changes. A short, finite
attention pulse supplements the blue outline. Automatic navigation reveal is
desktop-only and occurs once per step.

Expanding a service preserves the viewport. Observe expanded card size changes
so connection endpoints follow their visible handles. Boundary headings remain
above the reserved 160px child-content origin; detailed settings remain
available through configuration and help.

After an AI proposal has established all child sizes, deterministic sibling
separation prepares ordinary move-node commands inside the same atomic review.
Prefer existing noncolliding positions, preserve parent relationships and stable
identities, and reject unsupported geometry through existing command
preparation. Layout cannot change semantic hashes. Saved diagrams gain the
compact headers without an implicit persisted rewrite.

Retain the loading surface until initial editing-access acquisition completes,
including its authoritative draft reread. Held, denied, unavailable,
closed-project and recovery states remain explicit.

## Consequences

No contract or data migration; no tenant, provider or deployment authority
changes. Existing projects and revisions are preserved. More transparent
surfaces require contrast checks over real content. Tours require live geometry
observation, and layout preparation can reject oversized proposals instead of
accepting unreadable diagrams. Revert the web artifact to roll back presentation
behavior.

## Alternatives and review

Fixed tour positions and automatic expansion zoom failed the requested desktop
interaction. Increasing boundary height without simplifying metadata would
further shrink the fitted diagram. Leaving placement entirely to sequential
additions misses later boundary growth. Reconsider glass strength after contrast
evidence and layout bounds for diagrams beyond the existing supported size.

Accepted after light/dark browser review, opaque/reduced-motion fallbacks,
keyboard and pointer resizing, expansion/endpoint checks, held-access behavior
and deterministic semantic/inverse layout tests.

## References

- Follow-up plan (private historical evidence, omitted from this distribution)
- [Dashboard decision](0060-desktop-dashboard-and-navigation.md)
- [UI specification](../design/UI_SPEC.md)
- [Design system](../design/DESIGN_SYSTEM.md)
