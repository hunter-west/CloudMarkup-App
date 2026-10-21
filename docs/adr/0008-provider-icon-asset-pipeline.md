# ADR-0008: Controlled Provider Icon Asset Pipeline

- Status: Accepted
- Date: 2026-07-24
- Owners: CloudCanvas product and engineering
- Supersedes: None

## Context

Provider icons help users recognize services, but they carry provenance,
licensing, trademark, supply-chain, and reproducibility concerns. Copying assets
from arbitrary sites, generating imitations, or hotlinking assets at runtime
would make the product inconsistent and difficult to audit.

## Decision

CloudCanvas will use official provider icons only through a controlled,
versioned, locally consumed asset pipeline. Each asset set must record its
source, provider release or retrieval version, integrity information, review
state, and applicable usage guidance. Assets require the appropriate product,
brand, and legal review before production use.

The runtime and exported artifacts will not depend on hotlinks. Generated
imitations and copies from unverified third-party sites are prohibited. Reviewed
placeholders remain acceptable until an official asset is approved.

CloudCanvas branding remains visually primary. Provider icons, CloudCanvas brand
assets, interface action icons, illustrations, and template thumbnails are
separate asset classes with separate ownership and review requirements.

## Consequences

### Positive

- Asset provenance and integrity are auditable.
- The editor and deterministic exports can use pinned local inputs.
- Provider recognition does not displace CloudCanvas product identity.

### Negative

- Asset updates require ingestion, review, and compatibility work.
- Some services may temporarily use neutral placeholders.
- Provider usage guidance must be monitored and recorded.

### Follow-up

- Define the asset manifest, integrity checks, and approval workflow.
- Establish accessible fallback and placeholder rules.
- Document update cadence and removal procedures for each provider set.

## Alternatives Considered

- Hotlink icons from provider sites. Rejected because content and availability
  can change at runtime.
- Copy icons from arbitrary asset collections. Rejected because provenance and
  usage rights are unclear.
- Generate provider-like icons. Rejected because imitations create recognition
  and trademark risks.

## References

- [Personas and Experience](../product/PERSONAS_AND_EXPERIENCE.md)
- [Security Principles](../architecture/SECURITY_PRINCIPLES.md)
- [ADR-0007](0007-deterministic-diagram-export.md)
