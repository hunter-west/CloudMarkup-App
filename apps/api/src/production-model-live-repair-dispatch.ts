import {
  BedrockModelProviderAdapter,
  ModelProviderInvocationError,
  createBedrockRoutingConfigurationV1,
  prepareBedrockLiveEvaluationConfigurationV2,
  normalizeModelHostSeedUsageV3,
  normalizeModelHostRepairSuccessorUsageV4,
  type BedrockFinalHttpHandlerV1,
  type ModelProviderHostSeedInvocationV3,
  type ModelProviderHostRepairSuccessorInvocationV4,
  type ModelProviderResultV1,
  type ModelProviderUsageV1,
} from "@cloudmarkup/model-gateway";
import type { NormalizedModelUsageV1 } from "@cloudmarkup/schemas";
import {
  BedrockGlobalCountedHostSeedCostAuthorityV3,
  BedrockGlobalCountedHostRepairSuccessorCostAuthorityV4,
} from "./adapters/bedrock-counted-global-pricing.js";
import type { BedrockGlobalPricingEvidenceV1 } from "./adapters/bedrock-global-pricing.js";
import {
  PlatformSpendBoundHostSeedProviderAdapterV3,
  PlatformSpendBoundHostRepairSuccessorProviderAdapterV4,
  type ModelPlatformReservationInput,
  type ModelPlatformReservationReceipt,
} from "./adapters/model-platform-spend.js";
import { PostgresModelPlatformSpendStore } from "./adapters/persistence/model-platform-spend-store.js";
import type { ModelLiveBedrockHostConfigurationV2 } from "./adapters/persistence/model-live-runtime-host-evidence-codec.js";
import type { SqlDatabase } from "./adapters/persistence/sql.js";
export interface RepairDispatchTransport {
  readonly pricing: BedrockGlobalPricingEvidenceV1;
  readonly httpHandler: BedrockFinalHttpHandlerV1;
}
export class ProductionSeedDispatchError extends Error {
  readonly code = "model-live.seed-dispatch-unavailable";
  constructor() {
    super("The repair dispatch is unavailable.");
    this.name = "ProductionSeedDispatchError";
  }
}
const canceled = (signal?: AbortSignal) => signal?.aborted === true;
function requireDispatch(value: boolean): asserts value {
  if (!value) throw new ProductionSeedDispatchError();
}
type Kind =
  | {
      readonly kind: "first";
      readonly invocation: ModelProviderHostSeedInvocationV3;
    }
  | {
      readonly kind: "final";
      readonly invocation: ModelProviderHostRepairSuccessorInvocationV4;
      readonly reservedTokenCeiling: {
        readonly input: number;
        readonly output: number;
      };
    };
/** Private common transport. Each strict wrapper supplies its own issued journal.
 * Count the full request, reserve physical spend, persist before sending once,
 * and retain actual known usage even when a failed request may be billable. */
