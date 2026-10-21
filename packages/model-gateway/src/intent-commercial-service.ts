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
import type {
  ModelGateway,
  ModelGatewayInvocationContextV1,
  ModelGatewayResultV1,
  ModelRequestFor,
} from "./ports.js";
import { reviewedModelPromptRegistry } from "./prompts/registry.js";
import { digestStructuredValue } from "./security.js";

export type IntentModelRequestV1 =
  | ModelRequestFor<"intent.extract">
  | ModelRequestFor<"requirements.blocking-questions">;

export type IntentModelResultV1 = ModelGatewayResultV1<
  "intent.extract" | "requirements.blocking-questions"
>;

export interface ModelUsageEvidenceSourceV1 {
  listByInvocationId(
    invocationId: string,
  ): Promise<readonly NormalizedModelUsageV1[]>;
}

export interface ModelResultEvidenceSourceV1 {
  loadCompleted(invocationId: string): Promise<IntentModelResultV1 | null>;
}

export interface ModelIntentCommercialExecutionIssueV1 {
  readonly category:
    | "ambiguity"
    | "commercial-denial"
    | "provider-unavailable"
    | "reconciliation-required"
    | "redaction"
    | "unsupported-capability";
  readonly code: string;
  readonly severity: "information" | "warning" | "blocking";
}

export interface ModelIntentCommercialExecutionV1 {
  readonly commercial: ModelCommercialLifecycleResponseV1;
  readonly issues: readonly ModelIntentCommercialExecutionIssueV1[];
  readonly modelResult: IntentModelResultV1 | null;
}

export interface ModelIntentCommercialServiceDependenciesV1 {
  readonly clock?: { now(): Date };
  readonly commercial: ModelCommercialLifecycleCoordinator;
  readonly gateway: ModelGateway;
  readonly resultEvidence: ModelResultEvidenceSourceV1;
  readonly usageEvidence: ModelUsageEvidenceSourceV1;
}

function routeKind(
  context: ModelGatewayInvocationContextV1,
): "standard" | "deep" {
  const routeId = context.routingDecision?.routeId;
  if (routeId === "standard-design") return "standard";
  if (routeId === "deep-design" || routeId === "internal-escalation")
    return "deep";
  throw new Error("Trusted model routing decision is required.");
}

export function assertIntentModelOperationBindingV1(input: {
  readonly commercial: ModelCommercialOperationRequestV1;
  readonly context: ModelGatewayInvocationContextV1;
  readonly model: IntentModelRequestV1;
}): void {
  const prompt = reviewedModelPromptRegistry.get(input.model.operation);
  const decision = input.context.routingDecision;
  if (
    prompt === null ||
    decision?.outcome !== "selected" ||
    input.commercial.feature !== input.model.operation ||
    input.commercial.jobId !== input.context.scope.jobId ||
    input.commercial.organizationId !== input.context.scope.organizationId ||
    input.commercial.projectId !== input.context.scope.projectId ||
    input.commercial.userId !== input.context.scope.userId ||
    input.commercial.promptId !== prompt.templateId ||
    input.commercial.promptVersion !== prompt.version ||
    input.commercial.requestedRoute !== routeKind(input.context) ||
    decision.feature !== input.model.operation ||
    decision.requestedMode !== input.model.requestedMode
  ) {
    throw new Error(
      "Commercial, route, prompt, tenant, and model authority must match.",
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
      "Reserved commercial route does not match trusted model routing.",
    );
  }
}

export function modelUsageToCommercialAttemptV1(
  usage: NormalizedModelUsageV1,
): ModelCommercialInvocationAttemptV1 {
  return {
    attemptId: `${usage.invocationId}.attempt.${String(usage.attemptNumber)}`,
    attemptKind: usage.attemptNumber === 1 ? "primary" : "automatic-retry",
    attemptNumber: usage.attemptNumber,
    callId: `${usage.invocationId}.call.${String(usage.attemptNumber)}`,
    completedAt: usage.completedAt,
    failureCategory:
      usage.result === "succeeded" ? null : `model-gateway.${usage.result}`,
    inferenceProfileId: usage.inferenceProfileId ?? null,
    invocationId: usage.invocationId,
    latencyMilliseconds: usage.durationMilliseconds,
    mayHaveBeenProcessed: true,
    modelId: usage.modelId,
    modelVersion: usage.modelVersion,
    promptId: usage.promptTemplateId,
    promptVersion: usage.promptVersion,
    providerKey: usage.providerId,
    providerRequestId: usage.providerRequestId ?? null,
    retryOfAttemptId:
      usage.attemptNumber === 1
        ? null
        : `${usage.invocationId}.attempt.${String(usage.attemptNumber - 1)}`,
    routeId: usage.routing?.routeId ?? "unrouted",
    startedAt: usage.startedAt,
    status: attemptStatus(usage.result),
    usage: commercialUnits(usage),
    usageRecordId: usage.usageRecordId,
  };
}

