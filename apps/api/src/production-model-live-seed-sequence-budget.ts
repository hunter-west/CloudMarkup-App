import {
  aggregateModelUsageUnitsV1,
  calculateModelProviderCostV1,
  estimateModelCreditRangeV1,
  type ModelUsageUnitsV1,
} from "@cloudmarkup/domain";
import {
  digestStructuredValue as digest,
  inspectModelLiveSequenceV3,
  type ModelCommercialEstimateCallV1,
} from "@cloudmarkup/model-gateway";
import {
  modelLiveSeedInvocationDescriptorV3Schema,
  modelLiveSequencePlanV3Schema,
  modelLiveSequenceSelectionV3Schema,
} from "@cloudmarkup/schemas";
import { configuredSeedModel } from "./adapters/persistence/model-live-seed-invocation-preparation.js";
import { modelReadNumber } from "./adapters/persistence/model-commercial-read-host-codec.js";
import type { prepareProductionSeedRepairCountV3 } from "./production-model-live-seed-counted-preparation.js";

type Counted = Awaited<ReturnType<typeof prepareProductionSeedRepairCountV3>>;
type CountInput = Parameters<typeof prepareProductionSeedRepairCountV3>[0];
type Source = Parameters<typeof configuredSeedModel>[0];
function requireBudget(value: boolean): asserts value {
  if (!value) throw new Error("Current repair sequence budget is unavailable.");
}
const same = (left: unknown, right: unknown) => digest(left) === digest(right);
function sum(values: readonly number[]) {
  const result = values.reduce((total, value) => {
    requireBudget(Number.isSafeInteger(value) && value >= 0);
    return total + value;
  }, 0);
  requireBudget(Number.isSafeInteger(result));
  return result;
}
function usage(inputUnits: number, outputUnits: number): ModelUsageUnitsV1 {
  return {
    inputUnits,
    outputUnits,
    totalUnits: sum([inputUnits, outputUnits]),
    cacheReadUnits: 0,
    cacheWriteUnits: 0,
    providerSpecificUnits: [],
  };
}

/** Private metadata calculation over the closed host's current observations.
 * Equal per-stage token ceilings leave capacity for every pre-issued repair.
 * Only stage one is counted. Stage two has an explicit worst-case ceiling
 * and must be counted and authorized independently before its actual send.
 * This grants no consent, reservation, runtime lease or inference authority. */
