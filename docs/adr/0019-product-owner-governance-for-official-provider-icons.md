# ADR-0019: Product-owner governance for official provider icons

- **Status:** Accepted
- **Date:** 2026-08-01
- **Owners:** CloudCanvas product and engineering
- **Supersedes:** ADR-0008
- **Superseded by:** None
- **Acceptance evidence:** `CC-AWS-ICONS-OWNER-APPROVAL-2026-08-01`

## Context

ADR-0008 established the correct durable boundary for provider artwork: use an
official source, ingest it through a controlled local pipeline, record immutable
provenance, and never hotlink or imitate provider icons. Its follow-up manifest
implemented a custom five-role, per-entry human review record with duplicated
legal, accessibility, compatibility, withdrawal, and digest confirmations.

That paperwork does not strengthen the static-SVG parser, normalization,
integrity, path, or bundle controls. It also makes a product-owner decision
about recognizable provider artwork depend on invented independent review roles.
AWS does not supply exact resource artwork for every CloudCanvas catalog entity,
so an exact-resource-only gate can additionally preserve placeholders where the
official service-family mark is the accurate available representation.

CloudCanvas needs a smaller auditable governance contract without weakening the
untrusted-asset security boundary, local-only runtime behavior, deterministic
builds, or visible and accessible service identification.

## Decision

CloudCanvas retains the controlled provider-icon pipeline and replaces its
multi-reviewer approval contract with a source-level product-owner approval plus
automated technical admission.

The importer remains non-authoritative for approval. It can write only
`candidate` entries to an external staging directory after validating the
selected local source. The checked
`packages/provider-aws/assets/SOURCE_REVIEW.md` record is the authoritative
source-level human decision for one exact package, permitted surfaces, and the
exact-resource/service-family mapping policy. The candidate manifest is the
authoritative generated per-mapping evidence. Promotion binds the record to the
candidate source and approval projection, validates every manifest mapping
against the catalog and staged checksums, reruns every source-independent
pre-promotion admission check, materializes only matching passing candidates as
`approved`, generates deterministic registration, and computes the canonical
asset-set digest. It does not infer or manufacture approval.

For each provider asset set, the repository records one official package label
and version, canonical origin, whole-package SHA-256, import date, product-owner
approval record, approved product surfaces, trademark-use acknowledgment, and
accessibility usage contract. Each catalog mapping records its icon ID, visible
service/resource name, provider service family, selected official member, source
and normalized SHA-256 values, canonical destination asset ID, mapping type, and
automated security result.

Promotion requires all of the following:

- an explicitly approved official source package;
- an identified product-owner approval record;
- an explicit exact-resource or approved service-family mapping;
- passing automated SVG, XML, path, normalization, size, checksum, and manifest
  admission;
- the supplementary-icon accessibility contract; and
- a canonical, valid manifest whose digest is calculated by the tooling.

Direct-import checks, generated-registration drift checks, production builds,
and exact-once bundle validation remain mandatory post-promotion release gates.
A promoted asset set is not ready to commit or release until those checks pass.

A separate outside-counsel, brand, security, or accessibility reviewer is not a
technical promotion prerequisite. The product-owner trademark acknowledgment is
not represented as an outside legal opinion. The manifest stores the concise
repository-level acknowledgment once rather than repeating legal prose per
entry.

The selected-source digest remains an importer write-time technical lock between
dry-run and staging. Promotion does not require a separately supplied review
record path or a manually pasted final asset-set digest; it reads the fixed
checked evidence record and calculates the digest from the canonical result.

Service-family artwork is allowed when the official package has no accurate
resource-specific icon and the product owner approves the semantic mapping. The
visible CloudCanvas service/resource name remains authoritative. Multiple icon
IDs may alias one canonical provider asset only when their complete canonical
source and normalized evidence agrees. The repository and production bundle must
contain that asset's bytes once.

Provider icons remain supplementary visuals. Adjacent visible names identify
catalog cards and nodes; decorative instances are hidden from assistive
technology, named interactive instances receive an accessible name, and status
or severity never depends on an icon or color alone. A neutral fallback remains
the fail-closed result for an absent or technically rejected individual asset.

All archive, traversal, symlink, device-path, XML/SVG namespace, active-content,
remote-reference, geometry, size, checksum, deterministic-normalization,
manifest, direct-import, and bundle-duplication controls remain mandatory. Only
the importer may perform an explicitly versioned source normalization; checking
and promotion validate admitted bytes without normalizing them.

The provider-icon manifest moves from contract version 1 to version 2. Final
manifests accept only explicit `approved` or `placeholder` entries; candidate
state is staging-only. Tooling rejects legacy or mixed evidence rather than
inferring approval. The v1 checked manifest contains only placeholders and the
pending external candidates are reproducible from the pinned package, so this is
a build-time asset migration; there is no Architecture Document, graph, catalog
ID, API, tenant, compiler, or deployment migration.

## Consequences

### Positive

- Approval evidence matches the accountable product decision and is concise.
- Automated security controls, immutable provenance, and deterministic output
  remain authoritative and independently testable.
- Approved service-family mappings avoid invented artwork and unnecessary
  placeholders.
- Canonical aliases prevent duplicate repository and bundle bytes.

### Negative

- Product ownership now carries the provider-mapping and trademark-use decision
  explicitly.
- A future provider or materially different asset use needs its own source-level
  approval and policy evidence.
- Contract-v1 staging bundles must be regenerated; tools do not migrate them in
  place.

### Follow-up

- Keep the checked owner record, manifest projection, canonical assets,
  generated registrations, and bundle evidence synchronized through repository
  checks.
- Require a new explicit product-owner record for another provider package or a
  materially different use surface.

## Boundary analysis

- **Security and tenants:** static local artwork receives no tenant data and
  changes no authorization boundary. Technical admission remains fail-closed.
- **Determinism and compatibility:** canonical JSON, source/member checksums,
  generated registration, and bundle checks remain deterministic. Existing
  catalog icon IDs and provider-neutral registry APIs are unchanged.
- **Guided and Professional modes:** both resolve the same catalog IDs and local
  assets; presentation mode cannot change mapping or fallback semantics.
- **Provider portability:** the governance shape is provider-neutral, while AWS
  source and trademark evidence stays in the AWS asset set.
- **Rollback:** a new asset-set version can replace or withdraw bytes while the
  stable icon IDs fall back safely. Historical ADR-0008 remains available.

## Alternatives considered

- Keep the five-role, per-entry review record. Rejected because it duplicates
  source-level decisions and does not improve automated SVG safety.
- Remove the controlled pipeline and copy files directly. Rejected because it
  loses provenance, normalization, integrity, and runtime-import enforcement.
- Require resource-specific artwork for every ID. Rejected because official
  packages do not always provide it and provider-like imitations are prohibited.
- Treat product-owner approval as formal legal advice. Rejected because the
  approval is a business-owner trademark acknowledgment, not outside counsel.

## References

- [Asset policy](../design/ASSET_POLICY.md)
- [ADR-0008](0008-provider-icon-asset-pipeline.md)
- [ADR-0015](0015-provider-neutral-icon-resolution.md)
- [Security principles](../architecture/SECURITY_PRINCIPLES.md)
- Owner-approved promotion plan (private historical evidence, omitted from this
  distribution)
