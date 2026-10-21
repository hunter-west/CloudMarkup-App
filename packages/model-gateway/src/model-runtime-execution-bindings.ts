import { requiredModelRoleForDecisionV1 } from "./routing.js";
import {
  type ModelCacheKeyInputV1,
  modelRuntimeHostEvidenceV1Schema,
  sha256DigestSchema,
  type ModelLiveEvaluationAuthorityV1,
  type ModelRoutingDecisionV1,
  type ModelRoutingRequestV1,
  type ModelRuntimeAdmissionRequestV1,
  type ModelRuntimeAdmissionDecisionV1,
  type ModelRuntimeControlPolicyV1,
  type ModelRuntimeInputEvidenceV1,
  type ModelRuntimeStateSnapshotV1,
  type Sha256Digest,
} from "@cloudmarkup/schemas";
import type {
  ModelCommercialInvocationContextV1,
  ModelCommercialInvocationResultV1,
  ModelCommercialLifecycleResponseV1,
  ModelCommercialOperationRequestV1,
} from "./commercial-lifecycle.js";
import type {
  ModelRuntimeControlledInvocationResultV1,
  ModelRuntimeHostEvidenceVerifierV1,
  ModelRuntimeSanitizedOutputEvidenceV1,
} from "./model-runtime-controls.js";
import {
  ModelRuntimeControlError,
  type ModelRuntimeDenialReasonV1,
} from "./model-runtime-errors.js";
import {
  digestStructuredValue,
  inspectModelValueForSecretCandidatesV1,
  sha256Text,
} from "./security.js";

/** Internal common shapes only. Callers must parse their exact version and
 * authenticate authority before using these binding and output checks. */
export type RuntimeExecutionRequest = Omit<
  ModelRuntimeAdmissionRequestV1,
  | "contractVersion"
  | "recordKind"
  | "evaluationReportId"
  | "evaluationReportDigest"
  | "evaluationResultSetDigest"
>;
type RuntimeMetadataRequest = Omit<
  RuntimeExecutionRequest,
  "inputEvidenceDigest"
>;
type RuntimeMetadataRoute = Omit<
  ModelRoutingDecisionV1,
  | "contractVersion"
  | "escalation"
  | "evaluationResultDigest"
  | "evaluationResultVersion"
>;
export type RuntimeExecutionDecision = Omit<
  ModelRuntimeAdmissionDecisionV1,
  | "contractVersion"
  | "recordKind"
  | "evaluationReportId"
  | "evaluationReportDigest"
  | "evaluationResultSetDigest"
>;
export type RuntimeLiveExecutionBounds = Pick<
  ModelLiveEvaluationAuthorityV1,
  "expiresAt" | "limits"
>;
function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    new Set(left).size === left.length &&
    left.every((value) => right.includes(value))
  );
}
export function routeKind(
  decision: Pick<ModelRoutingDecisionV1, "routeId">,
): "standard" | "deep" {
  return decision.routeId === "standard-design" ? "standard" : "deep";
}

export function assertInstant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new ModelRuntimeControlError("routing-authority-mismatch");
  }
  return parsed;
}

const commercialAttemptKinds = [
  "primary",
  "automatic-retry",
  "system-escalation",
  "repair",
] as const;
interface PlannedMaximumsV1 {
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly inputTokens: number;
  readonly invocations: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

export function plannedMaximums(
  commercialRequest: ModelCommercialOperationRequestV1,
): PlannedMaximumsV1 {
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  for (const call of commercialRequest.plannedCalls) {
    const usage = call.maximumUsage;
    for (const value of [
      usage.cacheReadUnits,
      usage.cacheWriteUnits,
      usage.inputUnits,
      usage.outputUnits,
      usage.totalUnits,
    ]) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new ModelRuntimeControlError("routing-authority-mismatch");
      }
    }
    if (
      usage.totalUnits !==
      usage.cacheReadUnits +
        usage.cacheWriteUnits +
        usage.inputUnits +
        usage.outputUnits
    ) {
      throw new ModelRuntimeControlError("routing-authority-mismatch");
    }
    cacheReadTokens += usage.cacheReadUnits;
    cacheWriteTokens += usage.cacheWriteUnits;
    inputTokens += usage.inputUnits;
    outputTokens += usage.outputUnits;
    totalTokens += usage.totalUnits;
    if (
      !Number.isSafeInteger(cacheReadTokens) ||
      !Number.isSafeInteger(cacheWriteTokens) ||
      !Number.isSafeInteger(inputTokens) ||
      !Number.isSafeInteger(outputTokens) ||
      !Number.isSafeInteger(totalTokens)
    ) {
      throw new ModelRuntimeControlError("routing-authority-mismatch");
    }
  }
  return {
    cacheReadTokens,
    cacheWriteTokens,
    inputTokens,
    invocations: commercialRequest.plannedCalls.length,
    outputTokens,
    totalTokens,
  };
}

