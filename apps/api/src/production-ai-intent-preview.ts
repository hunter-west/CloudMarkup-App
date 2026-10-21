import {
  BedrockModelProviderAdapter,
  ModelCommercialLifecycleCoordinator,
  ModelRuntimeControlServiceV1,
  ProviderNeutralModelGateway,
  digestStructuredValue,
  projectModelCommercialOperationIdentityV1,
  projectModelRuntimeExecutionIdentityV1,
  type AmazonBedrockCapabilityProfileV1,
  type BedrockFinalHttpHandlerV1,
  type BedrockRuntimeRouteV1,
  type ModelCommercialVerifiedScopeV1,
  type ModelProviderInvocationV1,
  type ModelRuntimeControlServiceDependenciesV1,
  type ProviderNeutralModelGatewayDependencies,
} from "@cloudmarkup/model-gateway";
import type { ModelRuntimeInputEvidenceV1 } from "@cloudmarkup/schemas";
import { modelDispatchAuthorityExpiry } from "./adapters/model-platform-http-guard.js";
import {
  PlatformSpendBoundModelProviderAdapter,
  type ModelDispatchCostCeilingPort,
} from "./adapters/model-platform-spend.js";
import { PostgresAiIntentPreviewJournal } from "./adapters/persistence/ai-intent-preview.js";
import { acknowledgeExistingAiIntentPreview } from "./adapters/persistence/ai-intent-preview-acknowledgement.js";
import {
  PreviewRequestAuthority,
  type AiIntentPreviewRequestAuthorityV1,
} from "./adapters/persistence/ai-intent-preview-request-authority.js";
import { PostgresModelCommercialReservations } from "./adapters/persistence/model-commercial-accounting.js";
import { PostgresModelCommercialReadHost } from "./adapters/persistence/model-commercial-read-host.js";
import {
  modelReadNumber,
  parseModelCommercialReadSelectors,
  type ModelCommercialReadSelectorsV1,
} from "./adapters/persistence/model-commercial-read-host-codec.js";
import {
  PostgresModelCommercialPreflight,
  assertModelCommercialPreflightBinding,
  type ModelCommercialPreflightSnapshotV1,
} from "./adapters/persistence/model-commercial-snapshot.js";
import { PostgresModelCommercialWorkflowStore } from "./adapters/persistence/model-commercial-workflow-store.js";
import { parseWorkflowScope } from "./adapters/persistence/model-commercial-workflow-codec.js";
import { PostgresModelPlatformSpendStore } from "./adapters/persistence/model-platform-spend-store.js";
import { PostgresModelRuntimeAdmissionStore } from "./adapters/persistence/model-runtime-admission-store.js";
import { PostgresIntentRuntimeHostEvidence } from "./adapters/persistence/model-runtime-host-evidence.js";
import { parseScope } from "./adapters/persistence/model-runtime-invocation-codec.js";
import type { SqlDatabase } from "./adapters/persistence/sql.js";
import { BedrockGlobalCountedInputCostAuthority } from "./adapters/bedrock-counted-global-pricing.js";
import type { BedrockGlobalPricingEvidenceV1 } from "./adapters/bedrock-global-pricing.js";
import {
  AiIntentPreviewApplication,
  aiIntentPreviewBindingV1,
  type AiIntentPreviewResolvedV1,
} from "./application/ai-intent-preview.js";
import {
  AiIntentPreviewError,
  type AiIntentPreviewDeliveryProofV1,
} from "./application/ai-intent-preview-journal.js";

type CoordinatorInput = ConstructorParameters<
  typeof ModelCommercialLifecycleCoordinator
>[0];
type ExecuteInput = Omit<
  Parameters<AiIntentPreviewApplication["execute"]>[0],
  "resolved"
