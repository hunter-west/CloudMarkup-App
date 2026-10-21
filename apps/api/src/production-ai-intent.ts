import {
  BedrockModelProviderAdapter,
  ModelRuntimeControlServiceV1,
  ProviderNeutralModelGateway,
  type AmazonBedrockCapabilityProfileV1,
  type BedrockFinalHttpHandlerV1,
  type BedrockRuntimeRouteV1,
  type ModelRuntimeControlServiceDependenciesV1,
  type ModelUsageEvidenceSourceV1,
  type ModelUsageRecorder,
  type ProviderNeutralModelGatewayDependencies,
} from "@cloudmarkup/model-gateway";
import {
  PlatformSpendBoundModelProviderAdapter,
  type ModelDispatchCostCeilingPort,
} from "./adapters/model-platform-spend.js";
import { PostgresModelPlatformSpendStore } from "./adapters/persistence/model-platform-spend-store.js";
import {
  PostgresModelInvocationStore,
  type ModelRuntimeResultObjectPort,
} from "./adapters/persistence/model-runtime-invocation-store.js";
import {
  parseScope,
  type ModelInvocationScope,
} from "./adapters/persistence/model-runtime-invocation-codec.js";
import type { SqlDatabase } from "./adapters/persistence/sql.js";
import {
  ProductionAiIntentJobHandler,
  type ProductionAiIntentHost,
} from "./production-ai-intent-handler.js";

/** Construct only after exact host authorization for one job. No environment
 * flag, credit normalization, retention policy, evaluation promotion, fake store
 * or model default is supplied. Required runtime adapters must be durable in a
 * deployed host; this factory does not turn injected reference fakes into that
 * evidence. It performs no SQL/network/provider calls during construction. */
export function createProductionAiIntentJobHandler(input: {
  readonly database: SqlDatabase;
  readonly scope: ModelInvocationScope;
  readonly host: ProductionAiIntentHost;
  readonly resultObjects: ModelRuntimeResultObjectPort;
  readonly usage: ModelUsageRecorder & ModelUsageEvidenceSourceV1;
  readonly costs: ModelDispatchCostCeilingPort;
  readonly httpHandler: BedrockFinalHttpHandlerV1;
  readonly bedrock: {
    readonly profile: AmazonBedrockCapabilityProfileV1;
    readonly routes: readonly BedrockRuntimeRouteV1[];
  };
  readonly gateway: Omit<
    ProviderNeutralModelGatewayDependencies,
    "adapters" | "invocationStore" | "usageRecorder"
  >;
  readonly runtime: Omit<ModelRuntimeControlServiceDependenciesV1, "now">;
  readonly now?: () => Date;
}): ProductionAiIntentJobHandler {
  const scope = parseScope(input.scope);
  if (scope.projectId === undefined || scope.jobId === undefined)
    throw new Error(
      "A verified project and job are required for AI intent execution.",
    );
  const now = input.now ?? (() => new Date());
  const invocations = new PostgresModelInvocationStore({
    database: input.database,
    objects: input.resultObjects,
    scope,
  });
  const provider = new PlatformSpendBoundModelProviderAdapter({
    costs: input.costs,
    httpHandler: input.httpHandler,
    now,
    scope,
    reservations: new PostgresModelPlatformSpendStore({
      database: input.database,
      scope,
    }),
    createDelegate: (requestHandler) =>
      new BedrockModelProviderAdapter({ ...input.bedrock, requestHandler }),
  });
  const gateway = new ProviderNeutralModelGateway({
    ...input.gateway,
    adapters: [provider],
    invocationStore: invocations,
    usageRecorder: input.usage,
  });
  return new ProductionAiIntentJobHandler({
    host: input.host,
    gateway,
    now,
    runtime: new ModelRuntimeControlServiceV1({
      ...input.runtime,
      now: () => now().toISOString(),
    }),
    results: {
      loadCompleted: async (invocationId) => {
        const result = await invocations.loadCompleted(invocationId);
        return result?.response.operation === "intent.extract"
          ? { ...result, response: result.response }
          : null;
      },
    },
    scope,
    usage: input.usage,
  });
}