interface CommercialBindingInput {
  readonly admissionDecision: RuntimeExecutionDecision;
  readonly admissionRequest: RuntimeMetadataRequest;
  readonly commercialRequest: ModelCommercialOperationRequestV1;
  readonly liveEvaluationAuthority: RuntimeLiveExecutionBounds | undefined;
  readonly policy: Pick<ModelRuntimeControlPolicyV1, "limits">;
  readonly routingDecision: RuntimeMetadataRoute;
}

/** Shared scope, clock, pricing and reservation identity checks. Per-call and
 * sequence bounds remain the responsibility of the explicit versioned reader. */
export function assertCommercialScopeBindings(input: CommercialBindingInput) {
  const {
    admissionDecision,
    admissionRequest,
    commercialRequest,
    liveEvaluationAuthority,
    routingDecision,
  } = input;
  const reservationDecisionId =
    admissionDecision.authorization.commercialReservationDecisionId;
  const planned = plannedMaximums(commercialRequest);
  const requestedAt = assertInstant(commercialRequest.requestedAt);
  const commercialExpiresAt = assertInstant(commercialRequest.expiresAt);
  const decisionExpiresAt =
    admissionDecision.expiresAt === undefined
      ? undefined
      : assertInstant(admissionDecision.expiresAt);
  const liveExpiresAt =
    liveEvaluationAuthority === undefined
      ? undefined
      : assertInstant(liveEvaluationAuthority.expiresAt);
  if (
    commercialRequest.organizationId !== admissionRequest.organizationId ||
    commercialRequest.userId !== admissionRequest.userId ||
    commercialRequest.projectId !== admissionRequest.projectId ||
    commercialRequest.feature !== admissionRequest.operation ||
    commercialRequest.requestedAt !== admissionDecision.decidedAt ||
    commercialExpiresAt <= requestedAt ||
    (admissionDecision.outcome === "allowed" &&
      (decisionExpiresAt === undefined ||
        commercialExpiresAt > decisionExpiresAt)) ||
    (liveExpiresAt !== undefined && commercialExpiresAt > liveExpiresAt) ||
    sha256Text(commercialRequest.idempotencyKey) !==
      admissionRequest.idempotencyKeyDigest ||
    commercialRequest.requestedRoute !== routeKind(routingDecision) ||
    admissionRequest.commercialEstimate.pricingVersionReference !==
      routingDecision.pricingVersionReference ||
    (routingDecision.customerCharge.acceptedMaximumCreditUnits !== undefined &&
      admissionRequest.commercialEstimate.maximumCreditUnits !==
        routingDecision.customerCharge.acceptedMaximumCreditUnits) ||
    (admissionDecision.outcome === "allowed" &&
      commercialRequest.reservationId !== reservationDecisionId) ||
    planned.invocations === 0 ||
    commercialRequest.plannedCalls.some(
      (call) =>
        !commercialAttemptKinds.some((kind) => kind === call.kind) ||
        call.routeId !== routingDecision.routeId ||
        (call.kind === "system-escalation" &&
          !routingDecision.automaticEscalationPermitted),
    ) ||
    !commercialRequest.includeTechnicalUnitDetail ||
    planned.inputTokens > commercialRequest.requestedMaximumInputUnits ||
    planned.outputTokens > commercialRequest.requestedMaximumOutputUnits
  )
    throw new ModelRuntimeControlError("routing-authority-mismatch");
  return planned;
}