function safeErrorCode(error: unknown): string {
  if (typeof error !== "object" || error === null)
    return "model-gateway.internal-error";
  if ("code" in error && typeof error.code === "string") return error.code;
  return "safeCode" in error && typeof error.safeCode === "string"
    ? error.safeCode
    : "model-gateway.internal-error";
}

function statusFromError(
  code: string,
  canceled: boolean,
): ModelCommercialInvocationResultV1["status"] {
  if (canceled || code.includes("canceled")) return "cancelled";
  if (code.includes("timeout")) return "timeout";
  if (
    code.includes("provider") ||
    code.includes("missing-usage") ||
    code.includes("invalid-usage")
  )
    return "provider-failure";
  return "internal-failure";
}

function missingUsageAttempt(input: {
  readonly code: string;
  readonly completedAt: string;
  readonly context: ModelGatewayInvocationContextV1;
  readonly request: ModelCommercialOperationRequestV1;
  readonly startedAt: string;
  readonly status: ModelCommercialInvocationResultV1["status"];
}): ModelCommercialInvocationAttemptV1 {
  const decision = input.context.routingDecision;
  if (decision === undefined)
    throw new Error("A routing decision is required.");
  return {
    attemptId: `${input.context.invocationId}.attempt.1`,
    attemptKind: "primary",
    attemptNumber: 1,
    callId: `${input.context.invocationId}.call.1`,
    completedAt: input.completedAt,
    failureCategory: input.code,
    inferenceProfileId: decision.inferenceProfileId,
    invocationId: input.context.invocationId,
    latencyMilliseconds: Math.max(
      0,
      Date.parse(input.completedAt) - Date.parse(input.startedAt),
    ),
    mayHaveBeenProcessed:
      input.status === "timeout" ||
      input.status === "cancelled" ||
      input.code.includes("missing-usage") ||
      input.code.includes("metering-failed"),
    modelId: decision.modelId,
    modelVersion: decision.modelVersion,
    promptId: input.request.promptId,
    promptVersion: input.request.promptVersion,
    providerKey: decision.providerId,
    providerRequestId: null,
    retryOfAttemptId: null,
    routeId: decision.routeId,
    startedAt: input.startedAt,
    status:
      input.status === "timeout"
        ? "timed-out"
        : input.status === "cancelled"
          ? "cancelled"
          : input.status === "provider-failure"
            ? "provider-failure"
            : "internal-failure",
    usage: null,
    usageRecordId: `${input.context.invocationId}.usage.unknown.1`,
  };
}

export interface ModelIntentReservedInvocationResultV1 {
  readonly commercial: ModelCommercialInvocationResultV1;
  readonly invocationErrorCode: string | null;
  readonly modelResult: IntentModelResultV1 | null;
  readonly redactedValueCount: number;
}

/** Execute only inside the canonical coordinator's already-reserved callback.
 * Runtime-controlled hosts use this directly: calling the commercial service
 * from that callback would reserve the same operation a second time. */
