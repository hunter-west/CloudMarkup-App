# Controlled-beta accessibility checklist

## Scope and evidence rule

This checklist covers the Cloud Markup editor, application and infrastructure
review, billing/usage, CI/CD, continuous-conformance, export, generated diagram,
and CLI surfaces for the controlled beta. Guided and Professional preferences
use the same component structure, dimensions, controls, fields, dialogs, and
actions. Only assistance copy, optional explanations, and technical-detail
disclosure may differ.

`automated` means a local deterministic assertion exists. `code-reviewed` means
the semantic path was inspected but still needs a person using the target
browser or assistive technology. `manual-required` is an explicit beta-release
activity. None of these labels claims WCAG conformance or assistive-technology
certification.

## Automated and code-reviewed coverage

| Area                         | Required behavior                                                                                                                                                 | Evidence                                                                                                     | Disposition                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Keyboard-only editor         | Reach the canvas, synchronized Architecture list, catalog, inspectors, issues, workload/application contracts, history, and export without a pointer              | `apps/web/e2e/editor-canvas.spec.ts`, `apps/web/e2e/editor-validation.spec.ts`, and component keyboard tests | automated, bounded Chromium                              |
| Non-canvas graph alternative | List every node, boundary, and connection; select and open the same shared configuration surface                                                                  | `ArchitectureTree.tsx` and `ArchitectureTree.test.tsx`                                                       | automated                                                |
| Movement and reparenting     | Visible up/down/left/right controls use the same Graph Command as drag; Change boundary opens the shared placement selector                                       | `ArchitectureTree.test.tsx` and `SelectedResourceInspector.tsx`                                              | automated                                                |
| Creation and connection      | Catalog Add and list/inspector Connect paths remain available in addition to drag                                                                                 | editor catalog, connection-wizard, and manual editor workflow E2E suites                                     | automated                                                |
| Focus and dialogs            | Logical focus order, trapped modal focus, Escape, and restoration to the launcher                                                                                 | UI modal/drawer tests and editor focus E2E cases                                                             | automated; manual review required                        |
| Forms and errors             | Labels, descriptions, error summaries, affected fields, and safe-fix review are programmatic                                                                      | inspector, connection, workload, validation, and export component tests                                      | automated; manual review required                        |
| Live state                   | Autosave, jobs, validation, evidence, billing, and export status use textual status/live-region contracts                                                         | editor persistence, assistant, export, conformance, and billing component tests                              | code-reviewed and automated by surface                   |
| Color independence           | Severity, selection, connection, evidence, billing, and CI states retain text/icon/border meaning                                                                 | component semantics plus forced-colors E2E assertions                                                        | automated; manual visual review required                 |
| Screen-reader naming         | Nodes, docks, connections, boundaries, policies, workload operations, findings, files, coverage, evidence, billing, and CI states expose names or associated text | respective component tests and accessible-name queries                                                       | code-reviewed; end-to-end screen-reader pass required    |
| Reduced motion               | Transitions, panels, canvas feedback, and status presentation do not require animation                                                                            | `editor-canvas.spec.ts` and UI modal tests                                                                   | automated                                                |
| High contrast                | System colors and explicit borders preserve boundary and interaction meaning                                                                                      | forced-colors cases in editor E2E suites                                                                     | automated, Chromium emulation; manual OS review required |
| Exported SVG                 | SVG has `role="img"`, stable title/description, and deterministic content                                                                                         | `packages/diagram-export/src/service.test.ts`                                                                | automated                                                |
| Conformance SVG              | In-app SVG has title/description and a redacted list alternative for mapped resources and connections                                                             | `ConformanceDiagram.tsx` and `ContinuousConformanceWorkspace.test.tsx`                                       | automated                                                |
| CLI human output             | Concise status, findings, next action, and explicit no-deployment statement                                                                                       | `packages/architecture-cli/src/cli.test.ts`                                                                  | automated                                                |
| CLI JSON output              | Stable structured output without terminal decoration or hidden interactive prompts                                                                                | architecture CLI contract and command tests                                                                  | automated                                                |
| Assistance parity            | Switching preference cannot alter controls, geometry, documents, severity, artifacts, authorization, billing, or deployment behavior                              | mode-parity component/E2E suites and immutable solution export export E2E                                    | automated for selected workflows                         |

## Keyboard task checklist

- [x] Create a catalog-backed resource with the visible **Add** action.
- [x] Select, configure, move, and change the boundary of a resource from the
      Architecture list without dragging.
- [x] Start and complete a typed connection from a visible control or `C`,
      including required questions and atomic preview confirmation.
- [x] Inspect and filter validation findings and invoke a reviewed safe fix.
- [x] Review Workload operations, application contracts, generated files,
      coverage, manifest, and CI status using ordinary controls.
- [x] Review Designed, Imported, Generated, Planned, Deployed, and Differences
      evidence without relying on the SVG canvas.
- [x] Export source, IaC, diagram, and evidence without implying that the web
      app deploys them.
- [ ] Run the full task set with NVDA and a supported Windows browser.
- [ ] Run the full task set with VoiceOver and Safari on macOS.
- [ ] Run keyboard-only checks in Firefox and WebKit, including native details,
      select, dialog, and file-preview behavior.

## Manual controlled-beta protocol

Record browser/OS/assistive-technology versions, task, expected focus target,
observed announcement, defect link, and reviewer. A blank result is not a pass.

- [ ] At 200% and 400% zoom, complete project start, editor, validation,
      revision, export, billing, and evidence tasks without content loss or
      two-dimensional page scrolling except intrinsically spatial canvases.
- [ ] Apply WCAG text-spacing overrides and verify labels, errors, tables,
      generated-file paths, and CI/evidence identifiers remain readable.
- [ ] Verify every dialog's initial focus, tab sequence, error focus, Escape
      behavior, close action, and focus restoration.
- [ ] Verify screen-reader announcements for autosave, job progress, validation
      changes, credit reservation/settlement, stale evidence, and export status
      are useful and are not excessively repeated.
- [ ] Verify nodes, docks, connections, boundaries, policies, operations,
      generated files, coverage, evidence layers, billing, and CI state by
      accessible name and relationship.
- [ ] Verify Windows High Contrast and macOS increased-contrast behavior in the
      supported browser matrix; color must never be the only state indicator.
- [ ] Verify reduced-motion behavior with OS preference enabled and confirm that
      no safety confirmation or live status is hidden by motion removal.
- [ ] Verify pointer/touch target size and all drag alternatives on laptop,
      tablet, and phone layouts.
- [ ] Inspect exported SVG in browser and screen reader; confirm its title and
      description identify the exact immutable revision and that sensitive
      values are absent.
- [ ] Run the CLI in a terminal screen reader and with redirected stdout; verify
      human output, JSON output, exit status, and the explicit no-deploy
      boundary.

## Release interpretation

The deterministic and selected Chromium evidence is suitable for regression
control. Controlled-beta release approval still requires the manual rows above,
triage of every blocker, and a documented supported browser/assistive-technology
matrix. Automated axe results do not establish complete accessibility.