>;
export interface ProductionAiIntentPreviewV1 {
  execute(
    input: ExecuteInput,
  ): ReturnType<AiIntentPreviewApplication["execute"]>;
  /** Internal authenticated-host closure, not a public ACK endpoint. */
  acknowledge(proof: AiIntentPreviewDeliveryProofV1): Promise<void>;
}
export interface ProductionAiIntentPreviewInputV1 {
  readonly database: SqlDatabase;
  /** Required original verified session and exact mutable baseline/tab proof.
   * Never reconstruct this context from a browser-supplied ownership object. */
  readonly requestAuthority: AiIntentPreviewRequestAuthorityV1;
  readonly scope: ModelCommercialVerifiedScopeV1;
  /** Exact complete request in RAM. The final provider boundary checks equality. */
  readonly invocation: ModelProviderInvocationV1;
  readonly host: {
    /** Current session, tenant/project, baseline and editing-lease proof. The
     * trusted host owns those credentials in RAM; no payload boolean suffices. */
    assertCurrentAuthority(): Promise<{ readonly expiresAt: string }>;
    /** Required reviewed route/entitlement/evaluation/policy assembly. The input
     * evidence is issued by the real durable deterministic verifier below. */
    resolve(input: {
      readonly inputEvidence: ModelRuntimeInputEvidenceV1;
      /** Canonical observation only; does not supply usage bounds, consent,
       * evaluation, promotion or current runtime authority. */
      readonly commercialSnapshot: ModelCommercialPreflightSnapshotV1;
    }): Promise<AiIntentPreviewResolvedV1>;
  };
  readonly commercial: Pick<CoordinatorInput, "attestations"> & {
    /** Exact host-configured canonical row/policy selectors, never caller rates
     * or injected permission decisions. The factory constructs real readers. */
    readonly selectors: ModelCommercialReadSelectorsV1;
  };
  readonly runtime: Pick<
    ModelRuntimeControlServiceDependenciesV1,
    "authorityResolver" | "telemetry"
  >;
  readonly costs:
    | ModelDispatchCostCeilingPort
    | {
        /** Trusted reviewed configuration, never an amount or receipt from the browser.
         * The factory binds its counter to the exact invocation and current runtime,
         * commercial, session, project, baseline and editing-lease authority. */
        readonly kind: "bedrock-counted-global-v1";
        readonly evidence: BedrockGlobalPricingEvidenceV1;
      };
  readonly httpHandler: BedrockFinalHttpHandlerV1;
  readonly bedrock: {
    readonly profile: AmazonBedrockCapabilityProfileV1;
    readonly routes: readonly BedrockRuntimeRouteV1[];
  };
  readonly gateway: Pick<
    ProviderNeutralModelGatewayDependencies,
    "logger" | "routing" | "routeRegistry" | "routingDecisionEvaluator"
  > & {
    readonly maximumInputBytes: number;
  };
  readonly signal?: AbortSignal;
  readonly now?: () => Date;
}
function requirePreview(condition: boolean): asserts condition {
  if (!condition) throw new AiIntentPreviewError();
}
const same = (left: unknown, right: unknown) =>
  digestStructuredValue(left) === digestStructuredValue(right);
const canceled = (signal?: AbortSignal) => signal?.aborted === true;
const isDisabled = (value: unknown) => value === false;

/** Real metadata-only composition; no queued content, result objects, reference
 * stores, policy seeds or activation defaults. Normal real-model admission is
 * still denied by the runtime until separately reviewed current promotion
 * authority exists. Construction issues only deterministic input metadata after
 * current host authorization. It never reserves credits or invokes a provider. */
