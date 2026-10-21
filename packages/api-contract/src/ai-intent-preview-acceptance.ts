import {
  encodeUtf8,
  intentDocumentV1Schema,
  modelIntentExtractionResponseV1Schema,
  serializeCanonicalJson,
} from "@cloudmarkup/schemas";
import { z } from "zod";
import {
  MAX_JSON_REQUEST_BYTES,
  createDataEnvelopeSchema,
  createOpaqueIdentifierSchema,
  sha256DigestSchema,
  utcTimestampSchema,
} from "./common.js";
import { aiIntentPreviewRequestHeadersV1Schema } from "./ai-intent-preview-request.js";
import { aiIntentPreviewDeliveryProofV1Schema } from "./ai-intent-preview-stream.js";
import { projectEditingLeaseProofV1Schema } from "./project-editing-leases.js";
import {
  draftIdSchema,
  principalIdSchema,
  projectIdSchema,
} from "./resources.js";

export const acceptedIntentIdV1Schema =
  createOpaqueIdentifierSchema("accepted_intent");

/** Explicit approval of the exact issued candidate. No claimed ownership,
 * digest, model selection, grade, credit amount or graph mutation authority. */
export const acceptAiIntentPreviewV1Schema = z
  .object({
    contractVersion: z.literal(1),
    candidate: modelIntentExtractionResponseV1Schema,
    editingProof: projectEditingLeaseProofV1Schema,
  })
  .strict()
  .refine(
    (value) =>
      encodeUtf8(serializeCanonicalJson(value)).byteLength <=
      MAX_JSON_REQUEST_BYTES,
    { message: "Intent acceptance exceeds the request byte limit." },
  );

export const aiIntentPreviewAcceptanceHeadersV1Schema =
  aiIntentPreviewRequestHeadersV1Schema;
export const aiIntentPreviewAcceptanceQueryV1Schema = z.object({}).strict();

/** Immutable accepted content. Receipt metadata alone is not publication or
 * authorization evidence; the host must read the actual published object. */
export const acceptedIntentV1Schema = z
  .object({
    contractVersion: z.literal(1),
    acceptedIntentId: acceptedIntentIdV1Schema,
    projectId: projectIdSchema,
    createdAt: utcTimestampSchema,
    createdByPrincipalId: principalIdSchema,
    sourceDraftId: draftIdSchema,
    sourceDraftVersion: z.number().int().positive(),
    invocationId: aiIntentPreviewDeliveryProofV1Schema.shape.invocationId,
    outputDigest: sha256DigestSchema,
    intentDigest: sha256DigestSchema,
    intentDocument: intentDocumentV1Schema,
  })
  .strict();
export const acceptedIntentResponseV1Schema = createDataEnvelopeSchema(
  acceptedIntentV1Schema,
);
export const acceptedIntentPathV1Schema = z
  .object({
    projectId: projectIdSchema,
    acceptedIntentId: acceptedIntentIdV1Schema,
  })
  .strict();
export type AcceptAiIntentPreviewV1 = z.output<
  typeof acceptAiIntentPreviewV1Schema
>;
export type AcceptedIntentV1 = z.output<typeof acceptedIntentV1Schema>;
