import {
  calculateModelProviderCostV1,
  estimateModelCreditRangeV1,
  type ModelUsageUnitsV1,
} from "@cloudmarkup/domain";
import {
  BedrockConverseInputTokenCounterV1,
  createBedrockRoutingConfigurationV1,
  prepareBedrockLiveEvaluationConfigurationV2,
  digestStructuredValue,
  type BedrockFinalHttpHandlerV1,
} from "@cloudmarkup/model-gateway";
import {
  modelLiveBedrockHostConfigurationV2Schema,
  type ModelLiveBedrockHostConfigurationV2,
} from "./adapters/persistence/model-live-runtime-host-evidence-codec.js";
import {
  modelReadNumber,
  parseModelLiveSequenceCommercialReadSelectorsV3,
} from "./adapters/persistence/model-commercial-read-host-codec.js";
import { sequenceSelectionReferenceSchema } from "./adapters/persistence/model-live-sequence-authority-codec.js";
import type { PostgresModelLiveSequences } from "./adapters/persistence/model-live-sequences.js";

type PreflightInput = Parameters<
  PostgresModelLiveSequences["readSeedRepairCommercialPreflight"]
>[0];
type Snapshot = Awaited<
  ReturnType<PostgresModelLiveSequences["readSeedRepairCommercialPreflight"]>
>;
const same = (left: unknown, right: unknown) =>
  digestStructuredValue(left) === digestStructuredValue(right);
function requireCounted(value: boolean): asserts value {
  if (!value)
    throw new Error("Current counted repair preparation is unavailable.");
}

/** Read-only first-stage preparation. The exact full V3 SDK request is counted
 * through its mandatory final HTTP authority check. Canonical cost/credits use
 * the existing domain arithmetic and full configured output bound.
 * The first fixed-host composition requires caching disabled: it cannot guess
 * how full-input CountTokens divides cache read/write units.
 * No input receipt, consent, reservation, aggregate capacity, inference,
 * evaluation result or ordinary AI authority is issued by this function. */
