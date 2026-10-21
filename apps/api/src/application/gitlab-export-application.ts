import type {
  AdvanceGitlabExportV1,
  CreateGitlabExportReviewV1,
  GitlabExportPreviewV1,
  GitlabExportV1,
} from "@cloudmarkup/api-contract";
import { gitlabExportV1Schema } from "@cloudmarkup/api-contract";
import type { PrincipalContext } from "./ports.js";
import type { GitLabReviewedExportWorkflow } from "./gitlab-exports.js";
import type { GitLabExportRecord } from "./gitlab-export-state.js";

export interface GitLabExportsApplication {
  preview(
    principal: PrincipalContext,
    projectId: string,
    input: CreateGitlabExportReviewV1,
  ): Promise<GitlabExportPreviewV1>;
  get(
    principal: PrincipalContext,
    projectId: string,
    reviewId: string,
  ): Promise<GitlabExportV1>;
  advance(
    principal: PrincipalContext,
    projectId: string,
    reviewId: string,
    input: AdvanceGitlabExportV1,
  ): Promise<GitlabExportV1>;
}
function projection(record: GitLabExportRecord): GitlabExportV1 {
  const d = record.descriptor;
  return gitlabExportV1Schema.parse({
    contractVersion: 1,
    reviewId: d.reviewId,
    organizationId: d.organizationId,
    projectId: d.projectId,
    principalId: d.principalId,
    connectionId: d.connectionId,
    providerProjectId: d.providerProjectId,
    selectionVersion: d.selectionVersion,
    artifactId: d.artifactId,
    artifactManifestDigest: d.artifactManifestDigest,
    artifactZipDigest: d.artifactZipDigest,
    approvalDigest: record.approvalDigest,
    baseCommitSha: d.baseCommitSha,
    baseBranch: d.baseBranch,
    branch: d.branch,
    destinationFolder: d.destinationFolder,
    fileCount: d.fileCount,
    state: record.state,
    recordVersion: record.recordVersion,
    verifiedFiles: record.verifiedFiles,
    commitSha: record.commitSha,
    mergeRequest: record.mergeRequest,
    expiresAt: record.expiresAt,
    expired: record.expired,
  });
}
/** Explicit public projection; provider application/key identifiers, grant material and internal review data stay server-owned. */
export function createGitLabExportsApplication(
  workflowFor: (
    principal: PrincipalContext,
    projectId: string,
  ) => Promise<GitLabReviewedExportWorkflow>,
): GitLabExportsApplication {
  return {
    preview: async (principal, projectId, input) => {
      const workflow = await workflowFor(principal, projectId);
      const result = await workflow.preview({
        connectionId: input.connectionId,
        providerProjectId: input.providerProjectId,
        selectionVersion: input.selectionVersion,
        artifactId: input.artifactId,
        destinationFolder: input.destinationFolder,
      });
      return {
        export: projection(result.record),
        files: result.files.map(({ path, sizeBytes, sha256, mode }) => ({
          path,
          sizeBytes,
          sha256,
          mode,
        })),
      };
    },
    get: async (principal, projectId, reviewId) =>
      projection(await (await workflowFor(principal, projectId)).get(reviewId)),
    advance: async (principal, projectId, reviewId, input) =>
      projection(
        await (
          await workflowFor(principal, projectId)
        ).advance({
          reviewId,
          expectedVersion: input.expectedVersion,
          approvalDigest: input.approvalDigest,
          ...(input.acknowledgedAutomation === undefined
            ? {}
            : { acknowledgedAutomation: input.acknowledgedAutomation }),
        }),
      ),
  };
}
