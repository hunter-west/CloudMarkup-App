---
name: add-aws-service
description:
  Add one bounded AWS service definition to the Cloud Markup provider catalog.
  Use when a task asks to introduce or extend a service under
  packages/provider-aws/src/catalog/services, including its configuration
  schema, ports, education, availability, and IaC mapping metadata.
---

# Add an AWS service

Add one reviewed service without expanding the provider-neutral domain or
claiming compiler, region, or curated support that lacks evidence.

## Inputs

Require:

- the AWS concept and stable service/resource identity;
- the current product use case and supported capability boundary;
- the configuration fields and parent/port relationships in scope;
- every semantic port's stable visual dock, direction, explicit cardinality,
  compatible relationship types, and Guided/Professional presentation;
- service-owned configuration slots, applicable policy kinds, ownership,
  generated/adoption behavior, and target-specific readiness;
- the intended Terraform and, when accurate, CloudFormation resource types;
- official documentation references; and
- whether this breaks a currently supported consumer contract.

If these inputs are incomplete, derive only facts already established in the
repository. Stop before guessing provider behavior or support.

## Required files to inspect

Read root and applicable scoped instructions, then the complete affected service
definitions/contracts. Retrieve relevant sections of the guides and tests below;
consult current status/handoff/plan sections for scope, ownership, or blockers.
Follow the root [context and verification policy](../../../AGENTS.md).

- root and `packages/provider-aws/AGENTS.md`;
- `docs/roadmap/STATUS.md`, `docs/roadmap/HANDOFF.md`, and the active plan;
- `docs/product/MVP_SCOPE.md#curated-support-rule`;
- `docs/architecture/DOMAIN_MODEL.md` provider-extension sections;
- `docs/development/PROVIDER_CATALOG.md`;
- `packages/provider-sdk/src/catalog-contract-v1.ts` and compiler validation;
- provider connection-presentation and service-extension contracts, compilers,
  accessors, and focused tests;
- `packages/provider-aws/src/catalog/provider.ts`, `source.ts`, and
  `services/index.ts`, plus `connection-presentation.ts` and
  `service-extension.ts`;
- the closest existing service and every referenced connection/validation rule;
- catalog fixtures, `catalog-v1.test.ts`, and the artifact generator.

Read the dependency policy only if a manifest or lockfile change is proposed.

## Steps

1. Confirm the service belongs to the active milestone and existing vertical
   slice. Record cross-package or compatibility work in the active execution
   plan.
2. Choose stable namespaced service/resource IDs and an opaque icon ID for every
   deployable service or visible boundary. A graph-only, nondeployable internal
   configuration concept may explicitly use `null`; it must not alias another
   service's icon merely to satisfy registration. Keep image files and paths out
   of semantics.
3. Define one curated configuration schema. Expose only fields required by the
   use case; reject additional properties; give safe defaults where meaning is
   unambiguous; and mark every field's value source, security impact, and cost
   impact.
4. Declare resource or boundary kind, valid parents, placement, typed ports with
   category/cardinality, dual-audience education, official documentation, and
   explicit unsupported capabilities. Connection rules reference ports; services
   and ports do not reciprocally list target-specific rules.
5. Bind every semantic port to one stable connection-presentation dock and
   group. Declare dock side/order, group label/order, per-port direction and
   cardinality, compatible relationship types, and Guided/Professional text.
   Input docks are left, output docks are right, and a mixed dock must be split.
   A capability without a reviewed rule may be an informational dot but cannot
   create an edge or imply renderer support. Keep iconography and layout
   metadata out of deployment semantics.
6. Declare every service-owned configuration slot, its accepted policy/config
   kinds, relationship, minimum/maximum cardinality, generated/custom/adopted
   lifecycle, and target-specific modeling/configuration/validation/rendering
   readiness. Future configuration categories must extend this typed mechanism
   instead of adding a second service-specific source of truth.
7. Add or update the opaque icon registration for every deployable service or
   visible boundary, plus validation applicability and synthetic coverage for
   the exact contract. An internal nondeployable configuration with `null`
   `iconId` is excluded from palettes and icon registration. Do not use an icon
   path, component, or UI layout token as a semantic identity.
8. Declare Terraform metadata only for accurate bindings. Add CloudFormation
   metadata only when the AWS type and field mapping are exact. Keep status
   `metadata-only` until reviewed compiler code and golden evidence exist.
9. Represent region knowledge as `known` only from a reviewed, version-bound
   inventory; otherwise use explicit `unknown`.
10. Wire the service through static imports and the still-required reciprocal
    validation references. Add target-specific connection rules at their
    authoritative assembly point without adding reverse rule lists to the
    service or its capability ports. Never use dynamic loading or runtime
    retrieval.
