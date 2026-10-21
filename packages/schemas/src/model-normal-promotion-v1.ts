import { z } from "zod";

import {
  namespacedIdentifierSchema,
  semanticVersionSchema,
  sha256DigestSchema,
  utcTimestampSchema,
} from "./architecture-document-v1.js";
import { digestCanonicalValue } from "./canonical-digest.js";
import {
  modelEvaluationAuthorityBindingV1Schema,
  modelEvaluationCaseKindV1Values,
} from "./model-evaluation-v1.js";
import { modelCapabilityEnvironmentV1Schema } from "./model-routing-v1.js";
import { solutionStableIdSchema } from "./solution-contract-common-v1.js";

/** Exact proposed scope, not a bearer credential or permission grant. A future
 * host must independently authenticate issuance and current scope authority. */
export const modelNormalPromotionScopeV1Schema = z
  .object({
    environment: modelCapabilityEnvironmentV1Schema,
    organizationId: solutionStableIdSchema,
    projectId: solutionStableIdSchema,
    userId: solutionStableIdSchema,
  })
  .strict();

/** Metadata shape only. Parsing or a matching digest does not establish that a
 * receipt was issued, remains current, or can authorize runtime/model execution.
 * A receipt references the unchanged held report and final normal policy in one
 * direction; neither referenced object includes this receipt's digest. */
export const modelNormalPromotionReceiptV1Schema = z
  .object({
    authorityDigest: sha256DigestSchema,
    authorityBinding: modelEvaluationAuthorityBindingV1Schema,
    contractVersion: z.literal(1),
    effectiveFrom: utcTimestampSchema,
    expiresAt: utcTimestampSchema,
    issuedAt: utcTimestampSchema,
    issuerId: namespacedIdentifierSchema,
    issuerVersion: semanticVersionSchema,
    receiptId: solutionStableIdSchema,
    recordKind: z.literal("model-normal-promotion-receipt"),
    routeId: z.literal("standard-design"),
    scope: modelNormalPromotionScopeV1Schema,
    evaluation: z
      .object({
        datasetCaseDigests: z
          .array(sha256DigestSchema)
          .length(modelEvaluationCaseKindV1Values.length),
        datasetDigest: sha256DigestSchema,
        environment: z.enum(["development", "staging"]),
        evaluationPolicyDigest: sha256DigestSchema,
        evaluationPolicyId: namespacedIdentifierSchema,
        evaluationPolicyVersion: semanticVersionSchema,
        liveEvaluationAuthorityDigest: sha256DigestSchema,
        reportDigest: sha256DigestSchema,
        reportId: solutionStableIdSchema,
        resultSetDigest: sha256DigestSchema,
      })
      .strict(),
    runtimePolicy: z
      .object({
        policyDigest: sha256DigestSchema,
        policyId: namespacedIdentifierSchema,
        policyVersion: semanticVersionSchema,
        runtimeControlConfigurationDigest: sha256DigestSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const tuple = value.authorityBinding.authorityTuple;
    if (
      tuple.operation !== "intent.extract" ||
      !["low-cost-extraction-help", "standard-planning-generation"].includes(
        tuple.role,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Only the Standard Intent tuple is supported.",
        path: ["authorityBinding"],
      });
    }
    if (
      new Set(value.evaluation.datasetCaseDigests).size !==
      modelEvaluationCaseKindV1Values.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Every evaluation case must have a unique digest.",
        path: ["evaluation", "datasetCaseDigests"],
      });
    }
    const issued = Date.parse(value.issuedAt),
      effective = Date.parse(value.effectiveFrom),
      expires = Date.parse(value.expiresAt);
    if (
      !Number.isFinite(issued) ||
      !Number.isFinite(effective) ||
      !Number.isFinite(expires) ||
      effective < issued ||
      expires <= effective
    ) {
      context.addIssue({
        code: "custom",
        message: "The proposed receipt interval must be ordered and nonempty.",
        path: ["expiresAt"],
      });
    }
    const { authorityDigest, ...metadata } = value;
    if (authorityDigest !== digestCanonicalValue(metadata)) {
      context.addIssue({
        code: "custom",
        message: "The digest must bind the complete receipt metadata.",
        path: ["authorityDigest"],
      });
    }
  });

export type ModelNormalPromotionReceiptV1 = z.output<
  typeof modelNormalPromotionReceiptV1Schema
>;
export type ModelNormalPromotionScopeV1 = z.output<
  typeof modelNormalPromotionScopeV1Schema
>;

/** Pure content digest, never issuance, approval or current authorization. */
export function digestModelNormalPromotionReceiptV1(
  value: Omit<ModelNormalPromotionReceiptV1, "authorityDigest">,
) {
  return digestCanonicalValue(value);
}
