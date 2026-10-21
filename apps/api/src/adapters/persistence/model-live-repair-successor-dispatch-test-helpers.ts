// Synthetic coordinator, tool and usage data; no native, provider or SQL authority.
import {
  digestStructuredValue as digest,
  reviewedHostBoundedRepairPromptV4,
} from "@cloudmarkup/model-gateway";
import {
  modelLiveRepairSuccessorInvocationDescriptorV4Schema,
  modelLiveSequenceInputV3Schema,
} from "@cloudmarkup/schemas";
import { firstSeedCandidateObservationFixture } from "./model-live-seed-candidate-test-helpers.js";
import { prepareFirstSeedCandidateOutcomeV4 } from "./model-live-seed-candidate-codec.js";
import { prepareModelLiveSeedStageInputV3 } from "./model-live-runtime-host-evidence-codec.js";
import { seedRuntimeExecutionForPreparedV4 } from "./model-live-seed-runtime-host-test-helpers.js";
import { seedSequenceAccountingFixtureV4 } from "./model-live-seed-commercial-accounting-test-helpers.js";
import { prepareFirstSeedDispatchV4 } from "./model-live-seed-dispatch-binding.js";
import { prepareFirstSeedUsageObservationV4 } from "./model-live-seed-usage-observation-binding.js";
import { prepareProductionRepairSuccessorInput } from "../../production-model-live-repair-successor-input.js";
import { prepareModelLiveRepairSuccessorStageInputV4 } from "./model-live-repair-successor-stage-input-codec.js";
import {
  modelPlatformReservationInputSchema,
  modelPlatformReservationReceiptSchema,
} from "../model-platform-spend.js";

export async function finalRepairDispatchFixtureV4() {
  const first = await firstSeedCandidateObservationFixture(
    "repairable",
    reviewedHostBoundedRepairPromptV4,
  );
  const prepared = prepareModelLiveSeedStageInputV3(first.source);
  const accounting = await seedSequenceAccountingFixtureV4(
    seedRuntimeExecutionForPreparedV4(prepared, first.stage),
  );
  const execution = accounting.execution,
    workflow = accounting.fixture.dispatchedRecord;
  if (workflow === undefined)
    throw Error("Missing synthetic coordinator intent");
  const platform = (
    descriptor:
      | typeof first.invocation.descriptor
      | ReturnType<
          typeof modelLiveRepairSuccessorInvocationDescriptorV4Schema.parse
        >,
    payload: string,
    reservedAt: string,
    id: string,
  ) => {
    const platformClaim = modelPlatformReservationInputSchema.parse({
      dispatchId: "dispatch_" + id.repeat(32),
      scope: descriptor.scope,
      invocationId: descriptor.invocationId,
      ceiling: {
        contractVersion: 1,
        invocationDigest: payload,
        providerId: descriptor.providerId,
        modelId: descriptor.modelId,
        modelVersion: descriptor.modelVersion,
        inferenceProfileId: descriptor.inferenceProfileId,
        pricingVersionId: execution.routingDecision.pricingVersionReference,
        pricingVersionDigest: digest("synthetic counted price"),
        maximumCostMicroUsd: 1,
        validFrom: reservedAt,
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
      platformClaim,
      platformReceipt,
      dispatchedAt: new Date(Date.parse(reservedAt) + 1).toISOString(),
    };
  };
  const firstDispatch = prepareFirstSeedDispatchV4({
    execution,
    workflow,
    descriptor: first.invocation.descriptor,
    preparedPayloadDigest: prepared.invocationDigest,
    ...platform(
      first.invocation.descriptor,
      prepared.invocationDigest,
      new Date(Date.parse(workflow.request.requestedAt) + 1).toISOString(),
      "a",
    ),
  });
  const known = prepareFirstSeedUsageObservationV4({
    stage: execution.stageInput,
    dispatch: firstDispatch,
    descriptor: first.invocation.descriptor,
    workflow,
    usage: first.usage,
    observedAt: first.attemptObservation.observedAt,
  });
  const actual = { ...first, attemptObservation: known.observation };
  const recorded = prepareFirstSeedCandidateOutcomeV4(actual);
  const predecessor = { invocation: first.invocation, first: actual, recorded };
  const request = prepareProductionRepairSuccessorInput(predecessor).request;
  const selected = execution.selection.stages.find(
    (x) => x.caseId === first.stage.caseId && x.stageKey === "repair-2",
  );
  if (!selected) throw Error("Missing selected final stage");
  const invocation = {
    ...first.invocation,
    request,
    descriptor: modelLiveRepairSuccessorInvocationDescriptorV4Schema.parse({
      ...first.invocation.descriptor,
      contractVersion: 4,
      recordKind: "model-live-repair-successor-invocation-descriptor",
      invocationId: selected.invocationId,
      inputDigest: digest({
        request,
        scope: first.invocation.descriptor.scope,
      }),
    }),
  };
  const final = prepareModelLiveRepairSuccessorStageInputV4({
    first: { ...first.source, observedAt: "2026-09-14T12:02:02.000Z" },
    predecessor,
    invocation,
  });
  const fields = { ...final.fields, issuedAt: "2026-09-14T12:02:02.000Z" };
  const stage = modelLiveSequenceInputV3Schema.parse({
    ...fields,
    inputBindingDigest: digest(fields),
  });
  return {
    execution,
    workflow,
    invocation,
    predecessor,
    descriptor: invocation.descriptor,
    stage,
    predecessorObservation: known.observation,
    predecessorAttempt: known.attempt,
    predecessorUsage: known.usage,
    predecessorReceipt: recorded.receipt,
    preparedPayloadDigest: final.invocationDigest,
    ...platform(
      invocation.descriptor,
      final.invocationDigest,
      "2026-09-14T12:02:03.000Z",
      "b",
    ),
  };
}
