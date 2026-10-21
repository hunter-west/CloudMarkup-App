import {
  modelRuntimeAuditEventV1Schema,
  modelRuntimeMetricV1Schema,
  sha256DigestSchema,
  type ModelRuntimeAuditEventV1,
  type ModelRuntimeMetricV1,
  type Sha256Digest,
} from "@cloudmarkup/schemas";
import {
  ModelRuntimeControlError,
  type ModelRuntimeDenialReasonV1,
} from "./model-runtime-errors.js";
import type {
  RuntimeExecutionRequest,
  RuntimeExecutionDecision,
} from "./model-runtime-execution-bindings.js";
import type { RuntimeProjectionInput } from "./model-runtime-execution.js";
import type { ModelRuntimeOperationalEventKindV1 } from "./model-runtime-controls.js";
import { digestStructuredValue } from "./security.js";
function distinctDigests(values: readonly Sha256Digest[]): Sha256Digest[] {
  return [...new Set(values)];
}
function safeReasonCode(reason: ModelRuntimeDenialReasonV1): string {
  return "cloudmarkup.runtime." + reason;
}
export function runtimeTelemetryPair(input: {
  readonly authorityDigests: readonly Sha256Digest[];
  readonly decision: RuntimeExecutionDecision;
  readonly eventKind: ModelRuntimeAuditEventV1["eventKind"];
  readonly occurredAt: string;
  readonly request: RuntimeExecutionRequest;
  readonly safeReasons?: readonly ModelRuntimeDenialReasonV1[];
  readonly sourceAuthority?: ModelRuntimeMetricV1["sourceAuthority"];
  readonly unit?: ModelRuntimeMetricV1["unit"];
  readonly value?: number;
}): {
  readonly audit: ModelRuntimeAuditEventV1;
  readonly metric: ModelRuntimeMetricV1;
} {
  const reasons = input.safeReasons ?? [];
  const identity = digestStructuredValue({
    decisionDigest: input.decision.decisionDigest,
    eventKind: input.eventKind,
    occurredAt: input.occurredAt,
    requestDigest: input.request.requestDigest,
  }).slice("sha256:".length, "sha256:".length + 48);
  const audit = modelRuntimeAuditEventV1Schema.parse({
    admissionDecisionDigest: input.decision.decisionDigest,
    contractVersion: 1,
    eventId: `runtime_event_${identity}`,
    eventKind: input.eventKind,
    idempotencyKeyDigest: input.request.idempotencyKeyDigest,
    noRawPromptResponseRepositoryOrCandidateContent: true,
    occurredAt: input.occurredAt,
    organizationId: input.request.organizationId,
    projectId: input.request.projectId,
    recordKind: "model-runtime-audit-event",
    referenceDigests: distinctDigests([
      input.request.runtimePolicyDigest,
      input.request.requestDigest,
      input.request.routingDecisionDigest,
      ...input.authorityDigests,
      input.decision.decisionDigest,
    ]),
    safeReasonCodes: reasons.map(safeReasonCode),
    userId: input.request.userId,
  });
  const metric = modelRuntimeMetricV1Schema.parse({
    contractVersion: 1,
    eventKind: input.eventKind,
    metricId: `runtime_metric_${identity}`,
    noRawSensitiveDimensions: true,
    occurredAt: input.occurredAt,
    organizationScopeDigest: digestStructuredValue({
      organizationId: input.request.organizationId,
    }),
    recordKind: "model-runtime-metric",
    sourceAuthority: input.sourceAuthority ?? "runtime-control-v1",
    unit: input.unit ?? "count",
    value: input.value ?? 1,
  });
  return { audit, metric };
}

export function runtimeOperationalProjectionPair(
  input: RuntimeProjectionInput<
    RuntimeExecutionDecision,
    RuntimeExecutionRequest
  > & { readonly authorityDigests: readonly Sha256Digest[] },
) {
  const { decision, request } = input;
  const projectionAllowed = (
    [
      "import-inference",
      "generation-result",
      "repair-result",
      "validator-failure",
      "groundedness-failure",
      "safety-issue",
    ] as const
  ).includes(input.eventKind as ModelRuntimeOperationalEventKindV1)
    ? input.projection.sourceAuthority === "runtime-control-v1"
    : input.eventKind === "eval-regression"
      ? input.projection.sourceAuthority === "deterministic-evaluation-v1"
      : input.eventKind === "estimated-cost"
        ? input.projection.sourceAuthority === "canonical-commercial-v1" &&
          input.projection.unit === "estimated-micro-usd"
        : input.eventKind === "credits"
          ? input.projection.sourceAuthority === "canonical-commercial-v1" &&
            input.projection.unit === "credit-units"
          : input.eventKind === "tokens"
            ? input.projection.sourceAuthority === "canonical-model-usage-v1" &&
              input.projection.unit === "tokens"
            : input.eventKind === "latency" &&
              input.projection.sourceAuthority === "canonical-model-usage-v1" &&
              input.projection.unit === "milliseconds";
  const requiresReason = [
    "validator-failure",
    "groundedness-failure",
    "safety-issue",
    "eval-regression",
  ].includes(input.eventKind);
  if (
    !projectionAllowed ||
    (input.eventKind === "estimated-cost" &&
      input.projection.value !==
        request.commercialEstimate.estimatedMicroUsd) ||
    (requiresReason && input.safeReasonCodes.length === 0) ||
    !sha256DigestSchema.safeParse(input.sourceEvidenceDigest).success
  ) {
    throw new ModelRuntimeControlError("routing-authority-mismatch");
  }
  const identity = digestStructuredValue({
    decisionDigest: decision.decisionDigest,
    eventKind: input.eventKind,
    occurredAt: input.occurredAt,
    projection: input.projection,
    sourceEvidenceDigest: input.sourceEvidenceDigest,
  }).slice("sha256:".length, "sha256:".length + 48);
  let pair: {
    readonly audit: ModelRuntimeAuditEventV1;
    readonly metric: ModelRuntimeMetricV1;
  };
  try {
    pair = {
      audit: modelRuntimeAuditEventV1Schema.parse({
        admissionDecisionDigest: decision.decisionDigest,
        contractVersion: 1,
        eventId: `runtime_event_${identity}`,
        eventKind: input.eventKind,
        idempotencyKeyDigest: request.idempotencyKeyDigest,
        noRawPromptResponseRepositoryOrCandidateContent: true,
        occurredAt: input.occurredAt,
        organizationId: request.organizationId,
        projectId: request.projectId,
        recordKind: "model-runtime-audit-event",
        referenceDigests: distinctDigests([
          request.runtimePolicyDigest,
          request.requestDigest,
          request.routingDecisionDigest,
          ...input.authorityDigests,
          decision.decisionDigest,
          input.sourceEvidenceDigest,
          ...input.referenceDigests,
        ]),
        safeReasonCodes: input.safeReasonCodes,
        userId: request.userId,
      }),
      metric: modelRuntimeMetricV1Schema.parse({
        contractVersion: 1,
        eventKind: input.eventKind,
        metricId: `runtime_metric_${identity}`,
        noRawSensitiveDimensions: true,
        occurredAt: input.occurredAt,
        organizationScopeDigest: digestStructuredValue({
          organizationId: request.organizationId,
        }),
        recordKind: "model-runtime-metric",
        ...input.projection,
      }),
    };
  } catch {
    throw new ModelRuntimeControlError("routing-authority-mismatch");
  }
  return pair;
}
