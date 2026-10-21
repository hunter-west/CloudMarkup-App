import {
  encodeUtf8,
  modelIntentExtractionRequestV1Schema,
} from "@cloudmarkup/schemas";
import { z } from "zod";

import { consequentialMutationHeadersV1Schema } from "./common.js";
import { projectEditingLeaseProofV1Schema } from "./project-editing-leases.js";
import { aiIntentPreviewDeliveryProofV1Schema } from "./ai-intent-preview-stream.js";

/** One RAM-only prompt; no browser-supplied model, billing or tenant authority. */
export const AI_INTENT_PREVIEW_REQUIREMENTS_MAX_BYTES_V1 = 32 * 1024;
export const AI_INTENT_PREVIEW_INVOCATION_HEADER_V1 =
  "x-cloudmarkup-preview-invocation-id" as const;

export const createAiIntentPreviewV1Schema = z
  .object({
    contractVersion: z.literal(1),
    requirements:
      modelIntentExtractionRequestV1Schema.shape.source.shape.content
        .max(AI_INTENT_PREVIEW_REQUIREMENTS_MAX_BYTES_V1)
        .refine(
          (value) =>
            value.trim().length > 0 &&
            encodeUtf8(value).byteLength <=
              AI_INTENT_PREVIEW_REQUIREMENTS_MAX_BYTES_V1,
          {
            message:
              "Requirements must be nonempty and within the preview byte limit.",
          },
        ),
    requestedMode: modelIntentExtractionRequestV1Schema.shape.requestedMode,
    editingProof: projectEditingLeaseProofV1Schema,
  })
  .strict();

export const aiIntentPreviewRequestHeadersV1Schema =
  consequentialMutationHeadersV1Schema.extend({
    "if-match": z
      .string()
      .regex(/^"draft:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}:v[1-9][0-9]{0,15}"$/u),
  });
export const aiIntentPreviewRequestQueryV1Schema = z.object({}).strict();

export const aiIntentPreviewResponseHeadersV1Schema = z
  .object({
    "cache-control": z.literal("private, no-store, no-transform"),
    "content-type": z.literal("text/event-stream; charset=utf-8"),
    "content-security-policy": z.literal("sandbox"),
    "x-content-type-options": z.literal("nosniff"),
    [AI_INTENT_PREVIEW_INVOCATION_HEADER_V1]:
      aiIntentPreviewDeliveryProofV1Schema.shape.invocationId,
  })
  .strict();

export type CreateAiIntentPreviewV1 = z.output<
  typeof createAiIntentPreviewV1Schema
>;
