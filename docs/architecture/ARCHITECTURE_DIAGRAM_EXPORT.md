# Deterministic architecture diagram export

Status: Prompt 33A implemented at the local immutable-revision workflow
boundary. Hosted execution, publication, CLI, pull-request automation, PDF, and
deployment remain outside this boundary.

## Source of truth and service boundary

`@cloudmarkup/diagram-export` is a provider-neutral, synchronous service. Its
strict request contains the exact Architecture Document v3, Solution Revision
manifest, provider catalog, approved icon-set bytes and digest, renderer/layout
pins, profile, theme, output dimensions, and scale. The workflow derives this
request from the same immutable source bundle used by compilation and
application generation.

The renderer does not import React or editor code and cannot observe selection,
hover, panels, minimap, scroll, zoom, assistance mode, browser viewport, local
paths, credentials, network, Terraform, or deployment state. Saved coordinates
are read only from the immutable Architecture Document; otherwise the versioned
deterministic layout is used. Collection order is normalized by stable graph
identities and UTF-16 ordering.

## Canonical scene and profiles

One canonical semantic scene contains resources, generated-resource state,
stable connection docks, semantic relationships, boundaries, provider/region,
coverage/readiness, and allowlisted configuration summaries. Presentation and
technical profiles project different reviewed detail from that same scene; the
node and edge identity sets must remain equal.

The presentation profile favors readable service labels, restrained summaries,
semantic edge labels only where useful, a compact legend, and a clean approved
background. It never includes stable deployment identifiers. The technical
profile adds relationship/configuration detail, generated-resource distinction,
coverage/readiness, a complete legend, and optional stable deployment
identifiers. Neither profile emits internal diagnostics, unstable IDs, secret
values, or arbitrary configuration by default.

Parallel semantic edges use deterministic lanes so relationships do not
overwrite one another. Fit-to-content derives explicit SVG dimensions and
`viewBox`; no browser camera or screenshot is involved.

## Assets, fonts, and formats

SVG definitions contain only locally approved provider icons whose normalized
bytes match the owner-approved icon manifest. Unknown or unavailable icons use
the reviewed neutral fallback. The output has an accessible title and
description, deterministic IDs/order, XML-escaped labels, explicit dimensions,
embedded local Inter fonts, and no script, event handler, foreign object, remote
URL, signed URL, or hidden local path.

PNG is produced only by pinned `@resvg/resvg-js@2.6.2` from the canonical SVG.
Pinned `@fontsource/inter@5.3.0` 400/600 WOFF2 bytes are loaded explicitly and
system fonts are disabled. The PNG manifest records its exact dimensions and
scale; verification checks the IHDR dimensions and complete checksum.

V1 permits `svg`, `png`, or `svg-and-png`, three approved light/transparent
backgrounds, scale 1-4, a maximum 8,192 pixels per dimension, 32 megapixels,
1,000 nodes, 4,000 edges, 2,048 icons, and 256 characters per label. SVG is
bounded to 8 MiB and PNG to 64 MiB. Inputs beyond hard limits fail closed.
Within the hard bounds, fit/detail reduction emits stable warnings such as label
truncation or minimum-readable-scale instead of silently clipping.

## Workflow and package integration

Prompt 33 orchestration adds `render-diagram` after Terraform validation and
before final package assembly. The checkpoint pins renderer/profile/layout,
catalog/icon, architecture/revision, dimensions, warnings, files, and artifact
digest. Cancellation is checked before and after rendering; deterministic input
or asset failures are permanent, while transport/persistence failures retain the
existing retry classification.

The independently verified combined ZIP contains:

```text
diagram/
  architecture.svg
  architecture.png
  README.md
```

Every diagram path is `generated-replaceable` and carries source revision,
renderer, catalog/icon, checksum, semantic checksum, size, media type, and
provenance. The root README embeds the GitHub-compatible relative path
`diagram/architecture.svg`. The solution manifest contains the complete diagram
artifact, dimensions, profile, warnings, generation coverage, Evidence/external
stage summary, and full file checksums. Export verification re-hashes the
artifact, requires exact file-set parity, and rejects SVG/PNG substitution.

The API binds diagram settings into the immutable workflow request and approved
target-settings digest. The shared export page offers the two profiles, approved
background, scale/dimensions, technical identifier control, immutable- revision
wording, warnings, and a safe image preview fetched through the same bounded
tenant/project/artifact file-preview contract. Guided and Professional modes use
identical controls and actions; only help copy differs.

## Security and verification

Diagram labels are sanitized display data, not a source for IaC or generated
application semantics. The renderer rejects control characters, scripts,
external references, malicious icon markup, oversized graphs/files/pixels,
unknown profile fields, digest mismatches, and substituted output. SVG preview
uses an image data URL rather than injecting markup into the page.

Focused coverage includes repeatability, equivalent collection order, visual and
viewport independence, profile semantic parity, parallel edges, malicious and
very long labels, external URLs, approved provider icons, hard size limits,
SVG/PNG checksum and dimension substitution, manifest/ZIP binding, root relative
links, assistance-mode parity, preview, and authenticated complete-package
download.

```powershell
pnpm check:diagram-export
pnpm check:solution-export
pnpm check:solution-export-workflow
pnpm test:e2e:solution-export
```

Prompt 33A does not add PDF, tiled output, a second diagram DSL, browser
screenshots, repository writes, CLI/pull-request workflows, credentials,
uploads, plan/apply, or deployment. Prompt 33B owns the CLI and pull-request
verification boundary.
