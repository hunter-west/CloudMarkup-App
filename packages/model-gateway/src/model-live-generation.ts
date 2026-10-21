import {
  modelLiveRuntimeAdmissionRequestV2Schema,
  type ModelLiveRuntimeAdmissionRequestV2,
} from "@cloudmarkup/schemas";
import type { ModelCommercialOperationRequestV1 } from "./commercial-lifecycle.js";
import {
  parseSinglePrimaryGeneration,
  type ModelGenerationMetadata,
} from "./model-generation-integrity.js";
import { sha256Text } from "./security.js";

/** Explicit V2 generation metadata. Not validator, delivery or settlement evidence. */
export type ModelLiveGenerationEvidenceV2 = ModelGenerationMetadata;
export function parseModelLiveGenerationEvidenceV2(
  value: unknown,
  request: ModelCommercialOperationRequestV1,
  rawAdmission: ModelLiveRuntimeAdmissionRequestV2,
): ModelLiveGenerationEvidenceV2 {
  const admission =
    modelLiveRuntimeAdmissionRequestV2Schema.parse(rawAdmission);
  if (
    request.organizationId !== admission.organizationId ||
    request.projectId !== admission.projectId ||
    request.userId !== admission.userId ||
    request.feature !== admission.operation ||
    sha256Text(request.idempotencyKey) !== admission.idempotencyKeyDigest ||
    request.requestedMaximumOutputUnits !== admission.requested.outputTokens
  )
    throw new TypeError("Live generation metadata binding is contradictory.");
  return parseSinglePrimaryGeneration(value, request);
}
