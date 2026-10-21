# Reconcile the proven regional WAF slice with the current catalog

- Milestone: bounded shared infrastructure recovery
- Status: isolated reconciliation complete; release admission blocked by frozen
  evaluation source
- Owners: isolated WAF integration; release owner admits final source

## Goals

- Restore regional Web ACL configuration, canonical owned ALB association and
  provider validation through the current catalog and generic graph commands.
- Export deterministic native CloudFormation for this exact bounded slice,
  preserving target-specific limits and negative cases.

## Context

Historical regional WAF code proved local ALB infrastructure, but used a
separate successor catalog and explicit proof browser. Current ALB/networking
foundations already cover inherited behavior. The integration therefore extends
one current catalog and omits copied historical catalogs, candidate registries
and unrelated Valkey/native application work.

## Constraints

- WAF remains visibly proof-level and CloudFormation-only; Terraform and
  expanded WAF modes fail closed.
- Preserve explicit user-owned intent, exact catalog/compiler binding, stable
  graph addresses, cardinality, retention, count defaults and disabled request
  sampling/logging.
- Compiler and catalog code remain deterministic and
  credential/network/deployment-free.
- Add no native AI/model release, Valkey client, permission or credential
  activation. Do not relabel frozen evaluation receipts or historical customer
  revisions.
- Existing approved artwork remains unchanged; new WAF identities use explicit
  neutral placeholders pending separate artwork approval.

## Checkpoints

- [x] Identify missing finished WAF behavior and retained/superseded
      dependencies.
- [x] Port source, generate current artifacts and run owning
      configuration/connection/native export tests.
- [x] Apply the isolated patch to public commit `2cd491bd`, regenerate the
      permitted synthetic inputs and deterministic golden closure, and verify
      current provider/compiler/generator/repository behavior.
- [x] Record exact catalog impacts, remaining qualification and reviewable
      patch.
- [x] Prepare separate frozen input successor 1.8.0 for the actual 73-service
      catalog, retaining historical cases, inputs and policies and testing exact
      current artifact/mirror integrity without provider execution.
- [ ] (current) Release owner reviews a successor frozen evaluation source and
      completes final admission before publishing this catalog change.

## Validation commands

```powershell
pnpm --filter @cloudmarkup/provider-aws check:artifacts
pnpm exec vitest run --project=contracts packages/provider-aws/src/regional-waf.test.ts packages/provider-aws/src/catalog-v1.test.ts
go -C services/iac-compiler test . -run 'TestWaf|TestCurrentAwsCatalogCompatibility|TestElb|TestEbs|TestHttpNoContent|TestEventRepositoryCompilationFixtures|TestGenerationGolden' -count=1
git diff --check
```

Use existing pinned offline tools where installation is unavailable; record that
limitation. The release owner runs normal affected package/public/security and
browser/native admission on the integrated source.

## Migration impact

The current catalog gains two proof definitions, two relationships and one
validation rule. Its digest and presentation/extension bindings change together.
Mutable drafts use existing explicit compatible catalog-opening review;
immutable revisions and old receipts are not rebound. Update current runtime
pins deliberately, retain frozen model/evaluation inputs and identify
qualification that the new digest invalidates.

## Security impact

Closed WAF configuration and exact ALB/Region/ownership bindings reject
arbitrary statements, external targets, logging/sampling, duplicate priorities
and malformed associations. Count mode does not block. Native output is
export-only; it adds no runtime/deployment permissions or client credentials.

## Stopping condition

Hand off an isolated exact-source patch with representative passing checks and
explicit remaining limits. Never declare live AWS protection, Terraform support,
native AI or product-wide release completion from these checks.

## Handoff

The patch applies cleanly to exact public commit
`2cd491bd8c33bf75031aa0a5533687b12f4f635f`. Its isolated current source passes
327 provider/editor cases, 75 application-generator cases and 10 architecture
CLI repository cases. One existing non-gating performance measurement is
skipped. Affected source types, exact catalog reproduction and the selected
native WAF/ALB/EBS/HTTP/event/generation-golden group pass. Focused lint,
asset/security and final patch receipts are recorded by the release handoff. No
existing generated TypeScript or Terraform source changes. All six event
compiler results retain the same normalized resources, connections, policies and
workloads; their provenance and derived artifact hashes change together. Mutable
opening of the retained old ALB draft is lossless and leaves the source
unchanged. A native-template ZIP/readback probe is separate from authenticated
durable export, diagram and AWS qualification.

The new catalog digest is
`sha256:8e9b1b23bbcdf723352044baddd8e79468d70ed5a719af914036992daf91fb94`. Of
the 72 initially identified old catalog bindings, 68 ordinary synthetic
inputs/goldens are regenerated or revalidated. Existing producers also update
their dependent manifest/semantic-summary hashes. Four synthetic EBS trust
statement IDs are normalized by the native fixture producer to satisfy the
current alphanumeric schema; their actions, principals and scope are unchanged.
Two additional application source-inventory projections are regenerated from
their existing factories, with no generated application TypeScript changes.

The four frozen model/evaluation source paths remain byte-identical. The focused
source suite has 16 passing cases and one real failure: the installed 73-service
catalog differs from the frozen 71-service source. The assertion at
`packages/model-gateway/src/full-beta-evaluation-dataset.test.ts:80` and the
strict guard in `full-beta-evaluation-dataset.ts:1049` are preserved. The
existing evaluation README requires a reviewed successor source version; the new
source/policy bindings and fresh exact evaluation cannot be established by
swapping a digest in old evidence. Public contract admission is blocked until
that work is complete. No evaluation report, model invocation or promotion is
claimed here.

The separately named source under `evals/datasets-regional-waf-v1/` now prepares
the next input step. It binds the actual 73-service catalog and dataset version
1.8.0 while preserving all 21 cases and dimensions from the admitted 1.5.0 input
corpus. It does not adopt the independently governed authenticated or
typed-planning successors, add WAF-specific model-quality coverage, alter
current report policy or replace the installed-71-service assertion. Its own
source generator and exact artifact checks are offline input verification only.
The normal evaluator remains fake-only; no executable paid evaluation command or
reviewed host-owned live port is supplied by these input files. Existing
registered model pricing snapshots are expired and cannot authorize a spend.

Normal pinned install/security audit, complete compiler/public admission and
fresh browser/hosted export tests remain with final integration. No model,
Valkey, artwork, AWS permission or deployment activation is included.
