import { attemptStatus, commercialUnits } from "./commercial-usage-units.js";
import type { NormalizedModelUsageV1 } from "@cloudmarkup/schemas";

import type {
  ModelCommercialInvocationAttemptV1,
  ModelCommercialInvocationContextV1,
  ModelCommercialInvocationResultV1,
  ModelCommercialLifecycleResponseV1,
  ModelCommercialOperationRequestV1,
} from "./commercial-lifecycle.js";
import { ModelCommercialLifecycleCoordinator } from "./commercial-lifecycle.js";
import type { ModelGatewayInvocationContextV1 } from "./ports.js";
import { digestStructuredValue } from "./security.js";
import { reviewedModelPromptRegistry } from "./prompts/registry.js";
import type {
  SolutionProposalPlannerRequestV1,
  SolutionProposalPlannerResultV1,
} from "./solution-planner.js";

export interface SolutionPlanningUsageEvidenceSourceV1 {
  listByMultiCallWorkflowId(
    multiCallWorkflowId: string,
  ): Promise<readonly NormalizedModelUsageV1[]>;
}

export interface SolutionPlanningResultEvidenceStoreV1 {
  loadCompleted(
    multiCallWorkflowId: string,
  ): Promise<SolutionProposalPlannerResultV1 | null>;
  saveCompleted(
    multiCallWorkflowId: string,
    result: SolutionProposalPlannerResultV1,
  ): Promise<void>;
}

export interface ModelSolutionCommercialIssueV1 {
  readonly category:
    | "commercial-denial"
    | "provider-unavailable"
    | "reconciliation-required"
    | "proposal-rejected";
  readonly code: string;
  readonly severity: "warning" | "blocking";
}

export interface ModelSolutionCommercialExecutionV1 {
  readonly commercial: ModelCommercialLifecycleResponseV1;
  readonly issues: readonly ModelSolutionCommercialIssueV1[];
  readonly plannerResult: SolutionProposalPlannerResultV1 | null;
}

export interface SolutionPlanningExecutionPortV1 {
  propose(
    request: SolutionProposalPlannerRequestV1,
    signal?: AbortSignal,
  ): Promise<SolutionProposalPlannerResultV1>;
}

export interface ModelSolutionCommercialServiceDependenciesV1 {
  readonly clock?: { now(): Date };
  readonly commercial: ModelCommercialLifecycleCoordinator;
  readonly planner: SolutionPlanningExecutionPortV1;
  readonly resultEvidence: SolutionPlanningResultEvidenceStoreV1;
  readonly usageEvidence: SolutionPlanningUsageEvidenceSourceV1;
}

function routeKind(
  context: ModelGatewayInvocationContextV1,
): "standard" | "deep" {
  const routeId = context.routingDecision?.routeId;
  if (routeId === "standard-design") return "standard";
  if (routeId === "deep-design" || routeId === "internal-escalation") {
    return "deep";
  }
  throw new Error("Trusted model routing decision is required.");
}

function assertOperationBinding(input: {
  readonly commercial: ModelCommercialOperationRequestV1;
  readonly planner: SolutionProposalPlannerRequestV1;
}): void {
  const context = input.planner.gatewayContext;
  const model = input.planner.modelRequest;
  const prompt = reviewedModelPromptRegistry.get("operations.propose");
  const decision = context.routingDecision;
  const expectedCallCount = 1 + input.planner.maximumRepairAttempts;
  if (
    prompt === null ||
    decision?.outcome !== "selected" ||
    input.commercial.feature !== "operations.propose" ||
    input.commercial.jobId !== context.scope.jobId ||
    input.commercial.organizationId !== context.scope.organizationId ||
    input.commercial.projectId !== context.scope.projectId ||
    input.commercial.userId !== context.scope.userId ||
    input.commercial.promptId !== prompt.templateId ||
    input.commercial.promptVersion !== prompt.version ||
    input.commercial.requestedRoute !== routeKind(context) ||
    input.commercial.plannedCalls.length !== expectedCallCount ||
    input.commercial.plannedCalls[0]?.kind !== "primary" ||
    input.commercial.plannedCalls
      .slice(1)
      .some((call) => call.kind !== "repair") ||
    decision.feature !== model.operation ||
    decision.requestedMode !== model.requestedMode
  ) {
    throw new Error(
      "Commercial, repair, route, prompt, tenant, and planning authority must match.",
    );
  }
}

