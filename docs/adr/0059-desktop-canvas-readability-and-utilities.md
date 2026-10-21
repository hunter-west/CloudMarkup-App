# ADR-0059: Desktop canvas readability and consolidated utilities

- **Status:** Accepted
- **Date:** 2026-09-22
- **Owners:** Cloud Markup product and engineering
- **Supersedes:** ADR-0058 only for menu border weight and utility placement
- **Superseded by:** [ADR-0060](0060-desktop-dashboard-and-navigation.md) for
  blur strength and Canvas utility placement

## Context

Public beta testing found dark connection paths inherited a vendor default,
service outlines contained an invalid border declaration, and expanded menus
obscured the canvas. Separate header controls competed with editing actions. The
user requests quieter glass surfaces and fewer top-level utility controls.

## Decision

Theme-aware canvas selectors own connection strokes and their widths; arrowheads
use the same semantic palette. Service cards have a valid thin outline and
restrained elevation. Graph identity, connection direction, and meaning remain
unchanged.

Canvas Catalog, Inspector and Workspace launchers and open surfaces share
76%-opaque backgrounds with 20px backdrop blur. Controls retain solid surfaces.
Menu borders use a softer gray at 1.5 CSS pixels. Unsupported backdrop
filtering, reduced transparency and forced colors retain opaque accessible
fallbacks. Collapsed Catalog overflow allows the complete keyboard focus ring to
paint.

Commands lives inside Help; Ctrl/Command+K still opens the same command palette.
One shared modal surface preserves focus when moving between Help and Commands.
The redundant header Project status control is removed; authoritative save and
revision actions remain, and status is accessible through the existing skip
destination and related commands.

Appearance and Notifications live in the profile menu. Its avatar displays a red
notification count with an accessible description. The Issues launcher displays
its count in place of its icon: red for actionable findings, neutral zero for
none, and an explicit checking state before a current result is available.
Counts do not change validation or notification retention behavior.

## Consequences

Desktop canvas legibility and utility placement improve with fewer controls.
Both themes, focus restoration, translucent surfaces, and fallback rendering
need browser verification. Alpha composition requires checking text against the
backgrounds it can cover.

These changes belong to presentation adapters and shared tokens. No dependency,
provider contract, tenant authorization, storage format, graph command or
compiler behavior changes. No migration is needed. Reverting the web artifact
restores the previous presentation without changing project data.

## Alternatives and reconsideration

Keeping vendor edge defaults would retain theme-dependent contrast defects.
Opaque canvas menus would avoid backdrop-filter cost but discard the requested
view of the canvas. Reconsider blur strength if desktop performance or measured
contrast falls below the design-system requirements.

## Review

Accepted after reviewing presentation-only ownership, unchanged graph/project
contracts, focused keyboard/focus checks, both appearance palettes, and passing
accessibility/fallback probes. Release evidence and any external CI blocker
remain explicit in the execution plan.

## References

- Desktop refinement plan (private historical evidence, omitted from this
  distribution)
- [Prior appearance decision](0058-desktop-service-configuration-and-appearance.md)
- [UI specification](../design/UI_SPEC.md)
- [Design system](../design/DESIGN_SYSTEM.md)
