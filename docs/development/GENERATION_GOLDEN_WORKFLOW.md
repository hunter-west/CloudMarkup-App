# Deterministic generation golden workflow

Prompt 30 binds the Go Terraform compiler and the separate TypeScript
application generator to one reviewed fixture inventory without combining their
execution boundaries. The inventory is
[`testdata/generation-goldens-v1/fixture-inventory.json`](../../testdata/generation-goldens-v1/fixture-inventory.json).
Every supported fixture declared for `iac` or `application` must appear in that
layer's exact golden suite; inventory-set tests prevent a silent coverage gap.
Negative and metamorphic fixtures are named tests rather than successful-output
goldens.

## Ordinary review commands

Ordinary tests are read-only and fail when reviewed bytes differ:

```powershell
pnpm generation:goldens:check
pnpm check:compiler
pnpm check:application-generator
pnpm check:contracts
```

The compiler suite parses every generated `.tf` file with HashiCorp HCL, asserts
stable resource references and exact IAM actions/provenance, rejects unsafe
constructs, and compares the `infrastructure/` and Terraform-manifest trees. The
application suite parses every emitted JSON and TypeScript file, type-checks
every supported source-emitting fixture through the pinned TypeScript API, joins
workload operations to emitted handlers/contracts/tests, checks coverage and
ownership, and compares application-source, canonical contract, and
application-manifest trees. Neither suite runs Terraform, providers, generated
application code, generated tests, package scripts, or cloud/network clients.

Repeated generation, equivalent collection ordering, mutable display labels,
presentation-only changes, portable naming, and materialization into two clean
temporary directories are asserted independently of golden comparison. Guided
versus Professional assistance is not an immutable compiler/generator input;
both session preferences therefore invoke the same immutable request and are
covered by the same output equality assertion.

## Golden layout

Reviewed files live below
`testdata/generation-goldens-v1/goldens/<fixture-id>/`:

```text
iac/                         reviewed infrastructure files and summary
application-source/          reviewed source bytes and summary
contracts/                   logical contract-file projection and summary
manifests/terraform/         content-addressed Terraform projection and summary
manifests/application/       content-free source-artifact projection and summary
```

The `contracts/` branch is a test-only storage projection. Each filename derives
from the canonical contract ID and semantic version: the leading `contracts.`
namespace is omitted, the remaining identity is normalized to a lowercase NFC
hyphenated stem, and `-v<portable-version>.json` is appended. A unique logical
name stays unsuffixed when it fits the 96-character filename budget. When two
source contracts share that logical stem, or the stem must be shortened to fit,
the projection appends the first 12 hexadecimal characters of the exact source-
file SHA-256 checksum. A case-insensitive NFC collision in either canonical
input paths or projected names, including a repeated 12-character checksum
prefix, fails closed instead of overwriting a reviewed file. Full 64-character
digests are deliberately kept out of golden filenames.

Every committed generation-golden path is limited to 180 characters relative to
the repository root, and every filename is limited to 96 characters. The
ordinary check and guarded updater inspect the complete golden tree against both
budgets. These limits apply only to reviewed testdata storage: canonical
`application/contracts/...` product paths are unchanged.

The application manifest projection omits duplicated source `content` while
retaining checksums, semantic checksums, byte counts, ownership, provenance,
coverage, build contracts, input digests, and the outer artifact digest. Exact
source and contract bytes remain separately reviewable. The manifest and its
projection checks also retain provenance equality: repeated generator, template,
runtime, pattern, and Solution Revision pins in each source-file record must
exactly match the retained artifact-root pins before omission. Each diff record
retains its canonical path and must have the same source references as that
path's retained source-file record before its duplicate references are omitted.
A mismatch fails the ordinary golden check; this is a test-only storage
projection and does not change generated artifacts or digests. The manifest and
semantic summaries together retain each canonical product path, its full exact
and semantic SHA-256 values, and its provenance and ownership, so the shorter
storage name is never a digest or identity authority. Semantic summaries also
list resources, policies, operations, tests, diagnostics, coverage, and content
digests without timestamps or machine paths.

## Explicit update commands

Golden updates cannot run through ordinary tests. Each update requires the exact
confirmation token and a reviewer-readable summary:

```powershell
pnpm generation:goldens:update:iac --confirm UPDATE_REVIEWED_GENERATION_GOLDENS --summary "Explain the intentional IaC semantic change"
pnpm generation:goldens:update:application-source --confirm UPDATE_REVIEWED_GENERATION_GOLDENS --summary "Explain the intentional source semantic change"
pnpm generation:goldens:update:contracts --confirm UPDATE_REVIEWED_GENERATION_GOLDENS --summary "Explain the intentional contract change"
pnpm generation:goldens:update:manifests --confirm UPDATE_REVIEWED_GENERATION_GOLDENS --summary "Explain the intentional manifest/digest change"
```

`pnpm generation:goldens:update:all` accepts the same confirmation and summary,
but category-specific updates are preferred because they minimize reviewer
scope. The updater rejects missing/incorrect confirmation, missing/short
summaries, unknown categories, and duplicate arguments before invoking a test.
Each test independently validates the same environment gate and constrains
recursive replacement to its exact fixture/category root. After each selected
category is refreshed, the updater validates the complete golden path inventory
and reports the maximum repository-relative path and filename lengths.

After an update:

1. Read every changed `semantic-summary.md` and compare it with the stated
   intent.
2. Review exact HCL/source/contract changes separately from manifest-only digest
   changes. For contracts, use the summary and application manifest to join each
   logical storage filename back to its canonical product path, full hashes,
   provenance, and ownership.
3. Run `pnpm generation:goldens:check` with no update environment variables.
4. Run the affected workstream gates and `git diff --check`.
5. Never approve unexplained resource, IAM, operation, test, ownership,
   diagnostic, coverage, path, dependency, or input-digest changes.

## Robustness and non-gating baselines

Go fuzz entry points cover malformed JSON, identifiers/labels, and policy
statements. Deterministic application property loops cover hostile labels,
portable identifiers, repository paths, malformed JSON, operation/contract
references, logical-name and short-digest collisions, path budgets, trigger
identity, and repeated generation. These tests are bounded and do not execute
generated content.

`pnpm generation:baselines` records representative measurements without timing
assertions. On 2026-08-17 on Windows amd64, Intel Core Ultra 7 268V, using 20
iterations, the Go baseline recorded:

- small Lambda: 2,333,755 ns/op, 706,052 B/op, 3,946 allocations/op;
- medium authenticated notes API: 9,352,310 ns/op, 2,687,090 B/op, 15,391
  allocations/op.

The application baseline generated ten in-process artifacts per case and
recorded 574.89 ms for the 16-file starter case and 1,372.44 ms for the 33-file
CRUD/multiple-dependency case. These numbers are diagnostic snapshots, not CI
budgets: machine load, test transform cost, and runtime updates may change them.
Review material regressions by profiling and updating this dated ledger; never
weaken correctness or add a flaky elapsed-time gate.

## Trust and stopping boundary

Fixtures are synthetic and credential-free. Tests reject embedded secret values,
machine paths, Terraform provisioners/modules/executors, source process/network
constructs, broad IAM wildcards, ownership collapse, malformed references, and
silent user-file overwrite. Coverage remains an artifact assessment rather than
immutable Solution Revision Evidence. Prompt 30 does not authorize repository
persistence/transport (Prompt 31), isolated dependency/build/test/package
execution (Prompt 32A), planning, deployment, or customer/cloud access.
