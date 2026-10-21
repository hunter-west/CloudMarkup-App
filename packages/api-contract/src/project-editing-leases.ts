import { z } from "zod";

import {
  createDataEnvelopeSchema,
  createOpaqueIdentifierSchema,
  utcTimestampSchema,
} from "./common.js";

// Canonical, unpadded base64url encoding of exactly 32 random bytes.
export const projectEditingLeaseTokenV1Schema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/);

export const projectEditingLeaseIdV1Schema = z
  .string()
  .regex(
    /^projectlease_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
  );

export const projectEditingLeaseProofV1Schema = z
  .object({
    leaseId: projectEditingLeaseIdV1Schema,
    token: projectEditingLeaseTokenV1Schema,
  })
  .strict();

export const acquireProjectEditingLeaseV1Schema = z
  .object({
    contractVersion: z.literal(1),
    token: projectEditingLeaseTokenV1Schema,
  })
  .strict();

export const mutateProjectEditingLeaseV1Schema =
  projectEditingLeaseProofV1Schema.extend({ contractVersion: z.literal(1) });

const stateShape = {
  contractVersion: z.literal(1),
  projectId: createOpaqueIdentifierSchema("project"),
};

export const projectEditingLeaseStateV1Schema = z.discriminatedUnion("state", [
  z.object({ ...stateShape, state: z.literal("available") }).strict(),
  z
    .object({
      ...stateShape,
      state: z.literal("held"),
      expiresAt: utcTimestampSchema,
    })
    .strict(),
  z
    .object({
      ...stateShape,
      state: z.literal("owned"),
      expiresAt: utcTimestampSchema,
      leaseId: projectEditingLeaseIdV1Schema,
    })
    .strict(),
]);

export const projectEditingLeaseResponseV1Schema = createDataEnvelopeSchema(
  projectEditingLeaseStateV1Schema,
);

export type ProjectEditingLeaseProofV1 = z.output<
  typeof projectEditingLeaseProofV1Schema
>;
export type ProjectEditingLeaseStateV1 = z.output<
  typeof projectEditingLeaseStateV1Schema
>;
