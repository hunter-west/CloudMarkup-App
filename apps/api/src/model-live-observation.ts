import {
  digestStructuredValue,
  modelLiveEvaluationObservationV2Schema,
  projectModelLiveEvaluationCaseV2,
  modelEvaluationOperationalBudgetsV1,
  type ModelCommercialOperationRequestV1,
} from "@cloudmarkup/model-gateway";
import type { ModelLiveRuntimeAdmissionRequestV2 } from "@cloudmarkup/schemas";
import type { PostgresModelLiveInvocationJournal } from "./adapters/persistence/model-live-invocation-journal.js";
import type { PostgresModelLiveCommercialAccounting } from "./adapters/persistence/model-live-commercial-accounting.js";

function requireObservation(value: boolean): asserts value {
  if (!value)
    throw new Error("The settled live evaluation observation is unavailable.");
}

/** Actual scoped issuers, not caller observations. Only accepted validator
 * receipts and the exact canonical settlement can become quality observations.
 * A completed negative assessment remains negative. Missing/held/compensated
 * results throw, never become fabricated zero-cost or passing observations.
 * The existing scoring policy is preserved, including its operational budgets;
 * exceeding those budgets is evidence of failure, not a reason to rewrite them.
 * The explicit recovery mode may finish idempotent canonical reconciliation;
 * existing-only mode cannot create a missing terminal. Neither mode can
 * reserve credits, dispatch a model, retain content or promote any route. */