export function assertCommercialBindings(input: CommercialBindingInput): void {
  const {
    admissionDecision,
    admissionRequest,
    commercialRequest,
    policy,
    routingDecision,
  } = input;
  const planned = assertCommercialScopeBindings(input);
  const plannedRepairAttempts = commercialRequest.plannedCalls.filter(
    (call) => call.kind === "repair",
  ).length;
  if (
    planned.invocations > routingDecision.maximumAttempts ||
    plannedRepairAttempts > admissionRequest.requested.repairAttempts ||
    commercialRequest.requestedMaximumOutputUnits !==
      admissionRequest.requested.outputTokens ||
    (admissionDecision.outcome === "allowed" &&
      (commercialRequest.requestedMaximumOutputUnits >
        policy.limits.maximumOutputTokens ||
        commercialRequest.requestedMaximumOutputUnits >
          routingDecision.maximumOutputTokens ||
        planned.outputTokens > policy.limits.maximumOutputTokens ||
        planned.outputTokens > routingDecision.maximumOutputTokens)) ||
    planned.outputTokens > admissionRequest.requested.outputTokens
  )
    throw new ModelRuntimeControlError("routing-authority-mismatch");
}

export function assertDecisionMatches(
  decision: Pick<
    RuntimeExecutionDecision,
    | "executionClass"
    | "decidedAt"
    | "outcome"
    | "denialReasons"
    | "authorization"
    | "safeError"
    | "expiresAt"
  >,
  expectedReasons: readonly ModelRuntimeDenialReasonV1[],
  nowText: string,
  input: {
    readonly admissionRequest: Pick<RuntimeExecutionRequest, "executionClass">;
    readonly commercialRequest: ModelCommercialOperationRequestV1;
    readonly routingDecision: Pick<ModelRoutingDecisionV1, "entitlement">;
    readonly routingRequest: ModelRoutingRequestV1;
    readonly runtimeState: ModelRuntimeStateSnapshotV1;
  },
): void {
  const now = assertInstant(nowText);
  const replay = input.runtimeState.idempotencyReplay;
  if (
    input.runtimeState.capturedAt !== nowText ||
    (!replay && assertInstant(decision.decidedAt) > now)
  ) {
    throw new ModelRuntimeControlError("stale-or-duplicate-conflict");
  }
  const expectedAllowed = expectedReasons.length === 0;
  const entitlementDecisionId = decision.authorization.entitlementDecisionId;
  if (
    decision.executionClass !== input.admissionRequest.executionClass ||
    expectedAllowed !== (decision.outcome === "allowed") ||
    !sameSet(decision.denialReasons, expectedReasons) ||
    (expectedAllowed &&
      (entitlementDecisionId !==
        input.routingRequest.plan.entitlementDecisionId ||
        entitlementDecisionId !==
          input.routingDecision.entitlement.decisionId ||
        decision.authorization.commercialReservationDecisionId !==
          input.commercialRequest.reservationId)) ||
    (!expectedAllowed && decision.safeError?.code !== expectedReasons[0])
  ) {
    throw new ModelRuntimeControlError("routing-authority-mismatch");
  }
  if (
    !replay &&
    decision.expiresAt !== undefined &&
    now >= assertInstant(decision.expiresAt)
  ) {
    throw new ModelRuntimeControlError("stale-or-duplicate-conflict");
  }
}
export function tenantScopeDigest(
  request: RuntimeMetadataRequest,
): Sha256Digest {
  return digestStructuredValue({
    idempotencyKeyDigest: request.idempotencyKeyDigest,
    organizationId: request.organizationId,
    projectId: request.projectId,
    userId: request.userId,
  });
}

export function assertInputEvidenceBindings(input: {
  readonly admissionRequest: RuntimeExecutionRequest;
  readonly inputEvidence: ModelRuntimeInputEvidenceV1;
}): void {
  const { admissionRequest, inputEvidence } = input;
  if (
    inputEvidence.evidenceDigest !== admissionRequest.inputEvidenceDigest ||
    inputEvidence.organizationId !== admissionRequest.organizationId ||
    inputEvidence.projectId !== admissionRequest.projectId ||
    inputEvidence.userId !== admissionRequest.userId ||
    inputEvidence.operation !== admissionRequest.operation ||
    inputEvidence.inputDigest !== admissionRequest.inputDigest ||
    digestStructuredValue(inputEvidence.requested) !==
      digestStructuredValue(admissionRequest.requested) ||
    inspectModelValueForSecretCandidatesV1(inputEvidence).detectedValueCount > 0
  ) {
    throw new ModelRuntimeControlError("routing-authority-mismatch");
  }
}

