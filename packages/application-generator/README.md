# Deterministic application generator

## Authenticated no-content candidate

HTTP_NO_CONTENT_RELEASE_V1 is an additive, exact tuple for one declared GET
returning an empty 204. It requires managed JWT relationships and exact
behavior/auth/test contracts, with no data or external actions. Source coverage
retains build and security requirements. Compiler 1.2.0 admits the exact tuple.
A synthetic graph created through real catalog/domain commands passes native
normalization, source generation and both renderers; the fixed local harness
executes emitted tests and compilation. Native package verification and
production activation are separate evidence layers;
[current status](../../docs/PUBLIC_STATUS.md) owns the enabled scope. Historical
notes/event tuples are unchanged. See
[ADR0054](../../docs/adr/0054-explicit-authenticated-no-content-pattern.md).

## Notes identifier release 1.1.0

The exported NOTES_IDENTIFIER_RELEASE_V1_1 pins an opt-in generator, template
and pattern tuple. The runtime, dependencies, behavior and deployment paths are
unchanged. Type names use Entity_ followed by the full SHA-256 of the canonical
contract ID and version, so accepted punctuation cannot produce invalid
TypeScript or ambiguous normalized identities. The template digest binds this
rule. Generated headers report version 1.1.0.

Requests must select the complete tuple and bind it in the immutable Solution
Revision, workload compatibility and supported-pattern declarations. Mixed
versions are rejected. Default constants and historical 1.0.0 generation remain
unchanged, including historical host-source admission and existing goldens.

The generated build profile admits the exact successor tuple; the AI scaffold
profile retains its original generator pin. Selecting this release does not
authorize model calls, native execution, promotion or production activation. The
separate notes-identifier-1.1-source.json golden covers a hyphenated-contract
CRUD tree without rewriting historical fixtures.

The installed notes, event and HTTP no-content generators admit only
`CURRENT_APPLICATION_CATALOG` (AWS 0.30.0 with its exact digest). Older project
bindings are rejected and require a new project. Generator, template, pattern
and runtime identities remain exact; catalog cleanup does not grant extra
source, permission or execution authority. Unsupported requirements produce
diagnostics.

`@cloudmarkup/application-generator` is the standalone boundary for reviewed
Lambda starter source. It consumes one exact immutable Solution Revision,
canonical Architecture/Workload/Application Contracts, and compiler
normalized-model v1. It returns a bounded, deterministic application-source
artifact, ownership-aware change set, coverage assessment, and application-build
contract.

The initial supported family is the exact authenticated notes API on AWS Lambda
`nodejs24.x` with strict TypeScript and handler `index.handler`. Supported
source is limited to explicit API Gateway HTTP API v2 routes, configured Cognito
claim extraction, canonical request/data validation, and explicit DynamoDB get,
put/update, or delete bindings. Unsupported behavior remains an explicit TODO or
diagnostic and is never presented as complete business logic.

All six Workload modes are protocol results. Infrastructure-only, user-provided,
and external-artifact modes emit readiness/package/reference contracts without
business source. Generated-starter emits only represented reviewed operations.
Complete-supported-pattern fails closed unless every operation, behavior, auth
rule, required test, binding, and ownership boundary is exact.
AI-assisted-custom emits deterministic scaffolding and an extension contract,
never an AI candidate. Build envelopes are limited to conflict-free generated
starter or complete source.

`generateApplication(input)` validates the public request schema and returns the
public result schema. Returned files are data: create, exact-baseline replace,
unchanged, preserve, or conflict decisions carry checksums, provenance, source
references, and a semantic/file diff. The inner source manifest binds canonical
digests of every immutable input and exact catalog/runtime/template/pattern
pins. Dependency/tool hashes in application-build envelopes are labeled
canonical coordinate digests; the separate application-build runner verifies the
exact frozen lock, package integrity, approved offline store, and execution
profile.

This package is pure. It does not write files, run generated code, install or
resolve dependencies, compile TypeScript, run tests, build ZIPs, fetch external
artifacts, inspect source for IAM, render Terraform, call models/cloud/network
services, read credentials, or deploy. Isolated build/test/scan/package
execution belongs to `@cloudmarkup/application-build-runner`; that does not add
execution authority to this generator.

## Golden verification

The shared golden inventory drives supported application fixtures plus named
unsupported, malformed, ownership, trigger, presentation, collision, and
regeneration cases. The suite compares exact application-source, canonical
contract, and application-manifest trees; parses emitted JSON and TypeScript;
statically compiles every supported source-emitting virtual tree in ordinary
tests; and joins Workload operations to handlers, contracts, generated tests,
coverage, and provenance without executing generated content.

Committed contract goldens use a test-only logical contract-ID/version filename
projection. A unique readable name stays unsuffixed; a name that collides or
must be shortened receives the first 12 hex characters of the exact source-file
checksum, and any remaining case-insensitive NFC collision fails closed.
Projected filenames are limited to 96 characters and complete repository-
relative golden paths to 180. Canonical `application/contracts/...` output
paths, generator and export behavior, and artifact digests do not change. The
application manifest and semantic summaries together retain the canonical path,
full checksums, provenance, and ownership for review.

```powershell
pnpm generation:goldens:check
pnpm check:application-generator
```

Ordinary checks are read-only. Category-specific updates are explicit and
reviewer-gated; see the
[deterministic generation golden workflow](../../docs/development/GENERATION_GOLDEN_WORKFLOW.md).

## Export handoff

The local solution-export service accepts a fully validated Application
Generation Result v1 as immutable data. It rechecks the artifact's own digest
chain, exact generator pin, Solution Revision ID, and semantic Solution Revision
input digest before packaging source, generator/build contracts, coverage, and
the application manifest under their original per-path ownership and provenance.

The export service never invokes this generator, invents missing source bytes,
changes ownership, or treats source coverage as Evidence.

## Build handoff

`@cloudmarkup/application-build-runner` consumes a verified generated result and
one exact build-contract digest as immutable input. Its frozen-lock, offline-
cache, fixed-command, lint/type/test/scan, deterministic ZIP/SBOM, coverage, and
Evidence checks remain a separate execution boundary. See
[isolated application build execution](../../docs/architecture/APPLICATION_BUILD_EXECUTION.md).

## Orchestration handoff

The Solution export workflow may call `generateApplication` only through its
typed injected application-generation port and only when the exact Go artifact
declares a generated-starter, complete-supported-pattern, or AI-assisted-custom
mode. Public result parsing, error diagnostics, generation-blocked readiness,
and any ownership conflict block downstream publication.

Only conflict-free generated-starter or complete-supported-pattern build
contracts may enter the isolated builder. AI scaffolds, user-provided source,
and external references are never executed by this handoff. The aggregate
workflow adds no filesystem, network, credential, model, or deployment authority
to the generator.
