# Complete editor-tour resume and missing catalog artwork

- Milestone: M9 controlled beta
- Workflows: onboarding and catalog identification
- Status: completed locally; integrated release and live acceptance pending
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
- [x] Obtain the required mapping approval and promote asset set 1.22.0.
- [x] Complete asset/build/bundle admission and seal the separate icon patch for
      release integration.

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

The initial promotion **dry-run was rejected before repository writes** by
`assertApprovalRecordReuse` in `scripts/provider-icons/promotion-core.mjs`:
"changes to approved source, surfaces, or mappings require a new product-owner
approval record." The existing October 6 record cannot be reused for these ten
new mappings. This was repository governance, not a tool-policy denial.

Hunter West approved the exact ten mappings at 21:37:11 UTC on October 29, 2026,
replying "Yes approved" to their use alongside visible names in the app,
diagrams and documentation solely to identify AWS resources without implying
endorsement. The new checked record `CC-AWS-ICONS-OWNER-APPROVAL-2026-10-29`
records that approval. The October 6 record was not reused. Source metadata,
approved surfaces and accessibility contract remain unchanged.

| Definition             | Official service-family artwork    |
| ---------------------- | ---------------------------------- |
| EC2 instance           | Amazon EC2                         |
| ECR repository         | Amazon Elastic Container Registry  |
| ECS cluster            | Amazon Elastic Container Service   |
| ECS service            | AWS Fargate                        |
| ECS task definition    | AWS Fargate                        |
| IAM instance profile   | AWS Identity and Access Management |
| KMS key                | AWS Key Management Service         |
| Secrets Manager secret | AWS Secrets Manager                |
| WAFv2 ALB association  | AWS WAF                            |
| WAFv2 web ACL          | AWS WAF                            |

The existing promotion tool admitted asset set 1.22.0 with 55 approved mappings,
41 canonical SVGs and zero placeholders. Its asset digest is
`sha256:a6781643b5d9278430e9e510d0f082f01fc89fdce9f838d85d6b6bb24f7c98b0`. The
exact delta matches the reviewed candidate packet. All 45 earlier approved
entries and their SVG bytes are unchanged, as are the catalog digest and
semantic definitions. Seven new canonical files supply the ten mappings; IAM,
Fargate and WAF aliases share canonical assets. WAF proof status is unchanged.

The ordinary sandbox blocked the promotion's atomic directory rename with
Windows EPERM. Inspection confirmed complete rollback before a narrowly admitted
retry completed. The admission tests similarly needed their temporary
rename/link fixtures admitted; all 74 passed in 5.54 seconds afterward. No
governance assertion was removed or weakened. The dependency CLI initially
attempted automatic installation because the isolated checkout reuses an
existing same-lockfile cache. Its supported process-only
`pnpm_config_verify_deps_before_run=warn` setting kept that verified cache in
use; no dependency installation or source configuration change was needed.

The production web build passed all 15 tasks in 1 minute 58.48 seconds, with
Vite's existing large-chunk warning. Static security tests passed all 11 cases
and checked the public workflows, generated source and Terraform fixtures.
Secret scanning found no high-confidence patterns in 3,913 text files, with
eight non-text files explicitly skipped. The read-only dependency audit passed
the high-severity threshold and reported nine moderate advisories. Its first
sandbox attempt failed DNS resolution; the admitted read-only retry completed.
No dependency or advisory suppression was changed.

The asset lint and catalog/artifact/registration integrity checks passed. The
exact-once production bundle check found all 41 approved canonical assets
exactly once: 121,059 provider-asset bytes across 99 bundle files. The owning
six-case web registry suite passed in 72.96 seconds (0.15 seconds of assertions;
57.77 seconds of environment setup). The icon patch adds zero test cases:
existing admission cases protect the SVG/source trust boundary, canonical
aliases and atomic promotion/rollback; registry cases protect approval, catalog
binding and fail-closed aliases. These are distinct core integrity/security
risks meeting the 8/10 threshold. Changed-file formatting, all 335 Markdown
files' local links and `git diff --check` passed. Lint, audit and documentation
check timings were not separately measured. The complete diff was reviewed;
there are no unresolved high-priority findings in this bounded patch.

Raw logs, promotion/delta receipts, the immutable earlier review packet and
preview stay outside tracked source. The earlier `07ebcc3` and exact-step resume
patches remain sealed unchanged. This icon change is separately composable on
the tutorial follow-on; the release owner owns its combined admission and
integration. The sole browser owner should verify the ten definition-level
mappings where exposed, including visible service names and shared family
artwork, against the exact deployed revision. Local bundle admission does not
establish live acceptance or support for additional resources.

The navigation release must not wait for this follow-on. The independently
verified tutorial patch can integrate separately; live acceptance and full
integrated admission remain with their existing owners.
