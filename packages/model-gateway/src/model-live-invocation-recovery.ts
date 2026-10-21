import { z } from "zod";
import {
  modelLiveRuntimeAdmissionRequestV2Schema,
  sha256DigestSchema,
  solutionStableIdSchema,
  type ModelLiveRuntimeAdmissionRequestV2,
} from "@cloudmarkup/schemas";
import {
  parseModelCommercialInvocationResultV1,
  type ModelCommercialDispatchIntentV1,
  type ModelCommercialInvocationResultV1,
  type ModelCommercialOperationRequestV1,
} from "./commercial-lifecycle.js";
import { parseModelLiveGenerationEvidenceV2 } from "./model-live-generation.js";
import {
  digestStructuredValue,
  inspectModelValueForSecretCandidatesV1,
} from "./security.js";

const bindingSchema = z
  .object({
    runtimeRequestDigest: sha256DigestSchema,
    liveEvaluationPlanDigest: sha256DigestSchema,
    liveEvaluationAuthorityDigest: sha256DigestSchema,
    evaluationCaseId: solutionStableIdSchema,
    evaluationCaseDigest: sha256DigestSchema,
  })
  .strict();
const envelope = z
  .object({
    kind: z.literal("verified"),
    authority: z.literal("canonical-model-live-invocation-v2"),
    dispatchIntentId: solutionStableIdSchema,
    requestDigest: sha256DigestSchema,
    evaluation: bindingSchema,
    source: z.enum([
      "validated-output",
      "failed-generation",
      "expired-unvalidated-output",
    ]),
    outputDigest: sha256DigestSchema.nullable(),
    validationReceiptDigest: sha256DigestSchema.nullable(),
    result: z.unknown(),
  })
  .strict();

export interface ModelLiveCommercialInvocationEvidenceV2 extends Omit<
  z.output<typeof envelope>,
  "result"
> {
  readonly result: ModelCommercialInvocationResultV1;
}
export interface ModelLiveCommercialInvocationRecoveryPortV2 {
  /** Host-owned verification of actual scoped usage/validator journal rows.
   * Parsed metadata alone is never validator, delivery or commercial authority. */
  recoverVerified(input: {
    readonly dispatchIntent: ModelCommercialDispatchIntentV1;
    readonly request: ModelCommercialOperationRequestV1;
    readonly admissionRequest: ModelLiveRuntimeAdmissionRequestV2;
  }): Promise<
    | { readonly kind: "unavailable" }
    | { readonly kind: "pending" }
    | ModelLiveCommercialInvocationEvidenceV2
  >;
}
/** Strict shape/binding validation after the host authenticates journal issuance.
 * A failed generation can carry known usage, but cannot claim a validated output.
 * Missing usage is unavailable; this parser never manufactures a no-dispatch proof. */
export function parseModelLiveCommercialInvocationEvidenceV2(
  value: unknown,
  request: ModelCommercialOperationRequestV1,
  dispatch: ModelCommercialDispatchIntentV1,
  rawAdmission: ModelLiveRuntimeAdmissionRequestV2,
): ModelLiveCommercialInvocationEvidenceV2 {
  const admission =
    modelLiveRuntimeAdmissionRequestV2Schema.parse(rawAdmission);
  const parsed = envelope.parse(value);
  const expected = {
    runtimeRequestDigest: admission.requestDigest,
    liveEvaluationPlanDigest: admission.liveEvaluationPlanDigest,
    liveEvaluationAuthorityDigest: admission.liveEvaluationAuthorityDigest,
    evaluationCaseId: admission.evaluationCaseId,
    evaluationCaseDigest: admission.evaluationCaseDigest,
  };
  const result = parseModelCommercialInvocationResultV1(parsed.result, request);
  const {
    usefulOutputDelivered,
    preDispatchNoUsageAttestation,
    ...generation
  } = result;
  const generated = parseModelLiveGenerationEvidenceV2(
    generation,
    request,
    admission,
  );
  const completed = parsed.source === "validated-output";
  const unvalidated = parsed.source === "expired-unvalidated-output";
  if (
    parsed.requestDigest !== digestStructuredValue(request) ||
    parsed.dispatchIntentId !== dispatch.dispatchIntentId ||
    digestStructuredValue(parsed.evaluation) !==
      digestStructuredValue(expected) ||
    preDispatchNoUsageAttestation !== undefined ||
    generated.attempts.some((a) => a.usage === null) ||
    (completed
      ? generated.status !== "completed" ||
        !usefulOutputDelivered ||
        parsed.outputDigest === null ||
        parsed.validationReceiptDigest === null
      : unvalidated
        ? generated.status !== "internal-failure" ||
          generated.failureCategory !==
            "cloudmarkup.model-evaluation.validation-unavailable" ||
          usefulOutputDelivered ||
          parsed.outputDigest === null ||
          parsed.validationReceiptDigest !== null ||
          generated.attempts.some((attempt) => attempt.status !== "succeeded")
        : generated.status === "completed" ||
          usefulOutputDelivered ||
          parsed.outputDigest !== null ||
          parsed.validationReceiptDigest !== null) ||
    new TextEncoder().encode(JSON.stringify(parsed)).length > 16384 ||
    inspectModelValueForSecretCandidatesV1(parsed).detectedValueCount !== 0
  )
    throw new TypeError("Live invocation recovery evidence is contradictory.");
  return { ...parsed, result };
}
