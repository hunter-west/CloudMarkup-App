import { modelLiveRepositoryCaseAssessmentV2_9Schema } from "../../model-live-repository-case-assessment-v2-9.js";
import { modelLiveExternalCaseAssessmentV2_10Schema } from "../../model-live-external-case-assessment-v2-10.js";
import { modelLiveEventCaseAssessmentSuccessorV2Schema } from "../../model-live-event-case-assessment-successor.js";
import { modelLiveEventCaseAssessmentV2Schema } from "../../model-live-event-case-assessment.js";
import { modelLiveExternalCaseAssessmentV2Schema } from "../../model-live-external-case-assessment.js";
import { modelLiveRepositoryCaseAssessmentV2Schema } from "../../model-live-repository-case-assessment.js";
import { modelLiveBoundedRefusalCaseAssessmentV2Schema } from "../../model-live-bounded-refusal-case-assessment.js";
import { z } from "zod";
import {
  digestStructuredValue,
  inspectModelValueForSecretCandidatesV1,
  modelLiveProposalCaseAssessmentV2Schema,
  modelLiveIntentCaseAssessmentV2Schema,
} from "@cloudmarkup/model-gateway";
import {
  sha256DigestSchema,
  solutionStableIdSchema,
} from "@cloudmarkup/schemas";

import { modelLiveQuestionsCaseAssessmentV2Schema } from "../../model-live-questions-case-assessment.js";
import { modelLivePrivateVpcCaseAssessmentV2Schema } from "../../model-live-private-vpc-case-assessment.js";

export class ModelLiveProposalValidationError extends Error {
  readonly code = "model-live-evaluation.validation-receipt-unavailable";
  constructor() {
    super("The exact completed case validation receipt is unavailable.");
    this.name = "ModelLiveProposalValidationError";
  }
}
export function requireLiveValidation(value: boolean): asserts value {
  if (!value) throw new ModelLiveProposalValidationError();
}

/** Data only. Issuance requires the host's actual validator and scoped SQL
 * journal. A failed quality observation is not permission to promote a model. */
export const modelLiveProposalValidationReceiptV2Schema = z
  .object({
    contractVersion: z.literal(2),
    recordKind: z.literal("model-live-proposal-validation-receipt"),
    receiptId: solutionStableIdSchema,
    receiptDigest: sha256DigestSchema,
    organizationId: solutionStableIdSchema,
    projectId: solutionStableIdSchema,
    userId: solutionStableIdSchema,
    invocationId: solutionStableIdSchema,
    journalBindingDigest: sha256DigestSchema,
    runtimeRequestDigest: sha256DigestSchema,
    planDigest: sha256DigestSchema,
    approvalDigest: sha256DigestSchema,
    inputEvidenceId: solutionStableIdSchema,
    inputEvidenceDigest: sha256DigestSchema,
    operationsEvidenceId: solutionStableIdSchema,
    operationsEvidenceDigest: sha256DigestSchema,
    ownershipEvidenceId: solutionStableIdSchema,
    ownershipEvidenceDigest: sha256DigestSchema,
    normalizedUsageDigest: sha256DigestSchema,
    assessment: z.union([
      modelLiveProposalCaseAssessmentV2Schema,
      modelLiveIntentCaseAssessmentV2Schema,
      modelLivePrivateVpcCaseAssessmentV2Schema,
      modelLiveQuestionsCaseAssessmentV2Schema,
      modelLiveBoundedRefusalCaseAssessmentV2Schema,
      modelLiveRepositoryCaseAssessmentV2Schema,
      modelLiveRepositoryCaseAssessmentV2_9Schema,
      modelLiveExternalCaseAssessmentV2Schema,
      modelLiveExternalCaseAssessmentV2_10Schema,
      modelLiveEventCaseAssessmentV2Schema,
      modelLiveEventCaseAssessmentSuccessorV2Schema,
    ]),
  })
  .strict()
  .superRefine((value, context) => {
    const { receiptId, receiptDigest, ...body } = value;
    const expectedId = "validation_" + digestStructuredValue(body).slice(7);
    if (
      receiptId !== expectedId ||
      receiptDigest !== digestStructuredValue({ ...body, receiptId }) ||
      new TextEncoder().encode(JSON.stringify(value)).byteLength > 16384 ||
      inspectModelValueForSecretCandidatesV1(value).detectedValueCount !== 0
    ) {
      context.addIssue({
        code: "custom",
        message: "Live case receipt metadata is contradictory.",
      });
    }
  });
export type ModelLiveProposalValidationReceiptV2 = z.output<
  typeof modelLiveProposalValidationReceiptV2Schema
>;

export function identifyLiveProposalValidationReceipt(
  body: Omit<
    ModelLiveProposalValidationReceiptV2,
    "receiptId" | "receiptDigest"
  >,
): ModelLiveProposalValidationReceiptV2 {
  const identified = {
    ...body,
    receiptId: "validation_" + digestStructuredValue(body).slice(7),
  };
  return modelLiveProposalValidationReceiptV2Schema.parse({
    ...identified,
    receiptDigest: digestStructuredValue(identified),
  });
}
