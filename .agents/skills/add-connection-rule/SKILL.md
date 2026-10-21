---
name: add-connection-rule
description:
  Add one deterministic Cloud Markup provider connection descriptor and optional
  reviewed resolver. Use when a task asks for a typed AWS relationship,
  connection questions, least-privilege effects, atomic command preview, or
  generated-resource lifecycle behavior.
---

# Add a connection rule

Model one provider relationship as declarative catalog data plus, only when
authorized, a reviewed pure resolver that previews one atomic Graph Command
batch.

## Inputs

Require:

- stable rule and relationship IDs;
- a concise relationship label that describes the exact deployment meaning;
- source and target services and exact ports;
- each exact port's stable endpoint visual group/dock assignment;
- cardinality and exclusivity constraints;
- connection configuration and required user decisions;
- target-specific modeling, configuration, validation, and rendering support;
- supporting nodes/edges and least-privilege effects;
- generated permission/configuration resources and their owner slots;
- deletion, sharing, adoption, and provenance behavior; and
- whether direct resolution is implemented or descriptor-only.

## Required files to inspect

Read root and applicable scoped instructions, then the complete affected
endpoint definitions and contracts. Retrieve relevant sections of the guides and
tests below; consult current status/handoff/plan sections for scope, ownership,
or blockers. Follow the root
[context and verification policy](../../../AGENTS.md).

- root, `packages/provider-sdk/AGENTS.md`, and
  `packages/provider-aws/AGENTS.md`;
- `docs/roadmap/STATUS.md`, `docs/roadmap/HANDOFF.md`, and the active plan;
- `docs/development/PROVIDER_CATALOG.md#add-a-connection-rule`;
- `packages/provider-sdk/src/catalog-contract-v1.ts`,
  `connection-resolution.ts`, and their tests;
- provider connection-presentation and service-extension contracts, generated
  artifacts, accessors, and focused tests;
- public Graph Command contracts and generated-resource lifecycle rules;
- both endpoint service definitions and all related connection descriptors;
- `packages/provider-aws/src/catalog/connection-presentation.ts` and
  `service-extension.ts`;
- `packages/provider-aws/src/connection-resolution.ts` and tests;
- connection fixtures and catalog artifact/hash tests.

## Steps

1. Confirm both endpoint ports already express the intended capabilities and
   directions, and that each port has one exact connection-presentation
   dock/group assignment. Do not repair a missing service or presentation model
   implicitly. The source output group must be on the right and the target input
   group on the left; do not introduce a mixed-direction group. An informational
   capability is not a valid endpoint until a reviewed rule makes it compatible.
2. Define stable rule/version/relationship IDs, presentation category, exact
   endpoint ports, a concise relationship label, endpoint visual groups,
   aggregate port compatibility, per-source/per-target/pair cardinality,
   configuration schema, and UI hints. The rule is authoritative; do not add
   reciprocal rule IDs to either service or port, and never let a dock replace
   the exact semantic port stored on an edge.
3. Ask every question required to choose deployment meaning. Use a catalog
   default only when deterministic and safe; mark permission or topology intent
   as required user input when alternatives differ materially.
4. Declare every supporting node/edge, exact IAM action and resource scope,
   missing-information finding, education record, owner slot, and lifecycle
   policy. Generated permissions and configuration remain graph-backed owned
   resources with explicit provenance; never encode them only as connection side
   effects. Never use wildcard permissions or inline secrets.
5. Record cardinality implications at the exact ports and owned slots, including
   minimums, maximums, pair limits, and whether multiple exact relationships may
   share one visual dock. Visual grouping cannot relax semantic cardinality.
6. Declare target-specific readiness separately for modeling, configuration,
   validation, and rendering. Do not turn metadata-only or pending renderer
   support into a deployment-support claim.
7. Mark the rule descriptor-only unless the task authorizes resolution and all
   semantics are complete. A descriptor-only reason must state the missing
   behavior.
8. For an implemented rule, register one stable implementation ID. Return only
   supporting changes; let the SDK add the direct edge and validate the complete
   Graph Command v1 batch.
9. Derive command identities only from caller-supplied deterministic inputs.
   Never mutate the document or use time, randomness, filesystem, network,
   credentials, models, AWS SDKs, IaC renderers, or deployment.