11. Extend the one current pre-live catalog under root policy. Do not create a
    frozen predecessor or bump a version merely for a service wave. Breaking
    consumer changes need an explicit contract decision; post-go-live migration
    design is separately scoped.
12. Add synthetic valid/invalid configuration fixtures, cross-reference
    negatives, source-order reproducibility, and current-artifact hash evidence.
13. Regenerate checked-in catalog outputs, update provider/catalog/status
    documentation where current truth changes, and inspect the complete diff for
    support overclaims. Artifact generation must fail closed when a semantic
    port lacks presentation metadata, an owned slot is incomplete, or an exact
    catalog binding differs.

## Networking concept checks

For AWS networking additions, preserve these distinctions:

- use boundary nodes only for Region, VPC, Availability Zone, and subnet
  placement; a subnet belongs to exactly one Availability Zone;
- model route tables, internet/NAT gateways, and gateway endpoints as resources,
  while route, subnet association, security-group rule, and Lambda VPC-access
  details use reviewed graph-backed owned configurations;
- keep security groups as associated policies, never containers;
- keep S3, DynamoDB, and Lambda as managed services outside VPC containment;
- derive public/private routing findings from exact routes and attachments, not
  canvas placement or `mapPublicIpOnLaunch`;
- make regional/private NAT, interface endpoints, implicit main route tables,
  inline security-group rules, and other omitted modes explicit unsupported
  capabilities; and
- expose cost and resilience tradeoffs without generating topology or permission
  intent automatically.

## Event-driven concept checks

For curated AWS eventing additions:

- separate deployable services from graph-backed owned configuration: S3 CORS,
  lifecycle, and notifications; SQS redrive; and EventBridge targets retain
  stable identities without pretending every target has a standalone resource;
- model producer, event, publish, subscribe, consume, and invoke capabilities as
  directional semantic ports with stable docks and explicit cardinality;
- expose reviewed retry, DLQ, batch/window, timeout, ordering, filter,
  encryption, lifecycle, and delivery-semantics choices instead of raw provider
  property bags or arbitrary policy/event-pattern JSON;
- keep S3 bucket policies, SQS queue policies, SNS topic policies, and
  EventBridge bus policies in canonical typed resource-policy owner slots;
- preserve at-least-once delivery, duplicate handling, FIFO constraints, and
  Standard Step Functions limits in education and Workload event-contract
  metadata without generating application behavior in the provider catalog;
- state unsupported advanced modes explicitly, including cross-account or
  cross-Region delivery, EventBridge Pipes/archive/replay, uncurated SNS
  protocols, Express workflows, and arbitrary ASL; and
- keep target mappings `metadata-only` until renderer evidence exists, even when
  an authoritative Terraform or CloudFormation resource name is known.

## Expected outputs

- one focused service source module and explicit static export;
- typed capability ports whose aggregate cardinality is explicit, plus any
  separately authored authoritative connection rules;
- one exact semantic-port-to-dock/group binding with accessible
  Guided/Professional presentation metadata;
- typed owned-configuration slots with generated/adoption lifecycle and
  target-specific readiness when the service owns configuration;
- an opaque icon registration for each deployable service or visible boundary,
  and applicable validation descriptors;
- updated synthetic fixtures and deterministic tests;
- generation failures covering missing or mismatched presentation/extension
  metadata;
- regenerated catalog JSON, SHA-256 digest, and TypeScript accessors;
- updated current-catalog digests without per-wave historical copies; and
- documentation that names supported and unsupported behavior.

## Tests

For service changes, run these focused checks from the repository root.

```powershell
pnpm --filter @cloudmarkup/provider-sdk type-check
pnpm --filter @cloudmarkup/provider-sdk build
pnpm --filter @cloudmarkup/provider-aws generate:artifacts
pnpm --filter @cloudmarkup/provider-aws check:artifacts
pnpm exec vitest run packages/provider-aws/src/catalog-v1.test.ts
pnpm security:check
git diff --check
```

Repeat the focused catalog test when determinism or hashing changes.

## Stop conditions

Stop and report the blocker when:

- the service is outside the authorized slice;
- required provider semantics, official references, parents, or ports are
  ambiguous;
- an accurate mapping would require compiler implementation or executable
  catalog content;
- configuration would accept inline secrets, arbitrary IAM, customer data, or
  raw cloud property sprawl;
- a known region or curated-support claim lacks full evidence; or
- a semantic port cannot be assigned an exact dock/group, an owned slot or
  target-readiness claim is ambiguous, or a contract change, migration,
  dependency, cloud call, credential, UI, deployment, or new service is needed
  beyond the requested scope.
