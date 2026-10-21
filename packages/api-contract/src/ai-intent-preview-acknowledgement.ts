import { z } from "zod";

import { aiIntentPreviewDeliveryProofV1Schema } from "./ai-intent-preview-stream.js";
import { createDataEnvelopeSchema } from "./common.js";
import { projectEditingLeaseProofV1Schema } from "./project-editing-leases.js";

/** Receipt only: no candidate content, caller ownership, new expiry or model
 * request is accepted. Both unpredictable proofs belong in the body, not URLs. */
export const acknowledgeAiIntentPreviewV1Schema = z
  .object({
    contractVersion: z.literal(1),
    delivery: aiIntentPreviewDeliveryProofV1Schema,
    editingProof: projectEditingLeaseProofV1Schema,
  })
  .strict();

export const aiIntentPreviewAcknowledgementQueryV1Schema = z
  .object({})
  .strict();

export const aiIntentPreviewAcknowledgementV1Schema = z
  .object({
    contractVersion: z.literal(1),
    state: z.literal("acknowledged"),
  })
  .strict();

export const aiIntentPreviewAcknowledgementResponseV1Schema =
  createDataEnvelopeSchema(aiIntentPreviewAcknowledgementV1Schema);

export type AcknowledgeAiIntentPreviewV1 = z.output<
  typeof acknowledgeAiIntentPreviewV1Schema
>;
export type AiIntentPreviewAcknowledgementV1 = z.output<
  typeof aiIntentPreviewAcknowledgementV1Schema
>;
