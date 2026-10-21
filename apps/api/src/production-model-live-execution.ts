import {
  modelLiveInvocationSetReferenceV2Schema,
  type ModelLiveInvocationSetReferenceV2,
} from "./adapters/persistence/model-live-invocation-set-codec.js";
import { requireSelectedModelLiveInvocationInTransaction } from "./adapters/persistence/model-live-invocation-sets.js";
import type { PinnedCompilerConfiguration } from "./adapters/pinned-go-executable.js";
import {
  BedrockModelProviderAdapter,
  ModelLiveCommercialLifecycleCoordinatorV2,
  ModelLiveRuntimeControlServiceV2,
  createBedrockRoutingConfigurationV1,
  createModelLiveEvaluationGatewayV2,
  digestStructuredValue,
  modelUsageToCommercialAttemptV1,
  prepareBedrockLiveEvaluationConfigurationV2,
  projectModelCommercialOperationIdentityV1,
  projectModelLiveGatewayClaimV2,
  projectModelLiveRuntimeExecutionIdentityV2,
  type BedrockFinalHttpHandlerV1,
  type ModelGatewayInvocationContextV1,
  type ModelLiveRuntimeControlExecutionInputV2,
  type ModelLiveRuntimeControlExecutionResultV2,
  type ModelProviderInvocationV1,
  type ModelRoutingConfigurationV1,
  type ModelRuntimeTelemetryPortV1,
  type SafeModelLogger,
} from "@cloudmarkup/model-gateway";
import { requireProductionModelLiveCaseSource } from "./production-model-live-case-source.js";
import { prepareProductionModelLiveProposalValidation } from "./production-model-live-proposal-validation.js";
import { readProductionModelLiveObservationV2 } from "./production-model-live-observation.js";
import { modelDispatchAuthorityExpiry } from "./adapters/model-platform-http-guard.js";
import { PlatformSpendBoundModelProviderAdapter } from "./adapters/model-platform-spend.js";
import { BedrockGlobalCountedInputCostAuthority } from "./adapters/bedrock-counted-global-pricing.js";
import type { BedrockGlobalPricingEvidenceV1 } from "./adapters/bedrock-global-pricing.js";
import { PostgresModelLiveCommercialAccounting } from "./adapters/persistence/model-live-commercial-accounting.js";
import {
  PostgresModelLiveCommercialPreflight,
  PostgresModelLiveCommercialReadHost,
  assertModelLiveCommercialPreflightBinding,
} from "./adapters/persistence/model-live-commercial-read-host.js";
import {
  modelReadNumber,
  parseModelLiveCommercialReadSelectors,
  type ModelLiveCommercialReadSelectorsV2,
} from "./adapters/persistence/model-commercial-read-host-codec.js";
import { PostgresModelCommercialWorkflowStore } from "./adapters/persistence/model-commercial-workflow-store.js";
import { liveJournalScope } from "./adapters/persistence/model-live-invocation-journal-codec.js";
import { PostgresModelLiveInvocationJournal } from "./adapters/persistence/model-live-invocation-journal.js";
import { PostgresModelPlatformSpendStore } from "./adapters/persistence/model-platform-spend-store.js";
import { PostgresModelLiveRuntimeAdmissionStore } from "./adapters/persistence/model-live-runtime-admission-store.js";
import { PostgresModelLiveRuntimeHostEvidence } from "./adapters/persistence/model-live-runtime-host-evidence.js";
import {
  modelLiveBedrockHostConfigurationV2Schema,
  type ModelLiveBedrockHostConfigurationV2,
} from "./adapters/persistence/model-live-runtime-host-evidence-codec.js";
import { PostgresModelLiveRoutingAuthority } from "./adapters/persistence/model-live-routing-authority.js";
import type { PostgresModelLiveEvaluationPlans } from "./adapters/persistence/model-live-evaluation-plans.js";
import { parseScope } from "./adapters/persistence/model-runtime-invocation-codec.js";
import type { SqlDatabase } from "./adapters/persistence/sql.js";

