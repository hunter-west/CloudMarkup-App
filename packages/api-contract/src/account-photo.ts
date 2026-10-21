import { z } from "zod";
import { createDataEnvelopeSchema } from "./common.js";
import { principalIdSchema } from "./resources.js";

export const ACCOUNT_PHOTO_EDGE_V1 = 192;
export const MAX_ACCOUNT_PHOTO_BYTES_V1 = 180 * 1024;
export const accountPhotoDataV1Schema = z
  .string()
  .max(22 + 4 * Math.ceil(MAX_ACCOUNT_PHOTO_BYTES_V1 / 3))
  .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/u);
export const accountPhotoV1Schema = z
  .object({
    contractVersion: z.literal(1),
    principalId: principalIdSchema,
    version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    image: accountPhotoDataV1Schema.nullable(),
  })
  .strict();
export const accountPhotoResponseV1Schema =
  createDataEnvelopeSchema(accountPhotoV1Schema);
export const updateAccountPhotoV1Schema = z
  .object({
    contractVersion: z.literal(1),
    image: accountPhotoDataV1Schema.nullable(),
  })
  .strict();
export type AccountPhotoV1 = z.output<typeof accountPhotoV1Schema>;
