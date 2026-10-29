# Complete editor-tour resume and missing catalog artwork

- Milestone: M9 controlled beta
- Workflows: onboarding and catalog identification
- Status: blocked
- Owners: catalog/editor follow-on; release and live browser owners remain
  separate

## Goals

- Resume the exact editor-tour step after remount, preserving dismissal,
  restart, completion and assistance mode behavior.
- Replace the ten audited missing icon mappings using the existing approved
  official package and accurate exact-resource/service-family artwork.
- Keep the sealed `07ebcc3` release packet unchanged and deliver a separately
  composable follow-on with focused proof.

## Context and constraints

The [initial audit](catalog-canvas-tutorial-20261029.md) records the two gaps.
The existing actor-scoped preference adapter owns tutorial progress; progress
never enters graph commands or server presentation preferences. Existing v1
preference records must remain readable without losing choices. Artwork follows
[ADR-0019](../../adr/0019-product-owner-governance-for-official-provider-icons.md),
the checked source approval and existing import/promotion/integrity tooling.
Reuse canonical assets where mappings agree. No invented provider imagery,
dependency installation, aggregate/CI run, browser control or deployment.

## Checkpoints

- [x] Inspect storage and asset conventions; prepare bounded changes.
- [x] Prove interrupted/resumed, dismissed/restarted and actor-isolated
      behavior.
- [x] Review the tutorial source and prepare the separate icon-review packet.
- [ ] (current) Obtain the required mapping approval, then promote and run
      asset/build/bundle admission.

## Migration and security impact

Use an independent versioned actor-scoped progress key so existing strict v1
experience records, server preferences and architecture documents are unchanged.
Only known tutorial step identifiers may restore. Storage failures preserve the
current session. Icons remain local, inert supplementary SVGs admitted by the
existing source, manifest and bundle checks; credentials, access and providers
are unchanged.

## Validation and stopping condition

Extend owning lifecycle tests rather than multiplying modes or viewports. Run
focused preference/tutorial checks, source/asset tests, the relevant web build
and exact-once bundle validation. Complete only after passing focused evidence,
reviewed changes and a sealed commit/patch; report exact blockers without
holding the independent navigation release.

## Handoff

The editor restores known step IDs through its existing actor-scoped preference
adapter, using a separate `:editor-tour-step.v1` local key. Existing strict v1
preference records are unchanged. Completion/dismissal clear progress; restart
returns to Add. Unsupported IDs fall back to Add, storage failures keep the
session usable and mode switches retain progress. No graph/hash, server
preference, API or permission changes are made.

Focused proof: 14 passed / 5 excluded by the selector in 15.81 seconds: the
owning 12-case preference suite, the existing restart case and one new
interruption/remount case. The new UI case passed in 0.36 seconds and preserves
the content hash through remount and mode changes, then proves dismissal remains
effective after another remount. Existing preference cases also cover actor
isolation, unknown-step fallback, restart and storage failure. Case delta: +1,
criticality 8/10 for the requested interrupted core onboarding workflow. A
follow-up 12-case preference run passed in 5.78 seconds after extending its
storage-failure assertion. Web type-check passed in 29.26 seconds. Lint
initially found one void-arrow style error in the probe; it was corrected and
the failed file rerun successfully. Changed-file formatting, local links and
diff were reviewed before sealing the tutorial patch.

Icon candidates use the exact existing local archive. Its SHA-256 matches the
checked `699fe7a2481aa712b6b74faff0aaab6382d3bb7243bba3abd3ba909d6bf7b912`
source approval. The importer admitted 55 mappings from 41 canonical SVGs with
zero missing candidates, preserving existing mappings and explicitly sharing
IAM, Fargate and WAF family artwork. Selected-source checksum:
`8b9c401b107a0f18c0d552b0b1c327c71aa2d8d6fe372f9ff13588b68435d756`. The
eight-family contact sheet was rendered and visually inspected. Candidate
manifest, exact mapping and preview remain outside tracked source in the
separate icon-review packet.

The promotion **dry-run was rejected before repository writes** by
`assertApprovalRecordReuse` in `scripts/provider-icons/promotion-core.mjs`:
"changes to approved source, surfaces, or mappings require a new product-owner
approval record." The existing October 6 record cannot be reused for these ten
new mappings. A reviewable preview and exact mappings are prepared, and an
explicit owner approval request is pending. No approval was fabricated and no
denied operation retried. Asset version 1.21.0 and all checked repository
artwork remain unchanged; 1.22.0 is only an external candidate. Promotion and
mandatory production build/exact-once bundle checks remain pending that record.

The navigation release must not wait for this follow-on. The independently
verified tutorial patch can integrate separately; live acceptance and full
integrated admission remain with their existing owners.
