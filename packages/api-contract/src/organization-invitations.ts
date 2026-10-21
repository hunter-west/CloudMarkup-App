import { z } from "zod";
import { createDataEnvelopeSchema, utcTimestampSchema } from "./common.js";
import {
  membershipIdSchema,
  organizationIdSchema,
  organizationRoleV1Schema,
} from "./resources.js";

export const organizationInvitationIdV1Schema = z
  .string()
  .regex(
    /^invitation_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
  );
/** Canonical unpadded encoding of 32 client-generated cryptographically random bytes. */
export const organizationInvitationTokenV1Schema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/);
export const organizationInvitationRoleV1Schema = z.enum([
  "administrator",
  "editor",
  "viewer",
]);
export const createOrganizationInvitationV1Schema = z
  .object({
    contractVersion: z.literal(1),
    role: organizationInvitationRoleV1Schema,
    token: organizationInvitationTokenV1Schema,
  })
  .strict();
export const acceptOrganizationInvitationV1Schema = z
  .object({
    contractVersion: z.literal(1),
    token: organizationInvitationTokenV1Schema,
  })
  .strict();
export const organizationInvitationPathV1Schema = z
  .object({
    invitationId: organizationInvitationIdV1Schema,
  })
  .strict();
export const organizationInvitationManagementPathV1Schema =
  organizationInvitationPathV1Schema.extend({
    organizationId: organizationIdSchema,
  });
export const organizationInvitationV1Schema = z
  .object({
    contractVersion: z.literal(1),
    id: organizationInvitationIdV1Schema,
    organizationId: organizationIdSchema,
    role: organizationInvitationRoleV1Schema,
    expiresAt: utcTimestampSchema,
    status: z.enum(["pending", "accepted", "revoked", "expired"]),
  })
  .strict();
export const acceptedOrganizationInvitationV1Schema = z
  .object({
    contractVersion: z.literal(1),
    organizationId: organizationIdSchema,
    membershipId: membershipIdSchema,
    role: organizationRoleV1Schema,
    status: z.literal("accepted"),
  })
  .strict();
export const organizationInvitationResponseV1Schema = createDataEnvelopeSchema(
  organizationInvitationV1Schema,
);
export const acceptedOrganizationInvitationResponseV1Schema =
  createDataEnvelopeSchema(acceptedOrganizationInvitationV1Schema);
export type CreateOrganizationInvitationV1 = z.output<
  typeof createOrganizationInvitationV1Schema
>;
export type AcceptOrganizationInvitationV1 = z.output<
  typeof acceptOrganizationInvitationV1Schema
>;
export type OrganizationInvitationV1 = z.output<
  typeof organizationInvitationV1Schema
>;
export type AcceptedOrganizationInvitationV1 = z.output<
  typeof acceptedOrganizationInvitationV1Schema
>;
