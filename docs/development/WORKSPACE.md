# Workspace guide

Use this page for local setup, package ownership and verification. Current beta
activation and release evidence live in [STATUS](../PUBLIC_STATUS.md), and
[HANDOFF](../PUBLIC_STATUS.md) identifies the active task. Local setup does not
grant deployment, production-data or paid integration authority.

## Toolchain and installation

- Node.js 24.18.0 is pinned in [`.node-version`](../../.node-version).
- pnpm 11.16.0 is pinned by the root `packageManager` field.
- Go 1.26.8 is pinned by the independent compiler module's toolchain directive.
- Turborepo coordinates TypeScript workspace build/type tasks.

Provide the pinned versions through your trusted local toolchain. Use
`GOTOOLCHAIN=local` when verifying that exact Go runtime. Do not commit
package-manager stores, tool downloads or local caches.

From the repository root, check your tools before installing dependencies:

```powershell
node --version
pnpm --version
go version
```

Compare their output with the pins above. Then install the frozen dependency set
and start the editor:

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

The first start builds the provider catalog before launching Vite. Open the
Local URL printed in the terminal, usually `http://localhost:5173`; use the
printed port if that one is occupied. Keep the terminal running and press Ctrl+C
there when you finish. Closing the browser does not stop the server.

The default Vite development surface uses bounded local/synthetic adapters. It
is useful for editor work without a cloud account. Real persistence and
immutable export journeys need the separately configured local
API/database/compiler adapters; the in-memory surface cannot prove those
boundaries.

## Verification by responsibility

| Command                                                     | Use and limitation                                                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `pnpm test:related <source-files...>`                       | Immediate static dependency feedback; does not prove dynamic consumers or shared contracts              |
| `pnpm test`, `pnpm test:unit`                               | All configured Vitest projects without coverage                                                         |
| `pnpm test:web`, `pnpm test:contracts`, `pnpm test:backend` | Owning test selections under the same root configuration                                                |
| `pnpm check:quick`                                          | Normal repository-wide inner loop                                                                       |
| `pnpm check:web`, `pnpm check:storybook`                    | Web/component lint, types, tests and relevant builds                                                    |
| `pnpm check:contracts`                                      | Schema/domain/provider compatibility and generated contract checks                                      |
| `pnpm check:backend`                                        | API authorization, persistence/application behavior and transport contracts                             |
| `pnpm check:compiler`                                       | Closed Go compiler and deterministic artifacts                                                          |
| `pnpm check:infra`, `pnpm check:deployment-inputs`          | Platform definitions, configuration and credentialless synthesis                                        |
| `pnpm check:assets`                                         | Reviewed provider asset provenance, registry and bundle boundaries                                      |
| `pnpm check:e2e`                                            | The complete configured synthetic browser/composed workstream chain                                     |
| `pnpm test:coverage`                                        | V8 coverage under ignored `coverage/`; configured environments still matter                             |
| `pnpm check`, `pnpm check:public`                           | Public build, quality/security and web/contracts/backend/platform tests; configured prerequisites apply |
| `pnpm check:full`                                           | Diagnostic and coverage profile; configured database/compiler prerequisites still apply                 |
| `pnpm security:check`                                       | Curated policy/secret checks and registry-backed dependency audit                                       |

Run focused evidence after a logical edit and the owning gate before review. The
full gate does not replace explicit browser, registry, configured database,
native compiler or release checks. Record failed aggregates and configured skips
truthfully. Do not rerun every expensive gate after a documentation correction.
See [test conventions](../engineering/TESTING.md),
[verification measurements](../engineering/VERIFICATION_PERFORMANCE_AUDIT.md),
[Definition of Done](../engineering/DEFINITION_OF_DONE.md) and
[CONTRIBUTING](../../CONTRIBUTING.md).