export async function createProductionAiIntentPreview(
  input: ProductionAiIntentPreviewInputV1,
): Promise<ProductionAiIntentPreviewV1> {
  const commercialScope = parseWorkflowScope(input.scope);
  const invocation = structuredClone(input.invocation);
  const selectors = parseModelCommercialReadSelectors(
    input.commercial.selectors,
  );
  const scope = parseScope(invocation.descriptor.scope);
  const requestAuthority = new PreviewRequestAuthority(input.requestAuthority);
  const original = requestAuthority.value;
  requirePreview(
    scope.projectId !== undefined &&
      scope.jobId !== undefined &&
      scope.organizationId === commercialScope.organizationId &&
      scope.projectId === commercialScope.projectId &&
      scope.userId === commercialScope.userId,
  );
  requirePreview(original.principal.principalId === scope.userId);
  const now = input.now ?? (() => new Date());
  async function authorize(signal?: AbortSignal) {
    requirePreview(!canceled(input.signal) && !canceled(signal));
    const proof = await input.host.assertCurrentAuthority();
    const expiresAt = modelDispatchAuthorityExpiry(proof);
    requirePreview(expiresAt !== null);
    requirePreview(!canceled(input.signal) && !canceled(signal));
    requirePreview(now().getTime() < expiresAt);
    let authorityExpiry = Math.min(
      expiresAt,
      Date.parse(original.principal.expiresAt),
    );
    requirePreview(now().getTime() < authorityExpiry);
    const current = await input.database.transaction((tx) =>
      requestAuthority.assertCurrent(tx, scope),
    );
    authorityExpiry = Math.min(authorityExpiry, Date.parse(current.expiresAt));
    requirePreview(
      !canceled(input.signal) &&
        !canceled(signal) &&
        now().getTime() < authorityExpiry,
    );
    return new Date(authorityExpiry).toISOString();
  }
  await authorize();
  const evidence = new PostgresIntentRuntimeHostEvidence({
    database: input.database,
    scope,
  });
  const issued = await evidence.issueInput(invocation);
  await authorize();
  const commercialSnapshot = await new PostgresModelCommercialPreflight({
    database: input.database,
    requestAuthority: original,
    descriptor: invocation.descriptor,
    selectors,
  }).read();
  await authorize();
  requirePreview(
    commercialSnapshot.featureEnabled &&
      now().getTime() < Date.parse(commercialSnapshot.expiresAt),
  );
  const resolved = structuredClone(
    await input.host.resolve({
      inputEvidence: structuredClone(issued),
      commercialSnapshot: structuredClone(commercialSnapshot),
    }),
  );
  await authorize();
  const binding = aiIntentPreviewBindingV1(resolved);
  const request = resolved.runtime.commercialRequest;
  const runtimeIdentity = projectModelRuntimeExecutionIdentityV1(
    resolved.runtime,
  );
  const workflowIdentity = projectModelCommercialOperationIdentityV1(request);
  requirePreview(
    same(binding.scope, scope) &&
      same(resolved.runtime.inputEvidence, issued) &&
      same(invocation.request, resolved.modelRequest) &&
      binding.invocationId === invocation.descriptor.invocationId &&
      binding.inputDigest === invocation.descriptor.inputDigest &&
      binding.idempotencyKeyDigest ===
        invocation.descriptor.idempotencyKeyDigest &&
      request.requestedRoute === "standard" &&
      request.feature === "intent.extract" &&
      request.plannedCalls.length === 1 &&
      request.plannedCalls[0]?.kind === "primary" &&
      resolved.runtime.routingDecision.maximumAttempts === 1 &&
      isDisabled(
        resolved.runtime.routingDecision.automaticEscalationPermitted,
      ) &&
      isDisabled(resolved.runtime.routingDecision.promptCachePolicy.enabled) &&
      resolved.runtime.admissionRequest.requested.repairAttempts === 0 &&
      invocation.promptCacheKey === undefined &&
      isDisabled(invocation.promptCachePolicy.enabled),
  );
  requirePreview(same(resolved.baseline, original.baseline));
  requirePreview(now().getTime() < Date.parse(commercialSnapshot.expiresAt));
  assertModelCommercialPreflightBinding(commercialSnapshot, resolved.runtime);
  requirePreview(
    resolved.context.entitlement.planVersionId ===
      commercialSnapshot.entitlement.planVersionId &&
      resolved.context.budget.availableCreditUnits ===
        modelReadNumber(commercialSnapshot.balance.availableCreditUnits),
  );
  await authorize();
  const journal = new PostgresAiIntentPreviewJournal({
    database: input.database,
    binding,
    requestAuthority: original,
  });
  const accounting = new PostgresModelCommercialReservations({
    database: input.database,
    scope: commercialScope,
    binding: {
      workflowId: request.multiCallWorkflowId,
      workflowFingerprint: workflowIdentity.fingerprint,
      runtimeScopeDigest: runtimeIdentity.tenantScopeDigest,
      runtimeFingerprint: runtimeIdentity.fingerprint,
    },
  });
  const commercialRead = new PostgresModelCommercialReadHost({
    database: input.database,
    requestAuthority: original,
    runtime: resolved.runtime,
    descriptor: invocation.descriptor,
    selectors,
  });
  const commercial = new ModelCommercialLifecycleCoordinator({
    attestations: input.commercial.attestations,
    pricing: commercialRead,
    accounting,
    now: () => now().toISOString(),
    authorization: {
      resolve: async (candidate) => {
        await authorize();
        return commercialRead.resolve(candidate);
      },
    },
    scopeResolver: {
      resolve: async (candidate) => {
        await authorize();
        requirePreview(
          candidate.organizationId === commercialScope.organizationId &&
            candidate.projectId === commercialScope.projectId &&
            candidate.userId === commercialScope.userId,
        );
        return structuredClone(commercialScope);
      },
    },
    workflows: new PostgresModelCommercialWorkflowStore({
      database: input.database,
      scope: commercialScope,
    }),
    invocationRecovery: journal,
    terminalRecovery: accounting,
  });
  let dispatchAuthority:
    (() => Promise<{ readonly expiresAt: string }>) | undefined;
  const assertCurrentDispatch = async (signal: AbortSignal) => {
    const current = dispatchAuthority;
    requirePreview(current !== undefined);
    const hostExpiresAt = await authorize(signal);
    const runtime = await current();
    requirePreview(dispatchAuthority === current && !signal.aborted);
    return {
      expiresAt: new Date(
        Math.min(Date.parse(hostExpiresAt), Date.parse(runtime.expiresAt)),
      ).toISOString(),
    };
  };
  let costs: ModelDispatchCostCeilingPort;
  if ("kind" in input.costs) {
    const routes = input.bedrock.routes.filter(
      (route) =>
        route.invocationTarget === invocation.descriptor.inferenceProfileId &&
        route.modelConfigurationReference ===
          invocation.descriptor.routing?.modelConfigurationReference,
    );
    const route = routes[0];
    requirePreview(routes.length === 1 && route !== undefined);
    costs = new BedrockGlobalCountedInputCostAuthority({
      evidence: input.costs.evidence,
      route,
      invocation,
      now,
      requestHandler: input.httpHandler,
      assertCurrentAuthority: assertCurrentDispatch,
    });
  } else {
    costs = input.costs;
  }
  const spending = new PlatformSpendBoundModelProviderAdapter({
    costs,
    httpHandler: input.httpHandler,
    now,
    scope,
    beforeDispatch: assertCurrentDispatch,
    reservations: new PostgresModelPlatformSpendStore({
      database: input.database,
      scope,
    }),
    createDelegate: (requestHandler) =>
      new BedrockModelProviderAdapter({ ...input.bedrock, requestHandler }),
  });
  const gateway = new ProviderNeutralModelGateway({
    ...input.gateway,
    allowedApprovalPathIds: [],
    maximumAttempts: 1,
    maximumOutputBytes: invocation.maximumOutputBytes,
    adapters: [
      {
        profile: spending.profile,
        invoke: async (actual, signal) => {
          requirePreview(same(actual, invocation));
          await authorize(signal);
          return spending.invoke(actual, signal);
        },
      },
    ],
    invocationStore: journal,
    usageRecorder: journal,
    invalidProposalStore: {
      preserveRestricted: () => Promise.reject(new AiIntentPreviewError()),
    },
  });
  const runtime = new ModelRuntimeControlServiceV1({
    ...input.runtime,
    commercial,
    evidenceVerifier: evidence,
    store: new PostgresModelRuntimeAdmissionStore({
      database: input.database,
      scope: {
        organizationId: scope.organizationId,
        projectId: commercialScope.projectId,
        userId: scope.userId,
      },
    }),
    now: () => now().toISOString(),
  });
  const application = new AiIntentPreviewApplication({
    now,
    gateway,
    journal,
    evidenceVerifier: evidence,
    runtime: {
      execute: (candidate, invoke) =>
        runtime.execute(candidate, async (context) => {
          requirePreview(
            dispatchAuthority === undefined &&
              typeof context.assertCurrentDispatch === "function",
          );
          dispatchAuthority = context.assertCurrentDispatch;
          try {
            return await invoke(context);
          } finally {
            dispatchAuthority = undefined;
          }
        }),
    },
    host: {
      assertCurrentAuthority: async (candidate) => {
        requirePreview(same(candidate, resolved));
        await authorize();
      },
      issueOutputEvidence: async ({ result }) => {
        await authorize();
        return evidence.issueOutput({
          invocation,
          result: {
            descriptor: result.descriptor,
            response: result.response,
            redaction: result.redaction,
            usage: result.usage,
          },
          catalogDigest: resolved.runtime.catalogDigest,
          responseSchemaDigest: resolved.runtime.responseSchemaDigest,
          runtimePolicyDigest: resolved.runtime.policy.policyDigest,
        });
      },
    },
  });
  return {
    execute: async (call) => {
      const signals = [input.signal, call.signal].filter(
        (signal): signal is AbortSignal => signal !== undefined,
      );
      const controller = new AbortController();
      const abort = () => {
        controller.abort();
      };
      for (const signal of signals) {
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      }
      try {
        await authorize(controller.signal);
        return await application.execute({
          ...call,
          resolved,
          signal: controller.signal,
        });
      } finally {
        for (const signal of signals)
          signal.removeEventListener("abort", abort);
      }
    },
    acknowledge: async (proof) => {
      await authorize();
      await acknowledgeExistingAiIntentPreview({
        database: input.database,
        principal: original.principal,
        projectId: commercialScope.projectId,
        editingProof: original.editingProof,
        proof,
      });
      await authorize();
    },
  };
}

/** Independent authenticated ACK host entry; no original model/input closure,
 * runtime admission, reservation or provider adapter is constructed. */
export { acknowledgeExistingAiIntentPreview as acknowledgeProductionAiIntentPreview } from "./adapters/persistence/ai-intent-preview-acknowledgement.js";
