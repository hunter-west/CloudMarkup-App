import { createHash } from "node:crypto";
import { serializeCanonicalJson } from "@cloudmarkup/schemas";
import { z } from "zod";

const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const sha = z.string().regex(/^[a-f0-9]{40}$/u);
export const gitLabExportReviewIdSchema = z
  .string()
  .regex(/^gitlabreview_[a-f0-9]{32}$/u);
export const gitLabExportDescriptorSchema = z
  .object({
    schemaVersion: z.literal(1),
    reviewId: gitLabExportReviewIdSchema,
    organizationId: identifier,
    projectId: identifier,
    principalId: identifier,
    applicationId: z.string().regex(/^[a-f0-9]{64}$/u),
    connectionId: z.string().regex(/^gitlab_[a-f0-9]{32}$/u),
    providerProjectId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    selectionVersion: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER - 1),
    artifactId: identifier,
    artifactManifestDigest: digest,
    artifactZipDigest: digest,
    artifactReviewDigest: digest,
    baseCommitSha: sha,
    baseBranch: z.string().min(1).max(255),
    branch: z.string().regex(/^cloudmarkup\/export-[a-f0-9]{32}$/u),
    destinationFolder: z.string().min(1).max(512),
    expectedTreeSha: sha,
    fileCount: z.number().int().min(1).max(512),
  })
  .strict()
  .refine(
    (value) =>
      value.branch ===
      "cloudmarkup/export-" + value.reviewId.slice("gitlabreview_".length),
  );
export type GitLabExportDescriptor = z.output<
  typeof gitLabExportDescriptorSchema
>;
export const gitLabExportMergeRequestSchema = z
  .object({
    number: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
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
  .refine((value) =>
    value.url.endsWith("/-/merge_requests/" + String(value.number)),
  );
export const gitLabExportRecordSchema = z
  .object({
    descriptor: gitLabExportDescriptorSchema,
    approvalDigest: digest,
    state: z.enum([
      "prepared",
      "commit-dispatched",
      "verifying",
      "verified",
      "merge-request-dispatched",
      "succeeded",
    ]),
    recordVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    verifiedFiles: z.number().int().nonnegative().max(512),
    commitSha: sha.nullable(),
    mergeRequest: gitLabExportMergeRequestSchema.nullable(),
    expiresAt: z.iso.datetime(),
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
      value.verifiedFiles <= value.descriptor.fileCount &&
      (beforeCommit
        ? value.commitSha === null && value.verifiedFiles === 0
        : value.commitSha !== null) &&
      (completeFiles
        ? value.verifiedFiles === value.descriptor.fileCount
        : value.verifiedFiles < value.descriptor.fileCount) &&
      (value.state === "succeeded"
        ? value.mergeRequest !== null &&
          value.mergeRequest.sha === value.commitSha
        : value.mergeRequest === null)
    );
  });
export type GitLabExportRecord = z.output<typeof gitLabExportRecordSchema>;
export function gitLabExportApprovalDigest(
  descriptor: GitLabExportDescriptor,
): string {
  return (
    "sha256:" +
    createHash("sha256")
      .update(
        serializeCanonicalJson(gitLabExportDescriptorSchema.parse(descriptor)),
      )
      .digest("hex")
  );
}