export async function authenticateInputEvidence(input: {
  readonly admissionRequest: RuntimeExecutionRequest;
  readonly evidenceVerifier: ModelRuntimeHostEvidenceVerifierV1;
  readonly inputEvidence: ModelRuntimeInputEvidenceV1;
}): Promise<ModelRuntimeInputEvidenceV1> {
  assertInputEvidenceBindings(input);
  let authenticated: boolean;
  try {
    authenticated = await input.evidenceVerifier.verifyInputEvidence({
      evidence: structuredClone(input.inputEvidence),
    });
  } catch {
    throw new ModelRuntimeControlError("runtime-control-unavailable");
  }
  if (!authenticated) {
    throw new ModelRuntimeControlError("routing-authority-mismatch");
  }
  return Object.freeze(structuredClone(input.inputEvidence));
}

function invocationAttemptsFit(
  result: ModelCommercialInvocationResultV1,
  input: {
    readonly admissionRequest: RuntimeExecutionRequest;
    readonly commercialRequest: ModelCommercialOperationRequestV1;
    readonly liveEvaluationAuthority: RuntimeLiveExecutionBounds | undefined;
    readonly routingDecision: ModelRoutingDecisionV1;
  },
): boolean {
  const attempts = result.attempts;
  if (
    attempts.length > input.routingDecision.maximumAttempts ||
    attempts.length > input.commercialRequest.plannedCalls.length ||
    (input.liveEvaluationAuthority !== undefined &&
      attempts.length >
        input.liveEvaluationAuthority.limits.maximumInvocations) ||
    attempts.some(
      (attempt) =>
        !commercialAttemptKinds.some((kind) => kind === attempt.attemptKind) ||
        attempt.routeId !== input.routingDecision.routeId ||
        attempt.providerKey !== input.routingDecision.providerId ||
        attempt.modelId !== input.routingDecision.modelId ||
        attempt.modelVersion !== input.routingDecision.modelVersion ||
        attempt.inferenceProfileId !==
          input.routingDecision.inferenceProfileId ||
        attempt.promptId !== input.commercialRequest.promptId ||
        attempt.promptVersion !== input.commercialRequest.promptVersion,
    )
  ) {
    return false;
  }
  for (const kind of [
    "primary",
    "automatic-retry",
    "system-escalation",
    "repair",
  ] as const) {
    const actualCount = attempts.filter(
      (attempt) => attempt.attemptKind === kind,
    ).length;
    const plannedCount = input.commercialRequest.plannedCalls.filter(
      (call) => call.kind === kind,
    ).length;
    if (
      actualCount > plannedCount ||
      (kind === "repair" &&
        actualCount > input.admissionRequest.requested.repairAttempts)
    ) {
      return false;
    }
  }
  return true;
}

