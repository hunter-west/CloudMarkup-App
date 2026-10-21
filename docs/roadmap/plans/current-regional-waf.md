# Reconcile the proven regional WAF slice with the current catalog

- Milestone: bounded shared infrastructure recovery
- Status: historical/current source repair prepared; integrated admission
  pending
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
one current catalog and omits candidate registries and unrelated Valkey/native
application work. Frozen model inputs independently require their original full
catalog and service-extension artifacts for exact read-only interpretation.
Those retained artifacts are not an installed editor or native compiler
compatibility registry.

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
- [x] Preserve the actual historical 71-definition catalog and extension, route
      explicit immutable model inputs through exact read-only bindings, and
      retain current-only editor/compiler and report/promotion boundaries.
- [ ] (current) Release owner admits the integrated candidate with normal
      public, backend, browser and native checks before publication. Model
      quality and actual AWS qualification remain separate acceptance work.

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

## Historical/current source boundary

The correction is based on the isolated WAF checkpoint `cecd771c`. Its current
catalog remains
`sha256:8e9b1b23bbcdf723352044baddd8e79468d70ed5a719af914036992daf91fb94`. The
original catalog and service extension from `2cd491bd` are retained
byte-for-byte under `packages/provider-aws/src/model-evaluation-source/` with
their original `7bc6db32` and `fb4ba434` digest prefixes. The current catalog
changes ALB and existing validation rules as well as adding WAF; filtering WAF
definitions cannot recover the historical artifact.

`resolveAwsModelCatalogV1` admits only those exact historical and current
bindings for immutable model context. Its default remains current. The
explicitly current-only grounding entry point, catalog resolver and native
compiler retain their exact current checks. Frozen request construction and
read-only coverage use historical grounding, readiness and relationship metadata
from the real historical artifacts. Newly generated synthetic repair inputs bind
the current catalog. Unknown or relabeled bindings fail closed. Historical
assessor source bytes and their current-only executable validator dependencies
remain unchanged; this reader does not make old live assessment executable
against the new catalog.

The historical input generator verifies the original artifact; the 1.8.0
successor verifies the complete current artifact. Both guards keep schema,
service-set and canonical digest tamper checks. The successor's metadata reuses
the unchanged historical configuration projection plus two new WAF definitions;
this does not derive or alter the historical full artifact. All 21 cases, 19
dimensions, original input mirrors and source/policy/report commitments remain.

Deterministic configuration, connections and native CloudFormation export can be
reviewed through structural source integrity and their owning tests. This repair
does not qualify model responses. Current report policy still rejects the 1.8.0
source; live evaluation still requires a separately reviewed host port, exact
models/environment/policy, credentials and budget/reservation authority. No paid
invocation, report issuance, model promotion, Valkey, AWS permission or
deployment activation is included.

Focused and aggregate test receipts, exact-source preservation checks and the
minimal correction patch are supplied by the isolated handoff. The release owner
runs the normal integrated public/build/security/browser/native gates. Actual
AWS behavior and authenticated durable exports require the release owner's
runtime acceptance; offline structural tests do not establish them.
