# Deterministic application source generation

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

## Status and scope

This document defines the completed Prompt 29A and Prompt 45A deterministic
application-source boundary. The implementation returns source artifacts as
validated data; it does not materialize a repository, resolve or install a lock,
build or execute the generated application, package a Lambda artifact, plan, or
deploy. Final repository-gate command evidence belongs in
[STATUS](../PUBLIC_STATUS.md) and [HANDOFF](../PUBLIC_STATUS.md), not in the
capability definition here.

The supported families are the authenticated notes API and six curated
event-driven Lambda patterns on AWS Lambda `nodejs24.x`, implemented as strict
TypeScript ECMAScript modules with handler `index.handler`. They are
deliberately narrower than arbitrary application or AI code generation.
[ADR-0030](../adr/0030-nodejs-typescript-lambda-starter-runtime.md) records the
runtime choice;
[ADR-0017](../adr/0017-versioned-workload-behavior-and-build-boundaries.md),
[ADR-0025](../adr/0025-canonical-solution-repository-and-evidence-contracts.md),
and
[ADR-0029](../adr/0029-deterministic-terraform-and-application-artifact-boundary.md)
govern the behavior, repository, evidence, and Terraform boundaries.

## Boundary and authorities

`@cloudmarkup/application-generator` is a separate, strict TypeScript package
under `packages/application-generator`. Its public operation is a pure
data-to-data transformation: it accepts one exact, immutable input composition
and returns an application-source artifact and change-set calculation. It does
not share source-generation or build execution with the Go IaC compiler.

The inputs retain distinct authorities:

- Architecture Document v3 is infrastructure and typed-relationship truth.
- Workload Behavior v2 is workload operation, trigger, dependency, entrypoint,
  test, ownership, extension, and unresolved-behavior truth.
- Application Contracts v1 are HTTP, data, auth, behavior, event, and test
  interface truth.
- Solution Revision v1 freezes the exact document hashes, ownership, generation
  coverage, and tool-version decisions used by a request.
- Compiler normalized-model v1 supplies deterministic resource target keys,
  deployment keys, typed edges, external-resource bindings, and normalized
  ordering. It does not replace the canonical Workload or Application Contracts.
- The exact provider catalog and generator registry decide whether a reviewed
  runtime/template/pattern combination is available. They do not add behavior
  absent from the canonical documents.

The generator must cross-check these authorities and fail closed on a document
identity, revision hash, contract reference, normalized resource or edge,
runtime, handler, ownership, or compatibility mismatch. It never infers event
shape, access, resource identity, or business behavior from a label, UI layout,
provider service name, or existing source. Stable paths come from compiler
deployment keys. IAM remains graph-derived in the Prompt 29 Terraform target and
is never inferred by scanning generated source.

## Exact supported descriptor matrices

There is no `latest` or compatible-by-convention selection. A notes generation
request must match the complete descriptor matrix below:

| Contract element                | Exact value or authority                                                  |
| ------------------------------- | ------------------------------------------------------------------------- |
| Application-generation contract | `1`                                                                       |
| Generator ID                    | `cloudmarkup.application-generator`                                       |
| Generator version               | `1.0.0`                                                                   |
| Generator digest                | exported `APPLICATION_GENERATOR_DIGEST`                                   |
| Template ID                     | `cloudmarkup.template.aws-lambda-notes-typescript`                        |
| Template version                | `1.0.0`                                                                   |
| Template digest                 | exported `NOTES_TEMPLATE_DIGEST`                                          |
| Supported-pattern ID            | `cloudmarkup.pattern.aws-lambda-authenticated-notes`                      |
| Supported-pattern version       | `1.0.0`                                                                   |
| Supported-pattern digest        | exported `NOTES_PATTERN_DIGEST`                                           |
| Catalog ID                      | `aws.cloudmarkup.notes-api-catalog`                                       |
| Catalog version                 | `0.8.0`                                                                   |
| Catalog digest                  | `sha256:c5a114b1035634699e0ee207269d9fecc59081a45f1979319414a872cd41671b` |
| Workload runtime family         | `aws.lambda.runtime-family.nodejs24`                                      |
| Language family                 | `cloudmarkup.language.typescript`                                         |
| Lambda runtime                  | `nodejs24.x`                                                              |
| Handler                         | `index.handler`                                                           |
| Module format                   | `esm`                                                                     |
| HTTP trigger contract           | `aws.apigateway.http-api.payload-v2`                                      |