export async function verifyRuntimeInvocationOutput(
  supplied: ModelRuntimeControlledInvocationResultV1,
  input: {
    readonly admissionRequest: RuntimeExecutionRequest;
    readonly commercialRequest: ModelCommercialOperationRequestV1;
    readonly evidenceVerifier: ModelRuntimeHostEvidenceVerifierV1;
    readonly liveEvaluationAuthority: RuntimeLiveExecutionBounds | undefined;
    readonly policy: Pick<ModelRuntimeControlPolicyV1, "limits">;
    readonly routingDecision: ModelRoutingDecisionV1;
  },
): Promise<{
  readonly commercial: ModelCommercialInvocationResultV1;
  readonly output: ModelRuntimeSanitizedOutputEvidenceV1 | null;
  readonly rejected: boolean;
}> {
  const rawOutput: unknown = supplied.output;
  const output =
    rawOutput !== null && typeof rawOutput === "object"
      ? (rawOutput as Record<string, unknown>)
      : null;
  const outputKeys = output === null ? [] : Object.keys(output).sort();
  const exactKeys = [
    "allowListedOperationsEvidence",
    "noRawSensitiveContent",
    "outputBytes",
    "outputDigest",
    "outputTokens",
    "resultSanitized",
    "secretRedactionApplied",
    "sourceOwnershipEvidence",
    "structuredOutputValidated",
  ];
  const outputBytes = output?.["outputBytes"];
  const outputTokens = output?.["outputTokens"];
  const outputDigestResult = sha256DigestSchema.safeParse(
    output?.["outputDigest"],
  );
  const allowListedResult = modelRuntimeHostEvidenceV1Schema.safeParse(
    output?.["allowListedOperationsEvidence"],
  );
  const sourceOwnershipResult = modelRuntimeHostEvidenceV1Schema.safeParse(
    output?.["sourceOwnershipEvidence"],
  );
  const structurallyValid =
    output !== null &&
    outputKeys.length === exactKeys.length &&
    outputKeys.every((key, index) => key === exactKeys[index]) &&
    output["noRawSensitiveContent"] === true &&
    output["resultSanitized"] === true &&
    output["secretRedactionApplied"] === true &&
    output["structuredOutputValidated"] === true &&
    typeof outputBytes === "number" &&
    Number.isSafeInteger(outputBytes) &&
    outputBytes >= 0 &&
    typeof outputTokens === "number" &&
    Number.isSafeInteger(outputTokens) &&
    outputTokens >= 0 &&
    outputDigestResult.success &&
    allowListedResult.success &&
    sourceOwnershipResult.success &&
    allowListedResult.data.evidenceKind === "allow-listed-operations" &&
    sourceOwnershipResult.data.evidenceKind === "source-ownership" &&
    allowListedResult.data.catalogDigest ===
      input.admissionRequest.catalogDigest &&
    sourceOwnershipResult.data.catalogDigest ===
      input.admissionRequest.catalogDigest &&
    allowListedResult.data.inputDigest === input.admissionRequest.inputDigest &&
    sourceOwnershipResult.data.inputDigest ===
      input.admissionRequest.inputDigest &&
    allowListedResult.data.outputDigest === outputDigestResult.data &&
    sourceOwnershipResult.data.outputDigest === outputDigestResult.data &&
    allowListedResult.data.organizationId ===
      input.admissionRequest.organizationId &&
    sourceOwnershipResult.data.organizationId ===
      input.admissionRequest.organizationId &&
    allowListedResult.data.projectId === input.admissionRequest.projectId &&
    sourceOwnershipResult.data.projectId === input.admissionRequest.projectId &&
    allowListedResult.data.operation === input.admissionRequest.operation &&
    sourceOwnershipResult.data.operation === input.admissionRequest.operation &&
    allowListedResult.data.outputBytes === outputBytes &&
    sourceOwnershipResult.data.outputBytes === outputBytes &&
    allowListedResult.data.outputTokens === outputTokens &&
    sourceOwnershipResult.data.outputTokens === outputTokens &&
    allowListedResult.data.responseSchemaDigest ===
      input.admissionRequest.responseSchemaDigest &&
    sourceOwnershipResult.data.responseSchemaDigest ===
      input.admissionRequest.responseSchemaDigest &&
    allowListedResult.data.runtimePolicyDigest ===
      input.admissionRequest.runtimePolicyDigest &&
    sourceOwnershipResult.data.runtimePolicyDigest ===
      input.admissionRequest.runtimePolicyDigest &&
    outputBytes <= input.admissionRequest.requested.outputBytes &&
    outputBytes <= input.policy.limits.maximumOutputBytes &&
    outputTokens <= input.admissionRequest.requested.outputTokens &&
    outputTokens <= input.policy.limits.maximumOutputTokens &&
    outputTokens <= input.routingDecision.maximumOutputTokens;
  let authenticatedOutput: ModelRuntimeSanitizedOutputEvidenceV1 | null = null;
  if (structurallyValid) {
    try {
      const [allowListedVerified, sourceOwnershipVerified] = await Promise.all([
        input.evidenceVerifier.verify({
          evidence: allowListedResult.data,
          expected: {
            evidenceKind: "allow-listed-operations",
            catalogDigest: input.admissionRequest.catalogDigest,
            inputDigest: input.admissionRequest.inputDigest,
            operation: input.admissionRequest.operation,
            organizationId: input.admissionRequest.organizationId,
            outputBytes,
            outputDigest: outputDigestResult.data,
            outputTokens,
            projectId: input.admissionRequest.projectId,
            responseSchemaDigest: input.admissionRequest.responseSchemaDigest,
            runtimePolicyDigest: input.admissionRequest.runtimePolicyDigest,
          },
        }),
        input.evidenceVerifier.verify({
          evidence: sourceOwnershipResult.data,
          expected: {
            evidenceKind: "source-ownership",
            catalogDigest: input.admissionRequest.catalogDigest,
            inputDigest: input.admissionRequest.inputDigest,
            operation: input.admissionRequest.operation,
            organizationId: input.admissionRequest.organizationId,
            outputBytes,
            outputDigest: outputDigestResult.data,
            outputTokens,
            projectId: input.admissionRequest.projectId,
            responseSchemaDigest: input.admissionRequest.responseSchemaDigest,
            runtimePolicyDigest: input.admissionRequest.runtimePolicyDigest,
          },
        }),
      ]);
      if (allowListedVerified && sourceOwnershipVerified) {
        authenticatedOutput = Object.freeze({
          allowListedOperationsEvidence: structuredClone(
            allowListedResult.data,
          ),
          noRawSensitiveContent: true,
          outputBytes,
          outputDigest: outputDigestResult.data,
          outputTokens,
          resultSanitized: true,
          secretRedactionApplied: true,
          sourceOwnershipEvidence: structuredClone(sourceOwnershipResult.data),
          structuredOutputValidated: true,
        });
      }
    } catch {
      authenticatedOutput = null;
    }
  }
  const validOutput = authenticatedOutput !== null;
  const attemptsValid = invocationAttemptsFit(supplied.commercial, input);
  const rejected =
    !attemptsValid ||
    (rawOutput !== null && !validOutput) ||
    supplied.commercial.usefulOutputDelivered !== validOutput ||
    (validOutput && supplied.commercial.status !== "completed");
  if (rejected) {
    return {
      commercial: {
        ...supplied.commercial,
        failureCategory: "cloudmarkup.runtime.result-sanitization-failed",
        status: "internal-failure",
        usefulOutputDelivered: false,
      },
      output: null,
      rejected: true,
    };
  }
  return {
    commercial: supplied.commercial,

    output: authenticatedOutput,

    rejected: false,
  };
}
export function assertReservedCallback(input: {
  readonly admissionDecision: RuntimeExecutionDecision;
  readonly admissionRequest: RuntimeExecutionRequest;
  readonly commercial: ModelCommercialInvocationContextV1;
  readonly liveEvaluationAuthority: RuntimeLiveExecutionBounds | undefined;
  readonly now: number;
  readonly routingDecision: ModelRoutingDecisionV1;
}): void {
  const {
    admissionDecision,
    admissionRequest,
    commercial,
    liveEvaluationAuthority,
    routingDecision,
  } = input;
  if (
    commercial.reservationId !==
      admissionDecision.authorization.commercialReservationDecisionId ||
    commercial.acceptedMaximumCreditUnits !==
      admissionRequest.commercialEstimate.maximumCreditUnits ||
    commercial.acceptedMaximumEstimatedProviderCostMicros !==
      admissionRequest.commercialEstimate.estimatedMicroUsd ||
    commercial.pricingVersionReference !==
      admissionRequest.commercialEstimate.pricingVersionReference ||
    commercial.pricingVersionReference !==
      routingDecision.pricingVersionReference ||
    commercial.route.route !== routeKind(routingDecision) ||
    commercial.route.routeId !== routingDecision.routeId ||
    commercial.route.providerKey !== routingDecision.providerId ||
    commercial.route.modelId !== routingDecision.modelId ||
    commercial.route.modelVersion !== routingDecision.modelVersion ||
    commercial.route.inferenceProfileId !==
      routingDecision.inferenceProfileId ||
    (admissionDecision.expiresAt !== undefined &&
      input.now >= assertInstant(admissionDecision.expiresAt)) ||
    (liveEvaluationAuthority !== undefined &&
      (input.now >= assertInstant(liveEvaluationAuthority.expiresAt) ||
        commercial.acceptedMaximumCreditUnits >
          liveEvaluationAuthority.limits.maximumCreditUnits ||
        commercial.acceptedMaximumEstimatedProviderCostMicros >
          liveEvaluationAuthority.limits.maximumEstimatedMicroUsd))
  ) {
    throw new ModelRuntimeControlError("routing-authority-mismatch");
  }
}

