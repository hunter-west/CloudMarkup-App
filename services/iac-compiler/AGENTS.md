# IaC compiler instructions

These rules specialize the repository [instructions](../../AGENTS.md) for the
independent Go module in `services/iac-compiler`.

- Keep a closed, deterministic process boundary: versioned immutable input in;
  bounded normalized models, diagnostics, and generated artifacts out. The
  default compatibility registry admits the exact
  [current AWS catalog](README.md) and neutral example catalog; historical AWS
  catalogs are not installed. Caller-supplied registries must remain exact
  reviewed policy, never network or `latest` lookup. Compiler compatibility and
  artifact metadata do not authorize provider execution, application-source
  generation, builds, plan/apply, change sets, deployment, or Evidence.
- Architecture remains infrastructure truth. Workload Behavior is typed
  behavior/artifact intent. Optional Solution Revision input must bind exact
  identities, hashes, catalog, compiler, and generator metadata.
- Keep compiler-owned JSON Schema copies under `internal/contracts/schemas` and
  prove drift against authoritative generated contracts. Share no frontend or
  backend runtime dependency.
- The compiler cannot deploy, read credentials, call models/databases/cloud
  SDKs, use runtime network access, scan repositories, or execute Terraform,
  shells, package managers, provisioners, providers, modules, plugins, user
  content, or source-generation/build tools.
- Build Terraform only with HashiCorp HCL APIs and parse every HCL file before
  return. Build CloudFormation only from allowlisted structured Go values,
  canonical JSON encoding, and the internal local validator. Never build IaC
  with untrusted free-form strings. Permit only reviewed provider constraints,
  resource types, relationships, configurations, and exact catalog mappings.
- Preserve deployment-key/graph-ID addresses and deterministic resource,
  connection, workload, policy, file, diagnostic, and manifest ordering.
  Presentation, assistance preferences, audit time, and incidental input order
  cannot alter semantic or generated files.
- IAM comes only from typed graph relationships and owned-policy configuration.
  Require exact source-edge provenance for generated permissions. Never infer
  IAM from source, merge custom and generated ownership, or remove permissions
  still required by another edge.
- Reject unsupported schema/catalog/compiler/generator/target versions, workload
  behavior, external ownership, and target extensions explicitly. Never fetch
  `latest`, silently omit behavior, or upgrade a metadata-only mapping.
- Keep application source generation behind `ApplicationGenerator`. Terraform
  and CloudFormation may consume only versioned relative/object artifact
  contracts and cannot call a generator or builder.
- Bound bytes, files, JSON depth, collections, diagnostics, normalized output,
  artifact output, and execution by context. Keep diagnostics stable and
  content-free.
- Keep fixtures synthetic. Golden/hash changes require semantic review, and
  repeated compilation must be byte-identical after normalization.
- HCL v2 and cty are the reviewed direct dependencies. Review every Go module
  change under the repository dependency policy; no dependency may add runtime
  network, credential, provider execution, or deployment capability.

For compiler implementation changes, use `pnpm check:compiler` and
`pnpm catalog:check` under the root
[verification cadence](../../AGENTS.md#verification-cadence). Run
`pnpm security:check` and Go vulnerability review for dependency, CLI, fixture,
contract, or security-sensitive changes. Review with the deterministic-output,
security, contracts, and generated-files sections of
[CODE_REVIEW.md](../../docs/engineering/CODE_REVIEW.md).
