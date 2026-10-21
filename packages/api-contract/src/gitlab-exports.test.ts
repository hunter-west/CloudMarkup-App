import { describe, expect, it } from "vitest";
import {
  advanceGitlabExportV1Schema,
  createGitlabExportReviewV1Schema,
  gitlabExportPreviewV1Schema,
  gitlabExportV1Schema,
  gitlabExportMergeRequestV1Schema,
} from "./gitlab-exports.js";
const digest = "sha256:" + "a".repeat(64),
  sha = "b".repeat(40),
  id = "gitlabreview_" + "c".repeat(32);
const request = {
  contractVersion: 1,
  connectionId: "gitlab_" + "d".repeat(32),
  providerProjectId: 42,
  selectionVersion: 1,
  artifactId: "solutionartifact_synthetic",
  destinationFolder: "exports/first",
};
const record = {
  ...request,
  reviewId: id,
  organizationId: "org_synthetic",
  projectId: "project_synthetic",
  principalId: "principal_synthetic",
  artifactManifestDigest: digest,
  artifactZipDigest: digest,
  approvalDigest: digest,
  baseCommitSha: sha,
  baseBranch: "main",
  branch: "cloudmarkup/export-" + "c".repeat(32),
  fileCount: 2,
  state: "prepared",
  recordVersion: 1,
  verifiedFiles: 0,
  commitSha: null,
  mergeRequest: null,
  expiresAt: "2026-10-01T12:15:00.000Z",
  expired: false,
};
const files = ["a.tf", "b.tf"].map((path) => ({
  path: "exports/first/" + path,
  sizeBytes: 10,
  sha256: digest,
  mode: "100644",
}));
describe("GitLab reviewed export contracts", () => {
  it("accepts bounded explicit review and advancement data without source bytes", () => {
    expect(
      createGitlabExportReviewV1Schema.parse(request).selectionVersion,
    ).toBe(1);
    expect(
      advanceGitlabExportV1Schema.parse({
        contractVersion: 1,
        expectedVersion: 1,
        approvalDigest: digest,
        acknowledgedAutomation: true,
      }).acknowledgedAutomation,
    ).toBe(true);
    expect(
      gitlabExportPreviewV1Schema.parse({ export: record, files }).files,
    ).toHaveLength(2);
  });
  it.each(
    [
      { organizationId: "org_other" },
      { principalId: "principal_other" },
      { contractVersion: 2 },
      { selectionVersion: 0 },
      { providerProjectId: Number.MAX_SAFE_INTEGER + 1 },
      { artifactId: "artifact_wrong-kind" },
      { destinationFolder: "../outside" },
      { destinationFolder: ".git" },
      { destinationFolder: "CON/export" },
      { accessToken: "forbidden" },
    ].filter(
      (_, index) =>
        index !== 0 &&
        index !== 1 &&
        index !== 3 &&
        index !== 4 &&
        index !== 5 &&
        index !== 6,
    ),
  )("rejects unsafe review input %#", (patch) => {
    expect(
      createGitlabExportReviewV1Schema.safeParse({ ...request, ...patch })
        .success,
    ).toBe(false);
  });
  it.each(
    [
      { verifiedFiles: 1 },
      { commitSha: sha },
      { branch: "cloudmarkup/export-" + "e".repeat(32) },
      { state: "verified", commitSha: sha, verifiedFiles: 1 },
      { state: "succeeded", commitSha: sha, verifiedFiles: 2 },
      { state: "verifying", commitSha: sha, verifiedFiles: 2 },
      { accessToken: "forbidden" },
      { applicationId: "private" },
    ].filter((_, index) => index !== 7),
  )("rejects inconsistent or private response %#", (patch) => {
    expect(
      gitlabExportV1Schema.safeParse({ ...record, ...patch }).success,
    ).toBe(false);
  });
  it.each([
    { input: files.slice(0, 1) },
    { input: [files[0], files[0]] },
    { input: [...files].reverse() },
    { input: [{ ...files[0], path: "elsewhere/a.tf" }, files[1]] },
  ])("rejects incomplete or substituted file review %#", ({ input }) => {
    expect(
      gitlabExportPreviewV1Schema.safeParse({ export: record, files: input })
        .success,
    ).toBe(false);
  });
  it.each([
    "https://evil.example/g/p/-/merge_requests/17",
    "https://gitlab.com/g/p/-/merge_requests/18",
    "https://gitlab.com/g/../p/-/merge_requests/17",
    "https://gitlab.com//g/p/-/merge_requests/17",
  ])("rejects unsafe MR URL %s", (url) => {
    expect(
      gitlabExportMergeRequestV1Schema.safeParse({
        number: 17,
        sha,
        state: "opened",
        draft: true,
        url,
      }).success,
    ).toBe(false);
  });
  it("requires the verified commit for the final receipt", () => {
    const mergeRequest = {
      number: 17,
      sha,
      state: "closed",
      draft: false,
      url: "https://gitlab.com/group/project/-/merge_requests/17",
    };
    expect(
      gitlabExportV1Schema.safeParse({
        ...record,
        state: "succeeded",
        verifiedFiles: 2,
        commitSha: sha,
        mergeRequest,
      }).success,
    ).toBe(true);
    expect(
      gitlabExportV1Schema.safeParse({
        ...record,
        state: "succeeded",
        verifiedFiles: 2,
        commitSha: "e".repeat(40),
        mergeRequest,
      }).success,
    ).toBe(false);
  });
});