export function commercialUsageExceedsBounds(input: {
  readonly admissionRequest: RuntimeExecutionRequest;
  readonly commercialRequest: ModelCommercialOperationRequestV1;
  readonly policy: Pick<ModelRuntimeControlPolicyV1, "limits">;
  readonly response: ModelCommercialLifecycleResponseV1;
  readonly routingDecision: ModelRoutingDecisionV1;
}): boolean {
  const units = input.response.technicalUnits;
  if (units === null) return false;
  const planned = plannedMaximums(input.commercialRequest);
  if (
    !Number.isSafeInteger(units.inputUnits) ||
    !Number.isSafeInteger(units.outputUnits) ||
    !Number.isSafeInteger(units.totalUnits) ||
    units.inputUnits < 0 ||
    units.outputUnits < 0 ||
    units.totalUnits < 0
  ) {
    return true;
  }
  return (
    units.inputUnits > input.commercialRequest.requestedMaximumInputUnits ||
    units.inputUnits > planned.inputTokens ||
    units.outputUnits > input.commercialRequest.requestedMaximumOutputUnits ||
    units.outputUnits > planned.outputTokens ||
    units.outputUnits > input.admissionRequest.requested.outputTokens ||
    units.outputUnits > input.policy.limits.maximumOutputTokens ||
    units.outputUnits > input.routingDecision.maximumOutputTokens ||
    units.totalUnits > planned.totalTokens
  );
}