The additive curated-event request must instead match this exact matrix; the
notes coordinate above remains immutable:

| Contract element          | Exact value or authority                                                  |
| ------------------------- | ------------------------------------------------------------------------- |
| Generator ID              | `cloudmarkup.event-application-generator`                                 |
| Generator version         | `1.0.0`                                                                   |
| Generator digest          | exported `EVENT_APPLICATION_GENERATOR_DIGEST`                             |
| Template ID               | `cloudmarkup.template.aws-lambda-curated-events-typescript`               |
| Template version          | `1.0.0`                                                                   |
| Template digest           | exported `EVENT_APPLICATION_TEMPLATE_DIGEST`                              |
| Supported-pattern ID      | `cloudmarkup.pattern.aws-lambda-curated-event-driven`                     |
| Supported-pattern version | `1.0.0`                                                                   |
| Supported-pattern digest  | exported `EVENT_APPLICATION_PATTERN_DIGEST`                               |
| Trigger dispatcher        | `cloudmarkup.event-trigger-dispatcher@1.0.0` plus its exported digest     |
| Catalog ID                | `aws.cloudmarkup.notes-api-catalog`                                       |
| Catalog version           | `0.13.0`                                                                  |
| Catalog digest            | `sha256:7a346f839851cba07c6e59d5311f630897a1181967e9ceb8fb3ba4755305ec8d` |
| Runtime/language/handler  | same exact reviewed Node.js 24/TypeScript ESM runtime descriptor          |
| Dispatch authority        | explicit Workload event binding and typed Architecture edge only          |

Exact current catalog `0.15.0` at
`sha256:5454b1255486921e0240ccd67f3ee1effd5e0b25eb2aaee082e13221528bef3e` admits
this unchanged generator/template/pattern/dispatcher tuple; exact `0.13.0` and
`0.14.0` remain historical compatible bindings. Target selection never creates a
second source generator; Terraform and CloudFormation bind the same Prompt 32A
package bytes. Runtime event inference remains forbidden.

Catalog growth preserves exact `0.16.0` notes, event and HTTP no-content
generator bindings. Current `0.17.0` admits those same reviewed tuples without
changing their source templates. Immutable revisions retain their catalog pins;
authoring upgrades are explicit reversible commands. Compiler artifact readiness
requires the exact catalog/generator/template tuple and remains incomplete until
separate build evidence exists.

The digest exports and their canonical descriptors live in
`packages/application-generator/src/constants.ts`; that public descriptor is the
hash authority for contract v1. Template and pattern digests are derived from
canonical JSON, and file checksums are derived from exact UTF-8 bytes. Changing
a descriptor changes its digest and requires an explicitly pinned input rather
than an in-place compatibility assumption.

## Generation input

One request composes, at minimum:

1. the immutable Solution Revision v1 manifest and its exact architecture,
   Workload, Application Contracts, external-resource, ownership, coverage,
   catalog, and application-generator decisions;
2. the matching canonical Architecture Document v3 envelope;
3. the canonical Workload Behavior v2 entry selected for generation;
4. all exact Application Contract records referenced by that workload;
5. normalized-model v1 resources, connections, external references, variables,
   and stable target keys for the same revision;
6. the exact generator, template, supported-pattern, runtime, language, handler,
   and catalog descriptors; and
7. when calculating regeneration, the prior generated manifest and a bounded
   inventory of current file paths and digests.

Request `existingFiles` is a schema-bounded, caller-supplied inventory of
relative paths, media types, ownership, current/baseline/semantic digests, and
byte counts. The generator validates those assertions and then trusts them only
for deterministic diff calculation. Prompt 29A does not authenticate or bind
that inventory to a Repository Snapshot, commit, repository lock, or storage
observation; a later authorized repository boundary must establish that link
before materialization.

The generator accepts canonical documents as untrusted input. It validates
schemas and then verifies semantic joins: every route resolves an exact HTTP
contract and trigger edge; every generated data action resolves an exact
Workload operation, data contract, and typed Architecture relationship; every
auth binding resolves the configured auth contract; every environment binding
resolves a normalized edge or external reference; and every generated path is
repository-relative and belongs to the expected deployment key.

Ordering uses deterministic UTF-16 comparison, text output uses LF endings, and
results contain no timestamp, random identifier, current working directory,
absolute machine path, account-specific resource identifier, credential, or
secret value. Secret bindings may produce typed environment-variable references,
but their values are never input to or emitted by this boundary.

