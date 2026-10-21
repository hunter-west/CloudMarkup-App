# ADR-0007: Deterministic Diagram Export

- Status: Accepted
- Date: 2026-07-24
- Owners: CloudCanvas product and engineering
- Supersedes: None

## Context

An architecture diagram is part of the durable explanation of a CloudCanvas
revision. Capturing the browser viewport would make the result depend on screen
size, transient UI state, fonts, and rendering timing. It would also fail to tie
the diagram clearly to the immutable revision used for IaC output.

## Decision

CloudCanvas will render SVG and PNG architecture diagrams deterministically from
an immutable, version-bound Architecture Document. The renderer will use
explicit versions for its layout rules, catalog data, and local asset set. It
will not use a browser screenshot or runtime provider-asset hotlinks.

UI-only layout fields may influence diagram composition but never deployment
semantics. Given the same normalized document and the same renderer, catalog,
and asset versions, repeated exports must be byte-stable or have an explicitly
documented deterministic normalization step.

A combined export will be able to contain:

- generated customer IaC;
- SVG and PNG diagrams;
- architecture and compiler metadata;
- a validation report; and
- an architecture summary.

GitHub publication will be able to include the diagram and reference it from
generated documentation. PDF export is deferred until after beta unless a later
decision changes its priority.

## Consequences

### Positive

- Diagrams are revision-bound, reproducible artifacts.
- Export does not depend on viewport state or external asset availability.
- IaC and explanatory artifacts can be reviewed together.

### Negative

- Renderer, layout, catalog, and asset versions become compatibility inputs.
- SVG and PNG output need golden and reproducibility tests.
- Font and rasterization choices must be controlled.

### Follow-up

- Specify renderer input normalization and artifact manifests.
- Define deterministic fallback rendering for unavailable provider icons.
- Add cross-platform golden evidence before diagram export is released.

## Alternatives Considered

- Capture the editor viewport. Rejected because output is not reproducible or
  reliably revision-bound.
- Generate diagrams from compiled IaC. Rejected because compilation may omit
  explanatory and UI layout information present in the source document.
- Require runtime provider URLs. Rejected because availability and content can
  change independently of the revision.

## References

- [ADR-0001](0001-versioned-architecture-graph.md)
- [ADR-0003](0003-deterministic-compiler-boundary.md)
- [ADR-0005](0005-export-without-deploy.md)
- [ADR-0008](0008-provider-icon-asset-pipeline.md)
- [System Overview](../architecture/SYSTEM_OVERVIEW.md)
