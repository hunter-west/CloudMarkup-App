# Regional WAF catalog evaluation input successor 1.8.0

This separately named frozen input source binds the exact 73-service catalog
`sha256:8e9b1b23bbcdf723352044baddd8e79468d70ed5a719af914036992daf91fb94`. It
retains all 21 case definitions, authority requirements, target dimensions,
expectations and repository fixture commitments from full-beta source 1.5.0.
Only the dataset version and actual catalog input projection change. The prior
71 configuration-schema projections are identical; the two added entries are the
proof-level regional Web ACL and owned ALB association.

This is a catalog-input successor, not WAF-specific model-quality coverage. No
new provider response, validator observation, report, promotion, policy,
reservation, credit grant or invocation authority is produced. The original
1.5.0, authenticated 1.6.0, typed-planning 1.7.0 input sources and all
historical policy/report bindings remain unchanged. It does not adopt either
separately governed authenticated or typed-planning source implicitly.

After installing the pinned dependencies and building ModelGateway:

```sh
pnpm --filter @cloudmarkup/model-gateway... build
node evals/datasets-regional-waf-v1/generate.mjs --check
pnpm exec vitest run --project=model-gateway packages/model-gateway/src/regional-waf-evaluation-source.test.ts
```

The generator rehashes the complete actual installed catalog and compares its
exact identity plus every service configuration schema/key to the frozen
projection. `--write` regenerates this source's JSON mirror only; it does not
update the reviewed projection, old inputs, an evaluation policy or a report.
The source test rejects altered artifacts even when the caller supplies a newly
computed digest.

The historical source generator verifies the retained exact 71-definition
artifact. This successor generator and its source tests verify the installed
73-definition artifact. Both reject a substituted catalog, including changes to
existing definitions or validation rules. Historical model grounding resolves
only the original exact binding; current grounding defaults to the installed
catalog. The explicitly current-only resolver and native compiler do not admit
the historical artifact.

Deterministic configuration, connection validation and native CloudFormation
export admission use these structural checks and their owning tests. Model
quality remains a separate gate. Fresh actual invocation envelopes, input
counts, catalog-bound authority, validator evidence and a separately reviewed
admitting policy are required for model qualification. Current report projection
remains bound to full-beta 1.5.0 and cannot admit this input by substituting its
source/dataset digest.

`pnpm eval:model:deterministic` remains the existing fake-only harness. It does
not evaluate this successor against a provider. There is no executable live
evaluation command in this public source; direct live attempts fail
`model-evaluation.live-execution-port-required`. A reviewed host-owned execution
composition, exact current model/environment/policy, provider access,
budget/reservation authority and authenticated report issuance are prerequisites
for paid work. These input files do not supply any of them.
