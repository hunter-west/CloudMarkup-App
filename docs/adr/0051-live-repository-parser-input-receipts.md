# ADR-0051: Immutable parser input receipts for live repository evaluation

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Proposed
- **Date:** 2026-09-12
- **Owners:** Cloud Markup engineering
- **Refines:** ADR-0033 and ADR-0035
- **Supersedes:** None

## Context

Importer 1.0.2 records unsupported Terraform modules and CloudFormation
transforms as unresolved observations. Its snapshot and request hashes differ
from 1.0.1. Repository validator 2.6.0 and external-resource validator 2.7.0
describe the older parser. Frozen V2 plans retain opaque invocation hashes;
neither SQL nor a historical reader can infer the parser version from a hash.
Allowing more validator versions alone would permit a downgrade that hides the
new parser identity. Frozen case content and historical receipts must remain
unchanged. The isolated plan tracks this prerequisite before the importer
correction can ship.

## Decision

Add a private immutable parser-input metadata receipt issued only by the fixed
pre-inference parser host. The host obtains the exact currently approved frozen
case, validates the actual request against the current builder and invokes the
pinned compiler/parser over that case's unchanged synthetic source. Parsing runs
outside database transactions. The host then rechecks current approval, tenant
scope, case/source binding and the exact already-issued input evidence before
inserting the receipt. It accepts no parser callback, caller grades or supplied
parser metadata as issuance authority.

The receipt binds organization, project, principal, invocation and scope,
plan/approval, case/source/input, invocation/descriptor/request, runtime
request, input evidence, and actual importer/snapshot/result/compiler digests.
Only bounded identifiers and digests are retained. Source, prompts, candidate
bodies, paths, URLs and secret values remain outside this table and logs. The
row is immutable and unique per scoped invocation. It is issued before the
invocation journal begins; metadata from a later parser cannot replace the
original row.

Explicit repository 2.9.0 and external 2.10.0 assessments reference this exact
receipt. Their real deterministic parsing must reproduce its parser metadata;
their quality measurements remain authoritative, including negative findings.
Assessment publication and the shared terminal/accounting reader reauthenticate
the same row and exact plan/case/input/scope/evidence bindings. Old 2.6.0/2.7.0
cannot publish or be consumed for an invocation with new parser input metadata.
Historical invocations without such a row retain their old receipt meanings and
read-only financial recovery. Metadata parsing alone grants no dispatch,
settlement, promotion or graph mutation authority.

Prospective migration 0057 remains outside the live manifest until the actual
integrated predecessor is reviewed. Historical SQL and frozen datasets are not
rewritten. Issuance preserves organization-before-plan authorization/lock order;
historical reads perform no new approval, reconciliation or write. The proposed
V3 evaluation lineage will reference this receipt rather than issue a second
parser attestation.

## Alternatives considered

- Relabel 1.0.2 observations as 1.0.1: rejected because it falsifies provenance.
- Widen old validators: rejected because old receipt semantics would change.
- Add versions without durable parser input: rejected because opaque hashes
  cannot independently select the right parser history at the SQL boundary.
- Store source bodies in SQL: rejected because metadata is sufficient and source
  retention broadens the privacy boundary.

## Consequences and verification

The importer can correct false conformance without rewriting history. The cost
is one small immutable record per affected invocation, an explicit successor
assessment family, migration compatibility tests and two actual parser passes.
The trusted private host and database ownership remain the issuer boundary; this
does not claim that SQL can attest arbitrary operating-system execution.

Required tests cover real pinned source parsing; immutable replay; changed,
missing and late receipts; current membership/approval withdrawal; exact
cross-tenant and source/case/invocation checks; old receipt reads; recomputed
outer-hash substitutions; preserved negative quality and terminal recovery. No
live model, deployment or normal AI activation is part of these checks. Rollback
stops new affected execution while retaining all already-issued metadata and
historical recovery. Do not deploy older code that cannot parse new receipts
after successor issuance begins.