## Implementation modes

The result represents all six closed Workload implementation modes without
silently promoting one mode to another:

| Mode                         | Prompt 29A result                                                                                                                                                                                                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `infrastructure-only`        | No application source. Return a stable readiness contract and diagnostic that application code is required; the separate Prompt 29 target remains responsible for infrastructure.                                                                                          |
| `user-provided`              | No pretend business logic. Return the expected runtime, handler, package/artifact, and validation contract for user-supplied code.                                                                                                                                         |
| `generated-starter`          | Emit deterministic source only for explicitly supported operations, plus generated TODO/readiness diagnostics and disjoint user extension points for unresolved behavior.                                                                                                  |
| `complete-supported-pattern` | Emit a complete source and test tree only when every required operation, route, data/auth contract, entrypoint, test, binding, and relationship matches the exact reviewed pattern. Any unresolved or unsupported requirement fails complete generation.                   |
| `ai-assisted-custom`         | Emit deterministic scaffolding, canonical contracts, extension ownership, validation requirements, and explicit unresolved/custom boundaries. It does not call a model or emit purported AI-authored business logic; Prompt 36A owns that later candidate-source boundary. |
| `external-artifact`          | Return the validated digest-bearing artifact-reference and compatibility contract. Do not fetch, inspect, build, or trust an external artifact during generation.                                                                                                          |

The built-in notes template itself supports source emission for
`generated-starter` and `complete-supported-pattern`. The other modes remain
first-class protocol results so downstream export and Prompt 29 artifact
handling stay explicit.

## Authenticated notes API support

The initial source emitter is limited to behavior explicitly represented by the
selected Workload and canonical contracts:

- API Gateway HTTP API payload-v2 Lambda entrypoints through relationship
  `aws.apigateway.integrates-lambda`, with exact configured route key, method,
  path, operation ID, request contract, response contract, and trigger edge;
- Cognito JWT issuer and audience relationships
  `aws.cognito.provides-jwt-issuer` and `aws.cognito.provides-jwt-audience`,
  with claim extraction only for claims named by the exact auth contract;
- canonical request and data validation generated from the referenced
  Application Contracts rather than a second hand-written schema authority;
- DynamoDB `read` as an explicit get-item binding through
  `aws.lambda.reads-dynamodb-table`;
- DynamoDB `create`, `update`, and explicitly requested `delete` through
  `aws.lambda.writes-dynamodb-table`;
- deterministic environment bindings for each typed dependency, including
  multiple distinct downstream resources and external references;
- stable success, validation, not-found, and error responses;
- structured CloudWatch-compatible logs and correlation-ID propagation; and
- generated unit tests and request/response contract tests for the represented
  behavior.

Supported operation kinds are exactly `create`, `read`, `update`, and `delete`.
The generator does not reinterpret `read` as list, query, or scan. It does not
invent partition keys, ownership rules, claim names, status codes, response
shapes, missing behavior, or arbitrary business logic. An unsupported or
incomplete operation returns a stable source-linked diagnostic. Multiple
triggers are accepted only when their exact event contracts and dispatcher are
reviewed as compatible; mixed or unregistered shapes fail with a recommendation
to use separate functions. A handler never guesses an event type at runtime.

## Curated event-driven application support

The Prompt 45A emitter admits exactly six pattern kinds:

- `s3-image-metadata`: an S3 object-created envelope, decoded object key and
  metadata binding, explicit metadata-store operation, and duplicate-safe hook;
- `sqs-consumer-dlq`: bounded batch dispatch with per-record processing,
  `batchItemFailures` for reviewed partial-batch response semantics, explicit
  retry/DLQ awareness, and no delete or replay authority;
- `sns-fanout-consumer`: one independently generated handler per bound consumer
  with explicit SNS envelope parsing and no fabricated fan-out transform;
- `eventbridge-scheduled`: one reviewed fixed-rate contract with explicit
  EventBridge envelope dispatch;
- `eventbridge-target`: one exact event-contract target with bounded filter,
  retry, and DLQ facts; and
- `step-functions-task`: typed task input/output contracts for a reviewed Lambda
  task edge, without generating arbitrary ASL or business workflow
  transformations.

