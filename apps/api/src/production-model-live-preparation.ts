import {
  calculateModelProviderCostV1,
  normalizeModelProviderCostToCreditsV1,
  type ModelUsageUnitsV1,
} from "@cloudmarkup/domain";
import {
  BedrockConverseInputTokenCounterV1,
  digestStructuredValue,
  type BedrockFinalHttpHandlerV1,
  type ModelProviderInvocationV1,
} from "@cloudmarkup/model-gateway";
import { requireProductionModelLiveCaseSource } from "./production-model-live-case-source.js";
import { utcTimestampSchema } from "@cloudmarkup/schemas";
import type { PostgresModelLiveEvaluationPlans } from "./adapters/persistence/model-live-evaluation-plans.js";
import { PostgresModelLiveCommercialPreflight } from "./adapters/persistence/model-live-commercial-read-host.js";
import {
  modelReadNumber,
  parseModelLiveCommercialReadSelectors,
  type ModelLiveCommercialReadSelectorsV2,
} from "./adapters/persistence/model-commercial-read-host-codec.js";
import { PostgresModelLiveRuntimeHostEvidence } from "./adapters/persistence/model-live-runtime-host-evidence.js";
import {
  modelLiveBedrockHostConfigurationV2Schema,
  prepareModelLiveRuntimeInputV2,
  type ModelLiveBedrockHostConfigurationV2,
} from "./adapters/persistence/model-live-runtime-host-evidence-codec.js";
import { parseScope } from "./adapters/persistence/model-runtime-invocation-codec.js";
import { sql, type SqlDatabase } from "./adapters/persistence/sql.js";

function requirePreparation(value: boolean): asserts value {
  if (!value)
    throw new Error("Current counted evaluation preparation is unavailable.");
}
const same = (left: unknown, right: unknown) =>
  digestStructuredValue(left) === digestStructuredValue(right);

/** Authenticated preparation only: actual full Converse CountTokens, canonical
 * prices/credit balance and the existing durable input issuer. It reserves no
 * credits, infers no consent, admits no runtime and cannot perform inference.
 * All request bodies stay in RAM; only ordinary input metadata is persisted.
 * Returned bounds belong in the exact single-primary commercial request. The
 * runtime and final HTTP guard remain the authorities for aggregate admission,
 * canonical reservation, current prices and the retained monthly platform cap. */
