# ADR-0090: Cheap draft admission with complete ready verification

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Proposed; locally implemented for release-owner review
- **Date:** 2026-10-05
- **Owners:** Cloud Markup product and platform
- **Supersedes:** ADR-0080 draft feedback jobs only; its other decisions remain
- **Superseded by:** None

## Context

The owner requested correction of wasted CI work before the next deployment.
Drafts already defer builds, test shards, browser checks and native proofs, but
still start scope classification, applicable lint/documentation and security
jobs. Their final gate correctly refuses merge admission regardless of those
results. Repeated intermediate pushes therefore pay for feedback the owner can
obtain through existing local checks.

## Decision

Draft PRs run only the existing dependency-free `Quality gates` refusal. All
eight other CI job definitions require a non-PR event or an explicitly
serialized JSON boolean `false` draft state. Missing, null and string review
states remain ineligible. Local affected checks provide development feedback.

The complete ready profile remains unchanged, including security and the
existing documentation-only classification. Ready and converted-to-draft events
remain explicit; existing PR concurrency cancels obsolete work. Main delivery's
reusable CI, manual and scheduled profiles, fresh exact-source native proofs,
same-run bundles, Development/OIDC controls and the Actions spending cap remain.
No previous ready result or skipped draft dependency can supply admission.

This is a scoped replacement of ADR-0080's draft feedback policy. Its release,
generated-contract, fixture and compatibility decisions remain historical and
unchanged. The implementation plan records verification and integration
ownership.

## Consequences and alternatives

Each draft push avoids three runner jobs: classification, applicable
lint/documentation and security. The cheap refusal remains deliberately failed
until ready. This removes hosted draft feedback; contributors must run affected
checks locally and mark ready only after those pass. Hosted security still
blocks ready and release admission. Historical raw runner time is evidence of
opportunity, not measured future billing savings.

Keeping the existing feedback jobs preserves immediate hosted feedback but
retains the demonstrated repeated setup cost. Removing the draft gate would make
an incomplete run look admissible; that alternative is rejected. No cross-run
result reuse, new gate, permission change, test removal or workflow redesign is
introduced.

No product, tenant or database contract changes. Roll back the draft guards,
workflow validator, regression tests and current contributor wording together.
The separate backend resource settings can be reverted independently; test
selection, assertions, isolation and production deadlines are unchanged.
