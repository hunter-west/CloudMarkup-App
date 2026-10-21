import { z } from "zod";

export const API_CONTRACT_VERSION = "v1" as const;
export const MAX_JSON_REQUEST_BYTES = 256 * 1024;

export const apiContractVersionSchema = z.literal(API_CONTRACT_VERSION);

const opaqueIdentifierPattern = /^[a-z][a-z0-9]*(?:_[A-Za-z0-9-]+)+$/;
const namespacedCodePattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;

export function createOpaqueIdentifierSchema(prefix: string) {
  return z
    .string()
    .min(prefix.length + 2)
    .max(128)
    .regex(opaqueIdentifierPattern)
    .refine((value) => value.startsWith(`${prefix}_`), {
      message: `Identifier must use the ${prefix}_ prefix.`,
    });
}

export const correlationIdSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const entityTagSchema = z
  .string()
  .min(3)
  .max(160)
  .regex(/^"[A-Za-z0-9._:-]+"$/);

export const utcTimestampSchema = z.iso.datetime({ offset: true });

export const sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const safeUserMessageSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => !value.includes("\n") && !value.includes("\r"), {
    message: "Safe user messages must be a single line.",
  });

export const apiErrorCodeSchema = z.enum([
  "authentication_required",
  "access_denied",
  "not_found",
  "invalid_request",
  "payload_too_large",
  "precondition_required",
  "precondition_failed",
  "idempotency_key_required",
  "idempotency_key_reused",
  "conflict",
  "unsupported_version",
  "rate_limited",
  "service_unavailable",
  "internal_error",
]);

export const fieldIssueSchema = z
  .object({
    code: z.string().min(1).max(96).regex(namespacedCodePattern),
    message: safeUserMessageSchema,
    path: z.array(
      z.union([z.string().max(128), z.number().int().nonnegative()]),
    ),
  })
  .strict();

export const conflictRecoveryV1Schema = z
  .object({
    current: z
      .object({
        contentDigest: sha256DigestSchema.optional(),
        etag: entityTagSchema,
        semanticDigest: sha256DigestSchema.optional(),
        updatedAt: utcTimestampSchema.optional(),
        version: z.number().int().positive(),
        visualDigest: sha256DigestSchema.optional(),
      })
      .strict(),
    recovery: z
      .object({
        canCompare: z.boolean(),
        canCopy: z.boolean(),
        canReload: z.literal(true),
      })
      .strict(),
    resourceId: z.string().min(1).max(128),
    resourceKind: z.enum(["organization", "project", "environment", "draft"]),
  })
  .strict();

export const apiErrorEnvelopeV1Schema = z
  .object({
    apiVersion: apiContractVersionSchema,
    error: z
      .object({
        code: apiErrorCodeSchema,
        conflict: conflictRecoveryV1Schema.optional(),
        correlationId: correlationIdSchema,
        fieldIssues: z.array(fieldIssueSchema).max(100).optional(),
        message: safeUserMessageSchema,
      })
      .strict(),
  })
  .strict();

export const pageCursorSchema = z.string().min(1).max(512);
export const pageLimitQuerySchema = z
  .string()
  .regex(/^(?:[1-9]|[1-9][0-9]|100)$/);

export const paginationQueryShape = {
  "page[cursor]": pageCursorSchema.optional(),
  "page[limit]": pageLimitQuerySchema.optional(),
} as const;

export const pageMetadataSchema = z
  .object({
    hasMore: z.boolean(),
    nextCursor: pageCursorSchema.optional(),
  })
  .strict();

export const idempotencyHeadersV1Schema = z
  .object({
    "idempotency-key": idempotencyKeySchema,
  })
  .strict();

export const preconditionHeadersV1Schema = z
  .object({
    "if-match": entityTagSchema,
  })
  .strict();

export const consequentialMutationHeadersV1Schema = z
  .object({
    "idempotency-key": idempotencyKeySchema,
    "if-match": entityTagSchema,
  })
  .strict();

export const capabilitySchema = z
  .string()
  .min(3)
  .max(96)
  .regex(namespacedCodePattern);

export function createDataEnvelopeSchema<TSchema extends z.ZodType>(
  dataSchema: TSchema,
) {
  return z
    .object({
      apiVersion: apiContractVersionSchema,
      data: dataSchema,
    })
    .strict();
}

export function createListEnvelopeSchema<TSchema extends z.ZodType>(
  itemSchema: TSchema,
) {
  return z
    .object({
      apiVersion: apiContractVersionSchema,
      data: z.array(itemSchema),
      page: pageMetadataSchema,
    })
    .strict();
}

export type ConflictRecoveryV1 = z.output<typeof conflictRecoveryV1Schema>;
export type ApiErrorCode = z.output<typeof apiErrorCodeSchema>;
export type ApiErrorEnvelopeV1 = z.output<typeof apiErrorEnvelopeV1Schema>;
export type FieldIssue = z.output<typeof fieldIssueSchema>;
export type PageMetadata = z.output<typeof pageMetadataSchema>;