export async function prepareProductionModelLiveInputV2(input: {
  readonly database: SqlDatabase;
  readonly plans: PostgresModelLiveEvaluationPlans;
  readonly definitionId: string;
  readonly planDigest: string;
  readonly caseId: string;
  readonly invocation: ModelProviderInvocationV1;
  readonly configuration: ModelLiveBedrockHostConfigurationV2;
  readonly resolveCurrentConfiguration: () => Promise<ModelLiveBedrockHostConfigurationV2 | null>;
  readonly selectors: ModelLiveCommercialReadSelectorsV2;
  readonly httpHandler: BedrockFinalHttpHandlerV1;
  readonly signal?: AbortSignal;
  readonly now?: () => Date;
}) {
  const invocation = structuredClone(input.invocation);
  const scope = parseScope(invocation.descriptor.scope);
  const configuration = modelLiveBedrockHostConfigurationV2Schema.parse(
    input.configuration,
  );
  const selectors = parseModelLiveCommercialReadSelectors(input.selectors);
  const reference = {
    definitionId: input.definitionId,
    planDigest: input.planDigest,
  };
  const now = input.now ?? (() => new Date());
  async function current(signal?: AbortSignal) {
    requirePreparation(!input.signal?.aborted && !signal?.aborted);
    requirePreparation(
      same(await input.resolveCurrentConfiguration(), configuration),
    );
    return input.plans.withIssuedMetadata(
      reference,
      async ({ plan, principal, transaction, requireCurrentApproval }) => {
        await requireCurrentApproval();
        const stamp = (
          await transaction.query(
            sql(
              "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS now",
            ),
          )
        ).rows[0]?.["now"];
        const prepared = prepareModelLiveRuntimeInputV2({
          invocation,
          scope,
          configuration,
          caseId: input.caseId,
          plan,
          observedAt: utcTimestampSchema.parse(stamp),
        });
        requirePreparation(!input.signal?.aborted && !signal?.aborted);
        return {
          prepared,
          expiresAt: new Date(
            Math.min(
              Date.parse(plan.expiresAt),
              Date.parse(principal.expiresAt),
            ),
          ).toISOString(),
        };
      },
    );
  }
  const initial = await current();
  requireProductionModelLiveCaseSource({
    evaluationCase: await input.plans.requireCurrentCase({
      ...reference,
      caseId: input.caseId,
    }),
    invocation,
  });
  const preflight = new PostgresModelLiveCommercialPreflight({
    database: input.database,
    plans: input.plans,
    ...reference,
    caseId: input.caseId,
    descriptor: invocation.descriptor,
    selectors,
  });
  const before = await preflight.read();
  requirePreparation(
    before.featureEnabled && before.price.currencyCode === "USD",
  );
  const counter = new BedrockConverseInputTokenCounterV1({
    modelId: invocation.descriptor.modelId,
    invocationDigest: initial.prepared.invocationDigest,
    requestHandler: input.httpHandler,
    assertCurrentAuthority: async (signal) => ({
      expiresAt: (await current(signal)).expiresAt,
    }),
    now,
  });
  try {
    const count = await counter.count(
      initial.prepared.invocation,
      initial.prepared.route,
      input.signal,
    );
    requirePreparation(count !== null);
    const refreshed = await current();
    const snapshot = await preflight.read();
    requirePreparation(
      same(initial.prepared.invocation, refreshed.prepared.invocation) &&
        same(before.price, snapshot.price) &&
        same(before.normalization, snapshot.normalization) &&
        snapshot.featureEnabled &&
        snapshot.price.currencyCode === "USD",
    );
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
    const minimumCost = calculateModelProviderCostV1(
      snapshot.price,
      minimumUsage,
    );
    const maximumCost = calculateModelProviderCostV1(
      snapshot.price,
      maximumUsage,
    );
    const minimumCredits = normalizeModelProviderCostToCreditsV1(
      minimumCost,
      snapshot.normalization,
    ).cloudMarkupCreditUnits;
    const maximumCredits = normalizeModelProviderCostToCreditsV1(
      maximumCost,
      snapshot.normalization,
    ).cloudMarkupCreditUnits;
    const limits = refreshed.prepared.plan.definition.limits;
    requirePreparation(
      count.inputTokens <= limits.maximumInputTokens &&
        invocation.maximumOutputTokens <= limits.maximumOutputTokens &&
        maximumUsage.totalUnits <= limits.maximumTotalTokens &&
        maximumCredits <= limits.maximumCreditUnits &&
        maximumCredits <=
          modelReadNumber(snapshot.balance.availableCreditUnits) &&
        maximumCost.estimatedProviderCostMicros <=
          limits.maximumEstimatedMicroUsd,
    );
    const expiresAt = new Date(
      Math.min(
        Date.parse(count.expiresAt),
        Date.parse(snapshot.expiresAt),
        Date.parse(refreshed.expiresAt),
      ),
    ).toISOString();
    const requireFresh = () => {
      requirePreparation(
        !input.signal?.aborted &&
          Number.isFinite(now().getTime()) &&
          now().getTime() >= Date.parse(count.countedAt) &&
          now().getTime() < Date.parse(expiresAt),
      );
    };
    requireFresh();
    const issuer = new PostgresModelLiveRuntimeHostEvidence({
      plans: input.plans,
      scope,
      configuration,
      ...reference,
      caseId: input.caseId,
    });
    const inputEvidence = await issuer.issueInput(invocation);
    await current();
    requireFresh();
    return {
      contractVersion: 2 as const,
      inputEvidence,
      count,
      snapshot,
      expiresAt,
      plannedCall: {
        kind: "primary" as const,
        routeId: selectors.routeId,
        minimumUsage,
        maximumUsage,
      },
      requestedMaximumInputUnits: count.inputTokens,
      requestedMaximumOutputUnits: invocation.maximumOutputTokens,
      minimumCreditUnits: minimumCredits,
      maximumCreditUnits: maximumCredits,
      maximumEstimatedProviderCostMicros:
        maximumCost.estimatedProviderCostMicros,
    };
  } finally {
    counter.destroy();
  }
}
