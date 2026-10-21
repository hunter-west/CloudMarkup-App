import { modelIntentExtractionResponseV1Schema } from "@cloudmarkup/schemas";
import { z } from "zod";

import { sha256DigestSchema } from "./common.js";

/** RAM-only wire limits, not model admission, delivery or charging authority. */
export const AI_INTENT_PREVIEW_STREAM_LIMITS_V1 = Object.freeze({
  candidateFrameBytes: 256 * 1024,
  totalBytes: 272 * 1024,
  heartbeatMilliseconds: 5000,
  backpressureMilliseconds: 5000,
  deadlineMilliseconds: 180000,
});
export const AI_INTENT_PREVIEW_SSE_EVENT_V1 =
  "cloudmarkup.ai-intent-preview.v1";

export const aiIntentPreviewDeliveryProofV1Schema = z
  .object({
    contractVersion: z.literal(1),
    invocationId: z
      .string()
      .regex(/^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/u),
    outputDigest: sha256DigestSchema,
    expiresAt: z.string().refine((value) => {
      const parsed = Date.parse(value);
      return (
        Number.isFinite(parsed) && new Date(parsed).toISOString() === value
      );
    }),
    token: z.string().regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u),
  })
  .strict();

export const aiIntentPreviewStatusFrameV1Schema = z
  .object({
    contractVersion: z.literal(1),
    type: z.literal("status"),
    code: z.enum([
      "processing",
      "awaiting-acknowledgement",
      "result-unavailable",
      "finished",
      "unavailable",
    ]),
  })
  .strict();

/** Source schema and identity validation only. Sender and receiver must also
 * verify the canonical candidate digest before sending/acknowledging it. */
export const aiIntentPreviewCandidateFrameV1Schema = z
  .object({
    contractVersion: z.literal(1),
    type: z.literal("candidate"),
    candidate: modelIntentExtractionResponseV1Schema,
    delivery: aiIntentPreviewDeliveryProofV1Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.candidate.provenance.invocationId !== value.delivery.invocationId)
      context.addIssue({
        code: "custom",
        message: "Preview and delivery identities must match.",
        path: ["delivery", "invocationId"],
      });
  });

export const aiIntentPreviewFrameV1Schema = z.discriminatedUnion("type", [
  aiIntentPreviewStatusFrameV1Schema,
  aiIntentPreviewCandidateFrameV1Schema,
]);

export type AiIntentPreviewFrameV1 = z.output<
  typeof aiIntentPreviewFrameV1Schema
>;
export type AiIntentPreviewStatusCodeV1 = z.output<
  typeof aiIntentPreviewStatusFrameV1Schema
>["code"];