function assertCallbackRouteBinding(
  callback: ModelCommercialInvocationContextV1,
  context: ModelGatewayInvocationContextV1,
): void {
  const decision = context.routingDecision;
  if (
    callback.route.route !== routeKind(context) ||
    callback.route.routeId !== decision?.routeId ||
    callback.route.modelId !== decision.modelId ||
    callback.route.modelVersion !== decision.modelVersion ||
    callback.route.inferenceProfileId !== decision.inferenceProfileId ||
    callback.route.providerKey !== decision.providerId
  ) {
    throw new Error(
      "Reserved commercial route does not match trusted solution planning.",
    );
  }
}

function assertUsageBinding(input: {
  readonly plannerRequest: SolutionProposalPlannerRequestV1;
  readonly usage: readonly NormalizedModelUsageV1[];
}): void {
  const context = input.plannerRequest.gatewayContext;
  const decision = context.routingDecision;
  const prompt = reviewedModelPromptRegistry.get("operations.propose");
  if (decision?.outcome !== "selected" || prompt === null) {
    throw new Error(
      "Trusted route and prompt authority are required for usage.",
    );
  }
  input.usage.forEach((record, index) => {
    if (
      record.feature !== "operations.propose" ||
      record.promptTemplateId !== prompt.templateId ||
      record.promptVersion !== prompt.version ||
      record.providerId !== decision.providerId ||
      record.modelId !== decision.modelId ||
      record.modelVersion !== decision.modelVersion ||
      record.inferenceProfileId !== decision.inferenceProfileId ||
      digestStructuredValue(record.scope) !==
        digestStructuredValue(context.scope) ||
      (index === 0 && record.invocationId !== context.invocationId)
    ) {
      throw new Error(
        "Normalized usage does not match the reserved planning invocation.",
      );
    }
  });
}

function recordedAttempts(
  usage: readonly NormalizedModelUsageV1[],
): readonly ModelCommercialInvocationAttemptV1[] {
  const ordered = [...usage].sort(
    (left, right) =>
      Date.parse(left.startedAt) - Date.parse(right.startedAt) ||
      left.invocationId.localeCompare(right.invocationId) ||
      left.attemptNumber - right.attemptNumber,
  );
  return ordered.map((record, index) => {
    const attemptNumber = index + 1;
    const previous = ordered[index - 1];
    return {
      attemptId: `${record.invocationId}.attempt.${String(record.attemptNumber)}`,
      attemptKind: attemptNumber === 1 ? "primary" : "repair",
      attemptNumber,
      callId: `${record.invocationId}.call.${String(record.attemptNumber)}`,
      completedAt: record.completedAt,
      failureCategory:
        record.result === "succeeded" ? null : `model-gateway.${record.result}`,
      inferenceProfileId: record.inferenceProfileId ?? null,
      invocationId: record.invocationId,
      latencyMilliseconds: record.durationMilliseconds,
      mayHaveBeenProcessed: true,
      modelId: record.modelId,
      modelVersion: record.modelVersion,
      promptId: record.promptTemplateId,
      promptVersion: record.promptVersion,
      providerKey: record.providerId,
      providerRequestId: record.providerRequestId ?? null,
      retryOfAttemptId:
        previous === undefined
          ? null
          : `${previous.invocationId}.attempt.${String(previous.attemptNumber)}`,
      routeId: record.routing?.routeId ?? "unrouted",
      startedAt: record.startedAt,
      status: attemptStatus(record.result),
      usage: commercialUnits(record),
      usageRecordId: record.usageRecordId,
    };
  });
}

function safeErrorCode(error: unknown, signal?: AbortSignal): string {
  if (signal?.aborted === true) return "model-provider.canceled";
  if (typeof error !== "object" || error === null) {
    return "model-gateway.internal-error";
  }
  if ("code" in error && typeof error.code === "string") return error.code;
  return "safeCode" in error && typeof error.safeCode === "string"
    ? error.safeCode
    : "model-gateway.internal-error";
}

function invocationStatus(
  code: string,
): ModelCommercialInvocationResultV1["status"] {
  if (code.includes("canceled")) return "cancelled";
  if (code.includes("timeout")) return "timeout";
  if (code.includes("provider")) return "provider-failure";
  return "internal-failure";
}

export class ModelSolutionCommercialServiceV1 {
  readonly #clock: { now(): Date };
  readonly #commercial: ModelCommercialLifecycleCoordinator;
  readonly #planner: SolutionPlanningExecutionPortV1;
  readonly #resultEvidence: SolutionPlanningResultEvidenceStoreV1;
  readonly #usageEvidence: SolutionPlanningUsageEvidenceSourceV1;

