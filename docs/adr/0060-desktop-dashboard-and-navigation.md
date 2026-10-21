# ADR-0060: Desktop dashboard and navigation continuity

- **Status:** Accepted
- **Date:** 2026-09-22
- **Owners:** Cloud Markup product and engineering
- **Supersedes:** ADR-0059 only for blur strength and Canvas menu placement
- **Superseded by:** [ADR-0061](0061-desktop-panel-and-layout-continuity.md) for
  glass strength and expansion viewport behavior

## Context

Desktop beta feedback asks for an organization home, clearer menu glass,
coherent personal/team navigation, readable overview tiles, and a smoother
transition into the editor. Existing APIs provide current credit and project
projections but do not provide a historical usage time series for this page.

## Decision

The web adapter owns an organization Dashboard backed by existing verified,
read-only API contracts. Authorization is checked before requests; cache keys
include actor, organization and capability context, responses are bound to the
requested organization, and revoked access removes displayed data. Display
current recorded totals and the latest project snapshot without inventing
historical metrics. Creation remains explicitly authorized and reviewed.

Navigation groups are Workspace, Account, Organization. Dashboard is the normal
single-organization sign-in and brand destination. AI creation collects its
prompt on the create screen. The first browser visit offers a dismissible,
restartable navigation tour stored per actor.

The minimap opens existing Canvas actions with keyboard and focus support.
Shared menus and tutorials use clearer 10px glass with opaque fallbacks.
Workspace and project-loading surfaces share the canvas grid, whose initial
24-pixel screen spacing is preserved at the fitted viewport. Services use
transient readable overview tiles below 70% zoom and icon tiles below 35%.
Resource centers, graph commands, stable IDs and stored layouts remain intact.

## Consequences and boundaries

Dashboard availability depends on existing project and credit APIs. Failure and
loading cannot masquerade as zero. No provider, graph, compiler, billing or
persistence contract changes; no data migration or customer deployment.
Rendering needs both-theme accessibility, denied-scope, stale-response,
keyboard, loading and zoom regression evidence. Glass requires readable contrast
and opaque reduced-transparency/forced-color fallbacks. Rollback is a web
artifact change and leaves existing projects and revisions untouched.

## Alternatives and reconsideration

A fabricated historical chart would misrepresent current API data. Keeping the
header Canvas control would retain the reported clutter. Uniformly shrinking
service text would retain unreadable overview cards. Reconsider compact tile
thresholds if large-graph review finds overlap or measurable rendering cost;
reconsider historical graphs only with a reviewed data contract.

## Review

Accepted after desktop light/dark and accessibility review, scope-denial tests,
minimap pointer/keyboard checks, loading/AI entry checks and focused regression
corrections. Scope is presentation and read-only composition under M9. Release
gates and hosted CI status remain explicit in the execution plan.

## References

- Execution plan (private historical evidence, omitted from this distribution)
- [Prior decision](0059-desktop-canvas-readability-and-utilities.md)
- [UI specification](../design/UI_SPEC.md)
- [Information architecture](../design/INFORMATION_ARCHITECTURE.md)
