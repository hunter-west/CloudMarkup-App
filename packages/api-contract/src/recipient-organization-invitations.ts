import { z } from "zod";
import { accountUsernameV1Schema } from "./account-profile.js";
import {
  createDataEnvelopeSchema,
  createListEnvelopeSchema,
  paginationQueryShape,
} from "./common.js";
import {
  organizationInvitationRoleV1Schema,
  organizationInvitationV1Schema,
} from "./organization-invitations.js";
import { principalIdSchema } from "./resources.js";

export const organizationInvitationRecipientV1Schema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({ kind: z.literal("user-id"), userId: principalIdSchema })
      .strict(),
    z
      .object({
        kind: z.literal("username"),
        username: z.string().trim().toLowerCase().pipe(accountUsernameV1Schema),
      })
      .strict(),
  ],
);
export const createRecipientOrganizationInvitationV1Schema = z
  .object({
    contractVersion: z.literal(1),
    role: organizationInvitationRoleV1Schema,
    recipient: organizationInvitationRecipientV1Schema,
  })
  .strict();
export const boundOrganizationInvitationRecipientV1Schema = z
  .object({
    principalId: principalIdSchema,
    displayName: z.string().trim().min(1).max(120),
    username: accountUsernameV1Schema.nullable(),
  })
  .strict();
export const recipientOrganizationInvitationV1Schema =
  organizationInvitationV1Schema
    .extend({
      organizationName: z.string().trim().min(1).max(120),
      recipient: boundOrganizationInvitationRecipientV1Schema,
      status: z.enum(["pending", "accepted", "revoked", "expired", "declined"]),
    })
    .strict();
export const recipientOrganizationInvitationResponseV1Schema =
  createDataEnvelopeSchema(recipientOrganizationInvitationV1Schema);
export const recipientOrganizationInvitationListResponseV1Schema =
  createListEnvelopeSchema(recipientOrganizationInvitationV1Schema);
export type OrganizationInvitationRecipientV1 = z.output<
  typeof organizationInvitationRecipientV1Schema
>;
export type CreateRecipientOrganizationInvitationV1 = z.output<
  typeof createRecipientOrganizationInvitationV1Schema
>;
export type RecipientOrganizationInvitationV1 = z.output<
  typeof recipientOrganizationInvitationV1Schema
>;

export const recipientOrganizationInvitationListQueryV1Schema = z
  .object({ ...paginationQueryShape })
  .strict();
export const decideRecipientOrganizationInvitationV1Schema = z
  .object({ contractVersion: z.literal(1) })
  .strict();