Every handler receives its trigger kind from Workload Behavior and referenced
Application Contracts. It validates that exact envelope, extracts a bounded
correlation identifier, emits structured logs, uses declared environment
bindings, and calls one generated no-op runtime seam. That generated module is
the only extension implementation admitted to a generated-profile ZIP. A
separate `extensions/custom.ts` file exposes the preserved user-owned review and
customization boundary, but generated handlers do not import it and Prompt 32A
excludes it from generated-profile packages. Activating custom behavior requires
a separately reviewed custom-source build and cannot retain complete
generated-pattern coverage implicitly. The generated default idempotency helper
is a deterministic hook/pattern, not a claim of durable cross-invocation
storage. Duplicate delivery remains possible and is tested.

`complete-supported-pattern` is emitted only when every required operation,
event/data/test contract, typed edge, dispatcher, binding, retry/DLQ setting,
and extension declaration matches the exact descriptor and the downstream Prompt
32A build confirms generated tests, scans, package, and coverage. Generation
alone records the eligible coverage assessment; unresolved behavior, an
unsupported filter or mixed trigger, missing permission/contract binding, or an
invented transform remains `generated-starter` or
`custom-implementation-required` with source-linked diagnostics.

## Deterministic source artifact

Across source-emitting modes, the target artifact uses this bounded logical
union tree. The `build-contracts/` branch is present only for conflict-free
`generated-starter` and `complete-supported-pattern` results. Exact files are
enumerated in the returned manifest rather than discovered by walking a
repository:

```text
application/
  README.md
  package.json
  tsconfig.json
  lockfile.contract.json
  build-contracts/
    <stable-workload-key>.json
  contracts/
    <stable-contract-key>.json
  src/
    functions/
      <stable-deployment-key>/
        index.ts
        generated/
          bindings.ts
          idempotency.ts
          runtime-extension.ts
          types.ts
          operations/
            <stable-operation-key>.ts
        extensions/
          <declared-extension-point>.ts
  tests/
    fixtures/
      <stable-deployment-key>.json
    functions/
      <stable-deployment-key>/
        unit.test.ts
        contracts.test.ts
  test-specifications/
    <stable-deployment-key>.smoke.json
```

`index.ts` exports `handler`, making the compiled handler `index.handler`.
Generated bindings retain the exact Workload binding and Architecture edge
identities; generated types and validators retain exact Application Contract
identities. Operation modules exist only for supported explicit actions.
Extension files have a generated interface but a separate ownership declaration;
they are not mixed into replaceable generated sections. They are preservation
and ownership boundaries, not executable extension hooks: generated handlers do
not import or invoke them. The README describes unresolved behavior,
extension-point ownership, and the later build handoff.

The source artifact returns files as data. It does not create this tree on disk.
The current template emits `lockfile.contract.json`, a deterministic
lockfile-generation contract for Prompt 32A, not a resolved or frozen package
manager lock. Prompt 29A neither resolves dependencies nor fabricates lock bytes
from unexecuted resolution. The inner manifest is returned as a separate
artifact field rather than an emitted `manifest.json` file, keeping it outside
its own file and digest closure.

## Manifest, provenance, and coverage assessment

Each emitted file records its normalized path, media type, ownership class,
exact-byte SHA-256 checksum, semantic-diff strategy, regeneration policy, and
the provenance identities that caused it. Action-bearing source additionally
records the exact workload, operation, Application Contract, Architecture edge,
environment binding, normalized resource target, and extension point where
applicable.

The manifest records the exact Solution Revision ID, Architecture revision ID,
catalog, generator, template, pattern, runtime, language, and handler
descriptors. Its `inputDigests` bind canonical JSON for the Architecture
Document, Workload Behavior, Application Contracts, Solution Revision, and
normalized solution. Source entries and build envelopes are canonically ordered;
coverage, the inner manifest, every build envelope, and the outer artifact are
independently content-addressed without self-hash cycles. Diagnostics use
bounded canonical IDs and repository-relative source paths; they do not include
source bodies, secret values, credentials, or machine paths.

The generator also returns a deterministic coverage assessment. This is an
assessment against the selected immutable revision, not new Evidence and not a
mutation of that revision's official generation coverage. A
`complete-supported-pattern` assessment is eligible only when all represented
behavior and required generated tests are present and no requirement or
diagnostic remains unresolved. Build, executed-test, security, package,
provider-Region, plan, and deployment evidence remain absent until their owning
boundaries produce and freeze them in a later Solution Revision.

## Ownership and regeneration

Repository ownership follows the canonical Prompt 24D manifest contract:

