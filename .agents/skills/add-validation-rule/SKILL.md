---
name: add-validation-rule
description:
  Add one deterministic provider validation descriptor and reviewed TypeScript
  registration. Use when a task asks for an AWS graph finding, environment-aware
  severity, exact affected paths, applicability, or a safe Graph Command
  auto-fix.
---

# Add a validation rule

Add one pure provider rule without moving AWS policy into the provider-neutral
engine or serializing executable behavior in the catalog.

## Inputs

Require:

- the exact unsafe, invalid, unknown, or advisory condition;
- stable rule and finding codes;
- provider, catalog, target, and environment applicability;
- severity policy and exact affected paths;
- beginner and professional explanations plus documentation;
- involved services/connections; and
- a proof that any proposed auto-fix is deterministic and safe.

## Required files to inspect

Read root and applicable scoped instructions, then the complete affected rule
definitions and contracts. Retrieve relevant sections of the guides and tests
below; consult current status/handoff/plan sections for scope, ownership, or
blockers. Follow the root [context and verification policy](../../../AGENTS.md).

- root, `packages/domain/AGENTS.md`, `packages/provider-sdk/AGENTS.md`, and
  `packages/provider-aws/AGENTS.md`;
- `docs/roadmap/STATUS.md`, `docs/roadmap/HANDOFF.md`, and the active plan;
- the validation sections of `docs/architecture/DOMAIN_MODEL.md`;
- `docs/development/PROVIDER_CATALOG.md#add-a-validator`;
- `packages/domain/src/validation-contract.ts`, `validation-engine.ts`, and
  representative rule/tests;
- provider validation descriptor/registration contracts in the SDK;
- `packages/provider-aws/src/catalog/validation-rules/`, `src/validation/`,
  affected service/connection definitions, and `src/validation.test.ts`;
- validation fixtures and generated catalog outputs.

## Steps

1. Define one condition at the provider boundary. Reuse core structural findings
   instead of duplicating them.
2. Choose a stable namespaced rule ID, semantic rule version, implementation ID,
   finding code, applicability, and documentation metadata.
3. Add the serialized descriptor and reciprocal service/connection references.
   Keep callbacks, source, module paths, templates, and dynamic imports out of
   artifact data.
4. Implement a pure synchronous rule over the frozen context. Use no clock,
   randomness, filesystem, network, model, database, AWS SDK, credentials, IaC
   renderer, or deployment behavior.
5. Emit value-safe findings with closed severity values, dual explanations, and
   exact typed affected paths. Never echo configuration values or thrown error
   details.
6. Make environment or target changes explicit and exhaustive. Preserve
   `unknown` states instead of silently selecting an environment, Region, or
   compiler capability.
7. Omit an auto-fix unless one complete deterministic Graph Command v1 batch
   preserves user meaning and ownership. Include exact preconditions, and let
   the validation engine withhold any batch the command engine rejects.
8. Pair descriptor and implementation through the SDK registration helper.
   Ensure rule ID and version match exactly.
9. Add synthetic positive and negative cases. Assert stable rule/finding IDs,
   severity, affected path, applicability, deterministic ordering, and exact fix
   presence or absence.
10. Regenerate the one current pre-live catalog under root policy, without a
    per-wave version/snapshot. Update validation/catalog/testing/status
    documentation where current truth changes and inspect for support
    overclaims.

## Networking validation checks

Networking rules must derive findings only from exact modeled parents, edges,
typed configuration, and pinned catalog facts. Cover same-VPC and same-AZ
relationships, CIDR containment/overlap, route target type, explicit subnet
associations, endpoint policy mode, security-group direction/range/CIDR, and
Lambda subnet/security-group/role readiness as applicable. Treat multi-AZ,
same-zone NAT, broad egress, and NAT-versus-endpoint choices as reviewed
recommendations unless the modeled contract makes them invalid. Never infer live
AWS state, silently attach the Lambda VPC managed policy, classify a subnet as
public from its name or public-IP flag, or offer an auto-fix that chooses
network topology, cost posture, CIDR allocation, or permission scope for the
user.

## Event-driven validation checks

Eventing rules must use only exact graph topology and typed configuration.
Cover, as applicable:

- producer/consumer and dead-letter cycles without flagging every deliberate
  state-machine callback as a cycle;
- duplicate S3 notification identities and overlapping curated filters;
- FIFO queue/topic/DLQ combinations, naming, ordering, and deduplication modes;
- DLQ type/policy compatibility and retry exhaustion behavior;
- supported subscription and EventBridge filters, rejecting empty or unbounded
  patterns rather than interpreting arbitrary JSON; and
- SQS visibility versus Lambda timeout/batching and EventBridge or Step
  Functions retry/timeout conflicts.

Do not auto-fix destinations, ordering, retry posture, timeout, policy scope, or
delivery semantics; those choices require reviewed user intent.

## Expected outputs

- one data-only validation descriptor and reciprocal catalog references;
- one matching pure provider registration;
- deterministic fixtures covering valid and invalid states;
- exact severity/path/fix tests, including unsafe-fix absence;
- regenerated catalog JSON/hash/accessors; and
- validation and roadmap documentation where current truth changes.

## Tests

For validation changes, run these focused checks from the repository root.

```powershell
pnpm --filter @cloudmarkup/domain type-check
pnpm --filter @cloudmarkup/domain build
pnpm --filter @cloudmarkup/provider-sdk type-check
pnpm --filter @cloudmarkup/provider-aws generate:artifacts
pnpm --filter @cloudmarkup/provider-aws check:artifacts
pnpm exec vitest run packages/domain/src/validation-engine.test.ts packages/provider-aws/src/catalog-v1.test.ts packages/provider-aws/src/validation.test.ts
pnpm security:check
git diff --check
```

Run the focused provider validation suite twice when identity, ordering,
hashing, or fixes change.

## Stop conditions

Stop and report the blocker if:

- the condition or severity requires unresolved product/security policy;
- required AWS or region facts are not in a reviewed version-bound source;
- a finding would expose values or depend on external state;
- a fix would infer permission intent, authentication topology, cost posture,
  retention/data deletion, or generated-resource ownership;
- the rule needs provider-specific changes in the domain engine; or
- completion requires UI, persistence, compilation, cloud access, credentials,
  deployment, or a broader service slice.
