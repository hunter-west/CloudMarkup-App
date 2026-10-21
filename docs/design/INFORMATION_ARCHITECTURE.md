# Cloud Markup Information Architecture

## Status and authority

This document is the normative information-architecture specification for the
planned Cloud Markup product experience. It defines future routes, navigation,
screen responsibilities, access behavior, and responsive presentation. It does
not claim that every described route or screen is implemented. M9
controlled-beta hardening is active; current activation and release evidence are
recorded in [Project Status](../PUBLIC_STATUS.md).

This specification organizes the capabilities in the
[Product Specification](../product/PRODUCT_SPEC.md) and the canonical
[User Workflows](../product/USER_WORKFLOWS.md). Billing and usage routes present
the [Commercial Model](../product/COMMERCIAL_MODEL.md) and
[Billing and Usage](../architecture/BILLING_AND_USAGE.md) contracts. This
document does not replace the [Domain Model](../architecture/DOMAIN_MODEL.md),
provider catalog, Graph Command contract, validation reports, authorization
policy, entitlement projection, or artifact contracts. When UI copy or state
conflicts with one of those authoritative sources, the source wins and the UI
must fail closed.

## Information-architecture principles

1. The organization is the tenant boundary and a project is an
   organization-owned workspace.
2. A mutable draft, immutable revision, and immutable generated artifact are
   different resources and always appear as different lifecycle states.
3. Route identifiers and query parameters are selectors, never proof of
   identity, membership, ownership, permission, version compatibility, or
   entitlement.
4. Verified authentication context identifies the actor. The server derives
   tenant context, authorizes each resource and action, and returns only
   information that actor may see.
5. The architecture graph is the source of truth. A prompt, assistant message,
   canvas position, URL, diagram, and generated file are views or proposals,
   never competing architecture state.
6. AI, templates, connection wizards, direct manipulation, and future bulk
   actions all produce proposals or versioned Graph Commands. The UI never
   recreates domain or provider rules.
7. Guided and Professional modes are personal assistance-copy preferences over
   the same routes, editor component/control tree, geometry, fields, workflow
   stages, actions, documents, commands, findings, revisions, artifacts, and
   entitlements, as required by
   [ADR-0006](../adr/0006-guided-professional-shared-semantics.md) and refined
   by
   [ADR-0018](../adr/0018-shared-editor-presentation-and-assistance-only-modes.md).
8. Full graph construction is desktop-first. Tablet and phone layouts retain
   truthful review, explanation, finding, revision, job, and export state
   without implying precision-editing parity.

## Route hierarchy

The route forms below are the canonical browser locations for the first product
experience. A trailing slash is normalized away. Tab, filter, sort, and
selection state may use search parameters or fragments, but those values do not
identify or mutate domain resources.

### Public and authentication routes

