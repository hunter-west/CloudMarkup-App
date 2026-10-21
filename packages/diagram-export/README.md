# `@cloudmarkup/diagram-export`

This package renders an immutable Cloud Markup Architecture Document as a
canonical accessible SVG and a bounded PNG derived from that SVG. It consumes
strict catalog and reviewed-icon data through its public request contract and
does not inspect React, editor state, browser viewport state, arbitrary
filesystem locations, networks, credentials, Terraform, or deployment systems.

Presentation and technical profiles share one canonical semantic scene. The
profile controls only reviewed detail, labels, legend content, and optional
stable deployment identifiers. Saved positions come only from the immutable
document; deterministic layout is versioned separately.

PNG rendering uses pinned `resvg-js` with pinned local Inter font assets and
system font loading disabled. Provider icons must be approved local SVG assets
whose exact bytes and digests match the supplied asset manifest.

The v1 contract accepts at most 1,000 nodes, 4,000 semantic edges, 2,048 local
icons, and 256 characters per rendered label. Output is bounded to 8,192 pixels
per dimension and 32 megapixels; SVG and PNG bytes are capped independently.
Graphs that remain within the hard limits use deterministic fit-to-content and
emit explicit label/detail-reduction warnings rather than clipping silently.

`generateDiagramExport()` returns canonical SVG and optional PNG bytes plus a
strict artifact manifest for `diagram/architecture.svg`,
`diagram/architecture.png`, and `diagram/README.md`. `verifyDiagramExport()`
recomputes file and artifact digests, validates SVG safety and PNG dimensions,
and rejects substitution. Neither service reads or writes a repository.

```powershell
pnpm check:diagram-export
```

The historical `diagramRendererV1Pin` and default factory retain version 1.0.0.
The explicit `diagramRendererSfntV1Pin` / `createSfntDiagramExportService`
successor is version 1.1.0 and uses digest-verified TrueType reconstructions of
the same locked Inter fonts. Its caller supplies immutable local font paths; no
filesystem traversal or system-font discovery is permitted. A request and its
immutable revision must pin the selected version exactly. Production
CloudFormation exports use the successor because native Resvg cannot render the
historical WOFF2 files as font files. Original pins are retained for historical
compatibility and are not silently upgraded.