export class ProductionModelLiveExecutionError extends Error {
  readonly code = "model-live.execution-unavailable";
  constructor() {
    super("Current live evaluation execution is unavailable.");
    this.name = "ProductionModelLiveExecutionError";
  }
}
function requireLive(value: boolean): asserts value {
  if (!value) throw new ProductionModelLiveExecutionError();
}
const same = (a: unknown, b: unknown) =>
  digestStructuredValue(a) === digestStructuredValue(b);
const canceled = (signal?: AbortSignal) => signal?.aborted === true;

export interface ProductionModelLiveExecutionInputV2 {
  readonly repositoryCompiler?: PinnedCompilerConfiguration;
  readonly database: SqlDatabase;
  readonly plans: PostgresModelLiveEvaluationPlans;
  /** Final host-prepared metadata and full invocation in RAM. Its input receipt
   * must already have been issued by the actual scoped host evidence store.
   * Preparation must use current canonical prices/balance and measured input. */
  readonly prepared: {
    readonly execution: ModelLiveRuntimeControlExecutionInputV2;
    readonly context: ModelGatewayInvocationContextV1;
    readonly invocation: ModelProviderInvocationV1;
    readonly routing: ModelRoutingConfigurationV1;
  };
  readonly configuration: ModelLiveBedrockHostConfigurationV2;
  readonly resolveCurrentConfiguration: () => Promise<ModelLiveBedrockHostConfigurationV2 | null>;
  readonly commercial: {
    readonly selectors: ModelLiveCommercialReadSelectorsV2;
    readonly attestations: ConstructorParameters<
      typeof ModelLiveCommercialLifecycleCoordinatorV2
    >[0]["attestations"];
  };
  /** Exact reviewed offer; the factory owns the actual full-payload CountTokens
   * counter, ceiling calculation and final HTTP guard. No supplied cost amount. */
  readonly pricing: BedrockGlobalPricingEvidenceV1;
  readonly httpHandler: BedrockFinalHttpHandlerV1;
  readonly allowedApprovalPathIds: readonly string[];
  readonly telemetry: ModelRuntimeTelemetryPortV1;
  readonly logger: SafeModelLogger;
  readonly signal?: AbortSignal;
  readonly now?: () => Date;
}
export interface ProductionModelLiveExecutionV2 {
  /** Actual validator, usage and canonical settlement metadata only. No supplied
   * grades, provider call, body replay, complete report or model promotion. */
  observe(): ReturnType<typeof readProductionModelLiveObservationV2>;
  /** Returns metadata only. No response body is durably retained or published.
   * Completion remains pending until a genuine validator receipt is recorded. */
  execute(
    signal?: AbortSignal,
  ): Promise<ModelLiveRuntimeControlExecutionResultV2>;
}

/** Explicit host-only evaluation composition. Every authority comes from the
 * actual issued plan, durable input issuer, live runtime and canonical stores.
 * No normal activation, content queue, alternative credit ledger or deployment. */
export async function createProductionModelLiveExecutionV2(
  input: ProductionModelLiveExecutionInputV2,
): Promise<ProductionModelLiveExecutionV2> {
  return createProductionModelLiveExecution(input, undefined);
}

/** Explicit selected V2 host path. An omitted or forged set never falls back to
 * historical unselected execution. This is not a package/public API endpoint. */
