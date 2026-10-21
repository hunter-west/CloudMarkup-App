// AWS ListFoundationModelAgreementOffers observations in us-east-1.
// Only five standard GLOBAL token dimensions retained; no agreement tokens,
// signed legal URLs, credentials, model responses, or customer data.
// USD/million: https://platform.claude.com/docs/en/about-claude/pricing
// Historical model registrations retain their original evidence windows.
export const reviewedBedrockPricing20260916 = [
  {
    pricingVersionId: "cloudmarkup.pricing.sonnet46.global.d2026-09-16.v1",
    modelId: "anthropic.claude-sonnet-4-6",
    observedAt: "2026-09-16T13:04:55.970Z",
    offerTermsDigest:
      "sha256:16f8aa4ed3f4cd71b193b3b01a20b9a4e08296a34d19fdedeb5dce2a3a638a15",
    pricingSnapshot: {
      offerId: "offer-ldnd26nhxx676",
      validFrom: "2026-09-16T13:04:55.970Z",
      validUntil: "2026-09-23T00:00:00.000Z",
      inputMicroUsdPerMillion: 3000000,
      outputMicroUsdPerMillion: 15000000,
      cacheReadMicroUsdPerMillion: 300000,
      cacheWrite5mMicroUsdPerMillion: 3750000,
      cacheWrite1hMicroUsdPerMillion: 6000000,
    },
  },
  {
    pricingVersionId: "cloudmarkup.pricing.opus46.global.d2026-09-16.v1",
    modelId: "anthropic.claude-opus-4-6-v1",
    observedAt: "2026-09-16T13:04:58.577Z",
    offerTermsDigest:
      "sha256:9926dfee95a7660ddec1ceed00e94b25f3ab6c2e394f421bfc6c9c7b3238985d",
    pricingSnapshot: {
      offerId: "offer-ee7a27hh4hr62",
      validFrom: "2026-09-16T13:04:58.577Z",
      validUntil: "2026-09-23T00:00:00.000Z",
      inputMicroUsdPerMillion: 5000000,
      outputMicroUsdPerMillion: 25000000,
      cacheReadMicroUsdPerMillion: 500000,
      cacheWrite5mMicroUsdPerMillion: 6250000,
      cacheWrite1hMicroUsdPerMillion: 10000000,
    },
  },
] as const;