export function checkedInvocationLatencyMilliseconds(
  result: ModelCommercialInvocationResultV1,
): number {
  let total = 0;
  for (const attempt of result.attempts) {
    if (
      !Number.isSafeInteger(attempt.latencyMilliseconds) ||
      attempt.latencyMilliseconds < 0
    ) {
      throw new ModelRuntimeControlError("routing-authority-mismatch");
    }
    total += attempt.latencyMilliseconds;
    if (!Number.isSafeInteger(total)) {
      throw new ModelRuntimeControlError("routing-authority-mismatch");
    }
  }
  return total;
}
export function assertRuntimeRoutingBindings(input: {
  readonly admissionDecision: RuntimeExecutionDecision;
  readonly admissionRequest: RuntimeMetadataRequest;
  readonly policy: Pick<
    ModelRuntimeControlPolicyV1,
    "policyDigest" | "cacheKeyAuthority"
  >;
  readonly evaluationRequirement: Pick<
    ModelRuntimeControlPolicyV1["evaluationGate"],
    | "capabilityRegistryDigest"
    | "routeRegistryDigest"
    | "evaluationPolicyId"
    | "evaluationPolicyVersion"
  >;
  readonly routingDecision: RuntimeMetadataRoute;
  readonly routingRequest: ModelRoutingRequestV1;
}): void {
  const {
    admissionDecision,
    admissionRequest,
    policy,
    routingDecision,
    routingRequest,
  } = input;
  const routingRequestDigest = digestStructuredValue(routingRequest);
  const routingDecisionDigest = digestStructuredValue(routingDecision);
  const requiredRole = requiredModelRoleForDecisionV1(
    routingDecision,
    routingRequest,
  );
  if (
    admissionRequest.runtimePolicyDigest !== policy.policyDigest ||
    admissionRequest.cacheKeyAuthority.dataResidencyBoundary !==
      policy.cacheKeyAuthority.dataResidencyBoundary ||
    admissionRequest.cacheKeyAuthority.organizationSafePolicyScope !==
      policy.cacheKeyAuthority.organizationSafePolicyScope ||
    admissionDecision.runtimePolicyDigest !== policy.policyDigest ||
    admissionDecision.requestDigest !== admissionRequest.requestDigest ||
    admissionDecision.commercialEstimateDigest !==
      admissionRequest.commercialEstimate.estimateDigest ||
    admissionRequest.routingDecisionDigest !== routingDecisionDigest ||
    admissionDecision.routingDecisionDigest !== routingDecisionDigest ||
    routingDecision.requestBinding.routingRequestDigest !==
      routingRequestDigest ||
    routingDecision.requestBinding.idempotencyKeyDigest !==
      admissionRequest.idempotencyKeyDigest ||
    routingRequest.idempotencyKeyDigest !==
      admissionRequest.idempotencyKeyDigest ||
    routingDecision.requestBinding.inputDigest !==
      admissionRequest.inputDigest ||
    routingRequest.inputDigest !== admissionRequest.inputDigest ||
    routingRequest.organizationId !== admissionRequest.organizationId ||
    routingRequest.principalId !== admissionRequest.userId ||
    routingRequest.projectId !== admissionRequest.projectId ||
    routingRequest.feature !== admissionRequest.operation ||
    routingDecision.feature !== admissionRequest.operation ||
    routingRequest.plan.key !== admissionRequest.plan ||
    routingDecision.entitlement.planKey !== admissionRequest.plan ||
    routingRequest.plan.versionId !==
      routingDecision.entitlement.planVersionId ||
    routingRequest.plan.entitlementDecisionId !==
      routingDecision.entitlement.decisionId ||
    admissionRequest.role !== requiredRole ||
    admissionRequest.capabilityRegistryDigest !==
      routingDecision.capabilityRegistryDigest ||
    admissionRequest.routeRegistryDigest !==
      routingDecision.routeRegistryDigest ||
    input.evaluationRequirement.capabilityRegistryDigest !==
      routingDecision.capabilityRegistryDigest ||
    input.evaluationRequirement.routeRegistryDigest !==
      routingDecision.routeRegistryDigest ||
    routingRequest.requiredEvaluationPolicyId !==
      input.evaluationRequirement.evaluationPolicyId ||
    routingRequest.requiredEvaluationPolicyVersion !==
      input.evaluationRequirement.evaluationPolicyVersion ||
    routingDecision.evaluationPolicyId !==
      input.evaluationRequirement.evaluationPolicyId ||
    routingDecision.evaluationPolicyVersion !==
      input.evaluationRequirement.evaluationPolicyVersion ||
    routingDecision.requestedMode !== routingRequest.requestedMode
  ) {
    throw new ModelRuntimeControlError("routing-authority-mismatch");
  }
}