export async function createProductionSelectedModelLiveExecutionV2(
  input: ProductionModelLiveExecutionInputV2 & {
    readonly invocationSet: ModelLiveInvocationSetReferenceV2;
  },
): Promise<ProductionModelLiveExecutionV2> {
  return createProductionModelLiveExecution(
    input,
    modelLiveInvocationSetReferenceV2Schema.parse(input.invocationSet),
  );
}
async function createProductionModelLiveExecution(
  input: ProductionModelLiveExecutionInputV2,
  selectedInvocationSet: ModelLiveInvocationSetReferenceV2 | undefined,
): Promise<ProductionModelLiveExecutionV2> {
  const prepared = structuredClone(input.prepared);
  const { execution, context, invocation, routing } = prepared;
  const configuration = modelLiveBedrockHostConfigurationV2Schema.parse(
    input.configuration,
  );
  const selectors = parseModelLiveCommercialReadSelectors(
    input.commercial.selectors,
  );
  const allowedApprovalPathIds = [...input.allowedApprovalPathIds];
  const runtimeIdentity = projectModelLiveRuntimeExecutionIdentityV2(execution);
  const scope = parseScope(invocation.descriptor.scope);
  const request = execution.commercialRequest;
  const admission = execution.admissionRequest;
  const reference = {
    definitionId: execution.plan.definition.definitionId,
    planDigest: execution.plan.planDigest,
  };
  const caseId = admission.evaluationCaseId;
  const now = input.now ?? (() => new Date());
  requireLive(scope.projectId !== undefined && scope.jobId !== undefined);
  const evidence = new PostgresModelLiveRuntimeHostEvidence({
    plans: input.plans,
    scope,
    configuration,
    ...reference,
    caseId,
  });
  const authority = new PostgresModelLiveRoutingAuthority({
    plans: input.plans,
    evidence,
    configuration,
    resolveCurrentConfiguration: input.resolveCurrentConfiguration,
    context,
    invocation,
    routing,
    inputEvidence: execution.inputEvidence,
    ...reference,
    caseId,
  });
  async function authorize(signal?: AbortSignal) {
    requireLive(!canceled(input.signal) && !canceled(signal));
    await authority.resolve({
      candidate: {
        plan: execution.plan,
        routingDecision: execution.routingDecision,
        routingRequest: execution.routingRequest,
      },
      request: admission,
      inputEvidence: execution.inputEvidence,
      purpose: "execution",
    });
    const expiresAt = await input.plans.withIssuedMetadata(
      reference,
      async ({ plan, principal, transaction, requireCurrentApproval }) => {
        await requireCurrentApproval();
        requireLive(same(plan, execution.plan));
        if (selectedInvocationSet !== undefined) {
          await requireSelectedModelLiveInvocationInTransaction({
            transaction,
            plan,
            reference: selectedInvocationSet,
            selected: {
              caseId,
              caseDigest: admission.evaluationCaseDigest,
              invocationId: invocation.descriptor.invocationId,
            },
          });
        }
        return new Date(
          Math.min(Date.parse(plan.expiresAt), Date.parse(principal.expiresAt)),
        ).toISOString();
      },
    );
    const expiry = modelDispatchAuthorityExpiry({ expiresAt });
    requireLive(
      expiry !== null &&
        now().getTime() < expiry &&
        !canceled(input.signal) &&
        !canceled(signal),
    );
    return { expiresAt };
  }
  await authorize();
  requireProductionModelLiveCaseSource({
    evaluationCase: await input.plans.requireCurrentCase({
      ...reference,
      caseId,
    }),
    invocation,
  });
  const preparation = await authority.authorize({
    phase: "invoke",
    request: invocation.request,
    context,
    routingConfigurationDigest: digestStructuredValue(routing),
  });
  const configured =
    configuration.contractVersion === 1
      ? createBedrockRoutingConfigurationV1({
          configuration,
          asOf: preparation.observedAt,
        })
      : prepareBedrockLiveEvaluationConfigurationV2({
          configuration,
          asOf: preparation.observedAt,
        });
  const proposalValidation = await prepareProductionModelLiveProposalValidation(
    {
      plans: input.plans,
      ...(input.repositoryCompiler === undefined
        ? {}
        : { repositoryCompiler: input.repositoryCompiler }),
      invocation,
      context,
      execution,
      allowedApprovalPathIds,
    },
  );
  const claim = projectModelLiveGatewayClaimV2({
    preparation,
    context,
    request: invocation.request,
    routing,
    adapterProfiles: [configured.profile],
    allowedApprovalPathIds,
  });
  requireLive(
    claim.inputDigest === invocation.descriptor.inputDigest &&
      claim.invocationId === invocation.descriptor.invocationId &&
      claim.idempotencyKeyDigest ===
        invocation.descriptor.idempotencyKeyDigest &&
      same(execution.routingRequest, context.routingRequest) &&
      same(execution.routingDecision, context.routingDecision) &&
      invocation.descriptor.routing?.effort ===
        execution.routingDecision.effort,
  );
  const readInput = {
    database: input.database,
    plans: input.plans,
    ...reference,
    caseId,
    descriptor: invocation.descriptor,
    selectors,
  };
  const preflight = await new PostgresModelLiveCommercialPreflight(
    readInput,
  ).read();
  assertModelLiveCommercialPreflightBinding(preflight, execution);
  requireLive(
    preflight.featureEnabled &&
      now().getTime() < Date.parse(preflight.expiresAt) &&
      context.entitlement.planVersionId ===
        preflight.entitlement.planVersionId &&
      context.budget.availableCreditUnits ===
        modelReadNumber(preflight.balance.availableCreditUnits),
  );
  const workflowIdentity = projectModelCommercialOperationIdentityV1(request);
  const accountingBinding = {
    workflowId: request.multiCallWorkflowId,
    workflowFingerprint: workflowIdentity.fingerprint,
    runtimeScopeDigest: runtimeIdentity.tenantScopeDigest,
    runtimeFingerprint: runtimeIdentity.fingerprint,
    routingDecision: execution.routingDecision,
  };
  const binding = {
    contractVersion: 2 as const,
    scope,
    requestDigest: digestStructuredValue(request),
    runtimeRequestDigest: admission.requestDigest,
    accountingBindingDigest: digestStructuredValue(accountingBinding),
    liveEvaluationPlanDigest: admission.liveEvaluationPlanDigest,
    liveEvaluationAuthorityDigest: admission.liveEvaluationAuthorityDigest,
    evaluationCaseId: caseId,
    evaluationCaseDigest: admission.evaluationCaseDigest,
    invocationId: claim.invocationId,
    claimAuthorityDigest: claim.authorityDigest,
    inputDigest: claim.inputDigest,
    idempotencyKeyDigest: claim.idempotencyKeyDigest,
  };
  const commercialScope = liveJournalScope(binding);
  const journal = new PostgresModelLiveInvocationJournal({
    ...(selectedInvocationSet === undefined ? {} : { selectedInvocationSet }),
    binding,
    request,
    admissionRequest: admission,
    accountingBinding,
    plans: input.plans,
    definitionId: reference.definitionId,
  });
  const accounting = new PostgresModelLiveCommercialAccounting({
    database: input.database,
    plans: input.plans,
    scope: commercialScope,
    binding: accountingBinding,
    ...reference,
  });
  const readers = new PostgresModelLiveCommercialReadHost({
    ...readInput,
    runtime: execution,
  });
  const commercial = new ModelLiveCommercialLifecycleCoordinatorV2({
    commercialRequest: request,
    admissionRequest: admission,
    attestations: input.commercial.attestations,
    pricing: readers,
    accounting,
    now: () => now().toISOString(),
    authorization: {
      resolve: async (candidate) => {
        await authorize();
        return readers.resolve(candidate);
      },
    },
    scopeResolver: {
      resolve: async (candidate) => {
        await authorize();
        requireLive(
          candidate.organizationId === scope.organizationId &&
            candidate.projectId === scope.projectId &&
            candidate.userId === scope.userId,
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
    requireLive(current !== undefined);
    const host = await authorize(signal);
    const runtime = await current();
    requireLive(dispatchAuthority === current && !signal.aborted);
    return {
      expiresAt: new Date(
        Math.min(Date.parse(host.expiresAt), Date.parse(runtime.expiresAt)),
      ).toISOString(),
    };
  };
  const routes = configured.runtimeRoutes.filter(
    (route) =>
      route.invocationTarget === invocation.descriptor.inferenceProfileId &&
      route.modelConfigurationReference ===
        invocation.descriptor.routing?.modelConfigurationReference,
  );
  const route = routes[0];
  requireLive(routes.length === 1 && route !== undefined);
  const costs = new BedrockGlobalCountedInputCostAuthority({
    evidence: input.pricing,
    route,
    invocation,
    now,
    requestHandler: input.httpHandler,
    assertCurrentAuthority: assertCurrentDispatch,
  });
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
      new BedrockModelProviderAdapter({
        profile: configured.profile,
        routes: configured.runtimeRoutes,
        requestHandler,
      }),
  });
  const gateway = createModelLiveEvaluationGatewayV2({
    logger: input.logger,
    routing,
    routeRegistry: configured.routeRegistry,
    liveAuthority: authority,
    allowedApprovalPathIds,
    maximumInputBytes:
      execution.plan.definition.policy.limits.maximumPromptBytes,
    maximumOutputBytes: invocation.maximumOutputBytes,
    adapters: [
      {
        profile: spending.profile,
        invoke: async (actual, signal) => {
          requireLive(same(actual, invocation));
          await authorize(signal);
          return spending.invoke(actual, signal);
        },
      },
    ],
    invocationStore: journal,
    usageRecorder: journal,
    invalidProposalStore: {
      preserveRestricted: () =>
        Promise.reject(new ProductionModelLiveExecutionError()),
    },
  });
  const runtime = new ModelLiveRuntimeControlServiceV2({
    authorityResolver: authority,
    commercial,
    evidenceVerifier: evidence,
    store: new PostgresModelLiveRuntimeAdmissionStore({
      database: input.database,
      scope: {
        organizationId: commercialScope.organizationId,
        projectId: commercialScope.projectId,
        userId: commercialScope.userId,
      },
      plans: input.plans,
      ...reference,
    }),
    telemetry: input.telemetry,
    now: () => now().toISOString(),
  });
  await authorize();
  let executing = false;
  return {
    observe: () =>
      readProductionModelLiveObservationV2({
        journal,
        accounting,
        request,
        admissionRequest: admission,
        authorize: async () => {
          await authorize();
        },
      }),
    execute: async (signal) => {
      requireLive(!executing);
      executing = true;
      const signals = [input.signal, signal].filter(
        (s): s is AbortSignal => s !== undefined,
      );
      const controller = new AbortController();
      const abort = () => {
        controller.abort();
      };
      for (const source of signals) {
        source.addEventListener("abort", abort, { once: true });
        if (source.aborted) abort();
      }
      try {
        await authorize(controller.signal);
        return await runtime.execute(execution, async (admitted) => {
          requireLive(
            dispatchAuthority === undefined &&
              typeof admitted.assertCurrentDispatch === "function" &&
              typeof admitted.assertCurrentExecution === "function",
          );
          const assertCurrentExecution = admitted.assertCurrentExecution;
          dispatchAuthority = admitted.assertCurrentDispatch;
          try {
            await authorize(controller.signal);
            await assertCurrentExecution();
            await journal.prepare(admitted.commercial);
            await assertCurrentExecution();
            const result = await gateway.invoke(
              invocation.request,
              context,
              controller.signal,
            );
            await authorize(controller.signal);
            const output = await evidence.issueOutput({
              invocation,
              result,
              journal,
            });
            await assertCurrentExecution();
            if (proposalValidation !== null) {
              await proposalValidation.issue({
                plans: input.plans,
                evidence,
                journal,
                result,
                signal: controller.signal,
                authorize: async () => {
                  await authorize(controller.signal);
                  await assertCurrentExecution();
                },
              });
              await authorize(controller.signal);
              await assertCurrentExecution();
            }
            // The coordinator independently authenticates the actual journal and
            // receipt before canonical settlement. Unsupported cases stay held.
            return {
              commercial: {
                attempts: [modelUsageToCommercialAttemptV1(result.usage)],
                completedAt: result.usage.completedAt,
                failureCategory: null,
                resultId:
                  "result_" +
                  digestStructuredValue({
                    invocationId: claim.invocationId,
                    multiCallWorkflowId: request.multiCallWorkflowId,
                  }).slice(7, 55),
                status: "completed",
                usefulOutputDelivered: true,
              },
              output,
            };
          } finally {
            dispatchAuthority = undefined;
          }
        });
      } finally {
        dispatchAuthority = undefined;
        for (const source of signals)
          source.removeEventListener("abort", abort);
        executing = false;
      }
    },
  };
}
