import { intentDocumentV1Schema } from "@cloudmarkup/schemas";
import { z } from "zod";

import {
  modelCommercialLifecycleResponseV1Schema,
  modelCommercialRouteV1Schema,
} from "./model-commercial-lifecycle.js";

const safeIdentifierSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u);
const safeMessageSchema = z.string().min(1).max(1_000);

export const modelIntentIssueV1Schema = z
  .object({
    category: z.enum([
      "ambiguity",
      "commercial-denial",
      "provider-unavailable",
      "reconciliation-required",
      "redaction",
      "unsupported-capability",
    ]),
    issueId: safeIdentifierSchema,
    message: safeMessageSchema,
    severity: z.enum(["information", "warning", "blocking"]),
  })
  .strict();

export const modelIntentQuestionV1Schema = z
  .object({
    classification: z.enum(["blocking", "non-blocking"]),
    question: safeMessageSchema,
    questionId: safeIdentifierSchema,
    rationale: safeMessageSchema.nullable(),
  })
  .strict();

export const modelIntentAssumptionV1Schema = z
  .object({
    assumptionId: safeIdentifierSchema,
    statement: safeMessageSchema,
    status: z.enum(["active", "confirmed", "rejected"]),
  })
  .strict();

export const modelIntentExecutionProvenanceV1Schema = z
  .object({
    inferenceProfileId: safeIdentifierSchema.nullable(),
    invocationId: safeIdentifierSchema,
    jobId: safeIdentifierSchema,
    modelId: safeIdentifierSchema,
    modelVersion: safeIdentifierSchema,
    promptTemplateId: safeIdentifierSchema,
    promptVersion: safeIdentifierSchema,
    providerId: safeIdentifierSchema,
    route: modelCommercialRouteV1Schema,
    routeId: safeIdentifierSchema,
    stopReason: safeIdentifierSchema.nullable(),
  })
  .strict();

export const modelIntentResultV1Schema = z
  .object({
    assumptions: z.array(modelIntentAssumptionV1Schema).max(256),
    commercial: modelCommercialLifecycleResponseV1Schema,
    contractVersion: z.literal(1),
    intentDocument: intentDocumentV1Schema.nullable(),
    issues: z.array(modelIntentIssueV1Schema).max(256),
    operation: z.enum(["intent.extract", "requirements.blocking-questions"]),
    provenance: modelIntentExecutionProvenanceV1Schema.nullable(),
    questions: z.array(modelIntentQuestionV1Schema).max(256),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.operation === "requirements.blocking-questions" &&
        value.intentDocument !== null) ||
      (value.operation === "intent.extract" &&
        value.provenance !== null &&
        value.intentDocument === null)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Only a provider-completed Intent extraction carries an Intent document.",
        path: ["intentDocument"],
      });
    }
    if (
      (value.provenance === null) !==
      [
        "denied",
        "estimate-confirmation-required",
        "reservation-denied",
      ].includes(value.commercial.state)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Pre-invocation commercial denial cannot carry provider provenance.",
        path: ["provenance"],
      });
    }
    if (
      value.provenance !== null &&
      value.commercial.route?.route !== value.provenance.route
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Provider provenance must match the commercially authorized route.",
        path: ["provenance", "route"],
      });
    }
  });

export type ModelIntentIssueV1 = z.output<typeof modelIntentIssueV1Schema>;
export type ModelIntentResultV1 = z.output<typeof modelIntentResultV1Schema>;
