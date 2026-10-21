import { z } from "zod";
import {
  modelLiveRuntimeAdmissionRequestV2Schema,
  sha256DigestSchema,
  solutionStableIdSchema,
  type ModelLiveRuntimeAdmissionRequestV2,
} from "@cloudmarkup/schemas";
import type { ModelCommercialOperationRequestV1 } from "./commercial-lifecycle.js";
import type { ModelCommercialVerifiedTerminalV1 } from "./model-commercial-terminal-recovery.js";
import {
  assertCanonicalModelTerminalIntegrity,
  canonicalModelTerminalMetadataSchema,
} from "./model-commercial-terminal-integrity.js";
import { digestStructuredValue, sha256Text } from "./security.js";

const evaluationBindingSchema = z
  .object({
    runtimeRequestDigest: sha256DigestSchema,
    liveEvaluationPlanDigest: sha256DigestSchema,
    liveEvaluationAuthorityDigest: sha256DigestSchema,
    evaluationCaseId: solutionStableIdSchema,
    evaluationCaseDigest: sha256DigestSchema,
  })
  .strict();
// Resolve the shared schema at parse time: public package import order also
// reaches the coordinator through the shared terminal integrity implementation.
const verified = z.lazy(() =>
  canonicalModelTerminalMetadataSchema
    .extend({
      authority: z.literal("canonical-model-live-terminal-v2"),
      evaluation: evaluationBindingSchema,
    })
    .strict(),
);

export interface ModelLiveCommercialVerifiedTerminalV2 extends Omit<
  ModelCommercialVerifiedTerminalV1,
  "authority"
> {
  readonly authority: "canonical-model-live-terminal-v2";
  readonly evaluation: z.output<typeof evaluationBindingSchema>;
}
export interface ModelLiveCommercialTerminalRecoveryPortV2 {
  /** Existing, exact evaluation work only. No new reservation or provider call. */
  recoverVerified(input: {
    readonly request: ModelCommercialOperationRequestV1;
    readonly requestDigest: string;
    readonly admissionRequest: ModelLiveRuntimeAdmissionRequestV2;
  }): Promise<
    { readonly kind: "unavailable" } | ModelLiveCommercialVerifiedTerminalV2
  >;
}
/** Shape and exact binding only. Actual canonical ledger and journal verification
 * must come from the scoped host; parsed metadata grants no approval or settlement. */
export function parseModelLiveCommercialVerifiedTerminalV2(
  value: unknown,
  request: ModelCommercialOperationRequestV1,
  rawAdmissionRequest: ModelLiveRuntimeAdmissionRequestV2,
): ModelLiveCommercialVerifiedTerminalV2 {
  const admission =
    modelLiveRuntimeAdmissionRequestV2Schema.parse(rawAdmissionRequest);
  const parsed = verified.parse(value);
  const expected = {
    runtimeRequestDigest: admission.requestDigest,
    liveEvaluationPlanDigest: admission.liveEvaluationPlanDigest,
    liveEvaluationAuthorityDigest: admission.liveEvaluationAuthorityDigest,
    evaluationCaseId: admission.evaluationCaseId,
    evaluationCaseDigest: admission.evaluationCaseDigest,
  };
  if (
    digestStructuredValue(parsed.evaluation) !==
      digestStructuredValue(expected) ||
    request.organizationId !== admission.organizationId ||
    request.projectId !== admission.projectId ||
    request.userId !== admission.userId ||
    request.feature !== admission.operation ||
    sha256Text(request.idempotencyKey) !== admission.idempotencyKeyDigest ||
    request.requestedMaximumOutputUnits !== admission.requested.outputTokens ||
    parsed.outcome.event.pricingVersionId !==
      admission.commercialEstimate.pricingVersionReference ||
    parsed.outcome.response.estimate.maximumCreditUnits !==
      admission.commercialEstimate.maximumCreditUnits
  )
    throw new TypeError(
      "Canonical live evaluation terminal metadata is contradictory.",
    );
  assertCanonicalModelTerminalIntegrity(parsed, request);
  return parsed;
}
