# `@cloudmarkup/test-fixtures`

## Responsibility

Own synthetic, versioned fixtures that can be shared by TypeScript and later
cross-language contract tests.

`fixtures/architecture-document/v1` contains one representative valid document
and invalid documents for duplicate node IDs, broken references, self-parenting,
and unsupported schema versions. The `example.cloud` identifiers prove
provider-neutral extension seams and do not represent supported provider
services.

`fixtures/architecture-document/v2` contains one representative valid document
covering Workload Behavior v1 implementation ownership, operation I/O contract
references, trigger/downstream edge bindings, reference-only environment and
secret configuration, error/retry assumptions, and unresolved requirements. The
public fixture-path export keeps the v1 collection separate and additive.

`fixtures/intent-document/v1` contains a representative valid document, a valid
ambiguous document whose unknown values reference blocking and non-blocking
questions, a structurally valid document with deterministically detectable
contradictions, and a structurally invalid document that attempts to use an AWS
service ID as a workload capability.

`fixtures/document-versioning/snapshots` contains generated, byte-stable
canonical serializations of the representative Architecture v1, Architecture v2,
and Intent v1 documents. The existing `architecture` export remains the v1 path
for compatibility; explicit `architectureV1` and `architectureV2` keys are also
available. The schema artifact drift gate regenerates every snapshot in memory
and rejects stale files.

## Non-goals

Fixtures must not contain credentials, customer data, production identifiers,
incidental timestamps, or examples that imply unsupported service coverage.
