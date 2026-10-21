import {
  modelLiveSequenceRuntimeAdmissionRequestV4Schema,
  modelLiveSequenceRuntimeAdmissionDecisionV4Schema,
  modelLiveSeedRoutingDecisionV3Schema,
  modelRoutingRequestV1Schema,
} from "@cloudmarkup/schemas";
import { syntheticSeedRuntimeFixtureV3 } from "./model-live-seed-runtime-test-helpers.js";
import { rehashSequenceTest as rehash } from "./model-live-sequence-test-helpers.js";
import { digestStructuredValue as digest } from "./security.js";
import type { ModelLiveSeedRuntimeExecutionInputV4 } from "./model-live-seed-runtime-execution.js";

/** Comparison data only, rebuilt from a synthetic historical fixture. None of
 * these values is an issued input, canonical estimate or execution authority. */
export function syntheticSeedSequenceRuntimeFixtureV4(): ModelLiveSeedRuntimeExecutionInputV4 {
  const { input } = syntheticSeedRuntimeFixtureV3();
  const original = input.commercialRequest.plannedCalls[0];
  if (!original) throw Error("Missing synthetic first call");
  const calls = [
    {
      ...original,
      minimumUsage: {
        ...original.minimumUsage,
        inputUnits: 100,
        totalUnits: 100,
      },
    },
    {
      ...original,
      minimumUsage: { ...original.minimumUsage, inputUnits: 0, totalUnits: 0 },
      maximumUsage: {
        ...original.maximumUsage,
        inputUnits: 200,
        totalUnits: 1200,
      },
    },
  ];
  const commercialRequest = {
    ...input.commercialRequest,
    plannedCalls: calls,
    requestedMaximumInputUnits: 300,
    requestedMaximumOutputUnits: 2000,
  };
  const routingRequest = modelRoutingRequestV1Schema.parse({
    ...input.routingRequest,
    estimatedContextTokens: 100,
  });
  const routingDecision = modelLiveSeedRoutingDecisionV3Schema.parse({
    ...input.routingDecision,
    maximumOutputTokens: 1000,
    timeoutMilliseconds: 10000,
    requestBinding: {
      ...input.routingDecision.requestBinding,
      routingRequestDigest: digest(routingRequest),
    },
  });
  const admissionRequest =
    modelLiveSequenceRuntimeAdmissionRequestV4Schema.parse(
      rehash(
        {
          ...input.admissionRequest,
          contractVersion: 4,
          parentSequenceContractVersion: 3,
          canonicalPlannedCallsDigest: digest(calls),
          routingDecisionDigest: digest(routingDecision),
        },
        "requestDigest",
      ),
    );
  const admissionDecision =
    modelLiveSequenceRuntimeAdmissionDecisionV4Schema.parse(
      rehash(
        {
          ...input.admissionDecision,
          contractVersion: 4,
          parentSequenceContractVersion: 3,
          canonicalPlannedCallsDigest: digest(calls),
          requestDigest: admissionRequest.requestDigest,
          routingDecisionDigest: digest(routingDecision),
        },
        "decisionDigest",
      ),
    );
  return {
    ...input,
    commercialRequest,
    routingRequest,
    routingDecision,
    admissionRequest,
    admissionDecision,
  };
}
