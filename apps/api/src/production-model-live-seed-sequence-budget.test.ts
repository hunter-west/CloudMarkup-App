import { beforeAll, describe, expect, it } from "vitest";
import {
  aggregateModelUsageUnitsV1,
  calculateModelProviderCostV1,
  estimateModelCreditRangeV1,
  ENTITLEMENT_POLICY_VERSION,
} from "@cloudmarkup/domain";
import {
  BEDROCK_CONVERSE_TOKEN_COUNT_POLICY_V1,
  digestStructuredValue as digest,
} from "@cloudmarkup/model-gateway";
import { calculateSeedSequenceBudgetV4 } from "./production-model-live-seed-sequence-budget.js";
import { configuredSeedModel } from "./adapters/persistence/model-live-seed-invocation-preparation.js";
import { syntheticSeedStageInput } from "./adapters/persistence/model-live-seed-stage-test-helpers.js";
import { prepareModelLiveSeedStageInputV3 } from "./adapters/persistence/model-live-runtime-host-evidence-codec.js";
import { parseModelLiveSequenceCommercialReadSelectorsV3 } from "./adapters/persistence/model-commercial-read-host-codec.js";

type Input = Parameters<typeof calculateSeedSequenceBudgetV4>[0];
async function fixture(): Promise<Input> {
  const f = await syntheticSeedStageInput();
  Object.assign(f.invocation, {
    maximumOutputTokens: 1000,
    timeoutMilliseconds: 10000,
  });
  const prepared = prepareModelLiveSeedStageInputV3(f);
  const descriptor = prepared.invocation.descriptor;
  const route = descriptor.routing;
  const price: Input["current"]["price"] = {
    version: 1,
    pricingVersionId: route.pricingVersionReference,
    providerKey: descriptor.providerId,
    modelId: descriptor.modelId,
    modelVersion: descriptor.modelVersion,
    inferenceProfileId: descriptor.inferenceProfileId ?? null,
    environment: f.plan.definition.scope.environment,
    currencyCode: "USD",
    effectiveFrom: "2026-09-01T00:00:00.000Z",
    effectiveUntil: null,
    status: "enabled",
    inputMicrosPerMillionUnits: 3000000,
    outputMicrosPerMillionUnits: 15000000,
    cacheReadMicrosPerMillionUnits: null,
    cacheWriteMicrosPerMillionUnits: null,
    providerSpecificUnitRates: [],
  };
  const normalization: Input["current"]["normalization"] = {
    version: 1,
    normalizationPolicyVersionId: "normalization.seed-budget.synthetic",
    currencyCode: "USD",
    creditUnitMicros: 10000,
    operatingBufferBasisPoints: 3000,
    effectiveFrom: price.effectiveFrom,
    effectiveUntil: null,
    status: "enabled",
  };
  const at = (ms: number) =>
    new Date(Date.parse(f.observedAt) + ms).toISOString();
  const policy = f.plan.definition.policy;
  const current: Input["current"] = {
    contractVersion: 3,
    recordKind: "model-live-sequence-commercial-preflight",
    executionClass: "live-evaluation",
    observedAt: at(2000),
    expiresAt: f.plan.expiresAt,
    descriptor,
    entitlement: {
      entitlementSnapshotId: descriptor.entitlementDecisionId,
      sourceRecordVersion: "1",
      subscriptionProjectionId: "subscription.synthetic",
      planVersionId: "plan.synthetic.v1",
      planKey: f.plan.definition.scope.plan,
      entitlementPolicyVersion: ENTITLEMENT_POLICY_VERSION,
    },
    featureEnabled: true,
    maximumConcurrentReservations: 1,
    balance: {
      asOf: at(2000),
      organizationId: descriptor.scope.organizationId,
      activeGrantedCreditUnits: "1000",
      availableCreditUnits: "1000",
      compensatedCreditUnits: "0",
      debitAdjustmentCreditUnits: "0",
      netAdjustmentCreditUnits: "0",
      exhausted: false,
      expiredCreditUnits: "0",
      reservedCreditUnits: "0",
      settledCreditUnits: "0",
      totalGrantedCreditUnits: "1000",
      unresolvedCreditUnits: "0",
    },
    price,
    normalization,
    planDigest: f.plan.planDigest,
    selectionId: f.selection.selectionId,
    selectionDigest: f.selection.selectionDigest,
    stage: prepared.stage,
    preparedPayloadDigest: digest(f.invocation),
    configurationDigest: prepared.configurationDigest,
    requested: prepared.requested,
    selectors: parseModelLiveSequenceCommercialReadSelectorsV3({
      contractVersion: 3,
      executionClass: "live-evaluation",
      routeId: "internal-escalation",
      routeDefinitionDigest: route.routeDefinitionDigest,
      modelConfigurationReference: route.modelConfigurationReference,
      pricingVersionId: price.pricingVersionId,
      pricingVersionDigest: digest(price),
      normalizationPolicyVersionId: normalization.normalizationPolicyVersionId,
      normalizationPolicyDigest: digest(normalization),
      runtimePolicyId: policy.policyId,
      runtimePolicyVersion: policy.policyVersion,
      runtimePolicyDigest: policy.policyDigest,
    }),
  };
  const minimumUsage = {
    inputUnits: 20,
    outputUnits: 0,
    totalUnits: 20,
    cacheReadUnits: 0,
    cacheWriteUnits: 0,
    providerSpecificUnits: [],
  };
  const maximumUsage = { ...minimumUsage, outputUnits: 1000, totalUnits: 1020 };
  const credits = estimateModelCreditRangeV1(
    price,
    normalization,
    minimumUsage,
    maximumUsage,
  );
  return {
    ...f,
    observedAt: at(3000),
    current,
    counted: {
      contractVersion: 3,
      authority: "unissued-counted-seed-input",
      count: {
        policyId: BEDROCK_CONVERSE_TOKEN_COUNT_POLICY_V1,
        invocationDigest: digest(f.invocation),
        requestDigest: digest("synthetic-sdk-payload"),
        inputTokens: 20,
        countedAt: at(1000),
        expiresAt: at(31000),
      },
      snapshot: structuredClone(current),
      expiresAt: at(31000),
      plannedCall: {
        kind: "repair",
        routeId: "internal-escalation",
        minimumUsage,
        maximumUsage,
      },
      requestedMaximumInputUnits: 20,
      requestedMaximumOutputUnits: 1000,
      minimumCreditUnits: credits.minimumCreditUnits,
      maximumCreditUnits: credits.maximumCreditUnits,
      maximumEstimatedProviderCostMicros: calculateModelProviderCostV1(
        price,
        maximumUsage,
      ).estimatedProviderCostMicros,
    },
  };
}
function refreshInvocation(f: Input) {
  const invocationDigest = digest(f.invocation);
  Object.assign(f.counted.count, { invocationDigest });
  for (const snapshot of [f.current, f.counted.snapshot])
    Object.assign(snapshot, {
      preparedPayloadDigest: invocationDigest,
      descriptor: structuredClone(f.invocation.descriptor),
    });
}
describe("private two-slot repair budget over synthetic canonical observations", () => {
  let baseline: Input;
  beforeAll(async () => {
    baseline = await fixture();
  });
  const fresh = () => structuredClone(baseline);
  it("budgets both pre-issued slots without inventing a second token count or settlement", () => {
    const f = fresh();
    const before = structuredClone(f);
    const budget = calculateSeedSequenceBudgetV4(f);
    expect(budget.plannedCalls).toHaveLength(2);
    expect(budget.plannedCalls[0]).toEqual(f.counted.plannedCall);
    expect(budget.plannedCalls[1]).toMatchObject({
      kind: "repair",
      routeId: "internal-escalation",
      minimumUsage: { inputUnits: 0, outputUnits: 0 },
      maximumUsage: { inputUnits: 25000, outputUnits: 1000, totalUnits: 26000 },
    });
    expect(
      budget.slots.map((slot) => [
        slot.stageKey,
        slot.canonicalAttemptOrdinal,
        slot.inputBudgetKind,
      ]),
    ).toEqual([
      ["repair-1", 1, "counted"],
      ["repair-2", 2, "uncounted-ceiling"],
    ]);
    expect(budget.slots.map((slot) => slot.plannedCallDigest)).toEqual(
      budget.plannedCalls.map(digest),
    );
    expect(budget).toMatchObject({
      requestedMaximumInputUnits: 25020,
      requestedMaximumOutputUnits: 2000,
      maximumCreditUnits: 14,
      maximumEstimatedProviderCostMicros: 105060,
      maximumUsage: { totalUnits: 27020 },
    });
    expect(Date.parse(budget.expiresAt)).toBeGreaterThan(
      Date.parse(budget.firstCountExpiresAt),
    );
    expect(Date.parse(budget.expiresAt)).toBeLessThanOrEqual(
      Date.parse(f.current.observedAt) + 300000,
    );
    expect(budget).not.toHaveProperty("reservationId");
    expect(budget).not.toHaveProperty("settlement");
    expect(f).toEqual(before);
  });
  it("preserves per-call credit rounding in the single workflow maximum", () => {
    const f = fresh();
    Object.assign(f.invocation, { maximumOutputTokens: 1 });
    Object.assign(f.counted.plannedCall.maximumUsage, {
      outputUnits: 1,
      totalUnits: 21,
    });
    refreshInvocation(f);
    const budget = calculateSeedSequenceBudgetV4(f);
    const aggregate = aggregateModelUsageUnitsV1(
      budget.plannedCalls.map((call) => call.maximumUsage),
    );
    const roundedTogether = estimateModelCreditRangeV1(
      f.current.price,
      f.current.normalization,
      aggregate,
      aggregate,
    );
    expect(budget.maximumCreditUnits).toBe(11);
    expect(roundedTogether.maximumCreditUnits).toBe(10);
  });
  it("recalculates each ceiling instead of trusting claimed count estimate totals", () => {
    const f = fresh();
    Object.assign(f.counted, {
      maximumCreditUnits: 0,
      maximumEstimatedProviderCostMicros: 0,
    });
    expect(calculateSeedSequenceBudgetV4(f)).toMatchObject({
      maximumCreditUnits: 14,
      maximumEstimatedProviderCostMicros: 105060,
    });
  });
  it.each(["credits", "provider-cost"] as const)(
    "rejects both-call totals above approved %s",
    (kind) => {
      const f = fresh();
      for (const snapshot of [f.current, f.counted.snapshot]) {
        if (kind === "credits")
          Object.assign(snapshot.normalization, { creditUnitMicros: 1 });
        else
          Object.assign(snapshot.price, {
            inputMicrosPerMillionUnits: 3000000000,
          });
      }
      expect(() => calculateSeedSequenceBudgetV4(f)).toThrow();
    },
  );
  it("respects an earlier actual commercial expiry without extending the count", () => {
    const f = fresh();
    const end = new Date(Date.parse(f.observedAt) + 90000).toISOString();
    Object.assign(f.current, { expiresAt: end });
    expect(calculateSeedSequenceBudgetV4(f).expiresAt).toBe(end);
    expect(f.counted.count.expiresAt).toBe(baseline.counted.count.expiresAt);
  });
  it.each([
    "stale-count",
    "future-count",
    "future-observation",
    "expired-authority",
    "insufficient-workflow-time",
    "changed-price",
    "changed-normalization",
    "disabled",
    "balance",
    "foreign-tenant",
    "foreign-stage",
    "changed-config",
    "changed-payload",
    "cached",
    "missing-count",
    "count-over-ceiling",
    "output-over-ceiling",
    "inconsistent-first-call",
  ] as const)("denies %s while preparing the budget", (kind) => {
    const f = fresh();
    switch (kind) {
      case "stale-count":
        Object.assign(f, { observedAt: f.counted.expiresAt });
        break;
      case "future-count":
        Object.assign(f.counted.count, {
          countedAt: new Date(Date.parse(f.observedAt) + 1).toISOString(),
        });
        break;
      case "future-observation":
        Object.assign(f.current, {
          observedAt: new Date(Date.parse(f.observedAt) + 1).toISOString(),
        });
        break;
      case "expired-authority":
        Object.assign(f.current, { expiresAt: f.observedAt });
        break;
      case "insufficient-workflow-time":
        Object.assign(f.current, {
          expiresAt: new Date(Date.parse(f.observedAt) + 20000).toISOString(),
        });
        break;
      case "changed-price":
        Object.assign(f.current.price, { inputMicrosPerMillionUnits: 1 });
        break;
      case "changed-normalization":
        Object.assign(f.current.normalization, { creditUnitMicros: 999999 });
        break;
      case "disabled":
        Object.assign(f.current, { featureEnabled: false });
        break;
      case "balance":
        Object.assign(f.current.balance, { availableCreditUnits: "13" });
        break;
      case "foreign-tenant":
        Object.assign(f.invocation.descriptor.scope, {
          organizationId: "org_other",
        });
        refreshInvocation(f);
        break;
      case "foreign-stage":
        Object.assign(f.current.stage, {
          invocationId: "invocation_" + "f".repeat(32),
        });
        break;
      case "changed-config":
        Object.assign(f.current, {
          configurationDigest: digest("other-config"),
        });
        break;
      case "changed-payload":
        Object.assign(f.counted.count, {
          invocationDigest: digest("other-payload"),
        });
        break;
      case "cached":
        Object.assign(f.invocation.promptCachePolicy, { enabled: true });
        refreshInvocation(f);
        break;
      case "missing-count":
        Object.assign(f.counted.count, { inputTokens: 0 });
        break;
      case "count-over-ceiling":
        Object.assign(f.counted.count, { inputTokens: 25001 });
        break;
      case "output-over-ceiling": {
        const ceiling = f.plan.definition.policy.limits.maximumOutputTokens;
        const { capability } = configuredSeedModel(f);
        expect(ceiling + 1).toBeLessThanOrEqual(
          Math.floor(
            f.plan.definition.limits.maximumOutputTokens /
              f.selection.stages.length,
          ),
        );
        expect(ceiling + 1).toBeLessThanOrEqual(capability.maximumOutputTokens);
        const bindOutput = (outputTokens: number) => {
          Object.assign(f.invocation, { maximumOutputTokens: outputTokens });
          Object.assign(f.counted.plannedCall.maximumUsage, {
            outputUnits: outputTokens,
            totalUnits:
              f.counted.plannedCall.maximumUsage.inputUnits + outputTokens,
          });
          Object.assign(f.counted, {
            requestedMaximumOutputUnits: outputTokens,
          });
          for (const snapshot of [f.current, f.counted.snapshot])
            Object.assign(snapshot.requested, { outputTokens });
          refreshInvocation(f);
        };
        bindOutput(ceiling);
        expect(
          calculateSeedSequenceBudgetV4(f).plannedCalls[0]?.maximumUsage
            .outputUnits,
        ).toBe(ceiling);
        bindOutput(ceiling + 1);
        expect(() => calculateSeedSequenceBudgetV4(f)).toThrow(
          "Current repair sequence budget is unavailable.",
        );
        return;
      }
      case "inconsistent-first-call":
        Object.assign(f.counted.plannedCall.maximumUsage, { totalUnits: 1 });
        break;
    }
    expect(() => calculateSeedSequenceBudgetV4(f)).toThrow();
  });
});