- generated and user-owned files have explicit, disjoint paths;
- no generated declaration claims the whole `application/` root or an ancestor
  of a user-owned declaration;
- generated replacement requires an exact prior baseline digest and uses
  `replace-when-baseline-matches`;
- user-owned extension files use regeneration `never`;
- an initial user extension stub may be proposed only when its declared path is
  absent, and later runs never replace it;
- approved extension paths carry their exact extension-point IDs;
- a modified generated baseline, ownership overlap, attempted user-file
  replacement, duplicate path, invalid path, deletion, or orphaned prior file
  becomes an explicit conflict or preservation result; and
- no file is silently overwritten, merged, moved, or deleted.

Regeneration is therefore a deterministic semantic/file diff, not a repository
write. It classifies intended additions, exact replacements, unchanged files,
preserved user files, and conflicts from bounded path/digest metadata. It never
reads arbitrary repository content or copies a user's source into a newly
generated ownership claim.

## Prompt 32A build and Prompt 29 artifact handoff

A versioned Prompt 32A build envelope is returned only for conflict-free
`generated-starter` or `complete-supported-pattern` source. AI scaffolding,
user-provided code, infrastructure-only workloads, and external artifacts never
receive a pretend build-ready envelope. For the reviewed template the envelope
identifies Node.js 24, strict TypeScript 6.0.3, ESM, the source and compiled
entrypoints for each stable deployment key, handler `index.handler`, relocation
of that compiled module to archive-root `index.js`, exact declared dependency
coordinates and lock policy, required checks, checksummed source inputs, and the
stable relative `application/artifacts/<portable-segment>/function.zip`
destination consumed by Prompt 29. Deployment-style workload IDs remain
unchanged; every other valid Workload ID uses a sanitized readable prefix plus
its full SHA-256 digest so distinct IDs cannot collide. The envelope contains no
local absolute path or executable command.

Dependency and tool `digest` fields are explicitly tagged
`canonical-coordinate`: they hash the exact identifier/name and version
declaration, not registry bytes or a successful installation. The separate
Prompt 32A runner now requires an integrity-bearing frozen lock, exact package-
manager and offline-cache pins, and verified package integrity before it may
compile, execute generated tests, scan, reproduce, package, and attest. Prompt
29 continues to consume only its versioned application-artifact contract and
stable relative/object reference. Terraform rendering cannot call this generator
or the builder, use a shell provisioner, inspect application source, or alter
source ownership. See
[isolated application build execution](APPLICATION_BUILD_EXECUTION.md).

## Prohibited capabilities

The application generator does not execute generated source, a package manager,
dependency resolver, compiler, test runner, ZIP builder, subprocess, shell,
repository service, Terraform, or provider SDK. It does not read or write a
repository, fetch an artifact, access credentials or secrets, use
network/cloud/database services, call a model, create Evidence, plan
infrastructure, or deploy.

These exclusions are contract constraints, not merely current implementation
omissions. A later execution boundary requires its own versioned input/output,
isolation, authorization, dependency, evidence, and rollback design.

## Limitations

The implementation does not support other Lambda runtimes, languages, CommonJS,
containers, layers, arbitrary handlers, event sources outside the exact six
curated patterns, arbitrary AWS services, DynamoDB list/query/scan behavior,
inferred dispatch, unregistered mixed-trigger dispatchers, or arbitrary business
logic. External-artifact admission, fetching, scanning, and attestation are
outside this boundary. Source completeness alone does not establish a successful
build, executed test, security review, Terraform plan, regional availability, or
deployment.

Repository tests statically compile the emitted virtual TypeScript trees with
the pinned TypeScript 6.0.3 API. The generator itself still does not invoke a
compiler or execute generated tests. Prompt 32A now implements those operations
in the separate application-build runner for exact admitted generated source;
canonical-coordinate hashes remain only handoff commitments and are not
substitutes for the runner's frozen-lock, offline-cache, scan, package, and
Evidence checks. The configured container image and offline store still require
separate operational publication and attestation before production use.

`existingFiles` remains a bounded trusted inventory for diff calculation rather
than an authorized Repository Snapshot- or repository-lock-bound observation.
The user-owned extension module remains a preserved ownership and documentation
boundary, not an imported, executed, or packaged application hook under the
generated profile. Exact generated builds instead compile and package the
template-bound generated no-op runtime seam; a materialized preserved custom
extension keeps coverage custom-required and emits no complete build handoff.

