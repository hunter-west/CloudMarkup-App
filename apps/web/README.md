# `@cloudmarkup/web`

## Responsibility

Own the React/Vite browser presentation for authentication, projects, the
architecture editor, review, revisions, exports, settings, billing and usage.
The controlled beta includes real API-backed workflows as well as isolated
development fixtures. [Current status](../../docs/PUBLIC_STATUS.md) records
enabled capabilities and remaining holds.

## Editor and review boundaries

The parsed Architecture Document remains outside Zustand and React Flow.
Provider-neutral adapters project catalog-backed resources, boundaries, ports
and connections into the canvas and synchronized accessible Architecture list.
Semantic edits, placement, generated-resource lifecycle, undo/redo and safe
validation fixes use atomic versioned Graph Commands with exact preconditions.
Automatic layout is cancellable, previewed and persists only confirmed
positions.

Zustand owns transient presentation state: selection, viewport, hover,
disclosure, previews, finding focus and announcements. Report filters and local
warning review do not mutate validation evidence. Guided and Professional modes
share geometry, visible controls and semantic state; assistance wording never
changes authorization or generated output. Keyboard and non-drag controls remain
supported alongside pointer interaction.

AI infrastructure changes are reviewable proposals, subject to current catalog
and deterministic domain admission. Optional application source and candidate
fixes retain their explicit review and validation boundaries. Browser state,
route selectors and model output cannot establish authenticated identity,
membership, entitlement or persisted product authority.

## Local and hosted environments

Public entry starts at `/`. Link directly to `/login` or `/signup`; `/sign-in`
and `/sign-up` remain compatible aliases. `/forgot-password` starts recovery.
All paths require the same extensionless SPA fallback as other app routes (the
hosted CloudFront viewer request function and Vite already provide it). Other
static hosts must serve `index.html` for these paths while preserving API and
asset routing. No separate auth build or deployment-specific landing fork is
needed.

Account pages open the existing Cognito secure window for credential entry,
email confirmation, and recovery. Signup remains disabled when registration is
closed or availability is unknown. Existing verified sessions return to a
validated internal destination or their authenticated account/organization view.
`returnTo` never grants membership or access.

Root `pnpm dev` deliberately leaves the API origin unconfigured and uses
synthetic/local adapters. Integrated local journeys use `pnpm local:api` and
`pnpm local:web`, which supply the explicit loopback API origin and seeded local
identity. See the [workspace guide](../../docs/development/WORKSPACE.md).

Outside development, `VITE_CLOUDMARKUP_API_BASE_URL` is required. An absent
origin fails closed; requests and binary downloads never silently fall back to
the Vite origin. Development fixtures, IndexedDB recovery and the read-only
catalog/icon gallery are not proof of server persistence or production identity.

## Immutable revision and artifact review

Export requests name the authorized environment, target and portable name. The
project-scoped job view shows durable stage truth, rerun lineage, immutable
revision assessment, application-build confirmation, evidence, ownership,
checksums, file previews and previous-export differences. A successful build
does not rewrite the saved revision's generation assessment.

Verified artifacts use short-lived download grants. Authenticated fetch rejects
redirects, unsafe headers and filenames, verifies length and SHA-256, and checks
job/artifact/grant binding before saving a Blob. Failed or expired artifacts
remain reviewable without offering a download. Exported diagrams come from the
deterministic renderer; canvas screenshots are not architecture artifacts.

## Verification

From the root:

```powershell
pnpm check:web
pnpm test:e2e
pnpm test:e2e:solution-export
```

Browser profiles live under `config/playwright/`. Fixture-driven tests cover
interaction, accessibility, mode parity and request/download contracts; they do
not claim hosted backend or runner execution. Typed backend and configured
integration journeys have separate prerequisites and gates in
[TESTING](../../docs/engineering/TESTING.md). Keep negative, historical and
cross-boundary regression coverage when changing the UI.
