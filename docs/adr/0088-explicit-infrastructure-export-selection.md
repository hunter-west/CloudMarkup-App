# 0088: Explicit infrastructure delivery for saved application patterns

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- Status: Proposed
- Date: 2026-10-02

## Context

Built-in event templates save reviewed `complete-supported-pattern` workloads.
The hosted CloudFormation profile has no application generator/build authority.
Rewriting saved workloads to `infrastructure-only` would change immutable
meaning; allowing their normal export path would invoke unavailable application
stages.

## Decision

Add an optional closed `infrastructure-only-v1` application delivery selection
to the durable workflow request. Only the hosted policy selects it, for verified
workloads whose modes are infrastructure-only or complete-supported-pattern and
whose immutable inputs are eligible for infrastructure compilation. The worker
independently checks eligibility and source equality, compiles the original
bytes with the original manifest and pins, and explicitly skips application
generation and builds. Package evidence preserves original application contracts
and states that application code was omitted and remains required.

Requests without the selection retain their existing behavior. A selection
cannot be combined with AI source or application build inputs. Unknown
selections reject. The public create-job request does not gain a
caller-controlled bypass. Tenant, entitlement, cancellation, worker ownership,
compiler, and download bounds remain.

## Alternatives and consequences

Changing template modes would also affect saved revisions and generation intent.
Removing host guards would enter an unavailable application pipeline. A separate
compiler projection would require new provenance and cross-language contracts.
The explicit workflow selection avoids these changes, but adds compatibility and
rollback obligations for durable queued requests. Deployment rollback must drain
or cancel new-selection jobs before restoring a worker that rejects the field.

An exact synthetic built-in SQS fixture is exported from the AWS provider's test
assets and checked against the actual constructor. Newly created SQS documents
resolve their reviewed role/log/queue relationships through existing provider
and domain commands, retaining canonical generated-policy ownership and
source-edge provenance. A deliberately stripped-policy negative remains
rejected. Native positive proof uses the exact constructor fixture and
production revision-freeze builder through both compiler targets and complete
guarded infrastructure packaging. Persistence/authority ports remain synthetic;
actual durable/download acceptance is pending. Existing saved graphs are not
repaired or migrated. Real-app acceptance uses a fresh project from the repaired
template and new revision after delivery. Catalog versions, compiler enforcement
and provider-neutral meaning remain unchanged. Reconsider this selection if
hosted application builds become supported.

## Evidence and review

The execution plan owns implementation and negative, compatibility, and
reproducibility checks. Acceptance remains a deliberate coordinator review
outcome; full release checks wait for the shared verification window.