export async function dispatchProductionRepairV4<Observation>(
  input: RepairDispatchTransport &
    Kind & {
      readonly database: SqlDatabase;
      readonly configuration: ModelLiveBedrockHostConfigurationV2;
      readonly authorizeCommercial: () => Promise<void>;
      readonly assertCurrentDispatch: () => Promise<{ expiresAt: string }>;
      readonly recordDispatch: (
        claim: ModelPlatformReservationInput,
        receipt: ModelPlatformReservationReceipt,
      ) => Promise<{ kind: "recorded" | "duplicate" }>;
      readonly recordKnownUsage: (
        usage: NormalizedModelUsageV1,
      ) => Promise<Observation>;
      readonly signal?: AbortSignal;
    },
) {
  const details =
    input.kind === "first"
      ? { ...input, invocation: structuredClone(input.invocation) }
      : {
          ...input,
          invocation: structuredClone(input.invocation),
          reservedTokenCeiling: { ...input.reservedTokenCeiling },
        };
  const invocation = details.invocation;
  const configured =
    input.configuration.contractVersion === 1
      ? createBedrockRoutingConfigurationV1({
          configuration: input.configuration,
          asOf: new Date().toISOString(),
        })
      : prepareBedrockLiveEvaluationConfigurationV2({
          configuration: input.configuration,
          asOf: new Date().toISOString(),
        });
  const routes = configured.runtimeRoutes.filter(
    (route) =>
      route.invocationTarget === invocation.descriptor.inferenceProfileId &&
      route.modelConfigurationReference ===
        invocation.descriptor.routing.modelConfigurationReference,
  );
  const route = routes[0];
  requireDispatch(routes.length === 1 && route !== undefined);
  const current = async (signal?: AbortSignal) => {
    requireDispatch(!canceled(input.signal) && !canceled(signal));
    await input.authorizeCommercial();
    const authority = await input.assertCurrentDispatch();
    requireDispatch(!canceled(input.signal) && !canceled(signal));
    return authority;
  };
  await current();
  const reservations = new PostgresModelPlatformSpendStore({
    database: input.database,
    scope: invocation.descriptor.scope,
  });
  let startedAt: number | undefined;
  const common = {
    scope: invocation.descriptor.scope,
    httpHandler: input.httpHandler,
    beforeDispatch: current,
    reservations: {
      reserve: async (claim: ModelPlatformReservationInput) => {
        const receipt = await reservations.reserve(claim);
        requireDispatch(receipt.kind === "reserved");
        const dispatch = await input.recordDispatch(claim, receipt);
        requireDispatch(
          dispatch.kind === "recorded" && startedAt === undefined,
        );
        startedAt = Date.now();
        return receipt;
      },
    },
    createDelegate: (requestHandler: BedrockFinalHttpHandlerV1) =>
      new BedrockModelProviderAdapter({
        profile: configured.profile,
        routes: configured.runtimeRoutes,
        requestHandler,
      }),
  };
  const counted = {
    evidence: input.pricing,
    route,
    requestHandler: input.httpHandler,
    assertCurrentAuthority: current,
  };
  const invoke =
    details.kind === "first"
      ? () =>
          new PlatformSpendBoundHostSeedProviderAdapterV3({
            ...common,
            costs: new BedrockGlobalCountedHostSeedCostAuthorityV3({
              ...counted,
              invocation: details.invocation,
            }),
          }).invokeHostSeedV3(details.invocation, input.signal)
      : () =>
          new PlatformSpendBoundHostRepairSuccessorProviderAdapterV4({
            ...common,
            costs: new BedrockGlobalCountedHostRepairSuccessorCostAuthorityV4({
              ...counted,
              invocation: details.invocation,
              reservedTokenCeiling: details.reservedTokenCeiling,
            }),
          }).invokeHostRepairSuccessorV4(details.invocation, input.signal);
  const normalize = (
    providerUsage: ModelProviderUsageV1 | undefined,
    result: "succeeded" | "provider-error" | "canceled",
  ) => {
    requireDispatch(startedAt !== undefined);
    const usageInput = {
      providerUsage,
      result,
      startedAtMilliseconds: startedAt,
      completedAtMilliseconds: Date.now(),
    };
    return details.kind === "first"
      ? normalizeModelHostSeedUsageV3({
          ...usageInput,
          descriptor: details.invocation.descriptor,
        })
      : normalizeModelHostRepairSuccessorUsageV4({
          ...usageInput,
          descriptor: details.invocation.descriptor,
        });
  };
  let result: ModelProviderResultV1;
  try {
    result = await invoke();
  } catch (error) {
    if (
      startedAt !== undefined &&
      error instanceof ModelProviderInvocationError &&
      error.usage !== undefined
    )
      await input.recordKnownUsage(
        normalize(
          error.usage,
          input.signal?.aborted ? "canceled" : "provider-error",
        ),
      );
    throw new ProductionSeedDispatchError();
  }
  const observation = await input.recordKnownUsage(
    normalize(result.usage, "succeeded"),
  );
  return { result, observation };
}
