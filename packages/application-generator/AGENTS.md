# Application generator instructions

These rules specialize the repository instructions for the deterministic Prompt
29A source generator.

- This package consumes strict versioned data and returns source artifacts as
  data. It never writes repositories, executes source, spawns a process, runs a
  package manager/compiler/test, fetches dependencies or artifacts, reads
  credentials, calls models/cloud SDKs/networks, renders IaC, or deploys.
- Architecture is infrastructure truth, Workload Behavior is behavior truth,
  Application Contracts are interface/data/auth/test truth, and compiler
  normalized-model v1 supplies stable deployment keys and typed edges. Reject
  mismatches; never infer from labels or provider service names.
- Support only the exact built-in generator/template/runtime/pattern/catalog
  descriptors. New runtimes/templates/patterns require reviewed contracts,
  compatibility evidence, golden tests, and documentation.
- Stable paths derive from normalized deployment keys. Normalize ordering with
  UTF-16 comparison and line endings with LF. Digests use canonical JSON or
  exact UTF-8 bytes as declared.
- Generated source may implement only explicit supported operations. Emit safe
  source-linked diagnostics and user-owned extension boundaries for everything
  else. Never fabricate business logic or claim complete-pattern coverage while
  behavior/tests remain unresolved.
- Every generated action retains exact workload operation, contract, edge, and
  environment-binding provenance. IAM remains owned by typed graph relationships
  and the Go Terraform target; source is never scanned for permissions.
- Regeneration is a change-set calculation only. Modified generated baselines,
  user-owned paths, ownership overlaps, deletions, and orphaned files fail or
  preserve explicitly; no silent overwrite is allowed.
- Keep fixtures synthetic and secret-free. Golden changes require semantic
  review. Run the focused application-generator gate before handoff.
