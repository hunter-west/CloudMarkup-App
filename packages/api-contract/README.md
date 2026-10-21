# `@cloudmarkup/api-contract`

## Responsibility

Own the strict runtime schemas, canonical operation registry, generated OpenAPI,
and browser-compatible typed client for the Cloud Markup HTTP API.

The v1 surface covers:

- process health and readiness;
- current principal with canonical organization role evidence, and presentation
  preferences;
- organizations, memberships, projects, and project environments;
- mutable draft Architecture Documents and immutable revisions;
- validation, generation, and export jobs;
- artifacts, download descriptors, integrations, and safe audit summaries.

## Conventions

- Product routes live under `/v1`; health and readiness carry an explicit
  response contract version.
- Successful payloads use `apiVersion: "v1"`. Errors use one stable envelope
  with a code, safe message, correlation ID, and optional field issues.
- List operations use cursor pagination with `page[cursor]`, `page[limit]`,
  explicit `filter[...]` keys, and a bounded sort enum.
- Mutable versioned resources use strong ETags and `If-Match`.
- Consequential POST operations require an `Idempotency-Key`.
- The canonical Zod schemas drive request/response validation, OpenAPI, and
  client input/output types. Run
  `pnpm --filter @cloudmarkup/api-contract generate:openapi` only when
  intentionally updating the reviewed artifact; `verify:openapi` fails on drift.

The typed client is transport-injected. A browser transport may add its
authorization token without adding authoritative actor or tenant IDs to request
bodies.

Presentation preferences include only Guided/Professional mode and contextual
learning. They remain outside the Architecture Document and deliberately omit
panels, tabs, hover, selection, viewport, and other transient editor state.

The commercial extension supplies strict customer-safe model
estimate/lifecycle/usage-summary schemas and separate restricted internal
usage-event, pricing-version, and normalization-policy schemas. Safe payloads
omit provider cost, operating buffer, credit conversion, margin, raw prompt, and
raw response fields.

## Non-goals

This package does not own domain behavior, authorization policy, persistence,
framework handlers, authentication vendors, commercial calculation or credit
authority, cloud adapters, job execution, compiler or renderer execution, or
deployment.

## Solution export target compatibility

The existing v1 export request selects Terraform or CloudFormation. Responses
use the corresponding eight-stage sequence and target-specific validation
Evidence. The historical Terraform sequence is unchanged; CloudFormation
substitutes `cloudformation-validation` and admits its structured JSON template
media type for artifact files and previews. Opposite-target progress,
diagnostics and Evidence are rejected. Local CloudFormation validation is not
AWS deployment evidence. Older readers may reject the additive response values;
servers must not enable CloudFormation execution for those readers or mislabel
its result as Terraform. This contract change grants no execution or commercial
entitlement.

## Generated artifact storage

Checked JSON artifacts use compact JSON with a trailing newline; edit their
typed producers and regenerate them. Exact generator drift checks and complete
parsed contract tests protect their content. Pretty-print a local copy for
inspection. Canonical document serialization and its versioned hashes are
unchanged.