| Route                             | Screen responsibility                              | Required behavior                                                                                                                                                                                                                                          |
| --------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/sign-in`                        | Start or resume authentication                     | Offer configured sign-in methods, a safe return target, privacy/help links, and distinct retryable or terminal errors. Never reveal organization membership before authentication.                                                                         |
| `/auth/callback`                  | Complete the configured identity-provider exchange | Show a bounded progress state, validate the callback server-side, consume transient parameters, and replace the URL before entering an authenticated route. It is not a general application landing page.                                                  |
| `/invitations/:invitationToken`   | Accept an organization invitation                  | Exchange the opaque token once, require authentication when needed, and remove the token from normal history and navigation. Invalid, expired, revoked, already-consumed, and unauthorized outcomes use safe explanations without leaking membership data. |
| `/denied`                         | Generic permission-denied result                   | Explain that access is unavailable without naming an organization, project, revision, artifact, member, or policy the actor cannot view.                                                                                                                   |
| `/unsupported`                    | Generic incompatible-version result                | Explain the unsupported document, catalog, artifact, or client-version class and safe available actions. It never offers editing or compilation against an unsupported version.                                                                            |
| `/not-found` and unmatched routes | Generic absent-or-unavailable result               | Avoid distinguishing a nonexistent tenant resource from an existing resource the actor cannot access. Offer a safe return to the last authorized organization or sign-in.                                                                                  |

The sign-in return target must be a validated same-origin application path.
Authentication and invitation secrets must not be copied to analytics, logs,
page titles, referrers, notification content, or support links.

### Personal settings routes

Personal settings are outside an organization URL because they belong to the
verified actor rather than an Architecture Document.

| Route                   | Screen responsibility                                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `/settings/profile`     | Actor display information and other approved profile fields                                                                               |
| `/settings/preferences` | Guided or Professional assistance-copy default, panel layout, reduced-motion override where supported, and other non-semantic preferences |
| `/settings/security`    | Actor sessions and approved account-security actions                                                                                      |

Organization ownership, membership, entitlements, and billing never move into
personal settings. A personal preference cannot change graph meaning, validation
results, revision contents, or exports.

### Organization routes

All routes in this section begin with `/organizations/:organizationId`. The
organization identifier is an untrusted selector and every screen waits for
authorized organization context before rendering tenant content.

| Suffix                   | Screen responsibility                                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `/dashboard`             | Read-only organization overview: recorded credit balance, recent projects, project snapshot and quick-start actions                      |
| `/projects`              | Project dashboard: searchable project list, lifecycle state, recent authorized activity, limits, and **New project**                     |
| `/templates`             | Browse curated, versioned templates the organization may use                                                                             |
| `/templates/:templateId` | Review template intent, supported provider/catalog context, assumptions, version, and proposed starting contents before project creation |
| `/billing`               | Organization subscription projection, plan and entitlement summary, and owner-only hosted Checkout or Customer Portal entry points       |
| `/usage`                 | Cloud Markup credits: allocation, reservations where useful, consumption history, limits, and authorized technical detail                |
| `/settings/general`      | Organization name and approved general metadata                                                                                          |
| `/settings/members`      | Membership list, invitation lifecycle, and authorized membership actions                                                                 |
| `/settings/roles`        | Role assignments and the future approved role model                                                                                      |
| `/settings/policies`     | Organization product policies and capability constraints once defined                                                                    |
| `/settings/security`     | Organization security posture, sensitive audit entry points, and approved security controls                                              |
| `/settings/data`         | Retention, export, and deletion controls only after their policy and authorization are approved                                          |

Only an authorized organization owner may start billing-management flows. Exact
non-owner role names, permissions, delegated billing visibility, retention
behavior, and policy controls remain unresolved roadmap decisions. Until those
contracts exist, the screens show only server-authorized capabilities and
accurate unavailable states; they do not invent a role matrix or destructive
data action.

### Project routes

All project routes begin with `/organizations/:organizationId/projects`. Project
and child-resource identifiers remain untrusted selectors.

| Suffix                                            | Screen responsibility                                                                                                                                                                                                      |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/new`                                            | Choose prompt, template, or blank start; collect only the name and allowed initial metadata; show quota or entitlement state before submission                                                                             |
| `/:projectId`                                     | Project overview with current draft, latest immutable revision, artifacts, findings summary, jobs, and the next authorized action                                                                                          |
| `/:projectId/intent`                              | Review and correct the versioned provider-neutral Intent Document, including requirements, assumptions, unknowns, decisions, data sensitivity, availability, and cost preferences                                          |
| `/:projectId/editor`                              | Main architecture editor for the mutable draft, or an explicit read-only representation when editing is unavailable                                                                                                        |
| `/:projectId/revisions`                           | Immutable revision history with lineage, version bindings, validation summary, and artifact status                                                                                                                         |
| `/:projectId/revisions/:revisionId`               | One immutable revision: graph and diagram review, metadata, validation evidence, lineage, and authorized “start new draft work” action                                                                                     |
| `/:projectId/artifacts/:artifactId/review`        | Immutable combined-artifact review with manifest, complete file diff, IaC, supported application source and built-workload entries where present, deterministic diagrams, metadata, diagnostics, and verification evidence |
| `/:projectId/artifacts/:artifactId/export/zip`    | Confirm and obtain the exact reviewed ZIP artifact                                                                                                                                                                         |
| `/:projectId/artifacts/:artifactId/export/github` | Authorize repository scope, review branch and pull-request intent, submit the exact reviewed artifact, and inspect idempotent result or partial failure                                                                    |

The creation screen keeps prompt/template/blank step state inside the creation
flow. After the project and initial draft are created atomically, navigation
moves to intent review for prompt-based creation or to the editor for an
approved template or blank start. A failed creation never navigates to or
suggests an orphaned project.