`pnpm check` aliases `check:public`, including builds, formatting, lint, types,
schema/catalog/compiler checks, public workflow-template validation, security
scans, the registry audit and web/UI, public contracts, backend and platform
tests. The public contracts/backend selections exclude only the private-input
fixtures identified in
[public status](../PUBLIC_STATUS.md#verification-profiles). Browser profiles run
separately. `pnpm check:full` adds coverage and Storybook; the unfiltered
coverage selection also retains hosted fixtures and their missing private
inputs, so it is not a standalone public-source admission gate. Configured
database/compiler prerequisites still apply. Under
[ADR-0062](../adr/0062-separate-beta-coverage-from-delivery.md), hosted
exact-commit test admission and scheduled/manual coverage are distinct;
historical preparation is limited to its selected consumer under
[ADR-0064](../adr/0064-ci-preparation-and-verification-only-changes.md).

For a public checkout, use `check:public`, `test:public:contracts`,
`test:public:backend` and the direct `test:e2e*` browser profiles used by public
CI. Unfiltered `test`, `test:contracts`, `test:backend`, `check:quick`,
`check:contracts`, `check:e2e`, beta/release and coverage commands retain
private fixtures; they are not public-source admission commands. Their retained
source does not supply the missing private history, workflows or operator
inputs.

## Synthetic browser and integration environments

`pnpm test:e2e:install` installs the Chromium revision pinned by Playwright. The
default browser profile fixes local origin, viewport, locale, time zone, color
scheme and reduced motion. Dedicated typed-backend and solution-export profiles
use their own explicit synthetic harness flags and fixed ports. They preserve
one worker and zero retries. Profile discovery is not test execution; enabling a
dedicated profile must not silently omit its cases.

Run `pnpm test:e2e:typed-backend` or `pnpm test:e2e:solution-export` for those
dedicated journeys. Their configurations live under `config/playwright`:
[typed backend](../../config/playwright/typed-backend.config.ts),
[solution export](../../config/playwright/solution-export.config.ts) and
[beta smoke](../../config/playwright/beta-smoke.config.ts). The
[browser TypeScript project](../../config/typescript/playwright.json) covers all
profiles and harnesses, including the
[default browser profile](../../config/playwright/default.config.ts). Run the
package scripts so the intended configuration is selected explicitly.

Browser journeys cover editing, connection and validation flows, local recovery,
preferences, revisions and exports where their harnesses apply. Backend
harnesses are synthetic and are not hosted authentication/tenant acceptance.
Bundled axe checks supplement semantic, focus, keyboard and manual
assistive-technology review; passing them is not WCAG certification. Results and
traces stay ignored under `test-results/`.

PostgreSQL integration suites use `CLOUDMARKUP_TEST_DATABASE_URL` for the owned
synthetic loopback service. Hosted CI provisions the same isolated service
boundary; local setup must use a disposable database, never beta credentials or
production data. Check the actual server/client state before starting or
stopping an owned cluster. HANDOFF records the existing workstation runtime, not
a standing claim that it is running.

Native compiler tests require `CLOUDMARKUP_TEST_COMPILER_EXECUTABLE` and a
freshly computed `CLOUDMARKUP_TEST_COMPILER_SHA256` for the pinned locally built
compiler. Historical-upgrade tests use `pnpm test:legacy-ai:prepare` only when
their selected consumer requires the fixed historical bundle. On a fresh store,
use `pnpm test:legacy-ai:prepare --fetch-dependencies` once to fetch that
verified historical lock without lifecycle scripts, then perform the same
offline build. Ordinary preparation remains offline. Preserve historical source
and checksum expectations; an unavailable prerequisite is not a passing skip.

The original V1 bundle, manifest and source stay byte-pinned. Preparation also
creates a separately pinned V2 test adapter that changes only the synthetic
configuration helper's two calendar bounds to follow its supplied clock. The
upgrade test verifies both artifacts and uses the adapter to issue real legacy
receipts on actual PostgreSQL. Production code, SQL clocks, expiration checks,
validator versions and persisted migration evidence remain unchanged. The
adapter is synthetic test setup, never production or live evaluation authority.

Billing uses the deterministic no-network fake by default. The optional
[Stripe sandbox guide](STRIPE_SANDBOX.md) describes separately authorized test
sessions and webhook setup. Model evaluation uses synthetic cases and approved
fake/adapter boundaries; normal tests do not make paid model calls. Existing
model or billing credentials are not permission to use them.

## Local disk space and retained evidence

Installed dependencies, build output and caches can outweigh the source tree.
pnpm often hardlinks dependency files across worktrees and its store, so summed
folder sizes can count the same stored bytes many times. Check file identities
and actual allocation before promising disk savings.

Use these read-only commands to identify worktrees, local changes and shared Git
storage:

```powershell
git worktree list --porcelain
git status --short --untracked-files=all
git count-objects -vH
```

An ignored path can still contain an active build, a required historical bundle
or the only receipt from a failed test. Keep those records with their evidence.
Preserve historical catalogs, migration SQL/checksums, fixtures and unmerged
work. Check the owning task before cleaning an output directory.

For a cleanup request, list exact paths, consumers and physical space estimates.
For redundant files, verify their full hashes and retain a canonical copy for
each distinct version. Record original paths, hashes and sizes in a restore
manifest, and test restoration before removing copies. Use a recoverable Git
commit for obsolete tracked files and an agreed backup/trash plan for local
data. Moving files to trash on the same volume does not itself free space.

## Generated files, assets and platform synthesis

`pnpm format` writes the pinned Prettier format; `pnpm format:check` only
checks. Typed ESLint uses a fail-correct ignored content cache, cold in CI.
`pnpm schema:check` and `pnpm catalog:check` compare generated artifacts byte
for byte after filtered dependency builds. Source and built-package imports
retain their declared package boundaries.

`pnpm go:check` runs formatting checks, vet and Go tests; `pnpm go:format`
writes formatting. `pnpm cdk:synth` writes ignored `infra/platform/cdk.out` and
verifies four nonempty capability/lifecycle templates, IAM and security
boundaries. This is real platform infrastructure, not placeholder-only output.
Synthesis remains local and credentialless and does not deploy customer or
platform infrastructure.

`pnpm ci:validate` builds the customer-workflow dependencies, validates the
retained generated customer workflow and runs public static security checks.
Private platform delivery workflows are omitted from this distribution. The
[public CI workflow](../../.github/workflows/public-ci.yml) runs `check:public`,
local/operator tooling and the existing default, typed-backend and
solution-export browser profiles once on a standard hosted runner. It supplies
an isolated PostgreSQL fixture and a freshly built/hash-bound compiler, without
private history, secrets, caches shared with privileged jobs or deployment
steps. Branch admission requires owner setup during publication; private beta
delivery retains its own exact-source and environment/OIDC protections.

Storybook is a development-only `@cloudmarkup/ui` isolation surface; its
dev/static commands disable telemetry and version checks. Its synthetic stories
are not hosted user-journey or accessibility-certification evidence.

`pnpm icons:test` covers importer, manifest, malicious-input, path and registry
boundaries; `pnpm icons:check` verifies exact reviewed AWS provenance, catalog
binding, registration and runtime approval. `pnpm assets:check` runs both.
Provider asset promotion accepts only explicit external local candidates and the
checked owner/source review. The dry-run command is:

```powershell
pnpm icons:promote:aws --staging <external-candidate-directory>
```

Its separate write option requires the reviewed candidate/approval evidence. It
downloads nothing, grants no approval and cannot replace the exact checked asset
digest with a caller-supplied approval. Post-promotion registry, malicious input
and production bundle checks remain required.

Background-job contracts live in `packages/job-framework`; actual worker entry
points are owned by `apps/api` and `infra/platform`. The retired empty
`apps/workers` placeholder is not a separate runtime.

## Work areas

| Path                                                                                       | Responsibility                                                                     |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `apps/web`                                                                                 | Browser delivery, project/editor/review surfaces and synthetic browser harnesses   |
| `apps/api`                                                                                 | Hono API, application ownership, adapters, composition and capability workers      |
| `packages/domain`                                                                          | Pure graph, lifecycle and provider-neutral domain behavior                         |
| `packages/schemas`, `packages/api-contract`                                                | Runtime, machine-readable and versioned HTTP contracts                             |
| `packages/provider-sdk`, `packages/provider-aws`                                           | Provider-neutral contracts and reviewed AWS implementation                         |
| `packages/model-gateway`                                                                   | Model admission, operation contracts and commercial lifecycle boundaries           |
| `packages/application-generator`, `packages/ai-extension-generation`                       | Deterministic source and review-only custom candidate generation                   |
| `packages/application-build-runner`, `packages/terraform-validation-runner`                | Pinned isolated execution/validation boundaries                                    |
| `packages/diagram-export`, `packages/solution-export`, `packages/solution-export-workflow` | Deterministic diagrams, packaging and authorized orchestration                     |
| `packages/repository-importer`, `packages/github-repository-export`                        | Exact observations/import and scoped repository export                             |
| `packages/architecture-cli`, `packages/customer-ci-workflow`                               | Read-only CLI and customer-owned workflow artifacts with explicit activation holds |
| `packages/job-framework`                                                                   | Generic deterministic lifecycle and queue/repository ports                         |
| `packages/ui`, `packages/config`, `packages/test-fixtures`                                 | Shared UI, strict configuration and synthetic contracts                            |
| `services/iac-compiler`                                                                    | Independent closed Go Terraform/CloudFormation compiler                            |
| `infra/platform`                                                                           | Platform CDK, runtime packaging and capability worker delivery                     |
| `evals`                                                                                    | Implemented synthetic model evaluation cases and deterministic verification        |
| `scripts`                                                                                  | Repository verification, generation and reviewed operator tooling                  |

Use declared package exports. Foundational packages cannot depend on apps or
platform adapters. The [system overview](../architecture/SYSTEM_OVERVIEW.md)
explains ownership and the
[dependency policy](../engineering/DEPENDENCY_POLICY.md) governs manifest,
lockfile and installation changes. Optional `.agents` skills and `.codex`
settings help development; they do not alter the repository safeguards.
