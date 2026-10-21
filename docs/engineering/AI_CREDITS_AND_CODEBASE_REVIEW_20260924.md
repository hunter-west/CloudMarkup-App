# AI credits, model routing, and codebase review (September 24, 2026)

## September 25 Claude credit implementation

The owner opened an AWS support case for GPT-6 Luna and Sol. Their account
agreements and inference profiles appear available, but minimal runtime calls
still return 403. The isolated branch keeps `global.anthropic.claude-sonnet-4-6`
for diagram proposals and opt-in source drafts. Proposal and source constants
remain separate so either can be changed with its own prompt, IAM, cache
provenance, and pricing review later. No GPT route is active in this
implementation.

The September 25 application-account offer confirmed Sonnet 4.6 Global Standard
rates of USD 3 input, USD 15 output, and USD 0.30 cache-read per million tokens.
Immutable price version `pricing_beta_sonnet46_global_20260925_v1` uses the
existing one-cent credit scale and 30% operating markup. The additive invocation
journal and canonical grant allocations reserve before each Bedrock call.
Validated provider token usage settles after useful output is stored; failure or
cancellation releases the hold. A temporary 100-credit ceiling is shown, with a
separate estimate and exact settled amount in authenticated proposal and export
job receipts. The estimate uses request context size and half the output limit;
it is approximate and does not count fixed system or tool-schema overhead. The
100-credit hold bounds the charge, and actual Bedrock usage determines the final
debit. An aged hold is reconciled when the organization checks its balance or
attempts another paid AI request. Historical free use is never charged.

The Stripe billing runtime remains sandbox-only. The credit ledger is
provider-independent, so metering does not rely on Stripe webhooks or credential
format. A reviewed live billing mode is required before live Stripe keys can be
used. No deployment, live Stripe call, or real customer debit was performed
here.

The sections below preserve the September 24 baseline and branch audit. They
describe the prior deployed state, not this isolated implementation.

## September 24 application behavior (historical)

The live beta diagram job and the legacy synchronous diagram endpoint call
`global.anthropic.claude-sonnet-4-6` through
`packages/model-gateway/src/beta-infrastructure-model.ts`. The optional
`ai-source-draft-v1` export calls the same model through
`beta-application-source-model.ts`; cached source drafts do not call it again.
These are the two enabled product AI features. The normal model gateway has
registered Sonnet 4.6, Opus 4.6, Sonnet 5, and Opus 5 routes, but production
admission has not promoted those routes. Do not count their test and evaluation
calls as customer-facing usage.

The credit display reads the canonical organization summary. Both enabled beta
model paths bypass the canonical reservation and ledger. Diagram jobs set
`reservationRequested: false`, and both Bedrock adapters discard Converse
`usage`. The current beta copy says previews do not deduct credits, matching
[ADR-0055](../adr/0055-functional-beta-infrastructure-assistant.md). Optional
source drafts were added by
[ADR-0057](../adr/0057-opt-in-beta-application-source-drafts.md) without
metering. Thus the reported unchanged balance is reproducible by code inspection
and is current policy, not a stale balance display.

## Credit scale and proposed transaction

The existing
[beta normalization policy](../../apps/api/src/beta-model-credit-normalization.ts)
already sets one credit to USD 0.01 of normalized cost, with a 30% markup on
provider cost. Exactly 400 credits have USD 4.00 nominal credit value. For a
billable USD provider cost `p` in microdollars, the canonical domain formula is
`ceil(p * 13 / 100000)` credits. This policy is not selected by either live beta
route. No historical use should be charged retroactively.

An estimated amount must be calculated from a current, pinned provider price and
the exact planned request, including system and tool schemas. It is an upper
bound or clearly labeled estimate, not a debit. A sufficient credit reservation
must precede every provider call, including retries. The settled amount must use
Bedrock's `usage` input/output/cache token counts and the same pinned price and
normalization policy. The durable result should expose both amounts. Missing or
ambiguous usage needs an explicit bounded policy and terminal evidence; a
mutable browser estimate cannot be used as authority. Release unused reserved
credits and reconcile cancellation, output-validation failure, publication
failure, duplicate delivery, and worker crash exactly once. The legacy
synchronous route must either use the same accounting boundary or be retired
with an explicit compatibility decision.