The artifact-review route may represent Files, Diff, IaC, Application source,
Built workloads, Diagram, Validation, and Metadata as tabs. Missing application
sections are explicitly unavailable, not empty proof of generation. Tab
selection is presentation state; every tab remains bound to the same immutable
artifact identity and digest. ZIP and GitHub routes are confirmation workflows,
not alternate artifacts and cannot generate or build content.

## Navigation model

### Global navigation

The authenticated shell provides:

- the provisional Cloud Markup text wordmark, which returns to the current
  organization Dashboard;
- an organization switcher containing only authorized organizations;
- a project context control when a project is open;
- in the editor, a compact immediate-action header with **Undo**, **Redo**,
  **Help** with Commands, and authoritative save/revision actions; Canvas
  actions open from the minimap;
- global access to personal settings and sign-out; and
- a compact route to organization settings for actors with at least one
  authorized settings capability.

Changing organizations clears project selection, tenant-derived cached content,
notification context, and open overlays before requesting the new organization
context. The previous organization's content must never remain visible beneath a
loading shell.

### Organization navigation

Navigation groups are ordered **Workspace** (Dashboard, Projects, Templates),
**Account** (Profile, Preferences, Personal security), and **Organization**
(Organizations, Usage, Plans & billing, Organization settings). Billing appears
only when the actor may view billing context; its management actions
additionally require the accepted owner-only rule. Hiding an unauthorized
navigation item is not the authorization control.

Settings navigation exposes only implemented and authorized sections. A deep
link to another section still receives a server-side permission check and a safe
denied response.

### Project navigation

Project-level navigation distinguishes:

- Overview;
- Intent;
- Draft editor;
- Revisions; and
- Artifacts and export status.

The shell always labels the active lifecycle resource as **Draft**,
**Revision**, or **Artifact**. An immutable revision or artifact never presents
editable draft controls. “Edit this revision” means creating or opening new
draft work with explicit lineage; it does not mutate the revision.

Browser Back and Forward restore route and non-sensitive presentation state.
They never replay a Graph Command, repeat an export, re-consume an invitation,
or infer that an async action succeeded.

## Screen responsibilities and authoritative inputs

| Screen                  | Reads from                                                                                                                                        | May request                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Project dashboard       | Authorized project summaries, lifecycle state, entitlements, job summaries                                                                        | Project creation or navigation                                                                   |
| Template browser/detail | Released template descriptors and their pinned compatibility metadata                                                                             | A project-creation proposal                                                                      |
| Intent review           | Versioned Intent Document and deterministic validation                                                                                            | Versioned intent edits and explicit decisions                                                    |
| Draft editor            | Exact draft version, Architecture Document including Workload Behavior, catalog descriptors, connection previews, validation report, capabilities | Validated Graph Commands, validation, revision creation; no source generation or build execution |
| Revision history/detail | Immutable revisions, lineage, pinned versions, validation evidence                                                                                | New draft work or an authorized compilation job                                                  |
| Artifact review         | Exact immutable artifact manifest and IaC/diagram/application-source/built-workload digests present for that identity                             | No artifact mutation, generation, or build; only export of the reviewed identity                 |
| ZIP export              | Reviewed artifact, entitlement, capability                                                                                                        | Idempotent retrieval of that exact artifact                                                      |
| GitHub export           | Reviewed artifact including supported application source, authorized repository target, integration state                                         | Idempotent branch and pull-request creation; never generate, build, merge, force-push, or deploy |
| Billing                 | Local webhook-derived subscription projection and entitlements                                                                                    | Owner-only redirect to Stripe-hosted surfaces                                                    |
| Usage                   | Organization credit ledger projections and authorized detail                                                                                      | Navigation or policy-approved model work elsewhere; never ledger rewriting                       |

Catalog fields, UI hints, ports, connection descriptors, resolver previews,
education, unsupported capabilities, mapping readiness, and region availability
are consumed as versioned provider inputs. The UI may organize and explain them
but must not maintain a competing service definition, connection rule, IAM
allowlist, availability claim, or compilation-support list.

## Capability-based access behavior

