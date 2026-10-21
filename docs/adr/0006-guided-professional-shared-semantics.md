# ADR-0006: Guided and Professional Modes Share Semantics

- Status: Accepted
- Date: 2026-07-24
- Owners: CloudCanvas product and engineering
- Supersedes: None

## Context

CloudCanvas serves people who need different amounts of guidance while designing
the same kind of deployable architecture. A presentation mode that changes the
underlying model, validation rules, or export behavior would create incompatible
projects and make mode switching unsafe.

## Decision

Guided and Professional modes are presentation profiles over one product model.
Both modes use the same versioned Architecture Document, command engine,
validation stages, revision lifecycle, compiler inputs, export semantics,
authorization checks, and commercial entitlements.

Guided mode uses plain language, safe defaults, and progressive disclosure.
Professional mode uses denser controls, keyboard-oriented workflows, and access
to advanced configuration. A default becomes deployment meaning only after it is
represented explicitly in the same semantic command and document model.

Users may switch modes without data loss or semantic conversion. UI layout,
hidden controls, and visual density never change deployment meaning.

## Consequences

### Positive

- A project remains portable between audiences and modes.
- Validation, audit, compilation, and export require one semantic pipeline.
- Advanced users can inspect exactly what Guided mode produced.

### Negative

- Guided workflows cannot bypass required semantic fields or validation.
- UI tests must prove equivalent commands produce equivalent documents.
- Progressive disclosure requires careful state preservation.

### Follow-up

- Define mode-specific interaction patterns without creating mode-specific
  domain types.
- Add equivalence and mode-switch tests when the editor is implemented.

## Alternatives Considered

- Maintain separate beginner and professional document formats. Rejected because
  it fragments projects and makes switching lossy.
- Let Guided mode apply hidden semantic defaults. Rejected because hidden
  deployment meaning is difficult to audit and reproduce.
- Offer only a dense professional interface. Rejected because it does not meet
  the guided learning goal.

## References

- [Personas and Experience](../product/PERSONAS_AND_EXPERIENCE.md)
- [Product Specification](../product/PRODUCT_SPEC.md)
- [Domain Model](../architecture/DOMAIN_MODEL.md)
- [Testing Strategy](../architecture/TESTING_STRATEGY.md)
