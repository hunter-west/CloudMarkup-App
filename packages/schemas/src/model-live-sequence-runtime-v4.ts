import { z } from "zod";
import {
  modelLiveSequenceRuntimeAdmissionRequestV3Schema,
  modelLiveSequenceRuntimeAdmissionDecisionV3Schema,
} from "./model-live-sequence-runtime-v3.js";
import { digestCanonicalValue } from "./canonical-digest.js";
import { sha256DigestSchema } from "./architecture-document-v1.js";
import { refineModelRuntimeAdmissionDecision } from "./model-runtime-admission-decision-validation.js";

const sequence = {
  contractVersion: z.literal(4),
  parentSequenceContractVersion: z.literal(3),
  stageKey: z.literal("repair-1"),
  canonicalPlannedCallsDigest: sha256DigestSchema,
};
/** One whole-case admission over the unchanged V3 first input and two issued
 * slots. requested remains the actual first-send resources; the exact canonical
 * planned-call list separately binds the aggregate reservation. No data record
 * grants current tenant, credit, capacity or provider authority. */
export const modelLiveSequenceRuntimeAdmissionRequestV4Schema = z
  .object({
    ...modelLiveSequenceRuntimeAdmissionRequestV3Schema.shape,
    ...sequence,
  })
  .strict()
  .superRefine((value, context) => {
    const { requestDigest, ...body } = value;
    if (requestDigest !== digestCanonicalValue(body))
      context.addIssue({
        code: "custom",
        path: ["requestDigest"],
        message: "The complete two-slot runtime request digest is required.",
      });
    if (value.requested.repairAttempts !== 2)
      context.addIssue({
        code: "custom",
        path: ["requested", "repairAttempts"],
        message: "The exact pre-issued two-slot repair ceiling is required.",
      });
  });
export type ModelLiveSequenceRuntimeAdmissionRequestV4 = z.output<
  typeof modelLiveSequenceRuntimeAdmissionRequestV4Schema
>;

export const modelLiveSequenceRuntimeAdmissionDecisionV4Schema = z
  .object({
    ...modelLiveSequenceRuntimeAdmissionDecisionV3Schema.shape,
    ...sequence,
  })
  .strict()
  .superRefine(refineModelRuntimeAdmissionDecision);
export type ModelLiveSequenceRuntimeAdmissionDecisionV4 = z.output<
  typeof modelLiveSequenceRuntimeAdmissionDecisionV4Schema
>;

export const modelLiveSequenceRuntimeRecordV4Schema = z.union([
  modelLiveSequenceRuntimeAdmissionRequestV4Schema,
  modelLiveSequenceRuntimeAdmissionDecisionV4Schema,
]);