The server returns authorized resource data and allowed actions for the verified
actor and current tenant context. The client uses that result to render the
screen but never treats it as a substitute for authorization on later requests.

For each route or action:

- no view capability produces the generic absent-or-denied experience without
  tenant detail;
- view without mutate capability produces a clearly labeled read-only
  experience;
- an unavailable action is omitted when its presence would leak information;
  otherwise it may be disabled with a safe explanation;
- destructive, export, membership, billing, and security-sensitive actions are
  reauthorized at submission;
- a capability change while the screen is open invalidates affected UI state and
  safely dismisses now-unauthorized overlays; and
- cached data from one organization is never used to populate another.

The planned UI uses capabilities rather than encoding guessed role names.
Organization owner is the only role with a currently accepted special rule:
billing management is owner-only. The exact remaining role and permission matrix
is deferred to M2.

## Shared screen states

Every route owns a state model; a blank area or endless spinner is not an error
strategy.

| State               | Required presentation and behavior                                                                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Initial loading     | Show stable page and control skeletons, a text status for assistive technology, and no previous-tenant content. Delay destructive or semantic actions until identity, resource version, capabilities, and required contracts are known.                                              |
| Incremental loading | Keep already-authorized content visible, identify the region being refreshed, and preserve navigation. A loading finding or job does not imply success.                                                                                                                              |
| Empty               | Name what is empty, why that is expected, and the next authorized action. Search/filter emptiness is distinguished from no resources existing.                                                                                                                                       |
| Offline             | Show a persistent offline status. Read-only cached content is labeled with its last known version. Local draft commands may be shown as **Queued offline**, never **Saved**; compilation, revision creation, invitation exchange, billing, and export submission require the server. |
| Stale data          | Mark the affected draft, findings, artifact status, or list with its known version and refresh it. Findings from another draft version cannot appear current.                                                                                                                        |
| Save conflict       | Stop automatic submission, preserve the user's local command queue, show the server version and a review path, and never silently choose or overwrite a newer draft. Reapply is allowed only by revalidating command preconditions against the chosen current version.               |
| Permission denied   | Use the neutral denied/not-found treatment, clear protected content, restore focus to a safe location, and avoid resource-identifying copy.                                                                                                                                          |
| Read-only           | Keep review, navigation, copy, and authorized export controls available; label the reason category without exposing private policy detail; remove or disable mutation affordances consistently.                                                                                      |
| Limit reached       | Distinguish product entitlement, project/export limit, exhausted Cloud Markup credits, and temporary platform capacity. Show an authorized resolution path; do not equate credits with plan entitlement or payment.                                                                  |
| Retryable failure   | Preserve safe user input, name the failed operation and whether it had any effect, and offer one bounded retry. Idempotent operations reuse their identity where required.                                                                                                           |
| Terminal failure    | State that the operation did not complete, preserve safe diagnostic references, remove misleading progress, and offer a safe return path.                                                                                                                                            |
| Unsupported version | Fail closed for edit, validation claims, compilation, and export creation. Show the unsupported contract class and versions when authorized, preserve the source, and offer only explicitly supported migration, download, or support actions.                                       |
| Async pending       | Show queued/running phase, immutable input identity where applicable, cancel availability, and last update. Pending is never presented as complete.                                                                                                                                  |
| Async canceled      | State what was canceled and what immutable inputs or prior artifacts remain.                                                                                                                                                                                                         |
| Async failed        | Distinguish user-input, compatibility, verification, integration, entitlement, and platform failures without exposing secrets. Retrying must not fabricate or duplicate revisions, artifacts, or pull requests.                                                                      |

A validation report with any engine diagnostic is **Incomplete**, even if it has
zero findings. The interface must not show a green/clean state for an incomplete
report. Finding severity alone does not determine revision or export blocking;
the future product-wide application policy owns gating and suppression.

## Responsive route behavior

The same route and resource identity remain active at every size. Layout does
not fork the document or change commands.