10. Preserve generated provenance. Cleanup releases only the selected
    dependency, retains shared resources, and rejects adopted or customized
    generated resources until the user controls their lifecycle.
11. Add valid/incomplete/reversed/invalid-port, aggregate-one-port,
    source/target/pair-limit, configuration-duplicate, and lifecycle fixtures.
    Assert the concise relationship label, endpoint dock/group lookup, exact
    semantic ports, target readiness, least-privilege effects, generated-owner
    provenance on every support edge, cleanup/adoption behavior, and
    deterministic batch previews.
12. Regenerate the one current pre-live catalog under root policy, without a
    per-wave version/snapshot. Update connection/catalog/status documentation
    where current truth changes.

## Networking relationship checks

For networking rules, identify exactly one of these meanings before authoring:

- boundary containment or required placement;
- graph-backed owned configuration;
- resource association or route target; or
- associated policy.

Never substitute one meaning for another. In particular, security groups and
Lambda VPC access are associations, S3/DynamoDB gateway endpoints do not contain
the managed service, and a subnet is public only through an explicit same-VPC
internet-gateway route. Direct reviewed associations may return an empty support
plan because the SDK owns the requested direct edge; they must still register
the exact implementation ID and rely on deterministic validation for cross-VPC,
route-target, cardinality, and stale-reference checks.

## Event-driven relationship checks

For event relationships, verify each direction independently. S3 notifies
Lambda, Lambda sends to SQS, and SQS invokes Lambda through an event-source
mapping; one bidirectional-looking edge must never stand in for those distinct
contracts. SNS fan-out and EventBridge targets keep one owned subscription or
target identity per reviewed destination, while Step Functions invocation states
the caller and callee explicitly.

Every applicable descriptor must:

- ask only bounded retry, DLQ, batch/window, timeout, ordering, filter, and
  delivery-semantics questions that affect modeled behavior;
- generate exact least-privilege identity-policy actions and exact resource-side
  invocation permissions where AWS requires them, never wildcard scope;
- distinguish canonical resource-policy ownership from generated service grants
  and identity permissions;
- declare event-contract/operation binding and at-least-once or ordering
  implications without claiming generated application rendering; and
- preserve generated permission/configuration provenance, adoption, sharing, and
  deletion behavior so removing a connection cannot silently delete shared
  meaning.

## Expected outputs

- one authoritative versioned connection descriptor over existing exact
  capability ports;
- a concise relationship label and exact endpoint visual-group bindings without
  changing edge semantics;
- explicit endpoint and owned-slot cardinality implications;
- a descriptor-only reason or matching reviewed resolver registration;
- target-specific readiness without unsupported renderer claims;
- deterministic Graph Command preview and lifecycle behavior when implemented;
- graph-backed generated permission/configuration resources with complete
  provenance, cleanup, sharing, and adoption behavior when applicable;
- synthetic fixtures and negative tests; and
- regenerated catalog artifacts and updated documentation.

## Tests

For connection changes, run these focused checks from the repository root.

```powershell
pnpm --filter @cloudmarkup/provider-sdk type-check
pnpm --filter @cloudmarkup/provider-sdk build
pnpm --filter @cloudmarkup/provider-aws generate:artifacts
pnpm --filter @cloudmarkup/provider-aws check:artifacts
pnpm exec vitest run packages/provider-sdk/src/compiler.test.ts packages/provider-aws/src/catalog-v1.test.ts packages/provider-aws/src/connection-resolution.test.ts
pnpm security:check
git diff --check
```

Repeat the focused resolver suite to prove deterministic output.

## Stop conditions

Stop when:

- direction, port capability, permission intent, prerequisite, or cleanup
  ownership is ambiguous;
- the rule would infer broader access, wildcard scope, a secret, or a default
  with material security/cost impact;
- the supporting batch cannot pass Graph Command v1 atomically;
- generated customization would bypass adoption or cleanup would remove shared
  meaning;
- an exact endpoint lacks a stable presentation group, cardinality implications
  are incomplete, or target readiness cannot be supported by evidence;
- implementation needs UI, persistence, compiler rendering, cloud access,
  credentials, or deployment; or
- the requested relationship is outside the current service slice.
