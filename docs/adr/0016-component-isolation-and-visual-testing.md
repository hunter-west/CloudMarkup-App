# ADR-0016: Storybook component isolation and Playwright visual testing

- **Status:** Accepted
- **Date:** 2026-07-25
- **Owners:** CloudCanvas product and engineering
- **Supersedes:** None
- **Superseded by:** None

## Context

The planned shell and editor have many meaningful visual combinations:
comfortable and compact density, responsive layouts, focus and selection,
provider placeholders, node/edge/boundary status, generated resources,
connection previews, all validation severities, code diffs, asynchronous jobs,
offline/conflict states, and high contrast. End-to-end tests alone would make
those combinations slow and difficult to review, while screenshot comparison
alone cannot prove semantics or accessibility.

The repository currently uses Vitest and React Testing Library for the minimal
web foundation. It has no Storybook, browser automation dependency, or visual
baseline. The future isolation and browser-testing direction must be chosen
before UI implementation without installing tools prematurely.

## Decision

When the authorized UI milestone begins, CloudCanvas will use Storybook as the
component-isolation environment and Playwright as the browser interaction and
visual-regression runner.

No dependency is added by this documentation task. Exact versions, builders,
plugins, screenshot service, browsers, CI images, diff thresholds, and artifact
retention will be selected through the
[dependency policy](../engineering/DEPENDENCY_POLICY.md) when implementation is
authorized.

Storybook stories will be executable, synthetic, versioned state fixtures for
public `packages/ui` components and composed application surfaces. Stories will
not retrieve live catalogs, provider assets, APIs, fonts, model output, billing
state, or customer content. Exact catalog, validation, graph, usage, and asset
fixtures are injected.

Playwright will run selected stories and product workflows for:

- keyboard, pointer, focus order, focus restoration, dialogs, menus, drawers,
  resizing, and responsive interaction;
- accessible names, landmarks, live status, text alternatives, zoom, reduced
  motion, and high contrast;
- deterministic screenshots at pinned browser, operating-system/container,
  device scale, viewport, locale, timezone, motion, font, catalog, and asset
  inputs; and
- selected end-to-end shell/editor/review/export workflows once their API and
  domain behavior exists.

Vitest and React Testing Library remain the primary fast component and command
behavior layer. Domain, contract, provider, and compiler suites remain the
semantic oracle. Storybook and Playwright do not duplicate graph or validation
rules and do not make a screenshot the correctness oracle.

The minimum representative story matrix is the one in
[Design system](../design/DESIGN_SYSTEM.md#representative-component-state-matrix).
It includes every node, boundary, and edge state; Guided/Professional density;
responsive review; provider approved/placeholder assets; all inspector tabs;
connection and generated-resource previews; validation complete/incomplete/fix
states; code/diff; diagram preview; and loading, empty, stale, offline,
permission, limit, unsupported-version, and failure states.

Visual baselines:

- are generated only from pinned local deterministic inputs;
- exclude timestamps, random IDs, animations, network state, and machine paths;
- use reviewed synthetic content without credentials, customer data, account
  identifiers, or sensitive architectures;
- are stored only when small, stable, and reviewable;
- require a human explanation for intentional changes to semantic visuals;
- never update automatically merely because a comparison failed; and
- cannot mask a failing keyboard, accessibility, domain, or contract assertion.

A visual-diff tolerance is set from measured renderer/browser evidence at
implementation time. It cannot be made broad enough to hide missing content,
focus, labels, patterns, provider assets, or layout overflow.

## Consequences

### Positive

- Important combinations can be reviewed without constructing full application
  state repeatedly.
- Accessibility and responsive interaction can be tested in a real browser.
- Visual regressions in relationship patterns, focus, status, and placeholders
  become reviewable correctness evidence.
- Synthetic fixtures keep browser tests deterministic and safe.
- Story fixtures can support design, engineering, accessibility, and product
  review around one state vocabulary.

### Negative

- Storybook, Playwright, pinned browsers, fonts, and screenshots add dependency,
  CI, storage, and maintenance cost.
- Browser rendering can vary unless the execution environment is tightly
  controlled.
- Stories can drift from application composition without ownership and
  contract-backed fixtures.
- Screenshot review creates noise if baselines or tolerances are updated
  casually.

### Follow-up

- Evaluate and pin exact tool versions only when Prompt 13 implementation is
  authorized.
- Define package scripts, CI isolation, browser/container image, fonts,
  screenshot normalization, thresholds, and retention before accepting a
  baseline.
- Add public component stories alongside each component, not as a later
  screenshot-only project.
- Build reusable synthetic graph/catalog/validation/billing fixtures from public
  contracts.
- Add accessibility automation as supporting evidence while retaining manual
  keyboard and screen-reader review.
- Keep end-to-end coverage focused on canonical
  [user workflows](../product/USER_WORKFLOWS.md).

## Alternatives considered

### End-to-end tests only

Rejected because enumerating every component/status/density combination through
full product setup would be slow and obscure local visual failures.

### Vitest snapshots only

Rejected because DOM serialization does not prove browser layout, focus,
responsive behavior, forced colors, or rendered edge patterns.

### Screenshot tests only

Rejected because pixels cannot prove commands, semantics, accessible names,
focus order, announcements, or authorization.

### Adopt tools immediately during documentation

Rejected because the current task authorizes specification only, dependency
versions require policy review, and no component library exists yet.

## Compatibility, security, and rollback

This ADR adds no dependency, public package export, persisted contract, tenant
data, network call, credential, or deployment path today. Future browser tests
run without production credentials or live third-party access. If Storybook or
Playwright later cannot satisfy the repository toolchain, isolation, or
determinism requirements, replacing either tool requires a new ADR preserving
the fixture, browser, accessibility, and baseline controls above.

## References

- [Design system](../design/DESIGN_SYSTEM.md)
- [Accessibility](../design/ACCESSIBILITY.md)
- [UI specification](../design/UI_SPEC.md)
- [Testing strategy](../architecture/TESTING_STRATEGY.md)
- [Dependency policy](../engineering/DEPENDENCY_POLICY.md)
- [Definition of done](../engineering/DEFINITION_OF_DONE.md)
- [ADR-0013](0013-desktop-first-responsive-review.md)
- [ADR-0014](0014-design-system-ownership.md)
