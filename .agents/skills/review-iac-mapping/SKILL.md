---
name: review-iac-mapping
description:
  Review one Cloud Markup provider IaC mapping declaration against its service
  schema and supported compiler evidence. Use for Terraform or CloudFormation
  mapping reviews, generated catalog drift, binding accuracy,
  implementation-status claims, or compiler-readiness findings.
---

# Review an IaC mapping

Review mapping metadata as a security-sensitive compiler contract. Do not build
a renderer, run Terraform, contact a provider registry, or deploy.

## Inputs

Require:

- the service ID and mapping ID;
- Terraform or CloudFormation target;
- the source change or generated artifact under review;
- the claimed implementation status; and
- any matching compiler/golden evidence when status is `implemented`.

## Required files to inspect

Read root and applicable scoped instructions, then the complete affected service
and mapping contracts. Retrieve relevant guide/test sections below; consult
current status/handoff/plan sections for scope, ownership, or blockers. Follow
the root [context and verification policy](../../../AGENTS.md).

- root, `packages/provider-sdk/AGENTS.md`, `packages/provider-aws/AGENTS.md`,
  and `services/iac-compiler/AGENTS.md` when compiler code is in scope;
- `docs/roadmap/STATUS.md`, `docs/roadmap/HANDOFF.md`, and the active plan;
- ADR-0003, ADR-0004, and the provider/compiler sections of
  `docs/architecture/SYSTEM_OVERVIEW.md` and `DOMAIN_MODEL.md`;
- `docs/development/PROVIDER_CATALOG.md#add-a-compiler-mapping`;
- provider mapping schemas and compiler validation in `packages/provider-sdk`;
- the complete service definition, its ports, configuration schema, and
  unsupported capabilities;
- generated catalog JSON/hash/accessors and artifact tests;
- matching Go compiler implementation, protocol, golden fixtures, and
  reproducibility tests only when an `implemented` claim exists.

Use authoritative provider documentation supplied by the task or official
provider sources for exact target names. Never infer a resource type or field
conversion from memory when accuracy is uncertain.

## Steps

1. Confirm the mapping belongs to the pinned service and catalog version.
2. Verify the target declaration is closed version-1 metadata with an exact
   provider source/resource type or CloudFormation type. Reject templates,
   HCL/template bodies, callbacks, commands, module paths, and dynamic code.
3. Cross-check every configuration binding against a declared service property
   and every port binding against a declared port. Flag duplicates, omissions,
   wrong case, free-form values, and target attributes that change semantics.
4. Check value-source constraints. Secret material must remain references; node
   values must resolve through typed graph identity; mappings must not introduce
   wildcard IAM or pasted identifiers.
5. Compare declared behavior with unsupported capabilities, education, security
   and cost metadata, placement, and region state. Mapping metadata cannot
   broaden the service contract.
6. Keep `metadata-only` when no reviewed renderer exists. Accept `implemented`
   only with matching deterministic compiler code, current contract/graph
   validation, negative cases, golden output, and repeated byte-identical
   evidence.
7. Confirm CloudFormation metadata is present only when the exact AWS resource
   can represent the declared fields. Omit uncertain placeholders.
8. Compile/check the catalog and compare generated artifact/hash/accessors byte
   for byte. For implementation claims, run the relevant compiler golden and
   reproducibility suite.
9. Report findings by priority with exact file and line references. If the user
   explicitly requested fixes, change only confirmed mapping defects and
   regenerate artifacts.

## AWS networking mapping checks

Do not flatten graph meaning merely because an IaC target offers inline fields:

- review routes and subnet route-table associations as separate identities;
- review internet-gateway attachment separately where the target requires a
  second resource;
- keep gateway-endpoint route-table associations consistent with the selected
  target's standalone-versus-inline representation, never both;
- do not bind a short `s3` or `dynamodb` choice directly to a Region-qualified
  endpoint service name without deterministic Region derivation;
- treat Lambda VPC access as nested function configuration, not a fabricated
  standalone provider resource; and
- keep every new networking declaration `metadata-only` until the exact graph
  projection, renderer, negative cases, and reproducible goldens exist.

If Terraform and CloudFormation require different resource shapes, declare only
the exact metadata each contract can honestly represent.

## AWS event-driven mapping checks

Review target shape as carefully as the resource type:

- S3 lifecycle, CORS, and notification configuration may be nested on a bucket
  in CloudFormation while Terraform uses reviewed nested blocks or separate
  configuration resources; never invent a standalone CloudFormation type;
- SQS redrive configuration and EventBridge targets remain owned child
  identities even when a target renders them inline on the owner;
- SNS subscriptions may be standalone, but delivery policy, filter policy, and
  redrive details still require exact typed projection evidence;
- Step Functions remains the curated Standard-workflow abstraction; an AWS
  resource type alone does not prove arbitrary ASL or Express support; and
- Lambda event-source mappings and invocation permissions are connection
  projections, not proof that the service mapping renders them.

When the provider SDK cannot express an honest nested CloudFormation mapping,
omit that target declaration and document the limitation. Keep every new event
mapping `metadata-only` until exact projection, renderer, negative, golden,
current-contract, and reproducibility evidence exists.

## Expected outputs

- a focused review stating whether identities, bindings, target names, value
  sources, and support status are accurate;
- actionable findings with exact locations and no speculative fixes;
- confirmation that metadata-only declarations do not imply compilation; and
- when changes were requested, regenerated deterministic artifacts and tests.

## Tests

For metadata review, run these focused checks from the repository root.

```powershell
pnpm --filter @cloudmarkup/provider-sdk type-check
pnpm --filter @cloudmarkup/provider-sdk build
pnpm --filter @cloudmarkup/provider-aws check:artifacts
pnpm exec vitest run packages/provider-sdk/src/compiler.test.ts packages/provider-aws/src/catalog-v1.test.ts packages/provider-aws/src/validation.test.ts
pnpm security:check
git diff --check
```

For an `implemented` claim, also run matching Go compiler unit, negative,
golden, current-contract, and repeated reproducibility tests. Historical
compatibility expansion needs an explicit supported consumer requirement.

## Stop conditions

Stop and report when:

- an authoritative target resource/type/attribute cannot be established;
- a mapping needs an unreviewed shape conversion or provider behavior;
- `implemented` lacks compiler, golden, current-contract, or reproducibility
  evidence;
- completion would require adding a compiler renderer, dependency, provider
  download, runtime network, arbitrary extension, credential, cloud access, or
  deployment path; or
- the review would expand service support beyond the authorized catalog slice.
