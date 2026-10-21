import { digestStructuredValue as digest } from "@cloudmarkup/model-gateway";
import { modelLiveSequenceInputV3Schema } from "@cloudmarkup/schemas";
import { syntheticSeedStageInput } from "./model-live-seed-stage-test-helpers.js";
import { prepareModelLiveSeedStageInputV3 } from "./model-live-runtime-host-evidence-codec.js";
import { seedRuntimeExecutionForPreparedV4 } from "./model-live-seed-runtime-host-test-helpers.js";
import { seedSequenceAccountingFixtureV4 } from "./model-live-seed-commercial-accounting-test-helpers.js";
import {
  modelPlatformReservationInputSchema,
  modelPlatformReservationReceiptSchema,
} from "../model-platform-spend.js";

export async function seedDispatchBindingFixtureV4() {
  const f = await syntheticSeedStageInput();
  Object.assign(f.invocation, {
    maximumOutputTokens: 1000,
    timeoutMilliseconds: 10000,
  });
  const prepared = prepareModelLiveSeedStageInputV3(f);
  const body = { ...prepared.fields, issuedAt: f.observedAt };
  const issued = modelLiveSequenceInputV3Schema.parse({
    ...body,
    inputBindingDigest: digest(body),
  });
  const accounting = await seedSequenceAccountingFixtureV4(
    seedRuntimeExecutionForPreparedV4(prepared, issued),
  );
  const workflow = accounting.fixture.dispatchedRecord;
  if (workflow === undefined)
    throw Error("Missing actual synthetic coordinator dispatch intent");
  const descriptor = prepared.invocation.descriptor;
  const reservedAt = new Date(
    Date.parse(workflow.request.requestedAt) + 1000,
  ).toISOString();
  const platformClaim = modelPlatformReservationInputSchema.parse({
    dispatchId: "dispatch_" + "a".repeat(32),
    scope: descriptor.scope,
    invocationId: descriptor.invocationId,
    ceiling: {
      contractVersion: 1,
      invocationDigest: prepared.invocationDigest,
      providerId: descriptor.providerId,
      modelId: descriptor.modelId,
      modelVersion: descriptor.modelVersion,
      inferenceProfileId: descriptor.inferenceProfileId,
      pricingVersionId:
        accounting.execution.routingDecision.pricingVersionReference,
      pricingVersionDigest: digest("synthetic full-count price"),
      maximumCostMicroUsd: 1,
      validFrom: workflow.request.requestedAt,
      validUntil: workflow.request.expiresAt,
      dispatchValidUntil: new Date(
        Date.parse(reservedAt) + 30000,
      ).toISOString(),
    },
  });
  const platformReceipt = modelPlatformReservationReceiptSchema.parse({
    kind: "reserved",
    dispatchId: platformClaim.dispatchId,
    claimDigest: digest(platformClaim),
    monthUtc: reservedAt.slice(0, 7),
    reservedAt,
    dispatchBefore: new Date(Date.parse(reservedAt) + 5000).toISOString(),
  });
  return {
    execution: accounting.execution,
    descriptor,
    preparedPayloadDigest: prepared.invocationDigest,
    workflow,
    platformClaim,
    platformReceipt,
    dispatchedAt: new Date(Date.parse(reservedAt) + 1).toISOString(),
  };
}