| Layout posture       | Initial viewport width | Experience                                                                                                                                                                                                                                                                                                                                                |
| -------------------- | ---------------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop construction |              >= 1280px | The canvas remains behind the persistent, resizable 336px Catalog, a fixed 92px right Inspector launcher, and a fixed 48px bottom Workspace launcher. Architecture, Configure, Connect, Learn, IaC, Assistant, Issues, Code, Activity, and Jobs share one rich popup; only one is open at a time. Compact service nodes are 176 by 72 pixels.             |
| Tablet review        |       `768px`–`1279px` | Canvas or list/tree review occupies the main area; Catalog, each Inspector destination including the separate Architecture list, and Workspace destinations open as mutually managed drawers or sheets. Safe form edits and command-based actions may remain available, but the UI explicitly routes precision placement and boundary fitting to desktop. |
| Phone review         |              `< 768px` | List/tree architecture is primary. Users can navigate nodes and edges, read explanations and findings, review intent/revisions/diffs, monitor jobs, and approve or download already-reviewed exports when authorized. Precision graph construction is unavailable and labeled as such.                                                                    |

At 200% browser zoom or when the effective content width crosses a posture
boundary, the corresponding responsive layout applies without horizontal page
scroll. Code and large tables may use contained, labeled scrolling regions.
Dialog content becomes a full-height sheet on constrained widths; focus, heading
hierarchy, field order, workflow stages, and action order remain the same.
Experience mode never selects a different reflow or density.

Desktop launcher and popup surfaces change only the safe area available for
controls and the minimap; they do not resize, reparent, or otherwise reinterpret
the Architecture Document. Catalog alone uses an approximately 8px resize edge
with a 1px visual boundary. The 92px Inspector and 48px Workspace launchers stay
fixed; their shared popup uses one scroll owner, an opaque surface, restrained
drop shadow, and 160ms open/close motion that becomes immediate under reduced
motion. Architecture is an independent Inspector destination. Service collapse,
aggregate input/output dots, popup selection, hover/focus labels, and
double-click Configure routing remain presentation state, so the full-canvas
editor never requires horizontal page scrolling or changes semantic hashes.

The editor workspace below the application bar is also the common positioning
boundary for menus, connection-dock actions, popovers, modeless launcher
surfaces, and modal tasks. Only one transient contextual overlay remains active;
a modal task dismisses modeless Inspector/Workspace content before modal focus.
This coordination changes presentation and focus only, never route, resource,
document, or command identity.

No phone-only or tablet-only mutation may bypass the shared command,
authorization, validation, revision, or export pipeline. Conversely, lack of a
precision canvas must not hide semantic state: the list/tree alternative exposes
boundaries, parentage, typed ports, edge direction and meaning, configuration
summaries, provenance, and findings in text.

## Deep-link and recovery rules

- A valid deep link returns to the requested route only after authentication,
  organization context, capabilities, and resource compatibility are known.
- An expired session stores only a safe same-origin return route; unsaved
  sensitive form values and invitation tokens are not placed in URLs or browser
  storage.
- Refreshing a draft route reloads the persisted version and then reconciles any
  explicitly identified local queue. It does not assume an in-memory command was
  saved.
- Refreshing a revision or artifact route resolves the immutable identity and
  digest again. A replacement artifact has a new identity and cannot silently
  occupy the old URL.
- Removed access, deleted resources, unsupported versions, and tenant changes
  converge on safe denied/not-found/unsupported states rather than stale
  content.
- External Stripe and GitHub round trips return to a bounded status route.
  Browser return state is informational; the local subscription projection or
  audited export result is authoritative.

## Planned implementation acceptance

Future implementation is conformant only when:

- route tests cover authenticated, unauthenticated, invited, denied,
  cross-tenant, read-only, limit, offline, stale, retry, and unsupported-version
  cases;
- no tenant content renders before the selected route is authorized;
- lifecycle labels prevent a draft, revision, or artifact from being mistaken
  for another;
- desktop, tablet, phone, keyboard, and list/tree navigation reach the same
  authorized review information;
- organization switching clears prior tenant state;
- a billing redirect never changes visible entitlements until the trusted local
  projection changes;
- an incomplete validator result never appears clean;
- export routes remain bound to the exact reviewed immutable artifact; and
- route or preference state never changes architecture deployment semantics.

Detailed shell behavior is specified in [UI Specification](UI_SPEC.md), and
representative layouts are in [Wireframes](WIREFRAMES.md). Accessibility
requirements apply from [Accessibility](ACCESSIBILITY.md), while visual tokens
and component states are owned by [Design System](DESIGN_SYSTEM.md).