export function assertRuntimeCacheBindings(input: {
  readonly admissionRequest: RuntimeExecutionRequest;
  readonly cacheKey: ModelCacheKeyInputV1 | undefined;
  readonly policy: Pick<ModelRuntimeControlPolicyV1, "cacheKeyAuthority">;
  readonly tuple: ModelRuntimeControlPolicyV1["evaluationGate"]["authorityTuple"];
  readonly promptTemplateDigest: Sha256Digest;
  readonly routingDecision: ModelRoutingDecisionV1;
}): void {
  const {
    admissionRequest,
    cacheKey,
    policy,
    promptTemplateDigest,
    routingDecision,
  } = input;
  const tuple = input.tuple;
  if (!routingDecision.promptCachePolicy.enabled) {
    if (cacheKey !== undefined) {
      throw new ModelRuntimeControlError("routing-authority-mismatch");
    }
    return;
  }
  if (
    cacheKey?.cacheScope !== "organization" ||
    cacheKey.organizationId !== admissionRequest.organizationId ||
    cacheKey.dataResidencyBoundary !==
      admissionRequest.cacheKeyAuthority.dataResidencyBoundary ||
    cacheKey.dataResidencyBoundary !==
      policy.cacheKeyAuthority.dataResidencyBoundary ||
    cacheKey.organizationSafePolicyScope !==
      admissionRequest.cacheKeyAuthority.organizationSafePolicyScope ||
    cacheKey.organizationSafePolicyScope !==
      policy.cacheKeyAuthority.organizationSafePolicyScope ||
    cacheKey.inputDigest !== admissionRequest.inputDigest ||
    cacheKey.promptDigest !== promptTemplateDigest ||
    cacheKey.providerId !== routingDecision.providerId ||
    cacheKey.modelId !== routingDecision.modelId ||
    cacheKey.modelVersion !== routingDecision.modelVersion ||
    cacheKey.inferenceProfileId !== routingDecision.inferenceProfileId ||
    cacheKey.modelConfigurationReference !==
      routingDecision.modelConfigurationReference ||
    cacheKey.capabilityDigest !== routingDecision.modelCapabilityDigest ||
    cacheKey.capabilityVersion !== routingDecision.modelCapabilityVersion ||
    cacheKey.capabilityRegistryDigest !==
      routingDecision.capabilityRegistryDigest ||
    cacheKey.evaluationResultDigest !==
      routingDecision.evaluationResultDigest ||
    cacheKey.evaluationResultVersion !==
      routingDecision.evaluationResultVersion ||
    cacheKey.routeDefinitionDigest !== routingDecision.routeDefinitionDigest ||
    cacheKey.routeRegistryDigest !== routingDecision.routeRegistryDigest ||
    cacheKey.routingConfigurationDigest !==
      routingDecision.routingConfigurationDigest ||
    cacheKey.catalogScopeDigest !== tuple.catalogDigest ||
    cacheKey.promptTemplateId !== tuple.promptTemplateId ||
    cacheKey.promptTemplateVersion !== tuple.promptTemplateVersion ||
    cacheKey.responseSchemaDigest !== tuple.responseSchemaDigest ||
    !cacheKey.contentDigests.includes(admissionRequest.inputDigest)
  ) {
    throw new ModelRuntimeControlError("routing-authority-mismatch");
  }
}
