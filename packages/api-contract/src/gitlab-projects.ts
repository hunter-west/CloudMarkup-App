import { z } from "zod";
import {
  createDataEnvelopeSchema,
  createListEnvelopeSchema,
} from "./common.js";
import { organizationIdSchema, principalIdSchema } from "./resources.js";
import {
  gitlabConnectionIdV1Schema,
  gitlabConnectionPathV1Schema,
} from "./gitlab-connections.js";

export const gitlabProjectIdV1Schema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const version = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER - 1);
const projectPath = z
  .string()
  .min(3)
  .max(1024)
  .refine((value) => {
    const parts = value.split("/");
    return (
      parts.length >= 2 &&
      parts.every(
        (part) =>
          /^[A-Za-z0-9_.-]+$/u.test(part) && part !== "." && part !== "..",
      )
    );
  });
export const gitlabProjectV1Schema = z
  .object({
    projectId: gitlabProjectIdV1Schema,
    pathWithNamespace: projectPath,
    defaultBranch: z.string().min(1).max(255).nullable(),
    url: z.string().max(1043),
    eligibility: z.enum([
      "eligible",
      "archived",
      "empty",
      "insufficient-access",
    ]),
  })
  .strict()
  .refine(
    (value) => value.url === "https://gitlab.com/" + value.pathWithNamespace,
  )
  .refine(
    (value) => value.eligibility !== "eligible" || value.defaultBranch !== null,
  );
export const gitlabProjectDiscoveryQueryV1Schema = z
  .object({
    page: z.coerce.number().int().min(1).max(200).default(1),
  })
  .strict();
export const gitlabProjectDiscoveryV1Schema = z
  .object({
    contractVersion: z.literal(1),
    organizationId: organizationIdSchema,
    principalId: principalIdSchema,
    connectionId: gitlabConnectionIdV1Schema,
    projects: z.array(gitlabProjectV1Schema).max(100),
    nextPage: z.number().int().min(2).max(200).nullable(),
  })
  .strict()
  .refine((value) =>
    value.projects.every(
      (item, index) =>
        item.projectId > (value.projects[index - 1]?.projectId ?? 0),
    ),
  );
export const gitlabProjectSelectionV1Schema = z
  .object({
    contractVersion: z.literal(1),
    organizationId: organizationIdSchema,
    principalId: principalIdSchema,
    connectionId: gitlabConnectionIdV1Schema,
    projectId: gitlabProjectIdV1Schema,
    version: version.refine((value) => value > 0),
    enabled: z.boolean(),
  })
  .strict();
export const updateGitlabProjectSelectionV1Schema = z
  .object({
    contractVersion: z.literal(1),
    expectedVersion: version,
    enabled: z.boolean(),
  })
  .strict();
export const gitlabProjectSelectionPathV1Schema = gitlabConnectionPathV1Schema
  .extend({
    projectId: z
      .string()
      .regex(/^[1-9][0-9]{0,15}$/u)
      .refine((value) => Number.isSafeInteger(Number(value))),
  })
  .strict();
export const gitlabProjectSelectionListQueryV1Schema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z
      .string()
      .regex(/^[1-9][0-9]{0,15}$/u)
      .refine((value) => Number.isSafeInteger(Number(value)))
      .optional(),
  })
  .strict();
export const gitlabProjectDiscoveryResponseV1Schema = createDataEnvelopeSchema(
  gitlabProjectDiscoveryV1Schema,
);
export const gitlabProjectSelectionResponseV1Schema = createDataEnvelopeSchema(
  gitlabProjectSelectionV1Schema,
);
export const gitlabProjectSelectionListResponseV1Schema =
  createListEnvelopeSchema(gitlabProjectSelectionV1Schema);
export type GitlabProjectV1 = z.output<typeof gitlabProjectV1Schema>;
export type GitlabProjectDiscoveryV1 = z.output<
  typeof gitlabProjectDiscoveryV1Schema
>;
export type GitlabProjectSelectionV1 = z.output<
  typeof gitlabProjectSelectionV1Schema
>;
export type UpdateGitlabProjectSelectionV1 = z.output<
  typeof updateGitlabProjectSelectionV1Schema
>;
