import { z } from "zod";
import {
  createDataEnvelopeSchema,
  createListEnvelopeSchema,
  paginationQueryShape,
} from "./common.js";
import {
  organizationIdSchema,
  organizationRoleV1Schema,
  principalIdSchema,
} from "./resources.js";

export const accountWorkspaceV1Schema = z
  .object({
    contractVersion: z.literal(1),
    principalId: principalIdSchema,
    id: organizationIdSchema,
    kind: z.enum(["personal", "organization"]),
    displayName: z.string().trim().min(1).max(120),
    role: organizationRoleV1Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.kind === "personal" && value.role !== "owner")
      context.addIssue({
        code: "custom",
        path: ["role"],
        message: "Personal workspaces require their owner.",
      });
  });
export const accountWorkspaceResponseV1Schema = createDataEnvelopeSchema(
  accountWorkspaceV1Schema,
);
export const accountWorkspaceListResponseV1Schema = createListEnvelopeSchema(
  accountWorkspaceV1Schema,
);
export const accountWorkspaceListQueryV1Schema = z
  .object({ ...paginationQueryShape })
  .strict();
export const createAccountOrganizationV1Schema = z
  .object({
    contractVersion: z.literal(1),
    displayName: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .refine(
        (value) =>
          !Array.from(value).some(
            (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
          ),
        "Use a single-line organization name.",
      ),
  })
  .strict();
export const createPersonalWorkspaceV1Schema = z
  .object({ contractVersion: z.literal(1) })
  .strict();
export type AccountWorkspaceV1 = z.output<typeof accountWorkspaceV1Schema>;
export type CreateAccountOrganizationV1 = z.output<
  typeof createAccountOrganizationV1Schema
>;
