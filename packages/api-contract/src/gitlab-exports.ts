import { z } from "zod";
import {
  createDataEnvelopeSchema,
  sha256DigestSchema,
  utcTimestampSchema,
} from "./common.js";
import {
  organizationIdSchema,
  principalIdSchema,
  projectIdSchema,
} from "./resources.js";
import { solutionExportArtifactIdSchema } from "./solution-exports.js";
import { gitlabConnectionIdV1Schema } from "./gitlab-connections.js";
import { gitlabProjectIdV1Schema } from "./gitlab-projects.js";

const version = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER - 1);
const sha = z.string().regex(/^[a-f0-9]{40}$/u);
const folder = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9._ /-]+$/u)
  .refine((value) =>
    value
      .split("/")
      .every(
        (part) =>
          part.length > 0 &&
          part === part.trim() &&
          part !== "." &&
          part !== ".." &&
          part.toLowerCase() !== ".git" &&
          !part.endsWith(".") &&
          !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part),
      ),
  );
export const gitlabExportReviewIdV1Schema = z
  .string()
  .regex(/^gitlabreview_[a-f0-9]{32}$/u);
export const gitlabExportCollectionPathV1Schema = z
  .object({ projectId: projectIdSchema })
  .strict();
export const gitlabExportPathV1Schema = gitlabExportCollectionPathV1Schema
  .extend({ reviewId: gitlabExportReviewIdV1Schema })
  .strict();
export const createGitlabExportReviewV1Schema = z
  .object({
    contractVersion: z.literal(1),
    connectionId: gitlabConnectionIdV1Schema,
    providerProjectId: gitlabProjectIdV1Schema,
    selectionVersion: version,
    artifactId: solutionExportArtifactIdSchema,
    destinationFolder: folder,
  })
  .strict();
export const advanceGitlabExportV1Schema = z
  .object({
    contractVersion: z.literal(1),
    expectedVersion: version,
    approvalDigest: sha256DigestSchema,
    acknowledgedAutomation: z.boolean().optional(),
  })
  .strict();
export const gitlabExportMergeRequestV1Schema = z
  .object({
    number: gitlabProjectIdV1Schema,
    sha,
    state: z.enum(["opened", "closed", "merged", "locked"]),
    draft: z.boolean(),
    url: z
      .string()
      .max(2048)
      .regex(
        /^https:\/\/gitlab\.com\/[A-Za-z0-9_./-]+\/-\/merge_requests\/[1-9][0-9]*$/u,
      ),
  })
  .strict()
  .refine((value) => {
    const segments = value.url.slice("https://gitlab.com/".length).split("/");
    return (
      segments.length >= 5 &&
      segments.every((part) => part !== "" && part !== "." && part !== "..") &&
      value.url.endsWith("/-/merge_requests/" + String(value.number))
    );
  });
export const gitlabExportV1Schema = z
  .object({
    contractVersion: z.literal(1),
    reviewId: gitlabExportReviewIdV1Schema,
    organizationId: organizationIdSchema,
    projectId: projectIdSchema,
    principalId: principalIdSchema,
    connectionId: gitlabConnectionIdV1Schema,
    providerProjectId: gitlabProjectIdV1Schema,
    selectionVersion: version,
    artifactId: solutionExportArtifactIdSchema,
    artifactManifestDigest: sha256DigestSchema,
    artifactZipDigest: sha256DigestSchema,
    approvalDigest: sha256DigestSchema,
    baseCommitSha: sha,
    baseBranch: z.string().min(1).max(255),
    branch: z.string().regex(/^cloudmarkup\/export-[a-f0-9]{32}$/u),
    destinationFolder: folder,
    fileCount: z.number().int().min(1).max(512),
    state: z.enum([
      "prepared",
      "commit-dispatched",
      "verifying",
      "verified",
      "merge-request-dispatched",
      "succeeded",
    ]),
    recordVersion: version,
    verifiedFiles: z.number().int().min(0).max(512),
    commitSha: sha.nullable(),
    mergeRequest: gitlabExportMergeRequestV1Schema.nullable(),
    expiresAt: utcTimestampSchema,
    expired: z.boolean(),
  })
  .strict()
  .refine((value) => {
    const beforeCommit =
      value.state === "prepared" || value.state === "commit-dispatched";
    const completeFiles = [
      "verified",
      "merge-request-dispatched",
      "succeeded",
    ].includes(value.state);
    return (
      value.branch ===
        "cloudmarkup/export-" + value.reviewId.slice("gitlabreview_".length) &&
      value.verifiedFiles <= value.fileCount &&
      (beforeCommit
        ? value.commitSha === null && value.verifiedFiles === 0
        : value.commitSha !== null) &&
      (completeFiles
        ? value.verifiedFiles === value.fileCount
        : value.verifiedFiles < value.fileCount) &&
      (value.state === "succeeded"
        ? value.mergeRequest !== null &&
          value.mergeRequest.sha === value.commitSha
        : value.mergeRequest === null)
    );
  });
export const gitlabExportPreviewV1Schema = z
  .object({
    export: gitlabExportV1Schema,
    files: z
      .array(
        z
          .object({
            path: folder,
            sizeBytes: z.number().int().min(0).max(1048576),
            sha256: sha256DigestSchema,
            mode: z.literal("100644"),
          })
          .strict(),
      )
      .min(1)
      .max(512),
  })
  .strict()
  .refine(
    (value) =>
      value.export.state === "prepared" &&
      value.files.length === value.export.fileCount &&
      value.files.every(
        (file, index) =>
          file.path.startsWith(value.export.destinationFolder + "/") &&
          (index === 0 || file.path > (value.files[index - 1]?.path ?? "")),
      ),
  );
export const gitlabExportResponseV1Schema =
  createDataEnvelopeSchema(gitlabExportV1Schema);
export const gitlabExportPreviewResponseV1Schema = createDataEnvelopeSchema(
  gitlabExportPreviewV1Schema,
);
export type CreateGitlabExportReviewV1 = z.output<
  typeof createGitlabExportReviewV1Schema
>;
export type AdvanceGitlabExportV1 = z.output<
  typeof advanceGitlabExportV1Schema
>;
export type GitlabExportV1 = z.output<typeof gitlabExportV1Schema>;
export type GitlabExportPreviewV1 = z.output<
  typeof gitlabExportPreviewV1Schema
>;
