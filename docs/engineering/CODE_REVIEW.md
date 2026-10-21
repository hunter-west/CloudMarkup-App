# Code-review checklist

Use the sections that apply to the change. A checked item means the reviewer
examined evidence; it does not mean the concern was assumed away.

## Review rules

- Review the complete diff in milestone and package context; passing automation
  is evidence, not proof of correctness.
- Report actionable findings with a file/location, failure scenario, impact, and
  the smallest safe direction. Distinguish blockers from optional polish.
- Treat exploitable security/tenant failures, data loss, public-contract breaks,
  nondeterministic compiler output, deployment paths, and failing required gates
  as high priority. A change is not done while one remains unresolved.
- Re-run the relevant check after a fix and record uncertainty when evidence is
  incomplete. Do not approve by assumption or suppress failures broadly.

## Correctness and scope

- [ ] The change matches the active milestone and execution plan without
      implying later product behavior.
- [ ] The implementation is the simplest sufficient change. New abstractions,
      dependencies, frameworks, gates, or reports have a concrete task need;
      unrelated findings remain follow-up.
- [ ] Happy paths, invalid input, failure states, retries, and boundary
      conditions are correct for the changed risk.
- [ ] Package dependencies point inward through declared public exports; there
      are no deep cross-package imports.
- [ ] The documentation, status, and handoff distinguish implemented facts,
      accepted decisions, proposals, and open questions.

## Tests and deterministic output

- [ ] Each added or retained case meets the
      [8/10 criticality criterion](TESTING.md#test-selection-and-criticality),
      with a distinct core-feature or critical-behavior reason grounded in
      actual assertions, source paths and retained overlap; previously rated
      7/10 cases are reassessed and parameter families distinguish meaningful
      branches from equivalent variants.
- [ ] New cases identify a distinct behavior/risk and reuse the owning suite;
      repeated layer/mode/viewport scenarios have a concrete reason. Review
      includes count delta and comparable focused runtime, or marks timing
      unmeasured, under the
      [test-growth budget](TESTING.md#test-growth-and-runtime-budget).
- [ ] Tests exercise observable behavior and meaningful negative cases at the
      changed boundary.
- [ ] Tests and fixtures are deterministic, synthetic, isolated from live
      services, and independent of execution order.
- [ ] Semantic results do not depend on UI coordinates, incidental ordering,
      timestamps, machine paths, or uncontrolled identifiers.
- [ ] Generated output and future compiler fixtures are reproducible; golden or
      snapshot changes have a reviewed semantic explanation.
- [ ] The root [verification cadence](../../AGENTS.md#verification-cadence) is
      satisfied, with source-bound results, reasons for omitted layers, and an
      owner for pending integrated checks.

## Security and tenant boundaries

- [ ] Inputs are schema-validated at trust boundaries and failures do not leak
      sensitive content.
- [ ] Tenant identity comes only from verified authentication context, and
      tenant-owned reads and mutations have allowed, denied, and cross-tenant
      tests as applicable.
- [ ] Logs, prompts, fixtures, examples, and errors contain no credentials,
      customer data, sensitive architecture content, or production identifiers.
- [ ] New permissions are least privilege; no model, compiler, workflow, or
      formatter can deploy, execute arbitrary commands, or select unapproved
      providers.
- [ ] `pnpm security:check` passes for dependency, workflow, script, fixture, or
      security-sensitive changes.

## Public and persisted contracts

- [ ] Public package exports, HTTP contracts, schemas, persisted data, job
      envelopes, and cross-language contracts are versioned where required.
- [ ] Compatibility, migration, or intentional rejection behavior is explicit
      and tested.
- [ ] Immutable revision inputs retain graph-schema, compiler, provider-catalog,
      and output-format versions where applicable.
- [ ] Provider-specific behavior stays behind explicit contracts and does not
      leak into the provider-neutral domain.

## Web accessibility

- [ ] Interactive behavior works with keyboard and appropriate focus handling.
- [ ] Controls, landmarks, headings, status messages, and errors expose useful
      accessible names and semantics.
- [ ] Color or canvas position is not the only way to communicate meaning.
- [ ] React tests query user-observable roles and names rather than brittle DOM
      internals.

## Generated and repository files

- [ ] Generated output, coverage, caches, secrets, local settings, and
      synthesized CDK files are not committed.
- [ ] Intentional generated fixtures are small, stable, reviewable, and tied to
      a versioned source contract.
- [ ] Dependency and lockfile changes are expected, pinned, and audited.
- [ ] The complete diff and `git diff --check` show no unrelated edits,
      malformed paths, or accidental binary files.
