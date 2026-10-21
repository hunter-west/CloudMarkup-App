# ADR-0052: Evaluate typed beta planning through its actual command operation

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Proposed
- **Date:** 2026-09-15
- **Owners:** Cloud Markup engineering
- **Supersedes:** None
- **Superseded by:** None

## Context

The beta planning request uses operations.propose and deterministic command
review. The basic-API and authenticated-notes evaluation cases instead select
architecture.propose and workload.propose. Their V1 responses contain outlines
without resource configuration, Graph Commands, typed application contracts or
workload behavior. Those outlines cannot be evaluated as executable commands.
The existing command response can carry the typed documents and is the path used
by production-ai-planning-request.ts and solution-planner.ts.

Source 1.6.0 already preserves required JWT authentication for the basic API. No
genuine passing report has been issued for either incomplete case. Existing
source versions, policies and operation provenance must remain unchanged.

## Decision

Add a separately exported source 1.7.0 derived from 1.6.0. Change only the two
cases required operation to operations.propose and their resulting authority,
case, dataset and source commitments. Preserve role, requirements, both
assistance preferences, expected outcomes, every quality dimension and
operational budget. The other 19 cases remain identical. Preserve the earlier
files and public exports; existing policy factories retain their original source
pins.

The two successor cases must execute the actual typed response through domain
commands, immutable revision generation, fixed native compilation/build/tests,
ownership checks and customer workflow validation. An outline, unrelated
template, schema-only success or synthetic grade cannot satisfy them. A future
policy must explicitly bind this source and the actual operation/prompt/schema
tuples. Source publication alone grants no invocation, report or promotion.

Do not promote architecture.propose or workload.propose using these command
results. Those separate operations retain their historical semantics and need
their own evidence if a product path enables them. The beta decision covers
typed planning of the two concrete applications, not all outline capabilities.

## Consequences

### Positive

- Evaluation covers the command operation the beta actually uses.
- One actual planning call can propose the complete typed candidate, avoiding an
  additional outline call solely to repair a mismatched evaluation contract.
- Security, ownership and executable-quality requirements are retained.

### Negative

- Historical results cannot be transferred to the successor. It requires new
  request builders, validators, policy bindings and genuine evaluation.
- A new versioned source mirror is retained as intentional compatibility data.

### Follow-up

- Verify exact two-case changes and unchanged historical policy/source bytes.
- Complete trusted request construction and actual candidate build validation.
- Preserve current tenant/operator, full CountTokens, canonical accounting and
  USD 50 monthly dispatch fences; temporary unaccepted content remains in RAM.
- Adopt a successor policy only with its complete actual receipts and reviewed
  activation path. Rollback keeps that policy and host unregistered; no database
  history or customer record is rewritten by this source change.

## Alternatives considered

### Add typed fields to the existing outline responses

This changes a public output contract and requires prompt/parser compatibility
work. Reconsider if the product actually needs a typed outline operation. The
existing command operation already represents the required beta product path.

### Execute an outline followed by another planning call

This preserves the old selected operation but needs mixed-operation lineage,
extra accounting and another charged call. Reconsider for a product workflow
that uses the outline itself; it adds no required beta behavior here.

### Treat outline validation as application success

Rejected: it does not establish typed semantics, authorization, persistence,
build behavior or ownership preservation of the actual returned candidate.

## References

- [Model gateway boundary](0034-provider-neutral-model-gateway.md)
- [Evaluation and admission](0035-deterministic-ai-evaluation-and-runtime-admission.md)
- [Existing bounded repair sequence](0050-preissued-ai-evaluation-sequence-lineage.md)
- Full beta gaps
- Execution plan
