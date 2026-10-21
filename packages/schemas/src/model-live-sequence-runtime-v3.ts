import { z } from "zod";
import { digestCanonicalValue } from "./canonical-digest.js";
import {
  modelLiveRuntimeAdmissionRequestV2Schema,
  modelLiveRuntimeAdmissionDecisionV2Schema,
} from "./model-live-evaluation-v2.js";
import { modelLiveSequenceInputV3Schema } from "./model-live-evaluation-sequence-v3.js";
import { sha256DigestSchema } from "./architecture-document-v1.js";
import { refineModelRuntimeAdmissionDecision } from "./model-runtime-admission-decision-validation.js";

const stage = modelLiveSequenceInputV3Schema.shape;
const stageBinding = {
  evaluationCaseId: stage.caseId,
  evaluationCaseDigest: stage.caseDigest,
  selectionId: stage.selectionId,
  selectionDigest: stage.selectionDigest,
  stageId: stage.stageId,
  stageKey: stage.stageKey,
  invocationId: stage.invocationId,
  inputBindingDigest: stage.inputBindingDigest,
  preparedPayloadDigest: stage.preparedPayloadDigest,
};
const { inputEvidenceDigest: legacyInputEvidence, ...requestFields } =
  modelLiveRuntimeAdmissionRequestV2Schema.shape;
void legacyInputEvidence;

/** Explicit V3 stage admission data. It references the exact issued V3 input,
 * not a V1 input-evidence record. Parsing never grants current authority,
 * capacity, canonical credits, provider access or ordinary AI activation.
 * V1/V2 schemas and historical sequence artifacts remain unchanged. */
export const modelLiveSequenceRuntimeAdmissionRequestV3Schema = z
  .object({
    ...requestFields,
    ...stageBinding,
    contractVersion: z.literal(3),
    recordKind: z.literal("model-live-sequence-runtime-admission-request"),
    operation: z.literal("candidate.repair"),
    role: z.literal("repair-escalation"),
    liveEvaluationPlanDigest: stage.planDigest,
    liveEvaluationAuthorityDigest: sha256DigestSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const { requestDigest, ...body } = value;
    if (requestDigest !== digestCanonicalValue(body))
      context.addIssue({
        code: "custom",
        path: ["requestDigest"],
        message: "The exact complete stage admission digest is required.",
      });
    if (value.requested.repairAttempts !== 2)
      context.addIssue({
        code: "custom",
        path: ["requested", "repairAttempts"],
        message: "Preserve the approved two-stage repair ceiling.",
      });
  });
export type ModelLiveSequenceRuntimeAdmissionRequestV3 = z.output<
  typeof modelLiveSequenceRuntimeAdmissionRequestV3Schema
>;
export function digestModelLiveSequenceRuntimeAdmissionRequestV3(
  value: Omit<ModelLiveSequenceRuntimeAdmissionRequestV3, "requestDigest">,
) {
  return digestCanonicalValue(value);
}

/** Outcome invariants reuse the normal/live algorithm. An allowed data record
 * still requires issuance by the authenticated stage runtime store. */
export const modelLiveSequenceRuntimeAdmissionDecisionV3Schema = z
  .object({
    ...modelLiveRuntimeAdmissionDecisionV2Schema.shape,
    ...stageBinding,
    contractVersion: z.literal(3),
    recordKind: z.literal("model-live-sequence-runtime-admission-decision"),
  })
  .strict()
  .superRefine(refineModelRuntimeAdmissionDecision);
export type ModelLiveSequenceRuntimeAdmissionDecisionV3 = z.output<
  typeof modelLiveSequenceRuntimeAdmissionDecisionV3Schema
>;
export function digestModelLiveSequenceRuntimeAdmissionDecisionV3(
  value: Omit<ModelLiveSequenceRuntimeAdmissionDecisionV3, "decisionDigest">,
) {
  return digestCanonicalValue(value);
}