export async function invokeReservedIntentModelV1(input: {
  readonly callback: ModelCommercialInvocationContextV1;
  readonly clock: { now(): Date };
  readonly commercialRequest: ModelCommercialOperationRequestV1;
  readonly context: ModelGatewayInvocationContextV1;
  readonly gateway: ModelGateway;
  readonly modelRequest: IntentModelRequestV1;
  readonly signal?: AbortSignal;
  readonly usageEvidence: ModelUsageEvidenceSourceV1;
}): Promise<ModelIntentReservedInvocationResultV1> {
  assertIntentModelOperationBindingV1({
    commercial: input.commercialRequest,
    context: input.context,
    model: input.modelRequest,
  });
  assertCallbackRouteBinding(input.callback, input.context);
  const startedAt = input.clock.now().toISOString();
  let modelResult: IntentModelResultV1 | null = null;
  let invocationErrorCode: string | null = null;
  let status: ModelCommercialInvocationResultV1["status"] = "completed";
  try {
    modelResult = await input.gateway.invoke(
      input.modelRequest,
      input.context,
      input.signal,
    );
  } catch (error) {
    invocationErrorCode = safeErrorCode(error);
    status = statusFromError(
      invocationErrorCode,
      input.signal?.aborted === true,
    );
  }
  const completedAt = input.clock.now().toISOString();
  const recorded = await input.usageEvidence.listByInvocationId(
    input.context.invocationId,
  );
  const attempts = recorded.map((usage) =>
    modelUsageToCommercialAttemptV1(usage),
  );
  if (attempts.length === 0 && invocationErrorCode !== null) {
    attempts.push(
      missingUsageAttempt({
        code: invocationErrorCode,
        completedAt,
        context: input.context,
        request: input.commercialRequest,
        startedAt,
        status,
      }),
    );
  }
  return {
    commercial: {
      attempts,
      completedAt,
      failureCategory: invocationErrorCode,
      resultId: `result_${digestStructuredValue({
        invocationId: input.context.invocationId,
        multiCallWorkflowId: input.commercialRequest.multiCallWorkflowId,
      }).slice("sha256:".length, "sha256:".length + 48)}`,
      status,
      usefulOutputDelivered: modelResult !== null,
    },
    invocationErrorCode,
    modelResult,
    redactedValueCount: modelResult?.redaction.redactedValueCount ?? 0,
  };
}

export class ModelIntentCommercialServiceV1 {
  readonly #clock: { now(): Date };
  readonly #commercial: ModelCommercialLifecycleCoordinator;
  readonly #gateway: ModelGateway;
  readonly #resultEvidence: ModelResultEvidenceSourceV1;
  readonly #usageEvidence: ModelUsageEvidenceSourceV1;

  public constructor(dependencies: ModelIntentCommercialServiceDependenciesV1) {
    this.#clock = dependencies.clock ?? { now: () => new Date() };
    this.#commercial = dependencies.commercial;
    this.#gateway = dependencies.gateway;
    this.#resultEvidence = dependencies.resultEvidence;
    this.#usageEvidence = dependencies.usageEvidence;
  }

  public async execute(
    commercialRequest: ModelCommercialOperationRequestV1,
    modelRequest: IntentModelRequestV1,
    context: ModelGatewayInvocationContextV1,
    signal?: AbortSignal,
  ): Promise<ModelIntentCommercialExecutionV1> {
    assertIntentModelOperationBindingV1({
      commercial: commercialRequest,
      context,
      model: modelRequest,
    });
    const execution: {
      invocationErrorCode: string | null;
      modelResult: IntentModelResultV1 | null;
      redactedValueCount: number;
    } = {
      invocationErrorCode: null,
      modelResult: null,
      redactedValueCount: 0,
    };
    const commercial = await this.#commercial.execute(
      commercialRequest,
      async (callbackContext) => {
        const invoked = await invokeReservedIntentModelV1({
          callback: callbackContext,
          clock: this.#clock,
          commercialRequest,
          context,
          gateway: this.#gateway,
          modelRequest,
          ...(signal === undefined ? {} : { signal }),
          usageEvidence: this.#usageEvidence,
        });
        execution.modelResult = invoked.modelResult;
        execution.invocationErrorCode = invoked.invocationErrorCode;
        execution.redactedValueCount = invoked.redactedValueCount;
        return invoked.commercial;
      },
    );
    if (
      execution.modelResult === null &&
      ![
        "denied",
        "estimate-confirmation-required",
        "reservation-denied",
      ].includes(commercial.state)
    ) {
      execution.modelResult = await this.#resultEvidence.loadCompleted(
        context.invocationId,
      );
    }
    const issues: ModelIntentCommercialExecutionIssueV1[] = [];
    if (commercial.denialReason !== null)
      issues.push({
        category: "commercial-denial",
        code: commercial.denialReason,
        severity: "blocking",
      });
    if (commercial.reconciliationState !== "not-required")
      issues.push({
        category: "reconciliation-required",
        code: commercial.reconciliationState,
        severity: "warning",
      });
    if (execution.invocationErrorCode !== null)
      issues.push({
        category: "provider-unavailable",
        code: execution.invocationErrorCode,
        severity: "blocking",
      });
    if (execution.redactedValueCount > 0)
      issues.push({
        category: "redaction",
        code: "model-input.redacted",
        severity: "information",
      });
    return Object.freeze({
      commercial,
      issues,
      modelResult: execution.modelResult,
    });
  }
}
