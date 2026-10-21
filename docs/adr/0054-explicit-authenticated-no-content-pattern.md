# ADR-0054: Explicit authenticated no-content application pattern

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Proposed
- **Date:** 2026-09-17
- **Owners:** Cloud Markup engineering
- **Supersedes:** None
- **Superseded by:** None

## Context

The basic typed-planning case requires a minimal JWT-protected API without
persistent application data. Existing notes source requires a data entity and
DynamoDB binding; inventing those to obtain a passing build would change the
requested application. The candidate uses an explicit empty HTTP 204 response
until the user declares business behavior.

## Decision

Add the independently pinned HTTP_NO_CONTENT_RELEASE_V1 generator, template and
pattern tuple. It supports one declared GET path, no business input or output,
no persistence or external actions, and exact behavior, authorization and test
contracts. Its current catalog is the reviewed AWS 0.16.0 catalog. Historical
notes and curated-event tuples, source bytes and compatibility remain intact.

Require the typed API Gateway payload-v2 relationship, required JWT setting and
one exact Cognito issuer and audience. Generated source checks verified
principal/role claims from the authorizer context and rejects undeclared routes
or input. Token signature, issuer, audience and expiry validation belong to the
compiled managed authorizer. Local handler tests cannot prove hosted token
validation.

The generator remains pure and emits source data, checksums, provenance and an
ownership-aware change set. Modified generated files remain explicit conflicts.
Source coverage retains pending application build and security requirements. The
isolated build runner admits only the complete exact tuple with its three pinned
development dependencies and no runtime dependencies. Existing policies are
unchanged; adopting this dependency set requires an explicit matching build
policy. User-source execution and AI scaffold admission remain unchanged.

The fixed local integration harness executes only this deterministic fixture
using pinned repository Node.js/TypeScript/Vitest, bounded output/time, a clean
environment, no shell, no package installation and no SDK stubs. It cleans its
exclusive workspace. Production execution retains the existing container,
network, credential, resource and integrity boundaries.

## Consequences

The basic API gains a precise deterministic behavior without a database or
invented business logic. The additional tuple and dependency profile need their
own golden, negative compatibility, source ownership and native build evidence.
Compiler 1.2.0 adds this exact tuple; historical 1.1.1 rejects it. The successor
also emits empty normalized lists as arrays and preserves typed parent
relationships through the optional strict TypeScript parent field. Supplied
parent relationships must match canonical Architecture. Current-catalog API
invocation self-scope requires exact graph/configuration/provenance agreement.
There is no database migration or tenant-boundary change. Disabling selection of
this tuple is the rollback; existing tuples stay available.

Local synthetic normalization, source execution and both renderer checks pass.
Actual typed-planning grounding, immutable candidate validation, native receipt
issuance, customer workflow validation, policy/report and hosted acceptance
remain separate work. This candidate adds no model invocation, evaluation score,
report, promotion or deployment authority. Frozen evaluation source 1.7.0 is
unchanged.

## Alternatives considered

### Reuse the notes pattern

Rejected because it requires data behavior the minimal API does not declare.

### Generate arbitrary status or business responses

Reconsider when the user supplies explicit versioned behavior and response
contracts. Arbitrary inference is outside this narrow pattern.

### Return source without executable checks

Source is useful for review, but it cannot satisfy application build, security,
managed-authorizer or actual AI evaluation evidence.

## References

- [Workload and build boundaries](0017-versioned-workload-behavior-and-build-boundaries.md)
- [Typed beta evaluation](0052-typed-beta-planning-evaluation.md)
- Beta completion plan