  public constructor(
    dependencies: ModelSolutionCommercialServiceDependenciesV1,
  ) {
    this.#clock = dependencies.clock ?? { now: () => new Date() };
    this.#commercial = dependencies.commercial;
    this.#planner = dependencies.planner;
    this.#resultEvidence = dependencies.resultEvidence;
    this.#usageEvidence = dependencies.usageEvidence;
  }

  public async execute(
    commercialRequest: ModelCommercialOperationRequestV1,
    plannerRequest: SolutionProposalPlannerRequestV1,
    signal?: AbortSignal,
  ): Promise<ModelSolutionCommercialExecutionV1> {
    assertOperationBinding({
      commercial: commercialRequest,
      planner: plannerRequest,
    });
    let plannerResult: SolutionProposalPlannerResultV1 | null = null;
    let invocationErrorCode: string | null = null;
    const commercial = await this.#commercial.execute(
      commercialRequest,
      async (callbackContext) => {
        assertCallbackRouteBinding(
          callbackContext,
          plannerRequest.gatewayContext,
        );
        try {
          plannerResult = await this.#planner.propose(plannerRequest, signal);
          await this.#resultEvidence.saveCompleted(
            commercialRequest.multiCallWorkflowId,
            plannerResult,
          );
          if (plannerResult.disposition === "rejected") {
            invocationErrorCode = "cloudmarkup.solution-planner.rejected";
          }
        } catch (error) {
          invocationErrorCode = safeErrorCode(error, signal);
        }
        const completedAt = this.#clock.now().toISOString();
        const usage = await this.#usageEvidence.listByMultiCallWorkflowId(
          commercialRequest.multiCallWorkflowId,
        );
        assertUsageBinding({ plannerRequest, usage });
        const attempts = recordedAttempts(usage);
        const status =
          invocationErrorCode === null
            ? "completed"
            : invocationStatus(invocationErrorCode);
        return {
          attempts,
          completedAt,
          failureCategory: invocationErrorCode,
          resultId: `result_${digestStructuredValue({
            invocationId: plannerRequest.gatewayContext.invocationId,
            multiCallWorkflowId: commercialRequest.multiCallWorkflowId,
          }).slice("sha256:".length, "sha256:".length + 48)}`,
          status,
          usefulOutputDelivered:
            plannerResult !== null && plannerResult.disposition !== "rejected",
        };
      },
    );
    if (
      ![
        "denied",
        "estimate-confirmation-required",
        "reservation-denied",
      ].includes(commercial.state)
    ) {
      plannerResult = await this.#resultEvidence.loadCompleted(
        commercialRequest.multiCallWorkflowId,
      );
    }
    if (plannerResult?.disposition === "rejected") {
      invocationErrorCode = "cloudmarkup.solution-planner.rejected";
    }
    const issues: ModelSolutionCommercialIssueV1[] = [];
    if (commercial.denialReason !== null) {
      issues.push({
        category: "commercial-denial",
        code: commercial.denialReason,
        severity: "blocking",
      });
    }
    if (commercial.reconciliationState !== "not-required") {
      issues.push({
        category: "reconciliation-required",
        code: commercial.reconciliationState,
        severity: "warning",
      });
    }
    if (invocationErrorCode !== null) {
      issues.push({
        category:
          invocationErrorCode === "cloudmarkup.solution-planner.rejected"
            ? "proposal-rejected"
            : "provider-unavailable",
        code: invocationErrorCode,
        severity: "blocking",
      });
    }
    return { commercial, issues, plannerResult };
  }
}

export class InMemorySolutionPlanningResultEvidenceStoreV1 implements SolutionPlanningResultEvidenceStoreV1 {
  readonly #records = new Map<string, SolutionProposalPlannerResultV1>();

  public loadCompleted(
    multiCallWorkflowId: string,
  ): Promise<SolutionProposalPlannerResultV1 | null> {
    return Promise.resolve(this.#records.get(multiCallWorkflowId) ?? null);
  }

  public saveCompleted(
    multiCallWorkflowId: string,
    result: SolutionProposalPlannerResultV1,
  ): Promise<void> {
    const existing = this.#records.get(multiCallWorkflowId);
    if (
      existing !== undefined &&
      digestStructuredValue(existing) !== digestStructuredValue(result)
    ) {
      throw new Error("Completed planning evidence cannot be overwritten.");
    }
    this.#records.set(multiCallWorkflowId, result);
    return Promise.resolve();
  }
}
