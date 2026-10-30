# Public source status

This distribution supports the credential-free synthetic editor. Its seeded
contributor setup candidate explicitly selects the standalone PG17 profile,
separate bootstrap/migrator/runtime logins and acknowledged core permissions.
Native fresh-database seed/API/restart acceptance remains pending. The persisted
standalone core has a synthetic PG17/operator, browser, restart and restore
acceptance receipt. An explicitly configured local profile also passed creation,
validation and authenticated download of an infrastructure-only CloudFormation
ZIP through the shared durable export workflow. Model-provider inference,
application-code generation, the hosted AWS platform, billing, DNS, and
deployment require independently supplied operator configuration and separate
qualification. Installing or building this source does not deploy infrastructure
or activate paid services.

For the editor, start with [the repository README](../README.md). For a seeded
contributor API and its known blocker, see
[local development](development/LOCAL_DEVELOPMENT.md). For persisted end-user
core setup, use [the self-host operator guide](../scripts/self-host/README.md),
complete its private-file and operator stages. For optional configured export
and model prerequisites, see the
[configured runtime guide](../scripts/self-host/CONFIGURED_MODELS.md).
[Architecture decisions](adr/README.md) and
[system architecture](architecture/SYSTEM_OVERVIEW.md) describe the design.

Internal release status, historical task plans, account-specific deployment
instructions, and operational evidence are intentionally not part of this public
source distribution. References retained in older decisions are historical
context, not a claim of present activation or acceptance.

## Local build sequence

1. Install the pinned Node.js and pnpm versions, then run
   `pnpm install --frozen-lockfile`.
2. Run `pnpm dev` for the credential-free preview. For persisted core setup,
   follow the standalone guide's ordered prerequisites and stages. Contributor
   API work additionally needs `pnpm build:backend` and the documented explicit
   PG17 bootstrap/migrate/permissions/seed stages; their complete native
   acceptance remains pending.
3. Run the owning package tests, type checks and builds for changes. Complete
   configured checks require their documented database and pinned Go
   prerequisites.

## Open decisions

This snapshot does not include internal release scheduling or account-specific
approval records. Hosted delivery, paid/provider integrations and external
security intake require separate operator configuration and qualification.
Proposed ADRs remain proposals until their decisions are accepted.

The
[catalog, canvas and tutorial audit](roadmap/plans/catalog-canvas-tutorial-20261029.md)
records source-matched local feature evidence, a workspace-tour restart/resume
repair, focused responsive/tutorial test corrections and exact live acceptance
scenarios. Integrated release admission and live verification remain separate;
exact editor-tour step resume after remount and ten definition-level icon
placeholders remain follow-up work.

## Repository identities

The public application source destination is
[`hunter-west/CloudMarkup-App`](https://github.com/hunter-west/CloudMarkup-App).
Its initial repository creation and publication are separate owner actions.
`hunter-west/CloudMarkup` remains the private AWS operations repository. Its
repository-ID-bound OIDC identity, hosted delivery and native AWS proof caller
guards remain private operations controls; public CI and local setup do not use
them. Historical audit/ADR references retain that original identity without
directing contributors to inaccessible private evidence. Public contribution and
clone instructions use the application repository.

## Verification profiles

`pnpm security:static` in this public source scans the public CI workflow,
retained generated repository workflow template, generated application source,
and Terraform fixtures. Its tests reject unpinned actions, generated command
execution, embedded credentials, and unsafe Terraform execution. Private hosted
release workflows are not distributed here; their deployment and CI admission
checks belong to the separately controlled hosted repository and are not implied
by this public source check.

`pnpm check:public` retains the application, compiler, API, and platform checks.
Its contracts profile excludes the private beta setup fixture and a hosted
evaluation fixture that reads undistributed deployment workflows. Their
account-specific inputs are deliberately absent from this source distribution;
the remaining public contracts stay in the check. The private hosted release
must run its own complete admission.

The public backend selection also excludes only
`model-live-historical-importer-upgrade-postgres.integration.test.ts`: that
suite requires an exact historical private checkout and compiled receipt closure
that are not distributed. The unfiltered backend command and its tests remain
unchanged for private admission. All other public PostgreSQL and native compiler
tests retain real synthetic prerequisites in public CI; absence of private
history does not justify disabling the database or compiler checks.

The [public CI workflow](../.github/workflows/public-ci.yml) uses one standard
hosted runner with read-only permissions, frozen dependencies and pinned
actions/toolchains. It runs the public gate, local/operator tooling and the
existing browser profiles, including their light/dark coverage. It uses no
deployment credentials and does not deploy or publish. Its first hosted run,
branch admission and private vulnerability-reporting verification remain
publication steps; local checks are not evidence that those remote settings are
active.
