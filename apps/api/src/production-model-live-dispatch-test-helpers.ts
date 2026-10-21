import {
  getBedrockModelRegistrationV1,
  digestStructuredValue as digest,
  type ModelProviderHostSeedInvocationV3,
  type ModelProviderHostRepairSuccessorInvocationV4,
} from "@cloudmarkup/model-gateway";
import { bedrockGlobalPricingEvidenceV1Schema } from "./adapters/bedrock-global-pricing.js";
import { modelDispatchCostCeilingSchema } from "./adapters/model-platform-spend.js";
type Invocation =
  | ModelProviderHostSeedInvocationV3
  | ModelProviderHostRepairSuccessorInvocationV4;
/** Synthetic reviewed-price fixture; does not claim a live pricing observation. */
export function syntheticRepairDispatchPricing(invocation: Invocation) {
  const registered = getBedrockModelRegistrationV1(
    invocation.descriptor.modelId,
  );
  if (!registered || invocation.descriptor.inferenceProfileId === undefined)
    throw Error("Missing synthetic registered model");
  const price = registered.pricingSnapshot;
  const pricing = bedrockGlobalPricingEvidenceV1Schema.parse({
    contractVersion: 1,
    policyId: "cloudmarkup.bedrock-global-full-window.v1",
    accountId: "000000000000",
    environment: "beta",
    sourceRegion: "us-east-1",
    endpoint: "bedrock-runtime",
    serviceTier: "standard",
    offerUnit: "Units",
    currency: "USD",
    tokenDenominator: 1000000,
    publishedPricingReference:
      "https://platform.claude.com/docs/en/about-claude/pricing",
    pricingVersionId: invocation.descriptor.routing.pricingVersionReference,
    modelId: invocation.descriptor.modelId,
    modelVersion: invocation.descriptor.modelVersion,
    inferenceProfileId: invocation.descriptor.inferenceProfileId,
    offerId: price.offerId,
    offerTermsDigest: digest("synthetic-offer-not-live-evidence"),
    observedAt: price.validFrom,
    validFrom: price.validFrom,
    validUntil: price.validUntil,
    rates: {
      inputMicroUsdPerMillion: price.inputMicroUsdPerMillion,
      outputMicroUsdPerMillion: price.outputMicroUsdPerMillion,
      cacheReadMicroUsdPerMillion: price.cacheReadMicroUsdPerMillion,
      cacheWrite5mMicroUsdPerMillion: price.cacheWrite5mMicroUsdPerMillion,
      cacheWrite1hMicroUsdPerMillion: price.cacheWrite1hMicroUsdPerMillion,
    },
  });
  return pricing;
}
/** The real SDK, CountTokens arithmetic and retained SQL cap remain in use.
 * A synthetic full-window clock isolates these tests from real offer expiry. */
export function syntheticRepairFullWindowCost(actual: Invocation) {
  return modelDispatchCostCeilingSchema.parse({
    contractVersion: 1,
    invocationDigest: digest(actual),
    providerId: actual.descriptor.providerId,
    modelId: actual.descriptor.modelId,
    modelVersion: actual.descriptor.modelVersion,
    inferenceProfileId: actual.descriptor.inferenceProfileId,
    pricingVersionId: actual.descriptor.routing.pricingVersionReference,
    pricingVersionDigest: digest("synthetic-current-full-window-policy"),
    maximumCostMicroUsd: 49000000,
    validFrom: new Date(Date.now() - 60000).toISOString(),
    validUntil: new Date(Date.now() + 60000).toISOString(),
  });
}