export async function prepareProductionSeedRepairCountV3(
  input: PreflightInput & {
    readonly sequences: PostgresModelLiveSequences;
    readonly configuration: ModelLiveBedrockHostConfigurationV2;
    readonly httpHandler: BedrockFinalHttpHandlerV1;
    readonly signal?: AbortSignal;
    readonly now?: () => Date;
  },
) {
  const invocation = structuredClone(input.invocation);
  const reference = sequenceSelectionReferenceSchema.parse(input.reference);
  const selectors = parseModelLiveSequenceCommercialReadSelectorsV3(
    input.selectors,
  );
  const configuration = modelLiveBedrockHostConfigurationV2Schema.parse(
    input.configuration,
  );
  const request = { reference, caseId: input.caseId, invocation, selectors };
  const planReference = {
    definitionId: reference.definitionId,
    planDigest: reference.planDigest,
  };
  const now = input.now ?? (() => new Date());
  function requireActive(signal?: AbortSignal) {
    requireCounted(!input.signal?.aborted && !signal?.aborted);
  }
  requireActive();
  requireCounted(!invocation.promptCachePolicy.enabled);
  const plan = await input.sequences.requireCurrent(planReference);
  const invocationDigest = digestStructuredValue(invocation);
  async function current(
    baseline?: Snapshot,
    signal?: AbortSignal,
  ): Promise<Snapshot> {
    requireActive(signal);
    const snapshot = await input.sequences.readSeedRepairCommercialPreflight(
      request,
      signal ?? input.signal,
    );
    requireActive(signal);
    requireCounted(
      snapshot.configurationDigest === digestStructuredValue(configuration) &&
        snapshot.preparedPayloadDigest === invocationDigest &&
        snapshot.planDigest === plan.planDigest &&
        snapshot.selectionId === reference.selectionId &&
        snapshot.selectionDigest === reference.selectionDigest &&
        snapshot.stage.invocationId === invocation.descriptor.invocationId &&
        snapshot.featureEnabled &&
        snapshot.price.currencyCode === "USD" &&
        snapshot.price.providerSpecificUnitRates.length === 0 &&
        invocation.maximumOutputTokens <=
          plan.definition.limits.maximumOutputTokens &&
        modelReadNumber(snapshot.balance.availableCreditUnits) > 0,
    );
    if (baseline)
      requireCounted(
        same(snapshot.price, baseline.price) &&
          same(snapshot.normalization, baseline.normalization) &&
          same(snapshot.entitlement, baseline.entitlement) &&
          same(snapshot.stage, baseline.stage) &&
          same(snapshot.requested, baseline.requested),
      );
    return snapshot;
  }
  const before = await current();
  const configured =
    configuration.contractVersion === 1
      ? createBedrockRoutingConfigurationV1({
          configuration,
          asOf: before.observedAt,
        })
      : prepareBedrockLiveEvaluationConfigurationV2({
          configuration,
          asOf: before.observedAt,
        });
  const route = configured.runtimeRoutes.find(
    (entry) =>
      entry.modelConfigurationReference ===
      selectors.modelConfigurationReference,
  );
  requireCounted(route !== undefined);
  const counter = new BedrockConverseInputTokenCounterV1({
    modelId: invocation.descriptor.modelId,
    invocationDigest,
    requestHandler: input.httpHandler,
    assertCurrentAuthority: async (signal) => ({
      expiresAt: (await current(before, signal)).expiresAt,
    }),
    now,
  });
  try {
    const count = await counter.countHostSeedV3(
      invocation,
      route,
      input.signal,
    );
    requireCounted(
      count !== null && count.invocationDigest === invocationDigest,
    );
    const snapshot = await current(before);
    const minimumUsage: ModelUsageUnitsV1 = {
      inputUnits: count.inputTokens,
      outputUnits: 0,
      cacheReadUnits: 0,
      cacheWriteUnits: 0,
      providerSpecificUnits: [],
      totalUnits: count.inputTokens,
    };
    const maximumUsage: ModelUsageUnitsV1 = {
      ...minimumUsage,
      outputUnits: invocation.maximumOutputTokens,
      totalUnits: count.inputTokens + invocation.maximumOutputTokens,
    };
    const credits = estimateModelCreditRangeV1(
      snapshot.price,
      snapshot.normalization,
      minimumUsage,
      maximumUsage,
    );
    const cost = calculateModelProviderCostV1(snapshot.price, maximumUsage);
    const limits = plan.definition.limits;
    requireCounted(
      count.inputTokens <= limits.maximumInputTokens &&
        maximumUsage.totalUnits <= limits.maximumTotalTokens &&
        credits.maximumCreditUnits <= limits.maximumCreditUnits &&
        credits.maximumCreditUnits <=
          modelReadNumber(snapshot.balance.availableCreditUnits) &&
        cost.estimatedProviderCostMicros <= limits.maximumEstimatedMicroUsd,
    );
    const expiresAt = new Date(
      Math.min(
        Date.parse(count.expiresAt),
        Date.parse(snapshot.expiresAt),
        Date.parse(plan.expiresAt),
      ),
    ).toISOString();
    const observed = now().getTime();
    requireActive();
    requireCounted(
      Number.isFinite(observed) &&
        observed >= Date.parse(count.countedAt) &&
        observed < Date.parse(expiresAt),
    );
    return {
      contractVersion: 3 as const,
      authority: "unissued-counted-seed-input" as const,
      count,
      snapshot,
      expiresAt,
      plannedCall: {
        kind: "repair" as const,
        routeId: selectors.routeId,
        minimumUsage,
        maximumUsage,
      },
      requestedMaximumInputUnits: count.inputTokens,
      requestedMaximumOutputUnits: invocation.maximumOutputTokens,
      minimumCreditUnits: credits.minimumCreditUnits,
      maximumCreditUnits: credits.maximumCreditUnits,
      maximumEstimatedProviderCostMicros: cost.estimatedProviderCostMicros,
    };
  } finally {
    counter.destroy();
  }
}
