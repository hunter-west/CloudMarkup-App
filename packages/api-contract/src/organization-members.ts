import { z } from "zod";
import { accountUsernameV1Schema } from "./account-profile.js";
import {
  createDataEnvelopeSchema,
  createListEnvelopeSchema,
  paginationQueryShape,
  utcTimestampSchema,
  entityTagSchema,
} from "./common.js";
import {
  membershipIdSchema,
  organizationIdSchema,
  organizationRoleV1Schema,
  principalIdSchema,
} from "./resources.js";
const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const organizationMemberStateV1Schema = z
  .object({
    membershipId: membershipIdSchema,
    principalId: principalIdSchema,
    role: organizationRoleV1Schema,
    status: z.enum(["active", "suspended", "removed"]),
    version,
  })
  .strict();
export const organizationMemberV1Schema = organizationMemberStateV1Schema
  .extend({
    contractVersion: z.literal(1),
    organizationId: organizationIdSchema,
    etag: entityTagSchema,
    displayName: z.string().trim().min(1).max(120),
    username: accountUsernameV1Schema.nullable(),
    joinedAt: utcTimestampSchema,
    endedAt: utcTimestampSchema.nullable(),
    endReason: z.enum(["removed", "left"]).nullable(),
  })
  .strict()
  .refine((value) =>
    value.status === "removed"
      ? value.endedAt !== null && value.endReason !== null
      : value.endedAt === null && value.endReason === null,
  );
export const organizationMemberResponseV1Schema = createDataEnvelopeSchema(
  organizationMemberV1Schema,
);
export const organizationMemberListResponseV1Schema = createListEnvelopeSchema(
  organizationMemberV1Schema,
);
export const organizationMemberListQueryV1Schema = z
  .object({ ...paginationQueryShape })
  .strict();
const base = {
  contractVersion: z.literal(1),
  membershipId: membershipIdSchema,
};
export const changeOrganizationMembershipV1Schema = z.discriminatedUnion(
  "action",
  [
    z
      .object({
        ...base,
        action: z.literal("set-role"),
        role: z.enum(["administrator", "editor", "viewer"]),
      })
      .strict(),
    z.object({ ...base, action: z.literal("remove") }).strict(),
    z.object({ ...base, action: z.literal("leave") }).strict(),
    z
      .object({
        ...base,
        action: z.literal("transfer-ownership"),
        targetMembershipId: membershipIdSchema,
        targetVersion: version,
      })
      .strict(),
  ],
);
export const organizationMembershipReceiptV1Schema = z
  .object({
    contractVersion: z.literal(1),
    organizationId: organizationIdSchema,
    actorPrincipalId: principalIdSchema,
    action: z.enum(["set-role", "remove", "leave", "transfer-ownership"]),
    members: z.array(organizationMemberStateV1Schema).min(1).max(2),
    occurredAt: utcTimestampSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.members.length ===
        (value.action === "transfer-ownership" ? 2 : 1) &&
      new Set(value.members.map((m) => m.membershipId)).size ===
        value.members.length,
  );
export const organizationMembershipReceiptResponseV1Schema =
  createDataEnvelopeSchema(organizationMembershipReceiptV1Schema);
export type OrganizationMemberV1 = z.output<typeof organizationMemberV1Schema>;
export type ChangeOrganizationMembershipV1 = z.output<
  typeof changeOrganizationMembershipV1Schema
>;
export type OrganizationMembershipReceiptV1 = z.output<
  typeof organizationMembershipReceiptV1Schema
>;