export function calculateSeedSequenceBudgetV4(
  input: Source & {
    readonly invocation: CountInput["invocation"];
    readonly counted: Counted;
    readonly current: Counted["snapshot"];
  },
) {
  const plan = modelLiveSequencePlanV3Schema.parse(input.plan);
  const selection = modelLiveSequenceSelectionV3Schema.parse(input.selection);
  inspectModelLiveSequenceV3({
    plan,
    selection,
    inputs: [],
    dispatches: [],
    outcomes: [],
    observedAt: input.observedAt,
  });
  const { invocation, counted, current } = input;
  const descriptor = modelLiveSeedInvocationDescriptorV3Schema.parse(
    invocation.descriptor,
  );
  const configured = configuredSeedModel({ ...input, plan, selection });
  const { capability, binding, stage } = configured;
  const now = Date.parse(input.observedAt);
  const countTime = Date.parse(counted.count.countedAt);
  const currentTime = Date.parse(current.observedAt);
  requireBudget(
    Number.isFinite(now) &&
      Number.isFinite(countTime) &&
      currentTime >= countTime &&
      currentTime <= now &&
      now < Date.parse(counted.expiresAt) &&
      now < Date.parse(counted.count.expiresAt) &&
      now < Date.parse(counted.snapshot.expiresAt) &&
      counted.count.invocationDigest === digest(invocation) &&
      counted.snapshot.preparedPayloadDigest ===
        counted.count.invocationDigest &&
      current.preparedPayloadDigest === counted.count.invocationDigest &&
      same(current.descriptor, descriptor) &&
      same(counted.snapshot.descriptor, descriptor) &&
      same(current.price, counted.snapshot.price) &&
      same(current.normalization, counted.snapshot.normalization) &&
      same(current.entitlement, counted.snapshot.entitlement) &&
      same(current.requested, counted.snapshot.requested) &&
      same(current.stage, stage) &&
      same(counted.snapshot.stage, stage) &&
      current.configurationDigest === digest(input.configuration) &&
      current.configurationDigest === counted.snapshot.configurationDigest &&
      current.planDigest === plan.planDigest &&
      counted.snapshot.planDigest === plan.planDigest &&
      current.selectionId === selection.selectionId &&
      counted.snapshot.selectionId === selection.selectionId &&
      current.selectionDigest === selection.selectionDigest &&
      counted.snapshot.selectionDigest === selection.selectionDigest &&
      descriptor.invocationId === stage.invocationId &&
      descriptor.entitlementDecisionId ===
        current.entitlement.entitlementSnapshotId &&
      descriptor.scope.organizationId ===
        plan.definition.scope.organizationId &&
      descriptor.scope.projectId === plan.definition.scope.projectId &&
      descriptor.scope.userId === plan.definition.scope.userId &&
      descriptor.routing.modelConfigurationReference ===
        capability.modelConfigurationReference &&
      descriptor.modelId === capability.modelId &&
      current.price.modelId === descriptor.modelId &&
      current.price.modelVersion === descriptor.modelVersion &&
      current.price.providerKey === descriptor.providerId &&
      current.price.inferenceProfileId ===
        (descriptor.inferenceProfileId ?? null) &&
      current.price.currencyCode === "USD" &&
      current.price.providerSpecificUnitRates.length === 0 &&
      current.featureEnabled &&
      counted.snapshot.featureEnabled &&
      !invocation.promptCachePolicy.enabled,
  );
  const limits = plan.definition.limits;
  const slots = selection.stages.filter(
    (entry) => entry.caseId === binding.caseId,
  );
  requireBudget(slots.length === 2);
  const maximumOutputUnits = invocation.maximumOutputTokens;
  const maximumInputUnits = Math.min(
    Math.floor(limits.maximumInputTokens / selection.stages.length),
    capability.contextLimitTokens - maximumOutputUnits,
  );
  requireBudget(
    Number.isSafeInteger(counted.count.inputTokens) &&
      counted.count.inputTokens > 0 &&
      Number.isSafeInteger(maximumInputUnits) &&
      maximumInputUnits > 0 &&
      Number.isSafeInteger(maximumOutputUnits) &&
      maximumOutputUnits > 0 &&
      maximumOutputUnits <=
        Math.floor(limits.maximumOutputTokens / selection.stages.length) &&
      maximumOutputUnits <= capability.maximumOutputTokens &&
      maximumOutputUnits <= plan.definition.policy.limits.maximumOutputTokens &&
      counted.count.inputTokens <= maximumInputUnits,
  );
  const plannedCalls: readonly ModelCommercialEstimateCallV1[] = [
    {
      kind: "repair",
      routeId: binding.routeId,
      minimumUsage: usage(counted.count.inputTokens, 0),
      maximumUsage: usage(counted.count.inputTokens, maximumOutputUnits),
    },
    {
      kind: "repair",
      routeId: binding.routeId,
      minimumUsage: usage(0, 0),
      maximumUsage: usage(maximumInputUnits, maximumOutputUnits),
    },
  ];
  requireBudget(same(plannedCalls[0], counted.plannedCall));
  const estimates = plannedCalls.map((call) => ({
    credits: estimateModelCreditRangeV1(
      current.price,
      current.normalization,
      call.minimumUsage,
      call.maximumUsage,
    ),
    cost: calculateModelProviderCostV1(current.price, call.maximumUsage),
  }));
  const minimumCreditUnits = sum(
    estimates.map((entry) => entry.credits.minimumCreditUnits),
  );
  const maximumCreditUnits = sum(
    estimates.map((entry) => entry.credits.maximumCreditUnits),
  );
  const maximumEstimatedProviderCostMicros = sum(
    estimates.map((entry) => entry.cost.estimatedProviderCostMicros),
  );
  const maximumUsage = aggregateModelUsageUnitsV1(
    plannedCalls.map((call) => call.maximumUsage),
  );
  const perCase = (value: number) =>
    Math.floor(value / plan.definition.cases.length);
  requireBudget(
    maximumCreditUnits <= perCase(limits.maximumCreditUnits) &&
      maximumCreditUnits <=
        modelReadNumber(current.balance.availableCreditUnits) &&
      maximumEstimatedProviderCostMicros <=
        perCase(limits.maximumEstimatedMicroUsd) &&
      maximumUsage.inputUnits <= perCase(limits.maximumInputTokens) &&
      maximumUsage.outputUnits <= perCase(limits.maximumOutputTokens) &&
      maximumUsage.totalUnits <= perCase(limits.maximumTotalTokens),
  );
  // The existing execution lease supports at most five minutes. A CountTokens
  // receipt keeps its original short expiry and is never extended into a lease.
  const expires = Math.min(
    Date.parse(plan.expiresAt),
    Date.parse(current.expiresAt),
    Date.parse(counted.snapshot.expiresAt),
    currentTime + 300_000,
    ...input.configuration.routes
      .filter(
        (route) =>
          route.capability.modelConfigurationReference ===
          capability.modelConfigurationReference,
      )
      .map((route) =>
        route.effectiveUntil === null
          ? Infinity
          : Date.parse(route.effectiveUntil),
      ),
  );
  requireBudget(
    Number.isFinite(expires) &&
      expires > now &&
      Number.isSafeInteger(invocation.timeoutMilliseconds) &&
      invocation.timeoutMilliseconds > 0 &&
      invocation.timeoutMilliseconds * 2 < expires - now,
  );
  return {
    contractVersion: 4 as const,
    authority: "unreserved-seed-sequence-budget" as const,
    planDigest: plan.planDigest,
    selectionId: selection.selectionId,
    selectionDigest: selection.selectionDigest,
    caseId: binding.caseId,
    observedAt: input.observedAt,
    expiresAt: new Date(expires).toISOString(),
    firstCountExpiresAt: counted.expiresAt,
    plannedCalls,
    slots: slots.map((slot, index) => ({
      ...slot,
      canonicalAttemptOrdinal: index === 0 ? (1 as const) : (2 as const),
      plannedCallDigest: digest(plannedCalls[index]),
      inputBudgetKind:
        index === 0 ? ("counted" as const) : ("uncounted-ceiling" as const),
    })),
    maximumUsage,
    requestedMaximumInputUnits: maximumUsage.inputUnits,
    requestedMaximumOutputUnits: maximumUsage.outputUnits,
    minimumCreditUnits,
    maximumCreditUnits,
    maximumEstimatedProviderCostMicros,
  };
}