For illustration only, at the previously reviewed Sonnet 4.6 list rates of USD 3
per million input tokens and USD 15 per million output tokens, 10,000 input and
2,000 output tokens cost USD 0.06 from the provider and normalize to 8 credits.
A 20,000 input / 12,000 output source draft would cost USD 0.24 and normalize to
32 credits. These are not actual bills or safe reservation amounts. AWS
documents
[Converse response usage](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html),
and the
[Sonnet 4.6 Bedrock model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-4-6.html)
identifies the global inference profile. The prior reviewed Sonnet 4.6 offer
window in `apps/api/src/adapters/bedrock-reviewed-pricing-20260916.ts` expired
at `2026-09-23T00:00:00Z`. The owner then signed in with AWS SSO; profile
`cloudmarkup` was verified in the application account. A read-only September 24
Bedrock offer observation found the same Sonnet 4.6 global standard USD
3/15/0.30/3.75/6 input/output/cache-read/5-minute-cache-write/
1-hour-cache-write rates per million tokens. Sonnet 5's account offer lists USD
2/10/0.20/2.50/4 for the same dimensions. Both models were ACTIVE in the account
catalog. Bedrock offers report `Units`; the USD-per-million meaning is
corroborated by published model prices. This fresh read does not seed a
versioned database price or prove invocation quality. A read-only aggregate of
the beta database found existing credit grants, subscription projections, and
entitlement snapshots but no rows in either provider-pricing table. A reviewed
additive price seed and complete accounting path are required before activation.

## Model selection

| Use                                       | Current route                                               | Recommendation                                                                                                                                                                                            |
| ----------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Diagram proposals and incremental updates | Sonnet 4.6, up to 4,096 or 6,144 output tokens              | Keep until a schema-valid graph and command-preview evaluation shows another model is at least as reliable.                                                                                               |
| Opt-in application source drafts          | Sonnet 4.6, up to 12,000 output tokens                      | Compare Sonnet 5 on the actual workload corpus and source validation. The current account offer is one-third cheaper on input/output tokens; request bounds, runtime access, and quality need evaluation. |
| Normal assistant/evaluation routes        | Registered Sonnet/Opus variants, not promoted to production | Do not activate from a price comparison alone.                                                                                                                                                            |

[Anthropic's Sonnet 5 announcement](https://www.anthropic.com/news/claude-sonnet-5)
states a permanent USD 2 input / USD 10 output per million token list price as
of August 10, 2026.
[AWS's model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-5.html)
lists a global Bedrock inference profile. This suggests a possible one-third
list-price reduction relative to Sonnet 4.6. The current account offer also
lists one-third lower input/output unit prices; realized cost and quality on
this workload remain unverified. Opus has higher reviewed price and no
demonstrated need on these bounded paths. Haiku could be evaluated for simpler
future tasks, but neither current feature is a simple classification request.
Keep the provider, pricing, and quality decisions separately versioned.

## Branch reconciliation

`origin/main` was `6d69510e` after fetch. The independently verified
`codex/service-deletion-performance-20260924` tip `e1fa7039` was fast-forwarded
into local main and merged into the isolated credit review branch. The primary
checkout's unrelated `.codex/config.toml` edit was preserved. No remote push or
deployment was made.

Thirteen remote branches still have commits outside main's ancestry. Four
(`beta-export-credits-20260917`, `beta-export-publication-services-20260917`,
`beta-session-renewal-20260916`, and `desktop-release-record-20260922`) have
zero novel patches by `git cherry`; their changed content landed by equivalent
commits. The remaining tips are historical `beta-memory-runners`,
`beta-provider-restoration`, `ci-overhaul-20260924`, `deployment-cost-20260924`,
`desktop-dashboard-navigation-20260922`,
`desktop-service-configuration-20260922`, `full-beta-next-services`,
`full-beta-services`, and `m9-integration-20260924`. Main already contains
successor desktop, CI, and deployment releases, while the memory, provider, and
full-beta branches touch older migration, workflow, and product contracts. Novel
commit hashes alone do not establish that their old snapshots are safe to merge.
Each remaining patch needs a feature-by-feature comparison against main before
any selective port; a blanket merge can regress newer code.

## Size and cleanup priorities

The repository has 3,401 tracked files: 1,240 under `apps`, 996 under
`packages`, 460 under `testdata`, 344 under `docs`, 114 under `scripts`, 108
under `infra`, 74 under `services`, and 22 under `evals`. TypeScript is the
largest file type (1,820 tracked files). There are 178 execution-plan Markdown
files. No tracked `dist`, `coverage`, `node_modules`, or cache artifacts were
found. Large commercial persistence, gateway, domain, and model-sequence files
are substantive accounting and contract code, not generated waste.

Safe reduction order, subject to compatibility and test evidence:

1. Fold the two beta Bedrock adapters into a single usage-aware transport after
   both features have durable accounting; keep feature-specific prompts and
   schemas separate.
2. Retire the legacy synchronous proposal endpoint only after confirming public
   consumers and a versioned removal path. Its current unmetered bypass must be
   closed as part of the credit change.
3. Archive superseded execution plans only after checking inbound links and
   retaining the evidence required by STATUS, HANDOFF, and accepted ADRs.
4. Compare old branch tips by behavior; port any genuinely missing bounded
   feature, then delete redundant branch references. Remote branch cleanup does
   not itself shrink the tracked application.

No tracked code or history was removed in this review. Deleting large ledger,
schema, migration, contract fixture, or golden files without replacement would
break supported behavior or verification.
