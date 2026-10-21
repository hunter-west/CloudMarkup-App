# Domain instructions

These rules specialize the repository [instructions](../../AGENTS.md) for
`packages/domain`.

- This package owns pure, deterministic, provider-neutral behavior. It may not
  import React, Hono, AWS SDK/CDK, database/network clients, model clients, or
  IaC renderers.
- The versioned architecture graph is authoritative. Keep semantic state
  separate from layout/presentation metadata and preserve stable identities.
- Apply mutations through validated, atomic operations with explicit
  preconditions. Invalid batches leave state unchanged.
- Command application returns a new document plus deterministic change and
  inversion metadata. Never mutate command payloads or document inputs, derive
  command IDs/timestamps, or expose intermediate batch state.
- Generated semantic resources must be adopted before customization. Generic
  deletion cannot remove generated resources; release must update declared
  provenance dependencies and retain anything adopted or still referenced.
- Immutable revisions and deterministic ordering/digests must not depend on
  timestamps, randomness, process state, or machine paths.
- Document migrations work on clones, fail closed on unknown versions or
  unvalidated fields, and may never delete, guess, default, or reinterpret user
  meaning. Version-1 baselines remain no-ops until a real successor is reviewed.
- Compilation-content hashes exclude presentation and explicit audit timestamps
  while retaining schema, catalog, compiler, semantic graph, and provenance
  inputs. Visual hashes cannot become compiler inputs.
- Provider semantics enter through explicit contracts; AWS-specific names,
  defaults, or branching do not belong here.
- Validation rules are pure synchronous functions over frozen cloned inputs.
  They cannot perform model, network, database, cloud, filesystem, clock, or
  random work. Contain rule failures and mark the report incomplete. Reserve
  `cloudmarkup.core.*` rule IDs for built-in rules.
- Auto-fixes are untrusted Graph Command v1 batches. Offer them only after the
  command engine validates the complete batch; report deterministic fix
  conflicts rather than selecting or applying a winner.
- Export only supported public entry points. Contract changes require an
  execution plan plus compatibility, migration, or intentional-rejection tests.
- Prefer unit, property, and metamorphic tests; presentation-only changes must
  preserve semantic projections and future address inputs.

For domain implementation changes, use `pnpm check:contracts` under the root
[verification cadence](../../AGENTS.md#verification-cadence). Review with the
correctness, determinism, public-contract, and package-boundary sections of
[CODE_REVIEW.md](../../docs/engineering/CODE_REVIEW.md).
