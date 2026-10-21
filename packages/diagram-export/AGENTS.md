# Diagram export package instructions

- Keep rendering deterministic, provider-neutral, and independent of React,
  editor/browser viewport state, filesystem traversal, network, credentials,
  Terraform, deployment, and mutable drafts.
- Treat Architecture Document, Solution Revision, catalog projection, icon
  manifest, saved positions, and export settings as untrusted versioned input.
  Parse strictly, sort explicitly with UTF-16 ordering, and fail closed on
  identity, digest, asset, or semantic mismatch.
- SVG is canonical output. It may embed only reviewed local sanitized SVG asset
  fragments and must contain no script, event handler, remote URL,
  `foreignObject`, local path, secret, prompt, or unstable identifier unless
  explicitly allowed by the technical profile.
- PNG is a bounded derivation from canonical SVG using the pinned renderer and
  bundled pinned font. Do not use a browser screenshot or system fonts.
- Profiles may change detail and presentation but never nodes, edges, direction,
  boundaries, lifecycle truth, or relationship semantics.