A later runtime must add a reviewed descriptor and digest, source emitter,
Prompt 32A adapter, compatibility evidence, goldens, negative tests,
reproducibility tests, ownership/security evidence, and documentation. It must
reuse the same provider-neutral Architecture, Workload, Application Contract,
Solution Revision, normalized-model, ownership, provenance, and coverage
semantics rather than duplicating them.

## Implemented verification scope

Focused tests cover:

- exact descriptor, revision, canonical semantic input digest, contract,
  runtime/handler, edge, and path rejection behavior;
- source goldens, repeated generation, input-order and display-label
  independence, LF normalization, manifest checksums, and semantic assertions;
- all six implementation modes and complete-pattern fail-closed behavior;
- supported CRUD routes, canonical validation, Cognito claims, deterministic
  environment bindings, multiple dependencies, external references, response
  helpers, logging, correlation IDs, and generated unit/contract fixtures;
- unsupported operations, missing behavior, malicious labels and paths, secret
  non-disclosure, mixed-trigger rejection, and no guessed event shape;
- all six curated event envelopes, local fixtures, batch partial failure,
  duplicate/idempotency behavior, retry/DLQ/filter/timeout boundaries,
  structured correlation logging, Step Functions task contracts, deterministic
  source goldens, and multi-handler generation;
- additions, unchanged files, exact-baseline replacements, user-owned
  preservation, overlap/modification/orphan/deletion conflicts, and repeat
  regeneration; and
- separation from build execution, Terraform, IAM inference, repository writes,
  networks, credentials, models, Evidence creation, and deployment.

The completed Prompt 29A plan defines the repository gates. Exact final results,
including the corrected test-fixture type-check interruption in the one
aggregate invocation, are recorded in the [handoff](../PUBLIC_STATUS.md) and
[status](../PUBLIC_STATUS.md) closeout ledgers.

## Prompt 36A AI-assisted custom candidates

Prompt 36A supplements this deterministic generator; it does not change its
supported matrix or regenerate its output through free-form model content. The
coordinator first returns `deterministic-generator-required` whenever the
requested behavior fits a supported catalog/runtime/template descriptor.
Candidate source is considered only when the frozen workload explicitly uses
`ai-assisted-custom` and declares the matching Prompt 24D extension,
extension-point ownership, runtime/language, source references, and output
paths.

The model receives the deterministic AI scaffold and canonical Workload and
Application Contract interfaces, exact bindings, expected tests, allowed
dependencies, validation expectations, and only sanitized user-owned extension
files that must be preserved. It may return strict bounded complete files for
AI-owned extension paths. A user-owned existing file may be changed only by an
exact base-digest-bound patch; replacement content is rejected, and the
resulting artifact retains both its user-owned base and AI patch lineage. It
cannot alter generator-owned paths, source-ownership records, dependency policy,
runtime, handler, build commands, IaC, or the immutable Solution Revision.

After path, size, content, dependency, provenance, and reference checks, the
complete candidate tree enters the separate Prompt 32A
`ai-assisted-custom-nodejs24` profile. That profile rechecks every generated
scaffold byte, accepts AI-authored content only at exact extension-point paths,
requires the derived unit and contract tests, and blocks unresolved behavior.
Only passing lint, type-check, tests, build, dependency/secret scans, package,
and reproducibility evidence can support `ai-assisted-custom-validated`. Source
generation or parsing alone never establishes complete coverage.

The candidate stays in a restricted content-addressed boundary until review. An
authorized edit derives a new immutable candidate, records the exact changed
paths and base artifact, and reruns the complete AI-custom validation profile;
it never overwrites the original candidate or a repository.

Explicit acceptance rechecks the exact review, candidate, revision, ownership,
and Evidence and returns a distinct immutable successor Solution Revision plus a
digest-bound export input containing the accepted Prompt 24D record and any user
edit lineage. Neither generation nor acceptance writes or materializes a
repository, changes deterministic source, assembles compiler output, or deploys.

## Opt-in beta source drafts

An explicit ai-source-draft-v1 export selection packages review-required Lambda
ESM source, mocked tests and setup notes from immutable purpose and
relationships. This path does not run the code, replace deterministic generator
output, create build evidence or upgrade infrastructure-only coverage. Its
strict schema, current export authorization, bounded fixed-model call, replay
identity and host-controlled paths are specified in
[ADR-0057](../adr/0057-opt-in-beta-application-source-drafts.md).