export async function readModelLiveObservationV2(input: {
  readonly terminalMode: "existing-only" | "recover-if-verified";
  readonly journal: PostgresModelLiveInvocationJournal;
  readonly accounting: PostgresModelLiveCommercialAccounting;
  readonly request: ModelCommercialOperationRequestV1;
  readonly admissionRequest: ModelLiveRuntimeAdmissionRequestV2;
  readonly authorize: () => Promise<void>;
}) {
  await input.authorize();
  const before = await input.journal.readValidatedUsage();
  // Historical 2.0.0 receipts remain valid for financial recovery, but used a
  // weaker safety criterion and cannot become current quality observations.
  requireObservation(
    before.receipt.assessment.validatorVersion === "2.1.0" ||
      before.receipt.assessment.validatorVersion === "2.2.0" ||
      before.receipt.assessment.validatorVersion === "2.3.0" ||
      before.receipt.assessment.validatorVersion === "2.4.0" ||
      before.receipt.assessment.validatorVersion === "2.5.0" ||
      before.receipt.assessment.validatorVersion === "2.6.0" ||
      before.receipt.assessment.validatorVersion === "2.7.0" ||
      before.receipt.assessment.validatorVersion === "2.8.0" ||
      before.receipt.assessment.validatorVersion === "2.9.0" ||
      before.receipt.assessment.validatorVersion === "2.10.0" ||
      before.receipt.assessment.validatorVersion === "2.11.0",
  );
  const terminalInput = {
    request: input.request,
    requestDigest: digestStructuredValue(input.request),
    admissionRequest: input.admissionRequest,
  };
  const terminal =
    input.terminalMode === "existing-only"
      ? await input.accounting.readVerified(terminalInput)
      : await input.accounting.recoverVerified(terminalInput);
  requireObservation(
    terminal.kind === "verified" && terminal.outcome.kind === "settlement",
  );
  const { receipt, usage } = before;
  const event = terminal.outcome.event;
  requireObservation(
    terminal.evaluation.runtimeRequestDigest === receipt.runtimeRequestDigest &&
      terminal.evaluation.liveEvaluationPlanDigest === receipt.planDigest &&
      terminal.evaluation.liveEvaluationAuthorityDigest ===
        receipt.approvalDigest &&
      terminal.evaluation.evaluationCaseId === receipt.assessment.caseId &&
      terminal.evaluation.evaluationCaseDigest ===
        receipt.assessment.caseDigest &&
      event.attempts.length === 1 &&
      event.organizationId === receipt.organizationId &&
      event.projectId === receipt.projectId &&
      event.userId === receipt.userId &&
      event.modelId === usage.modelId &&
      event.modelVersion === usage.modelVersion &&
      event.providerKey === usage.providerId &&
      event.inferenceProfileId === (usage.inferenceProfileId ?? null) &&
      event.feature === usage.feature &&
      event.inputUnits === Number(usage.inputUnits) &&
      event.outputUnits === Number(usage.outputUnits) &&
      event.totalUnits ===
        Number(usage.inputUnits) + Number(usage.outputUnits) &&
      event.cacheReadUnits === 0 &&
      event.cacheWriteUnits === 0 &&
      digestStructuredValue(event.providerSpecificUnits) ===
        digestStructuredValue(
          Number(usage.thinkingUnits) === 0
            ? []
            : [
                {
                  unitName: "thinking-units",
                  units: Number(usage.thinkingUnits),
                },
              ],
        ) &&
      // Canonical receipts time the entire host dispatch/validation interval;
      // normalized usage times the SDK attempt within that interval.
      event.startedAt !== null &&
      event.completedAt !== null &&
      Date.parse(event.startedAt) <= Date.parse(usage.startedAt) &&
      Date.parse(event.completedAt) >= Date.parse(usage.completedAt) &&
      event.latencyMilliseconds >= usage.durationMilliseconds &&
      event.compensatedCreditUnits === 0 &&
      event.failureCategory === null,
  );
  const operationalUsage = {
    commercialSourceAuthority: "canonical-commercial-v1" as const,
    usageSourceAuthority: "canonical-model-usage-v1" as const,
    creditUnits: event.chargedCreditUnits,
    estimatedMicroUsd: event.estimatedProviderCostMicros,
    inputTokens: event.inputUnits,
    outputTokens: event.outputUnits,
    totalTokens: event.totalUnits,
    latencyMilliseconds: usage.durationMilliseconds,
  };
  const operational = [
    [
      "credits",
      operationalUsage.creditUnits,
      "canonical-commercial-v1",
      digestStructuredValue(terminal),
    ],
    [
      "estimated-cost",
      operationalUsage.estimatedMicroUsd,
      "canonical-commercial-v1",
      digestStructuredValue(terminal),
    ],
    [
      "tokens",
      operationalUsage.totalTokens,
      "canonical-model-usage-v1",
      receipt.normalizedUsageDigest,
    ],
    [
      "latency",
      operationalUsage.latencyMilliseconds,
      "canonical-model-usage-v1",
      receipt.normalizedUsageDigest,
    ],
  ] as const;
  const observation = modelLiveEvaluationObservationV2Schema.parse({
    adapterId: "cloudmarkup.production-live-evaluation.v2",
    adapterVersion: "2.1.0",
    contractVersion: 2,
    executionMode: "live",
    caseId: receipt.assessment.caseId,
    caseDigest: receipt.assessment.caseDigest,
    outputDigest: receipt.assessment.outputDigest,
    assistancePreferenceSemantics:
      receipt.assessment.assistancePreferenceSemantics,
    measurements: [
      ...receipt.assessment.measurements,
      ...operational.map(([dimension, numerator, sourceAuthority, digest]) => ({
        dimension,
        numerator,
        sourceAuthority,
        denominator: modelEvaluationOperationalBudgetsV1[dimension],
        evidenceDigests: [digest],
      })),
    ],
    operationalUsage,
    safeErrorCodes: [],
    noRawPromptResponseRepositoryOrCandidateContent: true,
  });
  const caseResult = projectModelLiveEvaluationCaseV2({
    evaluationCase: before.evaluationCase,
    authorityBinding: before.authorityBinding,
    observation,
  });
  await input.authorize();
  requireObservation(
    digestStructuredValue(await input.journal.readValidatedUsage()) ===
      digestStructuredValue(before),
  );
  await input.authorize();
  return {
    contractVersion: 2 as const,
    observation,
    caseResult,
    validationReceiptDigest: receipt.receiptDigest,
    canonicalTerminalDigest: digestStructuredValue(terminal),
    hostLatencyMilliseconds: event.latencyMilliseconds,
    observationDigest: digestStructuredValue(observation),
  };
}
