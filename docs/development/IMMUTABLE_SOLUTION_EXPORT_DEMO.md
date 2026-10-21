# Immutable Solution Revision export demo

This Prompt 33/33A demo exercises the complete-package browser review workflow
against a fixture-driven API surface. Playwright intercepts the export requests
with schema-shaped, tenant-scoped responses and reviewed fixture artifacts,
including the exact immutable SVG/PNG diagram manifest and preview. It does not
execute the API/worker composition, contact AWS, use customer credentials, run
build tools or Terraform, deploy infrastructure, or publish artifacts outside
the local test process.

## Prerequisites

- Install the repository's pinned dependencies with
  `pnpm install --frozen-lockfile`.
- Install the repository's pinned Playwright Chromium browser if it is not
  already present.
- Start from the repository root. No API, worker, database, or AWS service needs
  to be running.

## Automated walkthrough

Run the complete Prompt 33 browser scenario set:

```powershell
pnpm test:e2e:solution-export
```

The isolated Playwright configuration starts a local Vite server on port 4175,
intercepts only the Prompt 33 API surface, and stops the server after the run.
The suite verifies these browser behaviors against those fixtures:

- export creation sends only the immutable Solution Revision ID, environment,
  approved target-profile ID, portable export name, and idempotency key, and
  rejects a response whose revision or target binding differs;
- diagram creation binds presentation/technical profile, approved background,
  scale/dimensions, immutable-revision source wording, and optional technical
  stable identifiers without adding browser viewport state;
- infrastructure-only, generated-starter, and complete-supported-pattern exports
  show immutable `generationCoverage` separately from application-build
  confirmation or downgrade;
- compiler, generator, build, contract-test, and Terraform-validation failures
  remain visible and cannot receive a download grant;
- the mocked retry/cancellation scenario retains the same displayed revision and
  job while exercising the cancellation action;
- expired and cross-tenant artifacts cannot be downloaded;
- reloading the same mocked completed run retains its exact archive digest, and
  a separate fixture shows the fixed previous-export semantic/file diff;
- Guided and Professional modes keep identical tabs, controls, selected file,
  and job URL while only the reserved help text changes; and
- the Diagram tab previews the canonical SVG through a non-executable image
  boundary, exposes SVG/PNG/README checksums and dimensions, and retains the
  server's large-diagram warnings;
- the browser downloads only through an authenticated, five-minute grant after
  verifying safe headers, filename, length, and the complete SHA-256 checksum.

The focused `SolutionExportPage` component suite, run by `pnpm check:web`,
separately verifies non-empty solution/workload missing requirements, unresolved
requirement IDs, coverage requirement/Evidence-ID pairs, application Evidence
linkage, safe diagnostic provenance, and `runSequence`/`rerunOfJobId`. The
Playwright command above does not replace that component evidence.

## Human-guided review

For an interactive inspector session, run:

```powershell
pnpm test:e2e:solution-export -- --debug
```

In the Playwright inspector, select the test named **shows exact
complete-supported success coverage without overclaiming**, then step through
these review points:

1. Confirm the page identifies the exact immutable Solution Revision and
   approved target profile.
2. Review the ordered phase/progress list, run sequence, exact generation
   coverage, distinct application verification, safe diagnostic references, and
   separately labeled Evidence.
3. Open Diagram and verify the immutable-revision statement, renderer/profile,
   dimensions, warnings, SVG/PNG toggle, and the three exact diagram files. Then
   open Sources, IaC, Application, Built artifacts, Tests, Diff, and Manifest;
   inspect bounded previews, ownership, and complete checksums.
4. Review the previous-export semantic and file diff. The baseline is fixed at
   job creation and never selected again while polling.
5. Switch from Guided to Professional. Confirm the active tab, selected file,
   action order, and job URL do not change; only assistance wording changes.
6. Authorize the download. Confirm the grant is short-lived, then download the
   verified complete Solution ZIP through the authenticated request. Inspect it
   locally and confirm `diagram/architecture.svg`, `diagram/architecture.png`,
   `diagram/README.md`, application and infrastructure outputs, Evidence, the
   root README's relative `diagram/architecture.svg` reference, and the matching
   manifest checksums.

Next, run one blocking scenario, for example:

```powershell
pnpm test:e2e:solution-export -- --grep "terraform-validation-error"
```

Confirm the stable sanitized diagnostic and completed evidence remain visible,
while no artifact or download action is offered. Repeat with
`infrastructure-only` to confirm the IaC export succeeds while the UI clearly
states that application code is still required.

## Architecture-as-code repository verification

Prompt 33B adds a generated-repository CLI fixture and reviewed no-credential
workflow policy tests. Run the exact local boundary checks with:

```powershell
pnpm check:architecture-cli
pnpm ci:validate
```

The CLI suite creates a complete manifest-bound repository in an isolated
temporary directory, runs all seven human/JSON command contracts through one
exact registered fixture pipeline, repeats verification, detects byte and
semantic drift, and proves user-owned paths, Windows/traversal paths, malicious
labels, profile substitution, and oversized output fail safely. It does not
contact AWS or execute arbitrary source.

To review the source binary's fail-closed distribution behavior:

```powershell
pnpm --filter @cloudmarkup/architecture-cli build
node packages/architecture-cli/dist/bin.js validate --root <export-repository> --format json
```

The raw private workspace build intentionally contains no implicit pipeline
registration. It returns `cloudmarkup.cli.pipeline-profile-unavailable` unless a
reviewed distribution registered the exact ID/version/digest pinned by
`<export-repository>/.cloudmarkup-cli.json`. Do not substitute test coordinates.
The application-build and Terraform-validation documents explicitly record that
the reviewed local images are not yet published; until they are, the generated
workflow template is a reviewed fail-closed template rather than hosted or
customer-cloud Evidence.

## Production boundary

This Playwright demo validates the web experience and client-side contract
bindings only; every Prompt 33 API response and download is mocked by the
Playwright harness. Backend integration tests separately exercise the exported
injected local composition: an injected compiler and concrete
application-generator, application-build-runner, Terraform-validation-runner,
and export adapters sit over fake bounded executors and deterministic
repositories. Those tests cover state-aware run lineage, late cancellation,
progress projection, publication integrity, and persistence retry without
running arbitrary host commands. They do not make this browser harness
end-to-end production evidence.

Prompt 33 does not deploy the worker, CodeBuild projects, object store, or
database migration. The ordinary local API server and hosted `createApp` remain
fail-closed without an injected Solution export application. The exported local
composition is a test/integration seam, not default server wiring. Production
queue, SQL/object-store, and runner adapters must be composed and reviewed in a
separate authorized deployment workflow before this demo can represent a hosted
service.
